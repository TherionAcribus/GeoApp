import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget, Message, ConfirmDialog, Dialog } from '@theia/core/lib/browser';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { LogTypeIcon } from './geocache-log-type-icons';
import { MapWidgetFactory } from './map/map-widget-factory';
import { MapGeocache } from './map/map-layer-manager';
import { GeoAppWidgetEventsService } from './geoapp-widget-events-service';
import { BackendApiClient, getErrorMessage } from './backend-api-client';

interface FriendActivity {
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

/** Un point de la carte des amis : une cache, un ou plusieurs amis l'ayant loguée. */
interface FriendMapPoint {
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

interface FriendMapResponse {
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
interface FriendFindPoint {
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

interface FriendFindsMapResponse {
    success: boolean;
    points?: FriendFindPoint[];
    total?: number;
    without_coordinates?: number;
    /** Nombre de **caches** non plaçables : ce qu'un import aurait à télécharger. */
    importable?: number;
    error?: string;
    error_message?: string;
}

/** Une suggestion de cache à faire, trouvée par des amis mais pas par moi. */
interface FriendSuggestion {
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

interface FriendSuggestionsResponse {
    success: boolean;
    suggestions?: FriendSuggestion[];
    count?: number;
    error?: string;
    error_message?: string;
}

/** Statistiques d'un ami : trouvailles, activité, caches en commun. */
interface FriendStat {
    username: string;
    finds_count: number;
    activity_count: number;
    shared_with_me: number;
}

interface FriendStatsSummary {
    friends_count: number;
    total_distinct_finds: number;
    total_shared_with_me: number;
    most_active_friend: string | null;
}

interface FriendStatsResponse {
    success: boolean;
    friends?: FriendStat[];
    summary?: FriendStatsSummary;
    error?: string;
    error_message?: string;
}

/** État de fraîcheur d'une source de données. */
interface FreshnessActivity {
    last_sync_at: string | null;
    last_projection_at: string | null;
    logs_stored: number;
    authors_in_feed: number;
    latest_log_date: string | null;
    is_stale: boolean;
}

interface FreshnessFinds {
    total_rows: number;
    distinct_caches: number;
    distinct_friends: number;
    is_stale: boolean;
}

interface FreshnessFriendsList {
    fetched_at: string | null;
    count: number;
    reported_count: number | null;
    truncated: boolean;
    pages_fetched: number;
}

interface FreshnessGeocaches {
    total: number;
    found: number;
    in_friends_zone: number;
}

interface FreshnessResponse {
    success: boolean;
    checked_at: string;
    activity?: FreshnessActivity;
    finds?: FreshnessFinds;
    friends_list?: FreshnessFriendsList;
    geocaches?: FreshnessGeocaches;
    error?: string;
    error_message?: string;
}

/** Une notification de nouvelle trouvaille d'ami. */
interface FriendNotification {
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

interface FriendNotificationsResponse {
    success: boolean;
    items?: FriendNotification[];
    count?: number;
    total_new_finds?: number;
    last_seen_at?: string | null;
    error?: string;
    error_message?: string;
}

/** Un event geocaching (log type 9/10) auquel des amis participent. */
interface FriendEvent {
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

interface FriendEventsResponse {
    success: boolean;
    items?: FriendEvent[];
    count?: number;
    upcoming_count?: number;
    past_count?: number;
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
type MapSource = 'activity' | 'finds' | 'both';

const MAP_SOURCES: { id: MapSource; label: string }[] = [
    { id: 'activity', label: 'Activité récente' },
    { id: 'finds', label: 'Toutes les trouvailles' },
    { id: 'both', label: 'Les deux' },
];

/** Agrégat par cache, avant rendu en géocache de carte. */
interface AggregatedPoint {
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

interface ActivityResponse {
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

const PAGE_SIZE = 50;

/** Regroupements proposés dans le filtre de type de log. */
const LOG_TYPE_FILTERS: { id: string; label: string; ids: number[] }[] = [
    { id: 'all', label: 'Tous les types', ids: [] },
    { id: 'found', label: 'Trouvailles', ids: [2] },
    { id: 'dnf', label: 'DNF', ids: [3] },
    { id: 'notes', label: 'Notes', ids: [4] },
    { id: 'events', label: 'Events', ids: [9, 10] },
    { id: 'owner', label: 'Maintenance / owner', ids: [45, 46, 47, 22, 23, 5, 24] },
];

/** Au-delà, la note est repliée derrière un « Voir plus ». */
const NOTE_PREVIEW_LENGTH = 320;

/** Au-delà, l'import demande confirmation en annonçant sa durée. */
const IMPORT_CONFIRM_THRESHOLD = 500;
/** Une requête vers geocaching.com par cache, plus la respiration du scraper. */
const SECONDS_PER_IMPORT = 1.2;

@injectable()
export class GeocachingFriendActivityWidget extends ReactWidget {
    static readonly ID = 'geocaching-friend-activity-widget';
    static readonly LABEL = 'Activité des amis';

    @inject(PreferenceService)
    protected readonly preferenceService: PreferenceService;

    @inject(BackendApiClient)
    protected readonly apiClient: BackendApiClient;

    @inject(MapWidgetFactory)
    protected readonly mapWidgetFactory: MapWidgetFactory;

    @inject(GeoAppWidgetEventsService)
    protected readonly widgetEventsService: GeoAppWidgetEventsService;

    protected activities: FriendActivity[] = [];
    protected authors: { username: string; count: number }[] = [];
    protected logTypeLabels: Record<string, string> = {};
    protected total: number = 0;
    /** Trouvailles regroupées par geocaching.com sans être détaillées (§13.2). */
    protected condensedHidden: number = 0;
    protected lastSyncAt: string | null = null;

    protected loading: boolean = false;
    protected syncing: boolean = false;
    protected loaded: boolean = false;
    protected error: string | null = null;
    protected notAuthenticated: boolean = false;
    protected syncMessage: string | null = null;

    protected authorFilter: string = '';
    protected typeFilter: string = 'all';
    protected includeSelf: boolean = false;
    protected syncDays: number = 7;
    protected expandedNotes = new Set<number>();

    protected mapSource: MapSource = 'activity';
    protected mapLoading: boolean = false;
    protected mapMessage: string | null = null;

    /** Caches trouvées par un ami, absentes de GeoApp et sans coordonnées connues. */
    protected importableCount: number = 0;
    protected importing: boolean = false;
    protected importProgress: string | null = null;
    protected importAbort: AbortController | undefined;

    protected profileSyncing: boolean = false;

    /** Suggestions de caches à faire, trouvées par des amis mais pas par moi. */
    protected suggestions: FriendSuggestion[] = [];
    protected suggestionsLoading: boolean = false;
    protected suggestionsVisible: boolean = false;
    protected suggestionsMinFriends: number = 1;

    /** Statistiques croisées entre amis. */
    protected stats: FriendStat[] = [];
    protected statsSummary: FriendStatsSummary | null = null;
    protected statsLoading: boolean = false;
    protected statsVisible: boolean = false;

    /** État de fraîcheur des données. */
    protected freshness: FreshnessResponse | null = null;
    protected freshnessLoading: boolean = false;

    /** Notifications de nouvelles trouvailles d'amis. */
    protected notifications: FriendNotification[] = [];
    protected notificationsCount: number = 0;
    protected notificationsLoading: boolean = false;
    protected notificationsVisible: boolean = false;

    /** Events geocaching auxquels des amis participent. */
    protected events: FriendEvent[] = [];
    protected eventsCount: number = 0;
    protected eventsUpcomingCount: number = 0;
    protected eventsPastCount: number = 0;
    protected eventsLoading: boolean = false;
    protected eventsVisible: boolean = false;

    @postConstruct()
    protected init(): void {
        this.id = GeocachingFriendActivityWidget.ID;
        this.title.label = GeocachingFriendActivityWidget.LABEL;
        this.title.caption = "Flux d'activité de vos amis Geocaching.com";
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-pulse';
        this.addClass('geocaching-friend-activity-widget');
        this.node.tabIndex = 0;

        this.loadActivities()
            .then(() => this.autoSyncIfStale())
            .then(() => this.autoOpenMapIfEnabled())
            .then(() => this.refreshImportableCount())
            .then(() => this.refreshNotifications())
            .then(() => this.refreshEvents());
    }

    /** Ouverture automatique de la carte, réglable par préférence (activée par défaut). */
    protected async autoOpenMapIfEnabled(): Promise<void> {
        if (this.error || !this.preferenceService.get<boolean>('geoApp.friends.map.autoLoad', true)) {
            return;
        }
        await this.showOnMap(true);
    }

    protected onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        if (!this.loaded && !this.loading) {
            this.loadActivities();
        }
    }

    /** Première synchro automatique si le flux local n'a jamais été rempli ou date de plus d'une heure. */
    protected async autoSyncIfStale(): Promise<void> {
        if (this.error) {
            return;
        }
        const staleAfterMs = 60 * 60 * 1000;
        const last = this.lastSyncAt ? new Date(this.lastSyncAt).getTime() : 0;
        if (!last || Date.now() - last > staleAfterMs) {
            await this.sync();
        }
    }

    /**
     * Applique les filtres à la timeline **et** à la carte, pour que les deux ne
     * divergent jamais. La carte n'est rechargée que si elle est ouverte.
     */
    protected async applyFilters(): Promise<void> {
        await this.loadActivities(0);
        await this.showOnMap();
    }

    protected buildQuery(offset: number): string {
        const params = new URLSearchParams({
            limit: String(PAGE_SIZE),
            offset: String(offset)
        });
        if (this.authorFilter) {
            params.set('author', this.authorFilter);
        }
        const filter = LOG_TYPE_FILTERS.find(f => f.id === this.typeFilter);
        if (filter && filter.ids.length > 0) {
            params.set('log_types', filter.ids.join(','));
        }
        if (this.includeSelf) {
            params.set('include_self', 'true');
        }
        return params.toString();
    }

    protected async loadActivities(offset: number = 0): Promise<void> {
        this.loading = true;
        this.error = null;
        this.notAuthenticated = false;
        this.update();

        try {
            const result = await this.apiClient.requestJson<ActivityResponse>(
                `/api/friends/activity?${this.buildQuery(offset)}`,
                {},
                "Impossible de charger l'activité des amis",
            );

            if (!result.success) {
                this.notAuthenticated = result.error === 'not_authenticated';
                this.error = result.error_message || "Impossible de charger l'activité des amis";
                return;
            }

            const page = result.activities || [];
            this.activities = offset === 0 ? page : [...this.activities, ...page];
            this.authors = result.authors || [];
            this.logTypeLabels = result.log_type_labels || {};
            this.total = result.total || 0;
            this.condensedHidden = result.condensed_hidden || 0;
            this.lastSyncAt = result.last_sync_at ?? null;
            this.loaded = true;
        } catch (err) {
            this.error = getErrorMessage(err, 'Erreur de connexion au serveur GeoApp');
            console.error('[FriendActivity] Failed to load activities:', err);
        } finally {
            this.loading = false;
            this.update();
        }
    }

    /**
     * Charge les points de la carte et l'ouvre.
     *
     * `force` distingue le clic sur « Carte » (on ouvre) d'un simple changement de
     * filtre (on ne recharge que si la carte est déjà là — sinon on rouvrirait un
     * onglet que l'utilisateur vient de fermer).
     *
     * Les filtres envoyés sont ceux de la timeline, sans fenêtre de dates : la
     * carte doit montrer exactement ce que la liste affiche.
     */
    protected async showOnMap(force: boolean = false): Promise<void> {
        if (!force && !this.mapWidgetFactory.isFriendsMapOpen()) {
            return;
        }

        this.mapLoading = true;
        this.mapMessage = null;
        this.update();

        try {
            const aggregated = new Map<string, AggregatedPoint>();
            const notes: string[] = [];

            if (this.mapSource !== 'finds') {
                const result = await this.fetchActivityPoints();
                if (result === undefined) {
                    return;
                }
                this.mergeActivityPoints(aggregated, result.points || []);
                if (result.truncated) {
                    notes.push(`affichage limité à ${result.returned} des ${result.total} caches`);
                }
                if (result.without_coordinates) {
                    notes.push(`${result.without_coordinates} log(s) sans coordonnées`);
                }
            }

            if (this.mapSource !== 'activity') {
                const result = await this.fetchFindPoints();
                if (result === undefined) {
                    return;
                }
                this.mergeFindPoints(aggregated, result.points || []);
                this.importableCount = result.importable || 0;
            }

            await this.mapWidgetFactory.openFriendsMap(this.toMapGeocaches([...aggregated.values()]));

            const bits = [`${aggregated.size} cache(s) sur la carte`, ...notes];
            this.mapMessage = bits.join(' · ');
        } catch (err) {
            this.mapMessage = 'Erreur de connexion au serveur GeoApp';
            console.error('[FriendActivity] Failed to load the friends map:', err);
        } finally {
            this.mapLoading = false;
            this.update();
        }
    }

    /** Points du flux d'activité. `undefined` = erreur déjà signalée dans `mapMessage`. */
    protected async fetchActivityPoints(): Promise<FriendMapResponse | undefined> {
        const params = new URLSearchParams();
        if (this.authorFilter) {
            params.set('author', this.authorFilter);
        }
        const filter = LOG_TYPE_FILTERS.find(f => f.id === this.typeFilter);
        if (filter && filter.ids.length > 0) {
            params.set('log_types', filter.ids.join(','));
        }
        if (this.includeSelf) {
            params.set('include_self', 'true');
        }

        return this.fetchMapJson<FriendMapResponse>(`/api/friends/activity/map?${params.toString()}`);
    }

    /**
     * Trouvailles déduites par zone. Seul le filtre « ami » s'y applique : cette
     * table n'a ni type de log ni date, la filtrer par type n'aurait aucun sens.
     */
    protected async fetchFindPoints(silent: boolean = false): Promise<FriendFindsMapResponse | undefined> {
        const params = new URLSearchParams();
        if (this.authorFilter) {
            params.set('friend', this.authorFilter);
        }

        return this.fetchMapJson<FriendFindsMapResponse>(
            `/api/friends/finds/map?${params.toString()}`,
            silent
        );
    }

    /**
     * Appel JSON commun aux deux sources, avec le garde-fou « route absente ».
     *
     * `silent` : ne rien afficher en cas d'échec — utilisé par le simple comptage
     * des trouvailles à importer, qui ne doit pas polluer l'interface.
     */
    protected async fetchMapJson<T extends { success: boolean; error_message?: string }>(
        path: string,
        silent: boolean = false
    ): Promise<T | undefined> {
        try {
            const result = await this.apiClient.requestJson<T>(
                path,
                {},
                'Impossible de charger la carte des amis.',
            );
            if (!result.success) {
                if (!silent) {
                    this.mapMessage = result.error_message || 'Impossible de charger la carte des amis.';
                }
                return undefined;
            }
            return result;
        } catch (err) {
            if (!silent) {
                this.mapMessage = getErrorMessage(err, 'Impossible de charger la carte des amis.');
            }
            return undefined;
        }
    }

    /**
     * Met à jour le nombre de trouvailles non localisables, indépendamment de la
     * carte.
     *
     * Sans ça, le bouton d'import n'apparaissait qu'après avoir basculé le
     * sélecteur sur « Toutes les trouvailles » : la seule porte d'entrée de
     * l'import était cachée derrière un réglage d'affichage.
     */
    protected async refreshImportableCount(): Promise<void> {
        try {
            const result = await this.fetchFindPoints(true);
            if (result) {
                this.importableCount = result.importable || 0;
                this.update();
            }
        } catch (err) {
            console.error('[FriendActivity] Unable to count importable finds:', err);
        }
    }

    protected mergeActivityPoints(target: Map<string, AggregatedPoint>, points: FriendMapPoint[]): void {
        for (const point of points) {
            const key = point.gc_code || `?${point.latitude},${point.longitude}`;
            target.set(key, {
                gc_code: point.gc_code,
                name: point.name,
                cache_type: point.cache_type,
                latitude: point.latitude,
                longitude: point.longitude,
                difficulty: point.difficulty,
                terrain: point.terrain,
                geocache_id: point.geocache_id,
                found: point.found,
                activityFriends: point.friends,
                findsFriends: [],
                lastLogDate: point.last_log_date
            });
        }
    }

    /**
     * Ajoute les trouvailles déduites. Une cache déjà connue du flux garde ses
     * métadonnées (plus riches) et ne gagne que les amis que le flux ignorait —
     * le flux ne remonte qu'à deux mois, la déduction à toujours.
     */
    protected mergeFindPoints(target: Map<string, AggregatedPoint>, points: FriendFindPoint[]): void {
        for (const point of points) {
            const existing = target.get(point.gc_code);
            const usernames = point.friends.map(friend => friend.username);

            if (existing) {
                const alreadyKnown = new Set(existing.activityFriends.map(friend => friend.username));
                existing.findsFriends = usernames.filter(username => !alreadyKnown.has(username));
                continue;
            }

            target.set(point.gc_code, {
                gc_code: point.gc_code,
                name: point.name,
                cache_type: point.cache_type,
                latitude: point.latitude,
                longitude: point.longitude,
                difficulty: point.difficulty,
                terrain: point.terrain,
                geocache_id: point.geocache_id,
                found: point.found,
                activityFriends: [],
                findsFriends: usernames,
                lastLogDate: null
            });
        }
    }

    /**
     * Convertit les points agrégés en géocaches de carte.
     *
     * Les caches non importées reçoivent un **id négatif unique** : les features
     * OpenLayers sont indexées par id, un `0` partagé les ferait entrer en
     * collision et une seule survivrait. Le prédicat `id > 0` reste par ailleurs
     * ce qui autorise la popup à proposer l'ouverture de la fiche.
     */
    protected toMapGeocaches(points: AggregatedPoint[]): MapGeocache[] {
        let syntheticId = 0;

        return points.map(point => ({
            id: point.geocache_id > 0 ? point.geocache_id : --syntheticId,
            gc_code: point.gc_code || '—',
            name: point.name || 'Sans nom',
            // Même repli que le reste de la carte : icône « mystery » par défaut.
            cache_type: point.cache_type || 'Unknown Cache',
            latitude: point.latitude,
            longitude: point.longitude,
            difficulty: point.difficulty ?? undefined,
            terrain: point.terrain ?? undefined,
            found: point.found,
            friendsNote: this.describeFriends(point)
        }));
    }

    /** « Trouvée par Pseudo1, Pseudo2 — 26 juil. », les types autres que « trouvé » explicités. */
    protected describeFriends(point: AggregatedPoint): string {
        const found = point.activityFriends.filter(friend => friend.log_type_id === 2);
        const others = point.activityFriends.filter(friend => friend.log_type_id !== 2);

        const parts: string[] = [];
        const finders = [...found.map(friend => friend.username), ...point.findsFriends];
        if (finders.length > 0) {
            parts.push(`Trouvée par ${finders.join(', ')}`);
        }
        for (const friend of others) {
            const label = friend.log_type_id !== null
                ? this.logTypeLabels[String(friend.log_type_id)] || 'a logué'
                : 'a logué';
            parts.push(`${friend.username} ${label}`);
        }

        const date = point.lastLogDate
            ? new Date(point.lastLogDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
            : null;
        return date ? `${parts.join(' · ')} — ${date}` : parts.join(' · ');
    }

    /**
     * Récupère les trouvailles d'un ami depuis son profil geocaching.com.
     *
     * C'est la réponse à la condensation du flux : celui-ci regroupe les
     * trouvailles d'affilée sans les nommer, cette recherche les donne une par
     * une, de la plus récente à la plus ancienne — donc en commençant par celles
     * que le flux a justement masquées.
     */
    protected async fetchProfileFinds(): Promise<void> {
        const friend = this.authorFilter;
        if (!friend || this.profileSyncing) {
            return;
        }

        this.profileSyncing = true;
        this.syncMessage = null;
        this.error = null;
        this.update();

        try {
            const estimate = await this.fetchMapJson<{
                success: boolean; total?: number; reachable?: number; seconds?: number;
            }>(`/api/friends/finds/friend/${encodeURIComponent(friend)}/estimate`, true);

            if (estimate?.total !== undefined) {
                const minutes = Math.ceil((estimate.seconds || 0) / 60);
                const capped = (estimate.reachable || 0) < estimate.total;
                const confirmed = await new ConfirmDialog({
                    title: `Trouvailles de ${friend}`,
                    msg: `${estimate.total} trouvaille(s) annoncée(s)`
                        + (capped
                            ? `, dont les ${estimate.reachable} plus récentes accessibles `
                              + `(geocaching.com limite la pagination). `
                            : '. ')
                        + `Durée estimée : ${minutes} minute(s).`,
                    ok: 'Récupérer',
                    cancel: Dialog.CANCEL
                }).open();
                if (!confirmed) {
                    return;
                }
            }

            const result = await this.apiClient.requestJson<{
                success: boolean; error?: string; error_message?: string;
                fetched: number; created: number; truncated?: boolean;
            }>(
                '/api/friends/finds/sync-friend',
                this.apiClient.createJsonInit('POST', { friend }),
                'Échec de la récupération des trouvailles.',
            );

            if (!result.success) {
                this.notAuthenticated = result.error === 'not_authenticated';
                this.error = result.error_message || 'Échec de la récupération des trouvailles.';
                return;
            }

            this.syncMessage = `${result.fetched} trouvaille(s) de ${friend} récupérée(s)`
                + ` (${result.created} nouvelle(s))`
                + (result.truncated ? ', liste partielle.' : '.');
            await this.showOnMap();
            await this.refreshImportableCount();
        } catch (err) {
            this.error = getErrorMessage(err, 'Erreur de connexion au serveur GeoApp');
            console.error('[FriendActivity] Profile finds fetch failed:', err);
        } finally {
            this.profileSyncing = false;
            this.update();
        }
    }

    /**
     * Importe dans la zone « Amis » les caches trouvées par vos amis mais absentes
     * de GeoApp. Opération longue (une requête par cache) : elle se déroule en
     * fond, avec une progression discrète et un bouton d'arrêt.
     */
    protected async importMissingFinds(): Promise<void> {
        if (this.importing) {
            return;
        }

        if (this.importableCount > IMPORT_CONFIRM_THRESHOLD) {
            const minutes = Math.ceil(this.importableCount * SECONDS_PER_IMPORT / 60);
            const confirmed = await new ConfirmDialog({
                title: 'Importer les trouvailles de vos amis',
                msg: `${this.importableCount} géocaches à télécharger depuis geocaching.com, `
                    + `soit environ ${minutes} minute(s). L'import se poursuit en arrière-plan `
                    + `et peut être interrompu à tout moment.`,
                ok: 'Importer',
                cancel: Dialog.CANCEL
            }).open();
            if (!confirmed) {
                return;
            }
        }

        this.importing = true;
        this.importProgress = 'Démarrage…';
        this.importAbort = new AbortController();
        this.update();

        try {
            await this.streamImport(this.importAbort.signal);
            // Les caches importées sont désormais géolocalisées : la carte peut
            // les placer, et l'arbre doit voir la zone « Amis » si elle est visible.
            this.widgetEventsService.notifyZoneListChanged();
            await this.showOnMap();
            await this.refreshImportableCount();
        } catch (err) {
            if ((err as Error)?.name === 'AbortError') {
                this.importProgress = 'Import interrompu. Les caches déjà importées sont conservées.';
            } else {
                this.importProgress = `Échec de l'import : ${(err as Error)?.message || err}`;
                console.error('[FriendActivity] Friend finds import failed:', err);
            }
        } finally {
            this.importing = false;
            this.importAbort = undefined;
            this.update();
        }
    }

    /** Consomme la réponse en streaming ligne par ligne (même format qu'`import-around`). */
    protected async streamImport(signal: AbortSignal): Promise<void> {
        const response = await this.apiClient.request(
            '/api/friends/finds/import',
            this.apiClient.createJsonInit('POST', {}, { signal })
        );

        if (response.status === 401) {
            this.importProgress = 'Connectez-vous à Geocaching.com pour importer ces géocaches.';
            return;
        }
        await this.apiClient.ensureOk(response, 'Échec de l\'import des trouvailles.');
        if (!response.body) {
            throw new Error('Réponse streaming non supportée');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const handleLine = (line: string): void => {
            const trimmed = line.trim();
            if (!trimmed) {
                return;
            }
            try {
                const data = JSON.parse(trimmed);
                this.importProgress = data.message || this.importProgress;
                this.update();
            } catch (e) {
                console.error('[FriendActivity] Unparsable import progress line:', e);
            }
        };

        for (;;) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            lines.forEach(handleLine);
        }
        handleLine(buffer);
    }

    protected cancelImport(): void {
        this.importAbort?.abort();
    }

    protected async sync(): Promise<void> {
        this.syncing = true;
        this.syncMessage = null;
        this.error = null;
        this.update();

        try {
            const result = await this.apiClient.requestJson<{
                success: boolean; error?: string; error_message?: string;
                created: number; finds_projected?: number;
            }>(
                '/api/friends/activity/sync',
                this.apiClient.createJsonInit('POST', { days: this.syncDays }),
                'Échec de la synchronisation',
            );

            if (result.success) {
                const bits = [
                    result.created > 0
                        ? `${result.created} nouvelle(s) activité(s) récupérée(s).`
                        : 'Aucune nouvelle activité.'
                ];
                if (result.finds_projected > 0) {
                    bits.push(`${result.finds_projected} trouvaille(s) ajoutée(s) à vos amis.`);
                }
                this.syncMessage = bits.join(' ');
                await this.loadActivities(0);
                // Une synchro peut apporter de nouvelles caches : la carte suit.
                await this.showOnMap();
                await this.refreshImportableCount();
            } else {
                this.notAuthenticated = result.error === 'not_authenticated';
                this.error = result.error_message || 'Échec de la synchronisation';
            }
        } catch (err) {
            this.error = getErrorMessage(err, 'Erreur de connexion au serveur GeoApp');
            console.error('[FriendActivity] Sync failed:', err);
        } finally {
            this.syncing = false;
            this.update();
        }
    }

    protected describeLogType(activity: FriendActivity): string {
        const label = activity.log_type_id !== null ? this.logTypeLabels[String(activity.log_type_id)] : undefined;
        return label || 'a logué';
    }

    protected formatDayHeader(iso: string | null): string {
        if (!iso) {
            return 'Date inconnue';
        }
        const date = new Date(iso);
        const today = new Date();
        const yesterday = new Date(today.getTime() - 24 * 3600 * 1000);
        const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

        if (sameDay(date, today)) {
            return "Aujourd'hui";
        }
        if (sameDay(date, yesterday)) {
            return 'Hier';
        }
        return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    }

    /** Groupe les entrées par jour, en conservant l'ordre (déjà trié par date décroissante). */
    protected groupByDay(): { day: string; items: FriendActivity[] }[] {
        const groups: { day: string; items: FriendActivity[] }[] = [];
        for (const activity of this.activities) {
            const day = this.formatDayHeader(activity.log_date);
            const last = groups[groups.length - 1];
            if (last && last.day === day) {
                last.items.push(activity);
            } else {
                groups.push({ day, items: [activity] });
            }
        }
        return groups;
    }

    protected render(): React.ReactNode {
        return (
            <div style={{ padding: '16px', height: '100%', overflow: 'auto' }}>
                <h2 style={{ marginTop: 0, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="codicon codicon-pulse"></span>
                    Activité des amis
                    {this.loaded && (
                        <span style={{ fontSize: '0.7em', fontWeight: 'normal', color: 'var(--theia-descriptionForeground)' }}>
                            {`(${this.total})`}
                        </span>
                    )}
                    {this.notificationsCount > 0 && (
                        <span
                            style={{
                                fontSize: '0.75em',
                                fontWeight: 'bold',
                                color: 'white',
                                backgroundColor: 'var(--theia-charts-red)',
                                borderRadius: '10px',
                                padding: '1px 8px',
                                minWidth: '20px',
                                textAlign: 'center',
                            }}
                            title={`${this.notificationsCount} nouvelle(s) trouvaille(s) d'ami(s) depuis votre dernière visite`}
                        >
                            {this.notificationsCount}
                        </span>
                    )}
                </h2>

                {this.renderToolbar()}
                {this.renderNotices()}
                {this.renderFeed()}
                {this.renderSuggestions()}
                {this.renderStats()}
                {this.renderFreshness()}
                {this.renderNotifications()}
                {this.renderEvents()}
            </div>
        );
    }

    // -------------------------------------------------- Suggestions de caches

    protected async loadSuggestions(): Promise<void> {
        this.suggestionsLoading = true;
        this.update();

        try {
            const params = new URLSearchParams({
                min_friends: String(this.suggestionsMinFriends),
                limit: '50',
            });
            const result = await this.apiClient.requestJson<FriendSuggestionsResponse>(
                `/api/friends/finds/suggestions?${params}`,
                {},
                'Impossible de charger les suggestions.',
            );
            if (result.success) {
                this.suggestions = result.suggestions || [];
            } else {
                this.suggestions = [];
            }
        } catch {
            this.suggestions = [];
        } finally {
            this.suggestionsLoading = false;
            this.update();
        }
    }

    protected toggleSuggestions(): void {
        this.suggestionsVisible = !this.suggestionsVisible;
        if (this.suggestionsVisible && this.suggestions.length === 0 && !this.suggestionsLoading) {
            this.loadSuggestions();
        }
        this.update();
    }

    protected renderSuggestions(): React.ReactNode {
        if (!this.suggestionsVisible) {
            return (
                <div style={{ marginTop: '24px', borderTop: '1px solid var(--theia-panel-border)', paddingTop: '16px' }}>
                    <button
                        className="theia-button secondary"
                        onClick={() => this.toggleSuggestions()}
                        title="Caches trouvées par vos amis mais pas encore par vous"
                    >
                        <span className="codicon codicon-lightbulb"></span>
                        {' Suggestions de caches à faire'}
                    </button>
                </div>
            );
        }

        return (
            <div style={{ marginTop: '24px', borderTop: '1px solid var(--theia-panel-border)', paddingTop: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                    <span className="codicon codicon-lightbulb"></span>
                    <strong>Suggestions de caches à faire</strong>
                    <label
                        style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85em' }}
                        title="Nombre minimum d'amis ayant trouvé la cache"
                    >
                        min.
                        <input
                            type="number"
                            className="theia-input"
                            min={1}
                            max={50}
                            value={this.suggestionsMinFriends}
                            onChange={e => {
                                this.suggestionsMinFriends = Math.max(1, Math.min(50, Number(e.target.value) || 1));
                                this.loadSuggestions();
                            }}
                            style={{ width: '3em' }}
                        />
                        ami(s)
                    </label>
                    <div style={{ flex: 1 }}></div>
                    <button
                        className="theia-button secondary"
                        onClick={() => this.toggleSuggestions()}
                        title="Replier la section"
                    >
                        <span className="codicon codicon-chevron-up"></span>
                    </button>
                    <button
                        className="theia-button secondary"
                        onClick={() => this.loadSuggestions()}
                        disabled={this.suggestionsLoading}
                        title="Rafraîchir les suggestions"
                    >
                        <span className="codicon codicon-refresh"></span>
                    </button>
                </div>

                {this.suggestionsLoading && (
                    <div style={{ color: 'var(--theia-descriptionForeground)' }}>Chargement des suggestions…</div>
                )}

                {!this.suggestionsLoading && this.suggestions.length === 0 && (
                    <div style={{ color: 'var(--theia-descriptionForeground)' }}>
                        Aucune suggestion pour ce filtre. Vos amis n'ont pas encore trouvé de cache que vous n'auriez pas faite,
                        ou la base est vide : synchronisez le flux ou déduisez les trouvailles d'une zone.
                    </div>
                )}

                {!this.suggestionsLoading && this.suggestions.length > 0 && (
                    <div>
                        {this.suggestions.map(s => this.renderSuggestion(s))}
                    </div>
                )}
            </div>
        );
    }

    protected renderSuggestion(s: FriendSuggestion): React.ReactNode {
        const cacheUrl = s.geocache_id > 0
            ? undefined
            : `https://www.geocaching.com/geocache/${s.gc_code}`;

        return (
            <div
                key={s.gc_code}
                style={{
                    display: 'flex',
                    gap: '10px',
                    padding: '10px 0',
                    borderBottom: '1px solid var(--theia-panel-border)'
                }}
            >
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <span
                            className="codicon codicon-people"
                            style={{ color: 'var(--theia-charts-blue)', fontSize: '0.9em' }}
                            title={`${s.friends_count} ami(s) ont trouvé cette cache`}
                        ></span>
                        <strong style={{ color: 'var(--theia-charts-blue)' }}>{s.friends_count}</strong>
                        {cacheUrl ? (
                            <a href={cacheUrl} target="_blank" rel="noreferrer" title="Ouvrir sur geocaching.com">
                                {s.name}
                            </a>
                        ) : (
                            <span>{s.name}</span>
                        )}
                        <span style={{ color: 'var(--theia-descriptionForeground)', fontSize: '0.85em' }}>
                            {s.gc_code}
                        </span>
                        {s.found && (
                            <span style={{
                                fontSize: '0.75em',
                                padding: '0 6px',
                                borderRadius: '8px',
                                backgroundColor: 'var(--theia-charts-green)',
                                color: 'white'
                            }}>
                                trouvée
                            </span>
                        )}
                        {s.status === 'archived' && (
                            <span style={{ color: 'var(--theia-errorForeground)', fontSize: '0.85em' }}>archivée</span>
                        )}
                    </div>

                    <div style={{
                        fontSize: '0.8em',
                        color: 'var(--theia-descriptionForeground)',
                        display: 'flex',
                        gap: '10px',
                        flexWrap: 'wrap',
                        marginTop: '2px'
                    }}>
                        {s.cache_type && <span>{s.cache_type}</span>}
                        {s.difficulty !== null && s.terrain !== null && (
                            <span>{`D ${s.difficulty} / T ${s.terrain}`}</span>
                        )}
                        {s.favorites_count > 0 && (
                            <span title="Points favoris" style={{ color: 'var(--theia-charts-red)' }}>
                                <span className="codicon codicon-heart-filled" style={{ fontSize: '0.9em' }}></span>
                                {` ${s.favorites_count}`}
                            </span>
                        )}
                        {s.latitude !== null && s.longitude !== null && (
                            <span>
                                <span className="codicon codicon-location" style={{ fontSize: '0.9em' }}></span>
                                {` ${s.latitude.toFixed(4)}, ${s.longitude.toFixed(4)}`}
                            </span>
                        )}
                    </div>

                    <div style={{
                        fontSize: '0.8em',
                        color: 'var(--theia-descriptionForeground)',
                        marginTop: '2px'
                    }}>
                        {s.friends.join(', ')}
                    </div>
                </div>
            </div>
        );
    }

    // -------------------------------------------------- Statistiques croisées

    protected async loadStats(): Promise<void> {
        this.statsLoading = true;
        this.update();

        try {
            const result = await this.apiClient.requestJson<FriendStatsResponse>(
                '/api/friends/stats',
                {},
                'Impossible de charger les statistiques.',
            );
            if (result.success) {
                this.stats = result.friends || [];
                this.statsSummary = result.summary || null;
            } else {
                this.stats = [];
                this.statsSummary = null;
            }
        } catch {
            this.stats = [];
            this.statsSummary = null;
        } finally {
            this.statsLoading = false;
            this.update();
        }
    }

    protected toggleStats(): void {
        this.statsVisible = !this.statsVisible;
        if (this.statsVisible && this.stats.length === 0 && !this.statsLoading) {
            this.loadStats();
        }
        this.update();
    }

    protected renderStats(): React.ReactNode {
        if (!this.statsVisible) {
            return (
                <div style={{ marginTop: '16px' }}>
                    <button
                        className="theia-button secondary"
                        onClick={() => this.toggleStats()}
                        title="Statistiques croisées sur vos amis"
                    >
                        <span className="codicon codicon-graph"></span>
                        {' Statistiques'}
                    </button>
                </div>
            );
        }

        return (
            <div style={{ marginTop: '16px', borderTop: '1px solid var(--theia-panel-border)', paddingTop: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                    <span className="codicon codicon-graph"></span>
                    <strong>Statistiques</strong>
                    <div style={{ flex: 1 }}></div>
                    <button
                        className="theia-button secondary"
                        onClick={() => this.toggleStats()}
                        title="Replier la section"
                    >
                        <span className="codicon codicon-chevron-up"></span>
                    </button>
                    <button
                        className="theia-button secondary"
                        onClick={() => this.loadStats()}
                        disabled={this.statsLoading}
                        title="Rafraîchir les statistiques"
                    >
                        <span className="codicon codicon-refresh"></span>
                    </button>
                </div>

                {this.statsLoading && (
                    <div style={{ color: 'var(--theia-descriptionForeground)' }}>Chargement des statistiques…</div>
                )}

                {!this.statsLoading && this.statsSummary && this.stats.length > 0 && (
                    <>
                        <div style={{
                            display: 'flex',
                            gap: '16px',
                            marginBottom: '12px',
                            flexWrap: 'wrap',
                            fontSize: '0.9em',
                            color: 'var(--theia-descriptionForeground)'
                        }}>
                            <span title="Nombre d'amis avec au moins une trouvaille ou un log">
                                <strong>{this.statsSummary.friends_count}</strong> ami(s)
                            </span>
                            <span title="Caches distinctes trouvées par au moins un ami">
                                <strong>{this.statsSummary.total_distinct_finds}</strong> cache(s) trouvée(s)
                            </span>
                            <span title="Caches que j'ai trouvées et qu'un ami a aussi trouvées">
                                <strong>{this.statsSummary.total_shared_with_me}</strong> en commun
                            </span>
                            {this.statsSummary.most_active_friend && (
                                <span title="Ami avec le plus de trouvailles connues">
                                    Plus actif : <strong>{this.statsSummary.most_active_friend}</strong>
                                </span>
                            )}
                        </div>

                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85em' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--theia-panel-border)', textAlign: 'left' }}>
                                    <th style={{ padding: '4px 8px' }}>Ami</th>
                                    <th style={{ padding: '4px 8px', textAlign: 'right' }} title="Trouvailles connues (friend_find)">Trouvailles</th>
                                    <th style={{ padding: '4px 8px', textAlign: 'right' }} title="Logs dans le flux d'activité">Activité</th>
                                    <th style={{ padding: '4px 8px', textAlign: 'right' }} title="Caches que j'ai aussi trouvées">En commun</th>
                                </tr>
                            </thead>
                            <tbody>
                                {this.stats.map(stat => (
                                    <tr key={stat.username} style={{ borderBottom: '1px solid var(--theia-panel-border)' }}>
                                        <td style={{ padding: '4px 8px' }}>
                                            <a
                                                onClick={() => { this.authorFilter = stat.username; this.applyFilters(); }}
                                                style={{ cursor: 'pointer' }}
                                                title={`Filtrer le flux sur ${stat.username}`}
                                            >
                                                {stat.username}
                                            </a>
                                        </td>
                                        <td style={{ padding: '4px 8px', textAlign: 'right' }}>{stat.finds_count}</td>
                                        <td style={{ padding: '4px 8px', textAlign: 'right' }}>{stat.activity_count}</td>
                                        <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                                            {stat.shared_with_me > 0 ? (
                                                <span style={{ color: 'var(--theia-charts-blue)' }}>{stat.shared_with_me}</span>
                                            ) : (
                                                <span style={{ color: 'var(--theia-descriptionForeground)' }}>0</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </>
                )}

                {!this.statsLoading && this.stats.length === 0 && (
                    <div style={{ color: 'var(--theia-descriptionForeground)' }}>
                        Aucune statistique disponible : synchronisez le flux d'activité ou déduisez les trouvailles d'une zone.
                    </div>
                )}
            </div>
        );
    }

    // -------------------------------------------------- Panneau de fraîcheur

    protected async loadFreshness(): Promise<void> {
        this.freshnessLoading = true;
        this.update();

        try {
            const result = await this.apiClient.requestJson<FreshnessResponse>(
                '/api/friends/freshness',
                {},
                'Impossible de charger l\'état de fraîcheur.',
            );
            this.freshness = result.success ? result : null;
        } catch {
            this.freshness = null;
        } finally {
            this.freshnessLoading = false;
            this.update();
        }
    }

    protected formatRelativeTime(iso: string | null): string {
        if (!iso) return 'jamais';
        const date = new Date(iso);
        const diffMs = Date.now() - date.getTime();
        const diffMin = Math.floor(diffMs / 60000);
        if (diffMin < 1) return 'à l\'instant';
        if (diffMin < 60) return `il y a ${diffMin} min`;
        const diffHours = Math.floor(diffMin / 60);
        if (diffHours < 24) return `il y a ${diffHours} h`;
        const diffDays = Math.floor(diffHours / 24);
        return `il y a ${diffDays} j`;
    }

    protected renderFreshness(): React.ReactNode {
        return (
            <div style={{ marginTop: '16px', borderTop: '1px solid var(--theia-panel-border)', paddingTop: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                    <span className="codicon codicon-dashboard"></span>
                    <strong>Fraîcheur des données</strong>
                    <div style={{ flex: 1 }}></div>
                    <button
                        className="theia-button secondary"
                        onClick={() => this.loadFreshness()}
                        disabled={this.freshnessLoading}
                        title="Rafraîchir l'état des données"
                    >
                        <span className="codicon codicon-refresh"></span>
                    </button>
                </div>

                {this.freshnessLoading && !this.freshness && (
                    <div style={{ color: 'var(--theia-descriptionForeground)' }}>Chargement…</div>
                )}

                {this.freshness && (
                    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '0.85em' }}>
                        {this.renderFreshnessCard('Flux d\'activité', [
                            { label: 'Dernière synchro', value: this.formatRelativeTime(this.freshness.activity?.last_sync_at ?? null), stale: this.freshness.activity?.is_stale },
                            { label: 'Logs stockés', value: String(this.freshness.activity?.logs_stored ?? 0) },
                            { label: 'Amis dans le flux', value: String(this.freshness.activity?.authors_in_feed ?? 0) },
                            { label: 'Dernier log', value: this.formatRelativeTime(this.freshness.activity?.latest_log_date ?? null) },
                        ])}
                        {this.renderFreshnessCard('Trouvailles déduites', [
                            { label: 'Dernière projection', value: this.formatRelativeTime(this.freshness.activity?.last_projection_at ?? null), stale: this.freshness.finds?.is_stale },
                            { label: 'Lignes', value: String(this.freshness.finds?.total_rows ?? 0) },
                            { label: 'Caches distinctes', value: String(this.freshness.finds?.distinct_caches ?? 0) },
                            { label: 'Amis distincts', value: String(this.freshness.finds?.distinct_friends ?? 0) },
                        ])}
                        {this.renderFreshnessCard('Liste d\'amis', [
                            { label: 'Récupérée', value: this.formatRelativeTime(this.freshness.friends_list?.fetched_at ?? null) },
                            { label: 'Amis', value: String(this.freshness.friends_list?.count ?? 0) },
                            { label: 'Pages', value: String(this.freshness.friends_list?.pages_fetched ?? 1) },
                            { label: 'Tronquée', value: this.freshness.friends_list?.truncated ? 'oui' : 'non', stale: this.freshness.friends_list?.truncated },
                        ])}
                        {this.renderFreshnessCard('Géocaches', [
                            { label: 'Total importé', value: String(this.freshness.geocaches?.total ?? 0) },
                            { label: 'Trouvées', value: String(this.freshness.geocaches?.found ?? 0) },
                            { label: 'Zone « Amis »', value: String(this.freshness.geocaches?.in_friends_zone ?? 0) },
                        ])}
                    </div>
                )}

                {!this.freshnessLoading && !this.freshness && (
                    <div style={{ color: 'var(--theia-descriptionForeground)' }}>
                        Cliquez sur le bouton pour charger l'état des données.
                    </div>
                )}
            </div>
        );
    }

    protected renderFreshnessCard(
        title: string,
        items: { label: string; value: string; stale?: boolean }[]
    ): React.ReactNode {
        return (
            <div style={{
                flex: '1 1 200px',
                padding: '10px',
                border: '1px solid var(--theia-panel-border)',
                borderRadius: '4px',
            }}>
                <div style={{ fontWeight: 'bold', marginBottom: '6px', fontSize: '0.9em' }}>{title}</div>
                {items.map((item, i) => (
                    <div key={i} style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: '8px',
                        marginBottom: '2px',
                        color: 'var(--theia-descriptionForeground)',
                    }}>
                        <span>{item.label}</span>
                        <span style={{
                            color: item.stale ? 'var(--theia-errorForeground)' : 'var(--theia-foreground)',
                            fontWeight: item.stale ? 'bold' : 'normal',
                        }}>
                            {item.stale && <span className="codicon codicon-warning" style={{ fontSize: '0.85em', marginRight: '4px' }}></span>}
                            {item.value}
                        </span>
                    </div>
                ))}
            </div>
        );
    }

    // -------------------------------------------------- Notifications

    protected async refreshNotifications(): Promise<void> {
        const enabled = this.preferenceService.get<boolean>('geoApp.friends.notifications.enabled', false);
        if (!enabled) {
            this.notifications = [];
            this.notificationsCount = 0;
            return;
        }

        const minFriends = this.preferenceService.get<number>('geoApp.friends.notifications.minFriends', 1);
        try {
            const params = new URLSearchParams({ min_friends: String(minFriends), limit: '50' });
            const result = await this.apiClient.requestJson<FriendNotificationsResponse>(
                `/api/friends/notifications?${params}`,
                {},
                'Impossible de charger les notifications.',
            );
            if (result.success) {
                this.notifications = result.items || [];
                this.notificationsCount = result.count || 0;
            }
        } catch {
            // Silencieux : les notifications sont un bonus.
        }
        this.update();
    }

    protected async markNotificationsSeen(): Promise<void> {
        try {
            await this.apiClient.requestVoid('/api/friends/notifications/seen', { method: 'POST' });
            this.notifications = [];
            this.notificationsCount = 0;
            this.update();
        } catch {
            // Silencieux.
        }
    }

    protected renderNotifications(): React.ReactNode {
        const enabled = this.preferenceService.get<boolean>('geoApp.friends.notifications.enabled', false);
        if (!enabled) {
            return null;
        }

        if (this.notificationsCount === 0 && !this.notificationsVisible) {
            return null;
        }

        return (
            <div style={{ marginTop: '16px', borderTop: '1px solid var(--theia-panel-border)', paddingTop: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                    <span className="codicon codicon-bell"></span>
                    <strong>Notifications</strong>
                    {this.notificationsCount > 0 && (
                        <span style={{
                            fontSize: '0.75em',
                            fontWeight: 'bold',
                            color: 'white',
                            backgroundColor: 'var(--theia-charts-red)',
                            borderRadius: '10px',
                            padding: '1px 8px',
                        }}>
                            {this.notificationsCount}
                        </span>
                    )}
                    <div style={{ flex: 1 }}></div>
                    {this.notificationsCount > 0 && (
                        <button
                            className="theia-button secondary"
                            onClick={() => this.markNotificationsSeen()}
                            title="Marquer toutes les notifications comme lues"
                        >
                            <span className="codicon codicon-check"></span>
                            {' Marquer comme lu'}
                        </button>
                    )}
                    <button
                        className="theia-button secondary"
                        onClick={() => { this.notificationsVisible = !this.notificationsVisible; this.update(); }}
                        title={this.notificationsVisible ? 'Replier' : 'Déplier'}
                    >
                        <span className={`codicon codicon-chevron-${this.notificationsVisible ? 'up' : 'down'}`}></span>
                    </button>
                </div>

                {this.notificationsVisible && (
                    <>
                        {this.notificationsLoading && (
                            <div style={{ color: 'var(--theia-descriptionForeground)' }}>Chargement…</div>
                        )}

                        {!this.notificationsLoading && this.notifications.length === 0 && (
                            <div style={{ color: 'var(--theia-descriptionForeground)' }}>
                                Aucune nouvelle trouvaille d'ami depuis votre dernière visite.
                            </div>
                        )}

                        {this.notifications.length > 0 && (
                            <div>
                                {this.notifications.map(n => this.renderNotification(n))}
                            </div>
                        )}
                    </>
                )}
            </div>
        );
    }

    protected renderNotification(n: FriendNotification): React.ReactNode {
        const cacheUrl = n.geocache_id > 0
            ? undefined
            : `https://www.geocaching.com/geocache/${n.gc_code}`;

        return (
            <div
                key={n.gc_code}
                style={{
                    display: 'flex',
                    gap: '10px',
                    padding: '10px 0',
                    borderBottom: '1px solid var(--theia-panel-border)'
                }}
            >
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <span
                            className="codicon codicon-people"
                            style={{ color: 'var(--theia-charts-blue)', fontSize: '0.9em' }}
                        ></span>
                        <strong style={{ color: 'var(--theia-charts-blue)' }}>{n.friends_count}</strong>
                        {cacheUrl ? (
                            <a href={cacheUrl} target="_blank" rel="noreferrer" title="Ouvrir sur geocaching.com">
                                {n.name}
                            </a>
                        ) : (
                            <span>{n.name}</span>
                        )}
                        <span style={{ color: 'var(--theia-descriptionForeground)', fontSize: '0.85em' }}>
                            {n.gc_code}
                        </span>
                    </div>

                    <div style={{
                        fontSize: '0.8em',
                        color: 'var(--theia-descriptionForeground)',
                        display: 'flex',
                        gap: '10px',
                        flexWrap: 'wrap',
                        marginTop: '2px'
                    }}>
                        {n.cache_type && <span>{n.cache_type}</span>}
                        {n.difficulty !== null && n.terrain !== null && (
                            <span>{`D ${n.difficulty} / T ${n.terrain}`}</span>
                        )}
                        {n.favorites_count > 0 && (
                            <span title="Points favoris" style={{ color: 'var(--theia-charts-red)' }}>
                                <span className="codicon codicon-heart-filled" style={{ fontSize: '0.9em' }}></span>
                                {` ${n.favorites_count}`}
                            </span>
                        )}
                    </div>

                    <div style={{
                        fontSize: '0.8em',
                        color: 'var(--theia-descriptionForeground)',
                        marginTop: '2px'
                    }}>
                        {n.friends.join(', ')}
                    </div>
                </div>
            </div>
        );
    }

    // -------------------------------------------------- Events

    protected async refreshEvents(): Promise<void> {
        this.eventsLoading = true;
        this.update();
        try {
            const result = await this.apiClient.requestJson<FriendEventsResponse>(
                '/api/friends/events?limit=100',
                {},
                'Impossible de charger les événements.',
            );
            if (result.success) {
                this.events = result.items || [];
                this.eventsCount = result.count || 0;
                this.eventsUpcomingCount = result.upcoming_count || 0;
                this.eventsPastCount = result.past_count || 0;
            }
        } catch {
            // Silencieux.
        } finally {
            this.eventsLoading = false;
            this.update();
        }
    }

    protected renderEvents(): React.ReactNode {
        if (this.eventsCount === 0 && !this.eventsVisible) {
            return null;
        }

        return (
            <div style={{ marginTop: '16px', borderTop: '1px solid var(--theia-panel-border)', paddingTop: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                    <span className="codicon codicon-calendar"></span>
                    <strong>Events</strong>
                    {this.eventsUpcomingCount > 0 && (
                        <span style={{
                            fontSize: '0.75em',
                            fontWeight: 'bold',
                            color: 'white',
                            backgroundColor: 'var(--theia-charts-green)',
                            borderRadius: '10px',
                            padding: '1px 8px',
                        }} title="Events à venir">
                            {this.eventsUpcomingCount}
                        </span>
                    )}
                    {this.eventsPastCount > 0 && (
                        <span style={{
                            fontSize: '0.75em',
                            color: 'var(--theia-descriptionForeground)',
                        }}>
                            {`${this.eventsPastCount} passé(s)`}
                        </span>
                    )}
                    <div style={{ flex: 1 }}></div>
                    <button
                        className="theia-button secondary"
                        onClick={() => { this.eventsVisible = !this.eventsVisible; this.update(); }}
                        title={this.eventsVisible ? 'Replier' : 'Déplier'}
                    >
                        <span className={`codicon codicon-chevron-${this.eventsVisible ? 'up' : 'down'}`}></span>
                    </button>
                </div>

                {this.eventsVisible && (
                    <>
                        {this.eventsLoading && (
                            <div style={{ color: 'var(--theia-descriptionForeground)' }}>Chargement…</div>
                        )}

                        {!this.eventsLoading && this.events.length === 0 && (
                            <div style={{ color: 'var(--theia-descriptionForeground)' }}>
                                Aucun event d'ami dans le flux d'activité.
                            </div>
                        )}

                        {this.events.length > 0 && (
                            <div>
                                {this.events.map(e => this.renderEvent(e))}
                            </div>
                        )}
                    </>
                )}
            </div>
        );
    }

    protected renderEvent(e: FriendEvent): React.ReactNode {
        const cacheUrl = e.gc_code
            ? `https://www.geocaching.com/geocache/${e.gc_code}`
            : undefined;

        const formattedDate = e.event_date
            ? new Date(e.event_date).toLocaleDateString('fr-FR', {
                weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
            })
            : 'Date inconnue';

        return (
            <div
                key={(e.gc_code || '') + (e.name || '')}
                style={{
                    display: 'flex',
                    gap: '10px',
                    padding: '10px 0',
                    borderBottom: '1px solid var(--theia-panel-border)'
                }}
            >
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <span
                            className="codicon codicon-people"
                            style={{ color: 'var(--theia-charts-blue)', fontSize: '0.9em' }}
                        ></span>
                        <strong style={{ color: 'var(--theia-charts-blue)' }}>{e.friends_count}</strong>
                        {cacheUrl ? (
                            <a href={cacheUrl} target="_blank" rel="noreferrer" title="Ouvrir sur geocaching.com">
                                {e.name}
                            </a>
                        ) : (
                            <span>{e.name}</span>
                        )}
                        {e.gc_code && (
                            <span style={{ color: 'var(--theia-descriptionForeground)', fontSize: '0.85em' }}>
                                {e.gc_code}
                            </span>
                        )}
                    </div>

                    <div style={{
                        fontSize: '0.8em',
                        color: 'var(--theia-descriptionForeground)',
                        display: 'flex',
                        gap: '10px',
                        flexWrap: 'wrap',
                        marginTop: '2px'
                    }}>
                        <span style={{ color: e.is_upcoming ? 'var(--theia-charts-green)' : 'var(--theia-descriptionForeground)' }}>
                            {e.is_upcoming ? 'À venir' : 'Passé'}
                        </span>
                        <span>{formattedDate}</span>
                        {e.location_name && <span>{e.location_name}</span>}
                    </div>

                    <div style={{
                        fontSize: '0.8em',
                        color: 'var(--theia-descriptionForeground)',
                        marginTop: '2px'
                    }}>
                        {e.friends.join(', ')}
                    </div>
                </div>
            </div>
        );
    }

    protected renderToolbar(): React.ReactNode {
        return (
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                <select
                    className="theia-input"
                    value={this.authorFilter}
                    onChange={e => { this.authorFilter = e.target.value; this.applyFilters(); }}
                    disabled={this.loading || !this.loaded}
                    title="Filtrer par ami"
                >
                    <option value="">Tous les amis</option>
                    {this.authors.map(author => (
                        <option key={author.username} value={author.username}>
                            {`${author.username} (${author.count})`}
                        </option>
                    ))}
                </select>

                <select
                    className="theia-input"
                    value={this.typeFilter}
                    onChange={e => { this.typeFilter = e.target.value; this.applyFilters(); }}
                    disabled={this.loading || !this.loaded}
                    title="Filtrer par type de log"
                >
                    {LOG_TYPE_FILTERS.map(filter => (
                        <option key={filter.id} value={filter.id}>{filter.label}</option>
                    ))}
                </select>

                <label
                    style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '0.9em' }}
                    title="Le flux « communauté » de geocaching.com inclut aussi vos propres logs"
                >
                    <input
                        type="checkbox"
                        checked={this.includeSelf}
                        onChange={e => { this.includeSelf = e.target.checked; this.applyFilters(); }}
                        disabled={this.loading || !this.loaded}
                    />
                    Mes logs
                </label>

                <div style={{ flex: 1 }}></div>

                <select
                    className="theia-input"
                    value={this.mapSource}
                    onChange={e => { this.mapSource = e.target.value as MapSource; this.showOnMap(); }}
                    disabled={this.mapLoading || !this.loaded}
                    title="Ce que la carte affiche"
                >
                    {MAP_SOURCES.map(source => (
                        <option key={source.id} value={source.id}>{source.label}</option>
                    ))}
                </select>

                <button
                    className="theia-button secondary"
                    onClick={() => this.showOnMap(true)}
                    disabled={this.mapLoading || !this.loaded}
                    title="Afficher les découvertes de vos amis sur une carte"
                >
                    <span className="codicon codicon-globe"></span>
                    {this.mapLoading ? ' Carte…' : ' Carte'}
                </button>

                <select
                    className="theia-input"
                    value={String(this.syncDays)}
                    onChange={e => { this.syncDays = Number(e.target.value); this.update(); }}
                    disabled={this.syncing}
                    title="Profondeur de la synchronisation"
                >
                    <option value="7">7 jours</option>
                    <option value="14">14 jours</option>
                    <option value="30">30 jours</option>
                </select>

                <button
                    className="theia-button"
                    onClick={() => this.sync()}
                    disabled={this.syncing}
                    title="Récupérer les nouvelles activités depuis geocaching.com"
                >
                    <span className="codicon codicon-cloud-download"></span>
                    {this.syncing ? ' Synchronisation…' : ' Synchroniser'}
                </button>
            </div>
        );
    }

    protected renderNotices(): React.ReactNode {
        const notices: React.ReactNode[] = [];

        if (this.error) {
            notices.push(
                <div key="error" style={{
                    padding: '12px',
                    marginBottom: '12px',
                    backgroundColor: this.notAuthenticated
                        ? 'var(--theia-inputValidation-warningBackground)'
                        : 'var(--theia-inputValidation-errorBackground)',
                    borderRadius: '4px'
                }}>
                    <span className={`codicon ${this.notAuthenticated ? 'codicon-key' : 'codicon-error'}`}></span>
                    {` ${this.error}`}
                </div>
            );
        }

        if (this.syncMessage && !this.error) {
            notices.push(
                <div key="sync" style={{
                    padding: '8px 12px',
                    marginBottom: '12px',
                    backgroundColor: 'var(--theia-inputValidation-infoBackground)',
                    borderRadius: '4px',
                    fontSize: '0.9em'
                }}>
                    <span className="codicon codicon-check"></span>
                    {` ${this.syncMessage}`}
                </div>
            );
        }

        if (this.mapMessage) {
            notices.push(
                <div key="map" style={{
                    padding: '8px 12px',
                    marginBottom: '12px',
                    backgroundColor: 'var(--theia-inputValidation-infoBackground)',
                    borderRadius: '4px',
                    fontSize: '0.9em'
                }}>
                    <span className="codicon codicon-globe"></span>
                    {` ${this.mapMessage}`}
                </div>
            );
        }

        // Le flux n'est pas exhaustif, et rien dans son contenu ne le dit :
        // geocaching.com regroupe les trouvailles d'affilée en une seule entrée
        // dont il ne nomme qu'une cache. Les DNF, presque toujours isolés,
        // apparaissent tous — d'où l'impression que les trouvailles manquent.
        if (this.condensedHidden > 0) {
            notices.push(
                <div key="condensed" style={{
                    padding: '8px 12px',
                    marginBottom: '12px',
                    backgroundColor: 'var(--theia-inputValidation-warningBackground)',
                    borderRadius: '4px',
                    fontSize: '0.9em'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span className="codicon codicon-fold"></span>
                        <span style={{ flex: 1, minWidth: '240px' }}>
                            {`${this.condensedHidden} trouvaille(s) regroupée(s) par geocaching.com : `}
                            {'seule une cache par groupe est nommée dans le flux. '}
                            {this.authorFilter
                                ? `Récupérez la liste complète de ${this.authorFilter} depuis son profil.`
                                : 'Choisissez un ami ci-dessus pour récupérer sa liste complète depuis son profil.'}
                        </span>
                        {this.authorFilter && (
                            <button
                                className="theia-button"
                                onClick={() => this.fetchProfileFinds()}
                                disabled={this.profileSyncing}
                                title={`Récupérer les trouvailles de ${this.authorFilter} depuis son profil geocaching.com`}
                            >
                                {this.profileSyncing ? 'Récupération…' : 'Compléter depuis le profil'}
                            </button>
                        )}
                    </div>
                </div>
            );
        }

        // Trouvailles connues mais non plaçables : la déduction par zone ne les a
        // pas géolocalisées (lignes antérieures aux colonnes de coordonnées) et
        // la cache n'est pas importée. Un import les rend plaçables.
        if (this.importableCount > 0 || this.importing) {
            notices.push(
                <div key="import" style={{
                    padding: '8px 12px',
                    marginBottom: '12px',
                    backgroundColor: 'var(--theia-inputValidation-infoBackground)',
                    borderRadius: '4px',
                    fontSize: '0.9em',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    flexWrap: 'wrap'
                }}>
                    {this.importing ? (
                        <React.Fragment>
                            <span className="codicon codicon-cloud-download"></span>
                            <span style={{ flex: 1, minWidth: '200px' }}>{this.importProgress}</span>
                            <button className="theia-button secondary" onClick={() => this.cancelImport()}>
                                Arrêter
                            </button>
                        </React.Fragment>
                    ) : (
                        <React.Fragment>
                            <span className="codicon codicon-location"></span>
                            <span style={{ flex: 1, minWidth: '200px' }}>
                                {`${this.importableCount} géocache(s) trouvée(s) par vos amis ne sont pas dans GeoApp `}
                                {'— sans elles, ces trouvailles ne peuvent pas être placées sur la carte.'}
                            </span>
                            <button className="theia-button" onClick={() => this.importMissingFinds()}>
                                Importer dans « Amis »
                            </button>
                        </React.Fragment>
                    )}
                </div>
            );
        } else if (this.importProgress && !this.importing) {
            notices.push(
                <div key="import-done" style={{
                    padding: '8px 12px',
                    marginBottom: '12px',
                    backgroundColor: 'var(--theia-inputValidation-infoBackground)',
                    borderRadius: '4px',
                    fontSize: '0.9em'
                }}>
                    <span className="codicon codicon-check"></span>
                    {` ${this.importProgress}`}
                </div>
            );
        }

        if (this.lastSyncAt) {
            notices.push(
                <div key="last" style={{
                    marginBottom: '12px',
                    fontSize: '0.85em',
                    color: 'var(--theia-descriptionForeground)'
                }}>
                    {`Dernière synchronisation : ${new Date(this.lastSyncAt).toLocaleString('fr-FR')}`}
                </div>
            );
        }

        return notices;
    }

    protected renderFeed(): React.ReactNode {
        if (this.loading && !this.loaded) {
            return <div style={{ color: 'var(--theia-descriptionForeground)' }}>Chargement du flux…</div>;
        }
        if (!this.loaded) {
            return null;
        }
        if (this.activities.length === 0) {
            return (
                <div style={{ color: 'var(--theia-descriptionForeground)' }}>
                    {this.lastSyncAt
                        ? 'Aucune activité pour ces filtres.'
                        : 'Aucune activité enregistrée : lancez une synchronisation.'}
                </div>
            );
        }

        return (
            <div>
                {this.groupByDay().map(group => (
                    <div key={group.day} style={{ marginBottom: '20px' }}>
                        <div style={{
                            fontWeight: 'bold',
                            textTransform: 'capitalize',
                            marginBottom: '8px',
                            paddingBottom: '4px',
                            borderBottom: '1px solid var(--theia-panel-border)'
                        }}>
                            {group.day}
                        </div>
                        {group.items.map(activity => this.renderActivity(activity))}
                    </div>
                ))}

                {this.activities.length < this.total && (
                    <button
                        className="theia-button secondary"
                        onClick={() => this.loadActivities(this.activities.length)}
                        disabled={this.loading}
                        style={{ width: '100%' }}
                    >
                        {this.loading ? 'Chargement…' : `Charger plus (${this.activities.length}/${this.total})`}
                    </button>
                )}
            </div>
        );
    }

    protected renderActivity(activity: FriendActivity): React.ReactNode {
        const expanded = this.expandedNotes.has(activity.id);
        const note = activity.note || '';
        const isLongNote = note.length > NOTE_PREVIEW_LENGTH;
        const visibleNote = expanded || !isLongNote ? note : `${note.slice(0, NOTE_PREVIEW_LENGTH)}…`;

        return (
            <div
                key={activity.id}
                style={{
                    display: 'flex',
                    gap: '10px',
                    padding: '10px 0',
                    borderBottom: '1px solid var(--theia-panel-border)'
                }}
            >
                {activity.author_avatar_url ? (
                    <img
                        src={activity.author_avatar_url}
                        alt=""
                        style={{ width: '36px', height: '36px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                    />
                ) : (
                    <div style={{
                        width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        backgroundColor: 'var(--theia-panel-border)'
                    }}>
                        <span className="codicon codicon-account"></span>
                    </div>
                )}

                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        {activity.log_type_id === 2 && <LogTypeIcon kind="found" size={14} />}
                        {activity.log_type_id === 3 && <LogTypeIcon kind="dnf" size={14} />}
                        <strong>{activity.author_username}</strong>
                        <span style={{ color: 'var(--theia-descriptionForeground)' }}>
                            {this.describeLogType(activity)}
                        </span>
                        {activity.action_url ? (
                            <a href={activity.action_url} target="_blank" rel="noreferrer" title="Ouvrir le log sur geocaching.com">
                                {activity.cache_name || activity.cache_reference_code}
                            </a>
                        ) : (
                            <span>{activity.cache_name || activity.cache_reference_code}</span>
                        )}
                        {activity.is_condensed && activity.condensed_count > 0 && (
                            <span style={{ color: 'var(--theia-descriptionForeground)' }}>
                                {`+ ${activity.condensed_count} autres`}
                            </span>
                        )}
                        {activity.is_self && (
                            <span style={{
                                fontSize: '0.75em',
                                padding: '0 6px',
                                borderRadius: '8px',
                                backgroundColor: 'var(--theia-panel-border)'
                            }}>
                                moi
                            </span>
                        )}
                    </div>

                    <div style={{
                        fontSize: '0.8em',
                        color: 'var(--theia-descriptionForeground)',
                        display: 'flex',
                        gap: '10px',
                        flexWrap: 'wrap',
                        marginTop: '2px'
                    }}>
                        {activity.cache_reference_code && <span>{activity.cache_reference_code}</span>}
                        {activity.difficulty !== null && activity.terrain !== null && (
                            <span>{`D ${activity.difficulty} / T ${activity.terrain}`}</span>
                        )}
                        {activity.location_name && (
                            <span>
                                <span className="codicon codicon-location" style={{ fontSize: '0.9em' }}></span>
                                {` ${activity.location_name}`}
                            </span>
                        )}
                        {!!activity.favorite_points && activity.favorite_points > 0 && (
                            <span title="Point favori attribué" style={{ color: 'var(--theia-charts-red)' }}>
                                <span className="codicon codicon-heart-filled" style={{ fontSize: '0.9em' }}></span>
                                {` ${activity.favorite_points}`}
                            </span>
                        )}
                        {!!activity.image_count && activity.image_count > 0 && (
                            <span title="Photos jointes au log">
                                <span className="codicon codicon-device-camera" style={{ fontSize: '0.9em' }}></span>
                                {` ${activity.image_count}`}
                            </span>
                        )}
                        {activity.is_archived && (
                            <span style={{ color: 'var(--theia-errorForeground)' }}>archivée</span>
                        )}
                    </div>

                    {note && (
                        <div style={{ marginTop: '6px', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
                            {visibleNote}
                            {isLongNote && (
                                <button
                                    className="theia-button secondary"
                                    style={{ marginLeft: '8px', padding: '0 6px', fontSize: '0.8em' }}
                                    onClick={() => {
                                        if (expanded) {
                                            this.expandedNotes.delete(activity.id);
                                        } else {
                                            this.expandedNotes.add(activity.id);
                                        }
                                        this.update();
                                    }}
                                >
                                    {expanded ? 'Réduire' : 'Voir plus'}
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        );
    }
}
