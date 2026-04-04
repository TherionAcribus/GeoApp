import { injectable, inject } from '@theia/core/shared/inversify';
import { PreferenceService, PreferenceChange } from '@theia/core/lib/common/preferences/preference-service';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';

import { GeoPreferenceStore } from '../geo-preference-store';
import { PreferencesApiClient } from './preferences-api-client';
import { GeoPreferenceDefinition } from '../geo-preferences-schema';

@injectable()
export class PreferenceSyncService implements FrontendApplicationContribution {

    private applyingRemote = false;
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
        this.apiClient.setBaseUrl(String(this.preferenceService.get('geoApp.backend.apiBaseUrl', 'http://localhost:8000')));
        await this.pullFromBackend();
    }

    async onStart(): Promise<void> {
        await this.initialize();
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
                await this.preferenceService.set(key, value, PreferenceScope.User);
            }
        } catch (error) {
            console.error('[GeoPreferences] Impossible de récupérer les préférences backend', error);
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

        // IMPORTANT: éviter de pousser des valeurs "undefined" vers le backend.
        // Cela arrive lors de certaines réconciliations de préférences (ex: reset, scope changes)
        // et le backend valide strictement les types -> 400 en rafale.
        if (event.newValue === undefined || event.newValue === null) {
            return;
        }

        if (event.preferenceName === 'geoApp.backend.apiBaseUrl') {
            this.apiClient.setBaseUrl(String(event.newValue || 'http://localhost:8000'));
            return;
        }

        if (!this.backendDefinitions.has(event.preferenceName)) {
            return;
        }

        try {
            await this.apiClient.update(event.preferenceName, event.newValue);
        } catch (error) {
            console.error(`[GeoPreferences] Erreur lors de la synchronisation de ${event.preferenceName}`, error);
        }
    }
}

