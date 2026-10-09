import * as assert from 'assert/strict';

import { LetterValue } from '../../common/types';
import { CoordinatePreviewEngine } from '../preview/coordinate-preview-engine';
import { deduceMissingLetters, describeDigits } from '../utils/deduction';
import { MYSTERY_MAX_DISTANCE_KM } from '../utils/distance';

const engine = new CoordinatePreviewEngine();

// Origine : N 47° 53.123 E 006° 09.456
const ORIGIN = { latitude: 47 + 53.123 / 60, longitude: 6 + 9.456 / 60 };

function known(entries: Record<string, number>): Map<string, LetterValue> {
    const values = new Map<string, LetterValue>();
    for (const [letter, value] of Object.entries(entries)) {
        values.set(letter, { letter, rawValue: String(value), value, type: 'value' });
    }
    return values;
}

function deduce(north: string, east: string, values: Map<string, LetterValue>, missing: string[]) {
    return deduceMissingLetters(engine, { north, east }, values, missing, ORIGIN, MYSTERY_MAX_DISTANCE_KM);
}

function testMinutesDigitIsConstrained(): void {
    // Une minute de latitude = 1,85 km : seuls 52, 53 et 54 restent dans les 2 miles
    const result = deduce('N 47° 5A.123', 'E 006° 09.456', new Map(), ['A']);
    assert.equal(result.tested, 10);
    assert.deepEqual(result.possibleByLetter.get('A'), [2, 3, 4]);
    // Le plus proche d'abord
    assert.deepEqual(result.candidates[0].values, { A: 3 });
    assert.ok(result.candidates[0].distanceKm < 0.001);
    assert.equal(result.candidates[0].formatted, 'N47°53.123 E006°09.456');
}

function testThousandthsDigitIsNotConstrained(): void {
    const result = deduce('N 47° 53.12A', 'E 006° 09.456', new Map(), ['A']);
    assert.equal(result.candidates.length, 10);
    assert.equal(describeDigits(result.possibleByLetter.get('A')!), '0 à 9 (aucune contrainte)');
}

function testWrongKnownValueLeavesNoCandidate(): void {
    // B=0 place la latitude à plus de 60 km : aucun chiffre de A ne rattrape l'écart
    const result = deduce('N 47° 2B.12A', 'E 006° 09.456', known({ B: 0 }), ['A']);
    assert.equal(result.candidates.length, 0);
    assert.deepEqual(result.possibleByLetter.get('A'), []);
}

function testTwoLettersAreCombined(): void {
    const result = deduce('N 47° 5A.123', 'E 006° 0B.456', new Map(), ['B', 'A']);
    assert.deepEqual(result.letters, ['A', 'B']);
    assert.equal(result.tested, 100);
    assert.deepEqual(result.possibleByLetter.get('A'), [2, 3, 4]);
    assert.deepEqual(result.possibleByLetter.get('B'), [7, 8, 9]);
    assert.equal(result.candidates.length, 9);
    assert.deepEqual(result.candidates[0].values, { A: 3, B: 9 });
}

function testKnownValuesAreKept(): void {
    const result = deduce('N 47° 5A.1BC', 'E 006° 09.456', known({ B: 2, C: 3 }), ['A']);
    assert.deepEqual(result.possibleByLetter.get('A'), [2, 3, 4]);
    assert.equal(result.candidates[0].formatted, 'N47°53.123 E006°09.456');
}

function testDescribeDigits(): void {
    assert.equal(describeDigits([]), 'aucun');
    assert.equal(describeDigits([4]), '4');
    assert.equal(describeDigits([4, 5]), '4 ou 5');
    assert.equal(describeDigits([2, 3, 4, 5]), '2 à 5');
    assert.equal(describeDigits([0, 3, 7]), '0, 3, 7');
}

function run(): void {
    testMinutesDigitIsConstrained();
    testThousandthsDigitIsNotConstrained();
    testWrongKnownValueLeavesNoCandidate();
    testTwoLettersAreCombined();
    testKnownValuesAreKept();
    testDescribeDigits();
    // eslint-disable-next-line no-console
    console.log('deduction tests passed');
}

run();
