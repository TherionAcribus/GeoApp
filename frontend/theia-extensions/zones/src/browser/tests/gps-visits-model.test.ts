/**
 * Visites GPS : libellés, résumé d'un jour, indicateur « ce que l'App sait de la cache »,
 * repères du point de départ.
 */
import * as assert from 'assert/strict';
import {
    GpsResolutionCandidate,
    GpsResolutionResult,
    GpsVisitDay,
    GpsVisitEntry,
    buildCutoffLandmarks,
    GpsPreparationPlan,
    GpsPreparedEntry,
    buildLogEditorOpenings,
    daySelectionState,
    defaultOutingZoneName,
    describePreparation,
    isSelectable,
    describeCacheKnowledge,
    describeCandidateDay,
    describeImportReport,
    describeNeighbours,
    describePasses,
    formatDistance,
    formatDayLabel,
    formatFullDay,
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

function prepared(overrides: Partial<GpsVisitEntry>, plan: GpsPreparationPlan, target: number | null): GpsPreparedEntry {
    return { ...entry(overrides), plan, target_geocache_id: target };
}

function testLogEditorOpenings(): void {
    const openings = buildLogEditorOpenings({
        days: ['2026-09-26', '2026-09-27'],
        entries: [
            prepared({ key: 'a', comment: 'Horse', raw_count: 2, passes: [
                { time: '11:42', status_raw: "Didn't find it" }, { time: '11:45', status_raw: 'Found it' },
            ] }, 'existing', 12),
            prepared({ key: 'b', gc_code: 'GC2', time: '12:00', status: 'needs_maintenance', status_raw: 'Needs Maintenance',
                has_nm: true, needs_confirmation: true }, 'copy', 7),
            // Ajout en échec : pas de géocache dans la zone, laissée de côté.
            prepared({ key: 'c', gc_code: 'GC3', status: 'dnf', proposed_log_type: 'dnf' }, 'download', null),
            prepared({ key: 'd', gc_code: 'GC4', day: '2026-09-26', time: '16:00' }, 'existing', 3),
        ],
        excluded: [],
        counts: { existing: 2, copy: 1, gps: 0, download: 1, without_code: 0, unattempted: 0 },
        zone_id: 1,
        suggested_zone_id: null,
    });
    // Un onglet par jour, dans l'ordre des jours ; dans un jour, l'ordre de visite (il numérote @cache_count).
    assert.deepEqual(openings.map(o => o.prefill.logDate), ['2026-09-26', '2026-09-27']);
    const [first, second] = openings;
    assert.deepEqual(first.geocacheIds, [3]);
    assert.deepEqual(second.geocacheIds, [12, 7]);
    assert.equal(second.title, 'Log GPS — 27/09');
    assert.deepEqual(second.prefill.perCacheLogType, { 12: 'found', 7: 'found' });
    assert.deepEqual(second.prefill.perCacheVisit[12], {
        time: '11:45', statusRaw: 'Found it', comment: 'Horse',
        passes: "11:42 — Didn't find it\n11:45 — Found it", hasNm: undefined, needsConfirmation: undefined,
    });
    assert.equal(second.prefill.perCacheVisit[7].needsConfirmation, true);
    assert.equal(formatFullDay('2026-09-27'), '27/09/2026');
}

function testOutingZoneName(): void {
    assert.equal(defaultOutingZoneName(['2026-09-27']), 'Sortie du 27/09/2026');
    assert.equal(defaultOutingZoneName(['2026-09-27', '2026-09-26']), 'Sortie du 26 au 27/09/2026');
    assert.equal(defaultOutingZoneName(['2026-09-30', '2026-10-01']), 'Sortie du 30/09 au 01/10/2026');
    assert.equal(defaultOutingZoneName(['2025-12-31', '2026-01-01']), 'Sortie du 31/12/2025 au 01/01/2026');
    assert.equal(defaultOutingZoneName([]), 'Sortie');
}

function testPreparationSummary(): void {
    const lines = describePreparation({ existing: 1, copy: 43, gps: 3, download: 2, without_code: 1, unattempted: 0 }, true);
    assert.deepEqual(lines, [
        '🆕 La zone sera créée.',
        '✔️ 1 cache déjà dans la zone',
        '➕ 43 caches connues ailleurs, ajoutées à la zone (elles restent aussi dans leurs zones)',
        '📟 3 caches créées depuis les GPX du GPS (sans téléchargement)',
        '⬇️ 2 caches à télécharger',
        "⏭️ 1 visite sans code laissée de côté (à rattacher d'abord)",
    ]);
}

function testSelection(): void {
    const day: GpsVisitDay = {
        day: '2026-09-27',
        entries: [entry({ key: 'a' }), entry({ key: 'b' }), entry({ key: 'c', gc_code: null }), entry({ key: 'd', state: 'logged' })],
    };
    assert.ok(isSelectable(day.entries[0]));
    assert.ok(!isSelectable(day.entries[2]), 'sans code : à rattacher avant');
    assert.ok(!isSelectable(day.entries[3]), 'déjà loguée');
    assert.equal(daySelectionState(day, new Set()), 'none');
    assert.equal(daySelectionState(day, new Set(['a'])), 'some');
    assert.equal(daySelectionState(day, new Set(['a', 'b'])), 'all');
}

function testResolutionDisplay(): void {
    assert.equal(formatDistance(129.4), '129 m');
    assert.equal(formatDistance(1663), '1,7 km');
    assert.equal(formatDistance(null), undefined);

    const base: GpsResolutionCandidate = {
        gc_code: 'GC94Y25', name: '#15', cache_type: 'Traditional', found_by_me: true, found_on: '2021-06-13',
        sources: ['neighbours'], day_confidence: 'confirmed', distance_m: 202,
    };
    assert.deepEqual(describeCandidateDay(base), { kind: 'strong', label: 'Trouvée ce jour-là' });
    assert.equal(describeCandidateDay({ ...base, day_confidence: 'close_day', found_on: '2021-06-14' }).label,
        'Trouvée le 14/06/2021 (log à quelques jours près)');
    assert.equal(describeCandidateDay({ ...base, day_confidence: null, found_by_me: null, found_on: null }).label,
        'Jamais trouvée (DNF ?)');

    const result: GpsResolutionResult = {
        visit_id: 1, day: '2021-06-13', located: true, search_radius_m: 1110, finds_state: 'not_requested',
        candidates: [], authenticated: true,
        neighbours: [{ gc_code: 'GC2RE4R', name: 'le repos du celte', located: true }, { gc_code: 'GC2RE7H', name: null, located: false }],
    };
    assert.equal(describeNeighbours(result),
        'Situé grâce à GC2RE4R (le repos du celte) et GC2RE7H — non située, recherche dans un rayon d\'environ 1,1 km.');
    assert.equal(describeNeighbours({ ...result, neighbours: [] }),
        'Aucune visite codée à moins d\'1 h 30 ce jour-là : la recherche de proximité est impossible.');
}

function testDeviceData(): void {
    const onGps = describeCacheKnowledge(entry({
        device: { gc_code: 'GC4NKAY', name: 'X', cache_type: 'Traditional Cache', latitude: 49, longitude: 5, gpx_date: '2026-09-26' },
    }));
    assert.equal(onGps.kind, 'on-gps');
    assert.equal(onGps.tooltip, 'Décrite par les GPX du GPS (chargés le 26/09) : ajoutée sans téléchargement');
    assert.equal(describeImportReport({
        total: 14625, new: 0, known: 14625, without_code: 367, unreadable_count: 0, unreadable: [], needs_cutoff: false,
        landmarks: null, source: 'H:\\Garmin', enriched: 14625, device: { positioned: 46, gpx_indexed: 9989 },
    }), 'Aucune nouvelle visite · 14625 dans le fichier · 14625 complétées (fuseau) · 46 positionnées sur la trace'
        + ' · 9989 caches lues dans les GPX');
}

testPasses();
testStatusLabel();
testDeviceData();
testLogEditorOpenings();
testOutingZoneName();
testPreparationSummary();
testSelection();
testResolutionDisplay();
testKnowledge();
testDaySummary();
testDates();
testImportReport();

console.log('gps-visits-model tests passed');
