/**
 * Fermeture de l'onglet de logs après l'envoi : quand elle est permise, et ce que
 * dit la notification qui remplace l'écran.
 *
 * La règle qui compte ici est négative : un échec ou un reste de lot n'existe que
 * dans cet onglet (statuts par ligne, messages d'erreur). Fermer dans ces cas-là
 * effacerait la seule trace de ce qui n'est pas parti — aucun chemin ne doit le faire.
 */
import * as assert from 'assert/strict';
import {
    buildCloseAfterSubmitMessage,
    shouldCloseEditorAfterSubmit,
} from '../log-editor/submission-orchestrator';

function testClosesOnACleanBatch(): void {
    assert.equal(shouldCloseEditorAfterSubmit({ enabled: true, ok: 3, failed: 0, remainingToSubmit: 0 }), true);
}

function testNeverClosesWhenDisabled(): void {
    // Défaut de la préférence : l'onglet reste ouvert, comportement historique.
    assert.equal(shouldCloseEditorAfterSubmit({ enabled: false, ok: 3, failed: 0, remainingToSubmit: 0 }), false);
}

function testNeverClosesOnAFailure(): void {
    assert.equal(shouldCloseEditorAfterSubmit({ enabled: true, ok: 2, failed: 1, remainingToSubmit: 0 }), false);
}

function testNeverClosesWithWorkLeft(): void {
    // Envoi interrompu : les géocaches restantes n'ont d'existence que dans l'onglet.
    assert.equal(shouldCloseEditorAfterSubmit({ enabled: true, ok: 2, failed: 0, remainingToSubmit: 4 }), false);
}

function testNeverClosesWithoutAnySubmission(): void {
    // Lot entièrement "déjà logué" : rien n'a été publié, on laisse l'utilisateur voir pourquoi.
    assert.equal(shouldCloseEditorAfterSubmit({ enabled: true, ok: 0, failed: 0, remainingToSubmit: 0 }), false);
}

function testMessageNamesCachesAndDate(): void {
    const message = buildCloseAfterSubmitMessage({
        ok: 2,
        logDate: '2026-09-21',
        gcCodes: ['GC1234', 'GC5678'],
        notLoggedCount: 0,
    });
    assert.equal(message, '2 logs publiés sur Geocaching.com le 21/09/2026 : GC1234, GC5678. Onglet de logs fermé.');
}

function testMessageIsSingularForOneLog(): void {
    const message = buildCloseAfterSubmitMessage({
        ok: 1,
        logDate: '2026-09-21',
        gcCodes: ['GC1234'],
        notLoggedCount: 0,
    });
    assert.ok(message.startsWith('1 log publié sur Geocaching.com'));
}

function testMessageMentionsSkippedCaches(): void {
    const message = buildCloseAfterSubmitMessage({
        ok: 1,
        logDate: '2026-09-21',
        gcCodes: ['GC1234'],
        notLoggedCount: 2,
    });
    assert.ok(message.includes('2 géocache(s) non loguée(s).'));
}

function testMessageTruncatesLongBatches(): void {
    const codes = ['GC1', 'GC2', 'GC3', 'GC4', 'GC5', 'GC6', 'GC7', 'GC8'];
    const message = buildCloseAfterSubmitMessage({ ok: 8, logDate: '2026-09-21', gcCodes: codes, notLoggedCount: 0 });
    assert.ok(message.includes('GC1, GC2, GC3, GC4, GC5, GC6, +2'));
    assert.ok(!message.includes('GC7'));
}

testClosesOnACleanBatch();
testNeverClosesWhenDisabled();
testNeverClosesOnAFailure();
testNeverClosesWithWorkLeft();
testNeverClosesWithoutAnySubmission();
testMessageNamesCachesAndDate();
testMessageIsSingularForOneLog();
testMessageMentionsSkippedCaches();
testMessageTruncatesLongBatches();

console.log('submission-close-after-submit.test.ts OK');
