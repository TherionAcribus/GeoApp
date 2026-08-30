/**
 * Types et guards partagés par le widget d'édition de logs et ses sous-composants.
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 1) : aucune logique
 * ici, uniquement des déclarations de types et les guards associés.
 */

/** `skip` n'est pas un type de log Geocaching.com : c'est un marqueur local "cette cache ne sera pas envoyée". */
export type LogTypeValue = 'found' | 'dnf' | 'note' | 'skip';

export const LOG_TYPE_VALUES: readonly LogTypeValue[] = ['found', 'dnf', 'note', 'skip'];

export function isLogTypeValue(value: unknown): value is LogTypeValue {
    return typeof value === 'string' && (LOG_TYPE_VALUES as readonly string[]).includes(value);
}

export type SubmissionStatus = 'ok' | 'failed' | 'skipped';

export function isSubmissionStatus(value: unknown): value is SubmissionStatus {
    return value === 'ok' || value === 'failed' || value === 'skipped';
}

export type ImageUploadStatus = 'pending' | 'uploading' | 'ok' | 'failed';

/** Résultat d'un lot d'uploads de photos pour une géocache. */
export interface ImagesUploadResult {
    /** GUIDs des photos réellement acceptées par Geocaching.com. */
    guids: string[];
    total: number;
    failed: number;
}

export interface SelectedLogImage {
    id: string;
    file: File;
    status: ImageUploadStatus;
    imageGuid?: string;
    error?: string;
}

export interface GeocacheListItem {
    id: number;
    gc_code: string;
    name: string;
    owner?: string;
    favorites_count?: number;
    logs_count?: number;
    placed_at?: string | null;
    cache_type?: string;
    /** La géocache est déjà marquée comme trouvée : un second "Found it" est refusé par Geocaching.com. */
    already_found?: boolean;
    found_date?: string | null;
}

export interface LogHistoryEntry {
    id: string;
    createdAt: string;
    logDate: string;
    useSameTextForAll: boolean;
    globalText: string;
    perCacheText: Record<number, string>;
    logType: LogTypeValue;
    perCacheLogType: Record<number, LogTypeValue>;
    perCacheFavorite: Record<number, boolean>;
}

/**
 * Sauvegarde automatique de la session de rédaction en cours, indexée par l'ensemble
 * des géocaches ouvertes. Contrairement à l'historique (écrit après un envoi réussi),
 * le brouillon existe dès la première frappe : c'est lui qui survit à une fermeture
 * d'onglet ou à un plantage. Les photos sélectionnées (`File`) ne sont pas sérialisables
 * et ne sont donc pas restaurées.
 */
export interface LogDraft {
    savedAt: string;
    /** Ordre d'affichage/d'envoi au moment de la sauvegarde (il pilote `@cache_count`). */
    geocacheIds: number[];
    logDate: string;
    logType: LogTypeValue;
    useSameTextForAll: boolean;
    globalText: string;
    perCacheText: Record<number, string>;
    perCacheLogType: Record<number, LogTypeValue>;
    perCacheFavorite: Record<number, boolean>;
    /** Logs déjà postés : les restaurer évite de republier après un plantage en cours de lot. */
    perCacheSubmitStatus: Record<number, SubmissionStatus>;
    perCacheSubmitReference: Record<number, string | undefined>;
}

export interface LogTextPattern {
    id: string;
    name: string;
    content: string;
    isBuiltin: boolean;
}

export interface PatternSuggestion {
    id: string;
    label: string;
    description: string;
    insertText: string;
}