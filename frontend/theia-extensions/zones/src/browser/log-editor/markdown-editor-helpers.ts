/**
 * Logique d'édition Markdown.
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 5). Les calculs
 * de transformation de texte sont purs ; l'orchestration de la sélection et
 * de l'état reste dans le widget.
 */

import { MarkdownFormatKind, findFormatAtCaret, toggleMarkdownFormat } from '../log-markdown';

/** Échappe le HTML pour un affichage sûr dans une string interpolée. */
export function escapeHtml(value: string): string {
    return (value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Identifie un éditeur (global ou par cache). */
export type EditorTarget = { type: 'global' } | { type: 'per-cache'; geocacheId: number };

/** Résultat d'une transformation Markdown. */
export interface MarkdownEditResult {
    value: string;
    selectionStart: number;
    selectionEnd: number;
}

/** Applique un format Markdown (gras, italique, etc.) à la sélection courante. */
export function computeMarkdownFormatEdit(
    value: string,
    start: number,
    end: number,
    kind: MarkdownFormatKind,
    placeholder: string
): MarkdownEditResult {
    const edit = toggleMarkdownFormat(value, start, end, kind, placeholder);
    return {
        value: edit.value,
        selectionStart: edit.selectionStart,
        selectionEnd: edit.selectionEnd,
    };
}

/** Détecte le format Markdown sous le curseur. */
export function detectCaretFormat(
    value: string,
    caret: number
): MarkdownFormatKind | undefined {
    return findFormatAtCaret(value, caret)?.kind;
}

/** Résultat de l'application d'un préfixe de ligne (liste, citation, etc.). */
export interface PrefixEditResult {
    value: string;
    /** Début de la zone affectée. */
    lineStart: number;
    /** Fin de la zone affectée. */
    lineEnd: number;
    /** Longueur du bloc traité. */
    processedLength: number;
    /** Vrai si le bloc était vide (placeholder inséré). */
    isEmpty: boolean;
}

/** Applique un préfixe à chaque ligne du bloc sélectionné. */
export function computeMarkdownPrefixEdit(
    value: string,
    start: number,
    end: number,
    prefix: string,
    placeholder: string
): PrefixEditResult {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = value.indexOf('\n', end);
    const safeLineEnd = lineEnd === -1 ? value.length : lineEnd;

    const selectedBlock = value.slice(lineStart, safeLineEnd);
    const isEmpty = !selectedBlock.trim();
    const toProcess = isEmpty ? placeholder : selectedBlock;

    const processed = toProcess
        .split('\n')
        .map(l => (l.trim() ? `${prefix}${l}` : l))
        .join('\n');

    const nextValue = value.slice(0, lineStart) + processed + value.slice(safeLineEnd);

    return {
        value: nextValue,
        lineStart,
        lineEnd: safeLineEnd,
        processedLength: processed.length,
        isEmpty,
    };
}

/** Calcule la sélection après application d'un préfixe. */
export function computePrefixSelection(
    result: PrefixEditResult,
    prefix: string,
    placeholder: string
): { start: number; end: number } {
    const selStart = result.lineStart + prefix.length;
    if (result.isEmpty) {
        return { start: selStart, end: selStart + placeholder.length };
    }
    return { start: result.lineStart, end: result.lineStart + result.processedLength };
}

/** Borner une sélection aux limites du texte. */
export function clampSelection(
    start: number,
    end: number,
    textLength: number
): { start: number; end: number } {
    return {
        start: Math.max(0, Math.min(start, textLength)),
        end: Math.max(0, Math.min(end, textLength)),
    };
}
