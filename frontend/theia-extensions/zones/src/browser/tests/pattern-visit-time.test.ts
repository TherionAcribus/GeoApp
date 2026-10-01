/**
 * `@visit_time` : heure de visite notée par le GPS, dans un onglet ouvert depuis
 * « Visites GPS ». Ailleurs, le pattern reste visible (`[visit_time]`).
 */
import * as assert from 'assert/strict';
import {
    PatternResolutionContext,
    formatVisitTime,
    getBuiltinPatterns,
    getPatternResolutionSignature,
    resolveAllPatterns,
} from '../log-editor/pattern-resolver';

const context: PatternResolutionContext = {
    geocaches: [
        { id: 1, gc_code: 'GC1', name: 'Un' },
        { id: 2, gc_code: 'GC2', name: 'Deux' },
    ],
    perCacheLogType: {},
    logType: 'found',
    userFindsCount: 10,
    logDate: '2026-09-27',
    customPatterns: [],
    perCacheVisitTime: { 1: '10:32', 2: '9:05' },
};

function testResolution(): void {
    assert.ok(getBuiltinPatterns().some(p => p.name === 'visit_time'));
    assert.equal(resolveAllPatterns('Trouvée à @visit_time.', 1, context), 'Trouvée à 10h32.');
    assert.equal(resolveAllPatterns('@visit_time', 2, context), '9h05');
    // Texte commun (pas de cache précise) ou onglet sans visites GPS : reste visible.
    assert.equal(resolveAllPatterns('@visit_time', null, context), '[visit_time]');
    assert.equal(resolveAllPatterns('@visit_time', 1, { ...context, perCacheVisitTime: undefined }), '[visit_time]');
    assert.equal(formatVisitTime('bizarre'), 'bizarre');
}

function testSignatureFollowsVisitTimes(): void {
    // Le cache de résolution doit voir un changement d'heures (nouvel onglet GPS).
    const before = getPatternResolutionSignature(context);
    const after = getPatternResolutionSignature({ ...context, perCacheVisitTime: { 1: '11:00' } });
    assert.notDeepEqual(before, after);
}

testResolution();
testSignatureFollowsVisitTimes();

console.log('pattern-visit-time tests passed');
