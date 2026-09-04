/**
 * Tests de la capture du rapport de sortie (lot 12).
 *
 * Deux mécaniques y sont vérifiées séparément :
 *
 * - l'extraction du bloc JSON, qui doit être tolérante sur la forme et stricte sur le
 *   choix du candidat (le dernier bloc qui ressemble à un plan) ;
 * - la résolution du contexte, c'est-à-dire à quelle sortie rattacher un plan. C'est le
 *   point où une erreur serait invisible : un plan rangé sous la mauvaise date ne
 *   déclencherait aucune alerte, il apparaîtrait simplement dans la mauvaise sortie.
 */

import * as assert from 'assert/strict';
import {
    OutingPlanCaptureService,
    collectPlanCodes,
    extractOutingPlanBlock,
} from '../outing-plan-capture';
import { isOutingSession } from '../outing-plan-response-observer';
import { GEOAPP_OUTING_ANALYZER_AGENT_ID } from '../outing-analysis-types';
import {
    OUTING_SAVE_PLAN_TOOL_ID,
    OUTING_SAVE_PLAN_TOOL_NAME,
    badgesForFlags,
    formatOutingMinutes,
    normalizeChecklistKey,
} from '../outing-plan-types';
import { OutingPlanToolsManager } from '../outing-plan-tools-manager';
import { GeoAppAiToolCatalog } from '../geoapp-chat-tool-catalog';

const PLAN_JSON = JSON.stringify({
    summary: 'Trois caches en forêt',
    checklist: [{ item: 'Lampe frontale', certainty: 'confirmed', gc_codes: ['GCAAA'] }],
    alerts: [{ gc_code: 'GCBBB', severity: 'blocking', kind: 'unsolved_mystery', message: 'À résoudre' }],
    per_cache: [{ gc_code: 'GCAAA', gear: ['Lampe frontale'], minutes: 20 }],
    order: ['GCAAA', 'GCBBB'],
});

function report(block: string, fence = 'json'): string {
    return [
        '## 1. Checklist matériel',
        '- Lampe frontale (confirmé)',
        '',
        '## 5. À vérifier avant de partir',
        '- Horaires du parking',
        '',
        '```' + fence,
        block,
        '```',
    ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Extraction du bloc
// ─────────────────────────────────────────────────────────────────────────────

function testExtractsTheFencedPlan(): void {
    const plan = extractOutingPlanBlock(report(PLAN_JSON)) as Record<string, unknown>;
    assert.ok(plan, 'le bloc doit être trouvé');
    assert.equal((plan.checklist as unknown[]).length, 1);
}

function testAcceptsTheGeoAppFenceTag(): void {
    assert.ok(extractOutingPlanBlock(report(PLAN_JSON, 'geoapp-outing')));
}

function testAcceptsAnUntaggedFence(): void {
    assert.ok(extractOutingPlanBlock(report(PLAN_JSON, '')));
}

function testIgnoresJsonThatIsNotAPlan(): void {
    const text = report(JSON.stringify({ coordonnees: 'N 48 E 007' }));
    assert.equal(extractOutingPlanBlock(text), undefined);
}

function testKeepsTheLastPlanLikeBlock(): void {
    // Un rapport peut citer un JSON en chemin ; le bloc de sortie est par contrat le
    // dernier, et c'est lui qui fait foi.
    const text = [
        report(JSON.stringify({ checklist: [{ item: 'Brouillon' }] })),
        '',
        'Correction :',
        '',
        '```json',
        PLAN_JSON,
        '```',
    ].join('\n');

    const plan = extractOutingPlanBlock(text) as Record<string, unknown>;
    const checklist = plan.checklist as Array<Record<string, unknown>>;
    assert.equal(checklist[0].item, 'Lampe frontale');
}

function testRecoversAnUnterminatedFence(): void {
    // Génération coupée avant les trois back-quotes finales : le plan est là quand même.
    const text = '## Rapport\n\n```json\n' + PLAN_JSON;
    assert.ok(extractOutingPlanBlock(text));
}

function testReturnsUndefinedWithoutABlock(): void {
    assert.equal(extractOutingPlanBlock('Un rapport sans bloc.'), undefined);
    assert.equal(extractOutingPlanBlock(''), undefined);
}

function testMalformedJsonIsIgnoredRatherThanThrowing(): void {
    assert.equal(extractOutingPlanBlock(report('{ "checklist": [ }')), undefined);
}

// ─────────────────────────────────────────────────────────────────────────────
// Codes cités par un plan
// ─────────────────────────────────────────────────────────────────────────────

function testCollectsCodesFromEverySection(): void {
    const codes = collectPlanCodes(JSON.parse(PLAN_JSON));
    assert.deepEqual(codes.sort(), ['GCAAA', 'GCBBB']);
}

function testIgnoresThingsThatAreNotCodes(): void {
    const codes = collectPlanCodes({
        per_cache: [{ gc_code: 'pas un code' }, { gc_code: 'gcccc' }],
        alerts: [{ gc_code: 42 }],
    });
    assert.deepEqual(codes, ['GCCCC']);
}

// ─────────────────────────────────────────────────────────────────────────────
// Résolution du contexte
// ─────────────────────────────────────────────────────────────────────────────

function createCaptureService(): OutingPlanCaptureService {
    return new OutingPlanCaptureService();
}

function testMostRecentOutingIsTheDefault(): void {
    const capture = createCaptureService();
    capture.registerOuting({ zoneName: 'Ancienne', outingDate: '2026-09-10', gcCodes: ['GCAAA'] });
    capture.registerOuting({ zoneName: 'Récente', outingDate: '2026-09-11', gcCodes: ['GCBBB'] });

    assert.equal(capture.resolveContext([])?.zoneName, 'Récente');
}

function testAnnouncedDateWinsOverRecency(): void {
    const capture = createCaptureService();
    capture.registerOuting({ zoneName: 'Samedi', outingDate: '2026-09-12', gcCodes: ['GCAAA'] });
    capture.registerOuting({ zoneName: 'Dimanche', outingDate: '2026-09-13', gcCodes: ['GCBBB'] });

    assert.equal(capture.resolveContext([], '2026-09-12')?.zoneName, 'Samedi');
}

function testCodeOverlapDecidesWhenTheDateIsUnknown(): void {
    const capture = createCaptureService();
    capture.registerOuting({ zoneName: 'Forêt', outingDate: '2026-09-12', gcCodes: ['GCAAA', 'GCBBB'] });
    capture.registerOuting({ zoneName: 'Ville', outingDate: '2026-09-13', gcCodes: ['GCZZZ'] });

    // La sortie la plus récente est « Ville », mais le plan parle des caches de « Forêt ».
    assert.equal(capture.resolveContext(['GCAAA', 'GCBBB'])?.zoneName, 'Forêt');
}

function testRelaunchingTheSameOutingDoesNotDuplicateIt(): void {
    const capture = createCaptureService();
    capture.registerOuting({ zoneName: 'Forêt', outingDate: '2026-09-12', gcCodes: ['GCAAA'] });
    capture.registerOuting({ zoneName: 'Forêt', outingDate: '2026-09-12', gcCodes: ['GCAAA', 'GCBBB'] });

    assert.equal(capture.knownContexts().length, 1);
    assert.deepEqual(capture.knownContexts()[0].gcCodes, ['GCAAA', 'GCBBB']);
}

function testOldContextsAreForgotten(): void {
    const capture = createCaptureService();
    for (let index = 0; index < 12; index++) {
        capture.registerOuting({
            zoneName: `Zone ${index}`,
            outingDate: `2026-09-${`${index + 1}`.padStart(2, '0')}`,
            gcCodes: [],
        });
    }
    assert.ok(capture.knownContexts().length <= 8);
    assert.equal(capture.knownContexts()[0].zoneName, 'Zone 11');
}

function testNoContextResolvesToUndefined(): void {
    assert.equal(createCaptureService().resolveContext(['GCAAA'], '2026-09-12'), undefined);
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconnaissance d'une session de sortie
// ─────────────────────────────────────────────────────────────────────────────

function testOutingSessionIsRecognizedByAgent(): void {
    assert.ok(isOutingSession({
        sessionId: '1', sessionTitle: 'Autre chose', text: '',
        agentId: GEOAPP_OUTING_ANALYZER_AGENT_ID,
    }));
}

function testOutingSessionIsRecognizedByTitle(): void {
    // Une session reprise peut avoir perdu son épinglage sans cesser d'être une sortie.
    assert.ok(isOutingSession({
        sessionId: '1', sessionTitle: 'SORTIE - Forêt - 2026-09-12 (3 caches)', text: '',
    }));
}

function testOtherSessionsAreIgnored(): void {
    assert.equal(isOutingSession({ sessionId: '1', sessionTitle: 'GCAAA - Énigme', text: '' }), false);
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilitaires de présentation
// ─────────────────────────────────────────────────────────────────────────────

function testChecklistKeyMatchesTheServer(): void {
    assert.equal(normalizeChecklistKey('Canne à pêche (télescopique)'), 'canne-a-peche-telescopique');
    assert.equal(normalizeChecklistKey('CANNE A PECHE'), 'canne-a-peche');
    assert.equal(normalizeChecklistKey('  '), '');
}

function testMinutesAreFormattedForReading(): void {
    assert.equal(formatOutingMinutes(40), '40 min');
    assert.equal(formatOutingMinutes(120), '2 h');
    assert.equal(formatOutingMinutes(105), '1 h 45');
    assert.equal(formatOutingMinutes(0), '');
    assert.equal(formatOutingMinutes(null), '');
}

function testBadgesAreOrderedAndFiltered(): void {
    const badges = badgesForFlags(['stale_data', 'blocking', 'licorne', 'gear_required']);
    assert.deepEqual(badges.map(badge => badge.severity), ['blocking', 'warning', 'info']);
    assert.equal(badges.length, 3);
    assert.deepEqual(badgesForFlags([]), []);
    assert.deepEqual(badgesForFlags(undefined), []);
}

// ─────────────────────────────────────────────────────────────────────────────
// Le tool de capture doit être reconnu par la policy
// ─────────────────────────────────────────────────────────────────────────────

/** Expose le tool sans passer par le registre Theia. */
class TestableToolsManager extends OutingPlanToolsManager {
    buildTool() {
        return this.createSavePlanTool();
    }
}

function testToolIdentityMatchesTheSharedConstants(): void {
    const tool = new TestableToolsManager().buildTool();
    assert.equal(tool.id, OUTING_SAVE_PLAN_TOOL_ID);
    assert.equal(tool.name, OUTING_SAVE_PLAN_TOOL_NAME);
}

/**
 * Le catalogue apparie sur `tool.id`. Un identifiant qui diverge de la clé du catalogue
 * ferait sortir le tool de la policy GeoApp : il ne serait ni listé dans le panneau, ni
 * soumis à confirmation, et son écriture en base deviendrait invisible.
 */
function testToolIsManagedByThePolicyCatalog(): void {
    const tool = new TestableToolsManager().buildTool();
    const catalog = new GeoAppAiToolCatalog();
    (catalog as any).toolRegistry = { getAllFunctions: () => [tool] };

    assert.ok(catalog.isGeoAppManagedTool(tool), 'le tool doit être connu du catalogue');

    const entry = catalog.getEntry(OUTING_SAVE_PLAN_TOOL_ID);
    assert.ok(entry);
    // Déclaration honnête : c'est elle qui déclenche la confirmation sous le profil guided.
    assert.equal(entry!.risk, 'local_write');
    assert.equal(entry!.writesLocal, true);
    assert.equal(entry!.defaultEnabled, true);
}

function testToolSchemaAcceptsAWellFormedPlan(): void {
    const tool = new TestableToolsManager().buildTool();
    const parameters = tool.parameters as { properties: Record<string, unknown>; required: string[] };

    for (const key of ['checklist', 'alerts', 'per_cache', 'order', 'time_budget', 'to_verify']) {
        assert.ok(parameters.properties[key], `le schéma doit exposer ${key}`);
    }
    // La checklist est le seul champ obligatoire : un rapport sans matériel à emporter
    // reste un rapport, mais un plan sans aucune section ne sert à rien.
    assert.deepEqual(parameters.required, ['checklist']);
}

function run(): void {
    testExtractsTheFencedPlan();
    testAcceptsTheGeoAppFenceTag();
    testAcceptsAnUntaggedFence();
    testIgnoresJsonThatIsNotAPlan();
    testKeepsTheLastPlanLikeBlock();
    testRecoversAnUnterminatedFence();
    testReturnsUndefinedWithoutABlock();
    testMalformedJsonIsIgnoredRatherThanThrowing();
    testCollectsCodesFromEverySection();
    testIgnoresThingsThatAreNotCodes();
    testMostRecentOutingIsTheDefault();
    testAnnouncedDateWinsOverRecency();
    testCodeOverlapDecidesWhenTheDateIsUnknown();
    testRelaunchingTheSameOutingDoesNotDuplicateIt();
    testOldContextsAreForgotten();
    testNoContextResolvesToUndefined();
    testOutingSessionIsRecognizedByAgent();
    testOutingSessionIsRecognizedByTitle();
    testOtherSessionsAreIgnored();
    testChecklistKeyMatchesTheServer();
    testMinutesAreFormattedForReading();
    testBadgesAreOrderedAndFiltered();
    testToolIdentityMatchesTheSharedConstants();
    testToolIsManagedByThePolicyCatalog();
    testToolSchemaAcceptsAWellFormedPlan();
    // eslint-disable-next-line no-console
    console.log('outing-plan-capture tests passed');
}

run();
