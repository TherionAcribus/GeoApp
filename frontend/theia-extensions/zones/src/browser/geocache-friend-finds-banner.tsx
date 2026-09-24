import * as React from 'react';
import type { FriendFinder } from './friends-types';
import {
    GEOCACHE_FRIEND_FINDS_UPDATED_EVENT,
    GeocacheFriendFindsUpdatedDetail
} from './geocache-logs-types';

/**
 * Bandeau « ces amis ont trouvé cette cache ».
 *
 * Sur une mystery sur laquelle on sèche, c'est l'information la plus utile que
 * l'app puisse donner : qui interroger. Chaque ami est donc doublé d'un lien
 * direct vers le Message Center de geocaching.com.
 *
 * Le composant va chercher ses propres données : il n'a besoin que de l'id de la
 * géocache, et le reste de la fiche n'a rien à savoir de lui.
 */

export interface GeocacheFriendFindsBannerProps {
    geocacheId: number;
    apiBaseUrl: string;
    /** Ouvre une URL externe ; par défaut window.open. */
    onOpenUrl?: (url: string) => void;
}

export const GeocacheFriendFindsBanner: React.FC<GeocacheFriendFindsBannerProps> = ({
    geocacheId,
    apiBaseUrl,
    onOpenUrl
}) => {
    const [friends, setFriends] = React.useState<FriendFinder[]>([]);
    const [loaded, setLoaded] = React.useState(false);
    /**
     * Incrémenté à chaque récupération de logs de cette cache : le
     * rafraîchissement des logs découvre des trouvailles d'amis, et sans cette
     * relecture le bandeau resterait sur le chiffre lu à l'ouverture de la fiche.
     */
    const [reloadToken, setReloadToken] = React.useState(0);
    /** Cache dont le contenu affiché provient, pour distinguer relecture et changement de cache. */
    const shownForRef = React.useRef<number | undefined>(undefined);

    React.useEffect(() => {
        const onFriendFindsUpdated = (event: Event): void => {
            const detail = (event as CustomEvent<GeocacheFriendFindsUpdatedDetail>).detail;
            if (detail?.geocacheId === geocacheId) {
                setReloadToken(token => token + 1);
            }
        };

        window.addEventListener(GEOCACHE_FRIEND_FINDS_UPDATED_EVENT, onFriendFindsUpdated);
        return () => window.removeEventListener(GEOCACHE_FRIEND_FINDS_UPDATED_EVENT, onFriendFindsUpdated);
    }, [geocacheId]);

    React.useEffect(() => {
        let cancelled = false;
        // On ne vide qu'en changeant de géocache : sur une simple relecture
        // (après un rafraîchissement des logs), le bandeau déjà affiché reste
        // en place jusqu'à la réponse, sinon il clignoterait.
        if (shownForRef.current !== geocacheId) {
            shownForRef.current = geocacheId;
            setFriends([]);
            setLoaded(false);
        }

        fetch(`${apiBaseUrl}/api/friends/finds/geocache/${geocacheId}`)
            .then(response => {
                const contentType = response.headers.get('content-type') || '';
                if (!contentType.includes('application/json')) {
                    throw new Error(`HTTP ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (!cancelled && data?.success) {
                    setFriends(data.friends || []);
                    setLoaded(true);
                }
            })
            .catch(error => {
                // Silencieux : l'absence de ce bandeau ne doit jamais gêner la fiche.
                console.debug('[FriendFinds] indisponible:', error);
            });

        return () => { cancelled = true; };
    }, [geocacheId, apiBaseUrl, reloadToken]);

    if (!loaded || friends.length === 0) {
        return null;
    }

    const openUrl = (url: string) => {
        if (onOpenUrl) {
            onOpenUrl(url);
        } else {
            window.open(url, '_blank', 'noopener');
        }
    };

    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 6,
                border: '1px solid var(--theia-panel-border)',
                background: 'var(--theia-editor-background)'
            }}
        >
            <i className='fa fa-users' style={{ marginTop: 3, opacity: 0.8 }} aria-hidden='true' />
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 'bold', marginBottom: 6 }}>
                    {friends.length === 1
                        ? '1 de vos amis a trouvé cette géocache'
                        : `${friends.length} de vos amis ont trouvé cette géocache`}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {friends.map(friend => (
                        <span
                            key={friend.username}
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '2px 8px',
                                borderRadius: 12,
                                border: '1px solid var(--theia-panel-border)',
                                fontSize: 12
                            }}
                        >
                            {friend.avatar_url && (
                                <img
                                    src={friend.avatar_url}
                                    alt=''
                                    style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover' }}
                                />
                            )}
                            {friend.profile_url ? (
                                <a
                                    href={friend.profile_url}
                                    target='_blank'
                                    rel='noreferrer'
                                    title={`Profil de ${friend.username}`}
                                >
                                    {friend.username}
                                </a>
                            ) : (
                                <span>{friend.username}</span>
                            )}
                            {friend.message_url && (
                                <button
                                    onClick={() => openUrl(friend.message_url!)}
                                    title={`Demander un coup de pouce à ${friend.username}`}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        color: 'var(--theia-textLink-foreground)',
                                        padding: 0,
                                        lineHeight: 1
                                    }}
                                >
                                    <i className='fa fa-comment-o' aria-hidden='true' />
                                </button>
                            )}
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );
};
