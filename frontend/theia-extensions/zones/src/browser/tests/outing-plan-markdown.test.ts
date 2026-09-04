/**
 * Tests de l'export Markdown d'un plan de sortie (lot 15).
 *
 * Ce qui est vérifié n'est pas la mise en forme mais ce qui ne doit pas disparaître : les
 * cases cochées, les codes GC, la provenance. Une fiche imprimée puis emportée est le seul
 * artefact du chantier que personne ne pourra recouper sur le terrain — elle doit dire
 * d'où elle vient et ce qui a déjà été fait.
 */

import * as assert from 'assert/strict';
import { buildOutingPlanMarkdown, outingPlanFileName } from '../outing-plan-markdown';
import { OutingPlanRecord } from '../outing-plan-types';

function createRecord(overrides: Partial<OutingPlanRecord> = {}): OutingPlanRecord {
    return {
        id: 1,
        zone_name: 'Forêt de Haguenau',
        outing_date: '2026-09-12',
        gc_codes: ['GCAAA', 'GCBBB'],
        checked: [],
        source: 'tool',
        model_name: 'claude-opus-5',
        created_at: '2026-09-04T10:00:00+00:00',
        updated_at: '2026-09-04T10:05:00+00:00',
        plan: {
            version: 1,
            summary: 'Deux caches en forêt, une mystery à résoudre.',
            checklist: [
                {
                    key: 'canne-a-peche', item: 'Canne à pêche', certainty: 'confirmed',
                    gc_codes: ['GCAAA'], reason: 'log de Toto, 12/04/2023',
                },
                {
                    key: 'gants', item: 'Gants', certainty: 'precaution',
                    gc_codes: [], reason: '',
                },
            ],
            alerts: [
                {
                    gc_code: 'GCBBB', severity: 'blocking', kind: 'unsolved_mystery',
                    message: 'Énigme non résolue.',
                },
                { gc_code: null, severity: 'info', kind: 'other', message: 'Journée courte.' },
            ],
            per_cache: [
                {
                    gc_code: 'GCAAA', gear: ['Canne à pêche'], flags: ['gear_required'],
                    minutes: 25, note: 'Cache au-dessus de l\'eau.',
                },
            ],
            order: ['GCAAA', 'GCBBB'],
            time_budget: { on_site_minutes: 120, travel_minutes: 45, total_minutes: 165 },
            to_verify: ['Horaires du parking'],
        },
        ...overrides,
    };
}

function testHeaderCarriesZoneAndDate(): void {
    const markdown = buildOutingPlanMarkdown(createRecord());
    assert.ok(markdown.startsWith('# Sortie — Forêt de Haguenau — 2026-09-12'));
}

function testCheckedItemsAreRenderedAsTickedBoxes(): void {
    const markdown = buildOutingPlanMarkdown(createRecord({ checked: ['canne-a-peche'] }));

    assert.ok(markdown.includes('- [x] Canne à pêche'));
    assert.ok(markdown.includes('- [ ] Gants'));
}

function testChecklistIsGroupedByCertainty(): void {
    const markdown = buildOutingPlanMarkdown(createRecord());
    const confirmed = markdown.indexOf('### Confirmé');
    const precaution = markdown.indexOf('### Par précaution');

    assert.ok(confirmed >= 0 && precaution >= 0);
    assert.ok(confirmed < precaution, 'le confirmé passe avant la précaution');
}

function testGcCodesAndReasonsSurvive(): void {
    const markdown = buildOutingPlanMarkdown(createRecord());
    assert.ok(markdown.includes('GCAAA'));
    assert.ok(markdown.includes('log de Toto, 12/04/2023'));
}

function testBlockingAlertsComeFirst(): void {
    const markdown = buildOutingPlanMarkdown(createRecord());
    assert.ok(markdown.indexOf('Bloquant') < markdown.indexOf('Pour information'));
}

function testBudgetIsRendered(): void {
    const markdown = buildOutingPlanMarkdown(createRecord());
    assert.ok(markdown.includes('total 2 h 45'));
    assert.ok(markdown.includes('2 h sur place'));
    assert.ok(markdown.includes('45 min de trajet'));
}

function testEmptySectionsAreOmitted(): void {
    const record = createRecord();
    record.plan = {
        ...record.plan, alerts: [], order: [], per_cache: [], to_verify: [], time_budget: null,
    };
    const markdown = buildOutingPlanMarkdown(record);

    assert.ok(!markdown.includes('## Alertes'));
    assert.ok(!markdown.includes('## Ordre de visite'));
    assert.ok(!markdown.includes('## À vérifier'));
    assert.ok(markdown.includes('## Checklist matériel'));
}

function testFooterNamesTheAnalysisAndItsLimits(): void {
    const markdown = buildOutingPlanMarkdown(createRecord());

    assert.ok(markdown.includes('Analyse IA GeoApp'));
    assert.ok(markdown.includes('claude-opus-5'));
    assert.ok(markdown.includes('2 géocaches'));
    // La fiche part sur le terrain sans son contexte : elle doit dire qu'elle vient d'un
    // modèle, sans quoi elle se lit comme un calcul de GeoApp.
    assert.ok(markdown.includes("viennent d'un modèle"));
}

function testFileNameIsSortableAndAscii(): void {
    const record = createRecord();
    assert.equal(
        outingPlanFileName(record, 'fiche'),
        'sortie-2026-09-12-foret-de-haguenau-fiche.md'
    );
    assert.equal(
        outingPlanFileName({ ...record, zone_name: '' }, 'rapport'),
        'sortie-2026-09-12-selection-rapport.md'
    );
}

function run(): void {
    testHeaderCarriesZoneAndDate();
    testCheckedItemsAreRenderedAsTickedBoxes();
    testChecklistIsGroupedByCertainty();
    testGcCodesAndReasonsSurvive();
    testBlockingAlertsComeFirst();
    testBudgetIsRendered();
    testEmptySectionsAreOmitted();
    testFooterNamesTheAnalysisAndItsLimits();
    testFileNameIsSortableAndAscii();
    // eslint-disable-next-line no-console
    console.log('outing-plan-markdown tests passed');
}

run();
