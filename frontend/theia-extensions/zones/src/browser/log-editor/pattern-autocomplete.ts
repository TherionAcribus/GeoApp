/**
 * Logique d'autocomplétion des @patterns.
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 5). Les fonctions
 * de calcul (détection de jeton, construction de suggestions) sont pures ;
 * l'orchestration DOM/timers reste dans le widget.
 */

import { findPatternTokenStart, getCaretCoordinates } from './helpers';
import { LogTextPattern, PatternSuggestion } from './types';

/** Jeton `@xxx` en cours de saisie devant le curseur, s'il y en a un. */
export function findPatternTokenAtCaret(
    value: string,
    caret: number
): { start: number; fragment: string } | undefined {
    const tokenStart = findPatternTokenStart(value.slice(0, caret));
    if (tokenStart === null) {
        return undefined;
    }
    const fragment = value.slice(tokenStart + 1, caret);
    if (fragment.includes(' ') || fragment.includes('\n')) {
        return undefined;
    }
    return { start: tokenStart, fragment };
}

/** Construit la liste de suggestions filtrées par préfixe. */
export function buildPatternSuggestions(
    patterns: LogTextPattern[],
    prefix: string,
    resolvePatternValue: (patternName: string, geocacheId: number | null) => string,
    geocacheId: number | null
): PatternSuggestion[] {
    const lowerPrefix = prefix.toLowerCase();
    const suggestions: PatternSuggestion[] = [];

    for (const pattern of patterns) {
        if (!lowerPrefix || pattern.name.startsWith(lowerPrefix) || pattern.name.includes(lowerPrefix)) {
            const resolvedValue = resolvePatternValue(pattern.name, geocacheId);
            suggestions.push({
                id: pattern.id,
                label: `@${pattern.name}`,
                description: pattern.isBuiltin ? `→ ${resolvedValue}` : pattern.content.slice(0, 50),
                insertText: `@${pattern.name}`,
            });
        }
    }

    return suggestions;
}

/** Calcule la position d'affichage du menu d'autocomplétion. */
export function getAutocompletePosition(
    textArea: HTMLTextAreaElement,
    tokenStart: number
): { top: number; left: number } {
    return getCaretCoordinates(textArea, tokenStart);
}

/** Applique une suggestion à un texte, retourne le nouveau texte et la nouvelle position du curseur. */
export function applySuggestionToText(
    text: string,
    range: { start: number; end: number },
    insertText: string
): { text: string; cursorPos: number } {
    const next = text.slice(0, range.start) + insertText + text.slice(range.end);
    return { text: next, cursorPos: range.start + insertText.length };
}
