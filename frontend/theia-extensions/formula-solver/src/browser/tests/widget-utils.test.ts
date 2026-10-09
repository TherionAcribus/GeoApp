import * as assert from 'assert/strict';

import { LetterValue } from '../../common/types';
import { CoordinatePreviewEngine } from '../preview/coordinate-preview-engine';
import { buildPreviewOverlayDetail } from '../utils/preview-overlay';
import { buildWaypointNote, formatGeocachingCoordinates } from '../utils/waypoint-format';

const engine = new CoordinatePreviewEngine();
const FORMULA = { north: 'N 47° 53.12A', east: 'E 006° 09.456' };
// Origine : N 47° 53.123 E 006° 09.456
const ORIGIN = { originLat: 47 + 53.123 / 60, originLon: 6 + 9.456 / 60 };

function value(letter: string, raw: string, numeric: number, type: LetterValue['type'] = 'value'): [string, LetterValue] {
    return [letter, { letter, rawValue: raw, value: numeric, type }];
}

function testFormatGeocachingCoordinates(): void {
    assert.equal(formatGeocachingCoordinates(47 + 53.123 / 60, 6 + 9.456 / 60), 'N 47° 53.123 E 006° 9.456');
    assert.equal(formatGeocachingCoordinates(-33.5, -70.25), 'S 33° 30.000 W 070° 15.000');
}

function testWaypointNote(): void {
    const coords = { ddm: 'N 47° 53.123 E 006° 09.456', dms: 'DMS', decimal: '47.88, 6.15' };

    const fromValues = buildWaypointNote(FORMULA, coords, new Map([value('A', 'Paris', 63, 'checksum')]));
    assert.equal(
        fromValues,
        'Solution Formula Solver\n\nFormule:\nN 47° 53.12A E 006° 09.456\n\nValeurs:\nA=63 (Paris, type: checksum)\n\n'
        + 'Coordonnées:\nN 47° 53.123 E 006° 09.456\nDMS\n47.88, 6.15'
    );

    const fromCombination = buildWaypointNote(FORMULA, { ddm: 'X' }, { A: 3, B: 7 });
    assert.match(fromCombination, /Valeurs:\nA=3\nB=7\n\nCoordonnées:\nX$/);

    assert.match(buildWaypointNote(undefined, {}, {}), /Formule:\nFormule inconnue\n\nValeurs:\nAucune valeur/);
}

function testOverlayNothingToShow(): void {
    assert.equal(buildPreviewOverlayDetail({}), undefined);
}

function testOverlayCircleOnlyWithoutFormula(): void {
    const detail = buildPreviewOverlayDetail({ gcCode: 'GC1', geocacheId: 1, ...ORIGIN });
    assert.ok(detail);
    assert.equal(detail!.gcCode, 'GC1');
    assert.ok(Math.abs(detail!.circle!.radiusMeters - 3218.688) < 1e-6);
    assert.equal(detail!.candidateRaw, undefined);
}

function testOverlayCandidateKinds(): void {
    // Lettre manquante dans les millièmes de latitude : la zone est un segment nord-sud
    const partial = buildPreviewOverlayDetail({ ...ORIGIN, preview: engine.build(FORMULA, new Map()) });
    assert.equal(partial!.candidateRaw!.kind, 'line-lon');
    assert.equal(partial!.candidateRaw!.formatted, undefined);
    assert.equal(partial!.candidateClipped!.kind, 'line-lon');

    // Toutes les lettres connues : un point, avec sa coordonnée formatée
    const full = buildPreviewOverlayDetail({ ...ORIGIN, preview: engine.build(FORMULA, new Map([value('A', '3', 3)])) });
    assert.equal(full!.candidateRaw!.kind, 'point');
    assert.equal(full!.candidateRaw!.formatted, 'N47°53.123 E006°09.456');
}

function testOverlayClippedAwayFromOrigin(): void {
    // Zone estimée à des dizaines de km de l'origine : rien dans le cercle
    const far = buildPreviewOverlayDetail({
        ...ORIGIN,
        preview: engine.build({ north: 'N 47° 10.12A', east: 'E 006° 09.456' }, new Map())
    });
    assert.ok(far!.candidateRaw);
    assert.equal(far!.candidateClipped, undefined);

    // Sans origine : la zone brute seule, pas de cercle
    const noOrigin = buildPreviewOverlayDetail({ preview: engine.build(FORMULA, new Map()) });
    assert.equal(noOrigin!.circle, undefined);
    assert.ok(noOrigin!.candidateRaw);
    assert.equal(noOrigin!.candidateClipped, undefined);
}

function run(): void {
    testFormatGeocachingCoordinates();
    testWaypointNote();
    testOverlayNothingToShow();
    testOverlayCircleOnlyWithoutFormula();
    testOverlayCandidateKinds();
    testOverlayClippedAwayFromOrigin();
    // eslint-disable-next-line no-console
    console.log('widget-utils tests passed');
}

run();
