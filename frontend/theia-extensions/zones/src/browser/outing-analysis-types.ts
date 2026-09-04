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

/**
 * Libellé de « zone » du log-editor, qui n'en a pas.
 *
 * Là-bas, la sortie n'est pas une zone mais la liste des caches à loguer. Ce libellé
 * devient la clé d'identité de la sortie — titre de session **et** clé de capture du plan
 * — donc les deux endroits doivent lire la même chaîne : écrite en dur dans le widget,
 * elle se serait désaccordée à la première reformulation.
 */
export const OUTING_LOG_EDITOR_ZONE_NAME = 'sortie du jour';

export const OUTING_DETAIL_LEVEL_PREF = 'geoApp.outing.analysis.detailLevel';
export const OUTING_RECENT_LOGS_PREF = 'geoApp.outing.analysis.recentLogsCount';
export const OUTING_GEAR_LOGS_PREF = 'geoApp.outing.analysis.gearLogsCount';
export const OUTING_WARN_ABOVE_PREF = 'geoApp.outing.analysis.warnAboveCount';
export const OUTING_ADAPTIVE_BUDGET_PREF = 'geoApp.outing.analysis.adaptiveBudget';
export const OUTING_MAX_PROMPT_TOKENS_PREF = 'geoApp.outing.analysis.maxPromptTokens';
export const OUTING_REFRESH_LOGS_COUNT_PREF = 'geoApp.outing.analysis.refreshLogsCount';

/** Niveau de détail demandé : pilote la troncature du listing et le nombre de logs. */
export type OutingDetailLevel = 'light' | 'standard' | 'full';

export const OUTING_DETAIL_LEVELS: OutingDetailLevel[] = ['light', 'standard', 'full'];

export type OutingHealthLevel = 'ok' | 'watch' | 'risky' | 'very_risky' | 'unknown';

/**
 * Un signal déduit des attributs.
 *
 * `resolved: false` est le cas intéressant : l'attribut a levé un drapeau (« outil
 * spécial requis ») sans dire lequel. C'est à l'IA de le résoudre depuis le texte —
 * sauf si le backend l'a déjà fait en balayant le listing ou le hint, auquel cas
 * `resolved` repasse à `true` et `resolved_from` dit d'où vient la réponse.
 */
export interface OutingGearSignal {
    signal: string;
    kind: 'gear' | 'context';
    resolved: boolean;
    /** D'où vient la résolution : l'attribut lui-même, le waypoint, le listing, le hint. */
    resolved_from?: 'attribute' | 'waypoint' | 'listing' | 'hint' | null;
    /** Clés du lexique matériel qui ont refermé le drapeau (`resolved_from` textuel). */
    resolved_gear?: string[];
    label: string;
    slug: string;
    source: string;
    is_negative: boolean;
    /**
     * Slugs d'attributs que ce signal rend déjà, le sien compris.
     *
     * Sert au prompt à ne pas payer deux fois : un attribut couvert n'apparaît plus dans
     * la ligne « Attributs ». Absent d'un backend antérieur.
     */
    covers?: string[];
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

/**
 * Estimation de temps d'une géocache, calculée par heuristique côté backend.
 *
 * **Temps sur place uniquement** : voiture garée à retour à la voiture. Le trajet est
 * compté une seule fois pour la sortie, dans `OutingTimeBudget`.
 *
 * `components` porte le détail du calcul : c'est lui qui rend le chiffre discutable
 * plutôt qu'à prendre ou à laisser. `confidence_reasons` dit pourquoi la fourchette
 * s'élargit — drapeau non résolu, énigme sur place, aucun log local.
 */
export interface OutingTimeEstimate {
    minutes: number;
    low_minutes: number;
    high_minutes: number;
    confidence: 'high' | 'medium' | 'low';
    confidence_reasons: string[];
    type_key: string;
    components: Array<{ label: string; minutes: number }>;
    /** Traditionnelle ramenée au plafond « park & grab ». */
    capped_park_and_grab: boolean;
}

/**
 * Temps de déplacement de la sortie, déduit de l'ordre de visite.
 *
 * Seul endroit du projet où une distance à vol d'oiseau devient une durée : les facteurs
 * de détour et les vitesses retenues sont donnés dans `assumptions` pour que le rapport
 * les cite au lieu de les subir.
 */
export interface OutingTravelEstimate {
    legs_count: number;
    crow_flies_km: number;
    road_km_estimated: number;
    walking_km_estimated: number;
    driving_stops: number;
    driving_minutes: number;
    walking_minutes: number;
    minutes: number;
    assumptions: {
        driving_speed_kmh: number;
        walking_speed_kmh: number;
        road_detour_factor: number;
        walk_detour_factor: number;
        stop_overhead_minutes: number;
        walking_threshold_km: number;
    };
}

/**
 * Budget temps de la sortie entière.
 *
 * `already_found_minutes` et `unsolved_mystery_minutes` sont **offerts, pas retranchés** :
 * refaire une multi avec quelqu'un est légitime, et une mystery peut être résolue le soir
 * même. C'est au lecteur de décider ce qu'il retire.
 */
export interface OutingTimeBudget {
    /** Version de l'heuristique : deux analyses du même lot doivent pouvoir se comparer. */
    method: string;
    geocaches_count: number;
    on_site_minutes: number;
    on_site_low_minutes: number;
    on_site_high_minutes: number;
    travel: OutingTravelEstimate | null;
    includes_travel: boolean;
    total_minutes: number;
    total_low_minutes: number;
    total_high_minutes: number;
    already_found_minutes: number;
    unsolved_mystery_minutes: number;
    heaviest: Array<{ gc_code: string; name: string | null; minutes: number }>;
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
    /** Coordonnées décimales, celles sur lesquelles travaille le bloc `geography`. */
    latitude: number | null;
    longitude: number | null;
    is_corrected: boolean;
    solved: string | null;
    /** Mystery sans coordonnées finales : se déplacer ne sert à rien en l'état. */
    unsolved_mystery: boolean;
    /**
     * Multi, letterbox ou wherigo dont le final n'est pas connu ici.
     *
     * Distinct de `unsolved_mystery` : les coordonnées publiées sont un départ valable,
     * la sortie peut donc s'y rendre — mais elle ne peut pas prévoir où elle finit.
     * Absent d'un backend antérieur au lot 19.
     */
    final_unknown?: boolean;
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
    /**
     * Matériel nommé dans le listing **complet**, repéré côté backend.
     *
     * Survit à la troncature de l'extrait comme à sa suppression : en mode léger, c'est
     * la seule trace du listing, et elle ne coûte rien.
     */
    gear_mentions_in_listing: string[];
    /** Matériel nommé dans le hint décodé. */
    gear_mentions_in_hint: string[];
    /**
     * Attributs bruts. `covered_by_signal` marque ceux qu'un signal dit déjà — le prompt
     * ne rend que les autres. Les deux derniers champs sont absents d'un backend antérieur.
     */
    attributes: Array<{
        label: string;
        is_negative: boolean;
        slug?: string | null;
        covered_by_signal?: boolean;
    }>;
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
    /** Temps sur place estimé par GeoApp. Absent d'un backend antérieur au lot 9. */
    time_estimate?: OutingTimeEstimate;
}

/** Une étape de l'ordre de visite indicatif. Les distances sont à vol d'oiseau. */
export interface OutingRouteLeg {
    position: number;
    gc_code: string;
    name: string | null;
    /** Distance depuis l'étape précédente ; 0 pour la première. */
    leg_km: number;
    cumulative_km: number;
}

export interface OutingRoute {
    /** Nom de l'heuristique, pour que le rapport présente l'ordre comme indicatif. */
    strategy: string;
    total_km: number;
    longest_leg_km: number;
    legs: OutingRouteLeg[];
}

/** Caches assez proches pour s'enchaîner à pied depuis un même stationnement. */
export interface OutingWalkingCluster {
    gc_codes: string[];
    count: number;
    span_km: number;
}

/**
 * Éphémérides solaires au centroïde de la sortie, à la date retenue.
 *
 * Les heures locales sont celles du poste de l'utilisateur. `polar_state` n'est renseigné
 * qu'au-delà des cercles polaires, où l'absence d'heure de coucher est un fait et non une
 * donnée manquante.
 */
export interface OutingSunTimes {
    date: string;
    latitude: number;
    longitude: number;
    sunrise_utc: string | null;
    sunset_utc: string | null;
    civil_dawn_utc: string | null;
    civil_dusk_utc: string | null;
    solar_noon_utc: string;
    sunrise_local: string | null;
    sunset_local: string | null;
    civil_dawn_local: string | null;
    civil_dusk_local: string | null;
    day_length_minutes: number | null;
    utc_offset: string;
    timezone_label: string | null;
    polar_state: 'polar_day' | 'polar_night' | null;
}

export type OutingGeographyExclusionReason = 'no_coordinates' | 'unsolved_mystery';

/**
 * Géographie du lot : étendue, ordre de visite, groupes de marche, lumière du jour.
 *
 * Tout y est calculé à vol d'oiseau (`crow_flies`), sans réseau routier ni dénivelé : les
 * distances sont des planchers, jamais des durées. Une mystery non résolue est écartée du
 * calcul comme une cache sans coordonnées — ses coordonnées publiées sont un leurre.
 */
export interface OutingGeography {
    points_count: number;
    excluded: Array<{ gc_code: string; reason: OutingGeographyExclusionReason }>;
    crow_flies: boolean;
    centroid: { latitude: number; longitude: number } | null;
    bounding_box: {
        north: number; south: number; east: number; west: number;
        width_km: number; height_km: number; diagonal_km: number;
    } | null;
    max_pair_distance_km: number | null;
    route: OutingRoute | null;
    walking_clusters: OutingWalkingCluster[];
    sun: OutingSunTimes | null;
}

export interface OutingAnalysisStats {
    by_type: Record<string, number>;
    by_health_level: Record<string, number>;
    unsolved_mysteries: number;
    /** Multi / letterbox / wherigo sans final connu. Absent d'un backend antérieur. */
    unknown_finals?: number;
    unresolved_gear_signals: number;
    /** Drapeaux refermés par le balayage du listing ou du hint, sans intervention de l'IA. */
    presolved_gear_signals: number;
    already_found: number;
    stale_logs: number;
    logging_tasks: number;
    /** Somme des temps sur place, trajet exclu : le trajet vit dans `time_budget`. */
    on_site_minutes?: number;
}

export interface OutingAnalysisBundle {
    generated_at: string;
    /** Date retenue pour la sortie : celle demandée, ou le jour même. Pilote le calcul solaire. */
    outing_date: string;
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
    /** Toujours présent, même sans point exploitable : les exclusions sont une information. */
    geography: OutingGeography;
    /** Budget temps de la sortie. Absent d'un backend antérieur au lot 9. */
    time_budget?: OutingTimeBudget;
    stats: OutingAnalysisStats;
}

export interface OutingAnalysisOptions {
    listingChars?: number;
    recentLogsCount?: number;
    gearLogsCount?: number;
    /** Date de la sortie au format `AAAA-MM-JJ` : elle décide de l'heure du coucher du soleil. */
    outingDate?: string;
}


// ─────────────────────────────────────────────────────────────────────────────
// Budget adaptatif
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Palier de détail appliqué à **une** géocache.
 *
 * Le niveau global (`light` / `standard` / `full`) décidait jusqu'ici du volume de la même
 * façon pour toute la sélection : soit on payait un listing pour les quarante caches, soit
 * on n'en avait pour aucune. Or l'information n'est pas répartie uniformément — une
 * traditionnelle saine à D1/T1 n'a rien à dire que ses attributs ne disent déjà, tandis
 * qu'une T5 avec un drapeau « outil spécial » NON RÉSOLU ne se prépare pas sans son texte.
 *
 * D'où deux paliers, décidés cache par cache :
 *
 * - `rich` : la cache pose une question (drapeau ouvert, santé dégradée, étapes, questions
 *   sur place). On paie son listing et ses logs.
 * - `lean` : rien à signaler. Attributs, hint, matériel repéré par balayage — pas de
 *   listing. Le balayage lexical du lot 7 est justement ce qui rend ce palier acceptable :
 *   le matériel nommé dans le listing complet remonte de toute façon.
 */
export type OutingCacheTier = 'rich' | 'lean';

export const OUTING_CACHE_TIERS: OutingCacheTier[] = ['rich', 'lean'];

/** Ce que le niveau global décide désormais : la générosité de chacun des deux paliers. */
export interface OutingTierPreset {
    listingChars: Record<OutingCacheTier, number>;
    recentLogs: Record<OutingCacheTier, number>;
    gearLogs: Record<OutingCacheTier, number>;
}

/**
 * Réglages par palier et par niveau de détail.
 *
 * Le niveau ne dit plus « listing ou pas », il dit **combien on paie pour une cache qui le
 * mérite**. En `light`, seules les caches signalées ont un listing, et court. En `full`,
 * même les caches saines en reçoivent un extrait, parce que l'utilisateur a explicitement
 * demandé à ne rien rater.
 */
export const OUTING_TIER_PRESETS: Record<OutingDetailLevel, OutingTierPreset> = {
    light: {
        listingChars: { rich: 1200, lean: 0 },
        recentLogs: { rich: 3, lean: 2 },
        gearLogs: { rich: 6, lean: 3 },
    },
    standard: {
        listingChars: { rich: 2500, lean: 0 },
        recentLogs: { rich: 5, lean: 3 },
        gearLogs: { rich: 8, lean: 4 },
    },
    full: {
        listingChars: { rich: 4000, lean: 800 },
        recentLogs: { rich: 10, lean: 5 },
        gearLogs: { rich: 12, lean: 6 },
    },
};

/**
 * Plan de rédaction du prompt : qui reçoit quoi.
 *
 * Séparé du niveau de détail parce qu'il en est le **résultat**, pas la cause : il sort de
 * la décision par cache, puis des rétrogradations qu'impose le plafond de tokens. Le
 * constructeur de prompt ne connaît que lui.
 */
export interface OutingPromptPlan {
    /** Palier retenu, par code GC. Une cache absente est traitée comme `rich`. */
    tiers: Record<string, OutingCacheTier>;
    listingChars: Record<OutingCacheTier, number>;
    recentLogs: Record<OutingCacheTier, number>;
    gearLogs: Record<OutingCacheTier, number>;
    /** Étapes de rétrogradation appliquées, dans l'ordre. Vide quand le plafond tenait. */
    degraded: string[];
    /** Faux quand la stratégie mixte est désactivée : tout le lot est traité pareil. */
    adaptive: boolean;
}

/**
 * Plafond dur, en tokens estimés, prompt système compris.
 *
 * 30 000 laisse largement la place au rapport et à quelques questions de suivi dans une
 * fenêtre de 128 k, tout en coupant court aux sélections de soixante caches en mode
 * complet — là où le prompt devient plus cher que ce qu'il apporte.
 */
export const OUTING_DEFAULT_MAX_PROMPT_TOKENS = 30000;

/**
 * État de fraîcheur des logs locaux, renvoyé par `POST /api/geocaches/analysis-logs-status`.
 *
 * Le contrat est celui de `backend/gc_backend/services/outing_logs_status.py`. Il ne dit
 * rien du contenu des logs : uniquement combien il y en a et de quand date leur collecte,
 * ce qui suffit à décider s'il faut rafraîchir avant d'analyser.
 */
export type OutingLogsFreshness = 'none' | 'stale' | 'fresh';

export interface OutingLogsStatusEntry {
    id: number;
    gc_code: string;
    name: string | null;
    local_logs_count: number;
    logs_fetched_at: string | null;
    days_since_logs_fetched: number | null;
    status: OutingLogsFreshness;
}

export interface OutingLogsStatus {
    generated_at: string;
    /** Seuil de péremption côté serveur, en jours. Repris tel quel dans les libellés. */
    stale_after_days: number;
    requested_count: number;
    geocaches: OutingLogsStatusEntry[];
    missing: number[];
    without_local_logs: OutingLogsStatusEntry[];
    stale_logs: OutingLogsStatusEntry[];
}
