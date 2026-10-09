import * as assert from 'assert/strict';

import { LetterValue } from '../../common/types';
import { CoordinatePreviewEngine } from '../preview/coordinate-preview-engine';
import { computeLetterValue, ValueCalculator } from '../utils/letter-value';
import { parseBulkValues } from '../utils/bulk-values';
import { distanceKm, MYSTERY_MAX_DISTANCE_KM } from '../utils/distance';
import { FormulaSolverServiceImpl } from '../formula-solver-service';

const calculator: ValueCalculator = new FormulaSolverServiceImpl({
    get: () => 'http://localhost:8000',
    onPreferenceChanged: () => { /* noop */ }
} as any);

function valuesOf(entries: Record<string, string | [string, LetterValue['type']]>): Map<string, LetterValue> {
    const values = new Map<string, LetterValue>();
    for (const [letter, entry] of Object.entries(entries)) {
        const [raw, type] = Array.isArray(entry) ? entry : [entry, 'value' as const];
        values.set(letter, computeLetterValue(letter, raw, type, calculator));
    }
    return values;
}

const engine = new CoordinatePreviewEngine();
const EAST = 'E 006° 09.123';

function testChecksumIgnoresAccentsAndLigatures(): void {
    assert.equal(calculator.calculateChecksum('Hélène'), calculator.calculateChecksum('Helene'));
    assert.equal(calculator.calculateChecksum('cœur'), calculator.calculateChecksum('coeur'));
    assert.equal(calculator.calculateChecksum('Paris'), 16 + 1 + 18 + 9 + 19);
    assert.equal(calculator.calculateChecksum('1867'), 22);
}

function testLengthCountsLettersAndDigitsOnly(): void {
    assert.equal(calculator.calculateLength('François-Marie'), 13);
    assert.equal(calculator.calculateLength("L'Île d'Yeu"), 8);
    assert.equal(calculator.calculateLength('Tour Eiffel'), 10);
    assert.equal(calculator.calculateLength('1867'), 4);
}

function testTextTypesUseTheRawText(): void {
    // "2CV" : le checksum porte sur le texte entier, pas sur le "2" initial
    assert.equal(computeLetterValue('A', '2CV', 'checksum', calculator).value, 2 + 3 + 22);
    // "007" : 3 caractères, pas la longueur du nombre 7
    assert.equal(computeLetterValue('A', '007', 'length', calculator).value, 3);
    assert.equal(computeLetterValue('A', '3 mousquetaires', 'length', calculator).value, 14);
}

function testNonNumericValueIsFlagged(): void {
    const text = computeLetterValue('A', 'Paris', 'value', calculator);
    assert.equal(text.error, 'valeur non numérique');

    const partial = computeLetterValue('A', '2CV', 'value', calculator);
    assert.equal(partial.error, 'valeur non numérique');

    const numeric = computeLetterValue('A', ' 12 ', 'value', calculator);
    assert.equal(numeric.error, undefined);
    assert.equal(numeric.value, 12);

    const zero = computeLetterValue('A', '0', 'value', calculator);
    assert.equal(zero.error, undefined);
    assert.equal(zero.value, 0);

    assert.equal(computeLetterValue('A', '', 'value', calculator).error, undefined);
}

function testBruteForceListStillParsed(): void {
    const list = computeLetterValue('A', '*1-3', 'value', calculator);
    assert.deepEqual(list.values, [1, 2, 3]);
    assert.equal(list.isList, true);
    assert.equal(list.error, undefined);
}

function testPreviewRejectsUnusableValue(): void {
    const preview = engine.build({ north: 'N 47° 53.ABC', east: EAST }, valuesOf({ A: 'Paris', B: '2', C: '3' }));
    assert.equal(preview.north.status, 'invalid');
    assert.deepEqual(preview.north.suspectLetters, ['A']);
    assert.match(preview.north.message, /valeur non numérique/);
}

function testPreviewRejectsOverflowNegativeAndNonInteger(): void {
    const overflow = engine.build({ north: 'N 47° 5A.BCD', east: EAST }, valuesOf({ A: '12', B: '3', C: '4', D: '5' }));
    assert.equal(overflow.north.status, 'invalid');

    const negative = engine.build({ north: 'N 47° 53.(A-B)CD', east: EAST }, valuesOf({ A: '2', B: '5', C: '4', D: '5' }));
    assert.equal(negative.north.status, 'invalid');

    const nonInteger = engine.build({ north: 'N 47° 53.A(B/2)C', east: EAST }, valuesOf({ A: '1', B: '5', C: '7' }));
    assert.equal(nonInteger.north.status, 'invalid');
}

function testPreviewAgreesWithBackendOnValidFormulas(): void {
    // Mêmes cas que backend/tests/test_coordinate_calculator.py
    const division = engine.build({ north: 'N 48° 41.(A/2)BC', east: EAST }, valuesOf({ A: '6', B: '1', C: '2' }));
    assert.equal(division.north.status, 'valid');
    assert.equal(division.north.display, 'N48°41.312');

    const minuteMark = engine.build({ north: "N 47° 53.ABC'", east: EAST }, valuesOf({ A: '1', B: '2', C: '3' }));
    assert.equal(minuteMark.north.status, 'valid');
    assert.equal(minuteMark.north.display, 'N47°53.123');
}

function testShortDecimalsReadAsWrittenWithWarning(): void {
    // .(A+B) = 5 : lu .500 comme le calcul final, et signalé
    const preview = engine.build({ north: 'N 47° 53.(A+B)', east: EAST }, valuesOf({ A: '2', B: '3' }));
    assert.equal(preview.north.status, 'valid');
    assert.equal(preview.north.display, 'N47°53.500');
    assert.ok(Math.abs(preview.north.decimalDegrees! - (47 + 53.5 / 60)) < 1e-9);
    assert.match(preview.north.message, /lu \.500/);

    // Décimales littérales : pas d'avertissement
    const literal = engine.build({ north: 'N 47° 53.50', east: EAST }, new Map());
    assert.equal(literal.north.display, 'N47°53.500');
    assert.equal(literal.north.message, 'Coordonnée valide');
}

function testBulkValuesSeparators(): void {
    const expected = [{ letter: 'A', value: '3' }, { letter: 'B', value: '7' }, { letter: 'C', value: '12' }];
    assert.deepEqual(parseBulkValues('A=3, B=7, C=12'), expected);
    assert.deepEqual(parseBulkValues('A: 3; B: 7; C: 12'), expected);
    assert.deepEqual(parseBulkValues('A=3 B=7 C=12'), expected);
    assert.deepEqual(parseBulkValues('A = 3\nB = 7\r\nC = 12\n'), expected);
    assert.deepEqual(parseBulkValues('a=3,b=7,c=12'), expected);
}

function testBulkValuesTextAndEdgeCases(): void {
    assert.deepEqual(parseBulkValues('D = Tour Eiffel\nE = 1889'), [
        { letter: 'D', value: 'Tour Eiffel' },
        { letter: 'E', value: '1889' }
    ]);
    // Une lettre répétée : la dernière affectation l'emporte
    assert.deepEqual(parseBulkValues('A=1, A=2'), [{ letter: 'A', value: '2' }]);
    // Valeur vide ignorée, texte sans affectation ignoré
    assert.deepEqual(parseBulkValues('A=, B=4'), [{ letter: 'B', value: '4' }]);
    assert.deepEqual(parseBulkValues('rien à lire ici'), []);
    // Une lettre au sein d'un mot n'est pas une affectation
    assert.deepEqual(parseBulkValues('total=5, AB=3'), []);
}

function testDistanceAndMysteryLimit(): void {
    // 1 minute de latitude = 1 mille marin = 1,852 km environ
    assert.ok(Math.abs(distanceKm(47, 6, 47 + 1 / 60, 6) - 1.853) < 0.01);
    assert.equal(distanceKm(47, 6, 47, 6), 0);
    assert.ok(Math.abs(MYSTERY_MAX_DISTANCE_KM - 3.218688) < 1e-9);
}

function run(): void {
    testBulkValuesSeparators();
    testBulkValuesTextAndEdgeCases();
    testDistanceAndMysteryLimit();
    testChecksumIgnoresAccentsAndLigatures();
    testLengthCountsLettersAndDigitsOnly();
    testTextTypesUseTheRawText();
    testNonNumericValueIsFlagged();
    testBruteForceListStillParsed();
    testPreviewRejectsUnusableValue();
    testPreviewRejectsOverflowNegativeAndNonInteger();
    testPreviewAgreesWithBackendOnValidFormulas();
    testShortDecimalsReadAsWrittenWithWarning();
    // eslint-disable-next-line no-console
    console.log('coordinate-preview-engine tests passed');
}

run();
