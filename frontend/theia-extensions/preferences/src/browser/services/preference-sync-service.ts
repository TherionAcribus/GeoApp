import { injectable, inject } from '@theia/core/shared/inversify';
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

    constructor(
        @inject(PreferenceService) private readonly preferenceService: PreferenceService,
        @inject(GeoPreferenceStore) private readonly store: GeoPreferenceStore,
        @inject(PreferencesApiClient) private readonly apiClient: PreferencesApiClient
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

    private async doInitialize(): Promise<void> {
        this.apiClient.setBaseUrl(String(this.preferenceService.get('geoApp.backend.apiBaseUrl', 'http://localhost:8000')));
        await this.pullFromBackend();
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

    private async pullFromBackend(): Promise<void> {
        try {
            const preferences = await this.apiClient.fetchAll();
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
            console.error('[GeoPreferences] Could not fetch backend preferences', error);
        } finally {
            this.applyingRemote = false;
            this.apiClient.setBaseUrl(String(this.preferenceService.get('geoApp.backend.apiBaseUrl', 'http://localhost:8000')));
        }
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
        }
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
