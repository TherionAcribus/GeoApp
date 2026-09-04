/**
 * Types du bundle d'analyse de sortie, renvoyé par `POST /api/geocaches/analysis-bundle`.
 *
 * Fichier séparé du service et du constructeur de prompt : la table des géocaches, les
 * widgets et le contrôleur en ont tous besoin, et aucun ne doit dépendre des autres.
 *
 * Le contrat est celui de `backend/gc_backend/services/outing_analysis_service.py`.
 */

/**
 * Agent chat dédié à l'analyse de sortie.
 *
 * Déclaré ici plutôt que dans le fichier de l'agent : le contrôleur en a besoin pour
 * épingler la session, et ce module de contrat est le seul que tous les intervenants
 * importent déjà. L'agent du lot 4 reprend cette constante.
 */
export const GEOAPP_OUTING_ANALYZER_AGENT_ID = 'geoapp-outing-analyzer';

/**
 * Plafond de géocaches par analyse, aligné sur `MAX_ANALYSIS_GEOCACHE_IDS` côté backend.
 * Vérifié côté front pour expliquer le refus avant de payer l'aller-retour.
 */
export const MAX_OUTING_ANALYSIS_GEOCACHES = 60;

export const OUTING_DETAIL_LEVEL_PREF = 'geoApp.outing.analysis.detailLevel';
export const OUTING_RECENT_LOGS_PREF = 'geoApp.outing.analysis.recentLogsCount';
export const OUTING_GEAR_LOGS_PREF = 'geoApp.outing.analysis.gearLogsCount';
export const OUTING_WARN_ABOVE_PREF = 'geoApp.outing.analysis.warnAboveCount';

/** Niveau de détail demandé : pilote la troncature du listing et le nombre de logs. */
export type OutingDetailLevel = 'light' | 'standard' | 'full';

export const OUTING_DETAIL_LEVELS: OutingDetailLevel[] = ['light', 'standard', 'full'];

export type OutingHealthLevel = 'ok' | 'watch' | 'risky' | 'very_risky' | 'unknown';

/**
 * Un signal déduit des attributs.
 *
 * `resolved: false` est le cas intéressant : l'attribut a levé un drapeau (« outil
 * spécial requis ») sans dire lequel. C'est à l'IA de le résoudre depuis le texte.
 */
export interface OutingGearSignal {
    signal: string;
    kind: 'gear' | 'context';
    resolved: boolean;
    label: string;
    slug: string;
    source: string;
    is_negative: boolean;
}

export interface OutingHealth {
    level: OutingHealthLevel;
    reasons: string[];
    /** Faux quand la géocache n'a jamais été rafraîchie : sa santé n'est pas évaluable. */
    logs_available: boolean;
    local_logs_count: number;
    last_found_date: string | null;
    days_since_last_found: number | null;
    consecutive_dnf: number;
    dnf_ratio_recent: number | null;
    needs_maintenance_pending: boolean;
    listing_status: string | null;
    /** Date du log le plus récent, tous types confondus. */
    last_log_date: string | null;
    days_since_last_log: number | null;
    /**
     * Date de la dernière écriture locale d'un log : quand on a regardé, et non quand
     * la cache a été visitée. Approximation par le bas de la date de rafraîchissement.
     */
    logs_fetched_at: string | null;
    days_since_logs_fetched: number | null;
    /** Collecte trop ancienne : la santé porte sur un passé arrêté, pas sur aujourd'hui. */
    logs_stale: boolean;
}

export interface OutingLogExcerpt {
    type?: string | null;
    date: string | null;
    author: string | null;
    text_excerpt: string;
    /** Clés du lexique matériel repérées dans ce log (`gear_logs` uniquement). */
    matched?: string[];
    /** Log d'un ami geocaching.com : source identifiée, donc plus fiable. */
    is_friend_log?: boolean;
    /** Log marqué favori par son auteur. */
    is_favorite?: boolean;
}

export interface OutingWaypoint {
    prefix: string | null;
    name: string;
    type: string | null;
    /** Format joueur si disponible, décimal sinon. Un parking sans coordonnées ne sert à rien. */
    coordinates: string | null;
    note_excerpt: string | null;
}

/** Note GeoApp attachée à la géocache : repérage, solution partielle, rappel. */
export interface OutingNote {
    note_type: string | null;
    source: string | null;
    source_plugin: string | null;
    updated_at: string | null;
    content_excerpt: string;
}

/** Question d'EarthCache : la checklist terrain de ce type de cache. */
export interface OutingLoggingTask {
    position: number | null;
    question: string;
    guidance: string | null;
    status: string | null;
    requires_photo: boolean;
    answered: boolean;
}

export interface OutingAnalysisGeocache {
    id: number;
    gc_code: string;
    name: string;
    type: string | null;
    size: string | null;
    owner: string | null;
    difficulty: number | null;
    terrain: number | null;
    status: string | null;
    coordinates: string | null;
    is_corrected: boolean;
    solved: string | null;
    /** Mystery sans coordonnées finales : se déplacer ne sert à rien en l'état. */
    unsolved_mystery: boolean;
    favorites_count: number | null;
    logs_count: number | null;
    placed_at: string | null;
    /** Déjà trouvée : presque toujours une erreur de sélection, parfois volontaire. */
    found: boolean;
    found_date: string | null;
    hint: string | null;
    /** Note personnelle geocaching.com : parking, nombre de personnes, solution partielle. */
    personal_note: string | null;
    personal_note_truncated: boolean;
    notes: OutingNote[];
    notes_count: number;
    listing_excerpt: string;
    listing_truncated: boolean;
    attributes: Array<{ label: string; is_negative: boolean }>;
    gear_signals: OutingGearSignal[];
    waypoints: OutingWaypoint[];
    waypoints_count: number;
    logging_tasks: OutingLoggingTask[];
    logging_tasks_count: number;
    logging_tasks_photo_required: boolean;
    health: OutingHealth;
    recent_logs: OutingLogExcerpt[];
    gear_logs: OutingLogExcerpt[];
    search_effort_logs: OutingLogExcerpt[];
}

export interface OutingAnalysisStats {
    by_type: Record<string, number>;
    by_health_level: Record<string, number>;
    unsolved_mysteries: number;
    unresolved_gear_signals: number;
    already_found: number;
    stale_logs: number;
    logging_tasks: number;
}

export interface OutingAnalysisBundle {
    generated_at: string;
    requested_count: number;
    geocaches: OutingAnalysisGeocache[];
    /** Identifiants demandés mais introuvables : l'appel n'échoue pas pour autant. */
    missing: number[];
    /** Codes GC sans aucun log local : leur santé n'est pas évaluable. */
    without_local_logs: string[];
    /** Codes GC dont les logs locaux datent : leur santé ne dit rien du présent. */
    stale_logs: string[];
    /** Codes GC déjà trouvés, à confirmer ou à retirer de la sélection. */
    already_found: string[];
    stats: OutingAnalysisStats;
}

export interface OutingAnalysisOptions {
    listingChars?: number;
    recentLogsCount?: number;
    gearLogsCount?: number;
}

/** Paramètres de collecte associés à chaque niveau de détail. */
export const OUTING_DETAIL_PRESETS: Record<OutingDetailLevel, Required<OutingAnalysisOptions>> = {
    light: { listingChars: 0, recentLogsCount: 3, gearLogsCount: 6 },
    standard: { listingChars: 1800, recentLogsCount: 5, gearLogsCount: 8 },
    full: { listingChars: 4000, recentLogsCount: 10, gearLogsCount: 12 },
};
