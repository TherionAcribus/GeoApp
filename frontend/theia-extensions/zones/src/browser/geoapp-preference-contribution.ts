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
        [OUTING_DETAIL_LEVEL_PREF]: {
            type: 'string',
            enum: [...OUTING_DETAIL_LEVELS],
            default: 'standard',
            description: "Analyse IA de sortie : niveau de detail propose par defaut. 'light' n envoie pas le listing, 'full' envoie un extrait long et davantage de logs.",
        },
        [OUTING_RECENT_LOGS_PREF]: {
            type: 'number',
            default: 5,
            minimum: 0,
            maximum: 20,
            description: 'Analyse IA de sortie : nombre de logs recents transmis par geocache.',
        },
        [OUTING_GEAR_LOGS_PREF]: {
            type: 'number',
            default: 8,
            minimum: 0,
            maximum: 20,
            description: "Analyse IA de sortie : nombre maximum de logs mentionnant du materiel transmis par geocache. Ces logs sont selectionnes sur tout l historique, pas seulement les plus recents.",
        },
        [OUTING_WARN_ABOVE_PREF]: {
            type: 'number',
            default: 25,
            minimum: 1,
            maximum: 60,
            description: 'Analyse IA de sortie : au-dela de ce nombre de geocaches, un avertissement signale le volume envoye au modele.',
        },
        [OUTING_ADAPTIVE_BUDGET_PREF]: {
            type: 'boolean',
            default: true,
            description: "Analyse IA de sortie : budget adaptatif. Actif, le listing n est transmis que pour les caches qui posent une question (drapeau materiel non resolu, sante degradee, etapes, questions sur place, terrain eleve) ; les caches saines sans particularite se contentent de leurs attributs, de leur hint et du materiel repere par balayage. Inactif, le niveau de detail s applique uniformement a toute la selection.",
        },
        [OUTING_MAX_PROMPT_TOKENS_PREF]: {
            type: 'number',
            default: OUTING_DEFAULT_MAX_PROMPT_TOKENS,
            minimum: 2000,
            maximum: 400000,
            description: 'Analyse IA de sortie : plafond dur du prompt, en tokens estimes, prompt systeme compris. Au-dela, le contenu est reduit automatiquement (listings d abord, logs ensuite) et la reduction est annoncee au modele comme a l utilisateur. Mettre 0 pour desactiver le plafond.',
        },
        [OUTING_REFRESH_LOGS_COUNT_PREF]: {
            type: 'number',
            default: 25,
            minimum: 5,
            maximum: 100,
            description: "Analyse IA de sortie : nombre de logs recuperes par geocache lors du rafraichissement propose avant l analyse. Plus haut donne un historique plus long a la sante calculee, au prix d une collecte plus lente.",
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

        // --- Traduction IA ---
        'geoApp.translation.targetLanguage': {
            type: 'string',
            default: 'francais',
            description: 'Langue cible de la traduction IA des geocaches (ex: francais, anglais, espagnol, allemand).',
        },
    },
};

export const geoAppPreferenceContribution: PreferenceContribution = {
    schema: geoAppPreferenceSchema,
};
