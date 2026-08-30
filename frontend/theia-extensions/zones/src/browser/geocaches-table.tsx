import * as React from 'react';
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    ColumnDef,
    ColumnOrderState,
    flexRender,
    SortingState,
    VisibilityState,
} from '@tanstack/react-table';
import { ContextMenu, ContextMenuItem } from './context-menu';
import { MoveGeocacheDialog } from './move-geocache-dialog';
import { GeocacheIcon } from './geocache-icon';
import { GeocacheFilterBar } from './geocache-filter-bar';
import {
    AdvancedFilterClause,
    TokenFilter,
    STANDARD_GEOCACHE_FIELD_DEFINITIONS,
    parseSearchQuery,
    matchesSearchPattern,
    normalizeSearchText,
} from './geocache-filter-shared';

import '../../src/browser/style/geocaches-table.css';

export interface GeocacheWaypoint {
    id: number;
    prefix: string | null;
    lookup: string | null;
    name: string | null;
    type: string | null;
    latitude: number | null;
    longitude: number | null;
    gc_coords: string | null;
    note: string | null;
}

export interface Geocache {
    id: number;
    gc_code: string;
    name: string;
    owner: string | null;
    cache_type: string;
    difficulty: number;
    terrain: number;
    size: string;
    solved: string;
    found: boolean;
    favorites_count: number;
    hidden_date: string | null;
    placed_at?: string | null;
    created_at?: string | null;
    found_date?: string | null;
    has_notes?: boolean;
    notes_count?: number;
    logs_count?: number;
    latitude?: number;
    longitude?: number;
    is_corrected?: boolean;
    original_latitude?: number;
    original_longitude?: number;
    original_coordinates_raw?: string;
    coordinates_raw?: string;
    description?: string;
    hint?: string;
    waypoints?: GeocacheWaypoint[];
    status?: string;
    attributes?: Array<{ name: string; is_negative: boolean; base_filename?: string }>;
}


interface GeocachesTableProps {
    data: Geocache[];
    onRowClick?: (geocache: Geocache) => void;
    onDeleteSelected?: (ids: number[]) => void;
    onRefreshSelected?: (ids: number[]) => void;
    onLogSelected?: (ids: number[]) => void;
    onCopySelected?: (ids: number[]) => void;
    onMoveSelected?: (ids: number[]) => void;
    onApplyPluginSelected?: (ids: number[]) => void;
    onExportGpxSelected?: (ids: number[]) => void;
    onDelete?: (geocache: Geocache) => void;
    onRefresh?: (id: number) => void;
    onMove?: (geocache: Geocache, targetZoneId: number) => void;
    onCopy?: (geocache: Geocache, targetZoneId: number) => void;
    onImportAround?: (geocache: Geocache) => void;
    zones?: Array<{ id: number; name: string }>;
    currentZoneId?: number;
    visibleColumnIds?: GeocachesTableColumnId[];
    onVisibleColumnIdsChange?: (columnIds: GeocachesTableColumnId[]) => void;
    onFilteredDataChange?: (geocaches: Geocache[]) => void;
    /** Identifiants des géocaches cochées (pour les mettre en évidence sur la carte). */
    onSelectionChange?: (geocacheIds: number[]) => void;
    /** « Qui a trouvé quoi » : code GC -> pseudos d'amis (colonne `friends_found`). */
    friendFinds?: Record<string, string[]>;
}

export type GeocachesTableColumnId =
    | 'gc_code'
    | 'name'
    | 'cache_type'
    | 'difficulty'
    | 'terrain'
    | 'size'
    | 'solved'
    | 'found'
    | 'placed_at'
    | 'has_notes'
    | 'created_at'
    | 'found_date'
    | 'coordinates'
    | 'is_corrected'
    | 'waypoints_count'
    | 'favorites_count'
    | 'owner'
    | 'logs_count'
    | 'friends_found'
    | 'status'
    | 'need_maintenance';

interface GeocachesTableColumnDefinition {
    id: GeocachesTableColumnId;
    label: string;
    description: string;
}

export const DEFAULT_GEOCACHES_TABLE_VISIBLE_COLUMNS: GeocachesTableColumnId[] = [
    'gc_code',
    'name',
    'cache_type',
    'difficulty',
    'terrain',
    'size',
    'solved',
    'found',
    'favorites_count',
    'owner',
];

const GEOCACHES_TABLE_COLUMN_DEFINITIONS: GeocachesTableColumnDefinition[] = [
    { id: 'gc_code', label: 'Code GC', description: 'Identifiant public de la cache.' },
    { id: 'name', label: 'Nom', description: 'Nom de la cache.' },
    { id: 'cache_type', label: 'Type', description: 'Type de cache avec icône.' },
    { id: 'difficulty', label: 'D', description: 'Difficulté.' },
    { id: 'terrain', label: 'T', description: 'Terrain.' },
    { id: 'size', label: 'Taille', description: 'Taille du contenant.' },
    { id: 'solved', label: 'Résolution', description: 'État de résolution pour Mystery, Unknown et Letterbox.' },
    { id: 'found', label: 'Trouvée', description: 'Indique si la cache a été trouvée.' },
    { id: 'placed_at', label: 'Posée le', description: 'Date de pose de la cache.' },
    { id: 'has_notes', label: 'Notes', description: 'Présence de notes locales ou personnelles.' },
    { id: 'created_at', label: 'Ajoutée le', description: "Date d'ajout dans GeoApp." },
    { id: 'found_date', label: 'Découverte le', description: 'Date de découverte connue.' },
    { id: 'coordinates', label: 'Coordonnées', description: 'Coordonnées affichées ou décimales.' },
    { id: 'is_corrected', label: 'Corrigée', description: 'Indique si les coordonnées sont corrigées.' },
    { id: 'waypoints_count', label: 'Waypoints', description: 'Nombre de waypoints associes.' },
    { id: 'favorites_count', label: 'Favoris', description: 'Nombre de points favoris.' },
    { id: 'owner', label: 'Propriétaire', description: 'Propriétaire de la cache.' },
    { id: 'logs_count', label: 'Logs', description: 'Nombre de logs connus.' },
    { id: 'friends_found', label: 'Amis', description: "Nombre d'amis Geocaching.com ayant trouvé la cache." },
    { id: 'status', label: 'Statut', description: 'Statut de la cache sur Geocaching.com (active, désactivée, archivée).' },
    { id: 'need_maintenance', label: 'Maintenance', description: 'Indique si le propriétaire a demandé une attention particulière (Need Maintenance).' },
];

const ALL_GEOCACHES_TABLE_COLUMN_IDS = GEOCACHES_TABLE_COLUMN_DEFINITIONS.map(def => def.id);
const GEOCACHES_TABLE_COLUMN_DEFINITION_BY_ID = new Map<GeocachesTableColumnId, GeocachesTableColumnDefinition>(
    GEOCACHES_TABLE_COLUMN_DEFINITIONS.map(def => [def.id, def])
);

export function normalizeGeocachesTableVisibleColumnIds(raw: unknown): GeocachesTableColumnId[] {
    if (!Array.isArray(raw)) {
        return [...DEFAULT_GEOCACHES_TABLE_VISIBLE_COLUMNS];
    }
    const valid = new Set<GeocachesTableColumnId>(ALL_GEOCACHES_TABLE_COLUMN_IDS);
    const normalized: GeocachesTableColumnId[] = [];
    for (const value of raw) {
        if (typeof value === 'string' && valid.has(value as GeocachesTableColumnId) && !normalized.includes(value as GeocachesTableColumnId)) {
            normalized.push(value as GeocachesTableColumnId);
        }
    }
    return normalized.length > 0 ? normalized : [...DEFAULT_GEOCACHES_TABLE_VISIBLE_COLUMNS];
}


function matchesClause(geocache: Geocache, clause: TokenFilter): boolean {
    const field: string = clause.field;
    const op = clause.operator;

    const rawValue = (geocache as any)[field] as any;

    if (field === 'found') {
        const actual = Boolean(rawValue);
        if (op !== 'is') {
            return true;
        }
        if (clause.value === 'true') {
            return actual === true;
        }
        if (clause.value === 'false') {
            return actual === false;
        }
        return true;
    }

    if (field === 'difficulty' || field === 'terrain' || field === 'favorites_count') {
        const actual = typeof rawValue === 'number' ? rawValue : parseFloat(String(rawValue ?? ''));
        if (!Number.isFinite(actual)) {
            return false;
        }

        const v1 = clause.value !== undefined ? parseFloat(clause.value) : NaN;
        const v2 = clause.value2 !== undefined ? parseFloat(clause.value2) : NaN;

        if (op === 'between') {
            if (!Number.isFinite(v1) || !Number.isFinite(v2)) {
                return true;
            }
            const min = Math.min(v1, v2);
            const max = Math.max(v1, v2);
            return actual >= min && actual <= max;
        }
        if (!Number.isFinite(v1)) {
            return true;
        }
        if (op === 'eq') {
            return actual === v1;
        }
        if (op === 'neq') {
            return actual !== v1;
        }
        if (op === 'gt') {
            return actual > v1;
        }
        if (op === 'gte') {
            return actual >= v1;
        }
        if (op === 'lt') {
            return actual < v1;
        }
        if (op === 'lte') {
            return actual <= v1;
        }
        return true;
    }

    if (op === 'in' || op === 'not_in') {
        const values = clause.values ?? [];
        if (values.length === 0) {
            return true;
        }
        const ok = values.some(v => matchesSearchPattern(rawValue, v, 'equals'));
        return op === 'in' ? ok : !ok;
    }

    const wanted = (clause.value ?? '').toString();
    if (!normalizeSearchText(wanted) && (op === 'contains' || op === 'not_contains' || op === 'eq' || op === 'neq')) {
        return true;
    }

    if (op === 'contains') {
        return matchesSearchPattern(rawValue, wanted, 'contains');
    }
    if (op === 'not_contains') {
        return !matchesSearchPattern(rawValue, wanted, 'contains');
    }
    if (op === 'eq') {
        return matchesSearchPattern(rawValue, wanted, 'equals');
    }
    if (op === 'neq') {
        return !matchesSearchPattern(rawValue, wanted, 'equals');
    }
    return true;
}


/**
 * Hauteur de ligne estimée (px) utilisée pour la virtualisation.
 * Le contenu des cellules est sur une seule ligne (nowrap/ellipsis), donc une
 * hauteur fixe est fiable. La même constante sert pour les espaceurs et la
 * hauteur imposée aux lignes afin d'éviter toute dérive du scroll.
 */
const VIRTUAL_ROW_HEIGHT = 34;
const VIRTUAL_OVERSCAN = 8;

interface VirtualWindow {
    startIndex: number;
    endIndex: number;
    paddingTop: number;
    paddingBottom: number;
}

/**
 * Virtualisation maison (windowing) : ne rend que les lignes visibles + un
 * overscan, en conservant la hauteur totale via deux lignes espaceurs.
 * Évite d'ajouter une dépendance externe (@tanstack/react-virtual).
 */
function useRowVirtualizer(rowCount: number, scrollRef: React.RefObject<HTMLElement>): VirtualWindow {
    const [scrollTop, setScrollTop] = React.useState(0);
    const [viewportHeight, setViewportHeight] = React.useState(0);

    React.useEffect(() => {
        const el = scrollRef.current;
        if (!el) {
            return;
        }

        let frame = 0;
        const sync = (): void => {
            setScrollTop(el.scrollTop);
            setViewportHeight(el.clientHeight);
        };
        const onScroll = (): void => {
            if (frame) {
                return;
            }
            frame = window.requestAnimationFrame(() => {
                frame = 0;
                sync();
            });
        };

        sync();
        el.addEventListener('scroll', onScroll, { passive: true });
        const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : undefined;
        resizeObserver?.observe(el);

        return () => {
            if (frame) {
                window.cancelAnimationFrame(frame);
            }
            el.removeEventListener('scroll', onScroll);
            resizeObserver?.disconnect();
        };
    }, [scrollRef]);

    const totalHeight = rowCount * VIRTUAL_ROW_HEIGHT;
    const startIndex = Math.max(0, Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN);
    const rowsInViewport = viewportHeight > 0 ? Math.ceil(viewportHeight / VIRTUAL_ROW_HEIGHT) : 0;
    const visibleCount = rowsInViewport + VIRTUAL_OVERSCAN * 2;
    const endIndex = Math.min(rowCount, startIndex + visibleCount);
    const paddingTop = startIndex * VIRTUAL_ROW_HEIGHT;
    const paddingBottom = Math.max(0, totalHeight - endIndex * VIRTUAL_ROW_HEIGHT);

    return { startIndex, endIndex, paddingTop, paddingBottom };
}

/**
 * Case à cocher « tout sélectionner » du header.
 * Composant dédié car l'état `indeterminate` n'est pas exposé en JSX et doit
 * être posé impérativement sur le DOM via une ref + effet — ce qui exige un
 * vrai composant React (les hooks ne peuvent pas vivre dans la fonction
 * `header` d'un ColumnDef sans enfreindre les règles des hooks).
 */
const SelectAllCheckbox: React.FC<{
    checked: boolean;
    indeterminate: boolean;
    onChange: (event: unknown) => void;
}> = ({ checked, indeterminate, onChange }) => {
    const ref = React.useRef<HTMLInputElement>(null);
    React.useEffect(() => {
        if (ref.current) {
            ref.current.indeterminate = indeterminate;
        }
    }, [indeterminate]);
    return (
        <input
            ref={ref}
            type="checkbox"
            checked={checked}
            onChange={onChange}
        />
    );
};

export const GeocachesTable: React.FC<GeocachesTableProps> = ({
    data,
    onRowClick,
    onDeleteSelected,
    onRefreshSelected,
    onLogSelected,
    onCopySelected,
    onMoveSelected,
    onApplyPluginSelected,
    onExportGpxSelected,
    onDelete,
    onRefresh,
    onMove,
    onCopy,
    onImportAround,
    zones = [],
    currentZoneId,
    visibleColumnIds,
    onVisibleColumnIdsChange,
    onFilteredDataChange,
    onSelectionChange,
    friendFinds
}) => {
    const [sorting, setSorting] = React.useState<SortingState>([]);
    const [rowSelection, setRowSelection] = React.useState({});
    const [globalFilter, setGlobalFilter] = React.useState('');
    const [contextMenu, setContextMenu] = React.useState<{ items: ContextMenuItem[]; x: number; y: number } | null>(null);
    const [moveDialog, setMoveDialog] = React.useState<Geocache | null>(null);
    const [copyDialog, setCopyDialog] = React.useState<Geocache | null>(null);
    const [columnsMenuOpen, setColumnsMenuOpen] = React.useState(false);
    const [draggedColumnId, setDraggedColumnId] = React.useState<GeocachesTableColumnId | null>(null);
    const [columnDragTarget, setColumnDragTarget] = React.useState<{ id: GeocachesTableColumnId; position: 'before' | 'after' } | null>(null);
    const [internalVisibleColumnIds, setInternalVisibleColumnIds] = React.useState<GeocachesTableColumnId[]>(() => [...DEFAULT_GEOCACHES_TABLE_VISIBLE_COLUMNS]);
    const [advancedClauses, setAdvancedClauses] = React.useState<AdvancedFilterClause[]>([]);
    const activeVisibleColumnIds = React.useMemo(
        () => normalizeGeocachesTableVisibleColumnIds(visibleColumnIds ?? internalVisibleColumnIds),
        [visibleColumnIds, internalVisibleColumnIds]
    );
    const visibleColumnSet = React.useMemo(() => new Set<GeocachesTableColumnId>(activeVisibleColumnIds), [activeVisibleColumnIds]);
    const updateVisibleColumnIds = React.useCallback(
        (next: GeocachesTableColumnId[]) => {
            const normalized = normalizeGeocachesTableVisibleColumnIds(next);
            if (!visibleColumnIds) {
                setInternalVisibleColumnIds(normalized);
            }
            onVisibleColumnIdsChange?.(normalized);
        },
        [visibleColumnIds, onVisibleColumnIdsChange]
    );
    const columnVisibility = React.useMemo<VisibilityState>(() => {
        const visibility: VisibilityState = {
            select: true,
            actions: true,
        };
        for (const columnId of ALL_GEOCACHES_TABLE_COLUMN_IDS) {
            visibility[columnId] = visibleColumnSet.has(columnId);
        }
        return visibility;
    }, [visibleColumnSet]);
    const columnOrder = React.useMemo<ColumnOrderState>(() => [
        'select',
        ...activeVisibleColumnIds,
        ...ALL_GEOCACHES_TABLE_COLUMN_IDS.filter(columnId => !visibleColumnSet.has(columnId)),
        'actions',
    ], [activeVisibleColumnIds, visibleColumnSet]);
    const visibleColumnDefinitions = React.useMemo(
        () => activeVisibleColumnIds
            .map(columnId => GEOCACHES_TABLE_COLUMN_DEFINITION_BY_ID.get(columnId))
            .filter((def): def is GeocachesTableColumnDefinition => Boolean(def)),
        [activeVisibleColumnIds]
    );
    const hiddenColumnDefinitions = React.useMemo(
        () => GEOCACHES_TABLE_COLUMN_DEFINITIONS.filter(def => !visibleColumnSet.has(def.id)),
        [visibleColumnSet]
    );

    const columns = React.useMemo<ColumnDef<Geocache>[]>(
        () => [
            {
                id: 'select',
                header: ({ table }) => (
                    <SelectAllCheckbox
                        checked={table.getIsAllRowsSelected()}
                        indeterminate={table.getIsSomeRowsSelected() && !table.getIsAllRowsSelected()}
                        onChange={table.getToggleAllRowsSelectedHandler()}
                    />
                ),
                cell: ({ row }) => (
                    <input
                        type="checkbox"
                        checked={row.getIsSelected()}
                        disabled={!row.getCanSelect()}
                        onChange={row.getToggleSelectedHandler()}
                        onClick={(e) => e.stopPropagation()}
                    />
                ),
                size: 40,
            },
            {
                accessorKey: 'gc_code',
                header: 'Code GC',
                cell: info => <strong>{info.getValue() as string}</strong>,
                size: 100,
            },
            {
                accessorKey: 'name',
                header: 'Nom',
                cell: info => (
                    <div className="geoapp-gc-cell-name">
                        {info.getValue() as string}
                    </div>
                ),
                size: 300,
            },
            {
                accessorKey: 'cache_type',
                header: 'Type',
                cell: info => {
                    const type = info.getValue() as string;
                    const status = (info.row.original as Geocache).status;
                    const isArchived = status === 'archived';
                    const isDisabled = status === 'disabled';
                    const statusLabel = isArchived ? ' \u2014 ⛔ Archivée' : isDisabled ? ' \u2014 ⚠️ Désactivée' : '';
                    return (
                        <span className="geoapp-gc-type-wrap">
                            <GeocacheIcon
                                type={type}
                                size={20}
                                showLabel={false}
                                title={type + statusLabel}
                                style={(isArchived || isDisabled) ? { filter: 'grayscale(100%) opacity(0.55)' } : undefined}
                            />
                            {isArchived && (
                                <span className="geoapp-gc-archived-strike" />
                            )}
                        </span>
                    );
                },
                size: 50,
            },
            {
                accessorKey: 'difficulty',
                header: 'D',
                cell: info => <span title="Difficulté">{info.getValue() as number}</span>,
                size: 60,
            },
            {
                accessorKey: 'terrain',
                header: 'T',
                cell: info => <span title="Terrain">{info.getValue() as number}</span>,
                size: 60,
            },
            {
                accessorKey: 'size',
                header: 'Taille',
                cell: info => {
                    const size = info.getValue() as string;
                    return (
                        <span className="geoapp-gc-cell-muted-sm" title={size}>
                            {size}
                        </span>
                    );
                },
                size: 100,
            },
            {
                accessorKey: 'solved',
                header: 'Résolution',
                cell: info => {
                    const solved = info.getValue() as string;
                    return getResolutionBadge(solved, (info.row.original as Geocache).cache_type);
                },
                size: 110,
            },
            {
                accessorKey: 'found',
                header: 'Trouvée',
                cell: info => getFoundBadge(Boolean(info.getValue())),
                size: 90,
            },
            {
                id: 'placed_at',
                accessorFn: row => getDateTimestamp(row.placed_at ?? row.hidden_date),
                header: 'Posée le',
                cell: ({ row }) => <span className="geoapp-gc-cell-muted-sm">{formatDate(row.original.placed_at ?? row.original.hidden_date)}</span>,
                size: 100,
            },
            {
                id: 'has_notes',
                accessorFn: row => row.has_notes ? 1 : 0,
                header: 'Notes',
                cell: ({ row }) => getNotesBadge(Boolean(row.original.has_notes), row.original.notes_count),
                size: 90,
            },
            {
                id: 'created_at',
                accessorFn: row => getDateTimestamp(row.created_at),
                header: 'Ajoutée le',
                cell: ({ row }) => <span className="geoapp-gc-cell-muted-sm">{formatDate(row.original.created_at)}</span>,
                size: 100,
            },
            {
                id: 'found_date',
                accessorFn: row => getDateTimestamp(row.found_date),
                header: 'Découverte le',
                cell: ({ row }) => <span className="geoapp-gc-cell-muted-sm">{formatDate(row.original.found_date)}</span>,
                size: 120,
            },
            {
                id: 'coordinates',
                accessorFn: row => getCoordinatesLabel(row),
                header: 'Coordonnées',
                cell: ({ row }) => (
                    <span className="geoapp-gc-cell-coords" title={getCoordinatesLabel(row.original)}>
                        {getCoordinatesLabel(row.original)}
                    </span>
                ),
                size: 150,
            },
            {
                id: 'is_corrected',
                accessorFn: row => row.is_corrected ? 1 : 0,
                header: 'Corrigée',
                cell: ({ row }) => getBooleanBadge(Boolean(row.original.is_corrected), 'Oui', 'Non'),
                size: 90,
            },
            {
                id: 'waypoints_count',
                accessorFn: row => row.waypoints?.length ?? 0,
                header: 'Waypoints',
                cell: info => <span>{info.getValue() as number}</span>,
                size: 90,
            },
            {
                accessorKey: 'favorites_count',
                header: '❤️',
                cell: info => <span title="Favoris">{info.getValue() as number}</span>,
                size: 50,
            },
            {
                accessorKey: 'owner',
                header: 'Propriétaire',
                cell: info => <span className="geoapp-gc-cell-owner">{info.getValue() as string || '-'}</span>,
                size: 150,
            },
            {
                accessorKey: 'logs_count',
                header: 'Logs',
                cell: info => <span>{(info.getValue() as number | undefined) ?? 0}</span>,
                size: 70,
            },
            {
                id: 'friends_found',
                accessorFn: row => (friendFinds?.[(row as Geocache).gc_code] ?? []).length,
                header: '👥',
                cell: ({ row }) => {
                    const names = friendFinds?.[(row.original as Geocache).gc_code] ?? [];
                    if (names.length === 0) {
                        return <span style={{ opacity: 0.35 }}>—</span>;
                    }
                    return (
                        <span
                            title={`Trouvée par : ${names.join(', ')}`}
                            style={{ cursor: 'help' }}
                        >
                            {names.length}
                        </span>
                    );
                },
                size: 60,
            },
            {
                id: 'status',
                accessorFn: row => (row as Geocache).status ?? 'active',
                header: 'Statut',
                cell: ({ row }) => {
                    const status = (row.original as Geocache).status ?? 'active';
                    if (status === 'archived') {
                        return <span className="geoapp-gc-badge--archived">⛔ Archivée</span>;
                    }
                    if (status === 'disabled') {
                        return <span className="geoapp-gc-badge--disabled">⚠️ Désactivée</span>;
                    }
                    return <span className="geoapp-gc-status-active">Active</span>;
                },
                size: 110,
            },
            {
                id: 'need_maintenance',
                accessorFn: row => {
                    const attrs = (row as Geocache).attributes ?? [];
                    return attrs.some(a => !a.is_negative && a.name.toLowerCase().includes('owner attention')) ? 1 : 0;
                },
                header: 'Maint.',
                cell: ({ row }) => {
                    const attrs = (row.original as Geocache).attributes ?? [];
                    const needsMaint = attrs.some(a => !a.is_negative && a.name.toLowerCase().includes('owner attention'));
                    if (!needsMaint) return null;
                    return (
                        <span className="geoapp-gc-badge--maint" title='Owner attention requested'>
                            🔧 Maint.
                        </span>
                    );
                },
                size: 90,
            },
            {
                id: 'actions',
                header: 'Actions',
                cell: ({ row }) => (
                    <div style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                        {onRefresh && (
                            <button
                                onClick={() => onRefresh(row.original.id)}
                                className="theia-button secondary"
                                title="Rafraîchir cette géocache"
                                aria-label="Rafraîchir cette géocache"
                                style={{ padding: '2px 6px', fontSize: '0.85em' }}
                            >
                                <span aria-hidden="true">🔄</span>
                            </button>
                        )}
                        {onDelete && (
                            <button
                                onClick={() => onDelete(row.original)}
                                className="theia-button secondary"
                                title="Supprimer cette géocache"
                                aria-label="Supprimer cette géocache"
                                style={{ padding: '2px 6px', fontSize: '0.85em', color: 'var(--theia-errorForeground)' }}
                            >
                                <span aria-hidden="true">🗑️</span>
                            </button>
                        )}
                    </div>
                ),
                size: 100,
            },
        ],
        // `friendFinds` est capturé par la colonne « Amis » : sans cette
        // dépendance, la colonne resterait figée sur la valeur initiale.
        [friendFinds]
    );

    const cacheTypes = React.useMemo(() => {
        const set = new Set<string>();
        for (const g of data) {
            if (g.cache_type) {
                set.add(g.cache_type);
            }
        }
        return Array.from(set).sort((a, b) => a.localeCompare(b));
    }, [data]);

    const sizes = React.useMemo(() => {
        const set = new Set<string>();
        for (const g of data) {
            if (g.size) {
                set.add(g.size);
            }
        }
        return Array.from(set).sort((a, b) => a.localeCompare(b));
    }, [data]);

    const solvedOptions = React.useMemo(() => ['not_solved', 'in_progress', 'solved'], []);

    const enumOptionsByField = React.useMemo(() => {
        const map = new Map<string, string[]>();
        map.set('cache_type', cacheTypes);
        map.set('size', sizes);
        map.set('solved', solvedOptions);
        map.set('found', ['true', 'false']);
        return map;
    }, [cacheTypes, sizes, solvedOptions]);

    const filteredData = React.useMemo(() => {
        const { freeText, tokenFilters } = parseSearchQuery(globalFilter);
        const searchPattern = freeText.trim();
        const hasFreeText = normalizeSearchText(searchPattern).length > 0;

        const clauses: TokenFilter[] = [];
        for (const c of advancedClauses) {
            clauses.push({
                field: c.field,
                operator: c.operator,
                value: c.value,
                value2: c.value2,
                values: c.values
            });
        }
        for (const t of tokenFilters) {
            clauses.push(t);
        }

        return data.filter(geocache => {
            if (hasFreeText) {
                // Chaque champ est testé séparément pour qu'un joker `*` ne
                // puisse pas déborder d'un champ sur le suivant.
                const fields = [
                    geocache.gc_code,
                    geocache.name,
                    geocache.cache_type,
                    geocache.owner ?? ''
                ];
                if (!fields.some(value => matchesSearchPattern(value, searchPattern, 'contains'))) {
                    return false;
                }
            }
            for (const clause of clauses) {
                if (!matchesClause(geocache, clause)) {
                    return false;
                }
            }
            return true;
        });
    }, [data, globalFilter, advancedClauses]);

    React.useEffect(() => {
        onFilteredDataChange?.(filteredData);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filteredData]);

    const table = useReactTable({
        data: filteredData,
        columns,
        state: {
            sorting,
            rowSelection,
            columnVisibility,
            columnOrder,
        },
        onSortingChange: setSorting,
        onRowSelectionChange: setRowSelection,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        enableRowSelection: true,
        // Indexer la sélection sur l'id stable de la géocache (et non l'index de
        // ligne par défaut) : sans ça, trier ou filtrer décale la sélection vers
        // de mauvaises caches, et la sélection est perdue à chaque rechargement.
        getRowId: row => String(row.id),
    });

    const selectedRows = table.getSelectedRowModel().rows;
    const selectedIds = selectedRows.map(row => row.original.id);

    // Remonte la sélection (carte associée). `filteredData` fait partie des
    // dépendances : une ligne cochée puis filtrée sort de la sélection visible.
    React.useEffect(() => {
        onSelectionChange?.(selectedIds);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rowSelection, filteredData]);

    const tableScrollRef = React.useRef<HTMLDivElement>(null);

    // Debounce single/double-click pour éviter le décalage de layout entre les
    // deux clicks d'un double-clic (l'action panel s'ouvre sur le single click
    // et décale le tableau, faisant atterrir le 2e click sur une autre ligne).
    const pendingClickRef = React.useRef<{ timer: ReturnType<typeof setTimeout>; rowId: string } | null>(null);
    const tableRef = React.useRef(table);
    tableRef.current = table;
    React.useEffect(() => () => {
        if (pendingClickRef.current) {
            clearTimeout(pendingClickRef.current.timer);
        }
    }, []);

    const tableRows = table.getRowModel().rows;
    const { startIndex, endIndex, paddingTop, paddingBottom } = useRowVirtualizer(tableRows.length, tableScrollRef);
    const virtualRows = tableRows.slice(startIndex, endIndex);
    const visibleColumnCount = table.getVisibleLeafColumns().length;

    const showContextMenu = (geocache: Geocache, event: React.MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();

        const items: ContextMenuItem[] = [
            {
                label: 'Ouvrir',
                icon: '📖',
                action: () => onRowClick?.(geocache)
            },
            {
                label: 'Rafraîchir',
                icon: '🔄',
                action: () => onRefresh?.(geocache.id)
            }
        ];

        // Ajouter l'option de déplacement si disponible
        if (onMove && zones.length > 1 && currentZoneId) {
            items.push({
                label: 'Déplacer vers...',
                icon: '📦',
                action: () => setMoveDialog(geocache)
            });
        }

        // Ajouter l'option de copie si disponible
        if (onCopy && zones.length > 1 && currentZoneId) {
            items.push({
                label: 'Copier vers...',
                icon: '📋',
                action: () => setCopyDialog(geocache)
            });
        }

        if (onImportAround) {
            items.push({
                label: 'Importer autour…',
                icon: '📍',
                action: () => onImportAround(geocache)
            });
        }

        items.push({ separator: true });
        items.push({
            label: 'Supprimer',
            icon: '🗑️',
            danger: true,
            action: () => onDelete?.(geocache)
        });

        setContextMenu({
            items,
            x: event.clientX,
            y: event.clientY
        });
    };


    const toggleColumn = React.useCallback(
        (columnId: GeocachesTableColumnId, checked: boolean) => {
            if (checked) {
                updateVisibleColumnIds([...activeVisibleColumnIds, columnId]);
                return;
            }
            if (activeVisibleColumnIds.length <= 1) {
                return;
            }
            updateVisibleColumnIds(activeVisibleColumnIds.filter(id => id !== columnId));
        },
        [activeVisibleColumnIds, updateVisibleColumnIds]
    );

    const moveColumn = React.useCallback(
        (columnId: GeocachesTableColumnId, direction: -1 | 1) => {
            const index = activeVisibleColumnIds.indexOf(columnId);
            const nextIndex = index + direction;
            if (index < 0 || nextIndex < 0 || nextIndex >= activeVisibleColumnIds.length) {
                return;
            }
            const next = [...activeVisibleColumnIds];
            const [moved] = next.splice(index, 1);
            next.splice(nextIndex, 0, moved);
            updateVisibleColumnIds(next);
        },
        [activeVisibleColumnIds, updateVisibleColumnIds]
    );

    const dropColumn = React.useCallback(
        (draggedId: GeocachesTableColumnId, targetId: GeocachesTableColumnId, position: 'before' | 'after') => {
            if (draggedId === targetId) {
                return;
            }
            if (!activeVisibleColumnIds.includes(draggedId) || !activeVisibleColumnIds.includes(targetId)) {
                return;
            }
            const next = activeVisibleColumnIds.filter(id => id !== draggedId);
            const targetIndex = next.indexOf(targetId);
            if (targetIndex < 0) {
                return;
            }
            next.splice(position === 'after' ? targetIndex + 1 : targetIndex, 0, draggedId);
            updateVisibleColumnIds(next);
        },
        [activeVisibleColumnIds, updateVisibleColumnIds]
    );

    const handleColumnDragStart = React.useCallback((event: React.DragEvent<HTMLElement>, columnId: GeocachesTableColumnId) => {
        setDraggedColumnId(columnId);
        setColumnDragTarget(null);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', columnId);
    }, []);

    const handleColumnDragOver = React.useCallback((event: React.DragEvent<HTMLElement>, columnId: GeocachesTableColumnId) => {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        const rect = event.currentTarget.getBoundingClientRect();
        const position = event.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
        setColumnDragTarget({ id: columnId, position });
    }, []);

    const clearColumnDragState = React.useCallback(() => {
        setDraggedColumnId(null);
        setColumnDragTarget(null);
    }, []);

    const handleColumnDrop = React.useCallback((event: React.DragEvent<HTMLElement>, targetId: GeocachesTableColumnId) => {
        event.preventDefault();
        event.stopPropagation();
        const rawColumnId = draggedColumnId ?? event.dataTransfer.getData('text/plain');
        if (rawColumnId && ALL_GEOCACHES_TABLE_COLUMN_IDS.includes(rawColumnId as GeocachesTableColumnId)) {
            dropColumn(rawColumnId as GeocachesTableColumnId, targetId, columnDragTarget?.position ?? 'before');
        }
        clearColumnDragState();
    }, [draggedColumnId, columnDragTarget, dropColumn, clearColumnDragState]);

    const handleVisibleColumnsDragOver = React.useCallback((event: React.DragEvent<HTMLElement>) => {
        if (!draggedColumnId) {
            return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }, [draggedColumnId]);

    const handleVisibleColumnsDrop = React.useCallback((event: React.DragEvent<HTMLElement>) => {
        if (!draggedColumnId || activeVisibleColumnIds.length === 0) {
            clearColumnDragState();
            return;
        }
        event.preventDefault();
        const lastColumnId = activeVisibleColumnIds[activeVisibleColumnIds.length - 1];
        dropColumn(draggedColumnId, lastColumnId, 'after');
        clearColumnDragState();
    }, [draggedColumnId, activeVisibleColumnIds, dropColumn, clearColumnDragState]);

    const showAllColumns = React.useCallback(() => {
        updateVisibleColumnIds([...ALL_GEOCACHES_TABLE_COLUMN_IDS]);
    }, [updateVisibleColumnIds]);

    const restoreDefaultColumns = React.useCallback(() => {
        updateVisibleColumnIds([...DEFAULT_GEOCACHES_TABLE_VISIBLE_COLUMNS]);
    }, [updateVisibleColumnIds]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
            {/* Toolbar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 0' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <GeocacheFilterBar
                        searchQuery={globalFilter}
                        advancedClauses={advancedClauses}
                        onSearchQueryChange={setGlobalFilter}
                        onAdvancedClausesChange={setAdvancedClauses}
                        fieldDefinitions={STANDARD_GEOCACHE_FIELD_DEFINITIONS}
                        enumOptionsByField={enumOptionsByField}
                        resultCount={filteredData.length}
                    />
                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={() => setColumnsMenuOpen(open => !open)}
                            className="theia-button secondary"
                            title="Choisir les colonnes affichées"
                        >
                            Colonnes ({activeVisibleColumnIds.length})
                        </button>
                        {columnsMenuOpen && (
                            <div
                                style={{
                                    position: 'absolute',
                                    top: '100%',
                                    left: 0,
                                    marginTop: 4,
                                    width: 320,
                                    maxHeight: 420,
                                    overflowY: 'auto',
                                    border: '1px solid var(--theia-panel-border)',
                                    background: 'var(--theia-editor-background)',
                                    borderRadius: 3,
                                    zIndex: 12,
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
                                    padding: 8
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                                    <div style={{ fontWeight: 600 }}>Colonnes</div>
                                    <button
                                        onClick={() => setColumnsMenuOpen(false)}
                                        className="theia-button secondary"
                                        style={{ padding: '2px 6px' }}
                                        title="Fermer"
                                    >
                                        x
                                    </button>
                                </div>
                                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                                    <button onClick={showAllColumns} className="theia-button secondary">
                                        Tout afficher
                                    </button>
                                    <button onClick={restoreDefaultColumns} className="theia-button secondary">
                                        Paramètres d'origine
                                    </button>
                                </div>
                                <div style={{ opacity: 0.7, fontSize: '0.85em', marginBottom: 6 }}>Colonnes visibles</div>
                                <div
                                    style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                                    onDragOver={handleVisibleColumnsDragOver}
                                    onDrop={handleVisibleColumnsDrop}
                                >
                                    {visibleColumnDefinitions.map((def, index) => {
                                        const isDragged = draggedColumnId === def.id;
                                        const isDropBefore = columnDragTarget?.id === def.id && columnDragTarget.position === 'before' && draggedColumnId !== def.id;
                                        const isDropAfter = columnDragTarget?.id === def.id && columnDragTarget.position === 'after' && draggedColumnId !== def.id;
                                        return (
                                        <div
                                            key={def.id}
                                            draggable
                                            onDragStart={e => handleColumnDragStart(e, def.id)}
                                            onDragEnter={e => handleColumnDragOver(e, def.id)}
                                            onDragOver={e => handleColumnDragOver(e, def.id)}
                                            onDrop={e => handleColumnDrop(e, def.id)}
                                            onDragEnd={clearColumnDragState}
                                            style={{
                                                display: 'grid',
                                                gridTemplateColumns: '18px 18px 1fr auto auto',
                                                gap: 8,
                                                alignItems: 'center',
                                                padding: '4px 2px',
                                                cursor: 'grab',
                                                opacity: isDragged ? 0.45 : 1,
                                                borderTop: isDropBefore ? '2px solid var(--theia-focusBorder)' : '2px solid transparent',
                                                borderBottom: isDropAfter ? '2px solid var(--theia-focusBorder)' : '2px solid transparent',
                                                borderRadius: 3,
                                            }}
                                            title={def.description}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={visibleColumnSet.has(def.id)}
                                                disabled={visibleColumnSet.has(def.id) && activeVisibleColumnIds.length <= 1}
                                                onChange={e => toggleColumn(def.id, e.target.checked)}
                                            />
                                            <span
                                                aria-hidden="true"
                                                style={{ opacity: 0.65, cursor: 'grab', userSelect: 'none', lineHeight: 1 }}
                                                title="Glisser pour déplacer"
                                            >
                                                ⋮⋮
                                            </span>
                                            <span>
                                                <span style={{ display: 'block' }}>{def.label}</span>
                                                <span style={{ display: 'block', opacity: 0.65, fontSize: '0.85em' }}>{def.description}</span>
                                            </span>
                                            <button
                                                type="button"
                                                className="theia-button secondary"
                                                disabled={index === 0}
                                                onClick={e => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    moveColumn(def.id, -1);
                                                }}
                                                style={{ padding: '2px 6px', minWidth: 28 }}
                                                title="Monter cette colonne"
                                            >
                                                ↑
                                            </button>
                                            <button
                                                type="button"
                                                className="theia-button secondary"
                                                disabled={index === visibleColumnDefinitions.length - 1}
                                                onClick={e => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    moveColumn(def.id, 1);
                                                }}
                                                style={{ padding: '2px 6px', minWidth: 28 }}
                                                title="Descendre cette colonne"
                                            >
                                                ↓
                                            </button>
                                        </div>
                                        );
                                    })}
                                </div>
                                {hiddenColumnDefinitions.length > 0 && (
                                    <>
                                        <div style={{ opacity: 0.7, fontSize: '0.85em', margin: '10px 0 6px' }}>Colonnes masquées</div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                            {hiddenColumnDefinitions.map(def => (
                                                <label
                                                    key={def.id}
                                                    style={{
                                                        display: 'grid',
                                                        gridTemplateColumns: '18px 1fr',
                                                        gap: 8,
                                                        alignItems: 'start',
                                                        padding: '4px 2px',
                                                        cursor: 'pointer'
                                                    }}
                                                    title={def.description}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={false}
                                                        onChange={e => toggleColumn(def.id, e.target.checked)}
                                                    />
                                                    <span>
                                                        <span style={{ display: 'block' }}>{def.label}</span>
                                                        <span style={{ display: 'block', opacity: 0.65, fontSize: '0.85em' }}>{def.description}</span>
                                                    </span>
                                                </label>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Barre d'actions de sélection — hauteur réservée pour éviter tout
                décalage du tableau à l'apparition/disparition des boutons. */}
            <div className="geoapp-gc-actionbar">
                {selectedIds.length > 0 ? (
                    <>
                        <span className="geoapp-gc-actionbar__count">
                            {selectedIds.length} sélectionnée{selectedIds.length > 1 ? 's' : ''}
                        </span>
                        <div className="geoapp-gc-actionbar__group">
                            {onLogSelected && (
                                <button
                                    onClick={() => onLogSelected(selectedIds)}
                                    className="geoapp-gc-action-btn geoapp-gc-action-btn--primary"
                                    title="Loguer les géocaches sélectionnées"
                                >
                                    <span className="geoapp-gc-action-btn__icon" aria-hidden="true">✍️</span>
                                    Loguer
                                </button>
                            )}
                            {onApplyPluginSelected && (
                                <button
                                    onClick={() => onApplyPluginSelected(selectedIds)}
                                    className="geoapp-gc-action-btn geoapp-gc-action-btn--primary"
                                    title="Appliquer un plugin aux géocaches sélectionnées"
                                >
                                    <span className="geoapp-gc-action-btn__icon" aria-hidden="true">🔧</span>
                                    Plugin
                                </button>
                            )}
                            {onExportGpxSelected && (
                                <button
                                    onClick={() => onExportGpxSelected(selectedIds)}
                                    className="geoapp-gc-action-btn"
                                    title="Exporter les géocaches sélectionnées au format GPX"
                                >
                                    <span className="geoapp-gc-action-btn__icon" aria-hidden="true">⬇️</span>
                                    Exporter GPX
                                </button>
                            )}
                            {onRefreshSelected && (
                                <button
                                    onClick={() => onRefreshSelected(selectedIds)}
                                    className="geoapp-gc-action-btn"
                                    title="Rafraîchir les géocaches sélectionnées"
                                >
                                    <span className="geoapp-gc-action-btn__icon" aria-hidden="true">🔄</span>
                                    Rafraîchir
                                </button>
                            )}
                            {onCopySelected && zones.length > 1 && (
                                <button
                                    onClick={() => onCopySelected(selectedIds)}
                                    className="geoapp-gc-action-btn"
                                    title="Copier les géocaches sélectionnées vers une autre zone"
                                >
                                    <span className="geoapp-gc-action-btn__icon" aria-hidden="true">📋</span>
                                    Copier
                                </button>
                            )}
                            {onMoveSelected && zones.length > 1 && (
                                <button
                                    onClick={() => onMoveSelected(selectedIds)}
                                    className="geoapp-gc-action-btn"
                                    title="Déplacer les géocaches sélectionnées vers une autre zone"
                                >
                                    <span className="geoapp-gc-action-btn__icon" aria-hidden="true">📦</span>
                                    Déplacer
                                </button>
                            )}
                            {onDeleteSelected && (
                                <button
                                    onClick={() => onDeleteSelected(selectedIds)}
                                    className="geoapp-gc-action-btn geoapp-gc-action-btn--danger"
                                    title="Supprimer les géocaches sélectionnées"
                                >
                                    <span className="geoapp-gc-action-btn__icon" aria-hidden="true">🗑️</span>
                                    Supprimer
                                </button>
                            )}
                        </div>
                    </>
                ) : (
                    <span className="geoapp-gc-actionbar__empty">
                        Sélectionnez des géocaches pour afficher les actions
                    </span>
                )}
            </div>

            {/* Table */}
            <div
                ref={tableScrollRef}
                className="geoapp-gc-table__scroll"
                style={{ ['--geoapp-gc-row-height' as string]: `${VIRTUAL_ROW_HEIGHT}px` } as React.CSSProperties}
            >
                <table className="geoapp-gc-table">
                    <thead>
                        {table.getHeaderGroups().map(headerGroup => (
                            <tr key={headerGroup.id}>
                                {headerGroup.headers.map(header => (
                                    <th
                                        key={header.id}
                                        className={header.column.getCanSort() ? 'geoapp-gc-table__th geoapp-gc-table__th--sortable' : 'geoapp-gc-table__th'}
                                        onClick={header.column.getToggleSortingHandler()}
                                        style={{ width: header.column.getSize() }}
                                    >
                                        <div className="geoapp-gc-table__th-inner">
                                            {flexRender(header.column.columnDef.header, header.getContext())}
                                            {header.column.getIsSorted() === 'asc' && (
                                                <span className="geoapp-gc-table__sort-icon" aria-hidden="true">▲</span>
                                            )}
                                            {header.column.getIsSorted() === 'desc' && (
                                                <span className="geoapp-gc-table__sort-icon" aria-hidden="true">▼</span>
                                            )}
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        ))}
                    </thead>
                    <tbody>
                        {paddingTop > 0 && (
                            <tr key="virtual-padding-top" aria-hidden="true">
                                <td colSpan={visibleColumnCount} style={{ height: paddingTop, padding: 0, border: 'none' }} />
                            </tr>
                        )}
                        {virtualRows.map(row => (
                            <tr
                                key={row.id}
                                onClick={() => {
                                    if (pendingClickRef.current?.rowId === row.id) {
                                        clearTimeout(pendingClickRef.current.timer);
                                        pendingClickRef.current = null;
                                        onRowClick?.(row.original);
                                    } else {
                                        if (pendingClickRef.current) {
                                            clearTimeout(pendingClickRef.current.timer);
                                        }
                                        const rowId = row.id;
                                        pendingClickRef.current = {
                                            rowId,
                                            timer: setTimeout(() => {
                                                tableRef.current.getRow(rowId)?.toggleSelected();
                                                pendingClickRef.current = null;
                                            }, 220),
                                        };
                                    }
                                }}
                                onContextMenu={(e) => showContextMenu(row.original, e)}
                                className={row.getIsSelected() ? 'geoapp-gc-table__row geoapp-gc-table__row--selected' : 'geoapp-gc-table__row'}
                            >
                                {row.getVisibleCells().map(cell => (
                                    <td
                                        key={cell.id}
                                        className={cell.column.id === 'gc_code' && onRowClick
                                            ? 'geoapp-gc-table__cell geoapp-gc-table__cell--link'
                                            : 'geoapp-gc-table__cell'}
                                        onClick={cell.column.id === 'gc_code' && onRowClick
                                            ? (e) => { e.stopPropagation(); onRowClick(row.original); }
                                            : undefined}
                                    >
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </td>
                                ))}
                            </tr>
                        ))}
                        {paddingBottom > 0 && (
                            <tr key="virtual-padding-bottom" aria-hidden="true">
                                <td colSpan={visibleColumnCount} style={{ height: paddingBottom, padding: 0, border: 'none' }} />
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Menu contextuel */}
            {contextMenu && (
                <ContextMenu
                    items={contextMenu.items}
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onClose={() => setContextMenu(null)}
                />
            )}

            {/* Dialog de déplacement */}
            {moveDialog && onMove && currentZoneId && (
                <MoveGeocacheDialog
                    geocacheName={`${moveDialog.gc_code} - ${moveDialog.name}`}
                    currentZoneId={currentZoneId}
                    zones={zones}
                    onMove={(targetZoneId) => {
                        onMove(moveDialog, targetZoneId);
                        setMoveDialog(null);
                    }}
                    onCancel={() => setMoveDialog(null)}
                />
            )}

            {/* Dialog de copie */}
            {copyDialog && onCopy && currentZoneId && (
                <MoveGeocacheDialog
                    geocacheName={`${copyDialog.gc_code} - ${copyDialog.name}`}
                    currentZoneId={currentZoneId}
                    zones={zones}
                    onMove={(targetZoneId) => {
                        onCopy(copyDialog, targetZoneId);
                        setCopyDialog(null);
                    }}
                    onCancel={() => setCopyDialog(null)}
                    title="Copier vers une zone"
                    actionLabel="Copier"
                />
            )}
        </div>
    );
};

// Helper functions
function isResolutionRelevant(cacheType: string | null | undefined): boolean {
    const normalized = (cacheType ?? '').toLowerCase();
    return normalized.includes('mystery') || normalized.includes('unknown') || normalized.includes('letterbox');
}

type BadgeVariant = 'blue' | 'green' | 'orange' | 'gray' | 'purple' | 'neutral';

function getBadge(label: string, title: string, variant: BadgeVariant): React.ReactNode {
    return (
        <span className={`geoapp-gc-badge geoapp-gc-badge--${variant}`} title={title}>
            {label}
        </span>
    );
}

function getBooleanBadge(value: boolean, trueLabel: string, falseLabel: string): React.ReactNode {
    return value
        ? getBadge(trueLabel, trueLabel, 'blue')
        : getBadge(falseLabel, falseLabel, 'neutral');
}

function getResolutionBadge(solved: string, cacheType: string): React.ReactNode {
    if (!isResolutionRelevant(cacheType)) {
        return (
            <span className="geoapp-gc-cell-na" title="Résolution non applicable à ce type de cache">
                -
            </span>
        );
    }
    if (solved === 'solved') {
        return getBadge('Résolue', 'Résolue', 'blue');
    }
    if (solved === 'in_progress') {
        return getBadge('En cours', 'Résolution en cours', 'orange');
    }
    return getBadge('Non résolue', 'Non résolue', 'gray');
}

function getFoundBadge(found: boolean): React.ReactNode {
    if (found) {
        return getBadge('Trouvée', 'Trouvée', 'green');
    }
    return getBadge('Non trouvée', 'Non trouvée', 'neutral');
}

function getNotesBadge(hasNotes: boolean, notesCount?: number): React.ReactNode {
    if (!hasNotes) {
        return getBadge('Non', 'Aucune note', 'neutral');
    }
    const suffix = typeof notesCount === 'number' && notesCount > 0 ? ` (${notesCount})` : '';
    return getBadge(`Oui${suffix}`, 'Notes présentes', 'purple');
}

function getDateTimestamp(value: string | null | undefined): number {
    if (!value) {
        return 0;
    }
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatDate(value: string | null | undefined): string {
    if (!value) {
        return '-';
    }
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) {
        return value;
    }
    return new Date(timestamp).toLocaleDateString('fr-FR');
}

function getCoordinatesLabel(geocache: Geocache): string {
    if (geocache.coordinates_raw) {
        return geocache.coordinates_raw;
    }
    if (typeof geocache.latitude === 'number' && typeof geocache.longitude === 'number') {
        return `${geocache.latitude.toFixed(5)}, ${geocache.longitude.toFixed(5)}`;
    }
    return '-';
}
