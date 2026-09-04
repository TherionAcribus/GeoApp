import * as assert from 'assert/strict';
import { OutingAnalysisController } from '../outing-analysis-controller';
import { GeoAppOpenChatRequestDetailPayload } from '../geoapp-chat-shared';
import {
    GEOAPP_OUTING_ANALYZER_AGENT_ID,
    MAX_OUTING_ANALYSIS_GEOCACHES,
    OutingAnalysisBundle,
    OutingAnalysisGeocache,
} from '../outing-analysis-types';

interface FetchCall {
    ids: number[];
    options: { listingChars?: number; recentLogsCount?: number; gearLogsCount?: number };
}

/** Géocache complète mais minimale : le constructeur de prompt attend tous les champs. */
function createGeocache(gcCode: string): OutingAnalysisGeocache {
    return {
        id: Number(gcCode.replace(/\D/g, '')) || 1,
        gc_code: gcCode,
        name: `Cache ${gcCode}`,
        type: 'Traditional',
        size: 'Micro',
        owner: 'Owner',
        difficulty: 2,
        terrain: 2,
        status: 'active',
        coordinates: 'N 48° 00.000 E 007° 00.000',
        is_corrected: false,
        solved: 'not_solved',
        unsolved_mystery: false,
        favorites_count: 1,
        logs_count: 10,
        placed_at: '2020-01-01T00:00:00+00:00',
        found: false,
        found_date: null,
        hint: null,
        personal_note: null,
        personal_note_truncated: false,
        notes: [],
        notes_count: 0,
        listing_excerpt: '',
        listing_truncated: false,
        attributes: [],
        gear_signals: [],
        waypoints: [],
        waypoints_count: 0,
        logging_tasks: [],
        logging_tasks_count: 0,
        logging_tasks_photo_required: false,
        health: {
            level: 'ok',
            reasons: ['Rien à signaler.'],
            logs_available: true,
            local_logs_count: 10,
            last_found_date: '2026-08-01T00:00:00+00:00',
            days_since_last_found: 33,
            consecutive_dnf: 0,
            dnf_ratio_recent: 0,
            needs_maintenance_pending: false,
            listing_status: 'active',
            last_log_date: '2026-08-01T00:00:00+00:00',
            days_since_last_log: 33,
            logs_fetched_at: '2026-09-02T00:00:00+00:00',
            days_since_logs_fetched: 1,
            logs_stale: false,
        },
        recent_logs: [],
        gear_logs: [],
        search_effort_logs: [],
    };
}

function createBundle(overrides: Partial<OutingAnalysisBundle> = {}): OutingAnalysisBundle {
    return {
        generated_at: '2026-09-03T10:00:00+00:00',
        requested_count: 1,
        geocaches: [],
        missing: [],
        without_local_logs: [],
        stale_logs: [],
        already_found: [],
        stats: {
            by_type: {}, by_health_level: {},
            unsolved_mysteries: 0, unresolved_gear_signals: 0,
            already_found: 0, stale_logs: 0, logging_tasks: 0,
        },
        ...overrides,
    };
}

/**
 * Contrôleur instrumenté : l'ouverture de session est interceptée, et les services
 * Theia sont remplacés par des doubles minimaux. On teste `analyze()`, la partie sans UI.
 */
class TestableController extends OutingAnalysisController {
    readonly fetchCalls: FetchCall[] = [];
    readonly dispatched: GeoAppOpenChatRequestDetailPayload[] = [];

    constructor(
        bundle: OutingAnalysisBundle,
        preferences: Record<string, unknown> = {}
    ) {
        super();
        (this as any).geocachesService = {
            fetchAnalysisBundle: async (ids: number[], options: FetchCall['options']) => {
                this.fetchCalls.push({ ids, options });
                return bundle;
            },
        };
        (this as any).preferenceService = {
            get: (key: string, fallback: unknown) =>
                (key in preferences ? preferences[key] : fallback),
        };
    }

    protected override openChatSession(detail: GeoAppOpenChatRequestDetailPayload): void {
        this.dispatched.push(detail);
    }
}

async function testEmptySelectionDoesNotDispatch(): Promise<void> {
    const controller = new TestableController(createBundle());
    const outcome = await controller.analyze([]);

    assert.equal(outcome.started, false);
    assert.equal(outcome.analyzed, 0);
    assert.equal(controller.dispatched.length, 0);
    assert.equal(controller.fetchCalls.length, 0);
    assert.ok(outcome.warnings[0].includes('Aucune géocache'));
}

async function testCapIsEnforcedBeforeTheNetworkCall(): Promise<void> {
    const controller = new TestableController(createBundle());
    const ids = Array.from({ length: MAX_OUTING_ANALYSIS_GEOCACHES + 1 }, (_, i) => i + 1);
    const outcome = await controller.analyze(ids);

    assert.equal(outcome.started, false);
    // Le refus doit précéder l'aller-retour réseau, pas le suivre.
    assert.equal(controller.fetchCalls.length, 0);
    assert.ok(outcome.warnings[0].includes(String(MAX_OUTING_ANALYSIS_GEOCACHES)));
}

async function testDuplicateIdsAreCollapsed(): Promise<void> {
    const controller = new TestableController(createBundle());
    await controller.analyze([4, 4, 7, 4, 7]);

    assert.deepEqual(controller.fetchCalls[0].ids, [4, 7]);
}

async function testSessionIsPinnedOnTheOutingAgent(): Promise<void> {
    const controller = new TestableController(createBundle());
    await controller.analyze([1], { zoneName: 'Vosges' });

    const detail = controller.dispatched[0];
    assert.equal(detail.preferredAgentId, GEOAPP_OUTING_ANALYZER_AGENT_ID);
    assert.equal(detail.sessionKind, 'libre');
    // Ni geocacheId ni gcCode : la session ne porte pas sur une cache, et le bridge
    // doit donc l'apparier sur son titre.
    assert.equal(detail.geocacheId, undefined);
    assert.equal(detail.gcCode, undefined);
}

async function testSessionTitleCarriesZoneDateAndCount(): Promise<void> {
    const bundle = createBundle({
        geocaches: [createGeocache('GC1'), createGeocache('GC2')],
    });
    const controller = new TestableController(bundle);
    await controller.analyze([1, 2], { zoneName: 'Vosges', outingDate: new Date(2026, 8, 5) });

    assert.equal(controller.dispatched[0].sessionTitle, 'SORTIE - Vosges - 2026-09-05 (2 caches)');
}

async function testSameDayTitlesMatchSoTheSessionIsReused(): Promise<void> {
    const bundle = createBundle({ geocaches: [createGeocache('GC1')] });
    const controller = new TestableController(bundle);
    const date = new Date(2026, 8, 5);

    await controller.analyze([1], { zoneName: 'Vosges', outingDate: date });
    await controller.analyze([1], { zoneName: 'Vosges', outingDate: date });

    assert.equal(controller.dispatched[0].sessionTitle, controller.dispatched[1].sessionTitle);
}

async function testDifferentDaysOpenDistinctSessions(): Promise<void> {
    const bundle = createBundle({ geocaches: [createGeocache('GC1')] });
    const controller = new TestableController(bundle);

    await controller.analyze([1], { zoneName: 'Vosges', outingDate: new Date(2026, 8, 5) });
    await controller.analyze([1], { zoneName: 'Vosges', outingDate: new Date(2026, 8, 6) });

    assert.notEqual(controller.dispatched[0].sessionTitle, controller.dispatched[1].sessionTitle);
}

async function testDetailLevelDrivesTheCollectionOptions(): Promise<void> {
    const controller = new TestableController(createBundle());

    await controller.analyze([1], { detailLevel: 'light' });
    assert.equal(controller.fetchCalls[0].options.listingChars, 0);

    await controller.analyze([1], { detailLevel: 'full' });
    assert.equal(controller.fetchCalls[1].options.listingChars, 4000);
}

async function testPreferencesOverrideThePresetLogCounts(): Promise<void> {
    const controller = new TestableController(createBundle(), {
        'geoApp.outing.analysis.recentLogsCount': 2,
        'geoApp.outing.analysis.gearLogsCount': 15,
    });
    await controller.analyze([1], { detailLevel: 'standard' });

    assert.equal(controller.fetchCalls[0].options.recentLogsCount, 2);
    assert.equal(controller.fetchCalls[0].options.gearLogsCount, 15);
}

async function testDefaultDetailLevelComesFromPreferences(): Promise<void> {
    const controller = new TestableController(createBundle(), {
        'geoApp.outing.analysis.detailLevel': 'full',
    });
    await controller.analyze([1]);

    assert.equal(controller.fetchCalls[0].options.listingChars, 4000);
}

async function testInvalidPreferenceFallsBackToStandard(): Promise<void> {
    const controller = new TestableController(createBundle(), {
        'geoApp.outing.analysis.detailLevel': 'n_importe_quoi',
    });
    await controller.analyze([1]);

    assert.equal(controller.fetchCalls[0].options.listingChars, 1800);
}

async function testCachesWithoutLogsAreReportedAsWarnings(): Promise<void> {
    const bundle = createBundle({
        geocaches: [createGeocache('GC1')],
        without_local_logs: ['GC10CAV', 'GC999ZZ'],
        missing: [42],
    });
    const controller = new TestableController(bundle);
    const outcome = await controller.analyze([1]);

    assert.equal(outcome.started, true);
    assert.ok(outcome.warnings.some(w => w.includes('GC10CAV') && w.includes('partielle')));
    assert.ok(outcome.warnings.some(w => w.includes('introuvable')));
}

async function testAlreadyFoundAndStaleLogsAreWarned(): Promise<void> {
    const bundle = createBundle({
        geocaches: [createGeocache('GC1')],
        already_found: ['GC1'],
        stale_logs: ['GC1'],
    });
    const controller = new TestableController(bundle);
    const outcome = await controller.analyze([1]);

    // Avertissements sur lesquels l'utilisateur peut agir avant de payer l'analyse.
    assert.ok(outcome.warnings.some(w => w.includes('déjà trouvée(s)') && w.includes('GC1')));
    assert.ok(outcome.warnings.some(w => w.includes('logs locaux datent')));
}

async function testLongListOfCachesWithoutLogsIsAbbreviated(): Promise<void> {
    const codes = Array.from({ length: 9 }, (_, i) => `GC${i}`);
    const bundle = createBundle({
        geocaches: [createGeocache('GC1')],
        without_local_logs: codes,
    });
    const controller = new TestableController(bundle);
    const outcome = await controller.analyze([1]);

    assert.ok(outcome.warnings[0].includes('et 4 autre(s)'));
}

async function testVolumeWarningUsesThePreferenceThreshold(): Promise<void> {
    const geocaches = Array.from({ length: 6 }, (_, i) => createGeocache(`GC${i}`));
    const bundle = createBundle({ geocaches });

    const quiet = new TestableController(bundle, { 'geoApp.outing.analysis.warnAboveCount': 25 });
    assert.equal((await quiet.analyze([1])).warnings.length, 0);

    const noisy = new TestableController(bundle, { 'geoApp.outing.analysis.warnAboveCount': 5 });
    assert.ok((await noisy.analyze([1])).warnings.some(w => w.includes('6 géocaches transmises')));
}

async function testPromptSizeIsReported(): Promise<void> {
    const bundle = createBundle({ geocaches: [createGeocache('GC1')] });
    const controller = new TestableController(bundle);
    const outcome = await controller.analyze([1]);

    assert.ok(outcome.promptSize);
    assert.ok(outcome.promptSize!.chars > 0);
    assert.ok(outcome.promptSize!.approxTokens > 0);
    // Le prompt envoyé est bien celui qui a été mesuré.
    assert.equal(controller.dispatched[0].prompt?.length, outcome.promptSize!.chars);
}

async function run(): Promise<void> {
    await testEmptySelectionDoesNotDispatch();
    await testCapIsEnforcedBeforeTheNetworkCall();
    await testDuplicateIdsAreCollapsed();
    await testSessionIsPinnedOnTheOutingAgent();
    await testSessionTitleCarriesZoneDateAndCount();
    await testSameDayTitlesMatchSoTheSessionIsReused();
    await testDifferentDaysOpenDistinctSessions();
    await testDetailLevelDrivesTheCollectionOptions();
    await testPreferencesOverrideThePresetLogCounts();
    await testDefaultDetailLevelComesFromPreferences();
    await testInvalidPreferenceFallsBackToStandard();
    await testCachesWithoutLogsAreReportedAsWarnings();
    await testAlreadyFoundAndStaleLogsAreWarned();
    await testLongListOfCachesWithoutLogsIsAbbreviated();
    await testVolumeWarningUsesThePreferenceThreshold();
    await testPromptSizeIsReported();
    // eslint-disable-next-line no-console
    console.log('outing-analysis-controller tests passed');
}

void run();
