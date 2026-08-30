/**
 * Validation et construction des payloads de soumission.
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 6). Les vérifications
 * pré-soumission et la construction du payload sont pures ; l'orchestration de la
 * boucle reste dans le widget car elle mute trop d'état.
 */

import { GeocacheListItem, LogTypeValue } from './types';
import { GC_LOG_MAX_LENGTH } from './constants';

/** Géocache avec texte manquant. */
export interface GeocacheWithMissingText {
    gc: GeocacheListItem;
}

/** Géocache avec texte trop long. */
export interface GeocacheWithTooLongText {
    gc: GeocacheListItem;
    length: number;
}

/** Résultat de la validation pré-soumission. */
export interface SubmissionValidationResult {
    /** Géocaches dont le texte est vide. */
    missingText: GeocacheWithMissingText[];
    /** Géocaches dont le texte résolu dépasse la limite. */
    tooLong: GeocacheWithTooLongText[];
}

/**
 * Valide les textes avant soumission.
 *
 * @param toSubmit Géocaches à envoyer.
 * @param getTextForGeocacheId Fonction retournant le texte brut d'une géocache.
 * @param getResolvedTextForGeocacheId Fonction retournant le texte résolu (patterns) d'une géocache.
 */
export function validateSubmissionTexts(
    toSubmit: GeocacheListItem[],
    getTextForGeocacheId: (geocacheId: number) => string,
    getResolvedTextForGeocacheId: (geocacheId: number) => string
): SubmissionValidationResult {
    const missingText = toSubmit
        .map(gc => ({ gc, text: (getTextForGeocacheId(gc.id) || '').trim() }))
        .filter(x => !x.text)
        .map(x => ({ gc: x.gc }));

    const tooLong = toSubmit
        .map(gc => ({ gc, length: getResolvedTextForGeocacheId(gc.id).length }))
        .filter(x => x.length > GC_LOG_MAX_LENGTH);

    return { missingText, tooLong };
}

/** Construit le message d'avertissement pour texte manquant. */
export function buildMissingTextWarning(
    missingCount: number,
    useSameTextForAll: boolean
): string {
    if (useSameTextForAll) {
        return 'Le texte du log est vide.';
    }
    return `Texte manquant pour ${missingCount} géocache(s).`;
}

/** Construit le message d'avertissement pour texte trop long. */
export function buildTooLongTextWarning(
    tooLong: GeocacheWithTooLongText[],
    useSameTextForAll: boolean
): string {
    if (tooLong.length === 0) {
        return '';
    }

    const worst = tooLong.reduce((a, b) => (b.length > a.length ? b : a));
    if (useSameTextForAll) {
        return `Texte final trop long : ${worst.length} caractères pour ${worst.gc.gc_code} (limite ${GC_LOG_MAX_LENGTH}). `
            + `Raccourcissez d'au moins ${worst.length - GC_LOG_MAX_LENGTH} caractères.`;
    }

    const codes = tooLong.slice(0, 6).map(x => x.gc.gc_code).join(', ');
    const more = tooLong.length > 6 ? `, +${tooLong.length - 6}` : '';
    return `Texte final trop long (limite ${GC_LOG_MAX_LENGTH} caractères) pour ${tooLong.length} géocache(s) : ${codes}${more}.`;
}

/** Payload de soumission d'un log. */
export interface LogSubmissionPayload {
    text: string;
    date: string;
    logType: LogTypeValue;
    favorite: boolean;
    images?: string[];
}

/** Construit le payload de soumission pour une géocache. */
export function buildLogSubmissionPayload(
    resolvedText: string,
    logDate: string,
    logType: LogTypeValue,
    isFavorite: boolean,
    imageGuids: string[]
): LogSubmissionPayload {
    const payload: LogSubmissionPayload = {
        text: resolvedText,
        date: logDate,
        logType,
        favorite: logType === 'found' ? isFavorite : false,
    };
    if (imageGuids.length > 0) {
        payload.images = imageGuids;
    }
    return payload;
}

/** Construit le message de résumé de soumission. */
export function buildSubmitSummaryMessage(
    ok: number,
    failed: number,
    notLoggedCount: number
): { text: string; isError: boolean } {
    const notLoggedSuffix = notLoggedCount > 0 ? `, ${notLoggedCount} non loguée(s)` : '';
    if (failed === 0) {
        return { text: `Logs envoyés sur Geocaching.com: ${ok}/${ok}${notLoggedSuffix}`, isError: false };
    }
    return { text: `Logs envoyés sur Geocaching.com: ${ok} ok, ${failed} échec(s)${notLoggedSuffix}`, isError: true };
}

/** Construit le message d'interruption de lot. */
export function buildStopMessage(remaining: number): string {
    return `Envoi interrompu : ${remaining} géocache(s) non envoyée(s), conservée(s) dans le brouillon.`;
}
