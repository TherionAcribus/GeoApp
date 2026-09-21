/**
 * Traduction de logs par IA.
 *
 * La construction du prompt et l'assemblage du résultat sont des fonctions pures ; l'appel au
 * modèle, le nettoyage de la réponse et le contrôle des @patterns viennent de
 * `log-ai-common.ts`, partagé avec `log-improver.ts`.
 *
 * Deux contraintes propres au log, absentes de la traduction des listings :
 * - le texte contient des `@patterns` résolus *après* la saisie ; s'ils sont traduits, ils
 *   cassent en silence (surlignage, compteur de caractères et aperçu mentiraient tous) ;
 * - le texte est du Markdown, pas du HTML : ni découpage en morceaux, ni assainissement
 *   HTML ne sont nécessaires, un log tient sous les 4000 caractères de Geocaching.com.
 */

import { LanguageModelRegistry, LanguageModelService } from '@theia/ai-core';
import { AgentId, findLostPatterns, requestCleanedText } from './log-ai-common';
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
    const source = buildTranslationSource(text, addNotice, noticeText);
    // La détection porte sur le texte réellement soumis, mention de traduction comprise : c'est
    // lui que le modèle va lire, et c'est sur lui que portera la vérification de sortie.
    const mentions = findLexiconMentions(source, lexicon);
    const prompt = buildLogTranslationPrompt(
        targetLanguage,
        patternNames,
        buildLexiconTranslationBlock(mentions, targetLanguage)
    );

    const translated = await requestCleanedText(
        languageModelRegistry,
        languageModelService,
        agentId,
        `${prompt}\n\nTEXTE :\n${source}`,
        'geoapp-log-translator'
    );

    if (!translated) {
        return undefined;
    }

    return {
        text: assembleTranslation((text || '').trim(), translated, mode, separator),
        lostPatterns: findLostPatterns(source, translated, patternNames),
        lexiconDeviations: findLexiconDeviations(source, translated, mentions, targetLanguage),
    };
}
