/**
 * Contrat du plan de sortie : la partie structurée du rapport, sortie du chat.
 *
 * Le rapport lui-même reste du Markdown, lu dans la conversation. Ce qui voyage ici est
 * ce qu'une machine peut consommer : une checklist cochable, des alertes classées, et des
 * drapeaux par code GC que les tables affichent en badges.
 *
 * Le miroir côté serveur est `backend/gc_backend/services/outing_plan_schema.py`, qui
 * valide et normalise. Les vocabulaires fermés ci-dessous doivent lui correspondre : un
 * drapeau qu'il ne connaît pas est jeté, un drapeau qu'il connaît et qui manque ici
 * s'afficherait sans libellé.
 */

/**
 * Identité du tool de capture.
 *
 * Déclarée ici plutôt que dans le gestionnaire de tools : le prompt système doit nommer
 * le tool au caractère près, et il ne peut pas importer un module qui tire tout Theia
 * derrière lui. Même motif que `GEOAPP_OUTING_ANALYZER_AGENT_ID` dans les types du bundle.
 */
export const OUTING_SAVE_PLAN_TOOL_ID = 'geoapp.outing.save-plan';
export const OUTING_SAVE_PLAN_TOOL_NAME = 'save_outing_plan';

/** Version du schéma, écrite par le backend. Un plan d'une autre version est ignoré. */
export const OUTING_PLAN_VERSION = 1;

export type OutingPlanCertainty = 'confirmed' | 'probable' | 'precaution';

export type OutingPlanSeverity = 'blocking' | 'warning' | 'info';

export type OutingPlanAlertKind =
    'unsolved_mystery'
    | 'already_found'
    | 'health'
    | 'gear'
    | 'access'
    | 'schedule'
    | 'risk'
    | 'data'
    | 'other';

export type OutingPlanCacheFlag =
    'blocking'
    | 'gear_required'
    | 'unresolved_gear'
    | 'risky_health'
    | 'time_sink'
    | 'time_window'
    | 'access'
    | 'stale_data';

export interface OutingPlanChecklistItem {
    /** Clé stable, dérivée du libellé : c'est elle qui porte l'état coché. */
    key: string;
    item: string;
    certainty: OutingPlanCertainty;
    gc_codes: string[];
    reason: string;
}

export interface OutingPlanAlert {
    gc_code: string | null;
    severity: OutingPlanSeverity;
    kind: OutingPlanAlertKind;
    message: string;
}

export interface OutingPlanCacheEntry {
    gc_code: string;
    gear: string[];
    flags: OutingPlanCacheFlag[];
    minutes: number | null;
    note: string;
}

export interface OutingPlanTimeBudget {
    on_site_minutes: number | null;
    travel_minutes: number | null;
    total_minutes: number | null;
}

export interface OutingPlanContent {
    version: number;
    summary: string;
    checklist: OutingPlanChecklistItem[];
    alerts: OutingPlanAlert[];
    per_cache: OutingPlanCacheEntry[];
    order: string[];
    time_budget: OutingPlanTimeBudget | null;
    to_verify: string[];
}

/** Un plan tel que stocké : le contenu, son identité et son état de lecture. */
export interface OutingPlanRecord {
    id: number;
    zone_name: string;
    outing_date: string;
    gc_codes: string[];
    plan: OutingPlanContent;
    checked: string[];
    source: 'tool' | 'parsed' | 'manual';
    model_name: string | null;
    created_at: string | null;
    updated_at: string | null;
    /** Absent des listes : le Markdown ne part qu'au détail. */
    markdown?: string;
}

/** Ce que renvoie `/api/outing-plans/flags`, par code GC. */
export interface OutingPlanCacheFlags {
    flags: OutingPlanCacheFlag[];
    gear: string[];
    minutes: number | null;
    plan_id: number;
    outing_date: string;
    zone_name: string;
}

export const OUTING_PLAN_CERTAINTY_LABELS: Record<OutingPlanCertainty, string> = {
    confirmed: 'Confirmé',
    probable: 'Probable',
    precaution: 'Par précaution',
};

export const OUTING_PLAN_SEVERITY_LABELS: Record<OutingPlanSeverity, string> = {
    blocking: 'Bloquant',
    warning: 'Attention',
    info: 'Pour information',
};

export const OUTING_PLAN_ALERT_KIND_LABELS: Record<OutingPlanAlertKind, string> = {
    unsolved_mystery: 'Mystery non résolue',
    already_found: 'Déjà trouvée',
    health: 'Santé',
    gear: 'Matériel',
    access: 'Accès',
    schedule: 'Horaires',
    risk: 'Risque',
    data: 'Données',
    other: 'Autre',
};

/**
 * Badge affiché dans les tables.
 *
 * `short` tient dans une cellule (une ou deux lettres suffisent quand la place manque),
 * `label` sert d'infobulle. Les couleurs restent aux feuilles de style : ce module est
 * importé par des tests qui n'ont pas de DOM.
 */
export interface OutingPlanFlagBadge {
    short: string;
    label: string;
    severity: OutingPlanSeverity;
}

export const OUTING_PLAN_FLAG_BADGES: Record<OutingPlanCacheFlag, OutingPlanFlagBadge> = {
    blocking: { short: '⛔', label: 'Bloquant : à lever avant de partir', severity: 'blocking' },
    gear_required: { short: '🎒', label: 'Matériel spécifique requis', severity: 'warning' },
    unresolved_gear: { short: '❓', label: 'Matériel requis, nature non identifiée', severity: 'warning' },
    risky_health: { short: '🩹', label: 'Santé risquée', severity: 'warning' },
    time_sink: { short: '⏳', label: 'Chronophage', severity: 'info' },
    time_window: { short: '🕒', label: 'Contrainte horaire', severity: 'warning' },
    access: { short: '🚧', label: 'Accès, autorisation ou frais', severity: 'warning' },
    stale_data: { short: '📉', label: 'Données peu fiables', severity: 'info' },
};

/** Ordre d'affichage des badges : le plus bloquant d'abord. */
export const OUTING_PLAN_FLAG_ORDER: OutingPlanCacheFlag[] = [
    'blocking',
    'unresolved_gear',
    'gear_required',
    'risky_health',
    'time_window',
    'access',
    'time_sink',
    'stale_data',
];

/**
 * Clé stable d'une ligne de checklist.
 *
 * Doit produire le même résultat que `normalize_key()` côté Python : le front la calcule
 * pour retrouver une ligne dans l'état coché sans attendre le retour du serveur.
 */
export function normalizeChecklistKey(text: string): string {
    // Les marques combinantes sont retirées par plage de points de code plutôt que
    // par une classe de caractères : la classe s'écrirait avec des combinantes nues
    // dans le source, invisibles dans un éditeur et perdues au premier copier-coller.
    const withoutAccents = Array.from((text || '').toLowerCase().normalize('NFD'))
        .filter(char => {
            const code = char.codePointAt(0) ?? 0;
            return code < 0x300 || code > 0x36f;
        })
        .join('');
    return withoutAccents
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

/** Durée lisible : « 1 h 45 », « 40 min ». Rien de rendu quand la valeur manque. */
export function formatOutingMinutes(minutes: number | null | undefined): string {
    if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) {
        return '';
    }
    const hours = Math.floor(minutes / 60);
    const rest = Math.round(minutes % 60);
    if (hours === 0) {
        return `${rest} min`;
    }
    return rest === 0 ? `${hours} h` : `${hours} h ${`${rest}`.padStart(2, '0')}`;
}

/** Badges d'une cache, dans l'ordre d'affichage et sans drapeau inconnu. */
export function badgesForFlags(flags: readonly string[] | undefined): OutingPlanFlagBadge[] {
    if (!flags || flags.length === 0) {
        return [];
    }
    const present = new Set(flags);
    return OUTING_PLAN_FLAG_ORDER
        .filter(flag => present.has(flag))
        .map(flag => OUTING_PLAN_FLAG_BADGES[flag]);
}
