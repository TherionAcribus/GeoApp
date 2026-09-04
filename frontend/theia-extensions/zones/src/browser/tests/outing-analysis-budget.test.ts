import * as assert from 'assert/strict';
import {
    buildBudgetedOutingPrompt,
    buildOutingPromptPlan,
    collectionOptionsForPlan,
    decideTier,
} from '../outing-analysis-budget';
import {
    OutingAnalysisBundle,
    OutingAnalysisGeocache,
    OutingGearSignal,
    OUTING_TIER_PRESETS,
} from '../outing-analysis-types';

/** Traditionnelle saine, D2/T2, sans le moindre motif d'enrichissement : le cas `lean`. */
function createGeocache(gcCode: string, overrides: Partial<OutingAnalysisGeocache> = {}): OutingAnalysisGeocache {
    return {
        id: Number(gcCode.replace(/\D/g, '')) || 1,
        gc_code: gcCode,
        name: `Cache ${gcCode}`,
        type: 'Traditional',
        size: 'Small',
        owner: 'Owner',
        difficulty: 1.5,
        terrain: 1.5,
        status: 'active',
        coordinates: 'N 48° 00.000 E 007° 00.000',
        latitude: 48,
        longitude: 7,
        is_corrected: false,
        solved: 'not_solved',
        unsolved_mystery: false,
        favorites_count: 3,
        logs_count: 40,
        placed_at: '2020-01-01T00:00:00+00:00',
        found: false,
        found_date: null,
        hint: 'sous la pierre',
        personal_note: null,
        personal_note_truncated: false,
        notes: [],
        notes_count: 0,
        listing_excerpt: 'Lorem ipsum dolor sit amet. '.repeat(120),
        listing_truncated: true,
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
            local_logs_count: 20,
            last_found_date: '2026-08-20T00:00:00+00:00',
            days_since_last_found: 14,
            consecutive_dnf: 0,
            dnf_ratio_recent: 0,
            needs_maintenance_pending: false,
            listing_status: 'active',
            last_log_date: '2026-08-20T00:00:00+00:00',
            days_since_last_log: 14,
            logs_fetched_at: '2026-09-02T00:00:00+00:00',
            days_since_logs_fetched: 1,
            logs_stale: false,
        },
        recent_logs: Array.from({ length: 10 }, (_, index) => ({
            type: 'Found it',
            date: `2026-08-${`${index + 1}`.padStart(2, '0')}T00:00:00+00:00`,
            author: `Joueur ${index}`,
            text_excerpt: 'Trouvée sans difficulté, merci pour la balade dans ce joli coin. '.repeat(3),
        })),
        gear_logs: Array.from({ length: 8 }, (_, index) => ({
            type: 'Found it',
            date: `2025-06-${`${index + 1}`.padStart(2, '0')}T00:00:00+00:00`,
            author: `Bricoleur ${index}`,
            text_excerpt: "Prévoir une pince, la boîte est coincée au fond du tube métallique. ".repeat(3),
            matched: ['pliers'],
        })),
        search_effort_logs: [],
        ...overrides,
    };
}

function gearSignal(overrides: Partial<OutingGearSignal> = {}): OutingGearSignal {
    return {
        signal: 'special_tool',
        kind: 'gear',
        resolved: false,
        label: 'outil spécial requis — nature à déterminer',
        slug: 's-tool',
        source: 'attribute',
        is_negative: false,
        ...overrides,
    };
}

function createBundle(geocaches: OutingAnalysisGeocache[]): OutingAnalysisBundle {
    return {
        generated_at: '2026-09-04T08:00:00+00:00',
        outing_date: '2026-09-05',
        requested_count: geocaches.length,
        geocaches,
        missing: [],
        without_local_logs: [],
        stale_logs: [],
        already_found: [],
        geography: {
            points_count: geocaches.length, excluded: [], crow_flies: true, centroid: null,
            bounding_box: null, max_pair_distance_km: null, route: null,
            walking_clusters: [], sun: null,
        },
        stats: {
            by_type: {}, by_health_level: {},
            unsolved_mysteries: 0, unresolved_gear_signals: 0, presolved_gear_signals: 0,
            already_found: 0, stale_logs: 0, logging_tasks: 0,
        },
    };
}

const CONTEXT = { detailLevel: 'standard' as const, zoneName: 'Vosges', outingDate: '2026-09-05' };

// ─────────────────────────────────────────────────────────────────────────────
// Décision de palier
// ─────────────────────────────────────────────────────────────────────────────

function testHealthyParkAndGrabStaysLean(): void {
    const decision = decideTier(createGeocache('GC1'));

    assert.equal(decision.tier, 'lean');
    assert.deepEqual(decision.reasons, []);
    assert.equal(decision.priority, 0);
}

function testUnresolvedGearFlagForcesTheListing(): void {
    const decision = decideTier(createGeocache('GC2', { gear_signals: [gearSignal()] }));

    assert.equal(decision.tier, 'rich');
    assert.ok(decision.reasons.some(reason => reason.includes('non résolu')));
}

/** Un drapeau refermé par le balayage du lot 7 n'a plus besoin du texte : il est résolu. */
function testPresolvedGearFlagDoesNotForceTheListing(): void {
    const decision = decideTier(createGeocache('GC3', {
        gear_signals: [gearSignal({ resolved: true, resolved_from: 'listing', resolved_gear: ['pliers'] })],
    }));

    assert.equal(decision.tier, 'lean');
}

function testDegradedHealthForcesTheListing(): void {
    const geocache = createGeocache('GC4');
    geocache.health.level = 'risky';

    assert.equal(decideTier(geocache).tier, 'rich');
}

/** Sans log local, le listing est la seule source qui reste : on le paie. */
function testUnknownHealthForcesTheListing(): void {
    const geocache = createGeocache('GC5');
    geocache.health.level = 'unknown';

    assert.equal(decideTier(geocache).tier, 'rich');
}

function testEarthcacheQuestionsForceTheListing(): void {
    const decision = decideTier(createGeocache('GC6', { logging_tasks_count: 3 }));

    assert.ok(decision.reasons.some(reason => reason.includes('sur place')));
    assert.equal(decision.tier, 'rich');
}

function testMultiStepTypesForceTheListing(): void {
    assert.equal(decideTier(createGeocache('GC7', { type: 'Multi-cache' })).tier, 'rich');
    assert.equal(decideTier(createGeocache('GC8', { type: 'Wherigo Cache' })).tier, 'rich');
    assert.equal(decideTier(createGeocache('GC9', { type: 'Traditional Cache' })).tier, 'lean');
}

function testHighTerrainForcesTheListing(): void {
    assert.equal(decideTier(createGeocache('GCA', { terrain: 4.5 })).tier, 'rich');
}

/** Seuls les contextes dont l'énoncé vit dans le texte comptent, pas « park & grab ». */
function testOnlyConstraintContextsForceTheListing(): void {
    const quick = createGeocache('GCB', {
        gear_signals: [gearSignal({ signal: 'quick', kind: 'context', resolved: true, label: 'park & grab' })],
    });
    const challenge = createGeocache('GCC', {
        gear_signals: [gearSignal({ signal: 'challenge', kind: 'context', resolved: true, label: 'challenge' })],
    });

    assert.equal(decideTier(quick).tier, 'lean');
    assert.equal(decideTier(challenge).tier, 'rich');
}

/** Le poids ordonne les rétrogradations : le cumul des motifs passe avant le motif isolé. */
function testPrioritySumsTheReasons(): void {
    const single = decideTier(createGeocache('GCD', { terrain: 4 }));
    const stacked = createGeocache('GCE', { terrain: 4, gear_signals: [gearSignal()] });

    assert.ok(decideTier(stacked).priority > single.priority);
}

/** Un bundle antérieur au lot 9 n'a pas de `time_estimate` : la règle ne doit pas casser. */
function testMissingFieldsDoNotBreakTheDecision(): void {
    const partial = { gc_code: 'GCF' } as unknown as OutingAnalysisGeocache;

    assert.equal(decideTier(partial).tier, 'lean');
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan et collecte
// ─────────────────────────────────────────────────────────────────────────────

function testPlanMixesTheTwoTiers(): void {
    const bundle = createBundle([
        createGeocache('GC1'),
        createGeocache('GC2', { gear_signals: [gearSignal()] }),
    ]);
    const plan = buildOutingPromptPlan(bundle, 'standard');

    assert.equal(plan.tiers.GC1, 'lean');
    assert.equal(plan.tiers.GC2, 'rich');
    assert.equal(plan.adaptive, true);
    assert.equal(plan.listingChars.rich, OUTING_TIER_PRESETS.standard.listingChars.rich);
}

function testUniformPlanPutsEveryCacheAtTheRichTier(): void {
    const bundle = createBundle([createGeocache('GC1'), createGeocache('GC2')]);
    const plan = buildOutingPromptPlan(bundle, 'standard', { adaptive: false });

    assert.equal(plan.tiers.GC1, 'rich');
    assert.equal(plan.adaptive, false);
}

/** Le serveur ignore les paliers : on lui demande le maximum, on coupe à la rédaction. */
function testCollectionAsksForTheRichestTier(): void {
    const adaptive = collectionOptionsForPlan('full', true);

    assert.equal(adaptive.listingChars, OUTING_TIER_PRESETS.full.listingChars.rich);
    assert.equal(adaptive.recentLogsCount, OUTING_TIER_PRESETS.full.recentLogs.rich);
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt et plafond
// ─────────────────────────────────────────────────────────────────────────────

function testLeanCachesLoseTheirListingButKeepEverythingElse(): void {
    const bundle = createBundle([
        createGeocache('GC1'),
        createGeocache('GC2', { gear_signals: [gearSignal()] }),
    ]);
    const { prompt } = buildBudgetedOutingPrompt(bundle, CONTEXT, { maxTokens: 0 });

    const [, leanBlock, richBlock] = prompt.split('### ');
    assert.ok(leanBlock.startsWith('1. GC1'));
    assert.ok(!leanBlock.includes('- Listing'));
    assert.ok(leanBlock.includes('- Hint : sous la pierre'));
    assert.ok(leanBlock.includes('- Santé : saine'));
    assert.ok(richBlock.includes('- Listing'));
}

/** Le mode complet paie un extrait même pour les caches saines : c'est ce qu'il promet. */
function testFullLevelKeepsAShortListingOnLeanCaches(): void {
    const bundle = createBundle([createGeocache('GC1')]);
    const { prompt } = buildBudgetedOutingPrompt(
        bundle,
        { ...CONTEXT, detailLevel: 'full' },
        { maxTokens: 0 }
    );

    assert.ok(prompt.includes('- Listing'));
}

function testListingIsRecutToTheTierBudget(): void {
    const bundle = createBundle([createGeocache('GC1', { gear_signals: [gearSignal()] })]);
    const { prompt } = buildBudgetedOutingPrompt(
        bundle,
        { ...CONTEXT, detailLevel: 'light' },
        { maxTokens: 0 }
    );

    const listing = prompt.slice(
        prompt.indexOf('- Listing'),
        prompt.indexOf('- Logs mentionnant')
    );
    assert.ok(listing.includes('extrait tronqué'));
    // Marge pour les préfixes de citation ajoutés ligne à ligne.
    assert.ok(listing.length < OUTING_TIER_PRESETS.light.listingChars.rich + 400);
    assert.ok(listing.length > OUTING_TIER_PRESETS.light.listingChars.rich / 2);
}

/**
 * La section de couverture est ce qui empêche le modèle de lire une absence de listing
 * comme une absence d'information. Sans elle, la stratégie mixte serait un piège.
 */
function testCoverageSectionExplainsTheMixedStrategy(): void {
    const bundle = createBundle([
        createGeocache('GC1'),
        createGeocache('GC2', { gear_signals: [gearSignal()] }),
    ]);
    const { prompt } = buildBudgetedOutingPrompt(bundle, CONTEXT, { maxTokens: 0 });

    assert.ok(prompt.includes('## Couverture des données'));
    assert.ok(prompt.includes('listing transmis pour 1 cache(s) sur 2'));
    assert.ok(prompt.includes('PAS dire'));
    assert.ok(prompt.indexOf('## Couverture des données') < prompt.indexOf('## Géocaches'));
}

function testUniformModeHasNoCoverageSection(): void {
    const bundle = createBundle([createGeocache('GC1')]);
    const { prompt } = buildBudgetedOutingPrompt(bundle, CONTEXT, { maxTokens: 0, adaptive: false });

    assert.ok(!prompt.includes('## Couverture des données'));
}

/** Le prompt système part dans la même requête : l'ignorer sous-évaluait l'envoi. */
function testSystemPromptCountsTowardTheEstimate(): void {
    const bundle = createBundle([createGeocache('GC1')]);
    const bare = buildBudgetedOutingPrompt(bundle, CONTEXT, { maxTokens: 0 });
    const withSystem = buildBudgetedOutingPrompt(bundle, CONTEXT, {
        maxTokens: 0,
        systemPromptChars: 7200,
    });

    assert.equal(withSystem.size.chars, bare.size.chars);
    assert.equal(withSystem.size.totalChars, bare.size.chars + 7200);
    assert.ok(withSystem.size.approxTokens > bare.size.approxTokens);
}

function testNoDegradationBelowTheCap(): void {
    const bundle = createBundle([createGeocache('GC1', { gear_signals: [gearSignal()] })]);
    const result = buildBudgetedOutingPrompt(bundle, CONTEXT, { maxTokens: 100000 });

    assert.deepEqual(result.degradations, []);
    assert.equal(result.overBudget, false);
    assert.equal(result.richCount, 1);
}

function testCapTriggersDegradationAndShrinksThePrompt(): void {
    const geocaches = Array.from({ length: 12 }, (_, index) =>
        createGeocache(`GC${index}`, { gear_signals: [gearSignal()] }));
    const bundle = createBundle(geocaches);

    const free = buildBudgetedOutingPrompt(bundle, CONTEXT, { maxTokens: 0 });
    const capped = buildBudgetedOutingPrompt(bundle, CONTEXT, { maxTokens: 4000 });

    assert.ok(capped.size.approxTokens < free.size.approxTokens);
    assert.ok(capped.degradations.length > 0);
    assert.ok(capped.size.approxTokens <= 4000);
}

/** La rétrogradation est annoncée dans le prompt, pas seulement à l'utilisateur. */
function testDegradationIsAnnouncedToTheModel(): void {
    const geocaches = Array.from({ length: 12 }, (_, index) =>
        createGeocache(`GC${index}`, { gear_signals: [gearSignal()] }));
    const capped = buildBudgetedOutingPrompt(createBundle(geocaches), CONTEXT, { maxTokens: 4000 });

    assert.ok(capped.prompt.includes('Plafond de tokens atteint'));
}

/** Le listing part avant les logs : son matériel a déjà été extrait par balayage. */
function testListingsAreSacrificedBeforeLogs(): void {
    const geocaches = Array.from({ length: 12 }, (_, index) =>
        createGeocache(`GC${index}`, { gear_signals: [gearSignal()] }));
    const capped = buildBudgetedOutingPrompt(createBundle(geocaches), CONTEXT, { maxTokens: 4500 });

    assert.ok(capped.plan.tiers.GC0 === 'lean' || capped.plan.listingChars.rich < 2500);
    assert.ok(capped.prompt.includes('Logs mentionnant du matériel'));
}

/** À sacrifice égal, la cache qui cumule les motifs garde son listing le plus longtemps. */
function testTheMostSignalledCacheKeepsItsListingLongest(): void {
    const geocaches = Array.from({ length: 10 }, (_, index) =>
        createGeocache(`GC${index}`, { health: { ...createGeocache('x').health, level: 'watch' } }));
    geocaches[4] = createGeocache('GC4', {
        gear_signals: [gearSignal()],
        terrain: 5,
        logging_tasks_count: 2,
    });
    const capped = buildBudgetedOutingPrompt(createBundle(geocaches), CONTEXT, { maxTokens: 3000 });

    const stillRich = Object.entries(capped.plan.tiers)
        .filter(([, tier]) => tier === 'rich')
        .map(([code]) => code);
    assert.ok(stillRich.length === 0 || stillRich.includes('GC4'));
}

/**
 * Le résumé se lit comme ce qui s'est passé : dans l'ordre, et sans énumérer soixante
 * codes GC — qui coûteraient plus cher que le listing qu'ils remplacent.
 */
function testDegradationSummaryIsOrderedAndAbbreviated(): void {
    const geocaches = Array.from({ length: 20 }, (_, index) =>
        createGeocache(`GC${index}`, { gear_signals: [gearSignal()] }));
    const capped = buildBudgetedOutingPrompt(createBundle(geocaches), CONTEXT, { maxTokens: 1500 });

    const demotion = capped.degradations.findIndex(step => step.includes('listing retiré pour'));
    const logs = capped.degradations.findIndex(step => step.includes('logs récents'));

    assert.ok(demotion >= 0);
    assert.ok(logs === -1 || demotion < logs);
    assert.ok(capped.degradations.some(step => step.includes('autre(s)')));
    assert.ok(!capped.degradations.some(step => step.includes('GC19')));
}

/** Plafond intenable : on envoie quand même, mais on le dit. Refuser après coup serait pire. */
function testImpossibleCapIsReportedRatherThanBlocking(): void {
    const geocaches = Array.from({ length: 40 }, (_, index) => createGeocache(`GC${index}`));
    const result = buildBudgetedOutingPrompt(createBundle(geocaches), CONTEXT, { maxTokens: 100 });

    assert.equal(result.overBudget, true);
    assert.ok(result.prompt.length > 0);
    assert.ok(result.degradations.length > 0);
}

function testEmptyBundleDoesNotCrash(): void {
    const result = buildBudgetedOutingPrompt(createBundle([]), CONTEXT, { maxTokens: 1000 });

    assert.equal(result.richCount, 0);
    assert.equal(result.leanCount, 0);
    assert.ok(!result.prompt.includes('## Couverture des données'));
}

function run(): void {
    testHealthyParkAndGrabStaysLean();
    testUnresolvedGearFlagForcesTheListing();
    testPresolvedGearFlagDoesNotForceTheListing();
    testDegradedHealthForcesTheListing();
    testUnknownHealthForcesTheListing();
    testEarthcacheQuestionsForceTheListing();
    testMultiStepTypesForceTheListing();
    testHighTerrainForcesTheListing();
    testOnlyConstraintContextsForceTheListing();
    testPrioritySumsTheReasons();
    testMissingFieldsDoNotBreakTheDecision();
    testPlanMixesTheTwoTiers();
    testUniformPlanPutsEveryCacheAtTheRichTier();
    testCollectionAsksForTheRichestTier();
    testLeanCachesLoseTheirListingButKeepEverythingElse();
    testFullLevelKeepsAShortListingOnLeanCaches();
    testListingIsRecutToTheTierBudget();
    testCoverageSectionExplainsTheMixedStrategy();
    testUniformModeHasNoCoverageSection();
    testSystemPromptCountsTowardTheEstimate();
    testNoDegradationBelowTheCap();
    testCapTriggersDegradationAndShrinksThePrompt();
    testDegradationIsAnnouncedToTheModel();
    testListingsAreSacrificedBeforeLogs();
    testTheMostSignalledCacheKeepsItsListingLongest();
    testDegradationSummaryIsOrderedAndAbbreviated();
    testImpossibleCapIsReportedRatherThanBlocking();
    testEmptyBundleDoesNotCrash();
    // eslint-disable-next-line no-console
    console.log('outing-analysis-budget tests passed');
}

run();
