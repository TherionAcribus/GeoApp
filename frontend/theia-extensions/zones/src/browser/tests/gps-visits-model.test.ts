/**
 * Visites GPS : libellés, résumé d'un jour, indicateur « ce que l'App sait de la cache »,
 * repères du point de départ.
 */
import * as assert from 'assert/strict';
import {
    GpsVisitDay,
    GpsVisitEntry,
    buildCutoffLandmarks,
    describeCacheKnowledge,
    describeImportReport,
    describePasses,
    formatDayLabel,
    formatShortDay,
    isAlreadyLoggedSameDay,
    pendingEntries,
    shiftIsoDay,
    statusLabel,
    summarizeDay,
    visitIdsOf,
} from '../gps-visits-model';

function entry(overrides: Partial<GpsVisitEntry> = {}): GpsVisitEntry {
    return {
        key: 'GC4NKAY:2026-09-27',
        visit_ids: [1],
        gc_code: 'GC4NKAY',
        raw_code: 'GC4NKAY',
        resolved: false,
        day: '2026-09-27',
        time: '11:45',
        visited_at: '2026-09-27T09:45:00Z',
        status: 'found',
        status_raw: 'Found it',
        proposed_log_type: 'found',
        has_nm: false,
        needs_confirmation: false,
        comment: '',
        raw_count: 1,
        passes: [{ time: '11:45', status_raw: 'Found it' }],
        state: 'pending',
        name: null,
        cache_type: null,
        geocaches: [],
        found: false,
        found_date: null,
        ...overrides,
    };
}

function testPasses(): void {
    assert.equal(describePasses(entry()), undefined);
    const passes = describePasses(entry({
        raw_count: 2,
        passes: [{ time: '11:42', status_raw: "Didn't find it" }, { time: '11:45', status_raw: 'Found it' }],
    }));
    assert.equal(passes?.label, '2 passages');
    assert.equal(passes?.tooltip, "11:42 — Didn't find it\n11:45 — Found it");
}

function testStatusLabel(): void {
    assert.equal(statusLabel(entry()), 'Trouvée');
    // Un libellé inconnu du GPS est montré tel quel plutôt que « Autre ».
    assert.equal(statusLabel(entry({ status: 'other', status_raw: 'Write note' })), 'Write note');
}

function testKnowledge(): void {
    assert.equal(describeCacheKnowledge(entry()).kind, 'to-import');
    assert.equal(describeCacheKnowledge(entry({ gc_code: null, raw_code: '8' })).tooltip, 'Le GPS a écrit « 8 »');
    const inApp = describeCacheKnowledge(entry({
        geocaches: [{ id: 3, zone_id: 1, zone_name: 'Sorties', name: 'X' }, { id: 4, zone_id: 2, zone_name: 'Lyon', name: 'X' }],
    }));
    assert.equal(inApp.kind, 'in-app');
    assert.equal(inApp.label, 'Zone Sorties');
    assert.equal(inApp.tooltip, 'Présente dans : Sorties, Lyon');
    // Trouvée le jour même : un log existe sans doute déjà.
    const sameDay = entry({ found: true, found_date: '2026-09-27T00:00:00' });
    assert.ok(isAlreadyLoggedSameDay(sameDay));
    assert.equal(describeCacheKnowledge(sameDay).kind, 'logged-same-day');
    // Trouvée un autre jour : simple avertissement.
    assert.equal(describeCacheKnowledge(entry({ found: true, found_date: '2024-01-01T00:00:00' })).kind, 'found-before');
}

function testDaySummary(): void {
    const day: GpsVisitDay = {
        day: '2026-09-27',
        entries: [
            entry(),
            entry({ key: 'b', status: 'found' }),
            entry({ key: 'c', status: 'dnf', visit_ids: [5, 6], state: 'ignored' }),
            entry({ key: 'd', status: 'needs_maintenance', has_nm: true }),
            entry({ key: 'e', gc_code: null }),
        ],
    };
    assert.equal(summarizeDay(day), '3 trouvées · 1 non trouvée · 1 NM · 1 sans code');
    assert.deepEqual(visitIdsOf(day.entries), [1, 1, 5, 6, 1, 1]);
    assert.equal(pendingEntries(day).length, 4);
}

function testDates(): void {
    assert.equal(formatDayLabel('2026-09-27'), 'dimanche 27 septembre 2026');
    assert.equal(formatShortDay('2026-09-27'), '27/09');
    assert.equal(shiftIsoDay('2026-03-01', -1), '2026-02-28');
    // Passage à l'heure d'été (29/03/2026) : le calcul en UTC ne perd pas de jour.
    assert.equal(shiftIsoDay('2026-03-30', -7), '2026-03-23');
    assert.deepEqual(buildCutoffLandmarks('2026-09-27'), {
        last_visit_day: '2026-09-27',
        week_before: '2026-09-20',
        month_before: '2026-08-28',
        first_visit_day: null,
    });
}

function testImportReport(): void {
    const base = {
        total: 14629, new: 0, known: 14629, without_code: 374, unreadable_count: 0,
        unreadable: [], needs_cutoff: false, landmarks: null, source: 'H:\\Garmin\\geocache_visits.txt',
    };
    assert.equal(describeImportReport(base), 'Aucune nouvelle visite · 14629 dans le fichier');
    assert.equal(describeImportReport({ ...base, new: 46, unreadable_count: 2 }),
        '46 nouvelles visites · 14629 dans le fichier · 2 lignes illisibles');
}

testPasses();
testStatusLabel();
testKnowledge();
testDaySummary();
testDates();
testImportReport();

console.log('gps-visits-model tests passed');
