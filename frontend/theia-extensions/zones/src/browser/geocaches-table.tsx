import * as React from 'react';
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    ColumnDef,
    ColumnOrderState,
    flexRender,
    SortingState,
    OnChangeFn,
    Table,
    VisibilityState,
} from '@tanstack/react-table';
import { ContextMenu, ContextMenuItem } from './context-menu';
import { MoveGeocacheDialog } from './move-geocache-dialog';
import { GeocacheIcon } from './geocache-icon';
import type { FriendZoneScanEntry } from './friends-types';
import type { FriendFilter } from './friend-outing-state';
import { friendOfFilter } from './friend-outing-state';
import { friendColor } from './friend-colors';
import { favoritePercent, favoritePercentHint, formatFavoritePercent } from './favorite-percent';
import { GeocacheFilterBar } from './geocache-filter-bar';
import {
    AdvancedFilterClause,
    FilterPreset,
    TokenFilter,
    ZONE_GEOCACHE_FIELD_DEFINITIONS,
    NUMERIC_GEOCACHE_FIELDS,
    BOOLEAN_GEOCACHE_FIELDS,
    DATE_GEOCACHE_FIELDS,
    parseSearchQuery,
    matchesSearchPattern,
    normalizeSearchText,
} from './geocache-filter-shared';

import '../../src/browser/style/geocaches-table.css';
// Les badges de sortie sont définis avec le panneau : la table doit les habiller même
// quand ce panneau n'a jamais été ouvert.
import '../../src/browser/style/outing-plan.css';

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
    /** Logs stockés en local, pas le total du site : inutilisable comme dénominateur. */
    logs_count?: number;
    /** Total de logs annoncé par Geocaching.com, tous types confondus. */
    logs_total_available?: number;
    /** Trouvailles annoncées par Geocaching.com (Found + Attended + Webcam). */
    finds_count?: number;
    /** Pourcentage de favoris calculé côté backend sur `finds_count`. */
    favorites_percent?: number;
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


import { OutingPlanCacheFlags, badgesForFlags, formatOutingMinutes } from './outing-plan-types';

interface GeocachesTableProps {
    data: Geocache[];
    onRowClick?: (geocache: Geocache) => void;
    onDeleteSelected?: (ids: number[]) => void;
    onRefreshSelected?: (ids: number[]) => void;
    onLogSelected?: (ids: number[]) => void;
    onCopySelected?: (ids: number[]) => void;
    onMoveSelected?: (ids: number[]) => void;
    onApplyPluginSelected?: (ids: number[]) => void;
    onAnalyzeWithAiSelected?: (ids: number[]) => void;
    /** Vrai pendant la collecte du bundle d'analyse : le bouton passe en attente. */
    analyzingWithAi?: boolean;
    onExportGpxSelected?: (ids: number[]) => void;
    /** Vrai pendant la génération/le téléchargement de l'export GPX. */
    exportingGpx?: boolean;
    onDelete?: (geocache: Geocache) => void;
    onRefresh?: (id: number) => void;
    onMove?: (geocache: Geocache, targetZoneId: number) => void;
    onCopy?: (geocache: Geocache, targetZoneId: number) => void;
    onImportAround?: (geocache: Geocache) => void;
    zones?: Array<{ id: number; name: string }>;
    currentZoneId?: number;
    visibleColumnIds?: GeocachesTableColumnId[];
    onVisibleColumnIdsChange?: (columnIds: GeocachesTableColumnId[]) => void;
    /** Tri contrôlé de l'extérieur (persistance par zone) ; interne sinon. */
    sorting?: SortingState;
    onSortingChange?: (sorting: SortingState) => void;
    onFilteredDataChange?: (geocaches: Geocache[]) => void;
    /** Identifiants des géocaches cochées (pour les mettre en évidence sur la carte). */
    onSelectionChange?: (geocacheIds: number[]) => void;
    /**
     * Sélection imposée de l'extérieur (Ctrl+clic ou menu contextuel de la carte).
     * Le tableau reste maître de ses cases à cocher : il se réaligne seulement
     * quand cette liste diverge de son état interne.
     */
    selectedGeocacheIds?: number[];
    /** « Qui a trouvé quoi » : code GC -> pseudos d'amis (colonne `friends_found`). */
    friendFinds?: Record<string, string[]>;
    /** État des scans par ami (pour détecter les caches non analysées). */
    friendScans?: FriendZoneScanEntry[];
    /**
     * Amis actifs (pour le code couleur des lignes et la colonne « 👥 »). Si vide
     * ou absent, aucune couleur « amis » n'est appliquée : ces états n'ont de sens
     * que dans le cadre d'une sortie, avec des amis explicitement sélectionnés.
     */
    activeFriends?: Set<string>;
    /**
     * Mode « sortie entre amis ».
     *
     * Le tableau continue d'afficher toute la zone — on prépare une sortie en
     * comparant ce qu'on y met à ce qu'on n'y met pas. Le mode ne change que la
     * lecture : colonne « 👥 » d'office, code couleur des lignes, marqueur du
     * périmètre, et les filtres qui n'ont de sens qu'avec des amis choisis.
     */
    outingMode?: boolean;
    /**
     * Codes GC du périmètre de la sortie. Vide = toute la zone : il n'y a alors
     * rien à distinguer, ni marqueur ni filtre de périmètre.
     */
    outingGcCodes?: string[];
    /** Filtre « amis » du mode sortie (manquantes pour X / personne / tous). */
    friendFilter?: FriendFilter;
    /** Change le filtre « amis » (contrôles de la barre de filtres). */
    onFriendFilterChange?: (filter: FriendFilter) => void;
    /** Hors mode sortie : la sélection courante ouvre une sortie. */
    onStartOutingWithSelection?: (ids: number[]) => void;
    /** En mode sortie : la sélection courante s'ajoute au périmètre. */
    onAddSelectionToOuting?: (ids: number[]) => void;
    /**
     * Ce que la dernière analyse IA a signalé, par code GC (colonne `outing_flags`).
     *
     * Ces drapeaux ne sont pas des faits calculés par GeoApp mais les conclusions d'un
     * modèle, datées. L'infobulle du badge le dit et nomme la sortie d'origine : un badge
     * « santé risquée » lu comme un calcul serait plus trompeur que pas de badge du tout.
     */
    outingFlags?: Record<string, OutingPlanCacheFlags>;
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
    | 'favorites_percent'
    | 'owner'
    | 'finds_count'
    // `friends_found` n'apparaît pas dans GEOCACHES_TABLE_COLUMN_DEFINITIONS : la
    // colonne « 👥 » est pilotée par le mode sortie, pas par le menu Colonnes. Elle
    // garde son identifiant parce qu'elle reste une colonne du tableau — et parce
    // que des préférences enregistrées la contiennent encore (elles sont ignorées).
    | 'friends_found'
    | 'outing_flags'
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
    { id: 'favorites_percent', label: '%PF', description: 'Part des trouvailles qui ont donné un point favori.' },
    { id: 'owner', label: 'Propriétaire', description: 'Propriétaire de la cache.' },
    // Remplace l'ancienne colonne `logs_count`, qui annonçait « Logs » mais ne
    // comptait que les logs chargés dans GeoApp. Les préférences enregistrées qui
    // la contiennent encore sont ignorées — l'identifiant n'existe plus.
    { id: 'finds_count', label: 'Trouvailles', description: 'Nombre de Found it annoncé par Geocaching.com.' },
    { id: 'outing_flags', label: 'Sortie', description: "Signaux de la dernière analyse IA de sortie (matériel, santé, bloquant)." },
    { id: 'status', label: 'Statut', description: 'Statut de la cache sur Geocaching.com (active, désactivée, archivée).' },
    { id: 'need_maintenance', label: 'Maintenance', description: 'Indique si le propriétaire a demandé une attention particulière (Need Maintenance).' },
];

export const ALL_GEOCACHES_TABLE_COLUMN_IDS = GEOCACHES_TABLE_COLUMN_DEFINITIONS.map(def => def.id);

/**
 * Presets de la barre de filtres du tableau de zone : requêtes tokenisées
 * `@champ:valeur` appliquées telles quelles dans le champ de recherche — le
 * texte reste visible et l'utilisateur peut l'ajuster après application.
 */
const ZONE_FILTER_PRESETS: FilterPreset[] = [
    { id: 'not-found', label: 'Non trouvées', searchQuery: '@found:false' },
    { id: 'unsolved-mysteries', label: 'Mysteries à résoudre', searchQuery: '@type:mystery @solved:not_solved,in_progress' },
    { id: 'active', label: 'Actives', searchQuery: '@status:active' },
    { id: 'corrected', label: 'Corrigées', searchQuery: '@corrigée:oui' },
    { id: 'with-notes', label: 'Avec notes', searchQuery: '@notes:oui' },
];
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


/**
 * Valeurs dérivées des champs de filtre qui ne se lisent pas directement sur
 * l'objet géocache : comptages calculés, repli de date, attributs, booléens
 * absents du payload.
 */
const GEOCACHE_FILTER_ACCESSORS: Record<string, (gc: Geocache) => unknown> = {
    waypoints_count: gc => gc.waypoints?.length ?? 0,
    placed_at: gc => gc.placed_at ?? gc.hidden_date,
    has_notes: gc => Boolean(gc.has_notes),
    is_corrected: gc => Boolean(gc.is_corrected),
    need_maintenance: gc => (gc.attributes ?? []).some(
        a => !a.is_negative && a.name.toLowerCase().includes('owner attention')
    ),
    // `favorites_percent` peut être absent du payload (cache pas encore
    // re-scrapée) alors que la colonne affiche une estimation : le filtre lit la
    // même valeur que l'affichage, sans quoi `@pf>50` masquerait des lignes que
    // le tableau montre à « ~59.6% ».
    favorites_percent: gc => favoritePercent(gc).value,
};

/**
 * Alias français des valeurs des champs enum `status` et `solved`. Les clés
 * sont déjà normalisées (minuscules, sans accents — voir `normalizeSearchText`
 * dans le module partagé).
 */
const STATUS_VALUE_ALIASES: Record<string, string> = {
    active: 'active', activee: 'active', archived: 'archived', archive: 'archived', archivee: 'archived',
    disabled: 'disabled', desactive: 'disabled', desactivee: 'disabled', inactive: 'disabled',
};
const SOLVED_VALUE_ALIASES: Record<string, string> = {
    solved: 'solved', resolu: 'solved', resolue: 'solved', not_solved: 'not_solved',
    non_resolue: 'not_solved', in_progress: 'in_progress', en_cours: 'in_progress', encours: 'in_progress',
};

/**
 * Remplace la valeur saisie pour `status`/`solved` par sa forme canonique
 * quand un alias français la désigne ; sinon la retourne telle quelle. Les
 * espaces sont aussi essayés en `_` (« en cours » → `en_cours`).
 */
function canonicalEnumFilterValue(field: string, value: string): string {
    const aliases = field === 'status' ? STATUS_VALUE_ALIASES
        : field === 'solved' ? SOLVED_VALUE_ALIASES
            : undefined;
    if (!aliases) {
        return value;
    }
    const normalized = normalizeSearchText(value);
    return aliases[normalized]
        ?? aliases[normalized.replace(/\s+/g, '_')]
        ?? aliases[normalized.replace(/[\s_]+/g, '')]
        ?? value;
}

function matchesClause(geocache: Geocache, clause: TokenFilter): boolean {
    const field: string = clause.field;
    const op = clause.operator;

    const rawValue = GEOCACHE_FILTER_ACCESSORS[field]?.(geocache) ?? (geocache as any)[field];

    if (BOOLEAN_GEOCACHE_FIELDS.has(field)) {
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

    if (NUMERIC_GEOCACHE_FIELDS.has(field)) {
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

    // Comparaison par préfixe sur la date ISO : la granularité de la borne
    // (`2020`, `2020-05` ou `2020-05-17`) fixe la longueur du préfixe comparé.
    if (DATE_GEOCACHE_FIELDS.has(field)) {
        const actual = String(rawValue ?? '');
        if (!/^\d{4}-\d{2}-\d{2}/.test(actual)) {
            // Une cache sans date ne satisfait aucune borne, mais satisfait
            // « différent de » : `@placed_at:!=2020` la conserve.
            return op === 'neq';
        }
        if (op === 'between') {
            const v1 = clause.value ?? '';
            const v2 = clause.value2 ?? '';
            if (!v1 || !v2) {
                return true;
            }
            return actual.slice(0, v1.length) >= v1 && actual.slice(0, v2.length) <= v2;
        }
        const w = (clause.value ?? '').toString();
        if (!w) {
            return true;
        }
        const p = actual.slice(0, w.length);
        if (op === 'eq') {
            return p === w;
        }
        if (op === 'neq') {
            return p !== w;
        }
        if (op === 'gte') {
            return p >= w;
        }
        if (op === 'gt') {
            return p > w;
        }
        if (op === 'lte') {
            return p <= w;
        }
        if (op === 'lt') {
            return p < w;
        }
        return true;
    }

    if (op === 'in' || op === 'not_in') {
        const values = clause.values ?? [];
        if (values.length === 0) {
            return true;
        }
        const ok = values.some(v => matchesSearchPattern(rawValue, canonicalEnumFilterValue(field, v), 'equals'));
        return op === 'in' ? ok : !ok;
    }

    const wanted = canonicalEnumFilterValue(field, (clause.value ?? '').toString());
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

/**
 * Shift+clic : coche toutes les lignes entre `anchorRowId` et `targetRowId`
 * dans l'ordre du rowModel courant (tri et filtres appliqués — la plage suit
 * ce que l'utilisateur voit). Union avec la sélection existante : un Shift+clic
 * ne décoche jamais, ce sont des cases à cocher et non une sélection exclusive.
 * Retourne faux si une des bornes n'est pas visible — l'appelant retombe alors
 * sur un simple toggle.
 */
function selectRowRange(table: Table<Geocache>, anchorRowId: string, targetRowId: string): boolean {
    const rows = table.getRowModel().rows;
    const from = rows.findIndex(row => row.id === anchorRowId);
    const to = rows.findIndex(row => row.id === targetRowId);
    if (from < 0 || to < 0 || from === to) {
        return false;
    }
    const [start, end] = from < to ? [from, to] : [to, from];
    const added: Record<string, boolean> = {};
    for (const row of rows.slice(start, end + 1)) {
        added[row.id] = true;
    }
    table.setRowSelection(previous => ({ ...(previous as Record<string, boolean>), ...added }));
    return true;
}

/**
 * Filtres propres au mode « sortie » (périmètre et état des trouvailles).
 *
 * Ils vivent dans la barre de filtres du tableau, pas dans le panneau latéral :
 * ce sont des filtres de liste, ils doivent rester atteignables panneau replié, et
 * se lire au même endroit que la recherche qu'ils complètent.
 */
const OutingTableFilters: React.FC<{
    hasScope: boolean;
    scopeSize: number;
    scopeOnly: boolean;
    onScopeOnlyChange: (value: boolean) => void;
    friendFilter: FriendFilter;
    onFriendFilterChange?: (filter: FriendFilter) => void;
    /** Faux si aucun ami n'est coché : les filtres d'état n'ont alors rien à dire. */
    hasFriends: boolean;
}> = props => {
    const missingFor = friendOfFilter(props.friendFilter);
    const setFilter = (filter: FriendFilter) => props.onFriendFilterChange?.(filter);
    // Sans ami coché le filtre ne s'applique pas (voir `filteredData`) : le bouton
    // ne doit pas s'afficher enfoncé, il annoncerait un tri qui n'a pas lieu.
    const stateButton = (filter: FriendFilter, label: string, title: string) => {
        const active = props.hasFriends && props.friendFilter === filter;
        return (
            <button
                className={`theia-button${active ? '' : ' secondary'}`}
                style={{ padding: '2px 8px' }}
                disabled={!props.hasFriends}
                title={props.hasFriends ? title : 'Cochez au moins un ami dans le panneau de sortie'}
                onClick={() => setFilter(active ? 'none' : filter)}
            >
                {label}
            </button>
        );
    };
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {props.hasScope && (
                <label
                    style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: '0.9em' }}
                    title="N'afficher que les caches retenues pour la sortie"
                >
                    <input
                        type='checkbox'
                        checked={props.scopeOnly}
                        onChange={event => props.onScopeOnlyChange(event.target.checked)}
                    />
                    Sortie seulement ({props.scopeSize})
                </label>
            )}
            {stateButton('nobody', 'Personne', "Caches qu'aucun ami de la sortie n'a trouvées")}
            {stateButton('everybody', 'Tous', 'Caches que tous les amis de la sortie ont trouvées')}
            {missingFor && (
                <span
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '2px 6px',
                        borderRadius: 10,
                        border: '1px solid var(--theia-panel-border)',
                        fontSize: '0.85em',
                    }}
                    title={`Seules les caches que ${missingFor} n'a pas trouvées sont affichées`}
                >
                    Manquantes pour {missingFor}
                    <button
                        className='theia-button secondary'
                        style={{ padding: '0 4px', margin: 0 }}
                        onClick={() => setFilter('none')}
                        title='Retirer ce filtre'
                    >
                        <span className='codicon codicon-close' />
                    </button>
                </span>
            )}
        </div>
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
    onAnalyzeWithAiSelected,
    analyzingWithAi = false,
    onExportGpxSelected,
    exportingGpx = false,
    onDelete,
    onRefresh,
    onMove,
    onCopy,
    onImportAround,
    zones = [],
    currentZoneId,
    visibleColumnIds,
    onVisibleColumnIdsChange,
    sorting: controlledSorting,
    onSortingChange: onSortingChangeProp,
    onFilteredDataChange,
    onSelectionChange,
    selectedGeocacheIds,
    friendFinds,
    friendScans,
    activeFriends,
    outingMode = false,
    outingGcCodes,
    friendFilter = 'none',
    onFriendFilterChange,
    onStartOutingWithSelection,
    onAddSelectionToOuting,
    outingFlags
}) => {
    // Tri contrôlé par le parent (persistance par zone) ou interne à défaut —
    // le même composant sert dans les deux configurations.
    const [internalSorting, setInternalSorting] = React.useState<SortingState>([]);
    const sorting = controlledSorting ?? internalSorting;
    const handleSortingChange = React.useCallback<OnChangeFn<SortingState>>(updater => {
        const next = typeof updater === 'function' ? updater(sorting) : updater;
        if (onSortingChangeProp) {
            onSortingChangeProp(next);
        } else {
            setInternalSorting(next);
        }
    }, [sorting, onSortingChangeProp]);
    const [rowSelection, setRowSelection] = React.useState({});
    const [globalFilter, setGlobalFilter] = React.useState('');
    // Le champ garde la frappe immédiate ; le filtrage (et la reconstruction des
    // marqueurs carte qui suit `onFilteredDataChange`) attend la fin de la
    // frappe — sinon chaque caractère refiltre les ~300 lignes et redessine la
    // carte.
    const SEARCH_DEBOUNCE_MS = 150;
    const [debouncedGlobalFilter, setDebouncedGlobalFilter] = React.useState('');
    React.useEffect(() => {
        const handle = window.setTimeout(() => setDebouncedGlobalFilter(globalFilter), SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(handle);
    }, [globalFilter]);
    const [contextMenu, setContextMenu] = React.useState<{ items: ContextMenuItem[]; x: number; y: number } | null>(null);
    const [moveDialog, setMoveDialog] = React.useState<Geocache | null>(null);
    const [copyDialog, setCopyDialog] = React.useState<Geocache | null>(null);
    const [columnsMenuOpen, setColumnsMenuOpen] = React.useState(false);
    const columnsMenuContainerRef = React.useRef<HTMLDivElement | null>(null);

    // Le menu Colonnes se ferme au clic à l'extérieur et à Échap — sans ça il
    // restait ouvert tant qu'on ne recliquait pas le bouton ou la croix.
    React.useEffect(() => {
        if (!columnsMenuOpen) {
            return;
        }
        const onPointerDown = (event: MouseEvent) => {
            const container = columnsMenuContainerRef.current;
            if (container && !container.contains(event.target as Node)) {
                setColumnsMenuOpen(false);
            }
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setColumnsMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [columnsMenuOpen]);

    const [draggedColumnId, setDraggedColumnId] = React.useState<GeocachesTableColumnId | null>(null);
    const [columnDragTarget, setColumnDragTarget] = React.useState<{ id: GeocachesTableColumnId; position: 'before' | 'after' } | null>(null);
    const [internalVisibleColumnIds, setInternalVisibleColumnIds] = React.useState<GeocachesTableColumnId[]>(() => [...DEFAULT_GEOCACHES_TABLE_VISIBLE_COLUMNS]);
    const [advancedClauses, setAdvancedClauses] = React.useState<AdvancedFilterClause[]>([]);
    // Ancre du Shift+clic : dernière ligne (dé)sélectionnée sans Shift. Une
    // sélection de plage part de cette ligne — elle survit aux changements de
    // tri/filtre tant que la ligne reste visible dans le rowModel courant.
    const rangeAnchorIdRef = React.useRef<string | null>(null);
    // Filtre rapide « caches de la sortie seulement » : un état d'affichage, au même
    // titre que la recherche — il vit avec le tableau, pas avec la sortie persistée.
    const [outingScopeOnly, setOutingScopeOnly] = React.useState(false);
    // Le périmètre, réduit aux caches réellement présentes : une sortie enregistrée
    // peut citer des caches supprimées depuis. Comme `outingScopeGcCodes()` côté
    // analyse, un périmètre dont plus rien ne subsiste retombe sur la zone entière —
    // le marqueur et le filtre doivent montrer ce que la sortie couvre vraiment.
    const outingScope = React.useMemo(() => {
        const wanted = new Set(outingMode ? outingGcCodes ?? [] : []);
        if (wanted.size === 0) {
            return new Set<string>();
        }
        return new Set(data.filter(row => wanted.has(row.gc_code)).map(row => row.gc_code));
    }, [outingMode, outingGcCodes, data]);
    // Un périmètre vide vaut « toute la zone » : il n'y a alors ni marqueur de ligne
    // ni filtre de périmètre à proposer.
    const hasOutingScope = outingScope.size > 0;
    React.useEffect(() => {
        if (!hasOutingScope) {
            setOutingScopeOnly(false);
        }
    }, [hasOutingScope]);
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
            // La colonne « 👥 » suit le mode, pas les préférences : en sortie elle est
            // la raison d'être de l'écran, hors sortie elle n'a aucune donnée à montrer
            // (les amis actifs viennent de la sortie).
            friends_found: outingMode,
        };
        for (const columnId of ALL_GEOCACHES_TABLE_COLUMN_IDS) {
            visibility[columnId] = visibleColumnSet.has(columnId);
        }
        return visibility;
    }, [visibleColumnSet, outingMode]);
    const columnOrder = React.useMemo<ColumnOrderState>(() => [
        'select',
        // Juste après les cases à cocher : la colonne des amis se lit sans faire
        // défiler le tableau, quel que soit l'ordre choisi pour les autres.
        ...(outingMode ? ['friends_found'] : []),
        ...activeVisibleColumnIds,
        ...ALL_GEOCACHES_TABLE_COLUMN_IDS.filter(columnId => !visibleColumnSet.has(columnId)),
        'actions',
    ], [activeVisibleColumnIds, visibleColumnSet, outingMode]);
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

    // --- États « amis » pour le code couleur des lignes ---
    // Pour chaque cache, on calcule un état parmi :
    //   - 'none'    : aucun ami actif ne l'a trouvée (vert clair — on peut y aller)
    //   - 'partial' : certains amis actifs l'ont trouvée (orange — certains déjà passés)
    //   - 'all'     : tous les amis actifs l'ont trouvée (gris — pas intéressant)
    //   - 'unknown' : pas assez de données pour au moins un ami (bordure pointillée)
    // Seuls les amis cochés dans la sortie comptent, et seulement en mode sortie :
    // couleurs de ligne, colonne « 👥 » et filtres d'état sont des lectures de
    // sortie. Hors mode, ou sans ami coché, la table reste neutre — le parent aurait
    // beau transmettre des amis actifs, ils n'ont rien à dire sur une zone qu'on
    // consulte simplement.
    const knownFriends = React.useMemo(
        () => (outingMode ? activeFriends ?? new Set<string>() : new Set<string>()),
        [outingMode, activeFriends]
    );

    /**
     * Qui, parmi les amis de la sortie, a trouvé cette cache.
     *
     * Sans ami coché, la question n'a pas de réponse utile : la colonne « 👥 » reste
     * vide plutôt que d'afficher les trouvailles d'amis qu'on n'emmène pas.
     */
    const findersOfOuting = React.useCallback(
        (gcCode: string): string[] => {
            const finders = friendFinds?.[gcCode] ?? [];
            return knownFriends.size === 0 ? [] : finders.filter(name => knownFriends.has(name));
        },
        [friendFinds, knownFriends]
    );

    const friendRowState = React.useMemo(() => {
        const map = new Map<string, 'none' | 'partial' | 'all' | 'unknown'>(); // gc_code -> état
        if (knownFriends.size === 0) { return map; }
        const scannedFriends = new Set<string>();
        if (friendScans) {
            for (const scan of friendScans) {
                if (scan.scanned) { scannedFriends.add(scan.friend); }
            }
        }
        for (const gc of data) {
            const finders = friendFinds?.[gc.gc_code] ?? [];
            const findersSet = new Set(finders);
            const total = knownFriends.size;
            const foundCount = finders.filter(f => knownFriends.has(f)).length;
            // Si au moins un ami scanné n'a pas de données pour cette cache,
            // c'est qu'elle n'était pas dans sa zone de scan → 'unknown'.
            const hasUnknown = Array.from(knownFriends).some(
                f => scannedFriends.has(f) && !findersSet.has(f) && (friendFinds?.[gc.gc_code] === undefined)
            );
            if (hasUnknown) {
                map.set(gc.gc_code, 'unknown');
            } else if (foundCount === 0) {
                map.set(gc.gc_code, 'none');
            } else if (foundCount >= total) {
                map.set(gc.gc_code, 'all');
            } else {
                map.set(gc.gc_code, 'partial');
            }
        }
        return map;
    }, [data, friendFinds, friendScans, knownFriends]);

    // Libellés pour le title des lignes.
    const friendRowTitle = React.useMemo(() => {
        const map = new Map<string, string>(); // gc_code -> title
        if (knownFriends.size === 0) { return map; }
        for (const gc of data) {
            const finders = friendFinds?.[gc.gc_code] ?? [];
            const found = finders.filter(f => knownFriends.has(f));
            const missing = Array.from(knownFriends).filter(f => !found.includes(f));
            const parts: string[] = [];
            if (found.length > 0) {
                parts.push(`Trouvée par ${found.join(', ')}`);
            }
            if (missing.length > 0) {
                parts.push(`Manquante pour ${missing.join(', ')}`);
            }
            if (parts.length > 0) {
                map.set(gc.gc_code, parts.join(' · '));
            }
        }
        return map;
    }, [data, friendFinds, knownFriends]);

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
                cell: ({ row, table }) => (
                    <input
                        type="checkbox"
                        checked={row.getIsSelected()}
                        disabled={!row.getCanSelect()}
                        // Hors ordre de tabulation : la ligne elle-même est
                        // focalisable et Espace fait la même chose — sinon Tab
                        // traverserait une case par ligne.
                        tabIndex={-1}
                        onChange={row.getToggleSelectedHandler()}
                        onClick={e => {
                            e.stopPropagation();
                            // Le clic sans Shift met à jour l'ancre puis laisse
                            // onChange basculer la case ; avec Shift on annule le
                            // toggle natif pour cocher toute la plage.
                            if (!e.shiftKey) {
                                rangeAnchorIdRef.current = row.id;
                                return;
                            }
                            e.preventDefault();
                            if (!rangeAnchorIdRef.current
                                || !selectRowRange(table, rangeAnchorIdRef.current, row.id)) {
                                row.toggleSelected();
                                rangeAnchorIdRef.current = row.id;
                            }
                        }}
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
                    const statusLabel = isArchived ? ' \u2014 Archivée' : isDisabled ? ' \u2014 Désactivée' : '';
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
                header: () => <span className='codicon codicon-heart' role='img' aria-label='Favoris' title='Favoris' />,
                cell: info => <span title="Favoris">{info.getValue() as number}</span>,
                size: 50,
            },
            {
                id: 'favorites_percent',
                accessorFn: row => favoritePercent(row).value,
                header: '%PF',
                cell: ({ row }) => {
                    const hint = favoritePercentHint(row.original);
                    return (
                        <span title={hint || 'Part des trouvailles qui ont donné un point favori'}>
                            {formatFavoritePercent(row.original)}
                        </span>
                    );
                },
                size: 70,
            },
            {
                accessorKey: 'owner',
                header: 'Propriétaire',
                cell: info => <span className="geoapp-gc-cell-owner">{info.getValue() as string || '-'}</span>,
                size: 150,
            },
            {
                accessorKey: 'finds_count',
                header: 'Trouvailles',
                cell: info => {
                    const finds = info.getValue() as number | undefined;
                    // NULL ≠ 0 : une cache pas encore re-scrapée n'a pas de compteur,
                    // et afficher « 0 » la ferait passer pour jamais trouvée.
                    return typeof finds === 'number'
                        ? <span title="Found it annoncés par Geocaching.com">{finds}</span>
                        : <span style={{ opacity: 0.35 }} title="Inconnu : rafraîchir la cache renseignera le compteur">—</span>;
                },
                size: 90,
            },
            {
                id: 'friends_found',
                accessorFn: row => findersOfOuting((row as Geocache).gc_code).length,
                header: () => <span className='codicon codicon-organization' role='img' aria-label='Trouvée par des amis' title='Trouvée par des amis' />,
                cell: ({ row }) => {
                    const names = findersOfOuting((row.original as Geocache).gc_code);
                    if (names.length === 0) {
                        return <span style={{ opacity: 0.35 }}>—</span>;
                    }
                    // Puces d'initiales : bien plus lisible qu'un simple nombre,
                    // et le survol donne le pseudo complet. La couleur est celle de
                    // l'ami dans tout le mode sortie (panneau compris).
                    const maxVisible = 3;
                    const visible = names.slice(0, maxVisible);
                    const extra = names.length - visible.length;
                    return (
                        <span
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 2,
                                flexWrap: 'wrap',
                                cursor: 'help',
                            }}
                            title={`Trouvée par : ${names.join(', ')}`}
                        >
                            {visible.map(name => (
                                <span
                                    key={name}
                                    title={name}
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        minWidth: 18,
                                        height: 18,
                                        borderRadius: 9,
                                        padding: '0 4px',
                                        fontSize: '0.7em',
                                        fontWeight: 'bold',
                                        backgroundColor: friendColor(name),
                                        color: 'white',
                                    }}
                                >
                                    {name.charAt(0).toUpperCase()}
                                </span>
                            ))}
                            {extra > 0 && (
                                <span style={{ fontSize: '0.7em', opacity: 0.6 }}>
                                    +{extra}
                                </span>
                            )}
                        </span>
                    );
                },
                size: 80,
            },
            {
                id: 'outing_flags',
                // Le tri se fait sur le nombre de signaux : les caches qui demandent une
                // préparation remontent, ce qui est la seule question que pose la colonne.
                accessorFn: row => (outingFlags?.[(row as Geocache).gc_code]?.flags ?? []).length,
                header: () => <span className='codicon codicon-flag' role='img' aria-label='Signaux de sortie' title='Signaux de sortie' />,
                cell: ({ row }) => {
                    const entry = outingFlags?.[(row.original as Geocache).gc_code];
                    const badges = badgesForFlags(entry?.flags);
                    if (!entry || badges.length === 0) {
                        return <span style={{ opacity: 0.35 }}>—</span>;
                    }
                    const duration = formatOutingMinutes(entry.minutes);
                    const gear = entry.gear.length > 0 ? ` — ${entry.gear.join(', ')}` : '';
                    const origin = `Analyse du ${entry.outing_date}`
                        + `${entry.zone_name ? ` (${entry.zone_name})` : ''}`;
                    return (
                        <span
                            className="geoapp-outing-badges-cell"
                            title={`${badges.map(badge => badge.label).join(' · ')}`
                                + `${gear}${duration ? ` — ${duration}` : ''}
${origin}`}
                        >
                            {badges.map(badge => (
                                <span
                                    key={badge.label}
                                    className={`geoapp-outing-badge severity-${badge.severity}`}
                                >
                                    {badge.short}
                                </span>
                            ))}
                        </span>
                    );
                },
                size: 90,
            },
            {
                id: 'status',
                accessorFn: row => (row as Geocache).status ?? 'active',
                header: 'Statut',
                cell: ({ row }) => {
                    const status = (row.original as Geocache).status ?? 'active';
                    if (status === 'archived') {
                        return <span className="geoapp-gc-badge--archived"><span className='codicon codicon-circle-slash' aria-hidden='true' /> Archivée</span>;
                    }
                    if (status === 'disabled') {
                        return <span className="geoapp-gc-badge--disabled"><span className='codicon codicon-warning' aria-hidden='true' /> Désactivée</span>;
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
                            <span className='codicon codicon-wrench' aria-hidden='true' /> Maint.
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
                                // Hors ordre de tabulation : la navigation
                                // clavier se fait par ligne, les actions sont
                                // dans la barre de sélection.
                                tabIndex={-1}
                                title="Rafraîchir cette géocache"
                                aria-label="Rafraîchir cette géocache"
                                style={{ padding: '2px 6px', fontSize: '0.85em' }}
                            >
                                <span className='codicon codicon-refresh' aria-hidden="true" />
                            </button>
                        )}
                        {onDelete && (
                            <button
                                onClick={() => onDelete(row.original)}
                                className="theia-button secondary"
                                tabIndex={-1}
                                title="Supprimer cette géocache"
                                aria-label="Supprimer cette géocache"
                                style={{ padding: '2px 6px', fontSize: '0.85em', color: 'var(--theia-errorForeground)' }}
                            >
                                <span className='codicon codicon-trash' aria-hidden="true" />
                            </button>
                        )}
                    </div>
                ),
                size: 100,
            },
        ],
        // `friendFinds` et `outingFlags` sont capturés par les colonnes « Amis » et
        // « Sortie » : sans ces dépendances, elles resteraient figées sur la valeur
        // initiale, c'est-à-dire vides jusqu'au prochain remontage de la table.
        // `findersOfOuting` l'est aussi : décocher un ami doit vider ses puces.
        [friendFinds, findersOfOuting, outingFlags]
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
        map.set('status', ['active', 'disabled', 'archived']);
        map.set('found', ['true', 'false']);
        return map;
    }, [cacheTypes, sizes, solvedOptions]);

    // « Trouvées cette année » est dynamique : la borne est recalculée à
    // chaque montage du tableau.
    const filterPresets = React.useMemo<FilterPreset[]>(() => [
        ...ZONE_FILTER_PRESETS,
        { id: 'found-this-year', label: 'Trouvées cette année', searchQuery: `@decouverte:>=${new Date().getFullYear()}` },
    ], []);

    const filteredData = React.useMemo(() => {
        const { freeText, tokenFilters } = parseSearchQuery(debouncedGlobalFilter);
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
                    geocache.owner ?? '',
                    geocache.size,
                    geocache.status ?? '',
                    geocache.coordinates_raw ?? ''
                    // `solved` est volontairement exclu : `not_solved` contient
                    // `solved`, chercher « solved » retournerait aussi les
                    // caches non résolues.
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
            // Filtre rapide « caches de la sortie seulement ».
            if (outingScopeOnly && !outingScope.has(geocache.gc_code)) {
                return false;
            }
            // Filtres « amis » du mode sortie. Ils lisent l'état de ligne déjà
            // calculé (`none` / `all`), donc les mêmes amis que le code couleur :
            // ce que le filtre garde est exactement ce que la couleur annonce.
            // Sans ami coché il n'y a rien à filtrer — sinon le tableau se viderait
            // sans que rien à l'écran n'explique pourquoi.
            if (outingMode && knownFriends.size > 0) {
                const missingFor = friendOfFilter(friendFilter);
                if (missingFor) {
                    if ((friendFinds?.[geocache.gc_code] ?? []).includes(missingFor)) {
                        return false;
                    }
                } else if (friendFilter === 'nobody' && friendRowState.get(geocache.gc_code) !== 'none') {
                    return false;
                } else if (friendFilter === 'everybody' && friendRowState.get(geocache.gc_code) !== 'all') {
                    return false;
                }
            }
            return true;
        });
    }, [
        data, debouncedGlobalFilter, advancedClauses, friendFinds,
        outingMode, outingScopeOnly, outingScope, friendFilter, friendRowState, knownFriends,
    ]);

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
        onSortingChange: handleSortingChange,
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

    // Applique une sélection venue de la carte. La comparaison porte sur la
    // sélection *visible* (celle que l'effet ci-dessus vient de remonter), sinon
    // le retour de la carte relancerait l'effet en boucle. Les lignes cochées puis
    // masquées par un filtre sont préservées : elles réapparaissent cochées quand
    // le filtre est levé.
    React.useEffect(() => {
        if (!selectedGeocacheIds) {
            return;
        }
        const desired = new Set(selectedGeocacheIds.map(String));
        if (selectedIds.length === desired.size && selectedIds.every(id => desired.has(String(id)))) {
            return;
        }
        const visibleKeys = new Set(filteredData.map(geocache => String(geocache.id)));
        const next: Record<string, boolean> = {};
        for (const [key, checked] of Object.entries(rowSelection as Record<string, boolean>)) {
            if (checked && !visibleKeys.has(key)) {
                next[key] = true; // cochée, mais masquée par le filtre courant
            }
        }
        desired.forEach(key => { next[key] = true; });
        setRowSelection(next);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedGeocacheIds]);

    const tableScrollRef = React.useRef<HTMLDivElement>(null);
    // Ligne focalisée au clavier (roving tabindex : une seule ligne est dans
    // l'ordre de tabulation). Conservée par id pour survivre au tri/filtrage.
    const [focusedRowId, setFocusedRowId] = React.useState<string | null>(null);

    const tableRows = table.getRowModel().rows;
    const { startIndex, endIndex, paddingTop, paddingBottom } = useRowVirtualizer(tableRows.length, tableScrollRef);
    const virtualRows = tableRows.slice(startIndex, endIndex);
    const visibleColumnCount = table.getVisibleLeafColumns().length;
    // Roving tabindex : la ligne focalisée est le seul arrêt de Tab dans le
    // tableau ; si elle n'est pas rendue (scroll, filtre), la première ligne
    // visible prend le relais pour que le tableau reste atteignable.
    const tabbableRowId = (focusedRowId && virtualRows.some(row => row.id === focusedRowId))
        ? focusedRowId
        : virtualRows[0]?.id;

    /**
     * Amène la ligne `index` dans la zone visible (défilement minimal, façon
     * `scrollIntoView({ block: 'nearest' })` — nécessaire car la virtualisation
     * ne rend que les lignes visibles : sans scroll, la ligne cible n'existe
     * pas dans le DOM et ne peut pas recevoir le focus).
     */
    const scrollRowIntoView = (index: number): void => {
        const el = tableScrollRef.current;
        if (!el) {
            return;
        }
        const top = index * VIRTUAL_ROW_HEIGHT;
        const bottom = top + VIRTUAL_ROW_HEIGHT;
        if (top < el.scrollTop) {
            el.scrollTop = top;
        } else if (bottom > el.scrollTop + el.clientHeight) {
            el.scrollTop = bottom - el.clientHeight;
        }
    };

    // Après un déplacement clavier, la ligne cible peut n'exister qu'au rendu
    // suivant (virtualisation) : on la focalise dès qu'elle est dans le DOM,
    // tant que le focus n'a pas quitté le tableau.
    React.useEffect(() => {
        if (!focusedRowId) {
            return;
        }
        const scrollEl = tableScrollRef.current;
        if (!scrollEl || !scrollEl.contains(document.activeElement)) {
            return;
        }
        const rowEl = scrollEl.querySelector<HTMLElement>(`tr[data-row-id="${focusedRowId}"]`);
        if (rowEl && document.activeElement !== rowEl) {
            rowEl.focus();
        }
    });

    /**
     * Navigation clavier sur les lignes :
     *   ↑ / ↓ / Début / Fin  déplacent le focus (Maj étend la sélection),
     *   Espace               coche/décoche la ligne focalisée,
     *   Entrée               ouvre la fiche de la géocache,
     *   Ctrl/Cmd+A           coche ou décoche toutes les lignes.
     * Les contrôles natifs dans les cellules (cases, boutons) gardent leurs
     * propres touches : seules les flèches leur sont « empruntées » pour
     * ramener le focus sur la ligne.
     */
    const handleTableKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
        if (event.defaultPrevented || tableRows.length === 0) {
            return;
        }
        const target = event.target as HTMLElement;
        const onNativeControl = target instanceof HTMLInputElement || target instanceof HTMLButtonElement;
        const currentIndex = tableRows.findIndex(row => row.id === focusedRowId);

        const moveFocus = (nextIndex: number, extendSelection: boolean): void => {
            const clamped = Math.max(0, Math.min(tableRows.length - 1, nextIndex));
            const nextRow = tableRows[clamped];
            if (!nextRow) {
                return;
            }
            if (extendSelection && focusedRowId && focusedRowId !== nextRow.id) {
                // Point de départ de l'extension : la ligne focalisée quand Maj
                // a été pressé — sans ancre existante, c'est elle qui l'est.
                if (!rangeAnchorIdRef.current) {
                    rangeAnchorIdRef.current = focusedRowId;
                }
                selectRowRange(table, rangeAnchorIdRef.current, nextRow.id);
            }
            setFocusedRowId(nextRow.id);
            scrollRowIntoView(clamped);
        };

        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                moveFocus(currentIndex < 0 ? 0 : currentIndex + 1, event.shiftKey);
                return;
            case 'ArrowUp':
                event.preventDefault();
                moveFocus(currentIndex < 0 ? 0 : currentIndex - 1, event.shiftKey);
                return;
            case 'Home':
                event.preventDefault();
                moveFocus(0, event.shiftKey);
                return;
            case 'End':
                event.preventDefault();
                moveFocus(tableRows.length - 1, event.shiftKey);
                return;
            case ' ':
                if (onNativeControl || currentIndex < 0) {
                    return;
                }
                event.preventDefault();
                tableRows[currentIndex].toggleSelected();
                rangeAnchorIdRef.current = tableRows[currentIndex].id;
                return;
            case 'Enter':
                if (onNativeControl || currentIndex < 0) {
                    return;
                }
                event.preventDefault();
                onRowClick?.(tableRows[currentIndex].original);
                return;
            default:
                if ((event.ctrlKey || event.metaKey) && (event.key === 'a' || event.key === 'A') && !onNativeControl) {
                    event.preventDefault();
                    table.toggleAllRowsSelected();
                }
        }
    };

    const showContextMenu = (geocache: Geocache, event: React.MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();

        const items: ContextMenuItem[] = [
            {
                label: 'Ouvrir',
                iconClass: 'codicon codicon-book',
                action: () => onRowClick?.(geocache)
            },
            {
                label: 'Rafraîchir',
                iconClass: 'codicon codicon-refresh',
                action: () => onRefresh?.(geocache.id)
            }
        ];

        // Ajouter l'option de déplacement si disponible
        if (onMove && zones.length > 1 && currentZoneId) {
            items.push({
                label: 'Déplacer vers...',
                iconClass: 'codicon codicon-move',
                action: () => setMoveDialog(geocache)
            });
        }

        // Ajouter l'option de copie si disponible
        if (onCopy && zones.length > 1 && currentZoneId) {
            items.push({
                label: 'Copier vers...',
                iconClass: 'codicon codicon-copy',
                action: () => setCopyDialog(geocache)
            });
        }

        if (onImportAround) {
            items.push({
                label: 'Importer autour…',
                iconClass: 'codicon codicon-location',
                action: () => onImportAround(geocache)
            });
        }

        items.push({ separator: true });
        items.push({
            label: 'Supprimer',
            iconClass: 'codicon codicon-trash',
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
                        fieldDefinitions={ZONE_GEOCACHE_FIELD_DEFINITIONS}
                        enumOptionsByField={enumOptionsByField}
                        presets={filterPresets}
                        resultCount={filteredData.length}
                    />
                    <div ref={columnsMenuContainerRef} style={{ position: 'relative' }}>
                        <button
                            onClick={() => setColumnsMenuOpen(open => !open)}
                            aria-expanded={columnsMenuOpen}
                            aria-haspopup="dialog"
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
                                        aria-label="Fermer le menu des colonnes"
                                    >
                                        <span className="codicon codicon-close" />
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
                    {outingMode && (
                        <OutingTableFilters
                            hasScope={hasOutingScope}
                            scopeSize={outingScope.size}
                            scopeOnly={outingScopeOnly}
                            onScopeOnlyChange={setOutingScopeOnly}
                            friendFilter={friendFilter}
                            onFriendFilterChange={onFriendFilterChange}
                            hasFriends={knownFriends.size > 0}
                        />
                    )}
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
                                    <span className="geoapp-gc-action-btn__icon codicon codicon-edit" aria-hidden="true" />
                                    Loguer
                                </button>
                            )}
                            {onApplyPluginSelected && (
                                <button
                                    onClick={() => onApplyPluginSelected(selectedIds)}
                                    className="geoapp-gc-action-btn geoapp-gc-action-btn--primary"
                                    title="Appliquer un plugin aux géocaches sélectionnées"
                                >
                                    <span className="geoapp-gc-action-btn__icon codicon codicon-extensions" aria-hidden="true" />
                                    Plugin
                                </button>
                            )}
                            {onAnalyzeWithAiSelected && (
                                <button
                                    onClick={() => onAnalyzeWithAiSelected(selectedIds)}
                                    className="geoapp-gc-action-btn geoapp-gc-action-btn--primary"
                                    disabled={analyzingWithAi}
                                    aria-busy={analyzingWithAi}
                                    title="Analyser la sélection avec l'IA (préparation de sortie : matériel, temps, alertes)"
                                >
                                    {analyzingWithAi ? (
                                        <span className="geoapp-gc-action-btn__spinner" aria-hidden="true" />
                                    ) : (
                                        <span className="geoapp-gc-action-btn__icon codicon codicon-sparkle" aria-hidden="true" />
                                    )}
                                    {analyzingWithAi ? 'Analyse en cours…' : 'Analyser IA'}
                                </button>
                            )}
                            {/* Le même bouton ouvre une sortie puis l'alimente :
                                hors mode, la sélection devient le périmètre d'une
                                nouvelle sortie ; en mode, elle s'y ajoute. C'est le
                                seul chemin de la sélection vers la sortie — cocher
                                une ligne ne change rien par elle-même. */}
                            {outingMode ? (
                                onAddSelectionToOuting && (
                                    <button
                                        onClick={() => onAddSelectionToOuting(selectedIds)}
                                        className="geoapp-gc-action-btn geoapp-gc-action-btn--primary"
                                        title="Ajouter les géocaches sélectionnées au périmètre de la sortie"
                                    >
                                        <span className="geoapp-gc-action-btn__icon codicon codicon-organization" aria-hidden="true" />
                                        Ajouter à la sortie
                                    </button>
                                )
                            ) : (
                                onStartOutingWithSelection && (
                                    <button
                                        onClick={() => onStartOutingWithSelection(selectedIds)}
                                        className="geoapp-gc-action-btn geoapp-gc-action-btn--primary"
                                        title="Préparer une sortie entre amis sur les géocaches sélectionnées"
                                    >
                                        <span className="geoapp-gc-action-btn__icon codicon codicon-organization" aria-hidden="true" />
                                        Sortie
                                    </button>
                                )
                            )}
                            {onExportGpxSelected && (
                                <button
                                    onClick={() => onExportGpxSelected(selectedIds)}
                                    className="geoapp-gc-action-btn"
                                    disabled={exportingGpx}
                                    aria-busy={exportingGpx}
                                    title={exportingGpx
                                        ? 'Génération du fichier GPX en cours…'
                                        : 'Exporter les géocaches sélectionnées au format GPX'}
                                >
                                    {exportingGpx ? (
                                        <span className="geoapp-gc-action-btn__spinner" aria-hidden="true" />
                                    ) : (
                                        <span className="geoapp-gc-action-btn__icon codicon codicon-export" aria-hidden="true" />
                                    )}
                                    {exportingGpx ? 'Export en cours…' : 'Exporter GPX'}
                                </button>
                            )}
                            {onRefreshSelected && (
                                <button
                                    onClick={() => onRefreshSelected(selectedIds)}
                                    className="geoapp-gc-action-btn"
                                    title="Rafraîchir les géocaches sélectionnées"
                                >
                                    <span className="geoapp-gc-action-btn__icon codicon codicon-refresh" aria-hidden="true" />
                                    Rafraîchir
                                </button>
                            )}
                            {onCopySelected && zones.length > 1 && (
                                <button
                                    onClick={() => onCopySelected(selectedIds)}
                                    className="geoapp-gc-action-btn"
                                    title="Copier les géocaches sélectionnées vers une autre zone"
                                >
                                    <span className="geoapp-gc-action-btn__icon codicon codicon-copy" aria-hidden="true" />
                                    Copier
                                </button>
                            )}
                            {onMoveSelected && zones.length > 1 && (
                                <button
                                    onClick={() => onMoveSelected(selectedIds)}
                                    className="geoapp-gc-action-btn"
                                    title="Déplacer les géocaches sélectionnées vers une autre zone"
                                >
                                    <span className="geoapp-gc-action-btn__icon codicon codicon-move" aria-hidden="true" />
                                    Déplacer
                                </button>
                            )}
                            {onDeleteSelected && (
                                <button
                                    onClick={() => onDeleteSelected(selectedIds)}
                                    className="geoapp-gc-action-btn geoapp-gc-action-btn--danger"
                                    title="Supprimer les géocaches sélectionnées"
                                >
                                    <span className="geoapp-gc-action-btn__icon codicon codicon-trash" aria-hidden="true" />
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
                onKeyDown={handleTableKeyDown}
                style={{ ['--geoapp-gc-row-height' as string]: `${VIRTUAL_ROW_HEIGHT}px` } as React.CSSProperties}
            >
                <table className="geoapp-gc-table" aria-label='Géocaches de la zone'>
                    <thead>
                        {table.getHeaderGroups().map(headerGroup => (
                            <tr key={headerGroup.id}>
                                {headerGroup.headers.map(header => (
                                    <th
                                        key={header.id}
                                        className={header.column.getCanSort() ? 'geoapp-gc-table__th geoapp-gc-table__th--sortable' : 'geoapp-gc-table__th'}
                                        onClick={header.column.getToggleSortingHandler()}
                                        onKeyDown={header.column.getCanSort() ? event => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                header.column.getToggleSortingHandler()?.(event);
                                            }
                                        } : undefined}
                                        tabIndex={header.column.getCanSort() ? 0 : undefined}
                                        aria-sort={!header.column.getCanSort() ? undefined
                                            : header.column.getIsSorted() === 'asc' ? 'ascending'
                                            : header.column.getIsSorted() === 'desc' ? 'descending'
                                            : 'none'}
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
                                data-row-id={row.id}
                                tabIndex={row.id === tabbableRowId ? 0 : -1}
                                // Clic simple : bascule immédiate (pas de debounce —
                                // les deux clics d'un double-clic s'annulent avant
                                // l'ouverture). Ctrl+clic suit le même chemin.
                                // Shift+clic : coche la plage depuis l'ancre.
                                onClick={e => {
                                    // La ligne prend le focus : les flèches
                                    // repartent d'ici, pas du haut du tableau.
                                    e.currentTarget.focus();
                                    setFocusedRowId(row.id);
                                    if (e.shiftKey && rangeAnchorIdRef.current
                                        && selectRowRange(table, rangeAnchorIdRef.current, row.id)) {
                                        return;
                                    }
                                    row.toggleSelected();
                                    rangeAnchorIdRef.current = row.id;
                                }}
                                onDoubleClick={() => onRowClick?.(row.original)}
                                aria-selected={row.getIsSelected()}
                                onContextMenu={(e) => showContextMenu(row.original, e)}
                                className={
                                    (row.getIsSelected()
                                        ? 'geoapp-gc-table__row geoapp-gc-table__row--selected'
                                        : 'geoapp-gc-table__row')
                                    + (friendRowState.get(row.original.gc_code)
                                        ? ` geoapp-gc-table__row--friends-${friendRowState.get(row.original.gc_code)}`
                                        : '')
                                    // Le tableau montre toute la zone : un liseré
                                    // discret dit lesquelles sont dans la sortie.
                                    + (hasOutingScope && outingScope.has(row.original.gc_code)
                                        ? ' geoapp-gc-table__row--outing'
                                        : '')
                                }
                                title={friendRowTitle.get(row.original.gc_code) ?? undefined}
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
