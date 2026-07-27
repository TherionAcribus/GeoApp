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

/**
 * Bornes du token dans le texte source, délimiteurs compris.
 * Permet de savoir quel format se trouve sous le curseur (cf. findFormatAtCaret).
 */
export interface TokenRange {
    start: number;
    end: number;
}

export type InlineToken =
    | ({ kind: 'text'; content: string } & TokenRange)
    | ({ kind: 'code'; content: string } & TokenRange)
    | ({ kind: 'bold'; content: string } & TokenRange)
    | ({ kind: 'italic'; content: string } & TokenRange)
    | ({ kind: 'link'; label: string; url: string; safeUrl?: string } & TokenRange);

/** Formats applicables par la barre d'outils, avec leurs délimiteurs. */
export type MarkdownFormatKind = 'bold' | 'italic' | 'code' | 'link';

export const MARKDOWN_DELIMITERS: Record<MarkdownFormatKind, { before: string; after: string }> = {
    bold: { before: '**', after: '**' },
    italic: { before: '*', after: '*' },
    code: { before: '`', after: '`' },
    link: { before: '[', after: '](https://example.com)' },
};

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
    let bufferStart = 0;
    let i = 0;

    const flush = () => {
        if (buffer) {
            tokens.push({ kind: 'text', content: buffer, start: bufferStart, end: bufferStart + buffer.length });
            buffer = '';
        }
    };

    while (i < source.length) {
        const rest = source.slice(i);

        if (rest.startsWith('`')) {
            const end = rest.indexOf('`', 1);
            if (end > 1) {
                flush();
                tokens.push({ kind: 'code', content: rest.slice(1, end), start: i, end: i + end + 1 });
                i += end + 1;
                continue;
            }
        }

        if (rest.startsWith('**')) {
            const end = findEmphasisEnd(rest, '**');
            if (end > 0) {
                flush();
                tokens.push({ kind: 'bold', content: rest.slice(2, end), start: i, end: i + end + 2 });
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
                tokens.push({ kind: 'italic', content: rest.slice(1, end), start: i, end: i + end + 1 });
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
                        start: i,
                        end: i + closeParen + 1,
                    });
                    i += closeParen + 1;
                    continue;
                }
            }
        }

        if (!buffer) {
            bufferStart = i;
        }
        buffer += source[i];
        i += 1;
    }

    flush();
    return tokens;
}

/**
 * Repère les lignes où des astérisques ressemblent à une emphase ratée.
 *
 * Sert à expliquer à l'utilisateur pourquoi son `**gras **` n'apparaît pas en gras,
 * plutôt que de lui afficher un aperçu identique à sa saisie sans explication.
 *
 * Heuristique : on ne signale une ligne que s'il reste au moins deux groupes
 * d'astérisques non interprétés, pour ne pas alerter sur une multiplication
 * isolée (`3 * 4 = 12`).
 */
export function findUnrenderedEmphasis(text: string): string[] {
    const lines = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const flagged: string[] = [];

    for (const line of lines) {
        const leftover = tokenizeInlineMarkdown(line)
            .filter(token => token.kind === 'text')
            .map(token => (token as { content: string }).content)
            .join('');
        const runs = leftover.match(/\*+/g);
        if (runs && runs.length >= 2) {
            flagged.push(line.trim());
        }
    }

    return flagged;
}

export interface CaretFormat extends TokenRange {
    kind: Exclude<InlineToken['kind'], 'text'>;
}

/**
 * Détermine le format effectivement appliqué à la position `caret`.
 *
 * S'appuie sur le tokenizer, donc ne renvoie un format que si Geocaching.com
 * l'interprétera vraiment : le curseur dans `**gras **` ne renvoie rien.
 * L'analyse est faite ligne par ligne, comme le rendu.
 */
export function findFormatAtCaret(value: string, caret: number): CaretFormat | undefined {
    const source = value || '';
    const lineStart = source.lastIndexOf('\n', caret - 1) + 1;
    const nextBreak = source.indexOf('\n', caret);
    const lineEnd = nextBreak === -1 ? source.length : nextBreak;
    const relative = caret - lineStart;

    for (const token of tokenizeInlineMarkdown(source.slice(lineStart, lineEnd))) {
        // Strictement à l'intérieur : un curseur collé après le `**` fermant appartient
        // au texte qui suit, pas à l'emphase.
        if (token.kind !== 'text' && relative > token.start && relative < token.end) {
            return { kind: token.kind, start: lineStart + token.start, end: lineStart + token.end };
        }
    }

    return undefined;
}

export interface MarkdownSelectionEdit {
    value: string;
    selectionStart: number;
    selectionEnd: number;
}

/**
 * Retire les délimiteurs Markdown autour de la sélection, qu'ils soient inclus dedans
 * (`**texte**` sélectionné) ou juste à l'extérieur (`texte` sélectionné entre les `**`).
 * Retourne undefined si la sélection n'est pas déjà formatée ainsi — l'appelant peut
 * alors envelopper. C'est ce qui donne aux boutons de la barre d'outils un comportement
 * de bascule au lieu d'empiler `****texte****`.
 */
export function unwrapMarkdownSelection(
    value: string,
    start: number,
    end: number,
    before: string,
    after: string
): MarkdownSelectionEdit | undefined {
    const selected = value.slice(start, end);

    if (
        selected.length > before.length + after.length &&
        selected.startsWith(before) &&
        selected.endsWith(after)
    ) {
        const inner = selected.slice(before.length, selected.length - after.length);
        return {
            value: value.slice(0, start) + inner + value.slice(end),
            selectionStart: start,
            selectionEnd: start + inner.length,
        };
    }

    const hasBefore = start >= before.length && value.slice(start - before.length, start) === before;
    const hasAfter = value.slice(end, end + after.length) === after;
    // Pour un délimiteur d'un seul caractère (italique), ne pas grignoter un `**` :
    // sur `**gras**`, le bouton Italique ne doit pas produire `*gras*`.
    const isPartOfLongerRun =
        before.length === 1 && (value[start - before.length - 1] === before || value[end + after.length] === after);

    if (hasBefore && hasAfter && !isPartOfLongerRun) {
        return {
            value: value.slice(0, start - before.length) + selected + value.slice(end + after.length),
            selectionStart: start - before.length,
            selectionEnd: start - before.length + selected.length,
        };
    }

    return undefined;
}

/**
 * Calcule l'édition à appliquer quand on clique sur un bouton de la barre d'outils.
 *
 * Trois cas, dans cet ordre :
 * 1. sélection déjà formatée → on retire les délimiteurs ;
 * 2. curseur seul posé dans une zone déjà formatée → on retire les délimiteurs de
 *    cette zone (le bouton se comporte comme un interrupteur, au lieu d'insérer
 *    une nouvelle zone formatée à l'intérieur de la première) ;
 * 3. sinon → on enveloppe la sélection, ou le texte indicatif s'il n'y en a pas.
 */
export function toggleMarkdownFormat(
    value: string,
    selectionStart: number,
    selectionEnd: number,
    kind: MarkdownFormatKind,
    placeholder: string
): MarkdownSelectionEdit {
    const { before, after } = MARKDOWN_DELIMITERS[kind];

    // Un double-clic sélectionne souvent le mot *et* l'espace qui suit. Envelopper tel quel
    // produirait `**mot **`, que Geocaching.com n'interprète pas : on resserre donc la
    // sélection sur le texte, en laissant les espaces à l'extérieur des délimiteurs.
    const { start, end } = trimSelectionRange(value, selectionStart, selectionEnd);
    const hasSelection = start !== end;

    if (hasSelection) {
        const unwrapped = unwrapMarkdownSelection(value, start, end, before, after);
        if (unwrapped) {
            return unwrapped;
        }
    } else {
        const format = findFormatAtCaret(value, start);
        // Le lien est exclu : son délimiteur fermant contient l'URL, de longueur variable,
        // donc on ne peut pas le retirer en se fiant à `after`.
        if (format && format.kind === kind && kind !== 'link') {
            const inner = value.slice(format.start + before.length, format.end - after.length);
            return {
                value: value.slice(0, format.start) + inner + value.slice(format.end),
                selectionStart: format.start,
                selectionEnd: format.start + inner.length,
            };
        }
    }

    const insert = hasSelection ? value.slice(start, end) : placeholder;
    const contentStart = start + before.length;

    return {
        value: value.slice(0, start) + before + insert + after + value.slice(end),
        selectionStart: contentStart,
        selectionEnd: contentStart + insert.length,
    };
}

/**
 * Resserre une sélection sur son contenu non blanc.
 * Une sélection entièrement blanche est ramenée à un simple curseur, placé à sa fin.
 */
export function trimSelectionRange(value: string, selectionStart: number, selectionEnd: number): TokenRange {
    let start = selectionStart;
    let end = selectionEnd;

    while (start < end && /\s/.test(value[start])) {
        start += 1;
    }
    while (end > start && /\s/.test(value[end - 1])) {
        end -= 1;
    }

    return { start, end };
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
