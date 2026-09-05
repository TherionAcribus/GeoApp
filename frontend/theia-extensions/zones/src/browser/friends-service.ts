import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter, Event as TheiaEvent } from '@theia/core/lib/common/event';
import { BackendApiClient } from './backend-api-client';
import type {
    GeocachingFriend,
    FriendsResponse,
    FriendActivity,
    ActivityResponse,
    FriendMapResponse,
    FriendFindsMapResponse,
    FriendSuggestionsResponse,
    FriendStatsResponse,
    FreshnessResponse,
    FriendNotificationsResponse,
    FriendEventsResponse,
    FriendZoneScanEntry,
    FriendScanStreamEvent,
    FriendFinder,
} from './friends-types';

/**
 * Service centralisé pour la fonctionnalité Amis.
 *
 * Avant ce service, chaque widget (`geocaching-friends-widget`,
 * `geocaching-friend-activity-widget`, `zone-geocaches-widget`,
 * `geocache-friend-finds-banner`) faisait ses propres `fetch` vers
 * `/api/friends/*` avec sa propre gestion d'erreurs et son propre cache. Ce
 * service centralise :
 *
 * - Tous les appels API (`/api/friends/*`), via `BackendApiClient`.
 * - Un cache partagé de la liste d'amis, avec un `Emitter` pour notifier les
 *   widgets quand elle change (synchro, ajout, suppression…). Un widget qui
 *   affiche la liste n'a plus besoin de la re-fetcher si un autre l'a déjà fait.
 * - Les méthodes de streaming (sync-zone-stream, import) qui retournent la
 *   `Response` brute pour consommation NDJSON par l'appelant.
 *
 * Le service ne détient **pas** l'état métier de chaque widget (activité,
 * suggestions, stats…) : ces données sont propres à chaque vue et n'ont pas
 * vocation à être partagées. Seule la liste d'amis est partagée, car elle est
 * lue par plusieurs widgets et coûteuse à récupérer.
 */
@injectable()
export class FriendsService {
    /** Messages d'erreur des lectures de zone : partagés entre le fallback HTTP
     *  et le rejet sur `success: false`, pour que l'utilisateur voie la même
     *  phrase quelle que soit la façon dont l'appel a échoué. */
    protected static readonly ZONE_FINDS_ERROR = "Impossible de charger les trouvailles d'amis pour cette zone.";
    protected static readonly ZONE_SCANS_ERROR = "Impossible de charger l'état des scans.";

    protected readonly onDidChangeFriendsEmitter = new Emitter<GeocachingFriend[]>();
    /** Émis quand la liste d'amis est (re)chargée. */
    readonly onDidChangeFriends: TheiaEvent<GeocachingFriend[]> = this.onDidChangeFriendsEmitter.event;

    /** Cache de la liste d'amis. `null` = jamais chargée. */
    protected friendsCache: GeocachingFriend[] | null = null;
    protected friendsFetchedAt: string | null = null;
    protected friendsLoading: Promise<FriendsResponse> | null = null;
    /** Dernière réponse complète (pour `pending_requests`, `truncated`…). */
    protected lastFriendsResponse: FriendsResponse | null = null;

    constructor(
        @inject(BackendApiClient) protected readonly apiClient: BackendApiClient
    ) {}

    // -------------------------------------------------- Liste d'amis

    /**
     * Charge la liste d'amis. Utilise le cache si `force` est faux et que la
     * liste a déjà été chargée. Retourne la réponse complète (`success`,
     * `friends`, `pending_requests`, `truncated`…).
     *
     * Plusieurs widgets peuvent appeler `getFriends()` simultanément au
     * démarrage : un seul `fetch` partira, les autres attendront le même
     * `Promise`.
     */
    async getFriends(force: boolean = false): Promise<FriendsResponse> {
        if (!force && this.lastFriendsResponse) {
            return this.lastFriendsResponse;
        }
        if (this.friendsLoading) {
            return this.friendsLoading;
        }

        this.friendsLoading = this.fetchFriends(force);
        try {
            return await this.friendsLoading;
        } finally {
            this.friendsLoading = null;
        }
    }

    /** Liste d'amis en cache, ou `null` si jamais chargée. */
    getCachedFriends(): GeocachingFriend[] | null {
        return this.friendsCache;
    }

    /** Date de dernière récupération de la liste, ou `null`. */
    getFriendsFetchedAt(): string | null {
        return this.friendsFetchedAt;
    }

    /** Invalide le cache (sans re-fetch). Le prochain `getFriends` ira au backend. */
    invalidateFriends(): void {
        this.friendsCache = null;
        this.friendsFetchedAt = null;
        this.lastFriendsResponse = null;
    }

    protected async fetchFriends(force: boolean): Promise<FriendsResponse> {
        const result = await this.apiClient.requestJson<FriendsResponse>(
            `/api/friends${force ? '?force=true' : ''}`,
            {},
            'Impossible de récupérer la liste des amis',
        );

        this.lastFriendsResponse = result;
        if (result.success && result.friends) {
            this.friendsCache = result.friends;
            this.friendsFetchedAt = result.fetched_at ?? null;
            this.onDidChangeFriendsEmitter.fire(this.friendsCache);
        }
        return result;
    }

    // -------------------------------------------------- Flux d'activité

    async loadActivities(offset: number, buildQuery: (offset: number) => string): Promise<ActivityResponse> {
        return this.apiClient.requestJson<ActivityResponse>(
            `/api/friends/activity?${buildQuery(offset)}`,
            {},
            "Impossible de charger l'activité des amis",
        );
    }

    async syncActivity(days: number): Promise<{
        success: boolean; error?: string; error_message?: string;
        created: number; finds_projected?: number;
    }> {
        return this.apiClient.requestJson(
            '/api/friends/activity/sync',
            this.apiClient.createJsonInit('POST', { days }),
            'Échec de la synchronisation',
        );
    }

    // -------------------------------------------------- Carte

    async fetchActivityMap(params: URLSearchParams): Promise<FriendMapResponse> {
        return this.apiClient.requestJson<FriendMapResponse>(
            `/api/friends/activity/map?${params.toString()}`,
            {},
            'Impossible de charger la carte des amis.',
        );
    }

    async fetchFindsMap(params: URLSearchParams): Promise<FriendFindsMapResponse> {
        return this.apiClient.requestJson<FriendFindsMapResponse>(
            `/api/friends/finds/map?${params.toString()}`,
            {},
            'Impossible de charger la carte des trouvailles.',
        );
    }

    // -------------------------------------------------- Suggestions / Stats / Freshness

    async loadSuggestions(params: URLSearchParams): Promise<FriendSuggestionsResponse> {
        return this.apiClient.requestJson<FriendSuggestionsResponse>(
            `/api/friends/finds/suggestions?${params.toString()}`,
            {},
            'Impossible de charger les suggestions.',
        );
    }

    async loadStats(): Promise<FriendStatsResponse> {
        return this.apiClient.requestJson<FriendStatsResponse>(
            '/api/friends/stats',
            {},
            'Impossible de charger les statistiques.',
        );
    }

    async loadFreshness(): Promise<FreshnessResponse> {
        return this.apiClient.requestJson<FreshnessResponse>(
            '/api/friends/freshness',
            {},
            'Impossible de charger l\'état de fraîcheur.',
        );
    }

    // -------------------------------------------------- Notifications / Events

    async loadNotifications(params: URLSearchParams): Promise<FriendNotificationsResponse> {
        return this.apiClient.requestJson<FriendNotificationsResponse>(
            `/api/friends/notifications?${params.toString()}`,
            {},
            'Impossible de charger les notifications.',
        );
    }

    async markNotificationsSeen(): Promise<void> {
        await this.apiClient.requestVoid('/api/friends/notifications/seen', { method: 'POST' });
    }

    async loadEvents(limit: number = 100): Promise<FriendEventsResponse> {
        return this.apiClient.requestJson<FriendEventsResponse>(
            `/api/friends/events?limit=${limit}`,
            {},
            'Impossible de charger les événements.',
        );
    }

    // -------------------------------------------------- Trouvailles d'un ami

    /**
     * Estime le coût de récupération de toutes les trouvailles d'un ami.
     * Retourne `undefined` si l'estimation n'est pas disponible (silencieux).
     */
    async estimateFriendFinds(friend: string): Promise<{
        success: boolean; total?: number; reachable?: number; seconds?: number;
    } | undefined> {
        try {
            return await this.apiClient.requestJson(
                `/api/friends/finds/friend/${encodeURIComponent(friend)}/estimate`,
                {},
                'Estimation indisponible.',
            );
        } catch {
            return undefined;
        }
    }

    async syncFriendFinds(friend: string): Promise<{
        success: boolean; error?: string; error_message?: string;
        fetched: number; created: number; truncated?: boolean;
    }> {
        return this.apiClient.requestJson(
            '/api/friends/finds/sync-friend',
            this.apiClient.createJsonInit('POST', { friend }),
            'Échec de la récupération des trouvailles.',
        );
    }

    // -------------------------------------------------- Streaming (NDJSON)

    /**
     * Démarre l'import des trouvailles manquantes. Retourne la `Response` brute
     * pour que l'appelant consomme le flux NDJSON ligne par ligne.
     */
    async startImportStream(signal: AbortSignal): Promise<Response> {
        const response = await this.apiClient.request(
            '/api/friends/finds/import',
            this.apiClient.createJsonInit('POST', {}, { signal })
        );
        await this.apiClient.ensureOk(response, 'Échec de l\'import des trouvailles.');
        return response;
    }

    /**
     * Démarre l'analyse streaming d'une zone. Retourne la `Response` brute pour
     * consommation NDJSON. L'appelant parse chaque ligne comme un
     * `FriendScanStreamEvent`.
     */
    async startZoneScanStream(
        zoneId: number,
        options: { force_all?: boolean; friends?: string[]; gc_codes?: string[] } = {},
        signal?: AbortSignal,
    ): Promise<Response> {
        const response = await this.apiClient.request(
            '/api/friends/finds/sync-zone-stream',
            this.apiClient.createJsonInit('POST', {
                zone_id: zoneId,
                force_all: options.force_all ?? false,
                ...(options.friends ? { friends: options.friends } : {}),
                ...(options.gc_codes ? { gc_codes: options.gc_codes } : {}),
            }, signal ? { signal } : {}),
        );
        await this.apiClient.ensureOk(response, 'Échec de l\'analyse des amis.');
        return response;
    }

    // -------------------------------------------------- Zone finds / scans

    /**
     * « Qui a trouvé quoi » sur une zone : `{ code GC: [pseudos] }`.
     *
     * L'enveloppe `{ success, finds }` du backend est dépliée ici : les appelants
     * n'ont qu'une carte à consommer, et un `success: false` (HTTP 200) rejette au
     * même titre qu'une erreur réseau, pour qu'un seul `catch` chez l'appelant
     * suffise à conserver l'état précédent.
     */
    async loadZoneFinds(zoneId: number): Promise<Record<string, string[]>> {
        const result = await this.apiClient.requestJson<{
            success: boolean;
            error?: string;
            finds?: Record<string, string[]>;
        }>(
            `/api/friends/finds/zone/${zoneId}`,
            {},
            FriendsService.ZONE_FINDS_ERROR,
        );
        if (!result.success) {
            throw new Error(result.error ?? FriendsService.ZONE_FINDS_ERROR);
        }
        return result.finds ?? {};
    }

    /**
     * État des analyses par ami sur une zone (vérifié le…, obsolète, jamais
     * analysé). Même contrat que `loadZoneFinds` : enveloppe dépliée,
     * `success: false` transformé en rejet.
     */
    async loadZoneScans(zoneId: number): Promise<FriendZoneScanEntry[]> {
        const result = await this.apiClient.requestJson<{
            success: boolean;
            error?: string;
            scans?: FriendZoneScanEntry[];
        }>(
            `/api/friends/finds/zone/${zoneId}/scans`,
            {},
            FriendsService.ZONE_SCANS_ERROR,
        );
        if (!result.success) {
            throw new Error(result.error ?? FriendsService.ZONE_SCANS_ERROR);
        }
        return result.scans ?? [];
    }

    /**
     * Coût prévisible d'une analyse de zone : caches à balayer et durée estimée.
     *
     * Une zone géographiquement dispersée produit une boîte englobante démesurée ;
     * l'appelant s'en sert pour prévenir avant de lancer une analyse de vingt
     * minutes. Le backend répond en erreur HTTP quand il ne peut pas estimer
     * (non connecté, zone vide, throttling) : l'appel rejette alors.
     */
    async estimateZoneScan(zoneId: number): Promise<{
        success: boolean;
        zone_caches: number;
        searched_caches: number;
        clusters: number;
        seconds_per_friend: number;
        recommended_strategy: 'zone_search' | 'logbook';
        nb_friends: number;
    }> {
        return this.apiClient.requestJson(
            `/api/friends/finds/zone/${zoneId}/estimate`,
            {},
            'Estimation indisponible.',
        );
    }

    // -------------------------------------------------- Bandeau (fiche cache)

    async loadGeocacheFinds(geocacheId: number): Promise<{ success: boolean; friends?: FriendFinder[] }> {
        return this.apiClient.requestJson<{ success: boolean; friends?: FriendFinder[] }>(
            `/api/friends/finds/geocache/${geocacheId}`,
            {},
            'Impossible de charger les amis ayant trouvé cette géocache.',
        );
    }

    dispose(): void {
        this.onDidChangeFriendsEmitter.dispose();
    }
}
