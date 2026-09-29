/**
 * Trackables dans l'éditeur de logs : actions par défaut, répartition sur un lot,
 * payload envoyé et récapitulatif.
 *
 * Les règles qui comptent : un TB déposé ne suit plus le lot après sa cache de
 * dépôt, ne visite pas les caches d'avant, et un DNF ne porte jamais de TB.
 */
import * as assert from 'assert/strict';
import { buildLogSubmissionPayload } from '../log-editor/submission-orchestrator';
import {
    InventoryTrackable,
    TrackableBatchContext,
    TrackableSelection,
    buildTrackableSummaryLines,
    defaultTrackableAction,
    describeTrackablesForGeocache,
    filterTrackables,
    hasTrackableChoices,
    resolveDropTarget,
    sanitizeTrackableSelection,
    summarizeTrackableSelection,
    trackablesForGeocache,
    validateTrackableSelection,
    withDefaultActions,
} from '../log-editor/trackables';
import { GeocacheListItem, LogTypeValue } from '../log-editor/types';

const INVENTORY: InventoryTrackable[] = [
    { reference_code: 'TBVISIT', name: 'Voyageur', last_cache_log_action: 'visit' },
    { reference_code: 'TBDROP', name: 'Géocoin Éléphant', type_name: 'Geocoin' },
    { reference_code: 'TBIDLE', name: 'Dormeur', last_cache_log_action: 'none' },
];

function gc(id: number, code: string): GeocacheListItem {
    return { id, gc_code: code, name: `Cache ${code}` };
}

/** Lot de trois caches : 1 et 3 trouvées, 2 en DNF. */
function batch(overrides: Partial<Record<number, LogTypeValue>> = {}, submitted: number[] = []): TrackableBatchContext {
    const types: Record<number, LogTypeValue> = { 1: 'found', 2: 'dnf', 3: 'found', ...overrides };
    return {
        geocaches: [gc(1, 'GC1'), gc(2, 'GC2'), gc(3, 'GC3')],
        getLogType: id => types[id],
        willSubmit: id => !submitted.includes(id) && types[id] !== 'skip',
    };
}

function selection(actions: TrackableSelection['actions'], dropTargets: TrackableSelection['dropTargets'] = {}): TrackableSelection {
    return { actions, dropTargets };
}

function testDefaultsFollowLastActionThenPreference(): void {
    assert.equal(defaultTrackableAction(INVENTORY[0], false), 'visit');
    assert.equal(defaultTrackableAction(INVENTORY[2], true), 'none');
    assert.equal(defaultTrackableAction(INVENTORY[1], false), 'none');
    assert.equal(defaultTrackableAction(INVENTORY[1], true), 'visit');
    // Un dépôt mémorisé n'est jamais repris d'office.
    assert.equal(defaultTrackableAction({ reference_code: 'TBX', last_cache_log_action: 'drop' }, false), 'none');
}

function testWithDefaultActionsKeepsUserChoicesAndDropsUnknownCodes(): void {
    const actions = withDefaultActions(INVENTORY, { TBDROP: 'drop', TBGONE: 'visit' }, false);
    assert.deepEqual(actions, { TBVISIT: 'visit', TBDROP: 'drop', TBIDLE: 'none' });
}

function testHasTrackableChoicesOnlyWhenUserDeviatesFromDefaults(): void {
    const defaults = withDefaultActions(INVENTORY, {}, false);
    assert.equal(hasTrackableChoices(INVENTORY, selection(defaults), false), false);
    assert.equal(hasTrackableChoices(INVENTORY, selection({ ...defaults, TBIDLE: 'visit' }), false), true);
}

function testDropTargetDefaultsToLastFoundCache(): void {
    const ctx = batch();
    assert.equal(resolveDropTarget('TBDROP', selection({ TBDROP: 'drop' }), ctx), 3);
    assert.equal(resolveDropTarget('TBDROP', selection({ TBDROP: 'drop' }, { TBDROP: 1 }), ctx), 1);
    // Une cible devenue invalide (DNF) retombe sur la dernière trouvée.
    assert.equal(resolveDropTarget('TBDROP', selection({ TBDROP: 'drop' }, { TBDROP: 2 }), ctx), 3);
}

function testBatchSpreadsVisitsAndDropsInSendOrder(): void {
    const ctx = batch();
    const sel = selection({ TBVISIT: 'visit', TBDROP: 'drop', TBIDLE: 'none' }, { TBDROP: 1 });

    // Cache 1 : visite + dépôt ici ; « none » transmis pour la mémoire du backend.
    assert.deepEqual(trackablesForGeocache(1, INVENTORY, sel, ctx), [
        { code: 'TBVISIT', action: 'visit' },
        { code: 'TBDROP', action: 'drop' },
        { code: 'TBIDLE', action: 'none' },
    ]);
    // Cache 2 : DNF, aucun TB.
    assert.deepEqual(trackablesForGeocache(2, INVENTORY, sel, ctx), []);
    // Cache 3 : le TB déposé en 1 n'est plus en main.
    assert.deepEqual(trackablesForGeocache(3, INVENTORY, sel, ctx), [
        { code: 'TBVISIT', action: 'visit' },
        { code: 'TBIDLE', action: 'none' },
    ]);
}

function testDroppedTrackableDoesNotVisitEarlierCaches(): void {
    const ctx = batch();
    const sel = selection({ TBDROP: 'drop' });  // cible par défaut : cache 3
    assert.deepEqual(
        trackablesForGeocache(1, INVENTORY, sel, ctx).find(e => e.code === 'TBDROP'),
        { code: 'TBDROP', action: 'none' }
    );
    assert.deepEqual(
        trackablesForGeocache(3, INVENTORY, sel, ctx).find(e => e.code === 'TBDROP'),
        { code: 'TBDROP', action: 'drop' }
    );
}

function testNotesCarryVisitsButCannotReceiveDrops(): void {
    const ctx = batch({ 1: 'note', 3: 'note' });
    const sel = selection({ TBVISIT: 'visit', TBDROP: 'drop' });
    assert.deepEqual(trackablesForGeocache(1, INVENTORY, sel, ctx).map(e => e.code), ['TBVISIT', 'TBIDLE']);
    const issues = validateTrackableSelection(INVENTORY, sel, ctx);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].code, 'TBDROP');
}

function testAlreadySubmittedCachesAreNotDropCandidates(): void {
    const ctx = batch({}, [3]);
    assert.equal(resolveDropTarget('TBDROP', selection({ TBDROP: 'drop' }), ctx), 1);
    assert.equal(validateTrackableSelection(INVENTORY, selection({ TBDROP: 'drop' }), batch({ 1: 'skip' }, [3])).length, 1);
}

function testPayloadCarriesTrackablesOnlyWhenPresent(): void {
    const without = buildLogSubmissionPayload('Merci', '2026-09-29', 'found', false, []);
    assert.equal('trackables' in without, false);
    const withTbs = buildLogSubmissionPayload('Merci', '2026-09-29', 'found', false, [], [{ code: 'TBVISIT', action: 'visit' }]);
    assert.deepEqual(withTbs.trackables, [{ code: 'TBVISIT', action: 'visit' }]);
}

function testSummaryLinesAndWarning(): void {
    const ctx = batch();
    const summary = summarizeTrackableSelection(INVENTORY, selection({ TBVISIT: 'visit', TBDROP: 'drop' }, { TBDROP: 1 }), ctx);
    assert.deepEqual(summary, { visitCount: 1, drops: [{ code: 'TBDROP', name: 'Géocoin Éléphant', gcCode: 'GC1' }] });
    assert.deepEqual(buildTrackableSummaryLines(summary, 2), [
        { text: '🐞 1 TB visité(s) sur chacun des 2 logs trouvés/notes', highlight: false },
        { text: '📦 TBDROP (Géocoin Éléphant) déposé dans GC1', highlight: false },
    ]);

    const many = buildTrackableSummaryLines({ visitCount: 101, drops: [] }, 1);
    assert.equal(many.length, 2);
    assert.equal(many.every(line => line.highlight), true);
}

function testPerCacheDescription(): void {
    assert.equal(describeTrackablesForGeocache([
        { code: 'TBA', action: 'visit' },
        { code: 'TBB', action: 'visit' },
        { code: 'TBC', action: 'drop' },
        { code: 'TBD', action: 'none' },
    ]), '2 TB visités · TBC déposé');
    assert.equal(describeTrackablesForGeocache([{ code: 'TBD', action: 'none' }]), undefined);
}

function testFilterIgnoresCaseAndAccents(): void {
    assert.deepEqual(filterTrackables(INVENTORY, 'elephant').map(tb => tb.reference_code), ['TBDROP']);
    assert.deepEqual(filterTrackables(INVENTORY, 'geocoin').map(tb => tb.reference_code), ['TBDROP']);
    assert.equal(filterTrackables(INVENTORY, '  ').length, 3);
}

function testSanitizeRestoredSelection(): void {
    assert.deepEqual(
        sanitizeTrackableSelection({ actions: { TBA: 'visit', TBB: 'grab' }, dropTargets: { TBA: 3, TBB: 'x' } }),
        { actions: { TBA: 'visit' }, dropTargets: { TBA: 3 } }
    );
    assert.deepEqual(sanitizeTrackableSelection(null), { actions: {}, dropTargets: {} });
}

testDefaultsFollowLastActionThenPreference();
testWithDefaultActionsKeepsUserChoicesAndDropsUnknownCodes();
testHasTrackableChoicesOnlyWhenUserDeviatesFromDefaults();
testDropTargetDefaultsToLastFoundCache();
testBatchSpreadsVisitsAndDropsInSendOrder();
testDroppedTrackableDoesNotVisitEarlierCaches();
testNotesCarryVisitsButCannotReceiveDrops();
testAlreadySubmittedCachesAreNotDropCandidates();
testPayloadCarriesTrackablesOnlyWhenPresent();
testSummaryLinesAndWarning();
testPerCacheDescription();
testFilterIgnoresCaseAndAccents();
testSanitizeRestoredSelection();

console.log('trackables-submission tests passed');
