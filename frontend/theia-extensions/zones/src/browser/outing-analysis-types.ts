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
}

export interface OutingLogExcerpt {
    type?: string | null;
    date: string | null;
    author: string | null;
    text_excerpt: string;
    /** Clés du lexique matériel repérées dans ce log (`gear_logs` uniquement). */
    matched?: string[];
}

export interface OutingWaypoint {
    prefix: string | null;
    name: string;
    type: string | null;
    note_excerpt: string | null;
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
    hint: string | null;
    listing_excerpt: string;
    listing_truncated: boolean;
    attributes: Array<{ label: string; is_negative: boolean }>;
    gear_signals: OutingGearSignal[];
    waypoints: OutingWaypoint[];
    waypoints_count: number;
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
}

export interface OutingAnalysisBundle {
    generated_at: string;
    requested_count: number;
    geocaches: OutingAnalysisGeocache[];
    /** Identifiants demandés mais introuvables : l'appel n'échoue pas pour autant. */
    missing: number[];
    /** Codes GC sans aucun log local : leur santé n'est pas évaluable. */
    without_local_logs: string[];
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
