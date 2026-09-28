import * as React from 'react';
import type { FriendEvent, FriendSuggestion } from './friends-types';

export interface FriendsTodoPanelProps {
    suggestions: FriendSuggestion[];
    suggestionsLoading: boolean;
    suggestionsError: string | null;
    minFriends: number;
    onMinFriendsChange: (value: number) => void;

    events: FriendEvent[];

    /** Caches trouvées par des amis mais absentes de GeoApp. */
    importableCount: number;
    importing: boolean;
    importProgress: string | null;
    onImport: () => void;
    onCancelImport: () => void;

    onOpenGeocache: (geocacheId: number, name: string) => void;
}

const sectionStyle: React.CSSProperties = { marginBottom: '24px' };
const sectionTitleStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontWeight: 'bold'
};
const rowStyle: React.CSSProperties = {
    padding: '10px 0', borderBottom: '1px solid var(--theia-panel-border)'
};
const metaStyle: React.CSSProperties = {
    fontSize: '0.8em', color: 'var(--theia-descriptionForeground)',
    display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '2px'
};
const mutedStyle: React.CSSProperties = { color: 'var(--theia-descriptionForeground)' };

/**
 * Onglet « À faire » du widget Amis : ce que l'activité des amis suggère de
 * faire soi-même — events à venir, caches qu'ils ont trouvées et pas vous.
 *
 * L'import dans la zone « Amis » vit ici plutôt que dans un bandeau permanent
 * du flux : on importe une cache pour la chercher, et c'est dans cette liste
 * que l'utilisateur la voit sans lien vers une fiche GeoApp.
 */
export const FriendsTodoPanel: React.FC<FriendsTodoPanelProps> = props => {
    const [showPastEvents, setShowPastEvents] = React.useState(false);
    const upcoming = props.events.filter(e => e.is_upcoming);
    const past = props.events.filter(e => !e.is_upcoming);

    const cacheLink = (geocacheId: number, gcCode: string | null, name: string): React.ReactNode => {
        if (geocacheId > 0) {
            return (
                <a onClick={() => props.onOpenGeocache(geocacheId, name)} style={{ cursor: 'pointer' }} title="Ouvrir la fiche dans GeoApp">
                    {name}
                </a>
            );
        }
        if (!gcCode) {
            return <span>{name}</span>;
        }
        return (
            <a href={`https://www.geocaching.com/geocache/${gcCode}`} target="_blank" rel="noreferrer" title="Ouvrir sur geocaching.com">
                {name}
            </a>
        );
    };

    const friendsCount = (count: number, title: string): React.ReactNode => (
        <>
            <span className="codicon codicon-people" style={{ color: 'var(--theia-charts-blue)', fontSize: '0.9em' }} title={title}></span>
            <strong style={{ color: 'var(--theia-charts-blue)' }}>{count}</strong>
        </>
    );

    const renderEvent = (e: FriendEvent): React.ReactNode => (
        <div key={(e.gc_code || '') + (e.name || '')} style={rowStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                {friendsCount(e.friends_count, `${e.friends_count} ami(s) y participent`)}
                {cacheLink(0, e.gc_code, e.name)}
                {e.gc_code && <span style={{ ...mutedStyle, fontSize: '0.85em' }}>{e.gc_code}</span>}
            </div>
            <div style={metaStyle}>
                <span style={{ color: e.is_upcoming ? 'var(--theia-charts-green)' : undefined }}>
                    {e.event_date
                        ? new Date(e.event_date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
                        : 'Date inconnue'}
                </span>
                {e.location_name && <span>{e.location_name}</span>}
            </div>
            <div style={{ ...metaStyle, display: 'block' }}>{e.friends.join(', ')}</div>
        </div>
    );

    const renderSuggestion = (s: FriendSuggestion): React.ReactNode => (
        <div key={s.gc_code} style={rowStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                {friendsCount(s.friends_count, `${s.friends_count} ami(s) ont trouvé cette cache`)}
                {cacheLink(s.geocache_id, s.gc_code, s.name)}
                <span style={{ ...mutedStyle, fontSize: '0.85em' }}>{s.gc_code}</span>
                {s.status === 'archived' && (
                    <span style={{ color: 'var(--theia-errorForeground)', fontSize: '0.85em' }}>archivée</span>
                )}
                {s.geocache_id <= 0 && (
                    <span style={{ ...mutedStyle, fontSize: '0.8em' }} title="Pas encore dans GeoApp">
                        <span className="codicon codicon-cloud" style={{ fontSize: '0.9em' }}></span>
                    </span>
                )}
            </div>
            <div style={metaStyle}>
                {s.cache_type && <span>{s.cache_type}</span>}
                {s.difficulty !== null && s.terrain !== null && <span>{`D ${s.difficulty} / T ${s.terrain}`}</span>}
                {s.favorites_count > 0 && (
                    <span title="Points favoris" style={{ color: 'var(--theia-charts-red)' }}>
                        <span className="codicon codicon-heart-filled" style={{ fontSize: '0.9em' }}></span>
                        {` ${s.favorites_count}`}
                    </span>
                )}
            </div>
            <div style={{ ...metaStyle, display: 'block' }}>{s.friends.join(', ')}</div>
        </div>
    );

    return (
        <div>
            {(props.importableCount > 0 || props.importing) && (
                <div style={{
                    padding: '8px 12px',
                    marginBottom: '16px',
                    backgroundColor: 'var(--theia-inputValidation-infoBackground)',
                    borderRadius: '4px',
                    fontSize: '0.9em',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    flexWrap: 'wrap'
                }}>
                    {props.importing ? (
                        <>
                            <span className="codicon codicon-cloud-download"></span>
                            <span style={{ flex: 1, minWidth: '200px' }}>{props.importProgress}</span>
                            <button className="theia-button secondary" onClick={props.onCancelImport}>Arrêter</button>
                        </>
                    ) : (
                        <>
                            <span className="codicon codicon-cloud"></span>
                            <span style={{ flex: 1, minWidth: '200px' }}>
                                {`${props.importableCount} cache(s) trouvée(s) par vos amis ne sont pas encore dans GeoApp. `}
                                {'Importez-les pour les ouvrir, les résoudre et les voir sur la carte.'}
                            </span>
                            <button
                                className="theia-button"
                                onClick={props.onImport}
                                title="Les géocaches sont rangées dans la zone « Amis », masquée par défaut (préférences › Amis)"
                            >
                                Importer
                            </button>
                        </>
                    )}
                </div>
            )}

            <div style={sectionStyle}>
                <div style={sectionTitleStyle}>
                    <span className="codicon codicon-calendar"></span>
                    Events à venir
                    <span style={{ ...mutedStyle, fontWeight: 'normal' }}>{`(${upcoming.length})`}</span>
                </div>
                {upcoming.length === 0 ? (
                    <div style={mutedStyle}>Aucun event annoncé par vos amis.</div>
                ) : upcoming.map(renderEvent)}
                {past.length > 0 && (
                    <button
                        className="theia-button secondary"
                        style={{ marginTop: '8px', padding: '2px 8px', fontSize: '0.85em' }}
                        onClick={() => setShowPastEvents(!showPastEvents)}
                    >
                        {showPastEvents ? 'Masquer les events passés' : `Events passés (${past.length})`}
                    </button>
                )}
                {showPastEvents && past.map(renderEvent)}
            </div>

            <div style={sectionStyle}>
                <div style={sectionTitleStyle}>
                    <span className="codicon codicon-lightbulb"></span>
                    Trouvées par vos amis, pas par vous
                    <span style={{ flex: 1 }}></span>
                    <label
                        style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85em', fontWeight: 'normal' }}
                        title="Nombre minimum d'amis ayant trouvé la cache"
                    >
                        au moins
                        <input
                            type="number"
                            className="theia-input"
                            min={1}
                            max={50}
                            value={props.minFriends}
                            onChange={e => props.onMinFriendsChange(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                            style={{ width: '3em' }}
                        />
                        ami(s)
                    </label>
                </div>

                {props.suggestionsLoading && <div style={mutedStyle}>Chargement…</div>}
                {!props.suggestionsLoading && props.suggestionsError && (
                    <div style={{ color: 'var(--theia-errorForeground)', marginBottom: '8px' }}>
                        <span className="codicon codicon-error"></span>
                        {` ${props.suggestionsError}`}
                        {props.suggestions.length > 0 && ' (liste précédente conservée ci-dessous)'}
                    </div>
                )}
                {!props.suggestionsLoading && !props.suggestionsError && props.suggestions.length === 0 && (
                    <div style={mutedStyle}>
                        Rien pour l'instant. GeoApp apprend ce que vos amis ont trouvé par la mise à jour
                        de l'activité, par « Récupérer toutes ses trouvailles » sur la fiche d'un ami,
                        et par « Vérifier qui a trouvé » en mode sortie.
                    </div>
                )}
                {!props.suggestionsLoading && props.suggestions.map(renderSuggestion)}
            </div>
        </div>
    );
};
