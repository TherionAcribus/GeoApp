import * as React from 'react';
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    ColumnDef,
    flexRender,
    SortingState,
} from '@tanstack/react-table';
import { ContextMenu, ContextMenuItem } from './context-menu';
import { MoveGeocacheDialog } from './move-geocache-dialog';
import { GeocacheIcon } from './geocache-icon';

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
}

type FilterField =
    | 'gc_code'
    | 'name'
    | 'owner'
    | 'cache_type'
    | 'difficulty'
    | 'terrain'
    | 'size'
    | 'solved'
    | 'found'
    | 'favorites_count';

type AdvancedOperator =
    | 'contains'
    | 'not_contains'
    | 'eq'
    | 'neq'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'between'
    | 'in'
    | 'not_in'
    | 'is';

interface AdvancedFilterClause {
    id: string;
    field: FilterField;
    operator: AdvancedOperator;
    value: string;
    value2?: string;
    values?: string[];
}

interface TokenFilter {
    field: FilterField;
    operator: AdvancedOperator;
    value?: string;
    value2?: string;
    values?: string[];
}

interface AutocompleteSuggestion {
    id: string;
    label: string;
    insertText: string;
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
}

function findAutocompleteTokenStart(beforeCaret: string): number | null {
    const idx = beforeCaret.lastIndexOf('@');
    if (idx === -1) {
        return null;
    }
    const prev = beforeCaret[idx - 1];
    if (idx > 0 && prev && !/\s/.test(prev)) {
        return null;
    }
    return idx;
}

function normalizeFieldAlias(raw: string): FilterField | null {
    const key = raw.trim().toLowerCase();
    if (!key) {
        return null;
    }
    const map: Record<string, FilterField> = {
        gc: 'gc_code',
        code: 'gc_code',
        gc_code: 'gc_code',
        name: 'name',
        owner: 'owner',
        type: 'cache_type',
        cache_type: 'cache_type',
        difficulty: 'difficulty',
        diff: 'difficulty',
        terrain: 'terrain',
        size: 'size',
        solved: 'solved',
        status: 'solved',
        found: 'found',
        favorites: 'favorites_count',
        fav: 'favorites_count',
        favorites_count: 'favorites_count',
    };
    return map[key] ?? null;
}

function parseSearchQuery(input: string): { freeText: string; tokenFilters: TokenFilter[] } {
    if (!input) {
        return { freeText: '', tokenFilters: [] };
    }
    const tokenFilters: TokenFilter[] = [];
    const tokens: Array<{ raw: string; start: number; end: number }> = [];
    const re = /@([^\s]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(input)) !== null) {
        tokens.push({ raw: m[0], start: m.index, end: m.index + m[0].length });
    }

    for (const t of tokens) {
        const token = t.raw.slice(1);
        const colon = token.indexOf(':');
        if (colon === -1) {
            continue;
        }
        const fieldRaw = token.slice(0, colon);
        const expr = token.slice(colon + 1);
        const field = normalizeFieldAlias(fieldRaw);
        if (!field) {
            continue;
        }
        const parsed = parseTokenExpression(field, expr);
        if (parsed) {
            tokenFilters.push(parsed);
        }
    }

    let freeText = input;
    for (let i = tokens.length - 1; i >= 0; i--) {
        const t = tokens[i];
        freeText = freeText.slice(0, t.start) + freeText.slice(t.end);
    }
    freeText = freeText.replace(/\s+/g, ' ').trim();
    return { freeText, tokenFilters };
}

function parseTokenExpression(field: FilterField, exprRaw: string): TokenFilter | null {
    const expr = (exprRaw ?? '').trim();
    if (!expr) {
        return null;
    }

    if (field === 'difficulty' || field === 'terrain' || field === 'favorites_count') {
        const betweenIdx = expr.indexOf('<>');
        if (betweenIdx !== -1) {
            const a = parseFloat(expr.slice(0, betweenIdx));
            const b = parseFloat(expr.slice(betweenIdx + 2));
            if (Number.isFinite(a) && Number.isFinite(b)) {
                return { field, operator: 'between', value: String(Math.min(a, b)), value2: String(Math.max(a, b)) };
            }
            return null;
        }
        if (expr.startsWith('>=')) {
            const v = parseFloat(expr.slice(2));
            return Number.isFinite(v) ? { field, operator: 'gte', value: String(v) } : null;
        }
        if (expr.startsWith('<=')) {
            const v = parseFloat(expr.slice(2));
            return Number.isFinite(v) ? { field, operator: 'lte', value: String(v) } : null;
        }
        if (expr.startsWith('>')) {
            const v = parseFloat(expr.slice(1));
            return Number.isFinite(v) ? { field, operator: 'gt', value: String(v) } : null;
        }
        if (expr.startsWith('<')) {
            const v = parseFloat(expr.slice(1));
            return Number.isFinite(v) ? { field, operator: 'lt', value: String(v) } : null;
        }
        if (expr.startsWith('!=')) {
            const v = parseFloat(expr.slice(2));
            return Number.isFinite(v) ? { field, operator: 'neq', value: String(v) } : null;
        }
        if (expr.startsWith('=')) {
            const v = parseFloat(expr.slice(1));
            return Number.isFinite(v) ? { field, operator: 'eq', value: String(v) } : null;
        }
        const v = parseFloat(expr);
        return Number.isFinite(v) ? { field, operator: 'eq', value: String(v) } : null;
    }

    if (field === 'found') {
        const v = expr.toLowerCase();
        if (v === 'true' || v === '1' || v === 'yes' || v === 'found') {
            return { field, operator: 'is', value: 'true' };
        }
        if (v === 'false' || v === '0' || v === 'no' || v === 'notfound') {
            return { field, operator: 'is', value: 'false' };
        }
        return null;
    }

    if (field === 'cache_type' || field === 'size' || field === 'solved') {
        const list = expr
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
        if (list.length > 1) {
            return { field, operator: 'in', values: list };
        }
        return { field, operator: 'eq', value: expr };
    }

    if (expr.startsWith('!=')) {
        return { field, operator: 'neq', value: expr.slice(2) };
    }
    if (expr.startsWith('=')) {
        return { field, operator: 'eq', value: expr.slice(1) };
    }
    return { field, operator: 'contains', value: expr };
}

function matchesClause(geocache: Geocache, clause: TokenFilter): boolean {
    const field = clause.field;
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

    const actualStr = (rawValue ?? '').toString();
    const actualNorm = actualStr.toLowerCase();

    if (op === 'in' || op === 'not_in') {
        const values = (clause.values ?? []).map(v => v.toLowerCase());
        if (values.length === 0) {
            return true;
        }
        const ok = values.includes(actualNorm);
        return op === 'in' ? ok : !ok;
    }

    const wanted = (clause.value ?? '').toString();
    const wantedNorm = wanted.toLowerCase();
    if (!wantedNorm && (op === 'contains' || op === 'not_contains' || op === 'eq' || op === 'neq')) {
        return true;
    }

    if (op === 'contains') {
        return actualNorm.includes(wantedNorm);
    }
    if (op === 'not_contains') {
        return !actualNorm.includes(wantedNorm);
    }
    if (op === 'eq') {
        return actualNorm === wantedNorm;
    }
    if (op === 'neq') {
        return actualNorm !== wantedNorm;
    }
    return true;
}

function getOperatorOptionsForKind(kind: 'text' | 'number' | 'enum' | 'boolean' | undefined): Array<{ operator: AdvancedOperator; label: string }> {
    if (kind === 'number') {
        return [
            { operator: 'eq', label: '=' },
            { operator: 'neq', label: '≠' },
            { operator: 'gt', label: '>' },
            { operator: 'gte', label: '>=' },
            { operator: 'lt', label: '<' },
            { operator: 'lte', label: '<=' },
            { operator: 'between', label: 'entre' },
        ];
    }
    if (kind === 'enum') {
        return [
            { operator: 'eq', label: '=' },
            { operator: 'neq', label: '≠' },
            { operator: 'in', label: 'parmi' },
            { operator: 'not_in', label: 'sauf' },
        ];
    }
    if (kind === 'boolean') {
        return [{ operator: 'is', label: 'est' }];
    }
    return [
        { operator: 'contains', label: 'contient' },
        { operator: 'not_contains', label: 'ne contient pas' },
        { operator: 'eq', label: '=' },
        { operator: 'neq', label: '≠' },
    ];
}

function getDefaultOperatorForKind(kind: 'text' | 'number' | 'enum' | 'boolean' | undefined): AdvancedOperator {
    if (kind === 'number') {
        return 'between';
    }
    if (kind === 'enum') {
        return 'eq';
    }
    if (kind === 'boolean') {
        return 'is';
    }
    return 'contains';
}

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
    currentZoneId
}) => {
    const [sorting, setSorting] = React.useState<SortingState>([]);
    const [rowSelection, setRowSelection] = React.useState({});
    const [globalFilter, setGlobalFilter] = React.useState('');
    const [contextMenu, setContextMenu] = React.useState<{ items: ContextMenuItem[]; x: number; y: number } | null>(null);
    const [moveDialog, setMoveDialog] = React.useState<Geocache | null>(null);
    const [copyDialog, setCopyDialog] = React.useState<Geocache | null>(null);
    const [advancedFiltersOpen, setAdvancedFiltersOpen] = React.useState(false);
    const [advancedClauses, setAdvancedClauses] = React.useState<AdvancedFilterClause[]>([]);
    const searchInputRef = React.useRef<HTMLInputElement>(null);
    const [autocompleteOpen, setAutocompleteOpen] = React.useState(false);
    const [autocompleteSuggestions, setAutocompleteSuggestions] = React.useState<AutocompleteSuggestion[]>([]);
    const [autocompleteActiveIndex, setAutocompleteActiveIndex] = React.useState(0);
    const autocompleteReplaceRangeRef = React.useRef<{ start: number; end: number } | null>(null);

    const columns = React.useMemo<ColumnDef<Geocache>[]>(
        () => [
            {
                id: 'select',
                header: ({ table }) => {
                    const checkboxRef = React.useRef<HTMLInputElement>(null);
                    React.useEffect(() => {
                        if (checkboxRef.current) {
                            checkboxRef.current.indeterminate = table.getIsSomeRowsSelected() && !table.getIsAllRowsSelected();
                        }
                    }, [table.getIsSomeRowsSelected(), table.getIsAllRowsSelected()]);
                    
                    return (
                        <input
                            ref={checkboxRef}
                            type="checkbox"
                            checked={table.getIsAllRowsSelected()}
                            onChange={table.getToggleAllRowsSelectedHandler()}
                        />
                    );
                },
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
                    <div style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                    return (
                        <GeocacheIcon 
                            type={type} 
                            size={20}
                            showLabel={false}
                        />
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
                        <span style={{ fontSize: '0.85em' }} title={size}>
                            {size}
                        </span>
                    );
                },
                size: 100,
            },
            {
                accessorKey: 'solved',
                header: 'Statut',
                cell: info => {
                    const solved = info.getValue() as string;
                    return getStatusBadge(solved, (info.row.original as Geocache).found);
                },
                size: 100,
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
                cell: info => <span style={{ fontSize: '0.9em', opacity: 0.8 }}>{info.getValue() as string || '-'}</span>,
                size: 150,
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
                                style={{ padding: '2px 6px', fontSize: '0.85em' }}
                            >
                                🔄
                            </button>
                        )}
                        {onDelete && (
                            <button
                                onClick={() => onDelete(row.original)}
                                className="theia-button secondary"
                                title="Supprimer cette géocache"
                                style={{ padding: '2px 6px', fontSize: '0.85em', color: 'var(--theia-errorForeground)' }}
                            >
                                🗑️
                            </button>
                        )}
                    </div>
                ),
                size: 100,
            },
        ],
        []
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

    const fieldDefinitions = React.useMemo(() => {
        const defs: Array<{ field: FilterField; label: string; kind: 'text' | 'number' | 'enum' | 'boolean' }> = [
            { field: 'gc_code', label: 'Code GC', kind: 'text' },
            { field: 'name', label: 'Nom', kind: 'text' },
            { field: 'owner', label: 'Propriétaire', kind: 'text' },
            { field: 'cache_type', label: 'Type', kind: 'enum' },
            { field: 'difficulty', label: 'Difficulté', kind: 'number' },
            { field: 'terrain', label: 'Terrain', kind: 'number' },
            { field: 'size', label: 'Taille', kind: 'enum' },
            { field: 'solved', label: 'Statut', kind: 'enum' },
            { field: 'found', label: 'Trouvée', kind: 'boolean' },
            { field: 'favorites_count', label: 'Favoris', kind: 'number' },
        ];
        return defs;
    }, []);

    const fieldLabelById = React.useMemo(() => {
        const map = new Map<FilterField, string>();
        for (const def of fieldDefinitions) {
            map.set(def.field, def.label);
        }
        return map;
    }, [fieldDefinitions]);

    const fieldKindById = React.useMemo(() => {
        const map = new Map<FilterField, 'text' | 'number' | 'enum' | 'boolean'>();
        for (const def of fieldDefinitions) {
            map.set(def.field, def.kind);
        }
        return map;
    }, [fieldDefinitions]);

    const solvedOptions = React.useMemo(() => ['not_solved', 'in_progress', 'solved'], []);

    const enumOptionsByField = React.useMemo(() => {
        const map = new Map<FilterField, string[]>();
        map.set('cache_type', cacheTypes);
        map.set('size', sizes);
        map.set('solved', solvedOptions);
        map.set('found', ['true', 'false']);
        return map;
    }, [cacheTypes, sizes, solvedOptions]);

    const filteredData = React.useMemo(() => {
        const { freeText, tokenFilters } = parseSearchQuery(globalFilter);
        const normalizedFreeText = freeText.trim().toLowerCase();

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
            if (normalizedFreeText) {
                const haystack = [
                    geocache.gc_code,
                    geocache.name,
                    geocache.cache_type,
                    geocache.owner ?? ''
                ]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase();
                if (!haystack.includes(normalizedFreeText)) {
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

    const table = useReactTable({
        data: filteredData,
        columns,
        state: {
            sorting,
            rowSelection,
        },
        onSortingChange: setSorting,
        onRowSelectionChange: setRowSelection,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        enableRowSelection: true,
    });

    const selectedRows = table.getSelectedRowModel().rows;
    const selectedIds = selectedRows.map(row => row.original.id);

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

    const addClause = React.useCallback(() => {
        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        setAdvancedClauses(prev => [
            ...prev,
            {
                id,
                field: 'difficulty',
                operator: 'between',
                value: '1',
                value2: '5'
            }
        ]);
        setAdvancedFiltersOpen(true);
    }, []);

    const clearAllClauses = React.useCallback(() => {
        setAdvancedClauses([]);
    }, []);

    const removeClause = React.useCallback((id: string) => {
        setAdvancedClauses(prev => prev.filter(c => c.id !== id));
    }, []);

    const updateClause = React.useCallback((id: string, patch: Partial<AdvancedFilterClause>) => {
        setAdvancedClauses(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
    }, []);

    const refreshAutocomplete = React.useCallback(
        (value: string) => {
            const input = searchInputRef.current;
            if (!input) {
                setAutocompleteOpen(false);
                return;
            }
            const caret = input.selectionStart ?? value.length;
            const before = value.slice(0, caret);
            const tokenStart = findAutocompleteTokenStart(before);
            if (tokenStart === null) {
                setAutocompleteOpen(false);
                return;
            }

            const fragment = before.slice(tokenStart + 1);
            if (fragment.includes(' ')) {
                setAutocompleteOpen(false);
                return;
            }

            const colonIndex = fragment.indexOf(':');
            const suggestions: AutocompleteSuggestion[] = [];
            if (colonIndex === -1) {
                const prefix = fragment.trim().toLowerCase();
                for (const def of fieldDefinitions) {
                    if (!prefix || def.field.startsWith(prefix) || def.label.toLowerCase().includes(prefix)) {
                        suggestions.push({
                            id: def.field,
                            label: `${def.field} — ${def.label}`,
                            insertText: `@${def.field}:`
                        });
                    }
                }
            } else {
                const fieldPart = fragment.slice(0, colonIndex).trim().toLowerCase();
                const field = normalizeFieldAlias(fieldPart);
                if (field) {
                    const kind = fieldKindById.get(field);
                    if (kind === 'number') {
                        suggestions.push(
                            { id: `${field}-gt`, label: `${field}:>…`, insertText: `@${field}:>` },
                            { id: `${field}-lt`, label: `${field}:<…`, insertText: `@${field}:<` },
                            { id: `${field}-gte`, label: `${field}:>=…`, insertText: `@${field}:>=` },
                            { id: `${field}-lte`, label: `${field}:<=…`, insertText: `@${field}:<=` },
                            { id: `${field}-between`, label: `${field}:x<>y`, insertText: `@${field}:1<>5` }
                        );
                    } else if (kind === 'boolean') {
                        suggestions.push(
                            { id: `${field}-true`, label: `${field}:true`, insertText: `@${field}:true` },
                            { id: `${field}-false`, label: `${field}:false`, insertText: `@${field}:false` }
                        );
                    } else if (kind === 'enum') {
                        const options = enumOptionsByField.get(field) ?? [];
                        for (const opt of options.slice(0, 12)) {
                            suggestions.push({
                                id: `${field}-${opt}`,
                                label: `${field}:${opt}`,
                                insertText: `@${field}:${opt}`
                            });
                        }
                    } else {
                        suggestions.push({
                            id: `${field}-contains`,
                            label: `${field}:…`,
                            insertText: `@${field}:`
                        });
                    }
                }
            }

            if (suggestions.length === 0) {
                setAutocompleteOpen(false);
                return;
            }
            autocompleteReplaceRangeRef.current = { start: tokenStart, end: caret };
            setAutocompleteSuggestions(suggestions);
            setAutocompleteActiveIndex(0);
            setAutocompleteOpen(true);
        },
        [fieldDefinitions, fieldKindById, enumOptionsByField]
    );

    const applyAutocompleteSuggestion = React.useCallback(
        (suggestion: AutocompleteSuggestion) => {
            const input = searchInputRef.current;
            const range = autocompleteReplaceRangeRef.current;
            if (!input || !range) {
                return;
            }
            const current = globalFilter ?? '';
            const next = current.slice(0, range.start) + suggestion.insertText + current.slice(range.end);
            setGlobalFilter(next);
            requestAnimationFrame(() => {
                const newPos = range.start + suggestion.insertText.length;
                input.focus();
                input.setSelectionRange(newPos, newPos);
            });
            setAutocompleteOpen(false);
        },
        [globalFilter]
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
            {/* Toolbar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 0' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div style={{ position: 'relative' }}>
                        <input
                            ref={searchInputRef}
                            type="text"
                            value={globalFilter ?? ''}
                            onChange={e => {
                                const v = e.target.value;
                                setGlobalFilter(v);
                                refreshAutocomplete(v);
                            }}
                            onKeyDown={e => {
                                if (!autocompleteOpen) {
                                    return;
                                }
                                if (e.key === 'ArrowDown') {
                                    e.preventDefault();
                                    setAutocompleteActiveIndex(i => Math.min(i + 1, autocompleteSuggestions.length - 1));
                                } else if (e.key === 'ArrowUp') {
                                    e.preventDefault();
                                    setAutocompleteActiveIndex(i => Math.max(i - 1, 0));
                                } else if (e.key === 'Enter' || e.key === 'Tab') {
                                    e.preventDefault();
                                    const suggestion = autocompleteSuggestions[autocompleteActiveIndex];
                                    if (suggestion) {
                                        applyAutocompleteSuggestion(suggestion);
                                    }
                                } else if (e.key === 'Escape') {
                                    e.preventDefault();
                                    setAutocompleteOpen(false);
                                }
                            }}
                            onBlur={() => {
                                window.setTimeout(() => setAutocompleteOpen(false), 150);
                            }}
                            placeholder="Rechercher..."
                            style={{
                                padding: '4px 8px',
                                border: '1px solid var(--theia-input-border)',
                                background: 'var(--theia-input-background)',
                                color: 'var(--theia-input-foreground)',
                                borderRadius: 3,
                                width: 260,
                            }}
                        />

                        {autocompleteOpen && autocompleteSuggestions.length > 0 && (
                            <div
                                style={{
                                    position: 'absolute',
                                    top: '100%',
                                    left: 0,
                                    marginTop: 4,
                                    width: 360,
                                    maxHeight: 220,
                                    overflowY: 'auto',
                                    border: '1px solid var(--theia-panel-border)',
                                    background: 'var(--theia-editor-background)',
                                    borderRadius: 3,
                                    zIndex: 10,
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.35)'
                                }}
                                onMouseDown={e => e.preventDefault()}
                            >
                                {autocompleteSuggestions.map((s, idx) => (
                                    <div
                                        key={s.id}
                                        style={{
                                            padding: '6px 8px',
                                            cursor: 'pointer',
                                            background:
                                                idx === autocompleteActiveIndex
                                                    ? 'var(--theia-list-activeSelectionBackground)'
                                                    : 'transparent'
                                        }}
                                        onMouseEnter={() => setAutocompleteActiveIndex(idx)}
                                        onClick={() => applyAutocompleteSuggestion(s)}
                                    >
                                        <div style={{ fontSize: '0.9em' }}>{s.label}</div>
                                        <div style={{ fontSize: '0.8em', opacity: 0.7, fontFamily: 'monospace' }}>{s.insertText}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    <span style={{ fontSize: '0.9em', opacity: 0.7 }}>
                        {filteredData.length} géocache(s)
                    </span>
                    <button
                        onClick={() => setAdvancedFiltersOpen(o => !o)}
                        className="theia-button secondary"
                        title="Afficher / masquer les filtres supplémentaires"
                    >
                        {advancedFiltersOpen ? 'Masquer les filtres' : 'Filtres supplémentaires'}
                    </button>
                </div>
                
                {selectedIds.length > 0 && (
                    <div style={{ display: 'flex', gap: 8 }}>
                        <span style={{ fontSize: '0.9em', opacity: 0.8 }}>
                            {selectedIds.length} sélectionnée(s)
                        </span>
                        {onLogSelected && (
                            <button
                                onClick={() => onLogSelected(selectedIds)}
                                className="theia-button primary"
                                title="Loguer les géocaches sélectionnées"
                            >
                                ✍️ Loguer
                            </button>
                        )}
                        {onApplyPluginSelected && (
                            <button
                                onClick={() => onApplyPluginSelected(selectedIds)}
                                className="theia-button primary"
                                title="Appliquer un plugin aux géocaches sélectionnées"
                            >
                                🔧 Appliquer un plugin
                            </button>
                        )}
                        {onExportGpxSelected && (
                            <button
                                onClick={() => onExportGpxSelected(selectedIds)}
                                className="theia-button secondary"
                                title="Exporter les géocaches sélectionnées au format GPX"
                            >
                                ⬇️ Exporter GPX
                            </button>
                        )}
                        {onRefreshSelected && (
                            <button
                                onClick={() => onRefreshSelected(selectedIds)}
                                className="theia-button secondary"
                                title="Rafraîchir les géocaches sélectionnées"
                            >
                                🔄 Rafraîchir
                            </button>
                        )}
                        {onCopySelected && zones.length > 1 && (
                            <button
                                onClick={() => onCopySelected(selectedIds)}
                                className="theia-button secondary"
                                title="Copier les géocaches sélectionnées vers une autre zone"
                            >
                                📋 Copier
                            </button>
                        )}
                        {onMoveSelected && zones.length > 1 && (
                            <button
                                onClick={() => onMoveSelected(selectedIds)}
                                className="theia-button secondary"
                                title="Déplacer les géocaches sélectionnées vers une autre zone"
                            >
                                📦 Déplacer
                            </button>
                        )}
                        {onDeleteSelected && (
                            <button
                                onClick={() => onDeleteSelected(selectedIds)}
                                className="theia-button secondary"
                                style={{ color: 'var(--theia-errorForeground)' }}
                                title="Supprimer les géocaches sélectionnées"
                            >
                                🗑️ Supprimer
                            </button>
                        )}
                    </div>
                )}
            </div>

            {advancedFiltersOpen && (
                <div
                    style={{
                        border: '1px solid var(--theia-panel-border)',
                        borderRadius: 3,
                        padding: 8,
                        background: 'var(--theia-editor-background)'
                    }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <div style={{ fontWeight: 600, opacity: 0.9 }}>Filtres supplémentaires</div>
                        <div style={{ display: 'flex', gap: 8 }}>
                            {advancedClauses.length > 0 && (
                                <button
                                    onClick={clearAllClauses}
                                    className="theia-button secondary"
                                    style={{ color: 'var(--theia-errorForeground)' }}
                                >
                                    Supprimer tous les filtres
                                </button>
                            )}
                            <button onClick={addClause} className="theia-button primary">
                                Ajouter un filtre
                            </button>
                        </div>
                    </div>

                    {advancedClauses.length === 0 ? (
                        <div style={{ opacity: 0.7, fontSize: '0.9em' }}>Aucun filtre supplémentaire.</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {advancedClauses.map(clause => {
                                const kind = fieldKindById.get(clause.field);
                                const enumOptions = enumOptionsByField.get(clause.field) ?? [];
                                const operatorOptions = getOperatorOptionsForKind(kind);

                                return (
                                    <div
                                        key={clause.id}
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: '160px 150px 1fr 40px',
                                            gap: 8,
                                            alignItems: 'center'
                                        }}
                                    >
                                        <select
                                            value={clause.field}
                                            onChange={e => {
                                                const newField = e.target.value as FilterField;
                                                const newKind = fieldKindById.get(newField);
                                                const defaultOp = getDefaultOperatorForKind(newKind);
                                                const patch: Partial<AdvancedFilterClause> = {
                                                    field: newField,
                                                    operator: defaultOp,
                                                    value: '',
                                                    value2: undefined,
                                                    values: undefined
                                                };
                                                if (defaultOp === 'between') {
                                                    patch.value = '1';
                                                    patch.value2 = '5';
                                                }
                                                updateClause(clause.id, patch);
                                            }}
                                            style={{
                                                padding: '4px 6px',
                                                border: '1px solid var(--theia-input-border)',
                                                background: 'var(--theia-input-background)',
                                                color: 'var(--theia-input-foreground)',
                                                borderRadius: 3
                                            }}
                                        >
                                            {fieldDefinitions.map(def => (
                                                <option key={def.field} value={def.field}>
                                                    {def.label}
                                                </option>
                                            ))}
                                        </select>

                                        <select
                                            value={clause.operator}
                                            onChange={e => {
                                                const op = e.target.value as AdvancedOperator;
                                                const patch: Partial<AdvancedFilterClause> = { operator: op };
                                                if (op === 'between') {
                                                    patch.value2 = clause.value2 ?? '';
                                                } else {
                                                    patch.value2 = undefined;
                                                }
                                                if (op === 'in' || op === 'not_in') {
                                                    patch.values = clause.values ?? [];
                                                } else {
                                                    patch.values = undefined;
                                                }
                                                updateClause(clause.id, patch);
                                            }}
                                            style={{
                                                padding: '4px 6px',
                                                border: '1px solid var(--theia-input-border)',
                                                background: 'var(--theia-input-background)',
                                                color: 'var(--theia-input-foreground)',
                                                borderRadius: 3
                                            }}
                                        >
                                            {operatorOptions.map(o => (
                                                <option key={o.operator} value={o.operator}>
                                                    {o.label}
                                                </option>
                                            ))}
                                        </select>

                                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                            {kind === 'enum' && (clause.operator === 'in' || clause.operator === 'not_in') ? (
                                                <select
                                                    multiple
                                                    value={clause.values ?? []}
                                                    onChange={e => {
                                                        const selected = Array.from(e.target.selectedOptions).map(o => o.value);
                                                        updateClause(clause.id, { values: selected });
                                                    }}
                                                    style={{
                                                        width: '100%',
                                                        padding: '4px 6px',
                                                        border: '1px solid var(--theia-input-border)',
                                                        background: 'var(--theia-input-background)',
                                                        color: 'var(--theia-input-foreground)',
                                                        borderRadius: 3,
                                                        minHeight: 70
                                                    }}
                                                >
                                                    {enumOptions.map(opt => (
                                                        <option key={opt} value={opt}>
                                                            {opt}
                                                        </option>
                                                    ))}
                                                </select>
                                            ) : kind === 'enum' ? (
                                                <select
                                                    value={clause.value}
                                                    onChange={e => updateClause(clause.id, { value: e.target.value })}
                                                    style={{
                                                        width: '100%',
                                                        padding: '4px 6px',
                                                        border: '1px solid var(--theia-input-border)',
                                                        background: 'var(--theia-input-background)',
                                                        color: 'var(--theia-input-foreground)',
                                                        borderRadius: 3
                                                    }}
                                                >
                                                    <option value="">—</option>
                                                    {enumOptions.map(opt => (
                                                        <option key={opt} value={opt}>
                                                            {opt}
                                                        </option>
                                                    ))}
                                                </select>
                                            ) : kind === 'boolean' ? (
                                                <select
                                                    value={clause.value}
                                                    onChange={e => updateClause(clause.id, { value: e.target.value })}
                                                    style={{
                                                        width: '100%',
                                                        padding: '4px 6px',
                                                        border: '1px solid var(--theia-input-border)',
                                                        background: 'var(--theia-input-background)',
                                                        color: 'var(--theia-input-foreground)',
                                                        borderRadius: 3
                                                    }}
                                                >
                                                    <option value="">—</option>
                                                    <option value="true">true</option>
                                                    <option value="false">false</option>
                                                </select>
                                            ) : clause.operator === 'between' ? (
                                                <>
                                                    <input
                                                        type={kind === 'number' ? 'number' : 'text'}
                                                        step={clause.field === 'difficulty' || clause.field === 'terrain' ? 0.5 : 1}
                                                        value={clause.value}
                                                        onChange={e => updateClause(clause.id, { value: e.target.value })}
                                                        style={{
                                                            width: 120,
                                                            padding: '4px 6px',
                                                            border: '1px solid var(--theia-input-border)',
                                                            background: 'var(--theia-input-background)',
                                                            color: 'var(--theia-input-foreground)',
                                                            borderRadius: 3
                                                        }}
                                                    />
                                                    <span style={{ opacity: 0.7 }}>et</span>
                                                    <input
                                                        type={kind === 'number' ? 'number' : 'text'}
                                                        step={clause.field === 'difficulty' || clause.field === 'terrain' ? 0.5 : 1}
                                                        value={clause.value2 ?? ''}
                                                        onChange={e => updateClause(clause.id, { value2: e.target.value })}
                                                        style={{
                                                            width: 120,
                                                            padding: '4px 6px',
                                                            border: '1px solid var(--theia-input-border)',
                                                            background: 'var(--theia-input-background)',
                                                            color: 'var(--theia-input-foreground)',
                                                            borderRadius: 3
                                                        }}
                                                    />
                                                </>
                                            ) : (
                                                <input
                                                    type={kind === 'number' ? 'number' : 'text'}
                                                    step={clause.field === 'difficulty' || clause.field === 'terrain' ? 0.5 : 1}
                                                    value={clause.value}
                                                    onChange={e => updateClause(clause.id, { value: e.target.value })}
                                                    placeholder={fieldLabelById.get(clause.field) ?? ''}
                                                    style={{
                                                        width: '100%',
                                                        padding: '4px 6px',
                                                        border: '1px solid var(--theia-input-border)',
                                                        background: 'var(--theia-input-background)',
                                                        color: 'var(--theia-input-foreground)',
                                                        borderRadius: 3
                                                    }}
                                                />
                                            )}
                                        </div>

                                        <button
                                            onClick={() => removeClause(clause.id)}
                                            className="theia-button secondary"
                                            style={{ padding: '2px 6px', color: 'var(--theia-errorForeground)' }}
                                            title="Supprimer ce filtre"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Table */}
            <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--theia-panel-border)', borderRadius: 3 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--theia-editor-background)', zIndex: 1 }}>
                        {table.getHeaderGroups().map(headerGroup => (
                            <tr key={headerGroup.id}>
                                {headerGroup.headers.map(header => (
                                    <th
                                        key={header.id}
                                        style={{
                                            padding: '8px 6px',
                                            textAlign: 'left',
                                            borderBottom: '1px solid var(--theia-panel-border)',
                                            cursor: header.column.getCanSort() ? 'pointer' : 'default',
                                            userSelect: 'none',
                                            fontWeight: 600,
                                        }}
                                        onClick={header.column.getToggleSortingHandler()}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                            {flexRender(header.column.columnDef.header, header.getContext())}
                                            {{
                                                asc: ' ⬆️',
                                                desc: ' ⬇️',
                                            }[header.column.getIsSorted() as string] ?? null}
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        ))}
                    </thead>
                    <tbody>
                        {table.getRowModel().rows.map(row => (
                            <tr
                                key={row.id}
                                onClick={() => onRowClick?.(row.original)}
                                onContextMenu={(e) => showContextMenu(row.original, e)}
                                style={{
                                    cursor: 'pointer',
                                    background: row.getIsSelected()
                                        ? 'var(--theia-list-activeSelectionBackground)'
                                        : 'transparent',
                                }}
                                onMouseEnter={(e) => {
                                    if (!row.getIsSelected()) {
                                        (e.currentTarget as HTMLElement).style.background = 'var(--theia-list-hoverBackground)';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (!row.getIsSelected()) {
                                        (e.currentTarget as HTMLElement).style.background = 'transparent';
                                    }
                                }}
                            >
                                {row.getVisibleCells().map(cell => (
                                    <td
                                        key={cell.id}
                                        style={{
                                            padding: '6px',
                                            borderBottom: '1px solid var(--theia-panel-border)',
                                        }}
                                    >
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </td>
                                ))}
                            </tr>
                        ))}
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
function getStatusBadge(solved: string, found: boolean): React.ReactNode {
    if (found) {
        return (
            <span
                style={{
                    padding: '2px 6px',
                    borderRadius: 3,
                    fontSize: '0.85em',
                    background: '#2ecc71',
                    color: '#fff',
                    fontWeight: 600,
                }}
                title="Trouvée"
            >
                ✓ Trouvée
            </span>
        );
    }
    if (solved === 'solved') {
        return (
            <span
                style={{
                    padding: '2px 6px',
                    borderRadius: 3,
                    fontSize: '0.85em',
                    background: '#3498db',
                    color: '#fff',
                    fontWeight: 600,
                }}
                title="Résolue"
            >
                ✓ Résolue
            </span>
        );
    }
    if (solved === 'in_progress') {
        return (
            <span
                style={{
                    padding: '2px 6px',
                    borderRadius: 3,
                    fontSize: '0.85em',
                    background: '#f39c12',
                    color: '#fff',
                    fontWeight: 600,
                }}
                title="En cours"
            >
                ⏳ En cours
            </span>
        );
    }
    return (
        <span
            style={{
                padding: '2px 6px',
                borderRadius: 3,
                fontSize: '0.85em',
                background: '#7f8c8d',
                color: '#fff',
                fontWeight: 600,
            }}
            title="Non résolue"
        >
            ○ Non résolue
        </span>
    );
}
