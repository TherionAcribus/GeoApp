/**
 * Analyse du Markdown des logs de géocaches.
 *
 * Ce module ne contient que la logique de parsing (sans React) afin d'être
 * testable directement, et d'être partagé entre l'éditeur de logs (aperçu)
 * et la liste des logs (affichage).
 *
 * Les règles suivent celles appliquées par Geocaching.com : une emphase n'est
 * reconnue que si le délimiteur ouvrant est collé au début du texte et le
 * délimiteur fermant collé à la fin. Ainsi `**gras**` est rendu en gras, mais
 * `**pas gras **` reste affiché littéralement — exactement comme sur le site.
 * Voir https://www.geocaching.com/guide/markdown.aspx
 */

export type InlineToken =
    | { kind: 'text'; content: string }
    | { kind: 'code'; content: string }
    | { kind: 'bold'; content: string }
    | { kind: 'italic'; content: string }
    | { kind: 'link'; label: string; url: string; safeUrl?: string };

export type MarkdownBlock =
    | { kind: 'code'; content: string }
    | { kind: 'heading'; level: 1 | 2 | 3; content: string }
    | { kind: 'quote'; blocks: MarkdownBlock[] }
    | { kind: 'list'; items: string[] }
    | { kind: 'paragraph'; lines: string[] };

/** N'autorise que http(s), pour éviter les URLs `javascript:` dans les logs d'autrui. */
export function sanitizeLogUrl(url: string): string | undefined {
    const trimmed = (url || '').trim();
    if (!trimmed) {
        return undefined;
    }
    return /^https?:\/\//i.test(trimmed) ? trimmed : undefined;
}

function isWhitespace(char: string | undefined): boolean {
    return char === undefined || /\s/.test(char);
}

/**
 * Cherche le délimiteur fermant d'une emphase dans `rest` (qui commence par `delimiter`).
 * Retourne son index, ou -1 si l'emphase n'est pas valide (délimiteur entouré d'espaces,
 * contenu vide, ou pas de fermeture).
 */
function findEmphasisEnd(rest: string, delimiter: string): number {
    // Le délimiteur ouvrant doit être collé au texte : `** gras**` n'est pas une emphase.
    if (isWhitespace(rest[delimiter.length])) {
        return -1;
    }

    let from = delimiter.length + 1;
    while (from < rest.length) {
        const end = rest.indexOf(delimiter, from);
        if (end < 0) {
            return -1;
        }
        // Le délimiteur fermant doit être collé au texte : `**gras **` n'est pas une emphase,
        // et sa longueur doit correspondre exactement (un `*` ne ferme pas un `**`).
        const isExactRun = rest[end - 1] !== '*' && rest[end + delimiter.length] !== '*';
        if (!isWhitespace(rest[end - 1]) && isExactRun) {
            return end;
        }
        from = end + delimiter.length;
    }
    return -1;
}

/** Découpe une ligne en tokens inline (texte, code, gras, italique, lien). */
export function tokenizeInlineMarkdown(text: string): InlineToken[] {
    const source = text || '';
    const tokens: InlineToken[] = [];
    let buffer = '';
    let i = 0;

    const flush = () => {
        if (buffer) {
            tokens.push({ kind: 'text', content: buffer });
            buffer = '';
        }
    };

    while (i < source.length) {
        const rest = source.slice(i);

        if (rest.startsWith('`')) {
            const end = rest.indexOf('`', 1);
            if (end > 1) {
                flush();
                tokens.push({ kind: 'code', content: rest.slice(1, end) });
                i += end + 1;
                continue;
            }
        }

        if (rest.startsWith('**')) {
            const end = findEmphasisEnd(rest, '**');
            if (end > 0) {
                flush();
                tokens.push({ kind: 'bold', content: rest.slice(2, end) });
                i += end + 2;
                continue;
            }
        }

        // `!rest.startsWith('**')` : si le gras ci-dessus a été refusé, l'italique ne doit
        // pas récupérer la paire d'astérisques (`**gras raté **` reste littéral).
        if (rest.startsWith('*') && !rest.startsWith('**')) {
            const end = findEmphasisEnd(rest, '*');
            if (end > 0) {
                flush();
                tokens.push({ kind: 'italic', content: rest.slice(1, end) });
                i += end + 1;
                continue;
            }
        }

        if (rest.startsWith('[')) {
            const closeBracket = rest.indexOf(']');
            if (closeBracket > 0 && rest[closeBracket + 1] === '(') {
                const closeParen = rest.indexOf(')', closeBracket + 2);
                if (closeParen > closeBracket + 2) {
                    const url = rest.slice(closeBracket + 2, closeParen);
                    flush();
                    tokens.push({
                        kind: 'link',
                        label: rest.slice(1, closeBracket),
                        url,
                        safeUrl: sanitizeLogUrl(url),
                    });
                    i += closeParen + 1;
                    continue;
                }
            }
        }

        buffer += source[i];
        i += 1;
    }

    flush();
    return tokens;
}

const HEADING_RE = /^(#{1,3})\s+(.*)$/;
const QUOTE_RE = /^>\s+/;
const LIST_ITEM_RE = /^\s*[-*]\s+/;
const FENCE_RE = /^```/;

/** Découpe un texte Markdown en blocs (paragraphes, titres, listes, citations, code). */
export function parseMarkdownBlocks(text: string): MarkdownBlock[] {
    const lines = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const blocks: MarkdownBlock[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i] ?? '';

        if (FENCE_RE.test(line.trim())) {
            i += 1;
            const codeLines: string[] = [];
            while (i < lines.length && !FENCE_RE.test((lines[i] ?? '').trim())) {
                codeLines.push(lines[i] ?? '');
                i += 1;
            }
            if (i < lines.length) {
                i += 1;
            }
            blocks.push({ kind: 'code', content: codeLines.join('\n') });
            continue;
        }

        const heading = HEADING_RE.exec(line);
        if (heading) {
            blocks.push({
                kind: 'heading',
                level: heading[1].length as 1 | 2 | 3,
                content: heading[2] || '',
            });
            i += 1;
            continue;
        }

        if (QUOTE_RE.test(line)) {
            const quoteLines: string[] = [];
            while (i < lines.length && QUOTE_RE.test(lines[i] ?? '')) {
                quoteLines.push((lines[i] ?? '').replace(QUOTE_RE, ''));
                i += 1;
            }
            blocks.push({ kind: 'quote', blocks: parseMarkdownBlocks(quoteLines.join('\n')) });
            continue;
        }

        if (LIST_ITEM_RE.test(line)) {
            const items: string[] = [];
            while (i < lines.length && LIST_ITEM_RE.test(lines[i] ?? '')) {
                items.push((lines[i] ?? '').replace(LIST_ITEM_RE, ''));
                i += 1;
            }
            blocks.push({ kind: 'list', items });
            continue;
        }

        if (!line.trim()) {
            i += 1;
            continue;
        }

        const paragraphLines: string[] = [];
        while (
            i < lines.length &&
            (lines[i] ?? '').trim() &&
            !HEADING_RE.test(lines[i] ?? '') &&
            !FENCE_RE.test((lines[i] ?? '').trim()) &&
            !QUOTE_RE.test(lines[i] ?? '') &&
            !LIST_ITEM_RE.test(lines[i] ?? '')
        ) {
            paragraphLines.push(lines[i] ?? '');
            i += 1;
        }
        blocks.push({ kind: 'paragraph', lines: paragraphLines });
    }

    return blocks;
}
