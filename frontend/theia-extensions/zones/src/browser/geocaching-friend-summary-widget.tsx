// Fiche synthétique d'un ami : trouvailles connues, caches en commun,
// activité récente et zones vérifiées — données locales. Seul « Récupérer
// toutes ses trouvailles » interroge geocaching.com.

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget, Message } from '@theia/core/lib/browser';
import { CommandService } from '@theia/core';
import { BackendApiClient, BackendApiError, getErrorMessage } from './backend-api-client';
import { FriendsService } from './friends-service';
import { GeocacheTabsManager } from './geocache-tabs-manager';
import { coverageLabel, scanCoverage } from './friend-scan-state';
import { fetchFriendProfileFinds } from './friend-profile-finds';
import type {
    FriendSummaryResponse,
    FriendSummaryZone,
    GeocachingFriend,
} from './friends-types';

@injectable()
export class GeocachingFriendSummaryWidget extends ReactWidget {
    static readonly ID = 'geocaching-friend-summary-widget';
    static readonly LABEL = 'Fiche ami';

    @inject(BackendApiClient)
    protected readonly apiClient: BackendApiClient;

    @inject(FriendsService)
    protected readonly friendsService: FriendsService;

    @inject(CommandService)
    protected readonly commandService: CommandService;

    @inject(GeocacheTabsManager)
    protected readonly geocacheTabsManager: GeocacheTabsManager;

    protected username: string | null = null;
    /** Profil issu du cache de la liste d'amis (avatar, compteurs du site). */
    protected profile: GeocachingFriend | null = null;
    protected summary: FriendSummaryResponse | null = null;

    protected loading: boolean = false;
    protected loaded: boolean = false;
    protected error: string | null = null;

    protected fetchingFinds: boolean = false;
    protected fetchMessage: string | null = null;

    @postConstruct()
    protected init(): void {
        this.id = GeocachingFriendSummaryWidget.ID;
        this.title.label = GeocachingFriendSummaryWidget.LABEL;
        this.title.caption = "Tout ce que GeoApp sait d'un ami";
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-person';
        this.addClass('geocaching-friend-summary-widget');
        this.node.tabIndex = 0;
    }

    protected onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        if (this.username && !this.loaded && !this.loading) {
            void this.load();
        }
    }

    /**
     * Change l'ami affiché et recharge la fiche. Point d'entrée de la commande
     * `geoapp.friends.summary.open` (arg `{ username }`).
     */
    async setFriend(username: string): Promise<void> {
        if (username === this.username && this.loaded) {
            return;
        }
        this.username = username;
        this.profile = null;
        this.summary = null;
        this.loaded = false;
        this.error = null;
        this.fetchMessage = null;
        this.title.label = `${GeocachingFriendSummaryWidget.LABEL} — ${username}`;
        this.update();
        await this.load();
    }

    protected async load(): Promise<void> {
        if (!this.username) {
            return;
        }
        this.loading = true;
        this.error = null;
        this.update();

        try {
            const result = await this.apiClient.requestJson<FriendSummaryResponse>(
                `/api/friends/${encodeURIComponent(this.username)}/summary`,
                {},
                'Impossible de charger la fiche ami'
            );
            if (result.success) {
                this.summary = result;
                this.loaded = true;
            } else {
                this.error = result.error_message || result.error || 'Fiche ami indisponible';
            }
        } catch (err) {
            this.error = getErrorMessage(err, 'Erreur de connexion au serveur GeoApp');
            console.error('[FriendSummary] Failed to load:', err);
        } finally {
            this.loading = false;
            this.update();
        }

        // Compléter avec le profil de la liste d'amis (cache mémoire, pas de
        // réseau forcé) : avatar et compteurs du site.
        try {
            const friends = await this.friendsService.getFriends();
            if (friends.success && friends.friends) {
                this.profile = friends.friends.find(
                    f => f.username.toLowerCase() === this.username!.toLowerCase()) ?? null;
                this.update();
            }
        } catch (err) {
            // Le profil est un bonus : la fiche reste utilisable sans.
            console.warn('[FriendSummary] Friends list unavailable:', err);
        }
    }

    /**
     * Recherche par profil (§11.2) : la seule façon d'obtenir ses trouvailles
     * hors des zones vérifiées et au-delà de ce que le flux détaille.
     */
    protected async fetchAllFinds(): Promise<void> {
        if (!this.username || this.fetchingFinds) {
            return;
        }
        this.fetchingFinds = true;
        this.fetchMessage = null;
        this.update();
        try {
            const outcome = await fetchFriendProfileFinds(this.friendsService, this.username);
            if (outcome.status !== 'cancelled') {
                this.fetchMessage = outcome.message;
            }
            if (outcome.status === 'done') {
                await this.load();
            }
        } finally {
            this.fetchingFinds = false;
            this.update();
        }
    }

    protected formatDate(iso: string | null | undefined): string {
        if (!iso) {
            return '—';
        }
        const parsed = new Date(iso);
        return isNaN(parsed.getTime()) ? iso : parsed.toLocaleString('fr-FR');
    }

    protected render(): React.ReactNode {
        return (
            <div style={{ padding: '16px', height: '100%', overflow: 'auto' }}>
                {this.renderHeader()}
                {this.renderNotices()}
                {this.loaded && this.summary && (
                    <>
                        {this.renderStats()}
                        {this.renderZones()}
                        {this.renderRecentActivity()}
                    </>
                )}
                {this.loading && (
                    <div style={{ color: 'var(--theia-descriptionForeground)' }}>
                        Chargement de la fiche…
                    </div>
                )}
            </div>
        );
    }

    protected renderHeader(): React.ReactNode {
        const username = this.username;
        return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                {this.profile?.avatar_url ? (
                    <img
                        src={this.profile.avatar_url}
                        alt=""
                        style={{ width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover' }}
                    />
                ) : (
                    <div style={{
                        width: '48px', height: '48px', borderRadius: '50%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        backgroundColor: 'var(--theia-panel-border)'
                    }}>
                        <span className="codicon codicon-account"></span>
                    </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {username ?? 'Fiche ami'}
                        {this.profile?.is_premium && (
                            <span
                                className="codicon codicon-star-full"
                                title="Membre Premium"
                                style={{ color: 'var(--theia-charts-yellow)', fontSize: '0.7em' }}
                            ></span>
                        )}
                    </h2>
                    {this.profile && (
                        <div style={{ fontSize: '0.85em', color: 'var(--theia-descriptionForeground)' }}>
                            {`${(this.profile.finds_count ?? 0).toLocaleString('fr-FR')} trouvées sur geocaching.com`}
                            {this.profile.location ? ` · ${this.profile.location}` : ''}
                        </div>
                    )}
                </div>
                {username && (
                    <div style={{ display: 'flex', gap: '8px', flexShrink: 0, flexWrap: 'wrap' }}>
                        <button
                            className="theia-button"
                            onClick={() => this.fetchAllFinds()}
                            disabled={this.fetchingFinds || !this.apiClient.isBackendReachable()}
                            title={`Récupérer depuis geocaching.com la liste des trouvailles de ${username}`}
                        >
                            <span className="codicon codicon-cloud-download"></span>
                            {this.fetchingFinds ? ' Récupération…' : ' Récupérer toutes ses trouvailles'}
                        </button>
                        <button
                            className="theia-button secondary"
                            onClick={() => this.commandService.executeCommand(
                                'geoapp.friends.activity.open', { username })}
                            title={`Voir tout le flux d'activité de ${username}`}
                        >
                            <span className="codicon codicon-pulse"></span>
                            {' Activité'}
                        </button>
                        {this.profile?.profile_url && (
                            <a
                                className="theia-button secondary"
                                href={this.profile.profile_url}
                                target="_blank"
                                rel="noreferrer"
                                title={`Profil de ${username} sur geocaching.com`}
                                style={{ textDecoration: 'none' }}
                            >
                                <span className="codicon codicon-link-external"></span>
                                {' Profil'}
                            </a>
                        )}
                        <button
                            className="theia-button secondary"
                            onClick={() => this.load()}
                            disabled={this.loading}
                            title="Recharger la fiche"
                        >
                            <span className="codicon codicon-refresh"></span>
                        </button>
                    </div>
                )}
            </div>
        );
    }

    protected renderNotices(): React.ReactNode {
        if (!this.username) {
            return (
                <div style={{ color: 'var(--theia-descriptionForeground)' }}>
                    Ouvrez une fiche depuis la liste des amis.
                </div>
            );
        }
        if (!this.error) {
            return this.fetchMessage && (
                <div style={{
                    padding: '8px 12px',
                    marginBottom: '12px',
                    backgroundColor: 'var(--theia-inputValidation-infoBackground)',
                    borderRadius: '4px',
                    fontSize: '0.9em'
                }}>
                    <span className="codicon codicon-info"></span>
                    {` ${this.fetchMessage}`}
                </div>
            );
        }
        return (
            <div style={{
                padding: '12px',
                marginBottom: '12px',
                backgroundColor: 'var(--theia-inputValidation-errorBackground)',
                borderRadius: '4px'
            }}>
                <span className="codicon codicon-error"></span>
                {` ${this.error}`}
                <div style={{ marginTop: '8px' }}>
                    <button
                        className="theia-button secondary"
                        onClick={() => this.load()}
                        disabled={this.loading}
                    >
                        <span className="codicon codicon-refresh"></span>
                        {' Réessayer'}
                    </button>
                </div>
            </div>
        );
    }

    protected renderStats(): React.ReactNode {
        const s = this.summary!;
        const cell = (label: string, value: React.ReactNode, title: string): React.ReactNode => (
            <div
                key={label}
                title={title}
                style={{
                    padding: '8px 12px',
                    backgroundColor: 'var(--theia-editor-background)',
                    border: '1px solid var(--theia-panel-border)',
                    borderRadius: '4px',
                    minWidth: '110px',
                }}
            >
                <div style={{ fontSize: '1.2em', fontWeight: 'bold' }}>{value}</div>
                <div style={{ fontSize: '0.8em', color: 'var(--theia-descriptionForeground)' }}>{label}</div>
            </div>
        );
        return (
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
                {cell('Trouvailles connues',
                    this.profile?.finds_count
                        ? `${s.finds_count.toLocaleString('fr-FR')} / ${this.profile.finds_count.toLocaleString('fr-FR')}`
                        : s.finds_count.toLocaleString('fr-FR'),
                    'Trouvailles de cet ami que GeoApp a déjà récupérées, sur son total geocaching.com. '
                    + '« Récupérer toutes ses trouvailles » complète la liste.')}
                {cell('En commun avec moi', s.shared_with_me.toLocaleString('fr-FR'),
                    'Caches que vous avez trouvées et que cet ami a aussi trouvées')}
                {cell('Logs du flux', s.activity_count.toLocaleString('fr-FR'),
                    'Entrées du flux d\'activité synchronisées localement')}
                {cell('Dernière activité', this.formatDate(s.last_activity_at),
                    'Date du log le plus récent connu')}
            </div>
        );
    }

    protected renderZones(): React.ReactNode {
        const zones = this.summary!.zones;
        return (
            <div style={{ marginBottom: '16px' }}>
                <h3 style={{ marginTop: 0 }}>Zones vérifiées</h3>
                {zones.length === 0 ? (
                    <div style={{ color: 'var(--theia-descriptionForeground)' }}>
                        Aucune zone vérifiée pour cet ami : on ne sait pas encore quelles caches il n'a pas trouvées.
                        Utilisez « Vérifier qui a trouvé » en mode sortie sur une zone.
                    </div>
                ) : (
                    <table style={{ borderCollapse: 'collapse', fontSize: '0.9em', width: '100%' }}>
                        <thead>
                            <tr>
                                <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--theia-panel-border)' }}>Zone</th>
                                <th style={{ textAlign: 'right', padding: '4px 8px', borderBottom: '1px solid var(--theia-panel-border)' }}>Trouvées</th>
                                <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--theia-panel-border)' }}>État</th>
                                <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--theia-panel-border)' }}>Vérifiée le</th>
                            </tr>
                        </thead>
                        <tbody>
                            {zones.map(zone => this.renderZoneRow(zone))}
                        </tbody>
                    </table>
                )}
            </div>
        );
    }

    protected renderZoneRow(zone: FriendSummaryZone): React.ReactNode {
        const coverage = scanCoverage({
            friend: this.username!,
            scanned: true,
            is_stale: zone.is_stale === true,
            truncated: zone.truncated,
            found_count: zone.found_count,
            zone_matches: zone.zone_matches,
            scanned_at: zone.scanned_at,
        });
        const label = coverageLabel(coverage);
        const color = coverage === 'fresh'
            ? 'var(--theia-charts-green)'
            : coverage === 'partial' || coverage === 'stale'
                ? 'var(--theia-charts-orange)'
                : 'var(--theia-descriptionForeground)';
        return (
            <tr key={zone.zone_id}>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--theia-panel-border)' }}>
                    <a
                        style={{ cursor: 'pointer' }}
                        onClick={() => this.commandService.executeCommand(
                            'zones:open-zone', { zoneId: zone.zone_id, zoneName: zone.zone_name ?? undefined })}
                        title={`Ouvrir la zone ${zone.zone_name ?? zone.zone_id}`}
                    >
                        {zone.zone_name ?? `Zone ${zone.zone_id}`}
                    </a>
                </td>
                <td style={{ textAlign: 'right', padding: '4px 8px', borderBottom: '1px solid var(--theia-panel-border)' }}>
                    {zone.zone_matches}/{zone.found_count}
                </td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--theia-panel-border)', color }}>
                    {label}
                </td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--theia-panel-border)', color: 'var(--theia-descriptionForeground)' }}>
                    {this.formatDate(zone.scanned_at)}
                </td>
            </tr>
        );
    }

    protected renderRecentActivity(): React.ReactNode {
        const items = this.summary!.recent_activity;
        return (
            <div>
                <h3 style={{ marginTop: 0 }}>
                    Dernière activité
                    {this.username && (
                        <button
                            className="theia-button secondary"
                            style={{ marginLeft: '8px', padding: '0 8px', fontSize: '0.75em' }}
                            onClick={() => this.commandService.executeCommand(
                                'geoapp.friends.activity.open', { username: this.username })}
                            title="Voir tout le flux filtré sur cet ami"
                        >
                            Tout voir
                        </button>
                    )}
                </h3>
                {items.length === 0 ? (
                    <div style={{ color: 'var(--theia-descriptionForeground)' }}>
                        Aucun log dans le flux synchronisé.
                    </div>
                ) : (
                    items.map((item, i) => (
                        <div
                            key={i}
                            style={{
                                display: 'flex', gap: '8px', alignItems: 'baseline',
                                padding: '6px 0',
                                borderBottom: '1px solid var(--theia-panel-border)',
                            }}
                        >
                            <span style={{
                                fontSize: '0.8em', flexShrink: 0, minWidth: '90px',
                                color: 'var(--theia-descriptionForeground)'
                            }}>
                                {this.formatDate(item.log_date)}
                            </span>
                            <span style={{ flexShrink: 0 }}>{item.log_type_label ?? ''}</span>
                            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {item.geocache_id > 0 ? (
                                    <a
                                        style={{ cursor: 'pointer' }}
                                        title="Ouvrir la fiche dans GeoApp"
                                        onClick={() => {
                                            void this.geocacheTabsManager
                                                .openGeocacheDetails({
                                                    geocacheId: item.geocache_id,
                                                    name: item.cache_name ?? undefined,
                                                })
                                                .catch(e => console.error('[FriendSummary] openGeocacheDetails failed:', e));
                                        }}
                                    >
                                        {item.cache_name ?? item.gc_code}
                                    </a>
                                ) : (
                                    item.cache_name ?? item.gc_code ?? '—'
                                )}
                            </span>
                            {item.gc_code && (
                                <a
                                    href={`https://www.geocaching.com/geocache/${item.gc_code}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ fontSize: '0.8em', flexShrink: 0 }}
                                    title="Ouvrir sur geocaching.com"
                                >
                                    {item.gc_code}
                                </a>
                            )}
                        </div>
                    ))
                )}
            </div>
        );
    }
}
