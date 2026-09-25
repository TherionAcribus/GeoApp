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
import {
    OUTING_ADAPTIVE_BUDGET_PREF,
    OUTING_DEFAULT_MAX_PROMPT_TOKENS,
    OUTING_DETAIL_LEVEL_PREF,
    OUTING_DETAIL_LEVELS,
    OUTING_GEAR_LOGS_PREF,
    OUTING_MAX_PROMPT_TOKENS_PREF,
    OUTING_RECENT_LOGS_PREF,
    OUTING_REFRESH_LOGS_COUNT_PREF,
    OUTING_WARN_ABOVE_PREF,
} from './outing-analysis-types';

// Profils modèle et overrides de workflow (choix du modèle selon le type d'énigme).
const MODEL_PROFILE_ENUM = ['local', 'fast', 'strong', 'web'];
const MODEL_WORKFLOW_PROFILE_ENUM = ['default', ...MODEL_PROFILE_ENUM];
// Profils comportementaux (degré d'automatisation).
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
            description: "Nombre d'images conseillé pour les envois Chat IA depuis la galerie GeoApp. Cette valeur pilote la présélection ; l'utilisateur peut dépasser cette limite avec un avertissement.",
        },
        [OUTING_DETAIL_LEVEL_PREF]: {
            type: 'string',
            enum: [...OUTING_DETAIL_LEVELS],
            default: 'standard',
            description: "Analyse IA de sortie : niveau de détail proposé par défaut. 'light' n'envoie pas le listing, 'full' envoie un extrait long et davantage de logs.",
        },
        [OUTING_RECENT_LOGS_PREF]: {
            type: 'number',
            default: 5,
            minimum: 0,
            maximum: 20,
            description: 'Analyse IA de sortie : nombre de logs récents transmis par géocache.',
        },
        [OUTING_GEAR_LOGS_PREF]: {
            type: 'number',
            default: 8,
            minimum: 0,
            maximum: 20,
            description: "Analyse IA de sortie : nombre maximum de logs mentionnant du matériel transmis par géocache. Ces logs sont sélectionnés sur tout l'historique, pas seulement les plus récents.",
        },
        [OUTING_WARN_ABOVE_PREF]: {
            type: 'number',
            default: 25,
            minimum: 1,
            maximum: 60,
            description: 'Analyse IA de sortie : au-delà de ce nombre de géocaches, un avertissement signale le volume envoyé au modèle.',
        },
        [OUTING_ADAPTIVE_BUDGET_PREF]: {
            type: 'boolean',
            default: true,
            description: "Analyse IA de sortie : budget adaptatif. Actif, le listing n'est transmis que pour les caches qui posent une question (drapeau matériel non résolu, santé dégradée, étapes, questions sur place, terrain élevé) ; les caches saines sans particularité se contentent de leurs attributs, de leur hint et du matériel repéré par balayage. Inactif, le niveau de détail s'applique uniformément à toute la sélection.",
        },
        [OUTING_MAX_PROMPT_TOKENS_PREF]: {
            type: 'number',
            default: OUTING_DEFAULT_MAX_PROMPT_TOKENS,
            minimum: 2000,
            maximum: 400000,
            description: "Analyse IA de sortie : plafond dur du prompt, en tokens estimés, prompt système compris. Au-delà, le contenu est réduit automatiquement (listings d'abord, logs ensuite) et la réduction est annoncée au modèle comme à l'utilisateur. Mettre 0 pour désactiver le plafond.",
        },
        [OUTING_REFRESH_LOGS_COUNT_PREF]: {
            type: 'number',
            default: 25,
            minimum: 5,
            maximum: 100,
            description: "Analyse IA de sortie : nombre de logs récupérés par géocache lors du rafraîchissement proposé avant l'analyse. Plus haut donne un historique plus long à la santé calculée, au prix d'une collecte plus lente.",
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
            description: 'Dernier tri utilisé pour la liste des zones.',
        },

        // --- Chat IA : profils modèle ---
        [GEOAPP_CHAT_DEFAULT_PROFILE_PREF]: {
            type: 'string',
            enum: MODEL_PROFILE_ENUM,
            default: 'fast',
            description: 'Profil modèle par défaut du Chat IA GeoApp (choix du modèle assigné via les agents profilés).',
        },
        [GEOAPP_CHAT_SECRET_CODE_PROFILE_PREF]: modelWorkflowProfileProperty(
            'Profil modèle pour les énigmes de type code secret. "default" suit le profil par défaut.'),
        [GEOAPP_CHAT_FORMULA_PROFILE_PREF]: modelWorkflowProfileProperty(
            'Profil modèle pour les énigmes de type formule. "default" suit le profil par défaut.'),
        [GEOAPP_CHAT_CHECKER_PROFILE_PREF]: modelWorkflowProfileProperty(
            'Profil modèle pour les énigmes avec checker. "default" suit le profil par défaut.'),
        [GEOAPP_CHAT_HIDDEN_CONTENT_PROFILE_PREF]: modelWorkflowProfileProperty(
            'Profil modèle pour le contenu caché. "default" suit le profil par défaut.'),
        [GEOAPP_CHAT_IMAGE_PUZZLE_PROFILE_PREF]: modelWorkflowProfileProperty(
            'Profil modèle pour les énigmes image / OCR. "default" suit le profil par défaut.'),

        // --- Chat IA : profils comportementaux (degré d'automatisation) ---
        [GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF]: {
            type: 'string',
            enum: BEHAVIOR_PROFILE_ENUM,
            default: 'guided',
            description: "Profil comportemental par défaut : jusqu'où l'IA peut aller automatiquement (guided, safe, offline, automation, debug).",
        },
        [GEOAPP_CHAT_BEHAVIOR_SECRET_CODE_PROFILE_PREF]: behaviorWorkflowProfileProperty(
            'Override comportemental pour les codes secrets. "default" suit le profil comportemental par défaut.'),
        [GEOAPP_CHAT_BEHAVIOR_FORMULA_PROFILE_PREF]: behaviorWorkflowProfileProperty(
            'Override comportemental pour les formules. "default" suit le profil comportemental par défaut.'),
        [GEOAPP_CHAT_BEHAVIOR_CHECKER_PROFILE_PREF]: behaviorWorkflowProfileProperty(
            'Override comportemental pour les checkers. "default" suit le profil comportemental par défaut.'),
        [GEOAPP_CHAT_BEHAVIOR_HIDDEN_CONTENT_PROFILE_PREF]: behaviorWorkflowProfileProperty(
            'Override comportemental pour le contenu caché. "default" suit le profil comportemental par défaut.'),
        [GEOAPP_CHAT_BEHAVIOR_IMAGE_PUZZLE_PROFILE_PREF]: behaviorWorkflowProfileProperty(
            'Override comportemental pour les énigmes image / OCR. "default" suit le profil comportemental par défaut.'),

        // --- Chat IA : prompt pack et skills ---
        [GEOAPP_CHAT_PROMPT_PACK_PREF]: {
            type: 'string',
            // "auto" (défaut) fait suivre le prompt pack au profil comportemental courant.
            // Ne PAS mettre un profil concret ici : le défaut de schéma l'emporte sur le
            // fallback passé à preferenceService.get et figerait le prompt pack.
            enum: ['auto', ...BEHAVIOR_PROFILE_ENUM],
            default: 'auto',
            description: 'Prompt pack (consignes système) du Chat IA. "auto" fait suivre le prompt pack au profil comportemental.',
        },
        [GEOAPP_CHAT_SKILL_PACK_PREF]: {
            type: 'string',
            enum: ['workflow', 'minimal', 'full', 'disabled'],
            default: 'workflow',
            description: "Pack de skills GeoApp exposées au chat : workflow (selon l'énigme), minimal, full ou disabled.",
        },
        [GEOAPP_CHAT_TOOL_POLICY_OVERRIDES_PREF]: policyOverridesProperty(
            ['default', 'enabled', 'disabled', 'confirm'],
            'Overrides par tool (clé = registryId). Valeurs : default, enabled, disabled, confirm.'),
        [GEOAPP_CHAT_SKILL_POLICY_OVERRIDES_PREF]: policyOverridesProperty(
            ['default', 'enabled', 'disabled'],
            'Overrides par skill (clé = nom de skill). Valeurs : default, enabled, disabled.'),

        // --- Fiche détail géocache ---
        'geoApp.geocache.externalLinks.openMode': {
            type: 'string',
            enum: ['same-group', 'new-group', 'external-window'],
            default: 'same-group',
            description: 'Ouverture des liens externes de la fiche géocache (description, GC.com) : onglet mini-navigateur dans le groupe courant, nouveau groupe, ou fenêtre externe.',
        },
        'geoApp.geocache.details.collapsedSections': {
            type: 'array',
            // 'details' repliée par défaut : une fois que l'utilisateur la
            // déplie, [] est écrit explicitement et son choix persiste.
            default: ['details'],
            items: { type: 'string' },
            description: 'Sections repliées de la fiche détail géocache (details, description, hints, images, waypoints, checkers). Par défaut : details.',
        },

    },
};

export const geoAppPreferenceContribution: PreferenceContribution = {
    schema: geoAppPreferenceSchema,
};
