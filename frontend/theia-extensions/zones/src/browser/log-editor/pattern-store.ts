/**
 * Persistance et CRUD des @patterns personnalisés.
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 5). Les fonctions
 * de validation et de calcul sont pures ; les accès `StorageService` prennent
 * le service en paramètre.
 */

import { StorageService } from '@theia/core/lib/browser';
import { LogTextPattern } from './types';

/** Génère un identifiant unique. */
export type GenerateId = () => string;

/** Charge les patterns personnalisés depuis StorageService. */
export async function loadCustomPatterns(
    storageService: StorageService,
    storageKey: string
): Promise<LogTextPattern[]> {
    try {
        let stored = await storageService.getData<LogTextPattern[]>(storageKey, []);
        if (!Array.isArray(stored)) {
            stored = [];
        }
        return stored.filter(p => p && typeof p === 'object' && typeof p.id === 'string' && typeof p.name === 'string');
    } catch (e) {
        console.error('[pattern-store] loadCustomPatterns error', e);
        return [];
    }
}

/** Sauvegarde les patterns personnalisés vers StorageService. */
export async function saveCustomPatterns(
    storageService: StorageService,
    storageKey: string,
    patterns: LogTextPattern[]
): Promise<void> {
    try {
        await storageService.setData(storageKey, patterns);
    } catch (e) {
        console.error('[pattern-store] saveCustomPatterns error', e);
    }
}

/** Normalise un nom de pattern : minuscules, alphanumérique + underscore. */
export function normalizePatternName(name: string): string {
    return name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

/** Vérifie qu'un nom de pattern est valide et non vide. */
export function isValidPatternName(name: string): boolean {
    return name.length > 0;
}

/** Vérifie qu'un nom de pattern n'existe pas déjà (hors d'un ID donné). */
export function isPatternNameTaken(
    allPatterns: LogTextPattern[],
    name: string,
    excludeId?: string
): boolean {
    return allPatterns.some(p => p.name === name && p.id !== excludeId);
}

/** Crée un nouveau pattern personnalisé. Retourne le pattern ou `undefined` si invalide/doublon. */
export function createPattern(
    name: string,
    content: string,
    generateId: GenerateId,
    allPatterns: LogTextPattern[]
): LogTextPattern | { error: 'invalid-name' | 'duplicate' } {
    const trimmedName = normalizePatternName(name);
    if (!isValidPatternName(trimmedName)) {
        return { error: 'invalid-name' };
    }
    if (isPatternNameTaken(allPatterns, trimmedName)) {
        return { error: 'duplicate' };
    }
    return {
        id: generateId(),
        name: trimmedName,
        content: content.trim(),
        isBuiltin: false,
    };
}

/** Met à jour un pattern existant. Retourne la nouvelle liste ou une erreur. */
export function updatePatternInList(
    patterns: LogTextPattern[],
    patternId: string,
    name: string,
    content: string,
    allPatterns: LogTextPattern[]
): LogTextPattern[] | { error: 'invalid-name' | 'duplicate' } {
    const trimmedName = normalizePatternName(name);
    if (!isValidPatternName(trimmedName)) {
        return { error: 'invalid-name' };
    }
    if (isPatternNameTaken(allPatterns, trimmedName, patternId)) {
        return { error: 'duplicate' };
    }
    return patterns.map(p =>
        p.id === patternId ? { ...p, name: trimmedName, content: content.trim() } : p
    );
}

/** Supprime un pattern par son ID. */
export function deletePatternFromList(
    patterns: LogTextPattern[],
    patternId: string
): LogTextPattern[] {
    return patterns.filter(p => p.id !== patternId);
}

/** Ajoute un pattern à la liste. */
export function addPatternToList(
    patterns: LogTextPattern[],
    newPattern: LogTextPattern
): LogTextPattern[] {
    return [...patterns, newPattern];
}
