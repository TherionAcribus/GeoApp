import * as assert from 'assert/strict';
import {
    findFormatAtCaret,
    findUnrenderedEmphasis,
    InlineToken,
    parseMarkdownBlocks,
    sanitizeLogUrl,
    toggleMarkdownFormat,
    tokenizeInlineMarkdown,
    unwrapMarkdownSelection,
} from '../log-markdown';

function kinds(tokens: InlineToken[]): string[] {
    return tokens.map(t => t.kind);
}

function plainText(tokens: InlineToken[]): string {
    return tokens.map(t => (t.kind === 'link' ? t.label : t.content)).join('');
}

function testBoldAndItalic(): void {
    const bold = tokenizeInlineMarkdown('Merci **pour la balade** !');
    assert.deepEqual(kinds(bold), ['text', 'bold', 'text']);
    assert.equal((bold[1] as any).content, 'pour la balade');

    const italic = tokenizeInlineMarkdown('une *belle* cache');
    assert.deepEqual(kinds(italic), ['text', 'italic', 'text']);
    assert.equal((italic[1] as any).content, 'belle');
}

function testEmphasisRequiresDelimitersGluedToText(): void {
    // Cas réel : espace avant le `**` fermant. Geocaching.com ne met pas en gras,
    // l'aperçu ne doit donc pas le faire non plus.
    const trailingSpace = tokenizeInlineMarkdown('**Merci pour la balade et pour les caches ! **');
    assert.deepEqual(kinds(trailingSpace), ['text']);
    assert.equal((trailingSpace[0] as any).content, '**Merci pour la balade et pour les caches ! **');

    const leadingSpace = tokenizeInlineMarkdown('** pas gras**');
    assert.deepEqual(kinds(leadingSpace), ['text']);

    // Une emphase valide plus loin dans la ligne reste reconnue.
    const mixed = tokenizeInlineMarkdown('2 ** 3 et **vrai gras**');
    assert.deepEqual(kinds(mixed), ['text', 'bold']);
    assert.equal((mixed[1] as any).content, 'vrai gras');
}

function testUnterminatedEmphasisStaysLiteral(): void {
    const truncated = tokenizeInlineMarkdown('Un log coupé au milieu du **gras');
    assert.deepEqual(kinds(truncated), ['text']);
    assert.equal(plainText(truncated), 'Un log coupé au milieu du **gras');

    const lonely = tokenizeInlineMarkdown('3 * 4 = 12');
    assert.deepEqual(kinds(lonely), ['text']);
    assert.equal(plainText(lonely), '3 * 4 = 12');
}

function testCodeAndLinks(): void {
    const code = tokenizeInlineMarkdown('la valeur `N 47°` est bonne');
    assert.deepEqual(kinds(code), ['text', 'code', 'text']);
    assert.equal((code[1] as any).content, 'N 47°');

    const link = tokenizeInlineMarkdown('voir [le site](https://www.geocaching.com) ici');
    assert.deepEqual(kinds(link), ['text', 'link', 'text']);
    assert.equal((link[1] as any).safeUrl, 'https://www.geocaching.com');

    const unsafe = tokenizeInlineMarkdown('[clic](javascript:alert(1))');
    assert.equal(kinds(unsafe)[0], 'link');
    assert.equal((unsafe[0] as any).safeUrl, undefined);
}

function testSanitizeLogUrl(): void {
    assert.equal(sanitizeLogUrl('https://www.geocaching.com'), 'https://www.geocaching.com');
    assert.equal(sanitizeLogUrl('http://example.com'), 'http://example.com');
    assert.equal(sanitizeLogUrl('javascript:alert(1)'), undefined);
    assert.equal(sanitizeLogUrl('  '), undefined);
    assert.equal(sanitizeLogUrl(''), undefined);
}

function testBlocks(): void {
    const blocks = parseMarkdownBlocks([
        '# Titre',
        '',
        'Un paragraphe',
        'sur deux lignes',
        '',
        '- item 1',
        '- item 2',
        '',
        '> une citation',
    ].join('\n'));

    assert.deepEqual(blocks.map(b => b.kind), ['heading', 'paragraph', 'list', 'quote']);
    assert.equal((blocks[0] as any).level, 1);
    assert.deepEqual((blocks[1] as any).lines, ['Un paragraphe', 'sur deux lignes']);
    assert.deepEqual((blocks[2] as any).items, ['item 1', 'item 2']);
    assert.deepEqual((blocks[3] as any).blocks.map((b: any) => b.kind), ['paragraph']);
}

function testFencedCodeBlock(): void {
    const blocks = parseMarkdownBlocks('```\nN 47 12.345\nE 006 12.345\n```');
    assert.deepEqual(blocks.map(b => b.kind), ['code']);
    assert.equal((blocks[0] as any).content, 'N 47 12.345\nE 006 12.345');
}

function testFindUnrenderedEmphasis(): void {
    const log = [
        'Petite balade autour de Château-Rouge.',
        'La première partie sera stoppée net par des travaux forestiers.',
        '**Merci pour la balade et pour les caches ! **',
    ].join('\n');
    assert.deepEqual(findUnrenderedEmphasis(log), ['**Merci pour la balade et pour les caches ! **']);

    // Emphase valide : rien à signaler.
    assert.deepEqual(findUnrenderedEmphasis('**Merci pour la balade !**'), []);

    // Une astérisque isolée n'est pas une emphase ratée (multiplication).
    assert.deepEqual(findUnrenderedEmphasis('3 * 4 = 12'), []);

    assert.deepEqual(findUnrenderedEmphasis(''), []);
}

function testUnwrapMarkdownSelection(): void {
    // Sélection du texte intérieur (`beaucoup`) : les `**` autour sont retirés.
    const inner = unwrapMarkdownSelection('Merci **beaucoup** !', 8, 16, '**', '**');
    assert.equal(inner?.value, 'Merci beaucoup !');
    assert.equal(inner?.selectionStart, 6);
    assert.equal(inner?.selectionEnd, 14);

    // Sélection incluant les délimiteurs.
    const outer = unwrapMarkdownSelection('Merci **beaucoup** !', 6, 18, '**', '**');
    assert.equal(outer?.value, 'Merci beaucoup !');
    assert.equal(outer?.selectionStart, 6);
    assert.equal(outer?.selectionEnd, 14);

    // Texte non formaté : pas de retrait, l'appelant enveloppera.
    assert.equal(unwrapMarkdownSelection('Merci beaucoup !', 6, 14, '**', '**'), undefined);

    // Le bouton Italique ne doit pas grignoter un gras : `**gras**` ne devient pas `*gras*`.
    assert.equal(unwrapMarkdownSelection('**gras**', 2, 6, '*', '*'), undefined);

    // Italique réel : retrait correct.
    const italic = unwrapMarkdownSelection('une *belle* cache', 5, 10, '*', '*');
    assert.equal(italic?.value, 'une belle cache');

    // Sélection en début de texte : pas d'index négatif.
    assert.equal(unwrapMarkdownSelection('gras', 0, 4, '**', '**'), undefined);
}

function testFindFormatAtCaret(): void {
    //          0123456789...
    const value = 'Merci **beaucoup** !';

    // Curseur au milieu du gras.
    const inside = findFormatAtCaret(value, 12);
    assert.equal(inside?.kind, 'bold');
    assert.equal(inside?.start, 6);
    assert.equal(inside?.end, 18);

    // Curseur au tout début du contenu, juste après les `**`.
    assert.equal(findFormatAtCaret(value, 8)?.kind, 'bold');

    // Curseur après le `**` fermant : on est sorti de l'emphase.
    assert.equal(findFormatAtCaret(value, 18), undefined);
    // Curseur avant le `**` ouvrant.
    assert.equal(findFormatAtCaret(value, 6), undefined);

    // Emphase invalide : aucun format, puisque le site ne la rendra pas non plus.
    assert.equal(findFormatAtCaret('**gras raté ** suite', 5), undefined);

    // Les lignes sont analysées séparément.
    const multiline = 'ligne normale\nvoici du *italique* ici';
    assert.equal(findFormatAtCaret(multiline, 27)?.kind, 'italic');
    assert.equal(findFormatAtCaret(multiline, 5), undefined);
}

function testToggleMarkdownFormatAtCaret(): void {
    const value = 'Merci **beaucoup** !';

    // Le cas signalé : curseur posé dans le gras, clic sur B → le gras est retiré,
    // au lieu d'insérer une nouvelle zone grasse à l'intérieur.
    const removed = toggleMarkdownFormat(value, 12, 12, 'bold', 'texte');
    assert.equal(removed.value, 'Merci beaucoup !');
    assert.equal(removed.selectionStart, 6);
    assert.equal(removed.selectionEnd, 14);

    // Curseur dans du gras, clic sur Italique → on n'enlève pas le gras, on insère.
    const other = toggleMarkdownFormat(value, 12, 12, 'italic', 'texte');
    assert.equal(other.value, 'Merci **beau*texte*coup** !');

    // Curseur hors de tout format → insertion du texte indicatif, sélectionné.
    const inserted = toggleMarkdownFormat('Merci !', 6, 6, 'bold', 'texte');
    assert.equal(inserted.value, 'Merci **texte**!');
    assert.equal(inserted.value.slice(inserted.selectionStart, inserted.selectionEnd), 'texte');

    // Sélection formatée → retrait (comportement déjà en place).
    const unwrapped = toggleMarkdownFormat(value, 8, 16, 'bold', 'texte');
    assert.equal(unwrapped.value, 'Merci beaucoup !');

    // Sélection non formatée → enveloppement, sélection conservée sur le contenu.
    const wrapped = toggleMarkdownFormat('Merci beaucoup !', 6, 14, 'bold', 'texte');
    assert.equal(wrapped.value, 'Merci **beaucoup** !');
    assert.equal(wrapped.value.slice(wrapped.selectionStart, wrapped.selectionEnd), 'beaucoup');

    // Un lien ne se retire pas au curseur (délimiteur fermant de longueur variable).
    const link = 'voir [le site](https://www.geocaching.com) ici';
    assert.equal(findFormatAtCaret(link, 10)?.kind, 'link');
    assert.ok(toggleMarkdownFormat(link, 10, 10, 'link', 'lien').value.includes('[lien]'));
}

function testTokenRanges(): void {
    const tokens = tokenizeInlineMarkdown('Merci **beaucoup** !');
    assert.deepEqual(tokens.map(t => [t.kind, t.start, t.end]), [
        ['text', 0, 6],
        ['bold', 6, 18],
        ['text', 18, 20],
    ]);

    // Les bornes couvrent bien les délimiteurs.
    const value = 'a `code` b';
    const code = tokenizeInlineMarkdown(value)[1];
    assert.equal(value.slice(code.start, code.end), '`code`');
}

function testEmptyText(): void {
    assert.deepEqual(tokenizeInlineMarkdown(''), []);
    assert.deepEqual(parseMarkdownBlocks(''), []);
}

testBoldAndItalic();
testEmphasisRequiresDelimitersGluedToText();
testUnterminatedEmphasisStaysLiteral();
testCodeAndLinks();
testSanitizeLogUrl();
testBlocks();
testFencedCodeBlock();
testFindUnrenderedEmphasis();
testUnwrapMarkdownSelection();
testFindFormatAtCaret();
testToggleMarkdownFormatAtCaret();
testTokenRanges();
testEmptyText();

console.log('log-markdown.test.ts OK');
