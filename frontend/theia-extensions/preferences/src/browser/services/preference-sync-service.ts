import { injectable, inject } from '@theia/core/shared/inversify';
import { MessageService } from '@theia/core';
import { PreferenceService, PreferenceChange } from '@theia/core/lib/common/preferences/preference-service';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';

import { GeoPreferenceStore } from '../geo-preference-store';
import { PreferencesApiClient } from './preferences-api-client';
import { GeoPreferenceDefinition } from '../geo-preferences-schema';

/**
 * Intention de synchronisation en attente pour une clé : `set` repousse la valeur
 * courante, `reset` demande la suppression de la ligne `AppConfig` (DELETE).
 */
type PendingSyncIntent = 'set' | 'reset';
type PendingSyncMap = Record<string, PendingSyncIntent>;

@injectable()
export class PreferenceSyncService implements FrontendApplicationContribution {

    private static readonly PREFERENCE_SET_TIMEOUT_MS = 5000;
    /** Clé localStorage de la file d'attente des écritures à rejouer vers Flask. */
    private static readonly PENDING_SYNC_STORAGE_KEY = 'geoApp.preferences.pendingSync.v1';

    private applyingRemote = false;
    private initializationTask: Promise<void> | undefined;
    private initializationScheduled = false;
    private readonly backendDefinitions: Map<string, GeoPreferenceDefinition>;
    private readonly sensitiveKeys: Set<string>;

    /** Anti-spam : on n'affiche pas deux fois la même erreur de sync en moins de 5 s. */
    private lastSyncErrorAt = 0;

    constructor(
        @inject(PreferenceService) private readonly preferenceService: PreferenceService,
        @inject(GeoPreferenceStore) private readonly store: GeoPreferenceStore,
        @inject(PreferencesApiClient) private readonly apiClient: PreferencesApiClient,
        @inject(MessageService) private readonly messageService: MessageService
    ) {
        this.backendDefinitions = new Map(
            this.store.definitions
                .filter(entry => entry.definition['x-targets']?.includes('backend'))
                .map(entry => [entry.key, entry.definition])
        );
        this.sensitiveKeys = new Set(
            this.store.definitions
                .filter(entry => entry.definition['x-sensitive'])
                .map(entry => entry.key)
        );
        this.preferenceService.onPreferenceChanged((event: PreferenceChange) => this.onPreferenceChanged(event));
    }

    async initialize(): Promise<void> {
        this.scheduleInitialization();
    }

    onStart(): void {
        this.apiClient.setBaseUrl(String(this.preferenceService.get('geoApp.backend.apiBaseUrl', 'http://localhost:8000')));
        this.scheduleInitialization();
    }

    /** Délais de retry quand le backend n'est pas encore joignable (~2 min au total). */
    private static readonly BACKEND_RETRY_DELAYS_MS = [2000, 4000, 8000, 16000, 30000, 30000, 30000];

    private async doInitialize(): Promise<void> {
        for (const delayMs of [0, ...PreferenceSyncService.BACKEND_RETRY_DELAYS_MS]) {
            if (delayMs > 0) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
            this.apiClient.setBaseUrl(String(this.preferenceService.get('geoApp.backend.apiBaseUrl', 'http://localhost:8000')));

            // Les écritures faites backend arrêté sont rejouées AVANT le pull : Theia
            // est la source de vérité, Flask ne l'emporte que sur les valeurs qu'il a
            // réellement stockées et qui ne sont pas en attente d'envoi.
            const pendingKeys = new Set(Object.keys(this.loadPendingSync()));
            const flushOutcome = await this.flushPendingSync();
            if (flushOutcome === 'unreachable') {
                console.warn(`[GeoPreferences] Backend injoignable, nouvel essai dans ${Math.max(delayMs, 2000) / 1000}s...`);
                continue;
            }

            const outcome = await this.pullFromBackend(pendingKeys);
            if (outcome !== 'unreachable') {
                return;
            }
            console.warn(`[GeoPreferences] Backend injoignable, nouvel essai dans ${Math.max(delayMs, 2000) / 1000}s...`);
        }
        console.warn('[GeoPreferences] Backend toujours injoignable, abandon du pull initial des préférences.');
    }

    private scheduleInitialization(): void {
        if (this.initializationScheduled || this.initializationTask) {
            return;
        }

        this.initializationScheduled = true;
        this.scheduleBackgroundTask(() => {
            this.initializationScheduled = false;
            if (this.initializationTask) {
                return;
            }
            this.initializationTask = this.doInitialize().catch(error => {
                console.error('[GeoPreferences] Could not initialize backend preference sync', error);
            });
        });
    }

    private scheduleBackgroundTask(task: () => void): void {
        if (typeof window !== 'undefined' && typeof (window as Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => void }).requestIdleCallback === 'function') {
            (window as Window & { requestIdleCallback: (callback: () => void, options?: { timeout: number }) => void })
                .requestIdleCallback(() => task(), { timeout: 2000 });
            return;
        }

        setTimeout(task, 0);
    }

    /**
     * Rejoue vers Flask les écritures en attente : un seul PATCH pour les `set`
     * (les valeurs sont relues au moment de l'envoi — la dernière écriture gagne),
     * puis un DELETE par `reset`. En cas d'échec, toute la file est conservée :
     * les envois sont idempotents.
     */
    private async flushPendingSync(): Promise<'ok' | 'unreachable' | 'error'> {
        const pending = this.loadPendingSync();
        const keys = Object.keys(pending);
        if (keys.length === 0) {
            return 'ok';
        }

        const sets: Record<string, unknown> = {};
        const resets: string[] = [];
        for (const key of keys) {
            if (pending[key] === 'reset') {
                resets.push(key);
            } else {
                sets[key] = this.getCurrentValue(key);
            }
        }

        try {
            if (Object.keys(sets).length > 0) {
                await this.apiClient.updateBulk(sets);
            }
            for (const key of resets) {
                await this.apiClient.reset(key);
            }
            this.savePendingSync({});
            console.info(`[GeoPreferences] ${keys.length} préférence(s) en attente synchronisée(s) vers le backend.`);
            return 'ok';
        } catch (error) {
            if (this.isBackendUnreachable(error)) {
                return 'unreachable';
            }
            console.error('[GeoPreferences] Could not flush pending preference changes', error);
            return 'error';
        }
    }

    private async pullFromBackend(excludedKeys: Set<string>): Promise<'ok' | 'unreachable' | 'error'> {
        let preferences: Record<string, unknown>;
        let storedKeys: Set<string>;
        try {
            const response = await this.apiClient.fetchAll();
            preferences = response.preferences ?? {};
            // Backend plus ancien sans `storedKeys` : repli sur l'ensemble des clés listées.
            storedKeys = new Set(response.storedKeys ?? Object.keys(preferences));
        } catch (error) {
            if (this.isBackendUnreachable(error)) {
                return 'unreachable';
            }
            console.error('[GeoPreferences] Could not fetch backend preferences', error);
            return 'error';
        }
        try {
            this.applyingRemote = true;
            for (const [key, value] of Object.entries(preferences)) {
                if (!key.startsWith('geoApp.')) {
                    continue;
                }
                if (!this.backendDefinitions.has(key)) {
                    continue;
                }
                // Les clés sensibles sont masquées côté backend : les appliquer
                // écraserait le secret local par `null`. Theia les pousse, ne les lit jamais.
                if (this.sensitiveKeys.has(key)) {
                    continue;
                }
                // Les clés qui venaient d'être rejouées vers Flask ne sont pas ré-appliquées.
                if (excludedKeys.has(key)) {
                    continue;
                }
                // Une clé jamais stockée par Flask ne renvoie que son défaut de schéma :
                // elle ne doit pas écraser une valeur locale saisie dans settings.json.
                if (!storedKeys.has(key)) {
                    continue;
                }
                if (this.areValuesEqual(this.getCurrentValue(key), value)) {
                    continue;
                }
                try {
                    await this.withTimeout(
                        this.preferenceService.set(key, value, PreferenceScope.User),
                        PreferenceSyncService.PREFERENCE_SET_TIMEOUT_MS,
                        `Applying remote preference ${key}`
                    );
                } catch (error) {
                    console.error(`[GeoPreferences] Failed to apply ${key}`, error);
                }
            }
        } catch (error) {
            console.error('[GeoPreferences] Could not apply backend preferences', error);
            return 'error';
        } finally {
            this.applyingRemote = false;
            this.apiClient.setBaseUrl(String(this.preferenceService.get('geoApp.backend.apiBaseUrl', 'http://localhost:8000')));
        }
        return 'ok';
    }

    /** Erreur réseau axios (pas de réponse HTTP) : le backend n'est pas joignable. */
    private isBackendUnreachable(error: unknown): boolean {
        return !!error && typeof error === 'object'
            && (error as { isAxiosError?: boolean }).isAxiosError === true
            && (error as { response?: unknown }).response === undefined;
    }

    private async onPreferenceChanged(event: PreferenceChange): Promise<void> {
        if (!event.preferenceName?.startsWith('geoApp.')) {
            return;
        }

        if (this.applyingRemote) {
            return;
        }

        const key = event.preferenceName;
        if (key === 'geoApp.backend.apiBaseUrl') {
            this.apiClient.setBaseUrl(String(this.getCurrentValue(key) || 'http://localhost:8000'));
            return;
        }

        if (!this.backendDefinitions.has(key)) {
            return;
        }

        // `set(key, undefined)` retire la clé du scope utilisateur : l'intention est alors
        // un `reset` (DELETE côté Flask), pas un `set` de la valeur par défaut.
        const intent: PendingSyncIntent = this.preferenceService.inspect(key)?.globalValue !== undefined ? 'set' : 'reset';

        try {
            if (intent === 'set') {
                await this.apiClient.update(key, this.getCurrentValue(key));
            } else {
                await this.apiClient.reset(key);
            }
            this.dequeuePendingSync(key);
        } catch (error) {
            console.error(`[GeoPreferences] Failed to synchronize ${key}`, error);
            if (this.isBackendUnreachable(error)) {
                this.enqueuePendingSync(key, intent);
            }
            this.notifySyncError(key, error);
        }
    }

    private notifySyncError(preferenceName: string, error: unknown): void {
        const now = Date.now();
        if (now - this.lastSyncErrorAt < 5000) {
            return;
        }
        this.lastSyncErrorAt = now;

        const label = this.store.getDefinition(preferenceName)?.['x-ui']?.label ?? preferenceName;
        const backendMessage = (error as { response?: { status?: number; data?: { message?: string } } })?.response?.data?.message;
        if (backendMessage) {
            this.messageService.error(`Valeur refusée par le backend pour « ${label} » : ${backendMessage}`);
            return;
        }
        this.messageService.error(
            `Impossible d'enregistrer la préférence « ${label} » côté backend Flask. `
            + 'La valeur reste appliquée localement et sera envoyée au backend dès qu\'il sera joignable.'
        );
    }

    // ── File d'attente des écritures échouées (persistée en localStorage) ──────

    private loadPendingSync(): PendingSyncMap {
        try {
            if (typeof window === 'undefined' || !window.localStorage) {
                return {};
            }
            const raw = window.localStorage.getItem(PreferenceSyncService.PENDING_SYNC_STORAGE_KEY);
            if (!raw) {
                return {};
            }
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            if (!parsed || typeof parsed !== 'object') {
                return {};
            }
            const result: PendingSyncMap = {};
            for (const [key, intent] of Object.entries(parsed)) {
                if (intent === 'set' || intent === 'reset') {
                    result[key] = intent;
                }
            }
            return result;
        } catch {
            return {};
        }
    }

    private savePendingSync(pending: PendingSyncMap): void {
        try {
            if (typeof window === 'undefined' || !window.localStorage) {
                return;
            }
            if (Object.keys(pending).length === 0) {
                window.localStorage.removeItem(PreferenceSyncService.PENDING_SYNC_STORAGE_KEY);
            } else {
                window.localStorage.setItem(PreferenceSyncService.PENDING_SYNC_STORAGE_KEY, JSON.stringify(pending));
            }
        } catch {
            // localStorage indisponible ou plein : la file reste seulement en mémoire.
        }
    }

    private enqueuePendingSync(key: string, intent: PendingSyncIntent): void {
        const pending = this.loadPendingSync();
        pending[key] = intent;
        this.savePendingSync(pending);
    }

    private dequeuePendingSync(key: string): void {
        const pending = this.loadPendingSync();
        if (key in pending) {
            delete pending[key];
            this.savePendingSync(pending);
        }
    }

    private getCurrentValue(preferenceName: string): unknown {
        const definition = this.store.getDefinition(preferenceName);
        const defaultValue = definition && 'default' in definition ? definition.default : undefined;
        return this.preferenceService.get(preferenceName, defaultValue);
    }

    private areValuesEqual(left: unknown, right: unknown): boolean {
        if (left === right) {
            return true;
        }
        if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) {
            return false;
        }
        try {
            return JSON.stringify(left) === JSON.stringify(right);
        } catch {
            return false;
        }
    }

    private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, description: string): Promise<T> {
        let timer: number | undefined;
        try {
            return await Promise.race([
                promise,
                new Promise<never>((_, reject) => {
                    timer = window.setTimeout(() => {
                        reject(new Error(`${description} exceeded ${timeoutMs} ms`));
                    }, timeoutMs);
                })
            ]);
        } finally {
            if (timer !== undefined) {
                window.clearTimeout(timer);
            }
        }
    }
}
