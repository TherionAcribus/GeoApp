import * as React from 'react';
import type { FriendStat, GeocachingFriend } from './friends-types';

type SortKey = 'username' | 'finds_count' | 'last_online' | 'shared_with_me';

export interface FriendsListPanelProps {
    friends: GeocachingFriend[];
    /** Compteurs locaux par pseudo (`/api/friends/stats`) ; absents tant qu'ils chargent. */
    stats: Map<string, FriendStat>;
    loading: boolean;
    loaded: boolean;
    onOpenSummary: (username: string) => void;
    onShowActivity: (username: string) => void;
}

function formatDate(iso: string | null): string {
    if (!iso) {
        return '—';
    }
    const parsed = new Date(iso);
    return isNaN(parsed.getTime()) ? iso : parsed.toLocaleDateString('fr-FR');
}

function formatNumber(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : value.toLocaleString('fr-FR');
}

/**
 * Onglet « Amis » du widget Amis : la liste du compte geocaching.com.
 *
 * Les compteurs « en commun » et « connues » viennent de la base locale et
 * remplacent l'ancienne section « Statistiques » du flux d'activité : c'est
 * sur la carte d'un ami qu'on cherche ce qu'on partage avec lui, pas dans un
 * tableau séparé en bas d'un autre écran.
 */
export const FriendsListPanel: React.FC<FriendsListPanelProps> = props => {
    const [filter, setFilter] = React.useState('');
    const [sortKey, setSortKey] = React.useState<SortKey>('username');

    if (props.loading && !props.loaded) {
        return <div style={{ color: 'var(--theia-descriptionForeground)' }}>Récupération de la liste d'amis…</div>;
    }
    if (!props.loaded) {
        return null;
    }
    if (props.friends.length === 0) {
        return <div style={{ color: 'var(--theia-descriptionForeground)' }}>Aucun ami sur votre compte Geocaching.com.</div>;
    }

    const shared = (username: string): number => props.stats.get(username)?.shared_with_me ?? -1;
    const needle = filter.trim().toLowerCase();
    const visible = (needle
        ? props.friends.filter(f =>
            f.username.toLowerCase().includes(needle)
            || (f.location || '').toLowerCase().includes(needle))
        : [...props.friends]
    ).sort((a, b) => {
        switch (sortKey) {
            case 'finds_count':
                return (b.finds_count ?? -1) - (a.finds_count ?? -1);
            case 'last_online':
                return (b.last_online || '').localeCompare(a.last_online || '');
            case 'shared_with_me':
                return shared(b.username) - shared(a.username);
            default:
                return a.username.localeCompare(b.username, 'fr', { sensitivity: 'base' });
        }
    });

    return (
        <div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                    type="text"
                    className="theia-input"
                    value={filter}
                    placeholder="Filtrer par pseudo ou lieu…"
                    onChange={e => setFilter(e.target.value)}
                    style={{ flex: 1, minWidth: '180px' }}
                />
                <select
                    className="theia-input"
                    value={sortKey}
                    onChange={e => setSortKey(e.target.value as SortKey)}
                    title="Trier la liste"
                >
                    <option value="username">Tri : pseudo</option>
                    <option value="finds_count">Tri : trouvailles</option>
                    <option value="shared_with_me">Tri : en commun avec vous</option>
                    <option value="last_online">Tri : dernière connexion</option>
                </select>
            </div>

            {visible.length === 0 ? (
                <div style={{ color: 'var(--theia-descriptionForeground)' }}>
                    Aucun ami ne correspond au filtre « {filter} ».
                </div>
            ) : (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: '12px'
                }}>
                    {visible.map(friend => (
                        <FriendCard
                            key={friend.profile_guid || friend.username}
                            friend={friend}
                            stat={props.stats.get(friend.username)}
                            onOpenSummary={props.onOpenSummary}
                            onShowActivity={props.onShowActivity}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const FriendCard: React.FC<{
    friend: GeocachingFriend;
    stat: FriendStat | undefined;
    onOpenSummary: (username: string) => void;
    onShowActivity: (username: string) => void;
}> = ({ friend, stat, onOpenSummary, onShowActivity }) => {
    const today = new Date().toISOString().slice(0, 10);
    const onlineToday = friend.last_online === today;

    return (
        <div style={{
            display: 'flex',
            gap: '12px',
            padding: '12px',
            backgroundColor: 'var(--theia-editor-background)',
            border: '1px solid var(--theia-panel-border)',
            borderRadius: '4px'
        }}>
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
                    <div title="Géocaches trouvées / posées, selon son profil">
                        <span className="codicon codicon-search" style={{ fontSize: '0.9em' }}></span>
                        {` ${formatNumber(friend.finds_count)} trouvées · ${formatNumber(friend.hides_count)} posées`}
                    </div>
                    {stat && (
                        <div title={'En commun : caches que vous avez trouvées tous les deux.\n'
                            + 'Connues : ses trouvailles que GeoApp a déjà récupérées.'}>
                            <span className="codicon codicon-people" style={{ fontSize: '0.9em' }}></span>
                            {' '}
                            <span style={{ color: stat.shared_with_me > 0 ? 'var(--theia-charts-blue)' : undefined }}>
                                {`${formatNumber(stat.shared_with_me)} en commun`}
                            </span>
                            {` · ${formatNumber(stat.finds_count)} connues`}
                        </div>
                    )}
                    <div title="Dernière connexion sur geocaching.com">
                        <span className="codicon codicon-pulse" style={{ fontSize: '0.9em' }}></span>
                        {' En ligne : '}
                        <span style={{ color: onlineToday ? 'var(--theia-charts-green)' : undefined }}>
                            {onlineToday ? "aujourd'hui" : formatDate(friend.last_online)}
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
                        {` Membre depuis ${formatDate(friend.member_since)}`}
                    </div>
                </div>

                <div style={{ marginTop: '8px', display: 'flex', gap: '6px' }}>
                    <button
                        className="theia-button secondary"
                        style={{ padding: '2px 8px', fontSize: '0.85em' }}
                        onClick={() => onOpenSummary(friend.username)}
                        title={`Fiche de ${friend.username} : trouvailles, en commun, zones vérifiées`}
                    >
                        <span className="codicon codicon-person"></span>
                        {' Fiche'}
                    </button>
                    <button
                        className="theia-button secondary"
                        style={{ padding: '2px 8px', fontSize: '0.85em' }}
                        onClick={() => onShowActivity(friend.username)}
                        title={`Voir l'activité de ${friend.username}`}
                    >
                        <span className="codicon codicon-pulse"></span>
                        {' Activité'}
                    </button>
                </div>
            </div>
        </div>
    );
};
