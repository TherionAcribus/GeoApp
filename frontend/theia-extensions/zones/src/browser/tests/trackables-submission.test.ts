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
    TrackableDropTracker,
    TrackableSelection,
    applyDropResultsToSelection,
    buildTrackableBatchPlan,
    buildTrackableDropOutcomeLines,
    buildTrackableSummaryLines,
    defaultTrackableAction,
    describeInventorySync,
    describeTrackablesForGeocache,
    filterTrackables,
    hasTrackableChoices,
    quickFilterTrackables,
    resolveDropTarget,
    sanitizeTrackableDropResults,
    sanitizeTrackableSelection,
    summarizeTrackableSelection,
    trackableSelectionOverrides,
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

// -------------------------------------------- Plan figé et suivi des dépôts

/** Lot GC1 (trouvée, cible du dépôt) puis GC3 (trouvée) — la cible est figée. */
function dropPlan() {
    const ctx = batch();
    const sel = selection({ TBVISIT: 'visit', TBDROP: 'drop', TBIDLE: 'none' }, { TBDROP: 1 });
    const toSubmit = [gc(1, 'GC1'), gc(3, 'GC3')];
    return { plan: buildTrackableBatchPlan(toSubmit, INVENTORY, sel, ctx), toSubmit };
}

function testPlanFreezesEntriesAndDropTargets(): void {
    const { plan } = dropPlan();
    // La cible choisie est figée : GC1, pas recalculée ensuite.
    assert.deepEqual(plan.drops.map(d => [d.code, d.targetGeocacheId]), [['TBDROP', 1]]);
    // Payloads identiques à ce que donnait la fonction d'avant le plan.
    assert.deepEqual(plan.entries.get(3), [
        { code: 'TBVISIT', action: 'visit' },
        { code: 'TBIDLE', action: 'none' },
    ]);
}

function testConfirmedDropDisappearsFromLaterPayloads(): void {
    const { plan } = dropPlan();
    const tracker = new TrackableDropTracker(plan);

    tracker.markSubmitted(1);
    tracker.markConfirmed('TBDROP');

    // Le dépôt confirmé retire le TB des logs suivants, comme prévu au plan.
    assert.deepEqual(tracker.effectiveEntries(3), [
        { code: 'TBVISIT', action: 'visit' },
        { code: 'TBIDLE', action: 'none' },
    ]);
    assert.equal(tracker.unresolvedDropsBefore(3).length, 0);
    assert.deepEqual(tracker.outcome().confirmed.map(d => d.code), ['TBDROP']);
}

function testFailedDropStaysInHandOnLaterPayloads(): void {
    const { plan } = dropPlan();
    const tracker = new TrackableDropTracker(plan);

    // GC1 échoue : le dépôt n'est PAS traité comme réussi.
    tracker.markSubmitted(1);
    tracker.markFailed('TBDROP');

    // GC3 dépendait du dépôt : le TB y revient en « none » (encore en main),
    // au lieu de disparaître comme le plan l'aurait cru.
    assert.deepEqual(tracker.effectiveEntries(3).find(e => e.code === 'TBDROP'), { code: 'TBDROP', action: 'none' });
    // Et le dépôt n'est jamais rejoué sur une autre cache.
    assert.equal(tracker.effectiveEntries(3).some(e => e.action === 'drop'), false);
    assert.deepEqual(tracker.unresolvedDropsBefore(3).map(d => d.code), ['TBDROP']);

    const outcome = tracker.outcome();
    assert.deepEqual(outcome.failed.map(d => d.code), ['TBDROP']);
    assert.equal(outcome.confirmed.length, 0);
}

function testUncertainDropIsNotSilentlyResolved(): void {
    const { plan } = dropPlan();
    const tracker = new TrackableDropTracker(plan);

    tracker.markSubmitted(1);
    tracker.markUncertain('TBDROP');

    // Incertain ≠ confirmé : encore « en main » dans le payload, signalé à la fin.
    assert.deepEqual(tracker.effectiveEntries(3).find(e => e.code === 'TBDROP'), { code: 'TBDROP', action: 'none' });
    const outcome = tracker.outcome();
    assert.deepEqual(outcome.uncertain.map(d => d.code), ['TBDROP']);
}

function testDropOutcomeLinesDistinguishStates(): void {
    const lines = buildTrackableDropOutcomeLines({
        confirmed: [{ code: 'TBOK', targetGeocacheId: 1, targetGcCode: 'GC1' }],
        failed: [{ code: 'TBKO', targetGeocacheId: 1, targetGcCode: 'GC1' }],
        uncertain: [{ code: 'TBQ', targetGeocacheId: 2, targetGcCode: 'GC2' }],
    });
    assert.equal(lines.length, 3);
    assert.match(lines[0].text, /TBOK déposé/);
    assert.match(lines[1].text, /TBKO.*encore en main/);
    assert.match(lines[2].text, /TBQ.*incertain.*Geocaching\.com/);
    assert.deepEqual(lines.map(l => l.highlight), [false, true, true]);
}

function testDropResultsNeutralizeARestoredDrop(): void {
    const sel = selection({ TBDROP: 'drop' }, { TBDROP: 3 });
    // Un dépôt « confirmed » ou « uncertain » dans le lot interrompu n'est jamais rejoué.
    const confirmed = applyDropResultsToSelection(sel, { TBDROP: 'confirmed' });
    assert.equal(confirmed.selection.actions.TBDROP, 'none');
    assert.equal(confirmed.selection.dropTargets.TBDROP, undefined);
    assert.deepEqual(confirmed.cleared, ['TBDROP']);

    // Un TB sans résultat enregistré garde son choix « Déposé ».
    const untouched = applyDropResultsToSelection(sel, { TBVISIT: 'confirmed' });
    assert.equal(untouched.selection.actions.TBDROP, 'drop');
    assert.equal(untouched.cleared.length, 0);

    assert.deepEqual(sanitizeTrackableDropResults({ TBA: 'confirmed', TBB: 'uncertain', TBC: 'failed', TDD: 1 }),
        { TBA: 'confirmed', TBB: 'uncertain' });
    assert.deepEqual(sanitizeTrackableDropResults(null), {});
}

function testSanitizeRestoredSelection(): void {
    assert.deepEqual(
        sanitizeTrackableSelection({ actions: { TBA: 'visit', TBB: 'grab' }, dropTargets: { TBA: 3, TBB: 'x' } }),
        { actions: { TBA: 'visit' }, dropTargets: { TBA: 3 } }
    );
    assert.deepEqual(sanitizeTrackableSelection(null), { actions: {}, dropTargets: {} });
}

// -------------------------------------------- Brouillon : overrides (P1-06)

function testOverridesOnlyStoreDeviations(): void {
    // Table complète en mémoire, mais un seul choix exprimé : TBDROP en « Déposé ».
    const full = withDefaultActions(INVENTORY, { TBDROP: 'drop' }, false);
    const sel = selection(full, { TBDROP: 3 });
    const overrides = trackableSelectionOverrides(INVENTORY, sel, false);
    // TBVISIT (visit = défaut last_action) et TBIDLE (none = défaut) ne sont pas sérialisés.
    assert.deepEqual(overrides.actions, { TBDROP: 'drop' });
    assert.deepEqual(overrides.dropTargets, { TBDROP: 3 });
    // Un « drop » sans cible explicite reste un override sans cible (défaut : dernière trouvée).
    assert.deepEqual(
        trackableSelectionOverrides(INVENTORY, selection({ TBDROP: 'drop' }), false).dropTargets,
        {}
    );
    // Une cible posée sur une action qui n'est pas « drop » n'est pas gardée.
    assert.deepEqual(
        trackableSelectionOverrides(INVENTORY, selection({ TBIDLE: 'visit' }, { TBIDLE: 1 }), false).dropTargets,
        {}
    );
}

function testOverridesReapplyOverFreshDefaults(): void {
    // Le brouillon ne porte que l'écart ; entre-temps la préférence « visite auto »
    // est passée à vrai : les TBs sans override prennent le nouveau défaut.
    const overrides = trackableSelectionOverrides(
        INVENTORY, selection(withDefaultActions(INVENTORY, { TBIDLE: 'visit' }, false)), false
    );
    assert.deepEqual(overrides.actions, { TBIDLE: 'visit' });

    // Restauration : défauts recalculés avec autoVisit=true, puis overrides.
    const freshDefaults = withDefaultActions(INVENTORY, {}, true);
    const restored = { ...freshDefaults, ...overrides.actions };
    assert.equal(restored.TBDROP, 'visit');   // nouveau défaut appliqué (pas figé à 'none')
    assert.equal(restored.TBVISIT, 'visit');
    assert.equal(restored.TBIDLE, 'visit');   // override conservé
}

function testInventorySyncMessage(): void {
    assert.equal(
        describeInventorySync({ fetched: 70, added: 1, removed: 0 }),
        'Inventaire relu sur Geocaching.com : 70 trackable(s) en main (1 entré).'
    );
    assert.equal(
        describeInventorySync({ fetched: 69, added: 0, removed: 2 }),
        'Inventaire relu sur Geocaching.com : 69 trackable(s) en main (2 sortis).'
    );
    assert.equal(
        describeInventorySync({ fetched: 70 }),
        'Inventaire relu sur Geocaching.com : 70 trackable(s) en main, aucun changement.'
    );
}

function testQuickFiltersByActionAndError(): void {
    const actions = { TBVISIT: 'visit' as const, TBDROP: 'drop' as const };
    const codes = (list: InventoryTrackable[]): string[] => list.map(tb => tb.reference_code);
    assert.deepEqual(codes(quickFilterTrackables(INVENTORY, 'all', actions, {})), ['TBVISIT', 'TBDROP', 'TBIDLE']);
    assert.deepEqual(codes(quickFilterTrackables(INVENTORY, 'none', actions, {})), ['TBIDLE']);
    assert.deepEqual(codes(quickFilterTrackables(INVENTORY, 'visit', actions, {})), ['TBVISIT']);
    assert.deepEqual(codes(quickFilterTrackables(INVENTORY, 'drop', actions, {})), ['TBDROP']);
    // « En erreur » : dépôts au résultat incertain, quel que soit l'état du choix courant.
    assert.deepEqual(codes(quickFilterTrackables(INVENTORY, 'error', actions, {})), []);
    assert.deepEqual(
        codes(quickFilterTrackables(INVENTORY, 'error', actions, { TBDROP: 'uncertain', TBVISIT: 'confirmed' })),
        ['TBDROP']
    );
}

testInventorySyncMessage();
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
testPlanFreezesEntriesAndDropTargets();
testConfirmedDropDisappearsFromLaterPayloads();
testFailedDropStaysInHandOnLaterPayloads();
testUncertainDropIsNotSilentlyResolved();
testDropOutcomeLinesDistinguishStates();
testDropResultsNeutralizeARestoredDrop();
testOverridesOnlyStoreDeviations();
testOverridesReapplyOverFreshDefaults();
testQuickFiltersByActionAndError();

console.log('trackables-submission tests passed');
