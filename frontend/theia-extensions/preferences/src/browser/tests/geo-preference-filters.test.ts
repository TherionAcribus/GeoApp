/**
 * Tests des fonctions pures de la page Préférences : recherche, filtres,
 * sous-sections, groupes de la barre latérale et « révéler une clé retire
 * les filtres qui la cachent ».
 *
 * Exécution : yarn test:geoapp (ts-node).
 */

import * as assert from 'assert/strict';
import {
    areValuesEqual,
    buildSearchHaystack,
    buildSidebarGroups,
    buildSubsections,
    compareCategories,
    comparePreferences,
    filtersForReveal,
    matchesBaseFilters,
    matchesSearchQuery,
    normalizeSearchText,
    toSubsectionId,
} from '../geo-preference-filters';
import {
    GeoPreferenceDefinition,
    GeoPreferenceKey,
    GEO_PREFERENCE_CATEGORIES,
    GEO_PREFERENCE_GUIDES,
    geoPreferenceSchema,
} from '../geo-preferences-schema';

function definitionOf(key: string): GeoPreferenceDefinition {
    const definition = geoPreferenceSchema.properties?.[key] as GeoPreferenceDefinition | undefined;
    assert.ok(definition, `la clé ${key} doit exister dans le schéma`);
    return definition;
}

function main(): void {
    // ── normalizeSearchText ─────────────────────────────────────────────
    assert.equal(normalizeSearchText('  Réglages Avancés  '), 'reglages avances');
    assert.equal(normalizeSearchText('ÉÉÉ'), 'eee');
    assert.equal(normalizeSearchText(undefined), '');

    // ── recherche ────────────────────────────────────────────────────────
    const apiKeyDef = definitionOf('geoApp.ai.openRouter.apiKey');
    const haystack = buildSearchHaystack('geoApp.ai.openRouter.apiKey' as GeoPreferenceKey, apiKeyDef, 'sk-or-xxxx');
    assert.ok(matchesSearchQuery(haystack, 'openrouter'), 'la clé OpenRouter doit être trouvée par « openrouter »');
    assert.ok(matchesSearchQuery(haystack, 'cle'), 'la recherche est insensible aux accents (« clé »)');
    assert.ok(!matchesSearchQuery(haystack, 'geocache'), 'terme sans rapport ne match pas');
    assert.ok(matchesSearchQuery(haystack, ''), 'requête vide = tout visible');

    // ── matchesBaseFilters ───────────────────────────────────────────────
    const base = { modified: false, advanced: true, targets: ['frontend'] };
    assert.equal(matchesBaseFilters({
        ...base, valueFilter: 'all', targetFilter: 'all', showAdvanced: true, searchActive: false
    }), true);
    assert.equal(matchesBaseFilters({
        ...base, valueFilter: 'all', targetFilter: 'all', showAdvanced: false, searchActive: false
    }), false, 'avancé masqué quand la case est décochée');
    assert.equal(matchesBaseFilters({
        ...base, valueFilter: 'all', targetFilter: 'all', showAdvanced: false, searchActive: true
    }), true, 'une recherche réaffiche les avancées qui correspondent');
    assert.equal(matchesBaseFilters({
        ...base, valueFilter: 'modified', targetFilter: 'all', showAdvanced: true, searchActive: false
    }), false, '« Modifiées » masque une entrée non modifiée');
    assert.equal(matchesBaseFilters({
        ...base, modified: true, valueFilter: 'modified', targetFilter: 'all', showAdvanced: true, searchActive: false
    }), true);
    assert.equal(matchesBaseFilters({
        ...base, valueFilter: 'all', targetFilter: 'backend', showAdvanced: true, searchActive: false
    }), false, 'filtre de cible incompatible');
    assert.equal(matchesBaseFilters({
        ...base, valueFilter: 'all', targetFilter: 'frontend', showAdvanced: true, searchActive: false
    }), true);

    // ── sous-sections : ordre par plus petit x-ui.order ─────────────────
    const entries = [
        { key: 'k1' as GeoPreferenceKey, definition: { 'x-ui': { section: 'B', order: 20 } } as GeoPreferenceDefinition },
        { key: 'k2' as GeoPreferenceKey, definition: { 'x-ui': { section: 'A', order: 30 } } as GeoPreferenceDefinition },
        { key: 'k3' as GeoPreferenceKey, definition: { 'x-ui': { section: 'B', order: 5 } } as GeoPreferenceDefinition },
        { key: 'k4' as GeoPreferenceKey, definition: { 'x-ui': { section: 'A', order: 40 } } as GeoPreferenceDefinition },
    ];
    const subsections = buildSubsections(entries);
    assert.deepEqual(subsections.map(s => s.label), ['B', 'A'], 'B (minOrder 5) avant A (minOrder 30)');
    assert.deepEqual(subsections[0].entries.map(e => e.key), ['k1', 'k3']);
    assert.equal(subsections[0].minOrder, 5);
    assert.equal(toSubsectionId('Checkers avancés'), 'checkers-avances');

    // ── tri des catégories et des préférences ────────────────────────────
    const orderOf = (id: string) => GEO_PREFERENCE_CATEGORIES.find(c => c.id === id)?.order;
    const first = GEO_PREFERENCE_CATEGORIES[0];
    const last = GEO_PREFERENCE_CATEGORIES[GEO_PREFERENCE_CATEGORIES.length - 1];
    assert.ok(compareCategories(first.id, last.id) < 0, 'les catégories suivent l\'ordre de x-categories');
    const d10 = { 'x-ui': { order: 10 } } as GeoPreferenceDefinition;
    const d30 = { 'x-ui': { order: 30 } } as GeoPreferenceDefinition;
    assert.ok(comparePreferences('k' as GeoPreferenceKey, d10, 'k' as GeoPreferenceKey, d30) < 0);

    // ── buildSidebarGroups : premier guide qui cite la catégorie ────────
    const sections = GEO_PREFERENCE_CATEGORIES.map(category => ({
        category: category.id,
        label: category.label,
        entries: [],
        filteredEntries: [],
        subsections: []
    }));
    const groups = buildSidebarGroups(sections, GEO_PREFERENCE_GUIDES);
    const assigned = groups.flatMap(group => group.sections.map(section => section.category));
    assert.equal(assigned.length, sections.length, 'chaque catégorie est dans un groupe');
    for (const group of groups) {
        if (group.id === 'other') {
            continue;
        }
        const guide = GEO_PREFERENCE_GUIDES.find(g => g.id === group.id);
        assert.ok(guide, `le groupe ${group.id} correspond à un guide`);
        for (const section of group.sections) {
            assert.ok(guide!.categories?.includes(section.category),
                `${section.category} doit être citée par le guide ${group.id}`);
        }
    }
    // Le schéma garantit qu'aucune catégorie n'est orpheline : pas de groupe « Autres ».
    assert.equal(groups.find(g => g.id === 'other'), undefined, 'aucune catégorie ne doit tomber dans « Autres »');
    // Un guide sans catégorie citée n'apparaît pas.
    const withEmpty = buildSidebarGroups(sections, [...GEO_PREFERENCE_GUIDES, { id: 'empty', label: 'Vide', categories: [] }]);
    assert.equal(withEmpty.find(g => g.id === 'empty'), undefined);

    // ── filtersForReveal ────────────────────────────────────────────────
    const closed = { searchQuery: 'ancien', valueFilter: 'modified' as const, targetFilter: 'backend' as const, showAdvanced: false };
    // Cible non modifiée, avancée, frontend, ne matche pas la recherche : tout est levé.
    const lifted = filtersForReveal(closed, { matchesSearch: false, advanced: true, modified: false, targets: ['frontend'] });
    assert.deepEqual(lifted, { searchQuery: '', valueFilter: 'all', targetFilter: 'all', showAdvanced: true });
    // Cible compatible avec les filtres actifs : rien ne change.
    const kept = filtersForReveal(closed, { matchesSearch: true, advanced: false, modified: true, targets: ['backend'] });
    assert.deepEqual(kept, closed);
    // Recherche qui matche la cible est conservée.
    assert.equal(filtersForReveal(closed, { matchesSearch: true, advanced: false, modified: false, targets: ['frontend'] }).searchQuery, 'ancien');
    // « Modifiées » reste actif si la cible est modifiée.
    assert.equal(filtersForReveal(closed, { matchesSearch: true, advanced: true, modified: true, targets: ['backend'] }).valueFilter, 'modified');

    // ── areValuesEqual ──────────────────────────────────────────────────
    assert.ok(areValuesEqual({ a: 1 }, { a: 1 }));
    assert.ok(!areValuesEqual({ a: 1 }, { a: 2 }));
    assert.ok(areValuesEqual(['x', 'y'], ['x', 'y']));
    assert.ok(areValuesEqual(1, 1));
    assert.ok(!areValuesEqual(undefined, 1));

    console.log('geo-preference-filters: OK');
}

main();
