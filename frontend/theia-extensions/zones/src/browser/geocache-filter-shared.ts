
export type FilterField =
    | 'gc_code'
    | 'name'
    | 'owner'
    | 'cache_type'
    | 'difficulty'
    | 'terrain'
    | 'size'
    | 'solved'
    | 'found'
    | 'favorites_count'
    | 'favorites_percent'
    | 'finds_count'
    | 'status'
    | 'is_corrected'
    | 'has_notes'
    | 'need_maintenance'
    | 'placed_at'
    | 'created_at'
    | 'found_date'
    | 'logs_count'
    | 'logs_total_available'
    | 'waypoints_count'
    | 'distance_km';

export type AdvancedOperator =
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

export interface AdvancedFilterClause {
    id: string;
    field: string;
    operator: AdvancedOperator;
    value: string;
    value2?: string;
    values?: string[];
}

export interface TokenFilter {
    field: string;
    operator: AdvancedOperator;
    value?: string;
    value2?: string;
    values?: string[];
}

export interface AutocompleteSuggestion {
    id: string;
    label: string;
    insertText: string;
}

/**
 * Filtre prédéfini appliqué en un clic depuis la barre de filtres.
 *
 * `searchQuery` remplace le contenu du champ de recherche (tokens `@champ:…`
 * inclus) ; `clauses` remplace les clauses avancées — l'id est régénéré à
 * l'application, les presets ne portent donc que la clause utile.
 */
export interface FilterPreset {
    id: string;
    label: string;
    searchQuery?: string;
    clauses?: Array<Omit<AdvancedFilterClause, 'id'>>;
}

export interface FieldDefinition {
    field: string;
    label: string;
    kind: 'text' | 'number' | 'enum' | 'boolean' | 'date';
}

/**
 * Champs filtrables connus de l'import « autour » : le backend les applique par
 * `getattr` sur les résultats de l'API geocaching.com. Un champ absent de ces
 * résultats (notes, logs locaux, dates d'import…) exclurait silencieusement
 * toutes les candidates — ces champs-là restent propres à la liste de zone.
 */
export const STANDARD_GEOCACHE_FIELD_DEFINITIONS: FieldDefinition[] = [
    { field: 'gc_code', label: 'Code GC', kind: 'text' },
    { field: 'name', label: 'Nom', kind: 'text' },
    { field: 'owner', label: 'Propriétaire', kind: 'text' },
    { field: 'cache_type', label: 'Type', kind: 'enum' },
    { field: 'difficulty', label: 'Difficulté', kind: 'number' },
    { field: 'terrain', label: 'Terrain', kind: 'number' },
    { field: 'size', label: 'Taille', kind: 'enum' },
    { field: 'solved', label: 'Résolution', kind: 'enum' },
    { field: 'found', label: 'Trouvée', kind: 'boolean' },
    { field: 'favorites_count', label: 'Favoris', kind: 'number' },
];

/**
 * Champs proposés par la table des géocaches d'une zone : les champs standard
 * plus ceux qui n'existent que dans la base locale (statut, notes, waypoints,
 * dates, compteurs de logs et de trouvailles).
 */
export const ZONE_GEOCACHE_FIELD_DEFINITIONS: FieldDefinition[] = [
    ...STANDARD_GEOCACHE_FIELD_DEFINITIONS,
    { field: 'status', label: 'Statut', kind: 'enum' },
    { field: 'is_corrected', label: 'Coordonnées corrigées', kind: 'boolean' },
    { field: 'has_notes', label: 'Notes', kind: 'boolean' },
    { field: 'need_maintenance', label: 'Maintenance demandée', kind: 'boolean' },
    { field: 'placed_at', label: 'Posée le', kind: 'date' },
    { field: 'found_date', label: 'Découverte le', kind: 'date' },
    { field: 'created_at', label: 'Ajoutée le', kind: 'date' },
    { field: 'logs_count', label: 'Logs (local)', kind: 'number' },
    { field: 'logs_total_available', label: 'Logs sur GC.com', kind: 'number' },
    { field: 'waypoints_count', label: 'Waypoints', kind: 'number' },
    { field: 'finds_count', label: 'Trouvailles', kind: 'number' },
    { field: 'favorites_percent', label: '% favoris', kind: 'number' },
];

/** Champs comparés numériquement (`@diff:>=3`, `@logs:10<>20`…). */
export const NUMERIC_GEOCACHE_FIELDS: ReadonlySet<string> = new Set([
    'difficulty', 'terrain', 'favorites_count', 'favorites_percent', 'finds_count',
    'logs_count', 'logs_total_available', 'waypoints_count', 'distance_km',
]);

/** Champs à valeur booléenne, filtrés par l'opérateur `is` (`@found:true`). */
export const BOOLEAN_GEOCACHE_FIELDS: ReadonlySet<string> = new Set([
    'found', 'is_corrected', 'has_notes', 'need_maintenance',
]);

/** Champs date, comparés par préfixe ISO (`@placed:>=2020`, année ou année-mois acceptées). */
export const DATE_GEOCACHE_FIELDS: ReadonlySet<string> = new Set([
    'placed_at', 'created_at', 'found_date',
]);

/** Champs à valeur dans une liste fermée (`@type:traditional,mystery`). */
export const ENUM_GEOCACHE_FIELDS: ReadonlySet<string> = new Set([
    'cache_type', 'size', 'solved', 'status',
]);

export const DISTANCE_KM_FIELD_DEFINITION: FieldDefinition = {
    field: 'distance_km',
    label: 'Distance (km)',
    kind: 'number',
};

/**
 * Normalise une valeur pour la recherche : minuscules et suppression des accents
 * (décomposition NFD puis retrait des diacritiques). Toutes les comparaisons
 * texte des filtres passent par ici afin d'être insensibles casse/accents.
 */
const DIACRITICS_REGEXP = new RegExp('[\\u0300-\\u036f]', 'g');

export function normalizeSearchText(value: unknown): string {
    return (value ?? '')
        .toString()
        .normalize('NFD')
        .replace(DIACRITICS_REGEXP, '')
        .toLowerCase();
}

const WILDCARD_REGEXP_CACHE = new Map<string, RegExp>();
const WILDCARD_REGEXP_CACHE_MAX = 200;

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getWildcardRegExp(normalizedPattern: string, mode: 'contains' | 'equals'): RegExp {
    const key = `${mode}\u0000${normalizedPattern}`;
    const cached = WILDCARD_REGEXP_CACHE.get(key);
    if (cached) {
        return cached;
    }
    const source = normalizedPattern
        .split('*')
        .map(escapeRegExp)
        .join('.*');
    const regexp = new RegExp(mode === 'equals' ? `^${source}$` : source);
    if (WILDCARD_REGEXP_CACHE.size >= WILDCARD_REGEXP_CACHE_MAX) {
        WILDCARD_REGEXP_CACHE.clear();
    }
    WILDCARD_REGEXP_CACHE.set(key, regexp);
    return regexp;
}

/**
 * Compare une valeur à un motif de recherche, sans tenir compte de la casse ni
 * des accents. Le caractère `*` sert de joker et remplace zéro, un ou plusieurs
 * caractères (ex. `gr*tte` trouve « grotte » et « grande grotte »).
 *
 * @param mode `contains` = le motif peut apparaître n'importe où dans la valeur,
 *             `equals` = le motif doit couvrir toute la valeur.
 */
export function matchesSearchPattern(actual: unknown, pattern: string, mode: 'contains' | 'equals'): boolean {
    const normalizedActual = normalizeSearchText(actual);
    const normalizedPattern = normalizeSearchText(pattern);
    if (!normalizedPattern) {
        return mode === 'contains' ? true : normalizedActual === '';
    }
    if (!normalizedPattern.includes('*')) {
        return mode === 'contains'
            ? normalizedActual.includes(normalizedPattern)
            : normalizedActual === normalizedPattern;
    }
    return getWildcardRegExp(normalizedPattern, mode).test(normalizedActual);
}

export function findAutocompleteTokenStart(beforeCaret: string): number | null {
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

export function normalizeFieldAlias(raw: string): string | null {
    // `normalizeSearchText` (minuscules + sans accents) permet de saisir les
    // alias français accentués : `@état:`, `@corrigée:`, `@posée:`…
    const key = normalizeSearchText(raw.trim());
    if (!key) {
        return null;
    }
    const map: Record<string, string> = {
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
        resolution: 'solved',
        resolved: 'solved',
        // `status` désigne le statut de la cache (active/disabled/archived) ;
        // la résolution reste sous `solved`/`resolution`/`resolved`.
        status: 'status',
        statut: 'status',
        etat: 'status',
        found: 'found',
        corrected: 'is_corrected',
        corrigee: 'is_corrected',
        corr: 'is_corrected',
        is_corrected: 'is_corrected',
        notes: 'has_notes',
        note: 'has_notes',
        has_notes: 'has_notes',
        maintenance: 'need_maintenance',
        maint: 'need_maintenance',
        need_maintenance: 'need_maintenance',
        favorites: 'favorites_count',
        fav: 'favorites_count',
        favorites_count: 'favorites_count',
        // `@fav` compte les points favoris, `@pf` en donne la part : deux
        // questions distinctes, deux tokens distincts.
        pf: 'favorites_percent',
        fav_percent: 'favorites_percent',
        favorites_percent: 'favorites_percent',
        finds: 'finds_count',
        finds_count: 'finds_count',
        trouvailles: 'finds_count',
        logs: 'logs_count',
        logs_count: 'logs_count',
        logs_total: 'logs_total_available',
        logs_total_available: 'logs_total_available',
        waypoints: 'waypoints_count',
        wp: 'waypoints_count',
        wpts: 'waypoints_count',
        waypoints_count: 'waypoints_count',
        placed: 'placed_at',
        posee: 'placed_at',
        hidden: 'placed_at',
        placed_at: 'placed_at',
        created: 'created_at',
        added: 'created_at',
        ajoutee: 'created_at',
        created_at: 'created_at',
        found_date: 'found_date',
        decouverte: 'found_date',
        distance: 'distance_km',
        dist: 'distance_km',
        distance_km: 'distance_km',
        rayon: 'distance_km',
        radius: 'distance_km',
    };
    return map[key] ?? null;
}

export function parseSearchQuery(input: string): { freeText: string; tokenFilters: TokenFilter[] } {
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

/**
 * Opérande d'un filtre date : année (`2020`), année-mois (`2020-05`) ou date
 * ISO complète (`2020-05-17`). La granularité choisie fixe la longueur du
 * préfixe comparé dans `matchesClause`.
 */
const DATE_OPERAND_REGEXP = /^\d{4}(-\d{2}(-\d{2})?)?$/;

export function parseTokenExpression(field: string, exprRaw: string): TokenFilter | null {
    const expr = (exprRaw ?? '').trim();
    if (!expr) {
        return null;
    }

    const isNumericField = NUMERIC_GEOCACHE_FIELDS.has(field);

    if (isNumericField) {
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

    if (BOOLEAN_GEOCACHE_FIELDS.has(field)) {
        const v = expr.toLowerCase();
        if (v === 'true' || v === '1' || v === 'yes' || v === 'oui' || v === 'found') {
            return { field, operator: 'is', value: 'true' };
        }
        if (v === 'false' || v === '0' || v === 'no' || v === 'non' || v === 'notfound') {
            return { field, operator: 'is', value: 'false' };
        }
        return null;
    }

    if (ENUM_GEOCACHE_FIELDS.has(field)) {
        const list = expr
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
        if (list.length > 1) {
            return { field, operator: 'in', values: list };
        }
        return { field, operator: 'eq', value: expr };
    }

    // Dates : mêmes opérateurs que les numériques, mais l'opérande est une
    // année (`2020`), une année-mois (`2020-05`) ou une date ISO complète —
    // la comparaison se fait ensuite par préfixe sur la date de la cache.
    if (DATE_GEOCACHE_FIELDS.has(field)) {
        const betweenIdx = expr.indexOf('<>');
        if (betweenIdx !== -1) {
            const a = expr.slice(0, betweenIdx).trim();
            const b = expr.slice(betweenIdx + 2).trim();
            if (!DATE_OPERAND_REGEXP.test(a) || !DATE_OPERAND_REGEXP.test(b)) {
                return null;
            }
            // Comme pour les numériques, « entre » accepte les bornes dans
            // n'importe quel ordre ; l'ordre lexicographique suit la
            // chronologie sur ces formats.
            return a <= b
                ? { field, operator: 'between', value: a, value2: b }
                : { field, operator: 'between', value: b, value2: a };
        }
        if (expr.startsWith('>=')) {
            const v = expr.slice(2).trim();
            return DATE_OPERAND_REGEXP.test(v) ? { field, operator: 'gte', value: v } : null;
        }
        if (expr.startsWith('<=')) {
            const v = expr.slice(2).trim();
            return DATE_OPERAND_REGEXP.test(v) ? { field, operator: 'lte', value: v } : null;
        }
        if (expr.startsWith('>')) {
            const v = expr.slice(1).trim();
            return DATE_OPERAND_REGEXP.test(v) ? { field, operator: 'gt', value: v } : null;
        }
        if (expr.startsWith('<')) {
            const v = expr.slice(1).trim();
            return DATE_OPERAND_REGEXP.test(v) ? { field, operator: 'lt', value: v } : null;
        }
        if (expr.startsWith('!=')) {
            const v = expr.slice(2).trim();
            return DATE_OPERAND_REGEXP.test(v) ? { field, operator: 'neq', value: v } : null;
        }
        if (expr.startsWith('=')) {
            const v = expr.slice(1).trim();
            return DATE_OPERAND_REGEXP.test(v) ? { field, operator: 'eq', value: v } : null;
        }
        return DATE_OPERAND_REGEXP.test(expr) ? { field, operator: 'eq', value: expr } : null;
    }

    if (expr.startsWith('!=')) {
        return { field, operator: 'neq', value: expr.slice(2) };
    }
    if (expr.startsWith('=')) {
        return { field, operator: 'eq', value: expr.slice(1) };
    }
    return { field, operator: 'contains', value: expr };
}

export function getOperatorOptionsForKind(kind: 'text' | 'number' | 'enum' | 'boolean' | 'date' | undefined): Array<{ operator: AdvancedOperator; label: string }> {
    if (kind === 'number' || kind === 'date') {
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

export function getDefaultOperatorForKind(kind: 'text' | 'number' | 'enum' | 'boolean' | 'date' | undefined): AdvancedOperator {
    if (kind === 'number') {
        return 'between';
    }
    // Le cas d'usage dominant d'un filtre date est « posées après… ».
    if (kind === 'date') {
        return 'gte';
    }
    if (kind === 'enum') {
        return 'eq';
    }
    if (kind === 'boolean') {
        return 'is';
    }
    return 'contains';
}
