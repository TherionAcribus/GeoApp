/**
 * Briques communes aux appels IA de l'éditeur de logs.
 *
 * Traduire un log et le corriger partagent tout sauf le prompt : même sélection de modèle,
 * même extraction de la réponse, même nettoyage — et surtout le même garde-fou sur les
 * `@patterns`, qu'un modèle casse en silence dès qu'il réécrit le texte.
 *
 * Ce module ne construit aucun prompt : chaque moteur (`log-translator.ts`, `log-improver.ts`)
 * garde le sien, qui est toute la différence entre les deux.
 */

import { LanguageModelResponse, getTextOfResponse, getJsonOfResponse, isLanguageModelParsedResponse } from '@theia/ai-core';
import { GeoAppAiExecutionService, GeoAppAiExecutionUnavailableError } from '../geoapp-ai-execution-service';

/** Erreur levée quand aucun modèle IA n'est configuré. */
export class NoLanguageModelError extends Error {
    constructor() {
        super('Aucun modèle IA n\'est configuré');
        this.name = 'NoLanguageModelError';
    }
}

/** Nettoie la réponse IA : retire les blocs de réflexion (THINK, ANALYSIS) et trim. */
export function cleanAiResponse(text: string): string {
    return (text || '')
        .replace(/\[THINK\][\s\S]*?\[\/THINK\]/gi, '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/\[ANALYSIS\][\s\S]*?\[\/ANALYSIS\]/gi, '')
        .replace(/<analysis>[\s\S]*?<\/analysis>/gi, '')
        .trim();
}

/** Tokens `@xxx` présents dans un texte, restreints aux patterns connus. */
export function extractPatternTokens(text: string, patternNames: Set<string>): Set<string> {
    const found = new Set<string>();
    for (const match of (text || '').matchAll(/@([A-Za-z0-9_]+)/g)) {
        const name = match[1];
        if (patternNames.has(name)) {
            found.add(name);
        }
    }
    return found;
}

/**
 * Patterns présents dans le texte source et absents de la sortie.
 *
 * Un pattern perdu ne casse pas l'envoi, mais il ne sera plus résolu : l'appelant avertit
 * l'utilisateur, qui voit le texte et peut revenir à l'original.
 */
export function findLostPatterns(source: string, rewritten: string, patternNames: Set<string>): string[] {
    const before = extractPatternTokens(source, patternNames);
    const after = extractPatternTokens(rewritten, patternNames);
    return [...before].filter(name => !after.has(name)).sort();
}

/**
 * Un appel texte simple : sélection du modèle, envoi, extraction, nettoyage.
 *
 * `requestKind` ne sert qu'à nommer la requête et la session côté Theia — c'est ce qui rend
 * un appel identifiable dans l'historique des requêtes IA.
 *
 * Lève `NoLanguageModelError` si aucun modèle n'est assigné à l'agent ; retourne la chaîne
 * vide si le modèle n'a rien renvoyé d'exploitable.
 */
export async function requestCleanedText(
    aiExecutionService: GeoAppAiExecutionService,
    taskId: string,
    prompt: string,
    requestKind: string
): Promise<string> {
    let response: LanguageModelResponse;
    try {
        response = (await aiExecutionService.sendTaskRequest(taskId, {
            messages: [
                { actor: 'user', type: 'text', text: prompt },
            ],
        }, {
            operationId: `${requestKind}-${Date.now()}`,
        })).response;
    } catch (error) {
        if (error instanceof GeoAppAiExecutionUnavailableError
            && (error.resolution.status === 'unconfigured' || error.resolution.status === 'unavailable')) {
            throw new NoLanguageModelError();
        }
        throw error;
    }
    let rawText = '';

    if (isLanguageModelParsedResponse(response)) {
        rawText = JSON.stringify(response.parsed);
    } else {
        try {
            rawText = await getTextOfResponse(response);
        } catch {
            const jsonResponse = await getJsonOfResponse(response) as unknown;
            rawText = typeof jsonResponse === 'string' ? jsonResponse : String(jsonResponse);
        }
    }

    return cleanAiResponse(rawText);
}
