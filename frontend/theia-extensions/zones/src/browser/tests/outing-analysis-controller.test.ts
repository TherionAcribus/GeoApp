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
    options: {
        listingChars?: number;
        recentLogsCount?: number;
        gearLogsCount?: number;
        outingDate?: string;
    };
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
        latitude: 48,
        longitude: 7,
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
        gear_mentions_in_listing: [],
        gear_mentions_in_hint: [],
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
        outing_date: '2026-09-03',
        requested_count: 1,
        geocaches: [],
        missing: [],
        without_local_logs: [],
        stale_logs: [],
        already_found: [],
        geography: {
            points_count: 0, excluded: [], crow_flies: true, centroid: null,
            bounding_box: null, max_pair_distance_km: null, route: null,
            walking_clusters: [], sun: null,
        },
        stats: {
            by_type: {}, by_health_level: {},
            unsolved_mysteries: 0, unresolved_gear_signals: 0, presolved_gear_signals: 0,
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

async function testOutingDateReachesTheBackend(): Promise<void> {
    const controller = new TestableController(createBundle());

    await controller.analyze([1], { outingDate: new Date(2026, 11, 24) });

    // Le serveur en a besoin autant que le prompt : c'est lui qui calcule le coucher du
    // soleil, et une sortie du 24 décembre n'a pas la journée d'un 24 juin.
    assert.equal(controller.fetchCalls[0].options.outingDate, '2026-12-24');
    assert.ok(controller.dispatched[0].prompt?.includes('Date de la sortie : 2026-12-24'));
}

async function testOutingDateDefaultsToToday(): Promise<void> {
    const controller = new TestableController(createBundle());

    await controller.analyze([1]);

    const today = new Date();
    const expected = `${today.getFullYear()}-${`${today.getMonth() + 1}`.padStart(2, '0')}`
        + `-${`${today.getDate()}`.padStart(2, '0')}`;
    assert.equal(controller.fetchCalls[0].options.outingDate, expected);
}

async function testTypedDatesAreValidatedInLocalTime(): Promise<void> {
    const controller = new TestableController(createBundle());
    const parse = (raw: string | undefined) => (controller as any).parseDate(raw) as Date | undefined;

    const parsed = parse('2026-09-05');
    // Construite en heure locale : passer par `new Date('2026-09-05')` la ramènerait au 4
    // à l'ouest de Greenwich, et la sortie changerait de jour.
    assert.equal(parsed?.getFullYear(), 2026);
    assert.equal(parsed?.getMonth(), 8);
    assert.equal(parsed?.getDate(), 5);

    assert.equal(parse('2026-02-31'), undefined);
    assert.equal(parse('05/09/2026'), undefined);
    assert.equal(parse(''), undefined);
    assert.equal(parse(undefined), undefined);
}

async function testCachesWithoutCoordinatesAreWarned(): Promise<void> {
    const bundle = createBundle({
        geocaches: [createGeocache('GC1')],
        geography: {
            points_count: 1,
            excluded: [
                { gc_code: 'GC7', reason: 'no_coordinates' },
                { gc_code: 'GC8', reason: 'unsolved_mystery' },
            ],
            crow_flies: true, centroid: { latitude: 48, longitude: 7 },
            bounding_box: null, max_pair_distance_km: null, route: null,
            walking_clusters: [], sun: null,
        },
    });
    const controller = new TestableController(bundle);

    const outcome = await controller.analyze([1]);
    const warning = outcome.warnings.find(text => text.includes('sans coordonnées'));

    // Le trou de données mérite un avertissement ; la mystery non résolue, non : son
    // exclusion est un choix assumé, déjà signalé par ailleurs.
    assert.ok(warning);
    assert.ok(warning!.includes('GC7'));
    assert.ok(!warning!.includes('GC8'));
}

/**
 * Le niveau ne décide plus « listing ou pas », mais **combien** pour une cache qui le
 * mérite. Même en mode léger, la collecte rapporte donc un listing : c'est le plan de
 * rédaction, et lui seul, qui décide ensuite à qui il est transmis.
 */
async function testDetailLevelDrivesTheCollectionOptions(): Promise<void> {
    const controller = new TestableController(createBundle());

    await controller.analyze([1], { detailLevel: 'light' });
    assert.equal(controller.fetchCalls[0].options.listingChars, 1200);

    await controller.analyze([1], { detailLevel: 'full' });
    assert.equal(controller.fetchCalls[1].options.listingChars, 4000);
}

/** Budget adaptatif désactivé : on retombe sur l'ancien contrat, listing compris. */
async function testUniformModeRestoresTheOldCollectionOptions(): Promise<void> {
    const controller = new TestableController(createBundle(), {
        'geoApp.outing.analysis.adaptiveBudget': false,
    });

    await controller.analyze([1], { detailLevel: 'light' });
    assert.equal(controller.fetchCalls[0].options.listingChars, 1200);
    assert.equal(controller.fetchCalls[0].options.recentLogsCount, 3);
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

    assert.equal(controller.fetchCalls[0].options.listingChars, 2500);
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
    await testOutingDateReachesTheBackend();
    await testOutingDateDefaultsToToday();
    await testTypedDatesAreValidatedInLocalTime();
    await testCachesWithoutCoordinatesAreWarned();
    await testDetailLevelDrivesTheCollectionOptions();
    await testUniformModeRestoresTheOldCollectionOptions();
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
