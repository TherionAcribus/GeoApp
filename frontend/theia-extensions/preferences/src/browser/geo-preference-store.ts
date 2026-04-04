import { injectable, inject } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { PreferenceService, PreferenceChange } from '@theia/core/lib/common/preferences/preference-service';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';

import { geoPreferenceSchema, GeoPreferenceDefinition, GeoPreferenceKey, GEO_PREFERENCE_KEYS } from './geo-preferences-schema';

export interface GeoPreferenceChange {
    key: string;
    value: unknown;
}

export type GeoPreferenceSnapshot = Record<string, unknown>;

@injectable()
export class GeoPreferenceStore {

    readonly schema = geoPreferenceSchema;
    private readonly onDidChangeEmitter = new Emitter<GeoPreferenceChange>();

    constructor(
        @inject(PreferenceService) private readonly preferenceService: PreferenceService,
    ) {
        this.preferenceService.onPreferenceChanged(event => this.handlePreferenceChange(event));
    }

    get onDidChange(): Event<GeoPreferenceChange> {
        return this.onDidChangeEmitter.event;
    }

    get definitions(): Array<{ key: GeoPreferenceKey; definition: GeoPreferenceDefinition }> {
        return GEO_PREFERENCE_KEYS.map(key => ({
            key,
            definition: this.schema.properties?.[key] as GeoPreferenceDefinition
        }));
    }

    get definitionsByCategory(): Map<string, Array<{ key: GeoPreferenceKey; definition: GeoPreferenceDefinition }>> {
        const map = new Map<string, Array<{ key: GeoPreferenceKey; definition: GeoPreferenceDefinition }>>();
        this.definitions.forEach(entry => {
            const category = entry.definition['x-category'] || 'generic';
            if (!map.has(category)) {
                map.set(category, []);
            }
            map.get(category)?.push(entry);
        });
        return map;
    }

    getSnapshot(): GeoPreferenceSnapshot {
        const snapshot: GeoPreferenceSnapshot = {};
        this.definitions.forEach(({ key, definition }) => {
            const defaultValue = 'default' in definition ? definition.default : undefined;
            snapshot[key] = this.preferenceService.get(key, defaultValue);
        });
        return snapshot;
    }

    async setValue(key: string, value: unknown, scope: PreferenceScope = PreferenceScope.User): Promise<void> {
        await this.preferenceService.set(key, value, scope);
    }

    private handlePreferenceChange(event: PreferenceChange): void {
        if (!event.preferenceName?.startsWith('geoApp.')) {
            return;
        }
        this.onDidChangeEmitter.fire({
            key: event.preferenceName,
            value: event.newValue
        });
    }
}

