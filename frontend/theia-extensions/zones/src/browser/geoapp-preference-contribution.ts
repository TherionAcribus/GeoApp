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
    },
};

export const geoAppPreferenceContribution: PreferenceContribution = {
    schema: geoAppPreferenceSchema,
};
