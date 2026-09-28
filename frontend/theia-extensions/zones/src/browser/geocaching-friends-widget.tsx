import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget, Message, ConfirmDialog, Dialog } from '@theia/core/lib/browser';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { LogTypeIcon } from './geocache-log-type-icons';
import { MapWidgetFactory } from './map/map-widget-factory';
import { MapGeocache } from './map/map-layer-manager';
import { GeoAppWidgetEventsService } from './geoapp-widget-events-service';
import { BackendApiClient, BackendApiError, getErrorMessage } from './backend-api-client';
import { CommandService } from '@theia/core';
import { FriendsService } from './friends-service';
import { GeocacheTabsManager } from './geocache-tabs-manager';
import { FriendsListPanel } from './friends-list-panel';
import { FriendsTodoPanel } from './friends-todo-panel';
import { fetchFriendProfileFinds } from './friend-profile-finds';
import type {
    FriendActivity,
    FriendMapPoint,
    FriendMapResponse,
    FriendFindPoint,
    FriendFindsMapResponse,
    FriendSuggestion,
    FriendStat,
    FriendNotification,
    FriendEvent,
    GeocachingFriend,
    MapSource,
    AggregatedPoint,
} from './friends-types';

/** Les trois onglets du widget Amis. */
export type FriendsTab = 'friends' | 'activity' | 'todo';

const TABS: { id: FriendsTab; label: string; icon: string }[] = [
    { id: 'friends', label: 'Amis', icon: 'codicon-organization' },
    { id: 'activity', label: 'Activité', icon: 'codicon-pulse' },
    { id: 'todo', label: 'À faire', icon: 'codicon-lightbulb' },
];

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

const MAP_SOURCES: { id: MapSource; label: string }[] = [
    { id: 'activity', label: 'Carte : activité récente' },
    { id: 'finds', label: 'Carte : toutes leurs trouvailles' },
    { id: 'both', label: 'Carte : les deux' },
];

/**
 * Widget « Amis » : la liste du compte, le flux d'activité et ce qu'on peut en
 * tirer (events, caches à faire), en trois onglets.
 *
 * Il remplace deux widgets séparés (« Amis Geocaching.com » et « Activité des
 * amis ») dont le second avait accumulé cinq sections repliables sous sa
 * timeline. Un seul bouton « Mettre à jour » alimente tout : les sources de
 * données (§0 de amis-geocaching-technique.md) ne sont pas un concept que
 * l'utilisateur devrait avoir à connaître.
 */
@injectable()
export class GeocachingFriendsWidget extends ReactWidget {
    static readonly ID = 'geocaching-friends-widget';
    static readonly LABEL = 'Amis';

    @inject(PreferenceService)
    protected readonly preferenceService: PreferenceService;

    @inject(BackendApiClient)
    protected readonly apiClient: BackendApiClient;

    @inject(FriendsService)
    protected readonly friendsService: FriendsService;

    @inject(MapWidgetFactory)
    protected readonly mapWidgetFactory: MapWidgetFactory;

    @inject(GeoAppWidgetEventsService)
    protected readonly widgetEventsService: GeoAppWidgetEventsService;

    @inject(CommandService)
    protected readonly commandService: CommandService;

    @inject(GeocacheTabsManager)
    protected readonly geocacheTabsManager: GeocacheTabsManager;

    /** Onglet affiché ; exposé pour le contexte de l'agent @Aide. */
    activeTab: FriendsTab = 'friends';

    /** Liste d'amis du compte (onglet « Amis »). */
    protected friends: GeocachingFriend[] = [];
    protected friendsLoading: boolean = false;
    protected friendsLoaded: boolean = false;
    protected friendsError: string | null = null;
    protected friendsTruncated: boolean = false;
    protected pendingRequests: number | null = null;

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
    protected suggestionsMinFriends: number = 1;
    /** Dernière erreur de chargement des suggestions ; la liste est conservée. */
    protected suggestionsError: string | null = null;

    /** Compteurs locaux par ami, affichés sur les cartes de l'onglet « Amis ». */
    protected stats = new Map<string, FriendStat>();

    /** Notifications de nouvelles trouvailles d'amis. */
    protected notifications: FriendNotification[] = [];
    protected notificationsCount: number = 0;
    protected notificationsVisible: boolean = false;

    /** Events geocaching auxquels des amis participent. */
    protected events: FriendEvent[] = [];

    @postConstruct()
    protected init(): void {
        this.id = GeocachingFriendsWidget.ID;
        this.title.label = GeocachingFriendsWidget.LABEL;
        this.title.caption = 'Vos amis Geocaching.com : liste, activité, caches à faire';
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-organization';
        this.addClass('geocaching-friends-widget');
        this.node.tabIndex = 0; // sinon Theia signale "did not accept focus after 2000ms"

        void this.fetchFriends();
        void this.loadStats();
        this.loadActivities()
            .then(() => this.autoSyncIfStale())
            .then(() => this.refreshImportableCount())
            .then(() => this.refreshNotifications())
            .then(() => this.refreshEvents());

        // (Re)connexion ou bascule de compte : recharger le flux. À la
        // déconnexion les données locales restent consultables — on ne les
        // efface pas, la prochaine synchro s'occupera du nouveau compte.
        window.addEventListener('geoapp-auth-changed', this.onAuthChanged);
        // Bandeau « hors ligne » : il apparaît/disparaît avec la joignabilité.
        this.connectivityDisposable = this.apiClient.onDidChangeConnectivity(() => this.update());
    }

    protected connectivityDisposable?: { dispose(): void };

    override dispose(): void {
        window.removeEventListener('geoapp-auth-changed', this.onAuthChanged);
        this.connectivityDisposable?.dispose();
        super.dispose();
    }

    /** Sonde le backend puis recharge le flux si la connexion est revenue. */
    protected retryConnection = async (): Promise<void> => {
        if (await this.apiClient.probeBackend()) {
            void this.loadActivities(0);
        } else {
            this.update();
        }
    };

    protected onAuthChanged = (event: Event): void => {
        // Déconnexion : inutile d'interroger le backend, l'état est connu. Les
        // données locales (flux, suggestions) restent consultables.
        if ((event as CustomEvent).detail?.isConnected === false) {
            this.friends = [];
            this.friendsLoaded = false;
            this.friendsError = 'Connectez-vous à Geocaching.com pour voir vos amis.';
            this.update();
            return;
        }
        if ((event as CustomEvent).detail?.isConnected === true) {
            void this.fetchFriends(true);
            void this.loadActivities(0);
        }
    };

    protected onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        if (!this.loaded && !this.loading) {
            this.loadActivities();
        }
    }

    /**
     * Affiche un onglet. Point d'entrée des commandes : `geoapp.friends.open`
     * (« Amis »), `geoapp.friends.activity.open` (« Activité »),
     * `geoapp.friends.todo.open` (« À faire »).
     */
    showTab(tab: FriendsTab): void {
        if (this.activeTab === tab) {
            return;
        }
        this.activeTab = tab;
        this.onTabShown(tab);
        this.update();
    }

    protected mapAutoOpened = false;

    /** Affichage d'un onglet : charge ce qu'il montre, une fois. */
    protected onTabShown(tab: FriendsTab): void {
        if (tab === 'todo' && this.suggestions.length === 0 && !this.suggestionsLoading) {
            void this.loadSuggestions();
        }
        // La carte accompagne l'onglet Activité : l'ouvrir dès l'onglet « Amis »
        // ferait surgir une carte sans rapport avec ce qu'on regarde.
        if (tab === 'activity' && !this.mapAutoOpened && !this.error
            && this.preferenceService.get<boolean>('geoApp.friends.map.autoLoad', true)) {
            this.mapAutoOpened = true;
            void this.showOnMap(true);
        }
    }

    /**
     * Filtre le flux sur un auteur précis et affiche l'onglet Activité.
     * La commande `geoapp.friends.activity.open` accepte `{ username }`
     * (bouton « Activité » d'une carte ami, par exemple).
     */
    async focusAuthor(username: string): Promise<void> {
        this.authorFilter = username;
        this.showTab('activity');
        await this.applyFilters();
    }

    // -------------------------------------------------- Liste d'amis

    protected async fetchFriends(force: boolean = false): Promise<void> {
        this.friendsLoading = true;
        this.friendsError = null;
        this.update();

        try {
            const result = await this.friendsService.getFriends(force);
            if (result.success && result.friends) {
                this.friends = result.friends;
                this.pendingRequests = result.pending_requests ?? null;
                this.friendsTruncated = result.truncated === true;
                this.friendsLoaded = true;
            } else {
                // Un rafraîchissement raté ne vide pas une liste déjà chargée.
                this.friendsError = result.error_message || result.error || 'Impossible de récupérer la liste des amis';
            }
        } catch (err) {
            if (err instanceof BackendApiError && err.status === 404) {
                this.friendsError = 'Route /api/friends introuvable : le backend GeoApp doit être redémarré.';
            } else {
                this.friendsError = getErrorMessage(err, 'Erreur de connexion au serveur GeoApp');
            }
            console.error('[Friends] Failed to fetch friends:', err);
        } finally {
            this.friendsLoading = false;
            this.update();
        }
    }

    /**
     * Première synchro automatique, pilotée par les mêmes préférences que le
     * scheduler backend : si l'utilisateur a désactivé l'automatisation,
     * ouvrir l'onglet ne doit pas la déclencher quand même.
     */
    protected async autoSyncIfStale(): Promise<void> {
        if (this.error || !this.apiClient.isBackendReachable()) {
            return;
        }
        if (!this.preferenceService.get<boolean>('geoApp.friends.activity.autoSync', true)) {
            return;
        }
        const intervalHours = Math.max(1,
            this.preferenceService.get<number>('geoApp.friends.activity.autoSyncIntervalHours', 1));
        const last = this.lastSyncAt ? new Date(this.lastSyncAt).getTime() : 0;
        if (!last || Date.now() - last > intervalHours * 3600 * 1000) {
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
            const result = await this.friendsService.loadActivities(offset, o => this.buildQuery(o));

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

    // Note : fetchMapJson reste ici car il est appelé avec des paths variables
    // (activity/map, finds/map, estimate) et une logique silent/bruyant. Les
    // méthodes du FriendsService pour la carte (fetchActivityMap, fetchFindsMap)
    // sont disponibles pour les futurs composants qui n'ont pas besoin de ce
    // niveau de contrôle.

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
     * « Récupérer toutes ses trouvailles » pour l'ami filtré : la réponse à la
     * condensation du flux (voir `fetchFriendProfileFinds`).
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
            const outcome = await fetchFriendProfileFinds(this.friendsService, friend);
            if (outcome.status === 'error') {
                this.notAuthenticated = outcome.notAuthenticated;
                this.error = outcome.message;
            } else if (outcome.status === 'done') {
                this.syncMessage = outcome.message;
                await this.showOnMap();
                await this.refreshImportableCount();
                void this.loadStats();
            }
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
        let response: Response;
        try {
            response = await this.friendsService.startImportStream(signal);
        } catch (err) {
            if ((err as BackendApiError)?.status === 401) {
                this.importProgress = 'Connectez-vous à Geocaching.com pour importer ces géocaches.';
                return;
            }
            throw err;
        }
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

    /**
     * « Mettre à jour » : le seul bouton de rafraîchissement du widget.
     *
     * Récupère le flux d'activité (profondeur réglée par la préférence
     * `geoApp.friends.activity.autoSyncDays`, comme la synchro automatique —
     * l'ancien sélecteur 7/14/30 jours faisait doublon et se confondait avec
     * un filtre d'affichage), recharge la liste d'amis, puis tout ce qui en
     * dépend : carte, compteurs, suggestions, events, notifications.
     */
    protected async sync(): Promise<void> {
        if (this.syncing) {
            return;
        }
        this.syncing = true;
        this.syncMessage = null;
        this.error = null;
        this.update();

        const days = Math.max(1, Math.min(30,
            this.preferenceService.get<number>('geoApp.friends.activity.autoSyncDays', 7)));

        try {
            void this.fetchFriends(true);
            const result = await this.friendsService.syncActivity(days);

            if (result.success) {
                const bits = [
                    result.created > 0
                        ? `${result.created} nouvelle(s) activité(s).`
                        : 'Aucune nouvelle activité.'
                ];
                if (result.finds_projected && result.finds_projected > 0) {
                    bits.push(`${result.finds_projected} trouvaille(s) d'amis ajoutée(s).`);
                }
                this.syncMessage = bits.join(' ');
                await this.loadActivities(0);
                await this.showOnMap();
                await this.refreshImportableCount();
                await this.refreshNotifications();
                await this.refreshEvents();
                void this.loadStats();
                if (this.activeTab === 'todo' || this.suggestions.length > 0) {
                    void this.loadSuggestions();
                }
            } else {
                this.notAuthenticated = result.error === 'not_authenticated';
                this.error = result.error_message || 'Échec de la mise à jour';
            }
        } catch (err) {
            this.error = getErrorMessage(err, 'Erreur de connexion au serveur GeoApp');
            console.error('[Friends] Update failed:', err);
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
                {this.renderHeader()}
                {this.renderNotices()}
                {this.activeTab === 'friends' && this.renderFriendsTab()}
                {this.activeTab === 'activity' && this.renderActivityTab()}
                {this.activeTab === 'todo' && this.renderTodoTab()}
            </div>
        );
    }

    /**
     * En-tête commun : onglets, bouton « Mettre à jour » et ligne d'état. La
     * ligne d'état remplace l'ancien panneau « Fraîcheur des données » : ce que
     * l'utilisateur veut savoir, c'est si c'est à jour, pas l'état de 4 tables.
     */
    protected renderHeader(): React.ReactNode {
        const upcomingEvents = this.events.filter(e => e.is_upcoming).length;
        const badge = (count: number, color: string, title: string): React.ReactNode => count > 0 && (
            <span
                style={{
                    fontSize: '0.8em', fontWeight: 'bold', color: 'white', backgroundColor: color,
                    borderRadius: '10px', padding: '0 7px', marginLeft: '6px'
                }}
                title={title}
            >
                {count}
            </span>
        );

        return (
            <div style={{ marginBottom: '12px' }}>
                <div style={{
                    display: 'flex', alignItems: 'flex-end', gap: '4px', flexWrap: 'wrap',
                    borderBottom: '1px solid var(--theia-panel-border)'
                }}>
                    {TABS.map(tab => {
                        const active = this.activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => this.showTab(tab.id)}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    borderBottom: `2px solid ${active ? 'var(--theia-focusBorder)' : 'transparent'}`,
                                    color: active ? 'var(--theia-foreground)' : 'var(--theia-descriptionForeground)',
                                    fontWeight: active ? 'bold' : 'normal',
                                    padding: '6px 12px',
                                    cursor: 'pointer',
                                    fontSize: '1em',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px'
                                }}
                            >
                                <span className={`codicon ${tab.icon}`}></span>
                                {tab.label}
                                {tab.id === 'friends' && this.friendsLoaded && (
                                    <span style={{ fontWeight: 'normal', color: 'var(--theia-descriptionForeground)' }}>
                                        {`(${this.friends.length})`}
                                    </span>
                                )}
                                {tab.id === 'activity' && badge(this.notificationsCount, 'var(--theia-charts-red)',
                                    `${this.notificationsCount} nouvelle(s) trouvaille(s) d'ami(s) depuis votre dernière visite`)}
                                {tab.id === 'todo' && badge(upcomingEvents, 'var(--theia-charts-green)',
                                    `${upcomingEvents} event(s) à venir avec vos amis`)}
                            </button>
                        );
                    })}
                    <div style={{ flex: 1 }}></div>
                    <button
                        className="theia-button"
                        style={{ marginBottom: '4px' }}
                        onClick={() => this.sync()}
                        disabled={this.syncing || !this.apiClient.isBackendReachable()}
                        title="Récupérer depuis geocaching.com la liste de vos amis et leur activité récente"
                    >
                        <span className="codicon codicon-cloud-download"></span>
                        {this.syncing ? ' Mise à jour…' : ' Mettre à jour'}
                    </button>
                </div>
                <div style={{ marginTop: '6px', fontSize: '0.85em', color: 'var(--theia-descriptionForeground)' }}>
                    {this.renderStatusLine()}
                </div>
            </div>
        );
    }

    protected renderStatusLine(): React.ReactNode {
        if (this.syncing) {
            return 'Mise à jour en cours…';
        }
        if (this.importing) {
            return (
                <span>
                    <span className="codicon codicon-cloud-download" style={{ fontSize: '0.9em' }}></span>
                    {` Import : ${this.importProgress || '…'} `}
                    <a style={{ cursor: 'pointer' }} onClick={() => this.cancelImport()}>Arrêter</a>
                </span>
            );
        }
        const parts: string[] = [];
        if (this.lastSyncAt) {
            parts.push(`Mis à jour ${this.formatRelativeTime(this.lastSyncAt)}`);
        } else if (this.loaded) {
            parts.push('Jamais mis à jour');
        }
        if (this.syncMessage) {
            parts.push(this.syncMessage);
        } else if (this.importProgress) {
            parts.push(this.importProgress);
        }
        return parts.join(' · ');
    }

    protected renderFriendsTab(): React.ReactNode {
        return (
            <>
                {this.friendsError && (
                    <div style={{ ...this.noticeStyle('warning'), marginBottom: '12px' }}>
                        <span className="codicon codicon-warning"></span>
                        {` ${this.friendsError}`}
                        {this.friendsLoaded && ' — liste précédente conservée.'}
                        <button
                            className="theia-button secondary"
                            style={{ marginLeft: '8px' }}
                            onClick={() => this.fetchFriends(true)}
                            disabled={this.friendsLoading}
                        >
                            Réessayer
                        </button>
                    </div>
                )}
                {this.friendsTruncated && (
                    <div style={{ ...this.noticeStyle('warning'), marginBottom: '12px' }}>
                        <span className="codicon codicon-warning"></span>
                        {' La page geocaching.com est paginée : tous vos amis ne sont pas affichés.'}
                    </div>
                )}
                {!!this.pendingRequests && (
                    <div style={{ ...this.noticeStyle('info'), marginBottom: '12px' }}>
                        <span className="codicon codicon-mail"></span>
                        {` ${this.pendingRequests} demande(s) d'ami en attente sur geocaching.com.`}
                    </div>
                )}
                <FriendsListPanel
                    friends={this.friends}
                    stats={this.stats}
                    loading={this.friendsLoading}
                    loaded={this.friendsLoaded}
                    onOpenSummary={username => this.commandService.executeCommand('geoapp.friends.summary.open', { username })}
                    onShowActivity={username => void this.focusAuthor(username)}
                />
            </>
        );
    }

    protected renderActivityTab(): React.ReactNode {
        return (
            <>
                {this.renderToolbar()}
                {this.renderActivityNotices()}
                {this.renderNotifications()}
                {this.renderFeed()}
            </>
        );
    }

    protected renderTodoTab(): React.ReactNode {
        return (
            <FriendsTodoPanel
                suggestions={this.suggestions}
                suggestionsLoading={this.suggestionsLoading}
                suggestionsError={this.suggestionsError}
                minFriends={this.suggestionsMinFriends}
                onMinFriendsChange={value => { this.suggestionsMinFriends = value; void this.loadSuggestions(); }}
                events={this.events}
                importableCount={this.importableCount}
                importing={this.importing}
                importProgress={this.importProgress}
                onImport={() => void this.importMissingFinds()}
                onCancelImport={() => this.cancelImport()}
                onOpenGeocache={(geocacheId, name) => this.openGeocache(geocacheId, name)}
            />
        );
    }

    protected openGeocache(geocacheId: number, name: string): void {
        void this.geocacheTabsManager
            .openGeocacheDetails({ geocacheId, name })
            .catch(e => console.error('[Friends] openGeocacheDetails failed:', e));
    }

    protected noticeStyle(kind: 'info' | 'warning' | 'error'): React.CSSProperties {
        const backgrounds = {
            info: 'var(--theia-inputValidation-infoBackground)',
            warning: 'var(--theia-inputValidation-warningBackground)',
            error: 'var(--theia-inputValidation-errorBackground)',
        };
        return {
            padding: '8px 12px',
            backgroundColor: backgrounds[kind],
            borderRadius: '4px',
            fontSize: '0.9em'
        };
    }

    // -------------------------------------------------- Suggestions de caches

    protected async loadSuggestions(): Promise<void> {
        this.suggestionsLoading = true;
        this.suggestionsError = null;
        this.update();

        try {
            const params = new URLSearchParams({
                min_friends: String(this.suggestionsMinFriends),
                limit: '50',
            });
            const result = await this.friendsService.loadSuggestions(params);
            if (result.success) {
                this.suggestions = result.suggestions || [];
            } else {
                // Une erreur n'est pas « aucune suggestion » : la liste
                // existante est conservée et l'erreur affichée à part.
                this.suggestionsError = result.error_message || 'Impossible de charger les suggestions.';
            }
        } catch (err) {
            this.suggestionsError = getErrorMessage(err, 'Impossible de charger les suggestions.');
            console.error('[Friends] Failed to load suggestions:', err);
        } finally {
            this.suggestionsLoading = false;
            this.update();
        }
    }

    /**
     * Titre de cache cliquable : la fiche GeoApp si la cache est importée,
     * geocaching.com sinon.
     */
    protected renderCacheNameLink(geocacheId: number, gcCode: string, name: string): React.ReactNode {
        if (geocacheId > 0) {
            return (
                <a onClick={() => this.openGeocache(geocacheId, name)} style={{ cursor: 'pointer' }} title="Ouvrir la fiche dans GeoApp">
                    {name}
                </a>
            );
        }
        return (
            <a href={`https://www.geocaching.com/geocache/${gcCode}`} target="_blank" rel="noreferrer" title="Ouvrir sur geocaching.com">
                {name}
            </a>
        );
    }

    // -------------------------------------------------- Compteurs par ami

    /** Compteurs locaux (« en commun », « connues ») des cartes de l'onglet Amis. */
    protected async loadStats(): Promise<void> {
        try {
            const result = await this.friendsService.loadStats();
            if (result.success) {
                this.stats = new Map((result.friends || []).map(stat => [stat.username, stat]));
                this.update();
            }
        } catch (err) {
            // Silencieux : les cartes s'affichent sans ces compteurs.
            console.error('[Friends] Failed to load stats:', err);
        }
    }

    protected formatRelativeTime(iso: string | null): string {
        if (!iso) return 'jamais';
        const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
        if (diffMin < 1) return 'à l\'instant';
        if (diffMin < 60) return `il y a ${diffMin} min`;
        const diffHours = Math.floor(diffMin / 60);
        if (diffHours < 24) return `il y a ${diffHours} h`;
        return `il y a ${Math.floor(diffHours / 24)} j`;
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
            const result = await this.friendsService.loadNotifications(params);
            if (result.success) {
                this.notifications = result.items || [];
                // `total_count` compte les non-lues avant limitation ; `count`
                // ne compte que les éléments retournés (≤ limit).
                this.notificationsCount = result.total_count ?? result.count ?? 0;
            }
        } catch {
            // Silencieux : les notifications sont un bonus.
        }
        this.update();
    }

    protected async markNotificationsSeen(): Promise<void> {
        try {
            await this.friendsService.markNotificationsSeen();
            this.notifications = [];
            this.notificationsCount = 0;
            this.update();
        } catch {
            // Silencieux.
        }
    }

    /**
     * Nouvelles trouvailles depuis la dernière visite, en tête de l'onglet
     * Activité (préférence `geoApp.friends.notifications.enabled`). Une ligne
     * repliée par défaut plutôt qu'une section en bas du widget.
     */
    protected renderNotifications(): React.ReactNode {
        if (this.notificationsCount === 0) {
            return null;
        }

        return (
            <div style={{ ...this.noticeStyle('info'), marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span className="codicon codicon-bell"></span>
                    <span style={{ flex: 1 }}>
                        {`${this.notificationsCount} cache(s) trouvée(s) par vos amis depuis votre dernière visite.`}
                    </span>
                    <button
                        className="theia-button secondary"
                        onClick={() => { this.notificationsVisible = !this.notificationsVisible; this.update(); }}
                    >
                        {this.notificationsVisible ? 'Masquer' : 'Voir'}
                    </button>
                    <button
                        className="theia-button secondary"
                        onClick={() => this.markNotificationsSeen()}
                        title="Y compris celles qui ne sont pas affichées"
                    >
                        Marquer comme vu
                    </button>
                </div>
                {this.notificationsVisible && (
                    <div style={{ marginTop: '8px' }}>
                        {this.notifications.map(n => this.renderNotification(n))}
                        {this.notificationsCount > this.notifications.length && (
                            <div style={{ fontSize: '0.85em', color: 'var(--theia-descriptionForeground)', marginTop: '8px' }}>
                                {`${this.notifications.length} affichée(s) sur ${this.notificationsCount}.`}
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    }

    protected renderNotification(n: FriendNotification): React.ReactNode {
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
                        {this.renderCacheNameLink(n.geocache_id, n.gc_code, n.name)}
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
        try {
            const result = await this.friendsService.loadEvents(100);
            if (result.success) {
                this.events = result.items || [];
                this.update();
            }
        } catch {
            // Silencieux : les events sont un bonus.
        }
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
                    title="Afficher aussi vos propres logs"
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
                    title="Ce que la carte affiche : les logs récents du flux, ou toutes les trouvailles connues de vos amis"
                >
                    {MAP_SOURCES.map(source => (
                        <option key={source.id} value={source.id}>{source.label}</option>
                    ))}
                </select>

                <button
                    className="theia-button secondary"
                    onClick={() => this.showOnMap(true)}
                    disabled={this.mapLoading || !this.loaded}
                    title="Afficher les découvertes de vos amis sur une carte (suit les filtres)"
                >
                    <span className="codicon codicon-globe"></span>
                    {this.mapLoading ? ' Carte…' : ' Carte'}
                </button>
            </div>
        );
    }

    /** Bandeaux communs aux trois onglets : backend injoignable, erreur, connexion. */
    protected renderNotices(): React.ReactNode {
        const notices: React.ReactNode[] = [];

        if (!this.apiClient.isBackendReachable()) {
            notices.push(
                <div key="offline" style={{ ...this.noticeStyle('warning'), marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="codicon codicon-debug-disconnect"></span>
                    <span style={{ flex: 1 }}>
                        Backend GeoApp injoignable — les données affichées sont les données locales.
                    </span>
                    <button
                        className="theia-button secondary"
                        onClick={() => this.retryConnection()}
                        disabled={this.loading}
                    >
                        <span className="codicon codicon-refresh"></span>
                        {' Réessayer'}
                    </button>
                </div>
            );
        }

        if (this.error) {
            notices.push(
                <div key="error" style={{ ...this.noticeStyle(this.notAuthenticated ? 'warning' : 'error'), marginBottom: '12px' }}>
                    <span className={`codicon ${this.notAuthenticated ? 'codicon-key' : 'codicon-error'}`}></span>
                    {` ${this.error}`}
                    <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
                        <button
                            className="theia-button secondary"
                            onClick={() => this.loadActivities(0)}
                            disabled={this.loading}
                        >
                            <span className="codicon codicon-refresh"></span>
                            {' Réessayer'}
                        </button>
                        {this.notAuthenticated && (
                            <button
                                className="theia-button"
                                onClick={() => this.commandService.executeCommand('geoapp.auth.open')}
                                title="Ouvrir la gestion de la connexion Geocaching.com"
                            >
                                <span className="codicon codicon-key"></span>
                                {' Se reconnecter'}
                            </button>
                        )}
                    </div>
                </div>
            );
        }

        return notices;
    }

    /** Bandeaux propres à l'onglet Activité : bilan de la carte, flux incomplet. */
    protected renderActivityNotices(): React.ReactNode {
        const notices: React.ReactNode[] = [];

        if (this.mapMessage) {
            notices.push(
                <div key="map" style={{ ...this.noticeStyle('info'), marginBottom: '12px' }}>
                    <span className="codicon codicon-globe"></span>
                    {` ${this.mapMessage}`}
                </div>
            );
        }

        // Le flux n'est pas exhaustif et rien dans son contenu ne le dit :
        // geocaching.com regroupe les trouvailles d'affilée en une seule entrée
        // dont il ne nomme qu'une cache (§9.2). Le bandeau n'apparaît qu'avec un
        // ami choisi, seul cas où l'on peut y remédier : sans filtre, les
        // « + N autres » de chaque entrée suffisent à le signaler.
        if (this.condensedHidden > 0 && this.authorFilter) {
            notices.push(
                <div key="condensed" style={{ ...this.noticeStyle('info'), marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span className="codicon codicon-fold"></span>
                        <span style={{ flex: 1, minWidth: '240px' }}>
                            {`geocaching.com ne détaille pas ${this.condensedHidden} trouvaille(s) de ${this.authorFilter} dans ce flux.`}
                        </span>
                        <button
                            className="theia-button"
                            onClick={() => this.fetchProfileFinds()}
                            disabled={this.profileSyncing}
                            title={`Récupérer la liste complète des trouvailles de ${this.authorFilter} depuis son profil geocaching.com`}
                        >
                            {this.profileSyncing ? 'Récupération…' : 'Récupérer toutes ses trouvailles'}
                        </button>
                    </div>
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
                        : 'Aucune activité enregistrée : cliquez sur « Mettre à jour ».'}
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
