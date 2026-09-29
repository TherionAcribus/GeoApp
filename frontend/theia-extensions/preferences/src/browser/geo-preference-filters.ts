/**
 * Fonctions pures de la page Préférences GeoApp : libellés, filtrage, recherche,
 * tri et regroupement. Aucune dépendance au DOM ou à React : tout est testable
 * sous ts-node (voir `src/browser/tests/`).
 */
import {
    GeoPreferenceDefinition,
    GeoPreferenceGuide,
    GeoPreferenceKey,
    GEO_PREFERENCE_CATEGORIES,
} from './geo-preferences-schema';

export type GeoPreferenceTargetFilter = 'all' | 'frontend' | 'backend';
export type GeoPreferenceValueFilter = 'all' | 'modified';

export interface GeoPreferenceEntry {
    key: GeoPreferenceKey;
    definition: GeoPreferenceDefinition;
}

export interface GeoPreferenceSection {
    category: string;
    label: string;
    entries: GeoPreferenceEntry[];
    filteredEntries: GeoPreferenceEntry[];
    subsections: GeoPreferenceSubsection[];
}

export interface GeoPreferenceSubsection {
    id: string;
    label: string;
    /** Plus petit `x-ui.order` des entrées : détermine l'ordre des sous-sections. */
    minOrder: number;
    entries: GeoPreferenceEntry[];
}

/** Groupe de la barre latérale : un guide `x-guides` et les catégories qu'il cite. */
export interface GeoPreferenceSidebarGroup {
    id: string;
    label: string;
    description?: string;
    sections: GeoPreferenceSection[];
}

/** État des filtres manipulé par le widget et `filtersForReveal`. */
export interface GeoPreferenceFilterState {
    searchQuery: string;
    valueFilter: GeoPreferenceValueFilter;
    targetFilter: GeoPreferenceTargetFilter;
    showAdvanced: boolean;
}

// Libellés et ordre des catégories lus dans le schéma partagé (`x-categories`).
const CATEGORY_LABELS = new Map(GEO_PREFERENCE_CATEGORIES.map(category => [category.id, category.label]));
const CATEGORY_ORDERS = new Map(GEO_PREFERENCE_CATEGORIES.map((category, index) => [category.id, category.order ?? index]));

export function humanSegment(value: string): string {
    return value
        .replace(/([A-Z])/g, ' $1')
        .replace(/-/g, ' ')
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^\w/, char => char.toUpperCase());
}

export function preferenceLabel(key: string): string {
    return key
        .replace(/^geoApp\./, '')
        .split('.')
        .map(part => humanSegment(part))
        .join(' / ');
}

export function categoryLabel(category: string): string {
    return CATEGORY_LABELS.get(category) ?? category;
}

export function normalizeSearchText(value: string | undefined): string {
    return (value ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

export function compareCategories(a: string, b: string): number {
    const aOrder = CATEGORY_ORDERS.get(a);
    const bOrder = CATEGORY_ORDERS.get(b);
    if (aOrder !== undefined || bOrder !== undefined) {
        return (aOrder ?? Number.MAX_SAFE_INTEGER) - (bOrder ?? Number.MAX_SAFE_INTEGER);
    }
    return a.localeCompare(b);
}

export function comparePreferences(
    leftKey: GeoPreferenceKey,
    leftDefinition: GeoPreferenceDefinition,
    rightKey: GeoPreferenceKey,
    rightDefinition: GeoPreferenceDefinition
): number {
    const leftOrder = leftDefinition['x-ui']?.order;
    const rightOrder = rightDefinition['x-ui']?.order;
    if (leftOrder !== undefined || rightOrder !== undefined) {
        return (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER);
    }
    return String(leftKey).localeCompare(String(rightKey));
}

/** Toutes les clés du schéma déclarent `x-ui.section` : simple repli sur « Général ». */
export function toPreferenceSectionLabel(definition: GeoPreferenceDefinition): string {
    return definition['x-ui']?.section ?? 'Général';
}

export function toSubsectionId(label: string): string {
    return normalizeSearchText(label).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'general';
}

/** Regroupe les entrées par `x-ui.section`, sous-sections ordonnées par leur plus petit `x-ui.order`. */
export function buildSubsections(entries: GeoPreferenceEntry[]): GeoPreferenceSubsection[] {
    const map = new Map<string, GeoPreferenceSubsection>();
    for (const entry of entries) {
        const label = toPreferenceSectionLabel(entry.definition);
        const id = toSubsectionId(label);
        const order = entry.definition['x-ui']?.order ?? Number.MAX_SAFE_INTEGER;
        if (!map.has(id)) {
            map.set(id, { id, label, minOrder: order, entries: [] });
        }
        const subsection = map.get(id)!;
        subsection.minOrder = Math.min(subsection.minOrder, order);
        subsection.entries.push(entry);
    }
    return Array.from(map.values()).sort((left, right) =>
        left.minOrder - right.minOrder || left.label.localeCompare(right.label));
}

export function areValuesEqual(left: unknown, right: unknown): boolean {
    if (left === right) {
        return true;
    }
    try {
        return JSON.stringify(left) === JSON.stringify(right);
    } catch {
        return false;
    }
}

export function stringifyForSearch(value: unknown): string {
    if (value === undefined || value === null) {
        return '';
    }
    if (typeof value === 'string') {
        return value;
    }
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

/** Texte de recherche normalisé d'une préférence (clé, libellés, tags, enum et valeur). */
export function buildSearchHaystack(key: GeoPreferenceKey, definition: GeoPreferenceDefinition, value: unknown): string {
    return normalizeSearchText([
        key,
        definition.title,
        preferenceLabel(key),
        definition.description,
        definition['x-category'],
        categoryLabel(definition['x-category'] || 'generic'),
        definition['x-ui']?.label,
        definition['x-ui']?.section,
        definition['x-ui']?.shortDescription,
        ...(definition['x-tags'] ?? []),
        ...(definition['x-ui']?.keywords ?? []),
        ...(definition.enum ?? []).map(String),
        ...(definition.items?.enum ?? []).map(String),
        stringifyForSearch(value)
    ]
        .filter(Boolean)
        .join(' '));
}

export function matchesSearchQuery(haystack: string, normalizedQuery: string): boolean {
    return !normalizedQuery || haystack.includes(normalizedQuery);
}

export function isAdvancedPreference(definition: GeoPreferenceDefinition): boolean {
    return Boolean(definition['x-ui']?.advanced);
}

/**
 * Filtres « de base » (hors recherche). Les réglages avancés ne sont masqués que si
 * la case est décochée et qu'aucune recherche n'est active : une recherche montre
 * toujours ses correspondances.
 */
export function matchesBaseFilters(options: {
    modified: boolean;
    advanced: boolean;
    targets: string[];
    valueFilter: GeoPreferenceValueFilter;
    targetFilter: GeoPreferenceTargetFilter;
    showAdvanced: boolean;
    searchActive: boolean;
}): boolean {
    if (options.valueFilter === 'modified' && !options.modified) {
        return false;
    }
    if (!options.showAdvanced && options.advanced && !options.searchActive) {
        return false;
    }
    if (options.targetFilter !== 'all' && !options.targets.includes(options.targetFilter)) {
        return false;
    }
    return true;
}

/**
 * Regroupe les catégories sous les guides de `x-guides` : chaque catégorie appartient
 * au premier guide qui la cite, les non citées terminent dans « Autres ».
 */
export function buildSidebarGroups(sections: GeoPreferenceSection[], guides: GeoPreferenceGuide[]): GeoPreferenceSidebarGroup[] {
    const groups: GeoPreferenceSidebarGroup[] = guides.map(guide => ({
        id: guide.id,
        label: guide.label,
        description: guide.description,
        sections: []
    }));
    const other: GeoPreferenceSidebarGroup = { id: 'other', label: 'Autres', sections: [] };
    for (const section of sections) {
        const groupIndex = guides.findIndex(guide => guide.categories?.includes(section.category));
        (groupIndex >= 0 ? groups[groupIndex] : other).sections.push(section);
    }
    return [...groups, other].filter(group => group.sections.length > 0);
}

/**
 * État des filtres à appliquer avant de révéler une clé : ne lève que les filtres
 * qui masqueraient la cible (recherche incompatible effacée, avancées réaffichées
 * si la clé l'est, « Modifiées » désactivé si elle ne l'est pas, filtre de cible
 * incompatible levé).
 */
export function filtersForReveal(
    state: GeoPreferenceFilterState,
    target: { matchesSearch: boolean; advanced: boolean; modified: boolean; targets: string[] }
): GeoPreferenceFilterState {
    return {
        searchQuery: target.matchesSearch ? state.searchQuery : '',
        valueFilter: state.valueFilter === 'modified' && !target.modified ? 'all' : state.valueFilter,
        showAdvanced: state.showAdvanced || target.advanced,
        targetFilter: state.targetFilter !== 'all' && !target.targets.includes(state.targetFilter)
            ? 'all'
            : state.targetFilter
    };
}
