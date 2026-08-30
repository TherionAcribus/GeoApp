/**
 * Persistance de l'historique des logs et des brouillons.
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 4). Fonctions pures
 * et I/O : la logique de calcul et les accès `StorageService` sont ici, l'orchestration
 * de l'état du widget reste dans le widget.
 */

import { StorageService } from '@theia/core/lib/browser';
import { sanitizeLogTypeForGeocache, todayIsoDate } from './helpers';
import { GeocacheListItem, LogDraft, LogHistoryEntry, LogTypeValue, SubmissionStatus, isLogTypeValue, isSubmissionStatus } from './types';

/** Génère un identifiant unique (fallback quand un entry n'en a pas). */
export type GenerateId = () => string;

/** Lit le nombre maximum d'éléments d'historique depuis les préférences. */
export function getLogHistoryMaxItems(
    preferenceService: { get<T>(key: string, defaultValue: T): T },
    key: string
): number {
    const raw = preferenceService.get<number>(key, 10);
    const value = typeof raw === 'number' && isFinite(raw) ? Math.floor(raw) : 10;
    return Math.max(1, Math.min(50, value));
}

/** Lit l'ancien historique stocké dans localStorage (migration v1 → v2). */
export function readLegacyLocalStorageHistory(
    localStorageKey: string,
    generateId: GenerateId
): LogHistoryEntry[] {
    try {
        if (typeof window === 'undefined' || !window.localStorage) {
            return [];
        }
        const raw = window.localStorage.getItem(localStorageKey);
        if (!raw) {
            return [];
        }
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return (parsed as any[])
            .filter(x => x && typeof x === 'object')
            .map((x: any): LogHistoryEntry => ({
                id: typeof x.id === 'string' ? x.id : generateId(),
                createdAt: typeof x.createdAt === 'string' ? x.createdAt : new Date().toISOString(),
                logDate: typeof x.logDate === 'string' ? x.logDate : todayIsoDate(),
                useSameTextForAll: x.useSameTextForAll === true,
                globalText: typeof x.globalText === 'string' ? x.globalText : '',
                perCacheText: (x.perCacheText && typeof x.perCacheText === 'object') ? x.perCacheText as Record<number, string> : {},
                logType: isLogTypeValue(x.logType) ? x.logType : 'found',
                perCacheLogType: (x.perCacheLogType && typeof x.perCacheLogType === 'object') ? x.perCacheLogType as Record<number, LogTypeValue> : {},
                perCacheFavorite: (x.perCacheFavorite && typeof x.perCacheFavorite === 'object') ? x.perCacheFavorite as Record<number, boolean> : {},
            }));
    } catch {
        return [];
    }
}

/** Charge l'historique depuis StorageService, avec migration depuis localStorage si vide. */
export async function loadLogHistory(
    storageService: StorageService,
    storageKey: string,
    legacyLocalStorageKey: string,
    generateId: GenerateId
): Promise<LogHistoryEntry[]> {
    let stored = await storageService.getData<LogHistoryEntry[]>(storageKey, []);
    if (!Array.isArray(stored)) {
        stored = [];
    }

    if (stored.length === 0) {
        const legacy = readLegacyLocalStorageHistory(legacyLocalStorageKey, generateId);
        if (legacy.length > 0) {
            stored = legacy;
            await storageService.setData(storageKey, stored);
        }
    }

    return stored;
}

/** Sauvegarde une entrée en tête de l'historique, en respectant la taille maximale. */
export async function saveHistoryEntry(
    storageService: StorageService,
    storageKey: string,
    entry: LogHistoryEntry,
    history: LogHistoryEntry[],
    maxItems: number
): Promise<LogHistoryEntry[]> {
    const next = [entry, ...history].slice(0, maxItems);
    await storageService.setData(storageKey, next);
    return next;
}

/** Clé de brouillon : triée pour que le même ensemble de géocaches retrouve son brouillon. */
export function getDraftKey(geocacheIds: number[]): string | undefined {
    if (geocacheIds.length === 0) {
        return undefined;
    }
    return Array.from(new Set(geocacheIds)).sort((a, b) => a - b).join('-');
}

/** Lit tous les brouillons depuis StorageService. */
export async function readDrafts(
    storageService: StorageService,
    storageKey: string
): Promise<Record<string, LogDraft>> {
    const stored = await storageService.getData<Record<string, LogDraft>>(storageKey, {});
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
        return {};
    }
    return stored;
}

/** Le stockage local est partagé avec tout Theia : on ne garde que les brouillons récents. */
export function pruneDrafts(
    drafts: Record<string, LogDraft>,
    maxAgeMs: number,
    maxItems: number
): Record<string, LogDraft> {
    const now = Date.now();
    const kept = Object.entries(drafts)
        .filter(([, draft]) => {
            if (!draft || typeof draft !== 'object' || typeof draft.savedAt !== 'string') {
                return false;
            }
            const savedAt = Date.parse(draft.savedAt);
            return Number.isNaN(savedAt) || now - savedAt < maxAgeMs;
        })
        .sort((a, b) => Date.parse(b[1].savedAt) - Date.parse(a[1].savedAt))
        .slice(0, maxItems);
    return Object.fromEntries(kept);
}

/** Persiste ou supprime un brouillon pour une clé donnée. */
export async function persistDraftToStorage(
    storageService: StorageService,
    storageKey: string,
    key: string,
    draft: LogDraft | undefined,
    maxAgeMs: number,
    maxItems: number
): Promise<void> {
    const drafts = await readDrafts(storageService, storageKey);
    if (draft) {
        drafts[key] = draft;
    } else if (!(key in drafts)) {
        return;
    } else {
        delete drafts[key];
    }
    await storageService.setData(storageKey, pruneDrafts(drafts, maxAgeMs, maxItems));
}

/** Supprime un brouillon par sa clé. */
export async function deleteDraftFromStorage(
    storageService: StorageService,
    storageKey: string,
    key: string
): Promise<void> {
    const drafts = await readDrafts(storageService, storageKey);
    if (key in drafts) {
        delete drafts[key];
        await storageService.setData(storageKey, drafts);
    }
}

/** Ne conserve d'un enregistrement que les clés correspondant aux géocaches réellement chargées. */
export function pickKnownGeocacheValues<T>(
    geocaches: GeocacheListItem[],
    source: Record<number, T> | undefined,
    isValid: (value: unknown) => value is T
): Record<number, T> {
    const result: Record<number, T> = {};
    if (!source || typeof source !== 'object') {
        return result;
    }
    for (const gc of geocaches) {
        const value = (source as Record<number, unknown>)[gc.id];
        if (isValid(value)) {
            result[gc.id] = value;
        }
    }
    return result;
}

/** Construit une entrée d'historique depuis l'état courant. */
export function buildHistoryEntry(
    generateId: GenerateId,
    logDate: string,
    useSameTextForAll: boolean,
    globalText: string,
    perCacheText: Record<number, string>,
    logType: LogTypeValue,
    perCacheLogType: Record<number, LogTypeValue>,
    perCacheFavorite: Record<number, boolean>
): LogHistoryEntry {
    return {
        id: generateId(),
        createdAt: new Date().toISOString(),
        logDate,
        useSameTextForAll,
        globalText,
        perCacheText: { ...perCacheText },
        logType,
        perCacheLogType: { ...perCacheLogType },
        perCacheFavorite: { ...perCacheFavorite },
    };
}

/** Construit un brouillon depuis l'état courant. */
export function buildDraftFromState(
    geocaches: GeocacheListItem[],
    logDate: string,
    logType: LogTypeValue,
    useSameTextForAll: boolean,
    globalText: string,
    perCacheText: Record<number, string>,
    perCacheLogType: Record<number, LogTypeValue>,
    perCacheFavorite: Record<number, boolean>,
    perCacheSubmitStatus: Record<number, SubmissionStatus>,
    perCacheSubmitReference: Record<number, string | undefined>
): LogDraft {
    return {
        savedAt: new Date().toISOString(),
        geocacheIds: geocaches.map(gc => gc.id),
        logDate,
        logType,
        useSameTextForAll,
        globalText,
        perCacheText: { ...perCacheText },
        perCacheLogType: { ...perCacheLogType },
        perCacheFavorite: { ...perCacheFavorite },
        perCacheSubmitStatus: { ...perCacheSubmitStatus },
        perCacheSubmitReference: { ...perCacheSubmitReference },
    };
}

/**
 * Y a-t-il quelque chose à perdre ? Un onglet ouvert et laissé tel quel ne mérite pas
 * de brouillon : ça ferait réapparaître un bandeau de restauration pour rien.
 */
export function hasDraftWorthSaving(
    globalText: string,
    perCacheText: Record<number, string>,
    perCacheFavorite: Record<number, boolean>,
    perCacheSubmitStatus: Record<number, string>,
    geocaches: GeocacheListItem[],
    logType: LogTypeValue,
    getLogTypeForGeocacheId: (geocacheId: number) => LogTypeValue
): boolean {
    if (globalText.trim() !== '' || Object.values(perCacheText).some(text => (text ?? '').trim() !== '')) {
        return true;
    }
    if (Object.values(perCacheFavorite).some(value => value === true)) {
        return true;
    }
    if (Object.keys(perCacheSubmitStatus).length > 0) {
        return true;
    }
    // Comparaison avec le type global *assaini* : une cache déjà trouvée bascule d'office sur
    // « Ne pas loguer », ce n'est pas un choix de l'utilisateur et ça ne justifie pas un brouillon.
    return geocaches.some(gc => getLogTypeForGeocacheId(gc.id) !== sanitizeLogTypeForGeocache(logType, gc));
}

/** État résultant de l'application d'un brouillon. */
export interface DraftApplicationResult {
    logDate: string;
    logType: LogTypeValue;
    useSameTextForAll: boolean;
    globalText: string;
    perCacheText: Record<number, string>;
    perCacheLogType: Record<number, LogTypeValue>;
    perCacheFavorite: Record<number, boolean>;
    perCacheSubmitStatus: Record<number, SubmissionStatus>;
    perCacheSubmitReference: Record<number, string | undefined>;
    /** IDs dans l'ordre restauré, si applicable. */
    reorderedGeocacheIds?: number[];
}

/** Calcule l'état résultant de l'application d'un brouillon (sans muter le widget). */
export function computeDraftApplication(
    draft: LogDraft,
    geocaches: GeocacheListItem[],
    currentLogDate: string,
    currentLogType: LogTypeValue,
    currentPerCacheLogType: Record<number, LogTypeValue>,
    currentPerCacheFavorite: Record<number, boolean>,
    isLogDatePinned: boolean,
    isValidIsoDate: (value: unknown) => value is string
): DraftApplicationResult {
    const logDate = !isLogDatePinned && isValidIsoDate(draft.logDate) ? draft.logDate : currentLogDate;
    const logType = isLogTypeValue(draft.logType) ? draft.logType : currentLogType;
    const useSameTextForAll = draft.useSameTextForAll === true;
    const globalText = typeof draft.globalText === 'string' ? draft.globalText : '';
    const perCacheText = pickKnownGeocacheValues(geocaches, draft.perCacheText, (v): v is string => typeof v === 'string');

    const restoredTypes = pickKnownGeocacheValues(geocaches, draft.perCacheLogType, isLogTypeValue);
    const nextTypes: Record<number, LogTypeValue> = { ...currentPerCacheLogType };
    for (const gc of geocaches) {
        const stored = restoredTypes[gc.id];
        if (stored !== undefined) {
            nextTypes[gc.id] = sanitizeLogTypeForGeocache(stored, gc);
        }
    }

    const perCacheFavorite = {
        ...currentPerCacheFavorite,
        ...pickKnownGeocacheValues(geocaches, draft.perCacheFavorite, (v): v is boolean => typeof v === 'boolean'),
    };
    const perCacheSubmitStatus = pickKnownGeocacheValues(geocaches, draft.perCacheSubmitStatus, isSubmissionStatus);
    const perCacheSubmitReference = pickKnownGeocacheValues(geocaches, draft.perCacheSubmitReference, (v): v is string => typeof v === 'string');

    // L'ordre est celui d'envoi et de la numérotation @cache_count : il fait partie du travail à restaurer.
    const restoredIds = Array.isArray(draft.geocacheIds) ? draft.geocacheIds.filter(id => typeof id === 'number') : [];
    const reorderedGeocacheIds = restoredIds.length === geocaches.length && restoredIds.every(id => geocaches.some(gc => gc.id === id))
        ? restoredIds
        : undefined;

    return {
        logDate,
        logType,
        useSameTextForAll,
        globalText,
        perCacheText,
        perCacheLogType: nextTypes,
        perCacheFavorite,
        perCacheSubmitStatus,
        perCacheSubmitReference,
        reorderedGeocacheIds,
    };
}

/** État résultant de l'application d'une entrée d'historique. */
export interface HistoryApplicationResult {
    /** Nouvelle date de log, ou `undefined` si la date est épinglée (ne pas changer). */
    logDate?: string;
    logType: LogTypeValue;
    useSameTextForAll: boolean;
    globalText: string;
    perCacheText: Record<number, string>;
    perCacheLogType: Record<number, LogTypeValue>;
    perCacheFavorite: Record<number, boolean>;
}

/** Calcule l'état résultant de l'application d'une entrée d'historique (sans muter le widget). */
export function computeHistoryApplication(
    entry: LogHistoryEntry,
    currentLogType: LogTypeValue,
    isLogDatePinned: boolean
): HistoryApplicationResult {
    const safeLogType = isLogTypeValue(entry.logType) ? entry.logType : currentLogType;

    const perCacheValues = entry.perCacheText && typeof entry.perCacheText === 'object'
        ? entry.perCacheText as Record<number, string>
        : {};

    const perCacheLogTypeValues = entry.perCacheLogType && typeof entry.perCacheLogType === 'object'
        ? entry.perCacheLogType as Record<number, LogTypeValue>
        : {};

    const perCacheFavoriteValues = entry.perCacheFavorite && typeof entry.perCacheFavorite === 'object'
        ? entry.perCacheFavorite as Record<number, boolean>
        : {};

    return {
        logDate: !isLogDatePinned ? entry.logDate : undefined,
        logType: safeLogType,
        useSameTextForAll: entry.useSameTextForAll ?? false,
        globalText: entry.globalText ?? '',
        perCacheText: perCacheValues,
        perCacheLogType: perCacheLogTypeValues,
        perCacheFavorite: perCacheFavoriteValues,
    };
}

/** Calcule le prochain curseur d'historique après navigation. */
export function computeNextHistoryCursor(
    currentCursor: number,
    delta: number,
    historyLength: number
): number | undefined {
    if (historyLength === 0) {
        return undefined;
    }

    let nextCursor: number;
    if (currentCursor < 0) {
        if (delta <= 0) {
            return undefined;
        }
        nextCursor = 0;
    } else {
        nextCursor = currentCursor + delta;
    }

    return Math.max(0, Math.min(historyLength - 1, nextCursor));
}
