import * as React from 'react';
import type { Geocache } from './geocaches-table';
import type { FriendZoneScanEntry } from './friends-types';

/**
 * Panneau de résultat de l'analyse des amis sur une zone.
 *
 * Répond directement à la question : « quels amis n'ont pas fait quelles caches ? »
 *
 * Deux modes :
 * - **Résumé** : une ligne par ami, avec barre de progression (trouvées / total)
 *   et bouton « Voir manquantes » qui active le filtre de la table.
 * - **Matrice** : ami × cache, avec ✓ / ✗ / —. Collapsible si la zone est grande.
 *
 * Le panneau utilise les données déjà chargées par le widget (`friendFinds`,
 * `friendScans`, `rows`) : aucun appel API supplémentaire.
 */

export interface ZoneFriendAnalysisPanelProps {
    /** Caches de la zone (pour le total et la matrice). */
    rows: Geocache[];
    /** « Qui a trouvé quoi » : code GC -> pseudos d'amis. */
    friendFinds: Record<string, string[]>;
    /** État des scans par ami (vérifié le…, obsolète…). */
    friendScans: FriendZoneScanEntry[];
    /** Ami sélectionné pour le filtre « manquantes pour X » (null = aucun). */
    missingForFriend: string | null;
    /** Active le filtre « manquantes pour X » dans la table. */
    onMissingForFriendChange: (friend: string | null) => void;
    /** Ouvre une géocache (clic sur une cellule de la matrice). */
    onOpenGeocache?: (geocache: Geocache) => void;
}

type ViewMode = 'summary' | 'matrix';

export const ZoneFriendAnalysisPanel: React.FC<ZoneFriendAnalysisPanelProps> = props => {
    const [mode, setMode] = React.useState<ViewMode>('summary');
    const [collapsed, setCollapsed] = React.useState(false);

    // Liste triée des amis (union de friendFinds et friendScans).
    const friendNames = React.useMemo(() => {
        const names = new Set<string>();
        for (const list of Object.values(props.friendFinds)) {
            for (const name of list) {
                names.add(name);
            }
        }
        for (const scan of props.friendScans) {
            names.add(scan.friend);
        }
        return Array.from(names).sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
    }, [props.friendFinds, props.friendScans]);

    if (friendNames.length === 0 || props.rows.length === 0) {
        return null;
    }

    const totalCaches = props.rows.length;

    // Pour chaque ami : caches trouvées, manquantes, et statut du scan.
    const friendStats = friendNames.map(name => {
        const foundCodes = new Set<string>();
        for (const [gcCode, finders] of Object.entries(props.friendFinds)) {
            if (finders.includes(name)) {
                foundCodes.add(gcCode);
            }
        }
        const foundInZone = props.rows.filter(r => foundCodes.has(r.gc_code)).length;
        const missing = totalCaches - foundInZone;
        const scan = props.friendScans.find(s => s.friend === name);
        return {
            name,
            found: foundInZone,
            missing,
            total: totalCaches,
            scanned: scan?.scanned ?? false,
            isStale: scan?.is_stale ?? false,
            scannedAt: scan?.scanned_at ?? null,
        };
    });

    // Tri : amis avec le plus de manquantes d'abord (ce sont eux qui intéressent).
    friendStats.sort((a, b) => b.missing - a.missing);

    if (collapsed) {
        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                marginBottom: 8,
                borderRadius: 4,
                border: '1px solid var(--theia-panel-border)',
                background: 'var(--theia-editor-background)',
                fontSize: '0.85em',
            }}>
                <span className='codicon codicon-organization' />
                <strong>Résultat amis</strong>
                <span style={{ color: 'var(--theia-descriptionForeground)' }}>
                    {friendNames.length} ami(s) · {totalCaches} cache(s)
                </span>
                <button
                    className='theia-button secondary'
                    onClick={() => setCollapsed(false)}
                    title='Déplier'
                    style={{ marginLeft: 'auto', padding: '2px 8px' }}
                >
                    <span className='codicon codicon-chevron-down' />
                </button>
            </div>
        );
    }

    return (
        <div style={{
            marginBottom: 8,
            borderRadius: 4,
            border: '1px solid var(--theia-panel-border)',
            background: 'var(--theia-editor-background)',
            overflow: 'hidden',
        }}>
            {/* En-tête du panneau */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                borderBottom: '1px solid var(--theia-panel-border)',
            }}>
                <span className='codicon codicon-organization' />
                <strong>Résultat de l'analyse amis</strong>
                <span style={{ color: 'var(--theia-descriptionForeground)', fontSize: '0.85em' }}>
                    {friendNames.length} ami(s) · {totalCaches} cache(s)
                </span>
                <div style={{ flex: 1 }} />
                {/* Sélecteur de mode */}
                <button
                    className={`theia-button ${mode === 'summary' ? '' : 'secondary'}`}
                    onClick={() => setMode('summary')}
                    title='Vue par ami'
                    style={{ padding: '2px 8px', fontSize: '0.85em' }}
                >
                    Par ami
                </button>
                <button
                    className={`theia-button ${mode === 'matrix' ? '' : 'secondary'}`}
                    onClick={() => setMode('matrix')}
                    title='Matrice ami × cache'
                    style={{ padding: '2px 8px', fontSize: '0.85em' }}
                >
                    Matrice
                </button>
                <button
                    className='theia-button secondary'
                    onClick={() => setCollapsed(true)}
                    title='Replier'
                    style={{ padding: '2px 8px' }}
                >
                    <span className='codicon codicon-chevron-up' />
                </button>
            </div>

            {/* Contenu */}
            <div style={{ maxHeight: 320, overflow: 'auto', padding: '4px 10px' }}>
                {mode === 'summary' ? (
                    <SummaryView
                        stats={friendStats}
                        missingForFriend={props.missingForFriend}
                        onMissingForFriendChange={props.onMissingForFriendChange}
                    />
                ) : (
                    <MatrixView
                        rows={props.rows}
                        friendNames={friendNames}
                        friendFinds={props.friendFinds}
                        onOpenGeocache={props.onOpenGeocache}
                    />
                )}
            </div>
        </div>
    );
};

// -------------------------------------------------- Vue résumé par ami

interface FriendStatRow {
    name: string;
    found: number;
    missing: number;
    total: number;
    scanned: boolean;
    isStale: boolean;
    scannedAt: string | null;
}

const SummaryView: React.FC<{
    stats: FriendStatRow[];
    missingForFriend: string | null;
    onMissingForFriendChange: (friend: string | null) => void;
}> = ({ stats, missingForFriend, onMissingForFriendChange }) => {
    return (
        <div>
            {stats.map(stat => {
                const isActive = missingForFriend === stat.name;
                const pct = stat.total > 0 ? Math.round(100 * stat.found / stat.total) : 0;
                return (
                    <div
                        key={stat.name}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '4px 0',
                            borderBottom: '1px solid var(--theia-panel-border)',
                        }}
                    >
                        {/* Pseudo */}
                        <span style={{ minWidth: 120, fontWeight: isActive ? 'bold' : 'normal' }}>
                            {stat.name}
                        </span>

                        {/* Statut du scan */}
                        {!stat.scanned ? (
                            <span
                                style={{ fontSize: '0.75em', color: 'var(--theia-descriptionForeground)' }}
                                title='Jamais analysé'
                            >
                                non analysé
                            </span>
                        ) : stat.isStale ? (
                            <span
                                style={{ fontSize: '0.75em', color: 'var(--theia-charts-orange)' }}
                                title='Scan obsolète (zone modifiée depuis)'
                            >
                                obsolète
                            </span>
                        ) : (
                            <span
                                style={{ fontSize: '0.75em', color: 'var(--theia-charts-green)' }}
                                title={stat.scannedAt ? `Vérifié le ${new Date(stat.scannedAt).toLocaleDateString('fr-FR')}` : 'À jour'}
                            >
                                à jour
                            </span>
                        )}

                        {/* Barre de progression */}
                        <div style={{
                            flex: 1,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: 'var(--theia-panel-border)',
                            overflow: 'hidden',
                            position: 'relative',
                        }}>
                            <div style={{
                                width: `${pct}%`,
                                height: '100%',
                                backgroundColor: 'var(--theia-charts-green)',
                                transition: 'width 0.3s',
                            }} />
                        </div>

                        {/* Compteurs */}
                        <span style={{
                            minWidth: 80,
                            textAlign: 'right',
                            fontSize: '0.85em',
                            color: 'var(--theia-descriptionForeground)',
                        }}>
                            <strong style={{ color: 'var(--theia-charts-green)' }}>{stat.found}</strong>
                            {` / ${stat.total}`}
                            {stat.missing > 0 && (
                                <span style={{ color: 'var(--theia-charts-red)' }}>
                                    {' '}({stat.missing} manquante{stat.missing > 1 ? 's' : ''})
                                </span>
                            )}
                        </span>

                        {/* Bouton « Voir manquantes » */}
                        {stat.missing > 0 && (
                            <button
                                className={`theia-button ${isActive ? '' : 'secondary'}`}
                                onClick={() => onMissingForFriendChange(isActive ? null : stat.name)}
                                title={isActive
                                    ? 'Désactiver le filtre'
                                    : `Filtrer la table sur les ${stat.missing} cache(s) manquante(s) pour ${stat.name}`}
                                style={{ padding: '2px 8px', fontSize: '0.8em' }}
                            >
                                {isActive ? '✕' : 'Voir manquantes'}
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

// -------------------------------------------------- Vue matrice

const MatrixView: React.FC<{
    rows: Geocache[];
    friendNames: string[];
    friendFinds: Record<string, string[]>;
    onOpenGeocache?: (geocache: Geocache) => void;
}> = ({ rows, friendNames, friendFinds, onOpenGeocache }) => {
    // Pré-calcul : pour chaque ami, un Set des gc_code trouvés.
    const friendFoundSets = React.useMemo(() => {
        const map = new Map<string, Set<string>>();
        for (const name of friendNames) {
            const set = new Set<string>();
            for (const [gcCode, finders] of Object.entries(friendFinds)) {
                if (finders.includes(name)) {
                    set.add(gcCode);
                }
            }
            map.set(name, set);
        }
        return map;
    }, [friendNames, friendFinds]);

    // Limiter le nombre de colonnes pour éviter une matrice illisible.
    const MAX_COLUMNS = 20;
    const showAll = rows.length <= MAX_COLUMNS;
    const visibleRows = showAll ? rows : rows.slice(0, MAX_COLUMNS);

    if (!showAll) {
        return (
            <div style={{ padding: '8px 0', color: 'var(--theia-descriptionForeground)' }}>
                La zone contient {rows.length} caches : la matrice est limitée aux {MAX_COLUMNS} premières.
                Utilisez la vue « Par ami » et le filtre « Voir manquantes » pour une analyse complète.
            </div>
        );
    }

    return (
        <div style={{ overflow: 'auto' }}>
            <table style={{
                borderCollapse: 'collapse',
                fontSize: '0.8em',
                width: '100%',
            }}>
                <thead>
                    <tr>
                        <th style={{
                            position: 'sticky',
                            left: 0,
                            background: 'var(--theia-editor-background)',
                            borderBottom: '1px solid var(--theia-panel-border)',
                            padding: '4px 8px',
                            textAlign: 'left',
                            minWidth: 100,
                        }}>
                            Ami
                        </th>
                        {visibleRows.map(gc => (
                            <th
                                key={gc.gc_code}
                                style={{
                                    borderBottom: '1px solid var(--theia-panel-border)',
                                    padding: '4px 4px',
                                    textAlign: 'center',
                                    maxWidth: 60,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}
                                title={`${gc.name} (${gc.gc_code})`}
                            >
                                <span
                                    style={{ cursor: onOpenGeocache ? 'pointer' : 'default' }}
                                    onClick={onOpenGeocache ? () => onOpenGeocache(gc) : undefined}
                                >
                                    {gc.gc_code.replace('GC', '')}
                                </span>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {friendNames.map(name => {
                        const foundSet = friendFoundSets.get(name) ?? new Set();
                        return (
                            <tr key={name}>
                                <td style={{
                                    position: 'sticky',
                                    left: 0,
                                    background: 'var(--theia-editor-background)',
                                    borderBottom: '1px solid var(--theia-panel-border)',
                                    padding: '4px 8px',
                                    fontWeight: 'bold',
                                    whiteSpace: 'nowrap',
                                }}>
                                    {name}
                                </td>
                                {visibleRows.map(gc => {
                                    const found = foundSet.has(gc.gc_code);
                                    return (
                                        <td
                                            key={gc.gc_code}
                                            style={{
                                                borderBottom: '1px solid var(--theia-panel-border)',
                                                padding: '4px',
                                                textAlign: 'center',
                                            }}
                                        >
                                            {found ? (
                                                <span
                                                    style={{ color: 'var(--theia-charts-green)', fontWeight: 'bold' }}
                                                    title={`${name} a trouvé ${gc.gc_code}`}
                                                >
                                                    ✓
                                                </span>
                                            ) : (
                                                <span
                                                    style={{ color: 'var(--theia-charts-red)', opacity: 0.5 }}
                                                    title={`${name} n'a pas trouvé ${gc.gc_code}`}
                                                >
                                                    ✗
                                                </span>
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};
