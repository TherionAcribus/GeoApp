import * as assert from 'assert/strict';

import { formatValues, parseValuePattern, ValueRangeParser } from '../../common/value-range-parser';
import { parseValueList } from '../utils/value-parser';

const ALL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

// Chaque pattern doit donner les mêmes valeurs dans le panneau (tel quel) et
// dans le champ Valeur d'une lettre (précédé de `*`).
const CASES: Array<[string, number[]]> = [
    ['7', [7]],
    ['2,3,4', [2, 3, 4]],
    ['2;3;4', [2, 3, 4]],
    ['10, 20, 25', [10, 20, 25]],
    ['1-5', [1, 2, 3, 4, 5]],
    ['5-1', [1, 2, 3, 4, 5]],
    ['2<>5', [2, 3, 4, 5]],
    ['2<==>5', [2, 3, 4, 5]],
    ['<5', [0, 1, 2, 3, 4]],
    ['<=3', [0, 1, 2, 3]],
    ['>7', [8, 9]],
    ['>=7', [7, 8, 9]],
    ['1-3,5,7-9', [1, 2, 3, 5, 7, 8, 9]],
    ['1-3,7,>=8', [1, 2, 3, 7, 8, 9]],
    ['3,1,3,2', [1, 2, 3]]
];

function testSameValuesInPanelAndValueField(): void {
    for (const [pattern, expected] of CASES) {
        assert.deepEqual(ValueRangeParser.parsePattern(pattern), expected, `panneau : ${pattern}`);
        const field = parseValueList(`*${pattern}`);
        assert.deepEqual(field.values, expected, `champ Valeur : *${pattern}`);
        assert.equal(field.isList, true);
    }
}

function testStarAlone(): void {
    assert.deepEqual(ValueRangeParser.parsePattern('*'), ALL);
    assert.deepEqual(parseValueList('*').values, ALL);
    // Le préfixe * du champ Valeur est aussi accepté dans le panneau
    assert.deepEqual(ValueRangeParser.parsePattern('*1-3'), [1, 2, 3]);
}

function testInvalidPatternIsNeverPartiallyApplied(): void {
    for (const pattern of ['abc', '2,3x', '1-', '1--5', '<', '1-5,foo', '', ' , ']) {
        assert.deepEqual(parseValuePattern(pattern), [], `pattern invalide : « ${pattern} »`);
    }
    assert.equal(ValueRangeParser.isValidPattern('2,3x'), false);
    assert.equal(ValueRangeParser.getPatternDescription('2,3x'), 'Pattern invalide');

    const field = parseValueList('*2,3x');
    assert.equal(field.isList, true);
    assert.deepEqual(field.values, []);
}

function testHugeRangeIsRefused(): void {
    assert.deepEqual(parseValuePattern('0-99999999'), []);
    assert.equal(parseValuePattern('0-999').length, 1000);
    assert.deepEqual(parseValuePattern('0-999,5000'), []);
}

function testSingleValueFieldIsUnchanged(): void {
    assert.deepEqual(parseValueList('5'), { raw: '5', values: [5], isList: false });
    assert.deepEqual(parseValueList('1-5').values, []);
    assert.equal(parseValueList('1-5').isList, false);
    assert.deepEqual(parseValueList('').values, []);
}

function testDescriptions(): void {
    assert.equal(formatValues([1, 2, 3, 7, 9]), '1-3, 7, 9');
    assert.equal(formatValues([4, 5]), '4, 5');
    assert.equal(ValueRangeParser.getPatternDescription('7'), 'Valeur unique : 7');
    assert.equal(ValueRangeParser.getPatternDescription('1-3,7,>=8'), '6 valeurs : 1-3, 7-9');
}

function run(): void {
    testSameValuesInPanelAndValueField();
    testStarAlone();
    testInvalidPatternIsNeverPartiallyApplied();
    testHugeRangeIsRefused();
    testSingleValueFieldIsUnchanged();
    testDescriptions();
    // eslint-disable-next-line no-console
    console.log('value-pattern tests passed');
}

run();
