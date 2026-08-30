/**
 * Génération de logs par IA.
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 4). La construction
 * du prompt et le nettoyage de la réponse sont des fonctions pures ; l'appel au
 * modèle IA prend les services en paramètres.
 */

import { LanguageModel, LanguageModelRegistry, LanguageModelService, UserRequest, getTextOfResponse, getJsonOfResponse, isLanguageModelParsedResponse } from '@theia/ai-core';
import { GeocacheListItem, LogTypeValue } from './types';

/** Agent ID pour la sélection du modèle IA. */
export type AgentId = string;

/** Construit le prompt pour la génération de log. */
export function buildLogGenerationPrompt(
    logType: LogTypeValue,
    keywords: string,
    geocaches: GeocacheListItem[],
    customInstructions: string,
    exampleLogs: string
): string {
    const logTypeLabel = logType === 'found' ? 'trouvaille (Found it)'
        : logType === 'dnf' ? 'non trouvée (Did Not Find)'
        : 'note (Write note)';

    const geocacheContext = geocaches.length > 0
        ? `\n\nContexte des géocaches à loguer :\n${geocaches.slice(0, 5).map(gc => `- ${gc.gc_code}: "${gc.name}" (type: ${gc.cache_type || 'inconnu'}, owner: ${gc.owner || 'inconnu'})`).join('\n')}${geocaches.length > 5 ? `\n... et ${geocaches.length - 5} autre(s)` : ''}`
        : '';

    let prompt = `Tu es un rédacteur de logs de géocache. Génère un log de type "${logTypeLabel}" basé sur les mots-clés et idées suivants :

**Mots-clés / idées :** ${keywords}
${geocacheContext}`;

    if (customInstructions) {
        prompt += `\n\n**Instructions personnalisées de l'utilisateur :**\n${customInstructions}`;
    }

    if (exampleLogs) {
        prompt += `\n\n**Exemples de logs de l'utilisateur (style à reproduire) :**\n${exampleLogs}`;
    }

    prompt += `\n\n**Règles importantes :**
- Écris UNIQUEMENT le texte du log, sans introduction ni explication.
- Le log doit être naturel et personnel, comme s'il était écrit par un géocacheur.
- Adapte le ton au type de log (enthousiaste pour une trouvaille, déçu mais positif pour un DNF, informatif pour une note).
- Tu peux utiliser du Markdown simple (gras, italique) si approprié.
- Le log doit faire entre 2 et 6 phrases.
- NE PAS inclure de signature ou de "TFTC" sauf si demandé dans les instructions.`;

    return prompt;
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

/** Erreur levée quand aucun modèle IA n'est configuré. */
export class NoLanguageModelError extends Error {
    constructor() {
        super('Aucun modèle IA n\'est configuré');
        this.name = 'NoLanguageModelError';
    }
}

/** Génère un log via le modèle IA. Retourne le texte généré, ou `undefined` si vide. Lève `NoLanguageModelError` si aucun modèle. */
export async function generateLogWithAi(
    languageModelRegistry: LanguageModelRegistry,
    languageModelService: LanguageModelService,
    agentId: AgentId,
    logType: LogTypeValue,
    keywords: string,
    geocaches: GeocacheListItem[],
    customInstructions: string,
    exampleLogs: string
): Promise<string | undefined> {
    const languageModel = await languageModelRegistry.selectLanguageModel({
        agent: agentId,
        purpose: 'chat',
        identifier: 'default/universal'
    });

    if (!languageModel) {
        throw new NoLanguageModelError();
    }

    const prompt = buildLogGenerationPrompt(logType, keywords, geocaches, customInstructions, exampleLogs);

    const request: UserRequest = {
        messages: [
            { actor: 'user', type: 'text', text: prompt },
        ],
        agentId,
        requestId: `geoapp-log-writer-${Date.now()}`,
        sessionId: `geoapp-log-writer-session-${Date.now()}`,
    };

    const response = await languageModelService.sendRequest(languageModel as LanguageModel, request);
    let generatedText = '';

    if (isLanguageModelParsedResponse(response)) {
        generatedText = JSON.stringify(response.parsed);
    } else {
        try {
            generatedText = await getTextOfResponse(response);
        } catch {
            const jsonResponse = await getJsonOfResponse(response) as any;
            generatedText = typeof jsonResponse === 'string' ? jsonResponse : String(jsonResponse);
        }
    }

    return cleanAiResponse(generatedText);
}
