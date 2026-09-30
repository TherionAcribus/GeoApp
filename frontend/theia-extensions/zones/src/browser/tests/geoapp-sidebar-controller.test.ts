/**
 * Tests des fonctions pures du contrôleur des barres latérales (spec §8) :
 * placement dérivé du shell, décision du reset limité au registre et
 * sérialisation des opérations — le tout sans DOM ni `ApplicationShell`.
 */

import * as assert from 'assert/strict';
import { GEOAPP_SIDEBAR_VIEWS } from '../sidebar/geoapp-sidebar-views';
import {
    placementFor,
    resetActionFor,
    SidebarOperationQueue,
} from '../sidebar/geoapp-sidebar-view-state';


const zones = GEOAPP_SIDEBAR_VIEWS.find(v => v.id === 'zones.tree.widget')!;
const calculator = GEOAPP_SIDEBAR_VIEWS.find(v => v.id === 'geoapp.calculator')!;
const solver = GEOAPP_SIDEBAR_VIEWS.find(v => v.id === 'formula-solver:widget')!;

function testPlacementFor(): void {
    assert.equal(placementFor(false, undefined), 'hidden');
    assert.equal(placementFor(false, 'left'), 'hidden');
    assert.equal(placementFor(true, 'left'), 'left');
    assert.equal(placementFor(true, 'right'), 'right');
    // Vue latérale déplacée dans le panneau principal ou inférieur : elle est
    // visible, mais n'appartient à aucun groupe latéral → « autre » (jamais
    // présentée comme masquée).
    assert.equal(placementFor(true, 'main'), 'other');
    assert.equal(placementFor(true, 'bottom'), 'other');
    assert.equal(placementFor(true, 'secondaryWindow'), 'other');
    assert.equal(placementFor(true, undefined), 'other');
    console.log('testPlacementFor passed');
}

function testResetActionFor(): void {
    // Calculatrice : masquée par défaut.
    assert.equal(resetActionFor(calculator, true, 'left'), 'close');
    assert.equal(resetActionFor(calculator, false, undefined), 'leave');

    // Zones : déjà à sa place par défaut → ne pas recréer (état préservé).
    assert.equal(resetActionFor(zones, true, 'left'), 'leave');
    // Absente alors qu'elle est par défaut → recréer.
    assert.equal(resetActionFor(zones, false, undefined), 'recreate');
    // Déplacée à droite / dans le main → recréer à gauche.
    assert.equal(resetActionFor(zones, true, 'right'), 'recreate');
    assert.equal(resetActionFor(zones, true, 'main'), 'recreate');

    // Formula Solver : déplacé à gauche → recréé à droite.
    assert.equal(resetActionFor(solver, true, 'left'), 'recreate');
    assert.equal(resetActionFor(solver, true, 'right'), 'leave');
    assert.equal(resetActionFor(solver, false, undefined), 'recreate');
    console.log('testResetActionFor passed');
}

async function testOperationQueueSerializes(): Promise<void> {
    const queue = new SidebarOperationQueue();
    const order: string[] = [];

    const first = queue.enqueue(async () => {
        order.push('first-start');
        await new Promise(resolve => setTimeout(resolve, 15));
        order.push('first-end');
    });
    const second = queue.enqueue(async () => {
        order.push('second');
    });
    await Promise.all([first, second]);

    // La seconde opération a attendu la fin de la première — un double clic
    // ne peut pas lancer deux créations concurrentes.
    assert.deepEqual(order, ['first-start', 'first-end', 'second']);
    console.log('testOperationQueueSerializes passed');
}

async function testOperationQueueSurvivesFailures(): Promise<void> {
    const queue = new SidebarOperationQueue();
    const order: string[] = [];

    await assert.rejects(
        queue.enqueue(async () => { order.push('failing'); throw new Error('boom'); }),
        /boom/,
    );
    // Une opération en échec n'empêche pas les suivantes.
    await queue.enqueue(async () => { order.push('after-failure'); });
    assert.deepEqual(order, ['failing', 'after-failure']);
    console.log('testOperationQueueSurvivesFailures passed');
}

async function main(): Promise<void> {
    testPlacementFor();
    testResetActionFor();
    await testOperationQueueSerializes();
    await testOperationQueueSurvivesFailures();
    console.log('geoapp-sidebar-controller tests passed');
}

void main();
