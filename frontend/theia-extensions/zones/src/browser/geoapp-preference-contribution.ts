import { PreferenceContribution, PreferenceSchema } from '@theia/core/lib/common/preferences/preference-schema';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';
import {
    GEOAPP_CHAT_DEFAULT_PROFILE_PREF,
    GEOAPP_CHAT_SECRET_CODE_PROFILE_PREF,
    GEOAPP_CHAT_FORMULA_PROFILE_PREF,
    GEOAPP_CHAT_CHECKER_PROFILE_PREF,
    GEOAPP_CHAT_HIDDEN_CONTENT_PROFILE_PREF,
    GEOAPP_CHAT_IMAGE_PUZZLE_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_SECRET_CODE_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_FORMULA_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_CHECKER_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_HIDDEN_CONTENT_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_IMAGE_PUZZLE_PROFILE_PREF,
    GEOAPP_CHAT_PROMPT_PACK_PREF,
    GEOAPP_CHAT_SKILL_PACK_PREF,
    GEOAPP_CHAT_TOOL_POLICY_OVERRIDES_PREF,
    GEOAPP_CHAT_SKILL_POLICY_OVERRIDES_PREF,
} from './geoapp-chat-shared';

// Profils modele et overrides de workflow (choix du modele selon le type d'enigme).
const MODEL_PROFILE_ENUM = ['local', 'fast', 'strong', 'web'];
const MODEL_WORKFLOW_PROFILE_ENUM = ['default', ...MODEL_PROFILE_ENUM];
// Profils comportementaux (degre d'automatisation).
const BEHAVIOR_PROFILE_ENUM = ['guided', 'safe', 'offline', 'automation', 'debug'];
const BEHAVIOR_WORKFLOW_PROFILE_ENUM = ['default', ...BEHAVIOR_PROFILE_ENUM];

function modelWorkflowProfileProperty(description: string): PreferenceSchema['properties'][string] {
    return { type: 'string', enum: MODEL_WORKFLOW_PROFILE_ENUM, default: 'default', description };
}

function behaviorWorkflowProfileProperty(description: string): PreferenceSchema['properties'][string] {
    return { type: 'string', enum: BEHAVIOR_WORKFLOW_PROFILE_ENUM, default: 'default', description };
}

function policyOverridesProperty(overrideEnum: string[], description: string): PreferenceSchema['properties'][string] {
    return {
        type: 'object',
        default: {},
        additionalProperties: { type: 'string', enum: overrideEnum },
        description,
    };
}

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

        // --- Chat IA : profils modele ---
        [GEOAPP_CHAT_DEFAULT_PROFILE_PREF]: {
            type: 'string',
            enum: MODEL_PROFILE_ENUM,
            default: 'fast',
            description: 'Profil modele par defaut du Chat IA GeoApp (choix du modele assigne via les agents profiles).',
        },
        [GEOAPP_CHAT_SECRET_CODE_PROFILE_PREF]: modelWorkflowProfileProperty(
            'Profil modele pour les enigmes de type code secret. "default" suit le profil par defaut.'),
        [GEOAPP_CHAT_FORMULA_PROFILE_PREF]: modelWorkflowProfileProperty(
            'Profil modele pour les enigmes de type formule. "default" suit le profil par defaut.'),
        [GEOAPP_CHAT_CHECKER_PROFILE_PREF]: modelWorkflowProfileProperty(
            'Profil modele pour les enigmes avec checker. "default" suit le profil par defaut.'),
        [GEOAPP_CHAT_HIDDEN_CONTENT_PROFILE_PREF]: modelWorkflowProfileProperty(
            'Profil modele pour le contenu cache. "default" suit le profil par defaut.'),
        [GEOAPP_CHAT_IMAGE_PUZZLE_PROFILE_PREF]: modelWorkflowProfileProperty(
            'Profil modele pour les enigmes image / OCR. "default" suit le profil par defaut.'),

        // --- Chat IA : profils comportementaux (degre d'automatisation) ---
        [GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF]: {
            type: 'string',
            enum: BEHAVIOR_PROFILE_ENUM,
            default: 'guided',
            description: 'Profil comportemental par defaut : jusqu ou l IA peut aller automatiquement (guided, safe, offline, automation, debug).',
        },
        [GEOAPP_CHAT_BEHAVIOR_SECRET_CODE_PROFILE_PREF]: behaviorWorkflowProfileProperty(
            'Override comportemental pour les codes secrets. "default" suit le profil comportemental par defaut.'),
        [GEOAPP_CHAT_BEHAVIOR_FORMULA_PROFILE_PREF]: behaviorWorkflowProfileProperty(
            'Override comportemental pour les formules. "default" suit le profil comportemental par defaut.'),
        [GEOAPP_CHAT_BEHAVIOR_CHECKER_PROFILE_PREF]: behaviorWorkflowProfileProperty(
            'Override comportemental pour les checkers. "default" suit le profil comportemental par defaut.'),
        [GEOAPP_CHAT_BEHAVIOR_HIDDEN_CONTENT_PROFILE_PREF]: behaviorWorkflowProfileProperty(
            'Override comportemental pour le contenu cache. "default" suit le profil comportemental par defaut.'),
        [GEOAPP_CHAT_BEHAVIOR_IMAGE_PUZZLE_PROFILE_PREF]: behaviorWorkflowProfileProperty(
            'Override comportemental pour les enigmes image / OCR. "default" suit le profil comportemental par defaut.'),

        // --- Chat IA : prompt pack et skills ---
        [GEOAPP_CHAT_PROMPT_PACK_PREF]: {
            type: 'string',
            // "auto" (defaut) fait suivre le prompt pack au profil comportemental courant.
            // Ne PAS mettre un profil concret ici : le defaut de schema l emporte sur le
            // fallback passe a preferenceService.get et figerait le prompt pack.
            enum: ['auto', ...BEHAVIOR_PROFILE_ENUM],
            default: 'auto',
            description: 'Prompt pack (consignes systeme) du Chat IA. "auto" fait suivre le prompt pack au profil comportemental.',
        },
        [GEOAPP_CHAT_SKILL_PACK_PREF]: {
            type: 'string',
            enum: ['workflow', 'minimal', 'full', 'disabled'],
            default: 'workflow',
            description: 'Pack de skills GeoApp exposees au chat : workflow (selon l enigme), minimal, full ou disabled.',
        },
        [GEOAPP_CHAT_TOOL_POLICY_OVERRIDES_PREF]: policyOverridesProperty(
            ['default', 'enabled', 'disabled', 'confirm'],
            'Overrides par tool (cle = registryId). Valeurs : default, enabled, disabled, confirm.'),
        [GEOAPP_CHAT_SKILL_POLICY_OVERRIDES_PREF]: policyOverridesProperty(
            ['default', 'enabled', 'disabled'],
            'Overrides par skill (cle = nom de skill). Valeurs : default, enabled, disabled.'),
    },
};

export const geoAppPreferenceContribution: PreferenceContribution = {
    schema: geoAppPreferenceSchema,
};
