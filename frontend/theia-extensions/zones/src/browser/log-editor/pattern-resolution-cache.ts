/**
 * Cache de résolution des @patterns.
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 6). La détection
 * de staleness et le calcul des statistiques de longueur sont purs ; le widget
 * possède le cache et la signature et délègue ici.
 */

import { GeocacheListItem } from './types';
import { PatternResolutionContext, getPatternResolutionSignature, resolveAllPatterns, resolvePatternValue } from './pattern-resolver';

/** État du cache de résolution. */
export interface PatternResolutionCacheState {
    cache: Map<string, string>;
    signature: readonly unknown[];
}

/** Crée un état de cache initial. */
export function createPatternResolutionCacheState(): PatternResolutionCacheState {
    return { cache: new Map(), signature: [] };
}

/**
 * Vérifie si la signature a changé et invalide le cache si nécessaire.
 * Retourne `true` si le cache a été invalidé.
 */
export function invalidateCacheIfStale(
    state: PatternResolutionCacheState,
    context: PatternResolutionContext
): boolean {
    const signature = getPatternResolutionSignature(context);
    const stale = signature.some((value, index) => !Object.is(value, state.signature[index]));
    if (stale) {
        state.signature = signature;
        state.cache.clear();
        return true;
    }
    return false;
}

/** Résout tous les patterns d'un texte, en gérant le cache. */
export function resolveAllPatternsCached(
    text: string,
    geocacheId: number | null,
    context: PatternResolutionContext,
    state: PatternResolutionCacheState
): string {
    if (!text.includes('@')) {
        return text;
    }
    invalidateCacheIfStale(state, context);
    return resolveAllPatterns(text, geocacheId, context, state.cache);
}

/** Résout un pattern unique via le contexte. */
export function resolvePatternValueCached(
    patternName: string,
    geocacheId: number | null,
    context: PatternResolutionContext
): string {
    return resolvePatternValue(patternName, geocacheId, context);
}

/** Statistiques de longueur du texte final (patterns résolus). */
export interface FinalLengthStats {
    raw: number;
    min: number;
    max: number;
    worst?: GeocacheListItem;
}

/**
 * Calcule les longueurs du texte final (patterns résolus) pour une zone de saisie.
 *
 * En mode « texte identique » un même texte source donne un texte différent par
 * géocache (`@cache_name`, `@cache_count`…) : on renvoie donc la fourchette
 * observée sur les géocaches qui partiront, et la pire d'entre elles.
 */
export function computeFinalLengthStats(
    target: 'global' | { geocacheId: number },
    globalText: string,
    perCacheText: Record<number, string>,
    geocachesToSubmit: GeocacheListItem[],
    allGeocaches: GeocacheListItem[],
    resolve: (text: string, geocacheId: number | null) => string
): FinalLengthStats {
    if (target !== 'global') {
        const rawText = perCacheText[target.geocacheId] ?? '';
        const length = resolve(rawText, target.geocacheId).length;
        return { raw: rawText.length, min: length, max: length };
    }

    const rawText = globalText;
    const scope = geocachesToSubmit.length > 0 ? geocachesToSubmit : allGeocaches;
    if (scope.length === 0) {
        const length = resolve(rawText, null).length;
        return { raw: rawText.length, min: length, max: length };
    }

    let min = Number.POSITIVE_INFINITY;
    let max = -1;
    let worst: GeocacheListItem | undefined;
    for (const gc of scope) {
        const length = resolve(rawText, gc.id).length;
        min = Math.min(min, length);
        if (length > max) {
            max = length;
            worst = gc;
        }
    }
    return { raw: rawText.length, min, max, worst };
}
