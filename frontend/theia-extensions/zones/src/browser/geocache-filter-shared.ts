
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
    | 'favorites_count';

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

export interface FieldDefinition {
    field: string;
    label: string;
    kind: 'text' | 'number' | 'enum' | 'boolean';
}

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

export const DISTANCE_KM_FIELD_DEFINITION: FieldDefinition = {
    field: 'distance_km',
    label: 'Distance (km)',
    kind: 'number',
};

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
    const key = raw.trim().toLowerCase();
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
        status: 'solved',
        found: 'found',
        favorites: 'favorites_count',
        fav: 'favorites_count',
        favorites_count: 'favorites_count',
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

export function parseTokenExpression(field: string, exprRaw: string): TokenFilter | null {
    const expr = (exprRaw ?? '').trim();
    if (!expr) {
        return null;
    }

    const isNumericField = ['difficulty', 'terrain', 'favorites_count', 'distance_km'].includes(field);

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

export function getOperatorOptionsForKind(kind: 'text' | 'number' | 'enum' | 'boolean' | undefined): Array<{ operator: AdvancedOperator; label: string }> {
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

export function getDefaultOperatorForKind(kind: 'text' | 'number' | 'enum' | 'boolean' | undefined): AdvancedOperator {
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
