import { PreferenceSchema } from '@theia/core/lib/common/preferences/preference-schema';
// eslint-disable-next-line import/no-relative-packages
import schemaJson from '../../../../../shared/preferences/geo-preferences-schema.json';

export const geoPreferenceSchema = schemaJson as PreferenceSchema;

export type GeoPreferenceKey = keyof typeof schemaJson.properties;

export type GeoPreferenceDefinition = (typeof schemaJson.properties)[GeoPreferenceKey] & {
    'x-category'?: string;
    'x-targets'?: Array<'frontend' | 'backend'>;
    'x-backendKey'?: string;
    'x-tags'?: string[];
    title?: string;
    enum?: string[] | number[];
    minimum?: number;
    maximum?: number;
};

export const GEO_PREFERENCE_KEYS = Object.keys(schemaJson.properties) as GeoPreferenceKey[];

