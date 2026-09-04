import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget, Message } from '@theia/core/lib/browser';
import { BackendApiError, getErrorMessage } from './backend-api-client';
import { FriendsService } from './friends-service';
import type { GeocachingFriend } from './friends-types';

type SortKey = 'username' | 'finds_count' | 'last_online';

@injectable()
export class GeocachingFriendsWidget extends ReactWidget {
    static readonly ID = 'geocaching-friends-widget';
    static readonly LABEL = 'Amis Geocaching';

    @inject(FriendsService)
    protected readonly friendsService: FriendsService;

    protected friends: GeocachingFriend[] = [];
    protected fetchedAt: string | null = null;
    protected pendingRequests: number | null = null;
    protected truncated: boolean = false;

    protected loading: boolean = false;
    protected loaded: boolean = false;
    protected error: string | null = null;
    protected notAuthenticated: boolean = false;

    protected filter: string = '';
    protected sortKey: SortKey = 'username';

    @postConstruct()
    protected init(): void {
        this.id = GeocachingFriendsWidget.ID;
        this.title.label = GeocachingFriendsWidget.LABEL;
        this.title.caption = 'Vos amis Geocaching.com';
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-organization';
        this.addClass('geocaching-friends-widget');
        this.node.tabIndex = 0; // sinon Theia signale "did not accept focus after 2000ms"

        this.fetchFriends();

        // Recharger quand la connexion Geocaching.com change.
        window.addEventListener('geoapp-auth-changed', this.onAuthChanged);
    }

    override dispose(): void {
        window.removeEventListener('geoapp-auth-changed', this.onAuthChanged);
        super.dispose();
    }

    protected onAuthChanged = (): void => {
        this.fetchFriends(true);
    };

    protected onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        if (!this.loaded && !this.loading) {
            this.fetchFriends();
        }
    }

    protected async fetchFriends(force: boolean = false): Promise<void> {
        this.loading = true;
        this.error = null;
        this.notAuthenticated = false;
        this.update();

        try {
            const result = await this.friendsService.getFriends(force);

            if (result.success && result.friends) {
                this.friends = result.friends;
                this.fetchedAt = result.fetched_at ?? null;
                this.pendingRequests = result.pending_requests ?? null;
                this.truncated = result.truncated === true;
                this.loaded = true;
            } else {
                this.friends = [];
                this.notAuthenticated = result.error === 'not_authenticated';
                this.error = result.error_message || 'Impossible de récupérer la liste des amis';
            }
        } catch (err) {
            this.friends = [];
            if (err instanceof BackendApiError && err.status === 404) {
                this.error = "Route /api/friends introuvable : le backend GeoApp doit être redémarré pour prendre en compte la fonctionnalité Amis.";
            } else {
                this.error = getErrorMessage(err, 'Erreur de connexion au serveur GeoApp');
            }
            console.error('[GeocachingFriends] Failed to fetch friends:', err);
        } finally {
            this.loading = false;
            this.update();
        }
    }

    protected getVisibleFriends(): GeocachingFriend[] {
        const needle = this.filter.trim().toLowerCase();
        const filtered = needle
            ? this.friends.filter(f =>
                f.username.toLowerCase().includes(needle)
                || (f.location || '').toLowerCase().includes(needle))
            : [...this.friends];

        return filtered.sort((a, b) => {
            switch (this.sortKey) {
                case 'finds_count':
                    return (b.finds_count ?? -1) - (a.finds_count ?? -1);
                case 'last_online':
                    return (b.last_online || '').localeCompare(a.last_online || '');
                default:
                    return a.username.localeCompare(b.username, 'fr', { sensitivity: 'base' });
            }
        });
    }

    protected formatDate(iso: string | null): string {
        if (!iso) {
            return '—';
        }
        const parsed = new Date(iso);
        return isNaN(parsed.getTime()) ? iso : parsed.toLocaleDateString('fr-FR');
    }

    protected formatNumber(value: number | null): string {
        return value === null || value === undefined ? '—' : value.toLocaleString('fr-FR');
    }

    protected formatLastOnline(iso: string | null): { text: string; isToday: boolean } {
        if (!iso) {
            return { text: '—', isToday: false };
        }
        const today = new Date().toISOString().slice(0, 10);
        return { text: this.formatDate(iso), isToday: iso === today };
    }

    protected render(): React.ReactNode {
        return (
            <div className="geocaching-friends-container" style={{ padding: '16px', height: '100%', overflow: 'auto' }}>
                <h2 style={{ marginTop: 0, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="codicon codicon-organization"></span>
                    Amis Geocaching.com
                    {this.loaded && (
                        <span style={{ fontSize: '0.7em', fontWeight: 'normal', color: 'var(--theia-descriptionForeground)' }}>
                            {`(${this.friends.length})`}
                        </span>
                    )}
                </h2>

                {this.renderToolbar()}
                {this.renderNotices()}
                {this.renderBody()}
            </div>
        );
    }

    protected renderToolbar(): React.ReactNode {
        return (
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                    type="text"
                    className="theia-input"
                    value={this.filter}
                    placeholder="Filtrer par pseudo ou lieu…"
                    onChange={e => { this.filter = e.target.value; this.update(); }}
                    style={{ flex: 1, minWidth: '180px' }}
                    disabled={this.loading || !this.loaded}
                />
                <select
                    className="theia-input"
                    value={this.sortKey}
                    onChange={e => { this.sortKey = e.target.value as SortKey; this.update(); }}
                    disabled={this.loading || !this.loaded}
                    title="Trier la liste"
                >
                    <option value="username">Tri : pseudo</option>
                    <option value="finds_count">Tri : trouvailles</option>
                    <option value="last_online">Tri : dernière connexion</option>
                </select>
                <button
                    className="theia-button"
                    onClick={() => this.fetchFriends(true)}
                    disabled={this.loading}
                    title="Recharger la liste depuis geocaching.com (ignore le cache)"
                >
                    <span className="codicon codicon-refresh"></span>
                    {this.loading ? ' Chargement…' : ' Rafraîchir'}
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
                    marginBottom: '16px',
                    backgroundColor: this.notAuthenticated
                        ? 'var(--theia-inputValidation-warningBackground)'
                        : 'var(--theia-inputValidation-errorBackground)',
                    border: '1px solid var(--theia-panel-border)',
                    borderRadius: '4px'
                }}>
                    <span className={`codicon ${this.notAuthenticated ? 'codicon-key' : 'codicon-error'}`}></span>
                    {` ${this.error}`}
                </div>
            );
        }

        if (this.truncated) {
            notices.push(
                <div key="truncated" style={{
                    padding: '12px',
                    marginBottom: '16px',
                    backgroundColor: 'var(--theia-inputValidation-warningBackground)',
                    borderRadius: '4px',
                    fontSize: '0.9em'
                }}>
                    <span className="codicon codicon-warning"></span>
                    {' La page geocaching.com est paginée : tous vos amis ne sont pas affichés.'}
                </div>
            );
        }

        if (this.pendingRequests) {
            notices.push(
                <div key="pending" style={{
                    padding: '12px',
                    marginBottom: '16px',
                    backgroundColor: 'var(--theia-inputValidation-infoBackground)',
                    borderRadius: '4px',
                    fontSize: '0.9em'
                }}>
                    <span className="codicon codicon-mail"></span>
                    {` ${this.pendingRequests} demande(s) d'ami en attente sur geocaching.com.`}
                </div>
            );
        }

        return notices;
    }

    protected renderBody(): React.ReactNode {
        if (this.loading && !this.loaded) {
            return (
                <div style={{ color: 'var(--theia-descriptionForeground)' }}>
                    Récupération de la liste d'amis…
                </div>
            );
        }

        if (!this.loaded) {
            return null;
        }

        if (this.friends.length === 0) {
            return (
                <div style={{ color: 'var(--theia-descriptionForeground)' }}>
                    Aucun ami sur votre compte Geocaching.com.
                </div>
            );
        }

        const visible = this.getVisibleFriends();
        if (visible.length === 0) {
            return (
                <div style={{ color: 'var(--theia-descriptionForeground)' }}>
                    Aucun ami ne correspond au filtre « {this.filter} ».
                </div>
            );
        }

        return (
            <div>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: '12px'
                }}>
                    {visible.map(friend => this.renderFriendCard(friend))}
                </div>
                {this.fetchedAt && (
                    <div style={{
                        marginTop: '16px',
                        fontSize: '0.85em',
                        color: 'var(--theia-descriptionForeground)'
                    }}>
                        {`Données récupérées le ${new Date(this.fetchedAt).toLocaleString('fr-FR')}`}
                    </div>
                )}
            </div>
        );
    }

    protected renderFriendCard(friend: GeocachingFriend): React.ReactNode {
        const lastOnline = this.formatLastOnline(friend.last_online);

        return (
            <div
                key={friend.profile_guid || friend.username}
                style={{
                    display: 'flex',
                    gap: '12px',
                    padding: '12px',
                    backgroundColor: 'var(--theia-editor-background)',
                    border: '1px solid var(--theia-panel-border)',
                    borderRadius: '4px'
                }}
            >
                {friend.avatar_url ? (
                    <img
                        src={friend.avatar_url}
                        alt=""
                        style={{ width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                    />
                ) : (
                    <div style={{
                        width: '48px', height: '48px', borderRadius: '50%', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        backgroundColor: 'var(--theia-panel-border)'
                    }}>
                        <span className="codicon codicon-account"></span>
                    </div>
                )}

                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {friend.profile_url ? (
                            <a
                                href={friend.profile_url}
                                target="_blank"
                                rel="noreferrer"
                                style={{ fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                title={`Ouvrir le profil de ${friend.username}`}
                            >
                                {friend.username}
                            </a>
                        ) : (
                            <span style={{ fontWeight: 'bold' }}>{friend.username}</span>
                        )}
                        {friend.is_premium && (
                            <span
                                className="codicon codicon-star-full"
                                title="Membre Premium"
                                style={{ color: 'var(--theia-charts-yellow)', fontSize: '0.9em' }}
                            ></span>
                        )}
                    </div>

                    <div style={{ fontSize: '0.85em', color: 'var(--theia-descriptionForeground)', marginTop: '4px' }}>
                        <div title="Géocaches trouvées / posées">
                            <span className="codicon codicon-search" style={{ fontSize: '0.9em' }}></span>
                            {` ${this.formatNumber(friend.finds_count)} trouvées · ${this.formatNumber(friend.hides_count)} posées`}
                        </div>
                        <div title="Dernière connexion sur geocaching.com">
                            <span className="codicon codicon-pulse" style={{ fontSize: '0.9em' }}></span>
                            {' En ligne : '}
                            <span style={{ color: lastOnline.isToday ? 'var(--theia-charts-green)' : undefined }}>
                                {lastOnline.isToday ? "aujourd'hui" : lastOnline.text}
                            </span>
                        </div>
                        {friend.location && (
                            <div title="Lieu déclaré sur le profil">
                                <span className="codicon codicon-location" style={{ fontSize: '0.9em' }}></span>
                                {` ${friend.location}`}
                            </div>
                        )}
                        <div title="Membre depuis">
                            <span className="codicon codicon-calendar" style={{ fontSize: '0.9em' }}></span>
                            {` Membre depuis ${this.formatDate(friend.member_since)}`}
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}
