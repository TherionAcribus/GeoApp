import * as assert from 'assert/strict';
import {
    assembleTranslation,
    buildLogTranslationPrompt,
    buildTranslationSource,
    extractPatternTokens,
    findLostPatterns,
} from '../log-editor/log-translator';
import { computeHistoryApplication } from '../log-editor/log-history-store';
import { LogHistoryEntry } from '../log-editor/types';

function createHistoryEntry(overrides: Partial<LogHistoryEntry> = {}): LogHistoryEntry {
    return {
        id: 'h1',
        createdAt: '2026-09-18T10:00:00.000Z',
        logDate: '2026-09-18',
        logLanguage: 'Allemand',
        useSameTextForAll: true,
        globalText: 'Schöne Wanderung.',
        perCacheText: {},
        logType: 'found',
        perCacheLogType: {},
        perCacheFavorite: {},
        ...overrides,
    };
}

const PATTERNS = new Set(['date', 'cache_count', 'cache_name', 'cache_owner', 'gc_code', 'mon_pattern']);

function testThePromptCarriesTheTargetLanguage(): void {
    const prompt = buildLogTranslationPrompt('Néerlandais', PATTERNS);

    assert.match(prompt, /Traduis en Néerlandais/);
}

function testThePromptNamesThePatternsToPreserve(): void {
    const prompt = buildLogTranslationPrompt('Anglais', PATTERNS);

    // Les tokens sont listés nommément : un modèle moyen respecte mieux une consigne concrète.
    assert.match(prompt, /@cache_name/);
    assert.match(prompt, /@mon_pattern/);
    assert.match(prompt, /Ne les traduis pas/);
}

function testThePromptSurvivesAnEmptyPatternSet(): void {
    const prompt = buildLogTranslationPrompt('Anglais', new Set<string>());

    assert.match(prompt, /tout token commençant par @/);
    assert.doesNotMatch(prompt, /: \./);
}

function testThePromptProtectsMarkdownAndTechnicalIdentifiers(): void {
    const prompt = buildLogTranslationPrompt('Allemand', PATTERNS);

    assert.match(prompt, /Markdown/);
    assert.match(prompt, /codes GC/);
    // La mention de traduction est dans le texte source : le modèle doit la traduire aussi.
    assert.match(prompt, /y compris la dernière ligne/);
}

function testTheNoticeIsAppendedToTheSourceBeforeTranslation(): void {
    const source = buildTranslationSource('Belle balade.', true, '*Traduction automatique.*');

    assert.equal(source, 'Belle balade.\n\n*Traduction automatique.*');
}

function testTheNoticeIsOmittedWhenDisabledOrEmpty(): void {
    assert.equal(buildTranslationSource('Belle balade.', false, '*Traduction automatique.*'), 'Belle balade.');
    assert.equal(buildTranslationSource('Belle balade.', true, '   '), 'Belle balade.');
}

function testReplaceModeKeepsOnlyTheTranslation(): void {
    const result = assembleTranslation('Belle balade.', 'Nice hike.', 'replace', '---');

    assert.equal(result, 'Nice hike.');
}

function testBilingualModeStacksOriginalThenTranslation(): void {
    const result = assembleTranslation('Belle balade.', 'Nice hike.', 'bilingual', '---');

    assert.equal(result, 'Belle balade.\n\n---\n\nNice hike.');
}

function testBilingualModeToleratesAnEmptySeparator(): void {
    const result = assembleTranslation('Belle balade.', 'Nice hike.', 'bilingual', '  ');

    assert.equal(result, 'Belle balade.\n\nNice hike.');
}

function testBilingualModeWithoutOriginalFallsBackToTheTranslation(): void {
    const result = assembleTranslation('   ', 'Nice hike.', 'bilingual', '---');

    assert.equal(result, 'Nice hike.');
}

function testOnlyKnownPatternsAreTracked(): void {
    const tokens = extractPatternTokens('Trouvée le @date par @inconnu sur @gc_code', PATTERNS);

    assert.deepEqual([...tokens].sort(), ['date', 'gc_code']);
}

function testATranslatedPatternIsReportedAsLost(): void {
    const lost = findLostPatterns(
        'Trouvée le @date, cache @cache_name de @cache_owner.',
        'Found on @date, cache @nom_cache from @cache_owner.',
        PATTERNS
    );

    assert.deepEqual(lost, ['cache_name']);
}

function testAnIntactTranslationReportsNothing(): void {
    const lost = findLostPatterns(
        'Trouvée le @date, merci @cache_owner !',
        'Found on @date, thanks @cache_owner!',
        PATTERNS
    );

    assert.deepEqual(lost, []);
}

function testAnUnknownTokenIsNeverReported(): void {
    // `@teamGeo` n'est pas un pattern : le modèle a le droit de le laisser ou de le déplacer.
    const lost = findLostPatterns('Bravo @teamGeo pour @gc_code', 'Well done for @gc_code', PATTERNS);

    assert.deepEqual(lost, []);
}

function testAPinnedLanguageIsNotOverwrittenByHistory(): void {
    const result = computeHistoryApplication(createHistoryEntry(), 'found', false, true);

    // Même règle que la date épinglée : `undefined` veut dire « ne pas toucher ».
    assert.equal(result.logLanguage, undefined);
}

function testAnUnpinnedLanguageIsRestoredFromHistory(): void {
    const result = computeHistoryApplication(createHistoryEntry(), 'found', false, false);

    assert.equal(result.logLanguage, 'Allemand');
}

function testAnEntryWithoutLanguageChangesNothing(): void {
    // Les entrées écrites avant la fonctionnalité n'ont pas de langue : ne rien imposer.
    const result = computeHistoryApplication(createHistoryEntry({ logLanguage: undefined }), 'found', false, false);

    assert.equal(result.logLanguage, undefined);
}

function run(): void {
    testThePromptCarriesTheTargetLanguage();
    testThePromptNamesThePatternsToPreserve();
    testThePromptSurvivesAnEmptyPatternSet();
    testThePromptProtectsMarkdownAndTechnicalIdentifiers();
    testTheNoticeIsAppendedToTheSourceBeforeTranslation();
    testTheNoticeIsOmittedWhenDisabledOrEmpty();
    testReplaceModeKeepsOnlyTheTranslation();
    testBilingualModeStacksOriginalThenTranslation();
    testBilingualModeToleratesAnEmptySeparator();
    testBilingualModeWithoutOriginalFallsBackToTheTranslation();
    testOnlyKnownPatternsAreTracked();
    testATranslatedPatternIsReportedAsLost();
    testAnIntactTranslationReportsNothing();
    testAnUnknownTokenIsNeverReported();
    testAPinnedLanguageIsNotOverwrittenByHistory();
    testAnUnpinnedLanguageIsRestoredFromHistory();
    testAnEntryWithoutLanguageChangesNothing();
    // eslint-disable-next-line no-console
    console.log('log-translator tests passed');
}

run();
