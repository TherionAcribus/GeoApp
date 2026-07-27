import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget, Message } from '@theia/core/lib/browser';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { LogTypeIcon } from './geocache-log-type-icons';

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

@injectable()
export class GeocachingFriendActivityWidget extends ReactWidget {
    static readonly ID = 'geocaching-friend-activity-widget';
    static readonly LABEL = 'Activité des amis';

    @inject(PreferenceService)
    protected readonly preferenceService: PreferenceService;

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

    @postConstruct()
    protected init(): void {
        this.id = GeocachingFriendActivityWidget.ID;
        this.title.label = GeocachingFriendActivityWidget.LABEL;
        this.title.caption = "Flux d'activité de vos amis Geocaching.com";
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-pulse';
        this.addClass('geocaching-friend-activity-widget');
        this.node.tabIndex = 0;

        this.loadActivities().then(() => this.autoSyncIfStale());
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
                    onChange={e => { this.authorFilter = e.target.value; this.loadActivities(0); }}
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
                    onChange={e => { this.typeFilter = e.target.value; this.loadActivities(0); }}
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
                        onChange={e => { this.includeSelf = e.target.checked; this.loadActivities(0); }}
                        disabled={this.loading || !this.loaded}
                    />
                    Mes logs
                </label>

                <div style={{ flex: 1 }}></div>

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
