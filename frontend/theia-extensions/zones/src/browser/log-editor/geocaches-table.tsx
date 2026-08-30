/**
 * Tableau des géocaches à loguer (ordre d'envoi, type de log, statut, PF…).
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 1). Composant pur :
 * tout son état dérive des props, il n'accède jamais au widget parent.
 */

import * as React from '@theia/core/shared/react';
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    ColumnDef,
    flexRender,
    SortingState,
} from '@tanstack/react-table';
import { GeocacheIcon } from '../geocache-icon';
import { LogTypeIcon } from '../geocache-log-type-icons';
import { DnfBadge } from './dnf-badge';
import {
    ALREADY_FOUND_ACCENT,
    ALREADY_FOUND_ROW_BACKGROUND,
    DNF_ACCENT,
    DNF_ROW_BACKGROUND,
    JUST_LOGGED_ACCENT,
    JUST_LOGGED_ROW_BACKGROUND,
} from './constants';
import {
    alreadyFoundTooltip,
    getLogTypeLabel,
    isJustLogged,
    isPendingDnf,
    isPreviouslyFound,
    sanitizeLogTypeForGeocache,
} from './helpers';
import { SubmitBadge } from './submit-badge';
import { GeocacheListItem, LogTypeValue, SubmissionStatus } from './types';

const GeocacheLogEditorGeocachesTableImpl: React.FC<{
    data: GeocacheListItem[];
    logType: LogTypeValue;
    perCacheLogType: Record<number, LogTypeValue>;
    perCacheFavorite: Record<number, boolean>;
    perCacheSubmitStatus: Record<number, SubmissionStatus>;
    perCacheSubmitReference: Record<number, string | undefined>;
    /** Raison du dernier échec, par géocache : sert d'infobulle sur le badge d'échec. */
    perCacheSubmitError: Record<number, string | undefined>;
    onToggleFavorite: (geocacheId: number, nextValue: boolean) => void;
    onToggleLogType: (geocacheId: number, nextValue: LogTypeValue) => void;
    /** Ordre d'envoi manuel : la liste complète des identifiants, dans le nouvel ordre. */
    onReorder: (orderedGeocacheIds: number[]) => void;
    reorderDisabled?: boolean;
    remainingFavoritePoints: number;
    maxHeight?: number;
}> = ({ data, logType, perCacheLogType, perCacheFavorite, perCacheSubmitStatus, perCacheSubmitReference, perCacheSubmitError, onToggleFavorite, onToggleLogType, onReorder, reorderDisabled = false, remainingFavoritePoints, maxHeight = 220 }) => {
    const [sorting, setSorting] = React.useState<SortingState>([]);
    const [draggedId, setDraggedId] = React.useState<number | null>(null);
    const [dropIndicator, setDropIndicator] = React.useState<{ id: number; position: 'before' | 'after' } | null>(null);

    const canReorder = !reorderDisabled && data.length > 1;

    const rowRefs = React.useRef<Record<number, HTMLTableRowElement | null>>({});
    /** Ordre actuellement affiché (donc éventuellement trié) : c'est lui que le glisser-déposer manipule. */
    const displayedIdsRef = React.useRef<number[]>([]);

    /** Un déplacement fige l'ordre affiché comme ordre d'envoi : le tri éventuel est abandonné. */
    const commitOrder = (orderedIds: number[]): void => {
        setSorting([]);
        setDraggedId(null);
        setDropIndicator(null);
        onReorder(orderedIds);
    };

    const moveRelativeTo = (sourceId: number, targetId: number, position: 'before' | 'after'): void => {
        if (sourceId === targetId) {
            setDropIndicator(null);
            setDraggedId(null);
            return;
        }
        const order = displayedIdsRef.current.filter(id => id !== sourceId);
        const targetIndex = order.indexOf(targetId);
        if (targetIndex === -1) {
            setDropIndicator(null);
            setDraggedId(null);
            return;
        }
        order.splice(position === 'after' ? targetIndex + 1 : targetIndex, 0, sourceId);
        commitOrder(order);
    };

    const moveByOffset = (geocacheId: number, delta: number): void => {
        const order = [...displayedIdsRef.current];
        const from = order.indexOf(geocacheId);
        const to = from + delta;
        if (from === -1 || to < 0 || to >= order.length) {
            return;
        }
        order.splice(from, 1);
        order.splice(to, 0, geocacheId);
        commitOrder(order);
    };

    const columns = React.useMemo<ColumnDef<GeocacheListItem>[]>(() => {
        const getPct = (favoritesCount: number | undefined, logsCount: number | undefined): number | undefined => {
            if (typeof favoritesCount !== 'number' || typeof logsCount !== 'number' || logsCount <= 0) {
                return undefined;
            }
            const pct = (favoritesCount / logsCount) * 100;
            return isFinite(pct) ? pct : undefined;
        };

        const getPlacedTs = (iso: string | null | undefined): number | undefined => {
            if (!iso) {
                return undefined;
            }
            const ts = Date.parse(iso);
            return isFinite(ts) ? ts : undefined;
        };

        const formatPlaced = (iso: string | null | undefined): string => {
            if (!iso) {
                return '—';
            }
            const ts = Date.parse(iso);
            if (!isFinite(ts)) {
                return '—';
            }
            return new Date(ts).toISOString().slice(0, 10);
        };

        const statusBadge = (gc: GeocacheListItem): React.ReactNode => (
            <SubmitBadge
                status={perCacheSubmitStatus[gc.id]}
                reference={perCacheSubmitReference[gc.id]}
                error={perCacheSubmitError[gc.id]}
                compact
                isSkipped={sanitizeLogTypeForGeocache(perCacheLogType[gc.id] ?? logType, gc) === 'skip'}
            />
        );

        return [
            {
                id: 'order',
                header: () => <span title="Ordre d'envoi des logs">#</span>,
                cell: ({ row }) => {
                    const gc = row.original;
                    return (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                            <span style={{ fontSize: 11, opacity: 0.7, minWidth: 14, textAlign: 'right' }}>
                                {row.index + 1}
                            </span>
                            <span
                                draggable={canReorder}
                                onDragStart={e => {
                                    if (!canReorder) {
                                        e.preventDefault();
                                        return;
                                    }
                                    if (e.dataTransfer) {
                                        e.dataTransfer.effectAllowed = 'move';
                                        try {
                                            e.dataTransfer.setData('text/plain', String(gc.id));
                                        } catch {
                                            // certains navigateurs refusent setData hors dragstart utilisateur
                                        }
                                        const rowEl = rowRefs.current[gc.id];
                                        if (rowEl) {
                                            try {
                                                e.dataTransfer.setDragImage(rowEl, 16, 12);
                                            } catch {
                                                // image de drag par défaut
                                            }
                                        }
                                    }
                                    setDraggedId(gc.id);
                                }}
                                onDragEnd={() => {
                                    setDraggedId(null);
                                    setDropIndicator(null);
                                }}
                                onKeyDown={e => {
                                    if (!canReorder || !e.altKey) {
                                        return;
                                    }
                                    if (e.key === 'ArrowUp') {
                                        e.preventDefault();
                                        moveByOffset(gc.id, -1);
                                    } else if (e.key === 'ArrowDown') {
                                        e.preventDefault();
                                        moveByOffset(gc.id, 1);
                                    }
                                }}
                                role='button'
                                tabIndex={canReorder ? 0 : -1}
                                aria-label={`Déplacer ${gc.gc_code} dans l'ordre d'envoi`}
                                title={canReorder
                                    ? "Glisser pour changer l'ordre d'envoi (Alt + ↑/↓ au clavier)"
                                    : "Réordonnancement indisponible"}
                                style={{
                                    cursor: canReorder ? 'grab' : 'default',
                                    opacity: canReorder ? 0.75 : 0.3,
                                    fontSize: 14,
                                    lineHeight: 1,
                                    padding: '0 2px',
                                    userSelect: 'none'
                                }}
                            >
                                ⠿
                            </span>
                        </div>
                    );
                },
                enableSorting: false,
            },
            {
                id: 'status',
                header: 'Statut',
                cell: ({ row }) => statusBadge(row.original),
                sortingFn: (a, b) => {
                    const rank = (s: SubmissionStatus | undefined): number => {
                        if (s === 'failed') {
                            return 0;
                        }
                        if (s === 'skipped') {
                            return 1;
                        }
                        if (s === 'ok') {
                            return 2;
                        }
                        return 3;
                    };
                    return rank(perCacheSubmitStatus[a.original.id]) - rank(perCacheSubmitStatus[b.original.id]);
                },
            },
            {
                accessorKey: 'gc_code',
                header: 'GC',
                cell: ({ row }) => (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                        <strong>{row.original.gc_code}</strong>
                        {isPreviouslyFound(row.original, perCacheSubmitStatus) && (
                            <LogTypeIcon kind='found' size={15} title={alreadyFoundTooltip(row.original)} />
                        )}
                        {isPendingDnf(
                            row.original,
                            sanitizeLogTypeForGeocache(perCacheLogType[row.original.id] ?? logType, row.original),
                            perCacheSubmitStatus
                        ) && <DnfBadge compact />}
                    </div>
                ),
            },
            {
                id: 'log_type',
                header: 'Log',
                cell: ({ row }) => {
                    const gc = row.original;
                    const justLogged = isJustLogged(gc, perCacheSubmitStatus);
                    const previouslyFound = isPreviouslyFound(gc, perCacheSubmitStatus);
                    const current = sanitizeLogTypeForGeocache(perCacheLogType[gc.id] ?? logType, gc);
                    return (
                        <select
                            className='theia-select'
                            value={current}
                            onChange={e => onToggleLogType(gc.id, e.target.value as LogTypeValue)}
                            disabled={justLogged}
                            title={justLogged
                                ? 'Log déjà envoyé pour cette géocache'
                                : previouslyFound ? alreadyFoundTooltip(gc) : undefined}
                            style={isPendingDnf(gc, current, perCacheSubmitStatus)
                                ? { fontSize: 12, color: DNF_ACCENT, borderColor: DNF_ACCENT, fontWeight: 600 }
                                : { fontSize: 12 }}
                        >
                            <option value='found' disabled={previouslyFound}>{getLogTypeLabel('found')}</option>
                            <option value='dnf'>{getLogTypeLabel('dnf')}</option>
                            <option value='note'>{getLogTypeLabel('note')}</option>
                            <option value='skip'>{getLogTypeLabel('skip')}</option>
                        </select>
                    );
                },
                enableSorting: false,
            },
            {
                accessorKey: 'name',
                header: 'Nom',
                cell: info => (
                    <div style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={info.getValue() as string}>
                        {info.getValue() as string}
                    </div>
                ),
            },
            {
                accessorKey: 'owner',
                header: 'Owner',
                cell: info => {
                    const owner = (info.getValue() as string | undefined) || '';
                    if (!owner) {
                        return <span style={{ opacity: 0.7 }}>—</span>;
                    }
                    return (
                        <div
                            style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, opacity: 0.85 }}
                            title={owner}
                        >
                            {owner}
                        </div>
                    );
                },
                sortingFn: 'alphanumeric',
            },
            {
                accessorKey: 'cache_type',
                header: 'Type',
                cell: info => {
                    const type = (info.getValue() as string | undefined) || '';
                    if (!type) {
                        return <span style={{ opacity: 0.7 }}>—</span>;
                    }
                    return (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <GeocacheIcon type={type} size={18} showLabel={false} />
                            <span style={{ fontSize: 12, opacity: 0.85, whiteSpace: 'nowrap' }}>{type}</span>
                        </div>
                    );
                },
                sortingFn: 'alphanumeric',
            },
            {
                id: 'placed_at',
                header: 'Posée',
                accessorFn: row => getPlacedTs(row.placed_at),
                cell: ({ row }) => <span style={{ fontSize: 12, opacity: 0.85 }}>{formatPlaced(row.original.placed_at)}</span>,
            },
            {
                accessorKey: 'favorites_count',
                header: 'PF',
                cell: info => <span style={{ fontSize: 12 }}>{typeof info.getValue() === 'number' ? (info.getValue() as number) : '—'}</span>,
            },
            {
                id: 'pf_pct',
                header: '%PF',
                accessorFn: row => getPct(row.favorites_count, row.logs_count),
                cell: ({ row }) => {
                    const pct = getPct(row.original.favorites_count, row.original.logs_count);
                    return <span style={{ fontSize: 12, opacity: 0.85 }}>{typeof pct === 'number' ? `${pct.toFixed(1)}%` : '—'}</span>;
                },
            },
            {
                id: 'fav',
                header: 'Donner PF',
                cell: ({ row }) => {
                    const gc = row.original;
                    const currentLogType = sanitizeLogTypeForGeocache(perCacheLogType[gc.id] ?? logType, gc);
                    const isChecked = perCacheFavorite[gc.id] === true;
                    const disabled = currentLogType !== 'found' || perCacheSubmitStatus[gc.id] === 'ok' || (!isChecked && remainingFavoritePoints <= 0);
                    return (
                        <input
                            type='checkbox'
                            checked={isChecked}
                            onChange={e => onToggleFavorite(gc.id, e.target.checked)}
                            disabled={disabled}
                            title={!isChecked && remainingFavoritePoints <= 0 ? 'Plus de PF disponibles' : ''}
                        />
                    );
                },
                enableSorting: false,
            },
        ];
    }, [data, canReorder, logType, perCacheLogType, perCacheFavorite, perCacheSubmitStatus, perCacheSubmitReference, perCacheSubmitError, onToggleFavorite, onToggleLogType]);

    const table = useReactTable({
        data,
        columns,
        state: { sorting },
        onSortingChange: setSorting,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
    });

    const displayedRows = table.getRowModel().rows;
    displayedIdsRef.current = displayedRows.map(row => row.original.id);

    // L'ordre affiché est l'ordre d'envoi : un tri par colonne est donc reporté sur la liste
    // du parent, pour que les blocs de texte par cache et l'envoi suivent ce que l'on voit.
    const displayedIdsKey = displayedIdsRef.current.join(',');
    const dataIdsKey = data.map(gc => gc.id).join(',');
    React.useEffect(() => {
        if (displayedIdsKey !== dataIdsKey) {
            onReorder([...displayedIdsRef.current]);
        }
        // `onReorder` est recréé à chaque rendu du parent : le comparer relancerait l'effet pour rien.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [displayedIdsKey, dataIdsKey]);

    const alreadyFoundCount = data.filter(gc => isPreviouslyFound(gc, perCacheSubmitStatus)).length;
    const justLoggedCount = data.filter(gc => isJustLogged(gc, perCacheSubmitStatus)).length;
    const dnfCount = data.filter(gc => isPendingDnf(
        gc,
        sanitizeLogTypeForGeocache(perCacheLogType[gc.id] ?? logType, gc),
        perCacheSubmitStatus
    )).length;

    return (
        <div style={{ border: '1px solid var(--theia-panel-border)', borderRadius: 6, overflow: 'hidden' }}>
            <div
                style={{
                    padding: '6px 10px',
                    fontSize: 12,
                    fontWeight: 700,
                    background: 'var(--theia-editor-background)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap'
                }}
            >
                <span>Géocaches</span>
                {alreadyFoundCount > 0 && (
                    <span
                        style={{
                            padding: '2px 8px',
                            borderRadius: 10,
                            fontSize: 11,
                            fontWeight: 600,
                            background: ALREADY_FOUND_ROW_BACKGROUND,
                            color: ALREADY_FOUND_ACCENT,
                            border: `1px solid ${ALREADY_FOUND_ACCENT}`,
                            whiteSpace: 'nowrap',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4
                        }}
                        title={'Une géocache ne peut être loguée "Found it" qu\'une seule fois : ces lignes sont passées en "Ne pas loguer".'}
                    >
                        <LogTypeIcon kind='found' size={13} />
                        {alreadyFoundCount} déjà trouvée{alreadyFoundCount > 1 ? 's' : ''} — "Found it" indisponible
                    </span>
                )}
                {justLoggedCount > 0 && (
                    <span
                        style={{
                            padding: '2px 8px',
                            borderRadius: 10,
                            fontSize: 11,
                            fontWeight: 600,
                            background: JUST_LOGGED_ROW_BACKGROUND,
                            color: JUST_LOGGED_ACCENT,
                            border: `1px solid ${JUST_LOGGED_ACCENT}`,
                            whiteSpace: 'nowrap'
                        }}
                        title='Logs envoyés sur Geocaching.com pendant cette session : ces géocaches ne peuvent plus être reloguées ici.'
                    >
                        ✅ {justLoggedCount} loguée{justLoggedCount > 1 ? 's' : ''}
                    </span>
                )}
                {dnfCount > 0 && (
                    <span
                        style={{
                            padding: '2px 8px',
                            borderRadius: 10,
                            fontSize: 11,
                            fontWeight: 600,
                            background: DNF_ROW_BACKGROUND,
                            color: DNF_ACCENT,
                            border: `1px solid ${DNF_ACCENT}`,
                            whiteSpace: 'nowrap',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4
                        }}
                        title={'Ces géocaches partiront en "Didn\'t find it".'}
                    >
                        <LogTypeIcon kind='dnf' size={13} />
                        {dnfCount} DNF
                    </span>
                )}
                {canReorder && (
                    <span
                        style={{ fontSize: 11, fontWeight: 400, opacity: 0.7 }}
                        title="L'ordre du tableau est l'ordre d'envoi des logs, celui des blocs de texte par cache et celui de la numérotation @cache_count."
                    >
                        Glisser ⠿ (ou trier une colonne) pour changer l'ordre d'envoi
                    </span>
                )}
            </div>
            <div style={{ overflow: 'auto', maxHeight }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                        {table.getHeaderGroups().map(headerGroup => (
                            <tr key={headerGroup.id}>
                                {headerGroup.headers.map(header => (
                                    <th
                                        key={header.id}
                                        onClick={header.column.getToggleSortingHandler()}
                                        style={{
                                            textAlign: 'left',
                                            padding: '6px 8px',
                                            borderTop: '1px solid var(--theia-panel-border)',
                                            borderBottom: '1px solid var(--theia-panel-border)',
                                            background: 'var(--theia-editor-background)',
                                            position: 'sticky',
                                            top: 0,
                                            zIndex: 1,
                                            cursor: header.column.getCanSort() ? 'pointer' : 'default',
                                            whiteSpace: 'nowrap'
                                        }}
                                    >
                                        {flexRender(header.column.columnDef.header, header.getContext())}
                                        {header.column.getIsSorted() === 'asc' && <span style={{ marginLeft: 6 }}>▲</span>}
                                        {header.column.getIsSorted() === 'desc' && <span style={{ marginLeft: 6 }}>▼</span>}
                                    </th>
                                ))}
                            </tr>
                        ))}
                    </thead>
                    <tbody>
                        {displayedRows.map(row => {
                            const gc = row.original;
                            const isDragged = draggedId === gc.id;
                            const indicator = dropIndicator?.id === gc.id ? dropIndicator.position : undefined;
                            const currentLogType = sanitizeLogTypeForGeocache(perCacheLogType[gc.id] ?? logType, gc);
                            // Le DNF choisi passe devant l'info "déjà trouvée" : c'est ce qui va réellement être envoyé.
                            const background = isJustLogged(gc, perCacheSubmitStatus)
                                ? JUST_LOGGED_ROW_BACKGROUND
                                : isPendingDnf(gc, currentLogType, perCacheSubmitStatus)
                                    ? DNF_ROW_BACKGROUND
                                    : isPreviouslyFound(gc, perCacheSubmitStatus)
                                        ? ALREADY_FOUND_ROW_BACKGROUND
                                        : undefined;
                            // "Ne pas loguer" : la ligne reste lisible mais se démarque de celles qui partiront.
                            const isSkipped = currentLogType === 'skip'
                                && !isJustLogged(gc, perCacheSubmitStatus);
                            return (
                                <tr
                                    key={row.id}
                                    ref={el => { rowRefs.current[gc.id] = el; }}
                                    onDragOver={e => {
                                        if (draggedId === null) {
                                            return;
                                        }
                                        e.preventDefault();
                                        if (e.dataTransfer) {
                                            e.dataTransfer.dropEffect = 'move';
                                        }
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        const position = e.clientY - rect.top < rect.height / 2 ? 'before' : 'after';
                                        if (dropIndicator?.id !== gc.id || dropIndicator.position !== position) {
                                            setDropIndicator({ id: gc.id, position });
                                        }
                                    }}
                                    onDrop={e => {
                                        if (draggedId === null) {
                                            return;
                                        }
                                        e.preventDefault();
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        const position = e.clientY - rect.top < rect.height / 2 ? 'before' : 'after';
                                        moveRelativeTo(draggedId, gc.id, position);
                                    }}
                                    style={{ background, opacity: isDragged ? 0.4 : isSkipped ? 0.65 : undefined }}
                                    title={isJustLogged(gc, perCacheSubmitStatus)
                                        ? 'Log envoyé — cette géocache ne peut plus être loguée ici'
                                        : isPreviouslyFound(gc, perCacheSubmitStatus)
                                            ? alreadyFoundTooltip(gc)
                                            : isSkipped
                                                ? 'Ne pas loguer : cette géocache sera ignorée à l\'envoi'
                                                : undefined}
                                >
                                    {row.getVisibleCells().map(cell => (
                                        <td
                                            key={cell.id}
                                            style={{
                                                padding: '6px 8px',
                                                borderBottom: indicator === 'after'
                                                    ? '2px solid var(--theia-focusBorder)'
                                                    : '1px solid var(--theia-panel-border)',
                                                borderTop: indicator === 'before' ? '2px solid var(--theia-focusBorder)' : undefined,
                                                verticalAlign: 'middle'
                                            }}
                                        >
                                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                        </td>
                                    ))}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

/**
 * Le tableau n'a aucune raison d'être redessiné à chaque frappe dans une zone de texte :
 * toutes ses props sont des valeurs simples ou des références stables (les Record sont
 * remplacés, jamais mutés), la comparaison superficielle de `React.memo` suffit donc.
 */
export const GeocacheLogEditorGeocachesTable = React.memo(GeocacheLogEditorGeocachesTableImpl);
