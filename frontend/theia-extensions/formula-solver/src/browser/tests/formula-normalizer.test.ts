import * as assert from 'assert/strict';

import { LetterValue } from '../../common/types';
import { CoordinatePreviewEngine } from '../preview/coordinate-preview-engine';
import { normalizeFormulaAxis } from '../utils/formula-normalizer';

// Mêmes cas que backend/tests/test_coordinate_calculator.py (test_normalize_formula)
const CASES: Array<[string, string]> = [
    ['N 47° 53.(A×B)', 'N 47° 53.(A*B)'],
    ['N 47° 53.(A÷B)', 'N 47° 53.(A/B)'],
    ['N 47° 53.[A+B]{C−D}', 'N 47° 53.(A+B)(C-D)'],
    ['N 47° 53.(A²+B³)', 'N 47° 53.(A^2+B^3)'],
    ['N 47° 53.(A x B)', 'N 47° 53.(A*B)'],
    ['N 47° 53.(AxBxC)', 'N 47° 53.(A*B*C)'],
    ['N 47° 53.(A:B)', 'N 47° 53.(A/B)'],
    ['N 47° 53,ABC', 'N 47° 53.ABC'],
    ['n 47° 5a.bcd', 'N 47° 5A.BCD'],
    ['e 006° 0a.(b x 2)c', 'E 006° 0A.(B*2)C'],
    ['n 47° 53.axb', 'N 47° 53.AXB'],
    ['E 006° 5E.EXE', 'E 006° 5E.EXE'],
    ['N 47° 53.ABC', 'N 47° 53.ABC']
];

function testNormalization(): void {
    for (const [raw, expected] of CASES) {
        assert.equal(normalizeFormulaAxis(raw), expected, `normalisation de « ${raw} »`);
    }
}

function testNormalizationIsIdempotent(): void {
    for (const [, expected] of CASES) {
        assert.equal(normalizeFormulaAxis(expected), expected);
    }
}

function values(entries: Record<string, number>): Map<string, LetterValue> {
    const map = new Map<string, LetterValue>();
    for (const [letter, value] of Object.entries(entries)) {
        map.set(letter, { letter, rawValue: String(value), value, type: 'value' });
    }
    return map;
}

function testPreviewEvaluatesNormalizedFormula(): void {
    const engine = new CoordinatePreviewEngine();
    // Même formule et mêmes valeurs que test_calculate_with_alternative_symbols (backend)
    const preview = engine.build(
        {
            north: normalizeFormulaAxis('N 47° 53,[A×B](C²)'),
            east: normalizeFormulaAxis('e 006° 09.(a x b)(c:1)')
        },
        values({ A: 3, B: 4, C: 3 })
    );
    assert.equal(preview.north.status, 'valid');
    assert.equal(preview.north.display, 'N47°53.129');
    assert.equal(preview.east.status, 'valid');
    assert.equal(preview.east.display, 'E006°09.123');
}

function testPreviewPowerAtTopLevel(): void {
    const engine = new CoordinatePreviewEngine();
    const preview = engine.build({ north: 'N 47° 53.A^3', east: 'E 006° 09.123' }, values({ A: 5 }));
    assert.equal(preview.north.status, 'valid');
    assert.equal(preview.north.display, 'N47°53.125');
}

function run(): void {
    testNormalization();
    testNormalizationIsIdempotent();
    testPreviewEvaluatesNormalizedFormula();
    testPreviewPowerAtTopLevel();
    // eslint-disable-next-line no-console
    console.log('formula-normalizer tests passed');
}

run();
