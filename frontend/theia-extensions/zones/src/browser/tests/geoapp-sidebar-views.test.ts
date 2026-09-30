/**
 * Registre des vues latérales GeoApp : unicité des IDs/commandes/rangs et liste
 * exacte des vues visibles par défaut (spec barres-laterales §3.2).
 */
import * as assert from 'assert/strict';
import { GEOAPP_SIDEBAR_VIEWS } from '../sidebar/geoapp-sidebar-views';

function unique<T>(items: T[]): T[] {
    return [...new Set(items)];
}

function testUniqueIdsCommandsAndRanks(): void {
    const ids = GEOAPP_SIDEBAR_VIEWS.map(v => v.id);
    const commands = GEOAPP_SIDEBAR_VIEWS.map(v => v.openCommandId);
    const ranks = GEOAPP_SIDEBAR_VIEWS.map(v => v.defaultRank);
    assert.equal(unique(ids).length, ids.length, 'IDs dupliqués dans GEOAPP_SIDEBAR_VIEWS');
    assert.equal(unique(commands).length, commands.length, 'commandes dupliquées');
    // Le rang fixe l'ordre initial des onglets dans la barre : doublon = ordre incertain.
    assert.equal(unique(ranks).length, ranks.length, 'rangs dupliqués');
}

function testDefaultVisibleViewsMatchSpec(): void {
    const visible = GEOAPP_SIDEBAR_VIEWS.filter(v => v.defaultVisible).map(v => v.id);
    assert.deepEqual(visible, [
        'zones.tree.widget',
        'geoapp-map-manager',
        'geoapp-global-search-widget',
        'mysterai-plugins-browser',
        'alphabets-list',
        'formula-solver:widget',
    ]);
    // La calculatrice existe mais n'est pas forcée dans le layout initial.
    const calculator = GEOAPP_SIDEBAR_VIEWS.find(v => v.id === 'geoapp.calculator');
    assert.equal(calculator?.defaultVisible, false);
    // Formula Solver : seule vue à droite par défaut.
    const solver = GEOAPP_SIDEBAR_VIEWS.find(v => v.id === 'formula-solver:widget');
    assert.equal(solver?.defaultArea, 'right');
    assert.equal(solver?.defaultRank, 500);
}

function testFieldsAreFilled(): void {
    for (const view of GEOAPP_SIDEBAR_VIEWS) {
        assert.ok(view.id.trim(), 'id vide');
        assert.ok(view.label.trim(), `label vide pour ${view.id}`);
        assert.ok(view.iconClass.trim(), `iconClass vide pour ${view.id}`);
        assert.ok(view.openCommandId.trim(), `openCommandId vide pour ${view.id}`);
        assert.ok(view.defaultArea === 'left' || view.defaultArea === 'right', `zone invalide pour ${view.id}`);
    }
}

testUniqueIdsCommandsAndRanks();
testDefaultVisibleViewsMatchSpec();
testFieldsAreFilled();

console.log('geoapp-sidebar-views tests passed');
