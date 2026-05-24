import { PreferenceContribution, PreferenceSchema } from '@theia/core/lib/common/preferences/preference-schema';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';

export const GeoAppPreferenceContribution = Symbol('GeoAppPreferenceContribution');

export const geoAppPreferenceSchema: PreferenceSchema = {
    scope: PreferenceScope.User,
    title: 'GeoApp',
    properties: {
        'geoApp.chat.images.recommendedLimit': {
            type: 'number',
            default: 5,
            minimum: 1,
            maximum: 50,
            description: 'Nombre d images conseille pour les envois Chat IA depuis la galerie GeoApp. Cette valeur pilote la preselection; l utilisateur peut depasser cette limite avec un avertissement.',
        },
        'geoApp.zones.sort': {
            type: 'object',
            default: {
                key: 'name',
                direction: 'asc',
            },
            properties: {
                key: {
                    type: 'string',
                    enum: [
                        'name',
                        'created_at',
                        'geocaches_count',
                        'latest_geocache_created_at',
                        'latest_resolution_updated_at',
                    ],
                },
                direction: {
                    type: 'string',
                    enum: ['asc', 'desc'],
                },
            },
            description: 'Dernier tri utilise pour la liste des zones.',
        },
    },
};

export const geoAppPreferenceContribution: PreferenceContribution = {
    schema: geoAppPreferenceSchema,
};
