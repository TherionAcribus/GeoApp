import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget, Message, ConfirmDialog, Dialog } from '@theia/core/lib/browser';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { LogTypeIcon } from './geocache-log-type-icons';
import { MapWidgetFactory } from './map/map-widget-factory';
import { MapGeocache } from './map/map-layer-manager';
import { GeoAppWidgetEventsService } from './geoapp-widget-events-service';

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

    @inject(MapWidgetFactory)
    protected readonly mapWidgetFactory: MapWidgetFactory;

    @inject(GeoAppWidgetEventsService)
    protected readonly widgetEventsService: GeoAppWidgetEventsService;

    protected activities: FriendActivity[] = [];
    protected authors: { username: string; count: number }[] = [];
    protected logTypeLabels: Record<string, string> = {};
    protected total: number = 0;
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
            .then(() => this.autoOpenMapIfEnabled());
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

    protected getApiBaseUrl(): string {
        return this.preferenceService.get<string>('geoApp.backend.apiBaseUrl', 'http://localhost:8000');
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
            const response = await fetch(`${this.getApiBaseUrl()}/api/friends/activity?${this.buildQuery(offset)}`);

            const contentType = response.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
                this.error = response.status === 404
                    ? "Route /api/friends/activity introuvable : le backend GeoApp doit être redémarré."
                    : `Réponse inattendue du backend GeoApp (HTTP ${response.status}).`;
                return;
            }

            const result: ActivityResponse = await response.json();
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
            this.lastSyncAt = result.last_sync_at ?? null;
            this.loaded = true;
        } catch (err) {
            this.error = 'Erreur de connexion au serveur GeoApp';
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
            } else {
                this.importableCount = 0;
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
    protected async fetchFindPoints(): Promise<FriendFindsMapResponse | undefined> {
        const params = new URLSearchParams();
        if (this.authorFilter) {
            params.set('friend', this.authorFilter);
        }

        return this.fetchMapJson<FriendFindsMapResponse>(`/api/friends/finds/map?${params.toString()}`);
    }

    /** Appel JSON commun aux deux sources, avec le garde-fou « route absente ». */
    protected async fetchMapJson<T extends { success: boolean; error_message?: string }>(
        path: string
    ): Promise<T | undefined> {
        const response = await fetch(`${this.getApiBaseUrl()}${path}`);

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            this.mapMessage = response.status === 404
                ? `Route ${path.split('?')[0]} introuvable : le backend GeoApp doit être redémarré.`
                : `Réponse inattendue du backend GeoApp (HTTP ${response.status}).`;
            return undefined;
        }

        const result = await response.json() as T;
        if (!result.success) {
            this.mapMessage = result.error_message || 'Impossible de charger la carte des amis.';
            return undefined;
        }
        return result;
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
        const response = await fetch(`${this.getApiBaseUrl()}/api/friends/finds/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
            signal
        });

        if (!response.ok && response.status === 401) {
            this.importProgress = 'Connectez-vous à Geocaching.com pour importer ces géocaches.';
            return;
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

    protected async sync(): Promise<void> {
        this.syncing = true;
        this.syncMessage = null;
        this.error = null;
        this.update();

        try {
            const response = await fetch(`${this.getApiBaseUrl()}/api/friends/activity/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ days: this.syncDays })
            });

            const contentType = response.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
                this.error = response.status === 404
                    ? 'Route de synchronisation introuvable : le backend GeoApp doit être redémarré.'
                    : `Réponse inattendue du backend GeoApp (HTTP ${response.status}).`;
                return;
            }

            const result = await response.json();
            if (result.success) {
                this.syncMessage = result.created > 0
                    ? `${result.created} nouvelle(s) activité(s) récupérée(s).`
                    : 'Aucune nouvelle activité.';
                await this.loadActivities(0);
                // Une synchro peut apporter de nouvelles caches : la carte suit.
                await this.showOnMap();
            } else {
                this.notAuthenticated = result.error === 'not_authenticated';
                this.error = result.error_message || 'Échec de la synchronisation';
            }
        } catch (err) {
            this.error = 'Erreur de connexion au serveur GeoApp';
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
                </h2>

                {this.renderToolbar()}
                {this.renderNotices()}
                {this.renderFeed()}
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
                                {`${this.importableCount} trouvaille(s) non localisable(s) : `}
                                {'les géocaches ne sont pas dans GeoApp.'}
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
