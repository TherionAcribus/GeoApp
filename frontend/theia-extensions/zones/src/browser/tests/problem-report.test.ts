/**
 * Signalements (Needs Maintenance / Needs Archived) : règles de compatibilité,
 * texte proposé, ce qui reste à envoyer, restauration depuis un brouillon.
 */
import * as assert from 'assert/strict';
import {
    defaultProblemText,
    describePendingProblems,
    describeProblemOutcome,
    getProblemCategory,
    isProblemPending,
    problemCategoryRefusal,
    sanitizeProblemReports,
    validateProblemReports,
} from '../log-editor/problem-report';
import { GeocacheListItem, LogTypeValue, ProblemReport, ProblemSubmitStatus } from '../log-editor/types';

function gc(id: number, cacheType = 'Traditional Cache'): GeocacheListItem {
    return { id, gc_code: `GC${id}`, name: `Cache ${id}`, cache_type: cacheType };
}

function testRefusals(): void {
    // Comme c:geo : pas de « disparue » sur une trouvaille, pas de carnet sur un DNF.
    assert.ok(problemCategoryRefusal('missing', 'found', 'Traditional Cache'));
    assert.equal(problemCategoryRefusal('missing', 'dnf', 'Traditional Cache'), undefined);
    assert.ok(problemCategoryRefusal('logFull', 'dnf', 'Traditional Cache'));
    assert.ok(problemCategoryRefusal('damaged', 'found', 'Virtual Cache'));
    assert.equal(problemCategoryRefusal('needsMaintenance', 'skip', 'Webcam Cache'), undefined);
    assert.equal(getProblemCategory('archive').logTypeLabel, 'Needs Archived');
}

function testDefaultText(): void {
    assert.equal(defaultProblemText('logFull'), 'Le carnet de logs est plein.');
    assert.equal(defaultProblemText('logFull', { logFull: '  Logbook full, merci !  ' }), 'Logbook full, merci !');
    // Une valeur vide dans les préférences ne remplace pas le texte par défaut.
    assert.equal(defaultProblemText('logFull', { logFull: '   ' }), 'Le carnet de logs est plein.');
}

function testPending(): void {
    const report: ProblemReport = { category: 'needsMaintenance', text: 'x' };
    assert.ok(isProblemPending(report, undefined));
    assert.ok(isProblemPending(report, 'failed'));
    // Parti, ou peut-être parti : jamais renvoyé automatiquement.
    assert.ok(!isProblemPending(report, 'ok'));
    assert.ok(!isProblemPending(report, 'uncertain'));
    assert.ok(!isProblemPending(undefined, undefined));
}

function testValidation(): void {
    const caches = [gc(1), gc(2), gc(3), gc(4)];
    const reports: Record<number, ProblemReport> = {
        1: { category: 'missing', text: 'Disparue ?' },
        2: { category: 'needsMaintenance', text: '   ' },
        3: { category: 'logFull', text: 'Plein' },
        4: { category: 'missing', text: 'Déjà parti' },
    };
    const status: Record<number, ProblemSubmitStatus> = { 4: 'ok' };
    const types: Record<number, LogTypeValue> = { 1: 'found', 2: 'found', 3: 'found', 4: 'found' };
    const issues = validateProblemReports(caches, reports, status, id => types[id]);
    assert.deepEqual(issues.map(i => i.gc.id), [1, 2]);
}

function testSummaryLines(): void {
    const caches = [gc(1), gc(2), gc(3)];
    const reports: Record<number, ProblemReport> = {
        1: { category: 'needsMaintenance', text: 'a' },
        2: { category: 'archive', text: 'b' },
        3: { category: 'logWet', text: 'c' },
    };
    assert.equal(
        describePendingProblems(caches, reports, { 3: 'ok' }),
        '⚠️ Signalements : 1 × Needs Maintenance, 1 × Needs Archived — publics, le propriétaire est prévenu'
    );
    assert.equal(describePendingProblems(caches, {}, {}), undefined);
    assert.equal(describeProblemOutcome({ ok: 2, failed: 0, uncertain: 1 }),
        'Signalements : 2 envoyés, 1 à vérifier sur la page de la cache.');
    assert.equal(describeProblemOutcome({ ok: 0, failed: 0, uncertain: 0 }), undefined);
}

function testSanitize(): void {
    const restored = sanitizeProblemReports({
        reports: { 1: { category: 'logFull', text: 'Plein' }, 2: { category: 'inconnue', text: 'x' }, 9: { category: 'other', text: 'y' } },
        status: { 1: 'uncertain', 2: 'bizarre' },
        references: { 1: 'GLNM1', 9: 'GLX' },
    }, new Set([1, 2]));
    assert.deepEqual(restored, {
        reports: { 1: { category: 'logFull', text: 'Plein' } },
        status: { 1: 'uncertain' },
        references: { 1: 'GLNM1' },
    });
    assert.deepEqual(sanitizeProblemReports(undefined, new Set([1])), { reports: {}, status: {}, references: {} });
}

testRefusals();
testDefaultText();
testPending();
testValidation();
testSummaryLines();
testSanitize();

console.log('problem-report tests passed');
