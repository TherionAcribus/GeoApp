import { injectable, inject } from '@theia/core/shared/inversify';
import { MessageService } from '@theia/core';
import { PreferenceService, PreferenceChange } from '@theia/core/lib/common/preferences/preference-service';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';

import { GeoPreferenceStore } from '../geo-preference-store';
import { PreferencesApiClient } from './preferences-api-client';
import { GeoPreferenceDefinition } from '../geo-preferences-schema';

@injectable()
export class PreferenceSyncService implements FrontendApplicationContribution {

    private static readonly PREFERENCE_SET_TIMEOUT_MS = 5000;

    private applyingRemote = false;
    private initializationTask: Promise<void> | undefined;
    private initializationScheduled = false;
    private readonly backendDefinitions: Map<string, GeoPreferenceDefinition>;

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
            const outcome = await this.pullFromBackend();
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

    private async pullFromBackend(): Promise<'ok' | 'unreachable' | 'error'> {
        let preferences: Record<string, unknown>;
        try {
            preferences = await this.apiClient.fetchAll();
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

        const currentValue = this.getCurrentValue(event.preferenceName);
        if (currentValue === undefined || currentValue === null) {
            return;
        }

        if (event.preferenceName === 'geoApp.backend.apiBaseUrl') {
            this.apiClient.setBaseUrl(String(currentValue || 'http://localhost:8000'));
            return;
        }

        if (!this.backendDefinitions.has(event.preferenceName)) {
            return;
        }

        try {
            await this.apiClient.update(event.preferenceName, currentValue);
        } catch (error) {
            console.error(`[GeoPreferences] Failed to synchronize ${event.preferenceName}`, error);
            this.notifySyncError(event.preferenceName);
        }
    }

    private notifySyncError(preferenceName: string): void {
        const now = Date.now();
        if (now - this.lastSyncErrorAt < 5000) {
            return;
        }
        this.lastSyncErrorAt = now;
        this.messageService.error(
            `Impossible d'enregistrer la préférence « ${preferenceName} » côté backend Flask. `
            + 'La valeur reste appliquée localement ; vérifiez que le backend est démarré.'
        );
    }

    private getCurrentValue(preferenceName: string): unknown {
        const definition = this.store.schema.properties?.[preferenceName] as GeoPreferenceDefinition | undefined;
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
