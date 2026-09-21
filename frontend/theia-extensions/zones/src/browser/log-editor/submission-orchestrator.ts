/**
 * Validation et construction des payloads de soumission.
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 6). Les vérifications
 * pré-soumission et la construction du payload sont pures ; l'orchestration de la
 * boucle reste dans le widget car elle mute trop d'état.
 */

import { formatIsoDateFr } from './helpers';
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

/** Préférence : fermer l'onglet d'édition de logs quand tout le lot est publié. */
export const CLOSE_EDITOR_AFTER_SUBMIT_PREF = 'geoApp.logs.closeEditorAfterSubmit';

/** Nombre de codes GC nommés dans le récapitulatif de fermeture avant de passer à « +N ». */
const CLOSE_SUMMARY_MAX_CODES = 6;

/** État de fin de lot dont dépend la fermeture de l'onglet. */
export interface CloseAfterSubmitDecision {
    /** Valeur de la préférence `geoApp.logs.closeEditorAfterSubmit`. */
    enabled: boolean;
    /** Logs publiés pendant ce lot. */
    ok: number;
    /** Logs en échec pendant ce lot. */
    failed: number;
    /** Géocaches encore à envoyer après le lot (arrêt demandé, lot incomplet…). */
    remainingToSubmit: number;
}

/**
 * Faut-il fermer l'onglet après l'envoi ?
 *
 * Seulement quand il ne reste rien à faire dedans : au moins un log publié, aucun
 * échec, plus aucune géocache en attente. Un échec ou un reste de lot ne vit que
 * dans cet onglet (statuts par ligne, messages d'erreur) — le fermer perdrait la
 * seule trace de ce qui n'est pas parti.
 */
export function shouldCloseEditorAfterSubmit(decision: CloseAfterSubmitDecision): boolean {
    return decision.enabled
        && decision.ok > 0
        && decision.failed === 0
        && decision.remainingToSubmit === 0;
}

/** Récapitulatif d'un lot publié, à afficher quand l'onglet se ferme. */
export interface CloseAfterSubmitSummary {
    /** Logs publiés. */
    ok: number;
    /** Date de visite du lot (`YYYY-MM-DD`). */
    logDate: string;
    /** Codes GC des géocaches effectivement publiées. */
    gcCodes: string[];
    /** Géocaches restées en « Ne pas loguer » ou déjà loguées sur Geocaching.com. */
    notLoggedCount: number;
}

/**
 * Message de la notification qui remplace l'onglet fermé.
 *
 * L'écran disparaît : le récapitulatif nomme donc les géocaches publiées et la
 * date de visite, seuls éléments qu'on ne peut plus aller relire.
 */
export function buildCloseAfterSubmitMessage(summary: CloseAfterSubmitSummary): string {
    const codes = summary.gcCodes.slice(0, CLOSE_SUMMARY_MAX_CODES).join(', ');
    const more = summary.gcCodes.length > CLOSE_SUMMARY_MAX_CODES
        ? `, +${summary.gcCodes.length - CLOSE_SUMMARY_MAX_CODES}`
        : '';
    const codesPart = codes ? ` : ${codes}${more}` : '';
    const count = summary.ok === 1 ? '1 log publié' : `${summary.ok} logs publiés`;
    const notLoggedPart = summary.notLoggedCount > 0
        ? ` ${summary.notLoggedCount} géocache(s) non loguée(s).`
        : '';
    return `${count} sur Geocaching.com le ${formatIsoDateFr(summary.logDate)}${codesPart}.${notLoggedPart} Onglet de logs fermé.`;
}
