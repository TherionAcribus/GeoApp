import * as assert from 'assert/strict';
import {
    DEFAULT_LOG_IMPROVEMENT_MODE,
    LOG_IMPROVEMENT_MODES,
    buildLogImprovementPrompt,
    getLogImprovementMode,
    isLogImprovementMode,
} from '../log-editor/log-improver';
import { LexiconEntry, buildLexiconPreservationBlock, findLexiconMentions } from '../geocaching-lexicon';

const PATTERNS = new Set(['date', 'cache_name', 'gc_code']);

function testBothModesForbidInventingContent(): void {
    // C'est la règle qui sépare cette fonctionnalité de l'ancienne « génération de log » :
    // elle doit être présente quel que soit le mode, sans exception.
    for (const mode of LOG_IMPROVEMENT_MODES) {
        const prompt = buildLogImprovementPrompt(mode.id, PATTERNS);
        assert.match(prompt, /N'invente RIEN/, `mode ${mode.id}`);
    }
}

function testBothModesForbidTranslating(): void {
    // Le bouton voisin traduit ; celui-ci ne doit jamais le faire à sa place, sans quoi un log
    // corrigé changerait de langue au passage.
    for (const mode of LOG_IMPROVEMENT_MODES) {
        const prompt = buildLogImprovementPrompt(mode.id, PATTERNS);
        assert.match(prompt, /Garde la langue de l'original/, `mode ${mode.id}`);
    }
}

function testProofreadingForbidsRewording(): void {
    const prompt = buildLogImprovementPrompt('proofread', PATTERNS);

    assert.match(prompt, /Ne reformule pas/);
    assert.match(prompt, /mot pour mot/);
    // Le mode rédaction, lui, a le droit de transformer : sa consigne ne doit pas fuiter ici.
    assert.ok(!prompt.includes('texte suivi'));
}

function testRewritingAsksForFlowingProse(): void {
    const prompt = buildLogImprovementPrompt('rewrite', PATTERNS);

    assert.match(prompt, /texte suivi/);
    assert.match(prompt, /TOUTES les idées présentes, et seulement celles-là/);
    assert.ok(!prompt.includes('Ne reformule pas'));
}

function testThePromptNamesThePatternsToPreserve(): void {
    const prompt = buildLogImprovementPrompt('proofread', PATTERNS);

    // Nommés et triés : le prompt doit être stable d'un appel à l'autre.
    assert.match(prompt, /@cache_name, @date, @gc_code/);
}

function testThePromptSurvivesAnEmptyPatternSet(): void {
    const prompt = buildLogImprovementPrompt('rewrite', new Set());

    // Sans pattern connu, la règle reste — un `@quelquechose` peut avoir été tapé à la main.
    assert.match(prompt, /tout token commençant par @/);
    assert.ok(!prompt.includes('@,'));
}

function testTheLexiconBlockIsAbsentWhenNoTermIsFound(): void {
    const prompt = buildLogImprovementPrompt('proofread', PATTERNS, '');

    assert.ok(!prompt.includes('jargon géocaching'));
}

function testTheLexiconBlockTellsTheModelNotToCorrectJargon(): void {
    const lexicon: LexiconEntry[] = [
        { term: 'DNF', gloss: 'Did Not Find', policy: 'keep' },
    ];
    const block = buildLexiconPreservationBlock(findLexiconMentions('DNF pour moi aujourdhui', lexicon));
    const prompt = buildLogImprovementPrompt('proofread', PATTERNS, block);

    assert.match(prompt, /à ne corriger ni remplacer ni développer/);
    assert.match(prompt, /« DNF »/);
}

function testALexiconTermIsNotRenderedInATargetLanguage(): void {
    // « PAT » doit rester « PAT », alors que la traduction en ferait « FTF » : corriger les
    // fautes ne doit pas déplacer le vocabulaire.
    const lexicon: LexiconEntry[] = [
        { term: 'PAT', gloss: 'Premier à trouver', policy: 'map', translations: { en: 'FTF' } },
    ];
    const block = buildLexiconPreservationBlock(findLexiconMentions('PAT !', lexicon));

    assert.match(block, /« PAT »/);
    assert.ok(!block.includes('FTF'));
}

function testAnUnknownModeFallsBackToTheDefault(): void {
    assert.equal(isLogImprovementMode('proofread'), true);
    assert.equal(isLogImprovementMode('traduire'), false);
    assert.equal(isLogImprovementMode(undefined), false);

    // Un mode retiré du code ne doit pas laisser le bouton sans libellé.
    assert.equal(getLogImprovementMode('inconnu' as never).id, DEFAULT_LOG_IMPROVEMENT_MODE);
}

function run(): void {
    testBothModesForbidInventingContent();
    testBothModesForbidTranslating();
    testProofreadingForbidsRewording();
    testRewritingAsksForFlowingProse();
    testThePromptNamesThePatternsToPreserve();
    testThePromptSurvivesAnEmptyPatternSet();
    testTheLexiconBlockIsAbsentWhenNoTermIsFound();
    testTheLexiconBlockTellsTheModelNotToCorrectJargon();
    testALexiconTermIsNotRenderedInATargetLanguage();
    testAnUnknownModeFallsBackToTheDefault();
    // eslint-disable-next-line no-console
    console.log('log-improver tests passed');
}

run();
