import * as assert from 'assert/strict';
import {
    buildOutingAnalysisPrompt,
    estimateOutingPromptSize,
} from '../outing-analysis-prompt';
import {
    OutingAnalysisBundle,
    OutingAnalysisGeocache,
    OutingGeography,
    OutingTimeBudget,
    OUTING_TIER_PRESETS,
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
        latitude: 48.8566,
        longitude: 2.3522,
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
        gear_mentions_in_listing: [],
        gear_mentions_in_hint: [],
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
        time_estimate: {
            minutes: 55,
            low_minutes: 30,
            high_minutes: 80,
            confidence: 'low',
            confidence_reasons: ['drapeau materiel non resolu'],
            type_key: 'traditional',
            components: [
                { label: 'base traditional', minutes: 10 },
                { label: 'difficulte 3.5', minutes: 18 },
                { label: 'terrain 4', minutes: 25 },
            ],
            capped_park_and_grab: false,
        },
        ...overrides,
    };
}

/**
 * Géographie par défaut : deux caches proches, un ordre de visite et un coucher de soleil.
 *
 * Les valeurs sont figées, jamais recalculées côté front — le bloc arrive tel quel du
 * backend, qui a ses propres tests de justesse.
 */
function createGeographyFixture(overrides: Partial<OutingGeography> = {}): OutingGeography {
    return {
        points_count: 2,
        excluded: [],
        crow_flies: true,
        centroid: { latitude: 48.85, longitude: 2.35 },
        bounding_box: {
            north: 48.86, south: 48.84, east: 2.36, west: 2.34,
            width_km: 1.47, height_km: 2.22, diagonal_km: 2.66,
        },
        max_pair_distance_km: 2.66,
        route: {
            strategy: 'nearest_neighbour_2opt',
            total_km: 2.66,
            longest_leg_km: 2.66,
            legs: [
                { position: 1, gc_code: 'GC424242', name: 'Le vieux chene', leg_km: 0, cumulative_km: 0 },
                { position: 2, gc_code: 'GC999999', name: 'La source', leg_km: 2.66, cumulative_km: 2.66 },
            ],
        },
        walking_clusters: [],
        sun: {
            date: '2026-09-05',
            latitude: 48.85,
            longitude: 2.35,
            sunrise_utc: '2026-09-05T05:13:00+00:00',
            sunset_utc: '2026-09-05T18:25:00+00:00',
            civil_dawn_utc: '2026-09-05T04:41:00+00:00',
            civil_dusk_utc: '2026-09-05T18:57:00+00:00',
            solar_noon_utc: '2026-09-05T11:49:00+00:00',
            sunrise_local: '07:13',
            sunset_local: '20:25',
            civil_dawn_local: '06:41',
            civil_dusk_local: '20:57',
            day_length_minutes: 792,
            utc_offset: '+02:00',
            timezone_label: 'Europe/Paris',
            polar_state: null,
        },
        ...overrides,
    };
}

/**
 * Budget temps par défaut : douze caches et un trajet, valeurs figées.
 *
 * Comme la géographie, le bloc arrive tel quel du backend — qui a ses propres tests de
 * justesse. Le front n'a qu'à le rendre lisible.
 */
function createTimeBudgetFixture(overrides: Partial<OutingTimeBudget> = {}): OutingTimeBudget {
    return {
        method: 'geoapp_heuristic_v1',
        geocaches_count: 2,
        on_site_minutes: 110,
        on_site_low_minutes: 70,
        on_site_high_minutes: 150,
        travel: {
            legs_count: 1,
            crow_flies_km: 2.66,
            road_km_estimated: 3.5,
            walking_km_estimated: 0,
            driving_stops: 1,
            driving_minutes: 10,
            walking_minutes: 0,
            minutes: 10,
            assumptions: {
                driving_speed_kmh: 45,
                walking_speed_kmh: 3.5,
                road_detour_factor: 1.3,
                walk_detour_factor: 1.25,
                stop_overhead_minutes: 3,
                walking_threshold_km: 0.4,
            },
        },
        includes_travel: true,
        total_minutes: 120,
        total_low_minutes: 80,
        total_high_minutes: 160,
        already_found_minutes: 0,
        unsolved_mystery_minutes: 0,
        heaviest: [{ gc_code: 'GC424242', name: 'Le vieux chene', minutes: 55 }],
        ...overrides,
    };
}

function createBundleFixture(overrides: Partial<OutingAnalysisBundle> = {}): OutingAnalysisBundle {
    const geocaches = overrides.geocaches ?? [createGeocacheFixture()];
    return {
        generated_at: '2026-09-03T10:00:00+00:00',
        outing_date: '2026-09-05',
        requested_count: geocaches.length,
        geocaches,
        missing: [],
        without_local_logs: [],
        stale_logs: [],
        already_found: [],
        geography: createGeographyFixture(),
        time_budget: createTimeBudgetFixture(),
        stats: {
            by_type: { Traditional: geocaches.length },
            by_health_level: { risky: geocaches.length },
            unsolved_mysteries: 0,
            unresolved_gear_signals: 1,
            presolved_gear_signals: 0,
            already_found: 0,
            stale_logs: 0,
            logging_tasks: 0,
            on_site_minutes: 110,
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
            unsolved_mysteries: 0, unresolved_gear_signals: 0, presolved_gear_signals: 0,
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
            unsolved_mysteries: 1, unresolved_gear_signals: 1, presolved_gear_signals: 0,
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
            unsolved_mysteries: 0, unresolved_gear_signals: 1, presolved_gear_signals: 0,
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
            unsolved_mysteries: 0, unresolved_gear_signals: 1, presolved_gear_signals: 0,
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

/**
 * Le cas qui justifie le balayage : en mode léger, le listing est supprimé, mais ce
 * qu'il nomme doit survivre. Sans cette ligne, l'IA n'a aucun moyen de savoir que le
 * propriétaire parle d'une canne à pêche.
 */
function testGearMentionsSurviveTheListingRemoval(): void {
    const scanned = createGeocacheFixture({
        gear_mentions_in_listing: ['fishing_rod', 'ladder'],
        gear_mentions_in_hint: ['magnet'],
    });
    const prompt = buildOutingAnalysisPrompt(createBundleFixture({ geocaches: [scanned] }), {
        ...STANDARD,
        detailLevel: 'light',
    });

    assert.ok(!prompt.includes('Une balade agreable'));
    assert.ok(prompt.includes(
        '- Matériel nommé dans le texte (repérage GeoApp) — listing : fishing_rod, ladder ; hint : magnet'
    ));
}

function testGearMentionsAreOmittedWhenTheTextNamesNothing(): void {
    const prompt = buildOutingAnalysisPrompt(createBundleFixture(), STANDARD);

    assert.ok(!prompt.includes('Matériel nommé dans le texte'));
}

/**
 * Un drapeau refermé par le backend ne porte plus « NON RÉSOLU » : il annonce sa source,
 * pour que le rapport la cite au lieu de rouvrir la question.
 */
function testPresolvedSignalCitesItsSource(): void {
    const resolved = createGeocacheFixture({
        gear_mentions_in_listing: ['fishing_rod'],
        gear_signals: [
            {
                signal: 'special_tool',
                kind: 'gear',
                resolved: true,
                resolved_from: 'listing',
                resolved_gear: ['fishing_rod'],
                label: 'outil special requis — nature a determiner',
                slug: 's-tool',
                source: 'attribute',
                is_negative: false,
            },
        ],
    });
    const prompt = buildOutingAnalysisPrompt(createBundleFixture({ geocaches: [resolved] }), STANDARD);

    assert.ok(prompt.includes('special_tool (résolu depuis le listing : fishing_rod)'));
    assert.ok(!prompt.includes('special_tool (NON RÉSOLU'));
    // Le libellé « nature à déterminer » n'a plus de sens une fois la nature connue.
    assert.ok(!prompt.includes('nature a determiner'));
}

function testPresolvedSignalsAreAnnouncedInTheReliabilitySection(): void {
    const bundle = createBundleFixture({
        stats: {
            by_type: { Traditional: 1 }, by_health_level: { risky: 1 },
            unsolved_mysteries: 0, unresolved_gear_signals: 0, presolved_gear_signals: 2,
            already_found: 0, stale_logs: 0, logging_tasks: 0,
        },
    });
    const prompt = buildOutingAnalysisPrompt(bundle, STANDARD);

    assert.ok(prompt.includes('2 drapeau(x) matériel déjà refermé(s) par GeoApp'));
    assert.ok(prompt.includes('CONFIRMÉS'));
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
            unsolved_mysteries: 0, unresolved_gear_signals: 0, presolved_gear_signals: 0,
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

// ─────────────────────────────────────────────────────────────────────────────
// Géographie et lumière du jour
// ─────────────────────────────────────────────────────────────────────────────

function testGeographySectionCarriesExtentAndRoute(): void {
    const prompt = buildOutingAnalysisPrompt(createBundleFixture(), STANDARD);

    assert.ok(prompt.includes('## Géographie et lumière du jour'));
    assert.ok(prompt.includes('2.66 km entre les deux caches les plus éloignées'));
    assert.ok(prompt.includes('Ordre de visite indicatif'));
    assert.ok(prompt.includes('1. GC424242 — Le vieux chene (départ)'));
    assert.ok(prompt.includes('2. GC999999 — La source (+2.66 km, cumul 2.66 km)'));
}

function testGeographySectionPrecedesTheGeocaches(): void {
    const prompt = buildOutingAnalysisPrompt(createBundleFixture(), STANDARD);

    // Le cadre spatial se lit avant les fiches : il change la lecture de chacune.
    assert.ok(prompt.indexOf('## Géographie') < prompt.indexOf('## Géocaches'));
}

function testCrowFliesWarningAccompaniesEveryDistance(): void {
    const prompt = buildOutingAnalysisPrompt(createBundleFixture(), STANDARD);

    // La confusion vol d'oiseau / distance de marche fausserait toute la planification.
    assert.ok(prompt.includes("VOL D'OISEAU"));
}

function testSunsetIsRenderedWithItsTimezone(): void {
    const prompt = buildOutingAnalysisPrompt(createBundleFixture(), STANDARD);

    assert.ok(prompt.includes('COUCHER 20:25'));
    assert.ok(prompt.includes('nuit noire vers 20:57'));
    assert.ok(prompt.includes('heure locale, UTC+02:00'));
    assert.ok(prompt.includes('13 h 12 de jour'));
}

function testPolarDayIsSpelledOutRatherThanLeftEmpty(): void {
    const geography = createGeographyFixture();
    const prompt = buildOutingAnalysisPrompt(
        createBundleFixture({
            geography: {
                ...geography,
                sun: {
                    ...geography.sun!,
                    sunrise_local: null, sunset_local: null,
                    civil_dawn_local: null, civil_dusk_local: null,
                    sunrise_utc: null, sunset_utc: null,
                    civil_dawn_utc: null, civil_dusk_utc: null,
                    day_length_minutes: null,
                    polar_state: 'polar_day',
                },
            },
        }),
        STANDARD
    );

    assert.ok(prompt.includes('le soleil ne se couche pas de la journée'));
}

function testExcludedCachesAreNamedWithTheirReason(): void {
    const prompt = buildOutingAnalysisPrompt(
        createBundleFixture({
            geography: createGeographyFixture({
                excluded: [
                    { gc_code: 'GC111', reason: 'no_coordinates' },
                    { gc_code: 'GC222', reason: 'unsolved_mystery' },
                ],
            }),
        }),
        STANDARD
    );

    // Sans la raison, leur absence de l'ordre de visite passerait pour un oubli.
    assert.ok(prompt.includes('GC111 (aucune coordonnée en base)'));
    assert.ok(prompt.includes('GC222 (mystery non résolue, coordonnées publiées trompeuses)'));
}

function testWalkingClustersAreRendered(): void {
    const prompt = buildOutingAnalysisPrompt(
        createBundleFixture({
            geography: createGeographyFixture({
                walking_clusters: [{ gc_codes: ['GC1', 'GC2', 'GC3'], count: 3, span_km: 0.31 }],
            }),
        }),
        STANDARD
    );

    assert.ok(prompt.includes('Groupes enchaînables à pied'));
    assert.ok(prompt.includes("GC1, GC2, GC3 (3 caches, 0.31 km d'un bout à l'autre)"));
}

function testGeographySectionIsOmittedWhenNothingIsComputable(): void {
    const prompt = buildOutingAnalysisPrompt(
        createBundleFixture({
            geography: {
                points_count: 0, excluded: [], crow_flies: true, centroid: null,
                bounding_box: null, max_pair_distance_km: null, route: null,
                walking_clusters: [], sun: null,
            },
        }),
        STANDARD
    );

    assert.ok(!prompt.includes('## Géographie'));
}

function testOlderBackendWithoutGeographyDoesNotCrash(): void {
    const bundle = createBundleFixture();
    delete (bundle as Partial<OutingAnalysisBundle>).geography;

    const prompt = buildOutingAnalysisPrompt(bundle, STANDARD);

    assert.ok(prompt.includes('## Géocaches'));
    assert.ok(!prompt.includes('## Géographie'));
}

function testHeaderFallsBackOnTheBundleOutingDate(): void {
    // Le backend a calculé le coucher du soleil pour cette date : l'en-tête doit dire la
    // même, faute de quoi le rapport daterait la sortie autrement que sa propre lumière.
    const prompt = buildOutingAnalysisPrompt(
        createBundleFixture({ outing_date: '2026-12-24' }),
        { detailLevel: 'standard', zoneName: 'Vosges' }
    );

    assert.ok(prompt.includes('Date de la sortie : 2026-12-24'));
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
    // Sans prompt système fourni, le total se confond avec les données.
    assert.equal(one.totalChars, one.chars);
    assert.equal(one.systemPromptChars, 0);
}

/**
 * Le prompt système part dans la même requête que les données.
 *
 * L'estimation d'origine ne comptait que les données : elle annonçait donc un envoi plus
 * léger qu'il ne l'était, de plusieurs milliers de tokens.
 */
function testSystemPromptIsCountedInTheEstimate(): void {
    const prompt = buildOutingAnalysisPrompt(createBundleFixture(), STANDARD);
    const withSystem = estimateOutingPromptSize(prompt, { systemPromptChars: 9000 });

    assert.equal(withSystem.chars, prompt.length);
    assert.equal(withSystem.totalChars, prompt.length + 9000);
    assert.equal(withSystem.approxTokens, Math.ceil((prompt.length + 9000) / 3.6));
}

function testDetailPresetsAreOrdered(): void {
    const { light, standard, full } = OUTING_TIER_PRESETS;

    // Les préréglages doivent rester monotones : léger ⊂ standard ⊂ complet.
    assert.ok(light.listingChars.rich < standard.listingChars.rich);
    assert.ok(standard.listingChars.rich < full.listingChars.rich);
    assert.ok(light.recentLogs.rich < full.recentLogs.rich);

    // Dans chaque niveau, une cache signalée reçoit toujours au moins autant qu'une autre.
    [light, standard, full].forEach(preset => {
        assert.ok(preset.listingChars.rich >= preset.listingChars.lean);
        assert.ok(preset.recentLogs.rich >= preset.recentLogs.lean);
        assert.ok(preset.gearLogs.rich >= preset.gearLogs.lean);
    });

    // Seul le mode complet paie un listing pour une cache sans particularité.
    assert.equal(light.listingChars.lean, 0);
    assert.equal(standard.listingChars.lean, 0);
    assert.ok(full.listingChars.lean > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Temps estimé
// ─────────────────────────────────────────────────────────────────────────────

function testTimeEstimateIsRenderedWithItsBreakdown(): void {
    const prompt = buildOutingAnalysisPrompt(createBundleFixture(), STANDARD);

    assert.ok(prompt.includes('Temps sur place estimé (trajet exclu) : 55 min'));
    assert.ok(prompt.includes('(30–80 min, confiance faible'));
    // Le détail est ce qui autorise le modèle à corriger le chiffre plutôt qu'à le subir.
    assert.ok(prompt.includes('calcul : base traditional 10 + difficulte 3.5 18 + terrain 4 25'));
}

function testTimeEstimateSaysWhyConfidenceIsLow(): void {
    const prompt = buildOutingAnalysisPrompt(createBundleFixture(), STANDARD);

    assert.ok(prompt.includes('drapeau materiel non resolu'));
}

function testTimeBudgetSectionCarriesTotalAndTravel(): void {
    const prompt = buildOutingAnalysisPrompt(createBundleFixture(), STANDARD);

    assert.ok(prompt.includes('## Temps estimé'));
    assert.ok(prompt.includes('Temps sur place, 2 cache(s) : 1 h 50'));
    assert.ok(prompt.includes('Trajet estimé : 10 min'));
    assert.ok(prompt.includes('TOTAL : 2 h 00'));
}

function testTravelAssumptionsAreSpelledOut(): void {
    // Une durée sans hypothèse ne se discute pas : elle se croit ou se jette.
    const prompt = buildOutingAnalysisPrompt(createBundleFixture(), STANDARD);

    assert.ok(prompt.includes("2.66 km à vol d'oiseau × 1.3"));
    assert.ok(prompt.includes('45 km/h'));
    assert.ok(prompt.includes('1 arrêt(s) à 3 min'));
}

function testTimeBudgetOffersDeductionsWithoutApplyingThem(): void {
    const bundle = createBundleFixture({
        time_budget: createTimeBudgetFixture({
            already_found_minutes: 30,
            unsolved_mystery_minutes: 20,
        }),
    });
    const prompt = buildOutingAnalysisPrompt(bundle, STANDARD);

    assert.ok(prompt.includes('Dont 30 min sur des caches déjà trouvées et 20 min sur des mystery'));
    // Le total reste entier : c'est au lecteur de décider ce qu'il retire.
    assert.ok(prompt.includes('TOTAL : 2 h 00'));
}

function testBudgetWithoutRouteSaysSoRatherThanInventingTravel(): void {
    const bundle = createBundleFixture({
        time_budget: createTimeBudgetFixture({
            travel: null,
            includes_travel: false,
            total_minutes: 110,
            total_low_minutes: 70,
            total_high_minutes: 150,
        }),
    });
    const prompt = buildOutingAnalysisPrompt(bundle, STANDARD);

    assert.ok(!prompt.includes('Trajet estimé'));
    assert.ok(prompt.includes("sans trajet — l'ordre de visite n'est pas calculable"));
}

function testHeaviestCachesAreNamed(): void {
    const prompt = buildOutingAnalysisPrompt(createBundleFixture(), STANDARD);

    assert.ok(prompt.includes('Les plus chronophages : GC424242 (55 min)'));
}

function testTimeBudgetSectionPrecedesTheGeocaches(): void {
    const prompt = buildOutingAnalysisPrompt(createBundleFixture(), STANDARD);

    assert.ok(prompt.indexOf('## Temps estimé') < prompt.indexOf('## Géocaches'));
}

function testOlderBackendWithoutTimeEstimateDoesNotCrash(): void {
    // Le bloc vient du réseau : un backend antérieur au lot 9 n'en envoie pas.
    const geocache = createGeocacheFixture();
    delete (geocache as { time_estimate?: unknown }).time_estimate;
    const bundle = createBundleFixture({ geocaches: [geocache] });
    delete (bundle as { time_budget?: unknown }).time_budget;

    const prompt = buildOutingAnalysisPrompt(bundle, STANDARD);

    assert.ok(!prompt.includes('## Temps estimé'));
    assert.ok(!prompt.includes('Temps sur place estimé'));
    assert.ok(prompt.includes('## Géocaches'));
}

function testEmptySelectionHasNoTimeSection(): void {
    const bundle = createBundleFixture({
        geocaches: [],
        time_budget: createTimeBudgetFixture({ geocaches_count: 0 }),
    });

    assert.ok(!buildOutingAnalysisPrompt(bundle, STANDARD).includes('## Temps estimé'));
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
    testGearMentionsSurviveTheListingRemoval();
    testGearMentionsAreOmittedWhenTheTextNamesNothing();
    testPresolvedSignalCitesItsSource();
    testPresolvedSignalsAreAnnouncedInTheReliabilitySection();
    testGeographySectionCarriesExtentAndRoute();
    testGeographySectionPrecedesTheGeocaches();
    testCrowFliesWarningAccompaniesEveryDistance();
    testSunsetIsRenderedWithItsTimezone();
    testPolarDayIsSpelledOutRatherThanLeftEmpty();
    testExcludedCachesAreNamedWithTheirReason();
    testWalkingClustersAreRendered();
    testGeographySectionIsOmittedWhenNothingIsComputable();
    testOlderBackendWithoutGeographyDoesNotCrash();
    testHeaderFallsBackOnTheBundleOutingDate();
    testStandardLevelKeepsTheListing();
    testDetailLevelBoundsRecentLogs();
    testEmptyBundleDoesNotCrash();
    testUnknownHealthIsSpelledOut();
    testNegativeAttributeIsPrefixed();
    testInstructionLineClosesThePrompt();
    testPromptSizeGrowsWithGeocacheCount();
    testSystemPromptIsCountedInTheEstimate();
    testDetailPresetsAreOrdered();
    testTimeEstimateIsRenderedWithItsBreakdown();
    testTimeEstimateSaysWhyConfidenceIsLow();
    testTimeBudgetSectionCarriesTotalAndTravel();
    testTravelAssumptionsAreSpelledOut();
    testTimeBudgetOffersDeductionsWithoutApplyingThem();
    testBudgetWithoutRouteSaysSoRatherThanInventingTravel();
    testHeaviestCachesAreNamed();
    testTimeBudgetSectionPrecedesTheGeocaches();
    testOlderBackendWithoutTimeEstimateDoesNotCrash();
    testEmptySelectionHasNoTimeSection();
    // eslint-disable-next-line no-console
    console.log('outing-analysis-prompt tests passed');
}

run();
