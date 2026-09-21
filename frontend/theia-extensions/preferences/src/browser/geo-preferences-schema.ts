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
    'x-sensitive'?: boolean;
    'x-ui'?: {
        group?: string;
        section?: string;
        label?: string;
        shortDescription?: string;
        order?: number;
        advanced?: boolean;
        keywords?: string[];
        enumLabels?: Record<string, string>;
        /**
         * Contrôle dédié à utiliser au lieu du rendu par défaut du type.
         * `string-list` : liste de chaînes libres, éditable ligne à ligne (ajout, suppression,
         * réordonnancement) au lieu de la textarea JSON servie aux `array` sans `items.enum`.
         * `select-from` : liste déroulante dont les options viennent de la valeur courante d'une
         * autre préférence, nommée par `optionsFrom` — pour les choix dont le catalogue n'est pas
         * connu à l'avance et qu'un `enum` statique ne peut donc pas décrire.
         * `lexicon` : éditeur du lexique géocaching, une ligne par terme, dépliable en un
         * formulaire (sens, règle, équivalents). `optionsFrom` y désigne les langues à proposer
         * comme colonnes d'équivalents.
         */
        widget?: 'string-list' | 'select-from' | 'lexicon';
        /**
         * Préférence(s) fournissant les options, avec `widget: 'select-from'` ou `'lexicon'`.
         * Un tableau réunit plusieurs sources ; une préférence scalaire contribue sa propre valeur.
         */
        optionsFrom?: string | string[];
    };
    title?: string;
    enum?: string[] | number[];
    items?: {
        type?: string;
        enum?: string[] | number[];
    };
    uniqueItems?: boolean;
    minimum?: number;
    maximum?: number;
};

export const GEO_PREFERENCE_KEYS = Object.keys(schemaJson.properties) as GeoPreferenceKey[];

