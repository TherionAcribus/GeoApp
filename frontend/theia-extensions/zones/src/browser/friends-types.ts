/**
 * Types partagés pour la fonctionnalité Amis.
 *
 * Centralise les réponses de l'API `/api/friends/*` et les structures échangées
 * entre les widgets (`geocaching-friends-widget`, `geocaching-friend-activity-widget`,
 * `zone-geocaches-widget`, `geocache-friend-finds-banner`).
 *
 * La convention de nom suit celle du backend : `success`, `error`, `error_message`
 * sur les réponses, noms `snake_case` pour les champs issus de JSON.
 */

// -------------------------------------------------- Liste d'amis

/** Un ami Geocaching.com, tel que renvoyé par `/api/friends`. */
export interface GeocachingFriend {
    username: string;
    profile_guid: string | null;
    profile_url: string | null;
    avatar_url: string | null;
    is_premium: boolean;
    member_since: string | null;
    last_online: string | null;
    location: string | null;
    finds_count: number | null;
    hides_count: number | null;
}

/** Réponse de `/api/friends`. */
export interface FriendsResponse {
    success: boolean;
    friends?: GeocachingFriend[];
    count?: number;
    reported_count?: number | null;
    pending_requests?: number | null;
    truncated?: boolean;
    fetched_at?: string;
    error?: string;
    error_message?: string;
}

/** Un ami ayant trouvé une géocache donnée (`/api/friends/finds/geocache/:id`). */
export interface FriendFinder {
    username: string;
    profile_url?: string | null;
    avatar_url?: string | null;
    message_url?: string | null;
}

// -------------------------------------------------- Flux d'activité

/** Une entrée du flux d'activité (`/api/friends/activity`). */
export interface FriendActivity {
    id: number;
    log_reference_code: string;
    author_username: string;
    author_avatar_url: string | null;
    is_self: boolean;
    log_type_id: number | null;
    log_date: string | null;
    note: string | null;
    cache_name: string | null;
    cache_reference_code: string | null;
    cache_type_id: number | null;
    difficulty: number | null;
    terrain: number | null;
    favorite_points: number | null;
    image_count: number | null;
    is_premium: boolean;
    is_archived: boolean;
    location_name: string | null;
    is_condensed: boolean;
    condensed_count: number;
    action_url: string | null;
}

/** Réponse paginée de `/api/friends/activity`. */
export interface ActivityResponse {
    success: boolean;
    activities?: FriendActivity[];
    total?: number;
    offset?: number;
    limit?: number;
    authors?: { username: string; count: number }[];
    log_type_labels?: Record<string, string>;
    last_sync_at?: string | null;
    /** Trouvailles regroupées par geocaching.com sans être détaillées. */
    condensed_hidden?: number;
    error?: string;
    error_message?: string;
}

// -------------------------------------------------- Carte des amis

/** Un point de la carte des amis : une cache, un ou plusieurs amis l'ayant loguée. */
export interface FriendMapPoint {
    gc_code: string | null;
    name: string | null;
    cache_type: string | null;
    latitude: number;
    longitude: number;
    difficulty: number | null;
    terrain: number | null;
    /** Id GeoApp si la cache est importée, 0 sinon. */
    geocache_id: number;
    found: boolean;
    friends: { username: string; log_type_id: number | null; log_date: string | null; is_self: boolean }[];
    last_log_date: string | null;
}

/** Réponse de `/api/friends/activity/map`. */
export interface FriendMapResponse {
    success: boolean;
    points?: FriendMapPoint[];
    total?: number;
    returned?: number;
    without_coordinates?: number;
    truncated?: boolean;
    log_type_labels?: Record<string, string>;
    error?: string;
    error_message?: string;
}

/** Un point de la table `friend_find` : trouvaille déduite, sans limite de date. */
export interface FriendFindPoint {
    gc_code: string;
    name: string | null;
    cache_type: string | null;
    latitude: number;
    longitude: number;
    difficulty: number | null;
    terrain: number | null;
    geocache_id: number;
    found: boolean;
    friends: { username: string; source: string }[];
}

/** Réponse de `/api/friends/finds/map`. */
export interface FriendFindsMapResponse {
    success: boolean;
    points?: FriendFindPoint[];
    total?: number;
    without_coordinates?: number;
    /** Nombre de **caches** non plaçables : ce qu'un import aurait à télécharger. */
    importable?: number;
    error?: string;
    error_message?: string;
}

/**
 * Ce que la carte affiche.
 *
 * - `activity` : le flux récent (§ activité), avec les DNF et les notes ;
 * - `finds`    : toutes les trouvailles déduites par zone, sans limite de date ;
 * - `both`     : l'union des deux, fusionnée par code GC.
 */
export type MapSource = 'activity' | 'finds' | 'both';

/** Agrégat par cache, avant rendu en géocache de carte. */
export interface AggregatedPoint {
    gc_code: string | null;
    name: string | null;
    cache_type: string | null;
    latitude: number;
    longitude: number;
    difficulty: number | null;
    terrain: number | null;
    geocache_id: number;
    found: boolean;
    activityFriends: FriendMapPoint['friends'];
    findsFriends: string[];
    lastLogDate: string | null;
}

// -------------------------------------------------- Suggestions

/** Une suggestion de cache à faire, trouvée par des amis mais pas par moi. */
export interface FriendSuggestion {
    gc_code: string;
    name: string;
    cache_type: string | null;
    latitude: number | null;
    longitude: number | null;
    difficulty: number | null;
    terrain: number | null;
    geocache_id: number;
    found: boolean;
    zone_id: number | null;
    status: string | null;
    favorites_count: number;
    friends: string[];
    friends_count: number;
}

/** Réponse de `/api/friends/finds/suggestions`. */
export interface FriendSuggestionsResponse {
    success: boolean;
    suggestions?: FriendSuggestion[];
    count?: number;
    error?: string;
    error_message?: string;
}

// -------------------------------------------------- Statistiques croisées

/** Statistiques d'un ami : trouvailles, activité, caches en commun. */
export interface FriendStat {
    username: string;
    finds_count: number;
    activity_count: number;
    shared_with_me: number;
}

export interface FriendStatsSummary {
    friends_count: number;
    total_distinct_finds: number;
    total_shared_with_me: number;
    most_active_friend: string | null;
}

/** Réponse de `/api/friends/stats`. */
export interface FriendStatsResponse {
    success: boolean;
    friends?: FriendStat[];
    summary?: FriendStatsSummary;
    error?: string;
    error_message?: string;
}

// -------------------------------------------------- Fraîcheur des données

/** État de fraîcheur d'une source de données. */
export interface FreshnessActivity {
    last_sync_at: string | null;
    last_projection_at: string | null;
    logs_stored: number;
    authors_in_feed: number;
    latest_log_date: string | null;
    is_stale: boolean;
}

export interface FreshnessFinds {
    total_rows: number;
    distinct_caches: number;
    distinct_friends: number;
    is_stale: boolean;
}

export interface FreshnessFriendsList {
    fetched_at: string | null;
    count: number;
    reported_count: number | null;
    truncated: boolean;
    pages_fetched: number;
}

export interface FreshnessGeocaches {
    total: number;
    found: number;
    in_friends_zone: number;
}

/** Réponse de `/api/friends/freshness`. */
export interface FreshnessResponse {
    success: boolean;
    checked_at: string;
    activity?: FreshnessActivity;
    finds?: FreshnessFinds;
    friends_list?: FreshnessFriendsList;
    geocaches?: FreshnessGeocaches;
    error?: string;
    error_message?: string;
}

// -------------------------------------------------- Notifications

/** Une notification de nouvelle trouvaille d'ami. */
export interface FriendNotification {
    gc_code: string;
    name: string;
    cache_type: string | null;
    latitude: number | null;
    longitude: number | null;
    difficulty: number | null;
    terrain: number | null;
    geocache_id: number;
    found: boolean;
    zone_id: number | null;
    status: string | null;
    favorites_count: number;
    friends: string[];
    friends_count: number;
    first_seen_at: string;
}

/** Réponse de `/api/friends/notifications`. */
export interface FriendNotificationsResponse {
    success: boolean;
    items?: FriendNotification[];
    count?: number;
    total_new_finds?: number;
    last_seen_at?: string | null;
    error?: string;
    error_message?: string;
}

// -------------------------------------------------- Événements

/** Un event geocaching (log type 9/10) auquel des amis participent. */
export interface FriendEvent {
    gc_code: string | null;
    name: string;
    cache_type_id: number | null;
    latitude: number | null;
    longitude: number | null;
    location_name: string | null;
    difficulty: number | null;
    terrain: number | null;
    is_archived: boolean;
    action_url: string | null;
    friends: string[];
    friends_count: number;
    is_upcoming: boolean;
    event_date: string | null;
}

/** Réponse de `/api/friends/events`. */
export interface FriendEventsResponse {
    success: boolean;
    items?: FriendEvent[];
    count?: number;
    upcoming_count?: number;
    past_count?: number;
    error?: string;
    error_message?: string;
}

// -------------------------------------------------- Scans de zone

/**
 * État d'un scan par ami sur une zone (`/api/friends/finds/zone/:id/scans`).
 *
 * `scanned: false` signifie que l'ami n'a jamais été scanné sur cette zone ;
 * les compteurs sont alors `null`.
 */
export interface FriendZoneScanEntry {
    friend: string;
    scanned: boolean;
    is_stale: boolean;
    found_count: number | null;
    zone_matches: number | null;
    scanned_at: string | null;
}

/** Progression d'une analyse streaming (bouton « 👥 Amis »). */
export interface FriendFindsProgress {
    done: number;
    total: number;
    friend?: string;
}

// -------------------------------------------------- Stream NDJSON

/**
 * Événements émis par `/api/friends/finds/sync-zone-stream` (une ligne JSON par
 * événement). Le champ `phase` discrimine le type de payload.
 */
export type FriendScanStreamEvent =
    | { phase: 'start'; to_scan?: number; skipped?: number }
    | { phase: 'progress'; done: number; total: number; friend?: string }
    | { phase: 'rate_limited'; message?: string }
    | { phase: 'error'; message?: string; friend?: string }
    | { phase: 'done'; scanned?: number; with_friends?: number; rate_limited?: boolean };
