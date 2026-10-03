/**
 * Lecture du flux de progression d'un import de géocaches (une ligne JSON par étape).
 *
 * Format émis par le backend (`_progress_line` dans `blueprints/geocaches.py`) :
 * `{progress, message, counts?, error_item?}` à chaque cache, `{final_summary: true,
 * message, stats}` à la fin, `{error: true, message}` en cas d'erreur fatale.
 * Partagé par les imports d'une zone et par les visites GPS.
 */

import { ImportCounts, ImportProgressCallback } from './import-dialog-shell';

export interface ImportStreamResult {
    /** Résumé final, ou message de l'erreur fatale. */
    lastMessage?: string;
    hadError: boolean;
    /** Ligne finale complète (`final_summary`), pour les flux qui y ajoutent des champs. */
    finalPayload?: Record<string, unknown>;
}

export async function consumeImportStream(
    response: Response,
    onProgress?: ImportProgressCallback,
    onFatalError?: (message: string) => void
): Promise<ImportStreamResult> {
    const reader = response.body?.getReader();
    if (!reader) {
        return { hadError: false };
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let lastMessage: string | undefined;
    let hadError = false;
    let errorMessage: string | undefined;
    let finalPayload: Record<string, unknown> | undefined;

    const processLine = (rawLine: string): void => {
        const line = rawLine.trim();
        if (!line) {
            return;
        }

        try {
            const data = JSON.parse(line) as {
                error?: boolean;
                progress?: number;
                message?: string;
                final_summary?: boolean;
                counts?: ImportCounts;
                error_item?: string;
            };

            if (data.error) {
                // Erreur fatale du flux (téléchargement échoué, aucun code…).
                const message = data.message || 'Erreur lors de l\'import';
                hadError = true;
                errorMessage = message;
                onFatalError?.(message);
                onProgress?.(0, message);
                return;
            }

            if (typeof data.progress === 'number') {
                onProgress?.(data.progress, data.message || '', {
                    counts: data.counts,
                    errorItem: data.error_item
                });
            }

            if (data.final_summary) {
                finalPayload = data as Record<string, unknown>;
                if (data.message) {
                    lastMessage = data.message;
                }
            }
        } catch (error) {
            console.error('Error parsing import progress data:', error);
        }
    };

    while (true) {
        const { done, value } = await reader.read();
        if (value) {
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                processLine(line);
            }
        }

        if (done) {
            break;
        }
    }

    buffer += decoder.decode();
    processLine(buffer);
    return { lastMessage: errorMessage ?? lastMessage, hadError, finalPayload };
}
