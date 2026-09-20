import * as assert from 'assert/strict';
import { computeWindowRange } from '../virtualized-range';

const uniform = (height: number) => () => height;

function testFullCoverage(): void {
    // La fenêtre englobe toute la liste : tout est monté.
    const range = computeWindowRange([0, 100, 200, 300], uniform(100), 0, -800, 1200);
    assert.deepEqual(range, { startIndex: 0, endIndex: 3 });
}

function testMiddleWindow(): void {
    // Quatre éléments de 100 px, fenêtre [50, 250) : le dernier est exclu.
    const range = computeWindowRange([0, 100, 200, 300], uniform(100), 0, 50, 250);
    assert.deepEqual(range, { startIndex: 0, endIndex: 2 });
}

function testWindowBelowList(): void {
    // Défilé au-delà du dernier élément : rien à monter.
    const range = computeWindowRange([0, 100], uniform(100), 0, 500, 700);
    assert.deepEqual(range, { startIndex: 2, endIndex: 1 });
}

function testWindowAboveList(): void {
    const range = computeWindowRange([0, 100], uniform(100), 0, -500, -100);
    assert.deepEqual(range, { startIndex: 0, endIndex: -1 });
}

function testEmptyList(): void {
    const range = computeWindowRange([], uniform(100), 0, 0, 600);
    assert.deepEqual(range, { startIndex: 0, endIndex: -1 });
}

function testVariableHeights(): void {
    // Hauteurs irrégulières : le calcul part des offsets, pas d'une taille fixe.
    const heights = [300, 40, 500, 80];
    const offsets = [0, 300, 340, 840];
    const range = computeWindowRange(
        offsets, i => heights[i], 0, 320, 500
    );
    assert.deepEqual(range, { startIndex: 1, endIndex: 2 });
}

function testGapBelongsToPreviousItem(): void {
    // Le gap est compté dans l'empreinte de l'élément qui le précède : une
    // fenêtre qui n'atteint que le gap monte quand même l'élément.
    const offsets = [0, 110];
    const range = computeWindowRange(offsets, uniform(100), 10, 105, 200);
    assert.equal(range.startIndex, 0);
    assert.equal(range.endIndex, 1);
}

testFullCoverage();
testMiddleWindow();
testWindowBelowList();
testWindowAboveList();
testEmptyList();
testVariableHeights();
testGapBelongsToPreviousItem();

console.log('virtualized-range.test.ts OK');
