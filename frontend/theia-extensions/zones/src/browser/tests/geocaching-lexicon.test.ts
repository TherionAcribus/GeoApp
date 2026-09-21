import * as assert from 'assert/strict';
import {
    BUILTIN_GEOCACHING_LEXICON,
    LexiconEntry,
    buildLexiconTranslationBlock,
    buildLexiconWritingBlock,
    findLexiconDeviations,
    findLexiconMentions,
    lexiconTermKey,
    normalizeLanguageKey,
    resolveLexicon,
} from '../geocaching-lexicon';

/** Lexique réduit : les tests de détection ne doivent pas dépendre du contenu du fond intégré. */
const SAMPLE: LexiconEntry[] = [
    { term: 'DNF', gloss: 'Did Not Find', policy: 'keep' },
    { term: 'logbook', aliases: ['log book'], gloss: 'le carnet à signer', policy: 'keep' },
    {
        term: 'PAT',
        aliases: ['P.A.T.', 'premier à trouver'],
        gloss: 'Premier À Trouver',
        policy: 'map',
        translations: { fr: 'PAT', en: 'FTF', de: 'FTF' },
    },
    {
        term: 'boîte',
        gloss: 'le contenant de la cache',
        policy: 'map',
        translations: { fr: 'boîte', en: 'container' },
    },
];

function termsOf(entries: readonly LexiconEntry[]): string[] {
    return entries.map(entry => entry.term);
}

// ── Normalisation ───────────────────────────────────────────────────────────

function testLanguageNamesCollapseToOneKey(): void {
    // Trois graphies pour la même colonne d'équivalents : la liste de l'éditeur de logs écrit
    // « Anglais », la préférence des listings écrit `francais`, un utilisateur peut écrire « English ».
    assert.equal(normalizeLanguageKey('Anglais'), 'en');
    assert.equal(normalizeLanguageKey('English'), 'en');
    assert.equal(normalizeLanguageKey('EN'), 'en');
    assert.equal(normalizeLanguageKey('francais'), 'fr');
    assert.equal(normalizeLanguageKey('Français'), 'fr');
}

function testAnUnknownLanguageKeepsAStableKey(): void {
    // Une langue hors table doit rester utilisable comme colonne : même nom, même clé.
    assert.equal(normalizeLanguageKey('Breton'), 'breton');
    assert.equal(normalizeLanguageKey('  BRETON '), 'breton');
    assert.equal(normalizeLanguageKey(undefined), '');
}

function testTermKeysIgnoreCaseAndAccents(): void {
    assert.equal(lexiconTermKey('Boîte'), lexiconTermKey('boite'));
    assert.equal(lexiconTermKey('Point  Favori'), 'point favori');
}

// ── Détection ───────────────────────────────────────────────────────────────

function testOnlyMentionedTermsAreReturned(): void {
    const mentions = findLexiconMentions('Un DNF de plus, la boîte reste introuvable.', SAMPLE);

    assert.deepEqual(termsOf(mentions), ['DNF', 'boîte']);
}

function testDetectionIsOrderedByTheLexiconNotTheText(): void {
    // L'ordre du lexique rend le bloc de prompt stable d'un appel à l'autre.
    const mentions = findLexiconMentions('La boîte est solide, mais DNF quand même.', SAMPLE);

    assert.deepEqual(termsOf(mentions), ['DNF', 'boîte']);
}

function testAcronymsAreMatchedCaseSensitively(): void {
    // « pat » en minuscules est un mot ordinaire : le matcher coûterait une consigne absurde
    // sur la moitié des logs.
    assert.deepEqual(termsOf(findLexiconMentions('Il a tapé sur le pat du chien.', SAMPLE)), []);
    assert.deepEqual(termsOf(findLexiconMentions('PAT pour moi !', SAMPLE)), ['PAT']);
}

function testOrdinaryTermsIgnoreCaseAndAccents(): void {
    assert.deepEqual(termsOf(findLexiconMentions('Le Logbook était trempé.', SAMPLE)), ['logbook']);
    assert.deepEqual(termsOf(findLexiconMentions('la boite etait cachee', SAMPLE)), ['boîte']);
}

function testAliasesAndPluralsAreDetected(): void {
    assert.deepEqual(termsOf(findLexiconMentions('Le log book est plein.', SAMPLE)), ['logbook']);
    assert.deepEqual(termsOf(findLexiconMentions('Deux DNFs cette semaine.', SAMPLE)), ['DNF']);
    assert.deepEqual(termsOf(findLexiconMentions('Je suis premier à trouver.', SAMPLE)), ['PAT']);
}

function testWordBoundariesAvoidFalsePositives(): void {
    // « DNF » dans « DNFinder », « boîte » dans « emboîter » : rien ne doit matcher.
    assert.deepEqual(termsOf(findLexiconMentions('DNFinder et emboîtement.', SAMPLE)), []);
}

function testPatternTokensAreNotProse(): void {
    // Les noms de @patterns sont en snake_case et pleins de jargon : sans le souligné et le `@`
    // dans les frontières, « logbook » se ferait repérer au milieu de @logbook_state.
    const withPattern: LexiconEntry[] = [
        ...SAMPLE,
        { term: 'owner', gloss: 'le propriétaire', policy: 'keep' },
    ];

    assert.deepEqual(termsOf(findLexiconMentions('Merci @cache_owner pour la pose.', withPattern)), []);
    assert.deepEqual(termsOf(findLexiconMentions('Le @logbook était plein.', withPattern)), []);
    // Le terme reste détecté dès qu'il est employé comme mot.
    assert.deepEqual(termsOf(findLexiconMentions('Merci à l’owner pour la pose.', withPattern)), ['owner']);
}

function testAnEmptyTextMentionsNothing(): void {
    assert.deepEqual(findLexiconMentions('   ', SAMPLE), []);
    assert.deepEqual(findLexiconMentions(undefined, SAMPLE), []);
}

// ── Fusion intégré + personnel ──────────────────────────────────────────────

function testWithoutUserEntriesTheBuiltinLexiconIsUsedAsIs(): void {
    assert.equal(resolveLexicon(undefined), BUILTIN_GEOCACHING_LEXICON);
    assert.equal(resolveLexicon([]), BUILTIN_GEOCACHING_LEXICON);
}

function testAUserEntryReplacesTheBuiltinOneAndKeepsItsRank(): void {
    const resolved = resolveLexicon([{ term: 'dnf', gloss: 'à moi', policy: 'keep' }]);

    const index = resolved.findIndex(entry => lexiconTermKey(entry.term) === 'dnf');
    assert.equal(resolved[index].gloss, 'à moi');
    assert.equal(index, BUILTIN_GEOCACHING_LEXICON.findIndex(entry => entry.term === 'DNF'));
    assert.equal(resolved.length, BUILTIN_GEOCACHING_LEXICON.length);
}

function testADisabledEntryDisappears(): void {
    const resolved = resolveLexicon([{ term: 'DNF', policy: 'keep', disabled: true }]);

    assert.equal(resolved.some(entry => entry.term === 'DNF'), false);
    assert.equal(resolved.length, BUILTIN_GEOCACHING_LEXICON.length - 1);
}

function testAnUnknownUserTermIsAppended(): void {
    const resolved = resolveLexicon([{ term: 'pétou', gloss: 'la cache locale', policy: 'keep' }]);

    assert.equal(resolved[resolved.length - 1].term, 'pétou');
}

function testEmptyUserEntriesAreIgnored(): void {
    const resolved = resolveLexicon([{ term: '   ', policy: 'keep' }] as LexiconEntry[]);

    assert.equal(resolved.length, BUILTIN_GEOCACHING_LEXICON.length);
}

// ── Rendu du bloc de prompt ─────────────────────────────────────────────────

function testNothingDetectedMeansNoBlockAtAll(): void {
    // Un bloc vide coûterait des tokens et diluerait les autres consignes.
    assert.equal(buildLexiconTranslationBlock([], 'Anglais'), '');
    assert.equal(buildLexiconWritingBlock([], 'Anglais'), '');
}

function testAKeepEntryAsksToLeaveTheTermAlone(): void {
    const block = buildLexiconTranslationBlock(findLexiconMentions('DNF', SAMPLE), 'Anglais');

    assert.match(block, /« DNF » \(Did Not Find\)/);
    assert.match(block, /garde-le tel quel/);
}

function testAMappedEntryCarriesTheTargetLanguageForm(): void {
    const block = buildLexiconTranslationBlock(findLexiconMentions('PAT !', SAMPLE), 'Anglais');

    assert.match(block, /« FTF »/);
    assert.match(block, /en Anglais/);
}

function testAMappedEntryWithoutEquivalentFallsBackOnItsGloss(): void {
    // Pas de colonne « Breton » : la glose suffit au modèle pour traduire d'après le sens.
    const block = buildLexiconTranslationBlock(findLexiconMentions('PAT !', SAMPLE), 'Breton');

    assert.match(block, /aucune forme consacrée en Breton/);
    assert.match(block, /Premier À Trouver/);
}

function testTheWritingBlockAsksForTheTermInsteadOfPreservingIt(): void {
    const block = buildLexiconWritingBlock(findLexiconMentions('PAT et DNF', SAMPLE), 'Anglais');

    assert.match(block, /Vocabulaire géocaching à employer/);
    assert.match(block, /« FTF » en Anglais/);
    assert.match(block, /« DNF ».*écris-le tel quel/);
}

// ── Garde-fou ───────────────────────────────────────────────────────────────

function testATranslatedAcronymIsReported(): void {
    const mentions = findLexiconMentions('DNF pour moi.', SAMPLE);
    const deviations = findLexiconDeviations('DNF pour moi.', "I could not find it.", mentions, 'Anglais');

    assert.deepEqual(deviations, [{ term: 'DNF', expected: 'DNF' }]);
}

function testARespectedMappingIsNotReported(): void {
    const mentions = findLexiconMentions('PAT et DNF !', SAMPLE);
    const deviations = findLexiconDeviations('PAT et DNF !', 'FTF and DNF!', mentions, 'Anglais');

    assert.deepEqual(deviations, []);
}

function testAMissedMappingIsReportedWithTheExpectedForm(): void {
    const mentions = findLexiconMentions('PAT !', SAMPLE);
    const deviations = findLexiconDeviations('PAT !', 'First to find!', mentions, 'Anglais');

    assert.deepEqual(deviations, [{ term: 'PAT', expected: 'FTF' }]);
}

function testAnEntryWithoutExpectedFormIsNeverReported(): void {
    // Rien n'était attendu en breton : rien ne peut manquer.
    const mentions = findLexiconMentions('PAT !', SAMPLE);

    assert.deepEqual(findLexiconDeviations('PAT !', 'Kentañ o kavout!', mentions, 'Breton'), []);
}

function testTheCheckIgnoresCaseAndAccents(): void {
    const mentions = findLexiconMentions('la boîte est petite', SAMPLE);

    assert.deepEqual(findLexiconDeviations('la boîte est petite', 'The Container is small', mentions, 'Anglais'), []);
}

// ── Fond intégré ────────────────────────────────────────────────────────────

function testTheBuiltinLexiconIsWellFormed(): void {
    assert.ok(BUILTIN_GEOCACHING_LEXICON.length > 20);

    const seen = new Set<string>();
    for (const entry of BUILTIN_GEOCACHING_LEXICON) {
        const key = lexiconTermKey(entry.term);
        assert.equal(seen.has(key), false, `terme en double dans le lexique intégré : ${entry.term}`);
        seen.add(key);
        assert.ok(entry.policy === 'keep' || entry.policy === 'map', `politique inconnue pour ${entry.term}`);
        if (entry.policy === 'map') {
            assert.ok(
                Object.keys(entry.translations ?? {}).length > 0,
                `entrée « map » sans équivalent : ${entry.term}`
            );
        }
        // Chaque terme doit se détecter lui-même, sans quoi l'entrée est morte.
        assert.deepEqual(
            termsOf(findLexiconMentions(entry.term, [entry])),
            [entry.term],
            `terme non détecté : ${entry.term}`
        );
    }
}

function testTheBuiltinLexiconCarriesTheAsymmetryOfFtf(): void {
    // Le cas d'école : PAT devient FTF en anglais, mais FTF ne redevient jamais PAT.
    const pat = BUILTIN_GEOCACHING_LEXICON.find(entry => entry.term === 'PAT');
    const ftf = BUILTIN_GEOCACHING_LEXICON.find(entry => entry.term === 'FTF');

    assert.equal(pat?.translations?.en, 'FTF');
    assert.equal(ftf?.policy, 'keep');
    assert.match(buildLexiconTranslationBlock([ftf as LexiconEntry], 'Français'), /garde-le tel quel/);
}

function run(): void {
    testLanguageNamesCollapseToOneKey();
    testAnUnknownLanguageKeepsAStableKey();
    testTermKeysIgnoreCaseAndAccents();
    testOnlyMentionedTermsAreReturned();
    testDetectionIsOrderedByTheLexiconNotTheText();
    testAcronymsAreMatchedCaseSensitively();
    testOrdinaryTermsIgnoreCaseAndAccents();
    testAliasesAndPluralsAreDetected();
    testWordBoundariesAvoidFalsePositives();
    testPatternTokensAreNotProse();
    testAnEmptyTextMentionsNothing();
    testWithoutUserEntriesTheBuiltinLexiconIsUsedAsIs();
    testAUserEntryReplacesTheBuiltinOneAndKeepsItsRank();
    testADisabledEntryDisappears();
    testAnUnknownUserTermIsAppended();
    testEmptyUserEntriesAreIgnored();
    testNothingDetectedMeansNoBlockAtAll();
    testAKeepEntryAsksToLeaveTheTermAlone();
    testAMappedEntryCarriesTheTargetLanguageForm();
    testAMappedEntryWithoutEquivalentFallsBackOnItsGloss();
    testTheWritingBlockAsksForTheTermInsteadOfPreservingIt();
    testATranslatedAcronymIsReported();
    testARespectedMappingIsNotReported();
    testAMissedMappingIsReportedWithTheExpectedForm();
    testAnEntryWithoutExpectedFormIsNeverReported();
    testTheCheckIgnoresCaseAndAccents();
    testTheBuiltinLexiconIsWellFormed();
    testTheBuiltinLexiconCarriesTheAsymmetryOfFtf();
    // eslint-disable-next-line no-console
    console.log('geocaching-lexicon tests passed');
}

run();
