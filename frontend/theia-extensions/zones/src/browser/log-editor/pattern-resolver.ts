/**
 * Résolution des @patterns de logs (`@date`, `@cache_count`, `@cache_name`…).
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 3). Fonctions pures :
 * tout le contexte nécessaire est passé explicitement via `PatternResolutionContext`,
 * aucune dépendance à l'état du widget.
 */

import { formatIsoDateFr } from './helpers';
import { sanitizeLogTypeForGeocache } from './helpers';
import { GeocacheListItem, LogTextPattern, LogTypeValue } from './types';

/** Données dont dépend la valeur d'un @pattern. */
export interface PatternResolutionContext {
    geocaches: GeocacheListItem[];
    perCacheLogType: Record<number, LogTypeValue>;
    logType: LogTypeValue;
    userFindsCount: number;
    logDate: string;
    customPatterns: LogTextPattern[];
}

/** Patterns intégrés, toujours disponibles sans configuration. */
export function getBuiltinPatterns(): LogTextPattern[] {
    return [
        { id: 'builtin-date', name: 'date', content: '', isBuiltin: true },
        { id: 'builtin-cache_count', name: 'cache_count', content: '', isBuiltin: true },
        { id: 'builtin-cache_name', name: 'cache_name', content: '', isBuiltin: true },
        { id: 'builtin-cache_owner', name: 'cache_owner', content: '', isBuiltin: true },
        { id: 'builtin-gc_code', name: 'gc_code', content: '', isBuiltin: true },
    ];
}

/**
 * Patterns connus et index de leurs noms.
 *
 * Appelé plusieurs fois par zone de saisie et par frappe (surlignage, compteur,
 * aperçu) : sans mémoïsation il réallouait les patterns intégrés à chaque appel,
 * et le test d'appartenance se faisait par `Array.includes` dans une boucle.
 */
export function buildPatternsIndex(customPatterns: LogTextPattern[]): { all: LogTextPattern[]; names: Set<string> } {
    const all = [...getBuiltinPatterns(), ...customPatterns];
    return { all, names: new Set(all.map(p => p.name)) };
}

/** Type de log effectif d'une géocache, en tenant compte du sanitizing "already found". */
export function getLogTypeForGeocache(
    geocacheId: number,
    context: PatternResolutionContext
): LogTypeValue {
    const value = context.perCacheLogType[geocacheId] ?? context.logType;
    const geocache = context.geocaches.find(gc => gc.id === geocacheId);
    return sanitizeLogTypeForGeocache(value, geocache);
}

/** Numéro de trouvaille qu'aura cette géocache dans le lot (pour `@cache_count`). */
export function getCacheCountForIndex(geocacheIndex: number, context: PatternResolutionContext): number {
    const foundCountBefore = context.geocaches.slice(0, geocacheIndex)
        .filter(gc => getLogTypeForGeocache(gc.id, context) === 'found').length;
    return context.userFindsCount + foundCountBefore + 1;
}

/** Valeur de remplacement d'un @pattern pour une géocache donnée. */
export function resolvePatternValue(
    patternName: string,
    geocacheId: number | null,
    context: PatternResolutionContext
): string {
    const geocacheIndex = geocacheId !== null ? context.geocaches.findIndex(gc => gc.id === geocacheId) : -1;
    const geocache = geocacheIndex >= 0 ? context.geocaches[geocacheIndex] : null;

    switch (patternName) {
        case 'date':
            return formatIsoDateFr(context.logDate);
        case 'cache_count':
            if (geocacheIndex >= 0) {
                return String(getCacheCountForIndex(geocacheIndex, context));
            }
            return String(context.userFindsCount + 1);
        case 'cache_name':
            return geocache?.name ?? '[cache_name]';
        case 'cache_owner':
            return geocache?.owner ?? '[cache_owner]';
        case 'gc_code':
            return geocache?.gc_code ?? '[gc_code]';
        default: {
            const custom = context.customPatterns.find(p => p.name === patternName);
            return custom?.content ?? `@${patternName}`;
        }
    }
}

/**
 * Données dont dépend la valeur d'un @pattern : patterns personnalisés, liste et
 * types de log (pour `@cache_count`, qui compte les trouvailles précédentes), nombre
 * de trouvailles et date. Sert de clé de validité au cache de résolution.
 */
export function getPatternResolutionSignature(context: PatternResolutionContext): readonly unknown[] {
    return [
        context.customPatterns,
        context.geocaches,
        context.perCacheLogType,
        context.logType,
        context.userFindsCount,
        context.logDate,
    ];
}

/**
 * Résout tous les @patterns d'un texte.
 *
 * Le paramètre `cache` optionnel permet de mémoïser les résolutions : l'appelant
 * le gère (création, invalidation quand la signature change, bornage de la taille).
 * Passer `undefined` désactive le cache (résolution à chaque appel).
 */
export function resolveAllPatterns(
    text: string,
    geocacheId: number | null,
    context: PatternResolutionContext,
    cache?: Map<string, string>
): string {
    if (!text.includes('@')) {
        return text;
    }

    if (cache) {
        const cacheKey = `${geocacheId ?? 'global'}:${text}`;
        const cached = cache.get(cacheKey);
        if (cached !== undefined) {
            return cached;
        }

        const names = buildPatternsIndex(context.customPatterns).names;
        const resolved = text.replace(/@([a-zA-Z_][a-zA-Z0-9_]*)/g, (match, patternName: string) =>
            names.has(patternName) ? resolvePatternValue(patternName, geocacheId, context) : match);

        // Chaque frappe crée un texte inédit : on borne la croissance du cache.
        if (cache.size > 1000) {
            cache.clear();
        }
        cache.set(cacheKey, resolved);
        return resolved;
    }

    const names = buildPatternsIndex(context.customPatterns).names;
    return text.replace(/@([a-zA-Z_][a-zA-Z0-9_]*)/g, (match, patternName: string) =>
        names.has(patternName) ? resolvePatternValue(patternName, geocacheId, context) : match);
}
