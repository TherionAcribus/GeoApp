import { LetterValue } from '../../common/types';
import { evaluateExpression } from '../utils/formula-fragments';
import { Axis, AxisPreview, CoordinatePreviewState, PreviewIssue, PreviewIssueLevel, PreviewStatus, PreviewDigitSegment } from './types';

interface ParsedTemplate {
    cardinal: string;
    degreesExpr: string;
    minutesExpr: string;
    decimalsExpr: string;
}

type Token =
    | { kind: 'digits'; raw: string }
    | { kind: 'letters'; raw: string; letters: string[] }
    | { kind: 'expr'; raw: string; variables: string[] }
    | { kind: 'other'; raw: string };

export class CoordinatePreviewEngine {
    build(formula: { north: string; east: string }, values: Map<string, LetterValue>): CoordinatePreviewState {
        const north = this.buildAxis('north', formula.north, values);
        const east = this.buildAxis('east', formula.east, values);
        return { north, east };
    }

    private buildAxis(axis: Axis, raw: string, values: Map<string, LetterValue>): AxisPreview {
        const issues: PreviewIssue[] = [];
        const parsed = this.parseTemplate(axis, raw, issues);

        const degrees = this.resolveSegment(axis, 'degrees', parsed.degreesExpr, axis === 'north' ? 2 : 3, values, {
            padLeftZerosIfNumeric: true
        });
        const minutes = this.resolveSegment(axis, 'minutes', parsed.minutesExpr, 2, values, {
            padLeftZerosIfNumeric: true
        });
        const decimals = this.resolveSegment(axis, 'decimals', parsed.decimalsExpr, 3, values, {
            padLeftZerosIfNumeric: true
        });

        issues.push(...degrees.issues, ...minutes.issues, ...decimals.issues);

        const missingLetters = uniqSorted([
            ...degrees.segment.missingLetters,
            ...minutes.segment.missingLetters,
            ...decimals.segment.missingLetters
        ]);

        // Range checks (possible/impossible) sur les segments (même partiels)
        issues.push(...this.checkRanges(axis, parsed.cardinal, degrees.segment, minutes.segment, decimals.segment));

        // Statut global + message
        const status = this.computeStatus(missingLetters, issues);
        const message = this.buildMessage(status, missingLetters, issues);

        const display = `${parsed.cardinal}${degrees.segment.displayText}°${minutes.segment.displayText}.${decimals.segment.displayText}`;

        const { minDecimalDegrees, maxDecimalDegrees, decimalDegrees } = this.computeDecimalDegrees(axis, parsed.cardinal, degrees.segment, minutes.segment, decimals.segment);

        const suspectLetters = uniqSorted(
            issues
                .filter(i => i.level === 'error')
                .flatMap(i => i.suspectLetters || [])
        );

        return {
            axis,
            cardinal: parsed.cardinal,
            status,
            message,
            display,
            degrees: degrees.segment,
            minutes: minutes.segment,
            decimals: decimals.segment,
            missingLetters,
            issues,
            suspectLetters,
            decimalDegrees,
            minDecimalDegrees,
            maxDecimalDegrees
        };
    }

    private computeStatus(missingLetters: string[], issues: PreviewIssue[]): PreviewStatus {
        const hasError = issues.some(i => i.level === 'error');
        if (hasError) {
            return 'invalid';
        }
        if (missingLetters.length > 0) {
            return 'incomplete';
        }
        return 'valid';
    }

    private buildMessage(status: PreviewStatus, missingLetters: string[], issues: PreviewIssue[]): string {
        const firstError = issues.find(i => i.level === 'error');
        if (firstError) {
            return firstError.message;
        }
        if (status === 'incomplete') {
            return `Lettres manquantes : ${missingLetters.join(', ')}`;
        }
        const warn = issues.find(i => i.level === 'warn');
        if (warn) {
            return warn.message;
        }
        return 'Coordonnée valide';
    }

    private parseTemplate(axis: Axis, raw: string, issues: PreviewIssue[]): ParsedTemplate {
        const trimmed = (raw || '').trim();
        // Défense en profondeur: certains environnements injectent un 'Â' (U+00C2)
        // devant le symbole degré. On le supprime pour éviter des tokens "other".
        const compact = trimmed
            .replace(/\s+/g, '')
            .replace(/\u00C2/g, '');

        const cardinalMatch = compact.match(/^([NSEWO])/i);
        const cardinal = (cardinalMatch ? cardinalMatch[1] : (axis === 'north' ? 'N' : 'E')).toUpperCase();
        let remainder = cardinalMatch ? compact.slice(cardinalMatch[0].length) : compact;

        // Supporte ° et º
        const normalized = remainder.includes('°') ? remainder : remainder.replace(/º/g, '°');
        const degreeSplit = normalized.split('°');
        if (degreeSplit.length < 2) {
            issues.push(issue('error', axis, 'parse', 'Format invalide : symbole ° manquant', 'degrees'));
        }
        const degreesExpr = (degreeSplit[0] || '').trim();
        remainder = (degreeSplit[1] || '').trim();

        const dotIndex = remainder.indexOf('.');
        let minutesExpr = remainder;
        let decimalsExpr = '';
        if (dotIndex >= 0) {
            minutesExpr = remainder.slice(0, dotIndex);
            decimalsExpr = remainder.slice(dotIndex + 1);
        } else {
            issues.push(issue('warn', axis, 'parse', 'Format incomplet : décimales absentes (.)', 'decimals'));
        }

        return {
            cardinal,
            degreesExpr,
            minutesExpr,
            decimalsExpr
        };
    }

    private resolveSegment(
        axis: Axis,
        id: PreviewDigitSegment['id'],
        expr: string,
        expectedLength: number,
        values: Map<string, LetterValue>,
        options: { padLeftZerosIfNumeric?: boolean }
    ): { segment: PreviewDigitSegment; issues: PreviewIssue[] } {
        const issues: PreviewIssue[] = [];
        const rawExpression = (expr || '').trim();

        const tokens = this.tokenizeExpression(rawExpression);
        const usedLettersSet = new Set<string>();
        const missingLettersSet = new Set<string>();

        let outDigits = '';
        let outText = '';
        const sourcesPerChar: string[][] = [];
        for (const token of tokens) {
            if (token.kind === 'digits') {
                outDigits += token.raw;
                outText += token.raw;
                for (let k = 0; k < token.raw.length; k++) {
                    sourcesPerChar.push([]);
                }
                continue;
            }
            if (token.kind === 'letters') {
                for (const letter of token.letters) {
                    usedLettersSet.add(letter);
                    const v = getProvidedValue(values, letter);
                    if (!v) {
                        missingLettersSet.add(letter);
                        // Interne: '?' pour ranges, UI: afficher la lettre
                        outDigits += '?';
                        outText += letter;
                        sourcesPerChar.push([]);
                        continue;
                    }
                    outDigits += String(v.value);
                    outText += String(v.value);
                    // La valeur peut produire plusieurs digits; on attribue la provenance au bloc complet
                    const digits = String(v.value);
                    for (let k = 0; k < digits.length; k++) {
                        sourcesPerChar.push([letter]);
                    }
                }
                continue;
            }
            if (token.kind === 'expr') {
                token.variables.forEach(l => usedLettersSet.add(l));
                const missing = token.variables.filter(l => !getProvidedValue(values, l));
                missing.forEach(l => missingLettersSet.add(l));
                if (missing.length > 0) {
                    // Interne: '?' pour ranges, UI: afficher l'expression brute
                    outDigits += '?';
                    outText += token.raw;
                    sourcesPerChar.push([]);
                    continue;
                }

                const valueMap = new Map<string, { value: number }>();
                for (const l of token.variables) {
                    const v = getProvidedValue(values, l)!;
                    valueMap.set(l, { value: v.value });
                }

                const evaluated = evaluateExpression(stripOuterParens(token.raw), valueMap);
                if (!isFiniteNumber(evaluated)) {
                    issues.push(issue('error', axis, 'expr', `Expression invalide : ${token.raw}`, id, token.variables.filter(l => getProvidedValue(values, l))));
                    outDigits += '?';
                    outText += token.raw;
                    sourcesPerChar.push([]);
                    continue;
                }
                if (evaluated < 0) {
                    issues.push(issue('error', axis, 'negative', `Résultat négatif : ${token.raw} = ${evaluated}`, id, token.variables.filter(l => getProvidedValue(values, l))));
                    outDigits += '?';
                    outText += token.raw;
                    sourcesPerChar.push([]);
                    continue;
                }
                if (!Number.isInteger(evaluated)) {
                    issues.push(issue('error', axis, 'non-integer', `Résultat non entier : ${token.raw} = ${evaluated}`, id, token.variables.filter(l => getProvidedValue(values, l))));
                    outDigits += '?';
                    outText += token.raw;
                    sourcesPerChar.push([]);
                    continue;
                }
                outDigits += String(evaluated);
                outText += String(evaluated);
                {
                    const digits = String(evaluated);
                    const suspects = token.variables.filter(l => getProvidedValue(values, l));
                    for (let k = 0; k < digits.length; k++) {
                        sourcesPerChar.push(suspects);
                    }
                }
                continue;
            }

            // other
            issues.push(issue('error', axis, 'token', `Caractère inattendu dans l'expression: ${token.raw}`, id));
            outDigits += '?';
            outText += token.raw;
            sourcesPerChar.push([]);
        }

        // Normalisation: padding à gauche si entièrement numérique et plus court que prévu
        let padded = false;
        if (options.padLeftZerosIfNumeric && outDigits && /^[0-9]+$/.test(outDigits) && outDigits.length < expectedLength) {
            const padCount = expectedLength - outDigits.length;
            outDigits = outDigits.padStart(expectedLength, '0');
            for (let i = 0; i < padCount; i++) {
                sourcesPerChar.unshift([]);
            }
            padded = true;
        }

        // Si trop court (par ex. ? ou 1 digit), on complète à droite pour stabiliser l'affichage
        if (outDigits.length < expectedLength) {
            const fillCount = expectedLength - outDigits.length;
            outDigits = outDigits + '?'.repeat(fillCount);
            for (let i = 0; i < fillCount; i++) {
                sourcesPerChar.push([]);
            }
        }

        // displayText: si c'est un nombre pur, on peut aussi le pad (sinon on garde l'expression lisible)
        if (options.padLeftZerosIfNumeric && outText && /^[0-9]+$/.test(outText) && outText.length < expectedLength) {
            outText = outText.padStart(expectedLength, '0');
        }

        const isFullyResolved = /^[0-9]+$/.test(outDigits) && !outDigits.includes('?');

        // Range min/max si possible (digits + '?', longueur >= expectedLength)
        let minValue: number | undefined;
        let maxValue: number | undefined;
        if (outDigits.length === expectedLength && /^[0-9?]+$/.test(outDigits)) {
            const minStr = outDigits.replace(/\?/g, '0');
            const maxStr = outDigits.replace(/\?/g, '9');
            minValue = safeInt(minStr);
            maxValue = safeInt(maxStr);
        }

        // Length mismatch: si résolu mais longueur != attendue (overflow)
        if (!outDigits.includes('?') && outDigits.length !== expectedLength) {
            issues.push(issue('error', axis, 'length', `Longueur invalide pour ${id}: attendue ${expectedLength}, obtenue ${outDigits.length}`, id, Array.from(usedLettersSet).filter(l => getProvidedValue(values, l))));
        }
        if (outDigits.length > expectedLength) {
            issues.push(issue('error', axis, 'length', `Longueur trop grande pour ${id}: attendue ${expectedLength}, obtenue ${outDigits.length}`, id, Array.from(usedLettersSet).filter(l => getProvidedValue(values, l))));
        }

        const segment: PreviewDigitSegment = {
            id,
            rawExpression,
            expectedLength,
            displayText: outText || rawExpression || '?',
            displayDigits: outDigits,
            isFullyResolved,
            usedLetters: uniqSorted(Array.from(usedLettersSet)),
            missingLetters: uniqSorted(Array.from(missingLettersSet)),
            minValue,
            maxValue,
            padded: padded || undefined,
            sourcesPerChar
        };

        return { segment, issues };
    }

    private tokenizeExpression(expr: string): Token[] {
        const raw = (expr || '').trim();
        if (!raw) {
            return [];
        }

        // Fallback: opérateurs au top-level (hors parenthèses) => on traite comme une expression unique
        if (hasTopLevelOperator(raw)) {
            const vars = extractVariables(raw);
            return [{ kind: 'expr', raw, variables: vars }];
        }

        const tokens: Token[] = [];
        let i = 0;
        while (i < raw.length) {
            const ch = raw[i];
            if (/\s/.test(ch)) {
                i++;
                continue;
            }
            if (ch === '(') {
                const { text, nextIndex } = readBalanced(raw, i);
                const vars = extractVariables(text);
                tokens.push({ kind: 'expr', raw: text, variables: vars });
                i = nextIndex;
                continue;
            }
            if (/[0-9]/.test(ch)) {
                let j = i;
                while (j < raw.length && /[0-9]/.test(raw[j])) j++;
                tokens.push({ kind: 'digits', raw: raw.slice(i, j) });
                i = j;
                continue;
            }
            if (/[A-Z]/.test(ch)) {
                let j = i;
                while (j < raw.length && /[A-Z]/.test(raw[j])) j++;
                const letters = raw.slice(i, j).split('');
                tokens.push({ kind: 'letters', raw: raw.slice(i, j), letters });
                i = j;
                continue;
            }

            // caractère non supporté
            tokens.push({ kind: 'other', raw: ch });
            i++;
        }
        return tokens;
    }

    private checkRanges(axis: Axis, cardinal: string, degrees: PreviewDigitSegment, minutes: PreviewDigitSegment, decimals: PreviewDigitSegment): PreviewIssue[] {
        const issues: PreviewIssue[] = [];

        const degreeMax = axis === 'north' ? 90 : 180;
        const degreeMin = 0;

        issues.push(...rangeIssue(axis, 'degrees', degrees, degreeMin, degreeMax));
        issues.push(...rangeIssue(axis, 'minutes', minutes, 0, 59));
        issues.push(...rangeIssue(axis, 'decimals', decimals, 0, 999));

        // Spécifique : si cardinal illogique pour l’axe (ex: E sur north)
        if (axis === 'north' && !['N', 'S'].includes(cardinal)) {
            issues.push(issue('warn', axis, 'cardinal', `Cardinal inattendu pour latitude: ${cardinal}`, 'cardinal'));
        }
        if (axis === 'east' && !['E', 'W', 'O'].includes(cardinal)) {
            issues.push(issue('warn', axis, 'cardinal', `Cardinal inattendu pour longitude: ${cardinal}`, 'cardinal'));
        }

        return issues;
    }

    private computeDecimalDegrees(
        axis: Axis,
        cardinal: string,
        degrees: PreviewDigitSegment,
        minutes: PreviewDigitSegment,
        decimals: PreviewDigitSegment
    ): { decimalDegrees?: number; minDecimalDegrees?: number; maxDecimalDegrees?: number } {
        if (degrees.minValue === undefined || degrees.maxValue === undefined ||
            minutes.minValue === undefined || minutes.maxValue === undefined ||
            decimals.minValue === undefined || decimals.maxValue === undefined) {
            return {};
        }

        const minAbs = degrees.minValue + ((minutes.minValue + decimals.minValue / 1000) / 60);
        const maxAbs = degrees.maxValue + ((minutes.maxValue + decimals.maxValue / 1000) / 60);

        let minSigned = minAbs;
        let maxSigned = maxAbs;
        const isNegative = (axis === 'north' && cardinal === 'S') || (axis === 'east' && (cardinal === 'W' || cardinal === 'O'));
        if (isNegative) {
            minSigned = -maxAbs;
            maxSigned = -minAbs;
        }

        const decimalDegrees = (degrees.isFullyResolved && minutes.isFullyResolved && decimals.isFullyResolved && degrees.displayDigits.length === degrees.expectedLength)
            ? (isNegative ? -maxAbs : minAbs) // minAbs==maxAbs si fully resolved
            : undefined;

        return {
            decimalDegrees,
            minDecimalDegrees: Math.min(minSigned, maxSigned),
            maxDecimalDegrees: Math.max(minSigned, maxSigned)
        };
    }
}

function issue(level: PreviewIssueLevel, axis: Axis, code: string, message: string, segmentId?: PreviewIssue['segmentId'], suspectLetters?: string[]): PreviewIssue {
    return { level, axis, code: `preview.${code}`, message, segmentId, suspectLetters: suspectLetters?.length ? uniqSorted(suspectLetters) : undefined };
}

function uniqSorted(items: string[]): string[] {
    return Array.from(new Set(items.map(s => s.toUpperCase()))).sort();
}

function extractVariables(text: string): string[] {
    const matches = (text || '').toUpperCase().match(/[A-Z]/g) || [];
    return Array.from(new Set(matches)).sort();
}

function readBalanced(text: string, startIndex: number): { text: string; nextIndex: number } {
    let depth = 0;
    let i = startIndex;
    for (; i < text.length; i++) {
        const ch = text[i];
        if (ch === '(') depth++;
        if (ch === ')') {
            depth--;
            if (depth === 0) {
                const slice = text.slice(startIndex, i + 1);
                return { text: slice, nextIndex: i + 1 };
            }
        }
    }
    // parenthèses non fermées: renvoyer jusqu’à fin
    return { text: text.slice(startIndex), nextIndex: text.length };
}

function stripOuterParens(expr: string): string {
    const t = (expr || '').trim();
    if (t.startsWith('(') && t.endsWith(')')) {
        return t.slice(1, -1);
    }
    return t;
}

function hasTopLevelOperator(expr: string): boolean {
    let depth = 0;
    for (let i = 0; i < expr.length; i++) {
        const ch = expr[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth = Math.max(0, depth - 1);
        else if (depth === 0 && /[+\-*/]/.test(ch)) {
            return true;
        }
    }
    return false;
}

function isFiniteNumber(n: number): boolean {
    return typeof n === 'number' && isFinite(n) && !isNaN(n);
}

function safeInt(text: string): number | undefined {
    if (!/^[0-9]+$/.test(text)) {
        return undefined;
    }
    const v = parseInt(text, 10);
    return Number.isFinite(v) ? v : undefined;
}

function rangeIssue(axis: Axis, segmentId: PreviewIssue['segmentId'], seg: PreviewDigitSegment, min: number, max: number): PreviewIssue[] {
    if (seg.minValue === undefined || seg.maxValue === undefined) {
        return [];
    }
    const issues: PreviewIssue[] = [];
    if (seg.minValue > max || seg.maxValue < min) {
        issues.push(issue('error', axis, 'range-impossible', `${segmentLabel(segmentId)} hors limites (${min}-${max})`, segmentId, suspectsForRangeImpossible(seg, min, max)));
    } else if (seg.maxValue > max || seg.minValue < min) {
        // On n'assigne volontairement pas de suspects ici (pas “clairement faux”).
        issues.push(issue('warn', axis, 'range-possible', `${segmentLabel(segmentId)} potentiellement hors limites (${min}-${max})`, segmentId));
    }
    return issues;
}

function segmentLabel(segmentId?: PreviewIssue['segmentId']): string {
    switch (segmentId) {
        case 'degrees': return 'Degrés';
        case 'minutes': return 'Minutes';
        case 'decimals': return 'Décimales';
        default: return 'Segment';
    }
}

function getProvidedValue(values: Map<string, LetterValue>, letter: string): LetterValue | undefined {
    const v = values.get(letter);
    if (!v) {
        return undefined;
    }
    if (!v.rawValue || !v.rawValue.trim()) {
        return undefined;
    }
    return v;
}

function suspectsForRangeImpossible(seg: PreviewDigitSegment, min: number, max: number): string[] {
    // Cas fréquent: minValue > max => digits fixes trop grands (ex: minutes 6? => 60..69)
    if (seg.minValue !== undefined && seg.minValue > max) {
        return suspectsFromMinExceedsMax(seg, max);
    }
    // Cas symétrique: maxValue < min
    if (seg.maxValue !== undefined && seg.maxValue < min) {
        return suspectsFromMaxBelowMin(seg, min);
    }
    // Fallback: pas de suspects
    return [];
}

function suspectsFromMinExceedsMax(seg: PreviewDigitSegment, max: number): string[] {
    const len = seg.expectedLength;
    const maxStr = String(max).padStart(len, '0');
    const display = (seg.displayDigits || '').slice(0, len);
    const minStr = display.replace(/\?/g, '0');
    const sources = seg.sourcesPerChar || [];

    for (let i = 0; i < Math.min(minStr.length, maxStr.length); i++) {
        if (minStr[i] === maxStr[i]) {
            continue;
        }
        if (minStr[i] > maxStr[i]) {
            return uniqSorted((sources[i] || []).slice());
        }
        // minStr[i] < maxStr[i] => ne devrait pas arriver si minValue > max, mais on garde un fallback
        break;
    }
    return [];
}

function suspectsFromMaxBelowMin(seg: PreviewDigitSegment, min: number): string[] {
    const len = seg.expectedLength;
    const minStr = String(min).padStart(len, '0');
    const display = (seg.displayDigits || '').slice(0, len);
    const maxStr = display.replace(/\?/g, '9');
    const sources = seg.sourcesPerChar || [];

    for (let i = 0; i < Math.min(maxStr.length, minStr.length); i++) {
        if (maxStr[i] === minStr[i]) {
            continue;
        }
        if (maxStr[i] < minStr[i]) {
            return uniqSorted((sources[i] || []).slice());
        }
        break;
    }
    return [];
}

