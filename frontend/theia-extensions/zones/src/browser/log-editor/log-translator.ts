/**
 * Traduction de logs par IA.
 *
 * Même découpage que `ai-log-generator.ts` : la construction du prompt, l'assemblage du
 * résultat et le contrôle des @patterns sont des fonctions pures ; l'appel au modèle prend
 * les services en paramètres.
 *
 * Deux contraintes propres au log, absentes de la traduction des listings :
 * - le texte contient des `@patterns` résolus *après* la saisie ; s'ils sont traduits, ils
 *   cassent en silence (surlignage, compteur de caractères et aperçu mentiraient tous) ;
 * - le texte est du Markdown, pas du HTML : ni découpage en morceaux, ni assainissement
 *   HTML ne sont nécessaires, un log tient sous les 4000 caractères de Geocaching.com.
 */

import { LanguageModel, LanguageModelRegistry, LanguageModelService, UserRequest, getTextOfResponse, getJsonOfResponse, isLanguageModelParsedResponse } from '@theia/ai-core';
import { AgentId, NoLanguageModelError, cleanAiResponse } from './ai-log-generator';
import {
    LexiconDeviation,
    LexiconEntry,
    buildLexiconTranslationBlock,
    findLexiconDeviations,
    findLexiconMentions,
} from '../geocaching-lexicon';

/** Comment le résultat de la traduction remplace le texte saisi. */
export type LogTranslationMode = 'replace' | 'bilingual';

/**
 * Texte réellement soumis au modèle.
 *
 * La mention de traduction automatique est ajoutée **avant** l'appel plutôt qu'après :
 * elle ressort ainsi dans la langue cible sans table de correspondance ni second appel,
 * et sa présence est garantie puisqu'elle faisait partie de l'entrée.
 */
export function buildTranslationSource(text: string, addNotice: boolean, noticeText: string): string {
    const body = (text || '').trim();
    const notice = (noticeText || '').trim();
    if (!addNotice || !notice) {
        return body;
    }
    return `${body}\n\n${notice}`;
}

/**
 * Construit le prompt de traduction. `patternNames` sert à nommer les tokens à ne pas toucher ;
 * `lexiconBlock` porte les seuls termes du lexique repérés dans le texte (voir
 * `geocaching-lexicon.ts`), et vaut la chaîne vide quand il n'y en a aucun.
 */
export function buildLogTranslationPrompt(
    targetLanguage: string,
    patternNames: Set<string>,
    lexiconBlock: string = ''
): string {
    const tokens = [...patternNames].sort().map(name => `@${name}`).join(', ');
    const patternRule = tokens
        ? `- Laisse STRICTEMENT intacts les tokens commençant par @ : ${tokens}. Ne les traduis pas, ne les renomme pas, ne les supprime pas, ne change pas leur casse.`
        : '- Laisse STRICTEMENT intact tout token commençant par @ : ne le traduis pas, ne le renomme pas.';

    // Le lexique est placé après les règles : elles disent comment traduire, il dit quoi ne pas
    // traduire. Le lire en dernier laisse ses termes en mémoire courte au moment de rédiger.
    const lexicon = lexiconBlock.trim() ? `\n\n${lexiconBlock.trim()}` : '';

    return `Tu es un traducteur. Traduis en ${targetLanguage} le texte de log de géocache fourni.

**Règles importantes :**
- Renvoie UNIQUEMENT le texte traduit, sans introduction, sans commentaire, sans guillemets d'encadrement.
- Traduis la TOTALITÉ du texte, y compris la dernière ligne si elle signale une traduction automatique.
${patternRule}
- Conserve exactement la mise en forme Markdown (gras, italique, listes, citations, liens) et les sauts de ligne.
- Ne traduis pas les codes GC, les coordonnées, les URLs ni les identifiants techniques.
- Garde le ton et le registre de l'original : c'est un log personnel de géocacheur, pas un texte administratif.
- N'ajoute aucun contenu qui n'est pas dans l'original.${lexicon}`;
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
 * Patterns présents dans le texte source et absents de la traduction.
 *
 * Un pattern perdu ne casse pas l'envoi, mais il ne sera plus résolu : l'appelant avertit
 * l'utilisateur, qui voit le texte et peut revenir à l'original.
 */
export function findLostPatterns(source: string, translated: string, patternNames: Set<string>): string[] {
    const before = extractPatternTokens(source, patternNames);
    const after = extractPatternTokens(translated, patternNames);
    return [...before].filter(name => !after.has(name)).sort();
}

/**
 * Assemble le texte final. En mode bilingue, `original` est le texte saisi **sans** la mention
 * de traduction : celle-ci n'a de sens que sous la version traduite.
 */
export function assembleTranslation(
    original: string,
    translated: string,
    mode: LogTranslationMode,
    separator: string
): string {
    if (mode !== 'bilingual') {
        return translated;
    }
    const head = (original || '').trim();
    if (!head) {
        return translated;
    }
    const rule = (separator || '').trim();
    return rule
        ? `${head}\n\n${rule}\n\n${translated}`
        : `${head}\n\n${translated}`;
}

/** Résultat d'une traduction : le texte assemblé et ce que la traduction a laissé filer. */
export interface LogTranslationResult {
    text: string;
    lostPatterns: string[];
    /** Termes du lexique dont la forme attendue manque à la sortie. Informatif, jamais bloquant. */
    lexiconDeviations: LexiconDeviation[];
}

/**
 * Traduit un texte de log via le modèle IA.
 *
 * Retourne `undefined` si le modèle n'a rien renvoyé d'exploitable ; lève `NoLanguageModelError`
 * si aucun modèle n'est assigné à l'agent.
 */
export async function translateLogWithAi(
    languageModelRegistry: LanguageModelRegistry,
    languageModelService: LanguageModelService,
    agentId: AgentId,
    text: string,
    targetLanguage: string,
    patternNames: Set<string>,
    mode: LogTranslationMode,
    separator: string,
    addNotice: boolean,
    noticeText: string,
    lexicon: readonly LexiconEntry[] = []
): Promise<LogTranslationResult | undefined> {
    const languageModel = await languageModelRegistry.selectLanguageModel({
        agent: agentId,
        purpose: 'chat',
        identifier: 'default/universal'
    });

    if (!languageModel) {
        throw new NoLanguageModelError();
    }

    const source = buildTranslationSource(text, addNotice, noticeText);
    // La détection porte sur le texte réellement soumis, mention de traduction comprise : c'est
    // lui que le modèle va lire, et c'est sur lui que portera la vérification de sortie.
    const mentions = findLexiconMentions(source, lexicon);
    const prompt = buildLogTranslationPrompt(
        targetLanguage,
        patternNames,
        buildLexiconTranslationBlock(mentions, targetLanguage)
    );

    const request: UserRequest = {
        messages: [
            { actor: 'user', type: 'text', text: `${prompt}\n\nTEXTE :\n${source}` },
        ],
        agentId,
        requestId: `geoapp-log-translator-${Date.now()}`,
        sessionId: `geoapp-log-translator-session-${Date.now()}`,
    };

    const response = await languageModelService.sendRequest(languageModel as LanguageModel, request);
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

    const translated = cleanAiResponse(rawText);
    if (!translated) {
        return undefined;
    }

    return {
        text: assembleTranslation((text || '').trim(), translated, mode, separator),
        lostPatterns: findLostPatterns(source, translated, patternNames),
        lexiconDeviations: findLexiconDeviations(source, translated, mentions, targetLanguage),
    };
}
