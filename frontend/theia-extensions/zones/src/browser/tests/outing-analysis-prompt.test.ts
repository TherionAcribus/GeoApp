import * as assert from 'assert/strict';
import {
    buildOutingAnalysisPrompt,
    estimateOutingPromptSize,
} from '../outing-analysis-prompt';
import {
    OutingAnalysisBundle,
    OutingAnalysisGeocache,
    OUTING_DETAIL_PRESETS,
} from '../outing-analysis-types';

function createGeocacheFixture(overrides: Partial<OutingAnalysisGeocache> = {}): OutingAnalysisGeocache {
    return {
        id: 42,
        gc_code: 'GC424242',
        name: 'Le vieux chêne',
        type: 'Traditional',
        size: 'Micro',
        owner: 'GeoOwner',
        difficulty: 3.5,
        terrain: 4,
        status: 'active',
        coordinates: 'N 48° 51.396 E 002° 21.132',
        is_corrected: false,
        solved: 'not_solved',
        unsolved_mystery: false,
        favorites_count: 42,
        logs_count: 118,
        placed_at: '2019-04-02T00:00:00+00:00',
        found: false,
        found_date: null,
        hint: 'au pied du gros arbre',
        personal_note: 'Parking rue des Lilas, prevoir 2 personnes.',
        personal_note_truncated: false,
        notes: [
            {
                note_type: 'user',
                source: 'user',
                source_plugin: null,
                updated_at: '2026-08-30T09:00:00+00:00',
                content_excerpt: 'Repere depuis le pont, prendre la sente de droite.',
            },
        ],
        notes_count: 1,
        listing_excerpt: 'Une balade agreable dans le bois, prevoyez de quoi atteindre la boite.',
        listing_truncated: true,
        attributes: [
            { label: 'Outil special requis', is_negative: false },
            { label: 'Chiens', is_negative: true },
        ],
        gear_signals: [
            {
                signal: 'special_tool',
                kind: 'gear',
                resolved: false,
                label: 'outil special requis — nature a determiner',
                slug: 's-tool',
                source: 'attribute',
                is_negative: false,
            },
            {
                signal: 'flashlight',
                kind: 'gear',
                resolved: true,
                label: 'lampe / frontale',
                slug: 'flashlight',
                source: 'attribute',
                is_negative: false,
            },
            {
                signal: 'fee',
                kind: 'context',
                resolved: true,
                label: "frais d'entree",
                slug: 'fee',
                source: 'attribute',
                is_negative: false,
            },
        ],
        waypoints: [
            {
                prefix: 'PK', name: 'Parking', type: 'Parking Area',
                coordinates: 'N 48° 51.400 E 002° 21.100', note_excerpt: null,
            },
            {
                prefix: 'S1', name: 'Etape 1', type: 'Stage',
                coordinates: null, note_excerpt: 'Compter les marches.',
            },
        ],
        waypoints_count: 2,
        logging_tasks: [],
        logging_tasks_count: 0,
        logging_tasks_photo_required: false,
        health: {
            level: 'risky',
            reasons: ['2 DNF consecutifs depuis la derniere trouvaille.'],
            logs_available: true,
            local_logs_count: 30,
            last_found_date: '2025-02-01T00:00:00+00:00',
            days_since_last_found: 214,
            consecutive_dnf: 2,
            dnf_ratio_recent: 0.4,
            needs_maintenance_pending: false,
            listing_status: 'active',
            last_log_date: '2026-03-02T00:00:00+00:00',
            days_since_last_log: 185,
            logs_fetched_at: '2026-09-01T00:00:00+00:00',
            days_since_logs_fetched: 2,
            logs_stale: false,
        },
        recent_logs: [
            { type: "Didn't find it", date: '2026-03-02T00:00:00+00:00', author: 'Titi', text_excerpt: 'Rien trouve.' },
            { type: 'Found it', date: '2025-02-01T00:00:00+00:00', author: 'Toto', text_excerpt: 'Sympa.' },
        ],
        gear_logs: [
            {
                date: '2019-06-12T00:00:00+00:00',
                author: 'Toto',
                matched: ['fishing_rod'],
                text_excerpt: 'il faut une canne a peche improvisee',
                is_friend_log: true,
                is_favorite: true,
            },
        ],
        search_effort_logs: [
            { date: '2023-04-01T00:00:00+00:00', author: 'Titi', text_excerpt: 'bien cachee, cherche 40 minutes' },
        ],
        ...overrides,
    };
}

function createBundleFixture(overrides: Partial<OutingAnalysisBundle> = {}): OutingAnalysisBundle {
    const geocaches = overrides.geocaches ?? [createGeocacheFixture()];
    return {
        generated_at: '2026-09-03T10:00:00+00:00',
        requested_count: geocaches.length,
        geocaches,
        missing: [],
        without_local_logs: [],
        stale_logs: [],
        already_found: [],
        stats: {
            by_type: { Traditional: geocaches.length },
            by_health_level: { risky: geocaches.length },
            unsolved_mysteries: 0,
            unresolved_gear_signals: 1,
            already_found: 0,
            stale_logs: 0,
            logging_tasks: 0,
        },
        ...overrides,
    };
}

const STANDARD = { detailLevel: 'standard' as const, zoneName: 'Vosges', outingDate: '2026-09-05' };

function testHeaderCarriesContext(): void {
    const prompt = buildOutingAnalysisPrompt(createBundleFixture(), STANDARD);

    assert.ok(prompt.includes('# Analyse de sortie — Vosges — 1 géocache(s)'));
    assert.ok(prompt.includes('Date de la sortie : 2026-09-05'));
    assert.ok(prompt.includes('Données extraites le : 2026-09-03'));
}

function testUnresolvedSignalIsMarked(): void {
    const prompt = buildOutingAnalysisPrompt(createBundleFixture(), STANDARD);

    // Le marqueur exact que le prompt système va chercher.
    assert.ok(prompt.includes('special_tool (NON RÉSOLU'));
    // Un signal résolu ne doit pas porter le marqueur.
    assert.ok(prompt.includes('flashlight (lampe / frontale)'));
    assert.ok(!prompt.includes('flashlight (NON RÉSOLU'));
}

function testGearAndContextSignalsAreSeparated(): void {
    const prompt = buildOutingAnalysisPrompt(createBundleFixture(), STANDARD);

    assert.ok(prompt.includes('- Signaux matériel :'));
    assert.ok(prompt.includes('- Contexte : frais'));
    // Le contexte ne doit pas polluer la ligne matériel.
    const gearLine = prompt.split('\n').find(line => line.startsWith('- Signaux matériel :')) || '';
    assert.ok(!gearLine.includes('frais'));
}

function testGearLogsCarryTheirMatches(): void {
    const prompt = buildOutingAnalysisPrompt(createBundleFixture(), STANDARD);

    assert.ok(prompt.includes('- Logs mentionnant du matériel :'));
    assert.ok(prompt.includes('canne a peche improvisee'));
    assert.ok(prompt.includes('(matériel repéré : fishing_rod)'));
    // Un vieux log doit sortir : c'est toute la raison d'être de la sélection lexicale.
    assert.ok(prompt.includes('2019-06-12'));
}

function testEmptySectionsAreOmittedNotRendered(): void {
    const bare = createGeocacheFixture({
        hint: null,
        personal_note: null,
        notes: [],
        notes_count: 0,
        listing_excerpt: '',
        listing_truncated: false,
        attributes: [],
        gear_signals: [],
        waypoints: [],
        waypoints_count: 0,
        recent_logs: [],
        gear_logs: [],
        search_effort_logs: [],
    });
    const prompt = buildOutingAnalysisPrompt(createBundleFixture({ geocaches: [bare] }), STANDARD);

    assert.ok(!prompt.includes('Hint'));
    assert.ok(!prompt.includes('Listing'));
    assert.ok(!prompt.includes('Attributs'));
    assert.ok(!prompt.includes('Waypoints'));
    assert.ok(!prompt.includes('Signaux matériel'));
    assert.ok(!prompt.includes('Logs récents'));
    assert.ok(!prompt.includes('Note personnelle'));
    assert.ok(!prompt.includes('Notes GeoApp'));
    assert.ok(!prompt.includes('Questions à répondre sur place'));
    // Le bloc reste malgré tout identifiable.
    assert.ok(prompt.includes('### 1. GC424242 — Le vieux chêne'));
}

function testReliabilitySectionListsCachesWithoutLogs(): void {
    const bundle = createBundleFixture({ without_local_logs: ['GC10CAV', 'GC999ZZ'] });
    const prompt = buildOutingAnalysisPrompt(bundle, STANDARD);

    assert.ok(prompt.includes('## Fiabilité des données'));
    assert.ok(prompt.includes('GC10CAV, GC999ZZ'));
    assert.ok(prompt.includes("N'en tire aucune conclusion."));
    // La mise en garde doit précéder les données auxquelles elle s'applique.
    assert.ok(prompt.indexOf('## Fiabilité des données') < prompt.indexOf('## Géocaches'));
}

function testReliabilitySectionIsOmittedWhenNothingToReport(): void {
    const bundle = createBundleFixture({
        stats: {
            by_type: {}, by_health_level: {},
            unsolved_mysteries: 0, unresolved_gear_signals: 0,
            already_found: 0, stale_logs: 0, logging_tasks: 0,
        },
    });
    const prompt = buildOutingAnalysisPrompt(bundle, STANDARD);

    assert.ok(!prompt.includes('## Fiabilité des données'));
}

function testUnsolvedMysteryIsFlaggedTwice(): void {
    const mystery = createGeocacheFixture({ type: 'Mystery', unsolved_mystery: true });
    const bundle = createBundleFixture({
        geocaches: [mystery],
        stats: {
            by_type: { Mystery: 1 }, by_health_level: { risky: 1 },
            unsolved_mysteries: 1, unresolved_gear_signals: 1,
            already_found: 0, stale_logs: 0, logging_tasks: 0,
        },
    });
    const prompt = buildOutingAnalysisPrompt(bundle, STANDARD);

    // En tête, pour la vue d'ensemble ; dans le bloc, pour qui lit la cache seule.
    assert.ok(prompt.includes('1 mystery(s) non résolue(s) : GC424242'));
    assert.ok(prompt.includes('- ALERTE : mystery non résolue'));
}

function testAlreadyFoundIsFlaggedTwice(): void {
    const done = createGeocacheFixture({ found: true, found_date: '2024-05-11T00:00:00+00:00' });
    const bundle = createBundleFixture({
        geocaches: [done],
        already_found: ['GC424242'],
        stats: {
            by_type: { Traditional: 1 }, by_health_level: { risky: 1 },
            unsolved_mysteries: 0, unresolved_gear_signals: 1,
            already_found: 1, stale_logs: 0, logging_tasks: 0,
        },
    });
    const prompt = buildOutingAnalysisPrompt(bundle, STANDARD);

    // Comme la mystery non résolue : en tête pour la vue d'ensemble, dans le bloc pour
    // qui ne lit que la fiche.
    assert.ok(prompt.includes('1 géocache(s) DÉJÀ TROUVÉE(S) dans la sélection : GC424242'));
    assert.ok(prompt.includes('- ALERTE : géocache DÉJÀ TROUVÉE le 2024-05-11'));
}

function testStaleLogsRelativizeHealth(): void {
    const bundle = createBundleFixture({
        stale_logs: ['GC424242'],
        stats: {
            by_type: { Traditional: 1 }, by_health_level: { risky: 1 },
            unsolved_mysteries: 0, unresolved_gear_signals: 1,
            already_found: 0, stale_logs: 1, logging_tasks: 0,
        },
    });
    const prompt = buildOutingAnalysisPrompt(bundle, STANDARD);

    assert.ok(prompt.includes('logs locaux sont périmés : GC424242'));
    assert.ok(prompt.includes('pas comme un fait.'));
}

function testPersonalNoteAndNotesAreRendered(): void {
    const prompt = buildOutingAnalysisPrompt(createBundleFixture(), STANDARD);

    assert.ok(prompt.includes('- Note personnelle :'));
    assert.ok(prompt.includes('Parking rue des Lilas'));
    assert.ok(prompt.includes('- Notes GeoApp :'));
    assert.ok(prompt.includes('sente de droite'));
    // La note de l'utilisateur passe avant le listing : c'est la source la plus sûre.
    assert.ok(prompt.indexOf('- Note personnelle') < prompt.indexOf('- Listing'));
}

function testOlderNotesAreCounted(): void {
    const many = createGeocacheFixture({ notes_count: 9 });
    const prompt = buildOutingAnalysisPrompt(createBundleFixture({ geocaches: [many] }), STANDARD);

    // Le backend n'en retient que quelques-unes : ne pas laisser croire à l'exhaustivité.
    assert.ok(prompt.includes('8 note(s) plus ancienne(s) non reprise(s)'));
}

function testEarthCacheQuestionsAreRendered(): void {
    const earth = createGeocacheFixture({
        type: 'Earthcache',
        logging_tasks: [
            {
                position: 0,
                question: 'Quelle est la couleur de la roche affleurante ?',
                guidance: 'Observer la paroi sous le panneau.',
                status: 'todo',
                requires_photo: false,
                answered: false,
            },
            {
                position: 1,
                question: 'Photo de vous devant le panneau.',
                guidance: null,
                status: 'answered',
                requires_photo: true,
                answered: true,
            },
        ],
        logging_tasks_count: 2,
        logging_tasks_photo_required: true,
    });
    const prompt = buildOutingAnalysisPrompt(createBundleFixture({ geocaches: [earth] }), STANDARD);

    assert.ok(prompt.includes('- Questions à répondre sur place (2, appareil photo nécessaire) :'));
    assert.ok(prompt.includes('couleur de la roche'));
    assert.ok(prompt.includes('à observer : Observer la paroi'));
    assert.ok(prompt.includes('(déjà répondue, PHOTO REQUISE)'));
}

function testWaypointsCarryTypeAndCoordinates(): void {
    const prompt = buildOutingAnalysisPrompt(createBundleFixture(), STANDARD);

    assert.ok(prompt.includes('- Waypoints (2) :'));
    assert.ok(prompt.includes('PK Parking — [Parking Area] — N 48° 51.400 E 002° 21.100'));
    // Un waypoint sans coordonnées le dit : c'est un point à récupérer avant de partir.
    assert.ok(prompt.includes('S1 Etape 1 — [Stage] — coordonnées absentes'));
}

function testFriendAndFavoriteLogsAreMarked(): void {
    const prompt = buildOutingAnalysisPrompt(createBundleFixture(), STANDARD);

    assert.ok(prompt.includes('[2019-06-12, Toto, ami, favori]'));
    // Un log ordinaire garde son en-tête nu.
    assert.ok(prompt.includes('[2026-03-02, Titi]'));
}

function testMissingIdsAreReported(): void {
    const prompt = buildOutingAnalysisPrompt(createBundleFixture({ missing: [7, 8] }), STANDARD);

    assert.ok(prompt.includes('2 géocache(s) demandée(s) mais introuvable(s)'));
}

function testLightLevelDropsTheListing(): void {
    const prompt = buildOutingAnalysisPrompt(createBundleFixture(), {
        ...STANDARD,
        detailLevel: 'light',
    });

    assert.ok(!prompt.includes('Une balade agreable'));
    assert.ok(!prompt.includes('- Listing'));
    // Le reste demeure : le mode léger s'appuie sur attributs, hint et logs.
    assert.ok(prompt.includes('- Hint : au pied du gros arbre'));
    assert.ok(prompt.includes('special_tool (NON RÉSOLU'));
}

function testStandardLevelKeepsTheListing(): void {
    const prompt = buildOutingAnalysisPrompt(createBundleFixture(), STANDARD);

    assert.ok(prompt.includes('- Listing (extrait tronqué) :'));
    assert.ok(prompt.includes('Une balade agreable'));
}

function testDetailLevelBoundsRecentLogs(): void {
    const many = Array.from({ length: 10 }, (_, index) => ({
        type: 'Found it',
        date: `2026-0${(index % 9) + 1}-01T00:00:00+00:00`,
        author: `Auteur${index}`,
        text_excerpt: `log numero ${index}`,
    }));
    const geocache = createGeocacheFixture({ recent_logs: many });

    const light = buildOutingAnalysisPrompt(createBundleFixture({ geocaches: [geocache] }), {
        ...STANDARD, detailLevel: 'light',
    });
    const full = buildOutingAnalysisPrompt(createBundleFixture({ geocaches: [geocache] }), {
        ...STANDARD, detailLevel: 'full',
    });

    assert.ok(light.includes('log numero 2'));
    assert.ok(!light.includes('log numero 3'));
    assert.ok(full.includes('log numero 9'));
}

function testEmptyBundleDoesNotCrash(): void {
    const bundle = createBundleFixture({
        geocaches: [],
        stats: {
            by_type: {}, by_health_level: {},
            unsolved_mysteries: 0, unresolved_gear_signals: 0,
            already_found: 0, stale_logs: 0, logging_tasks: 0,
        },
    });
    const prompt = buildOutingAnalysisPrompt(bundle, STANDARD);

    assert.ok(prompt.includes('Aucune géocache exploitable'));
    assert.ok(prompt.includes('Produis le rapport'));
}

function testUnknownHealthIsSpelledOut(): void {
    const geocache = createGeocacheFixture({
        health: {
            level: 'unknown',
            reasons: ["Aucun log local : la géocache n'a jamais été rafraîchie."],
            logs_available: false,
            local_logs_count: 0,
            last_found_date: null,
            days_since_last_found: null,
            consecutive_dnf: 0,
            dnf_ratio_recent: null,
            needs_maintenance_pending: false,
            listing_status: 'active',
            last_log_date: null,
            days_since_last_log: null,
            logs_fetched_at: null,
            days_since_logs_fetched: null,
            logs_stale: false,
        },
    });
    const prompt = buildOutingAnalysisPrompt(createBundleFixture({ geocaches: [geocache] }), STANDARD);

    assert.ok(prompt.includes('- Santé : inconnue (aucun log local)'));
}

function testNegativeAttributeIsPrefixed(): void {
    const prompt = buildOutingAnalysisPrompt(createBundleFixture(), STANDARD);

    assert.ok(prompt.includes('NON Chiens'));
}

function testInstructionLineClosesThePrompt(): void {
    const prompt = buildOutingAnalysisPrompt(createBundleFixture(), STANDARD);

    assert.ok(prompt.trimEnd().endsWith('Produis le rapport de préparation de sortie selon ton format.'));
}

function testPromptSizeGrowsWithGeocacheCount(): void {
    const one = estimateOutingPromptSize(
        buildOutingAnalysisPrompt(createBundleFixture(), STANDARD)
    );
    const five = estimateOutingPromptSize(
        buildOutingAnalysisPrompt(
            createBundleFixture({
                geocaches: Array.from({ length: 5 }, (_, index) =>
                    createGeocacheFixture({ id: index, gc_code: `GC0000${index}` })),
            }),
            STANDARD
        )
    );

    assert.ok(five.chars > one.chars);
    assert.ok(five.approxTokens > one.approxTokens);
    assert.ok(one.approxTokens > 0);
}

function testDetailPresetsAreOrdered(): void {
    // Les préréglages doivent rester monotones : léger ⊂ standard ⊂ complet.
    assert.ok(OUTING_DETAIL_PRESETS.light.listingChars < OUTING_DETAIL_PRESETS.standard.listingChars);
    assert.ok(OUTING_DETAIL_PRESETS.standard.listingChars < OUTING_DETAIL_PRESETS.full.listingChars);
    assert.ok(OUTING_DETAIL_PRESETS.light.recentLogsCount < OUTING_DETAIL_PRESETS.full.recentLogsCount);
    // Le mode léger ne demande aucun listing au serveur.
    assert.equal(OUTING_DETAIL_PRESETS.light.listingChars, 0);
}

function run(): void {
    testHeaderCarriesContext();
    testUnresolvedSignalIsMarked();
    testGearAndContextSignalsAreSeparated();
    testGearLogsCarryTheirMatches();
    testEmptySectionsAreOmittedNotRendered();
    testReliabilitySectionListsCachesWithoutLogs();
    testReliabilitySectionIsOmittedWhenNothingToReport();
    testUnsolvedMysteryIsFlaggedTwice();
    testAlreadyFoundIsFlaggedTwice();
    testStaleLogsRelativizeHealth();
    testPersonalNoteAndNotesAreRendered();
    testOlderNotesAreCounted();
    testEarthCacheQuestionsAreRendered();
    testWaypointsCarryTypeAndCoordinates();
    testFriendAndFavoriteLogsAreMarked();
    testMissingIdsAreReported();
    testLightLevelDropsTheListing();
    testStandardLevelKeepsTheListing();
    testDetailLevelBoundsRecentLogs();
    testEmptyBundleDoesNotCrash();
    testUnknownHealthIsSpelledOut();
    testNegativeAttributeIsPrefixed();
    testInstructionLineClosesThePrompt();
    testPromptSizeGrowsWithGeocacheCount();
    testDetailPresetsAreOrdered();
    // eslint-disable-next-line no-console
    console.log('outing-analysis-prompt tests passed');
}

run();
