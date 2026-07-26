import * as assert from 'assert/strict';
import {
    InlineToken,
    parseMarkdownBlocks,
    sanitizeLogUrl,
    tokenizeInlineMarkdown,
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
testEmptyText();

console.log('log-markdown.test.ts OK');
