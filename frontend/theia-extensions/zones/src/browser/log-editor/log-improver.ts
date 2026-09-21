/**
 * Correction et rédaction du texte d'un log par IA.
 *
 * Remplace l'ancienne « génération de log par IA », qui partait de mots-clés pour inventer un
 * log de toutes pièces : ce qu'elle produisait n'engageait que le modèle, jamais le
 * géocacheur, et l'owner de la cache recevait un texte que personne n'avait vécu. Ici, le
 * modèle ne reçoit **que ce que l'utilisateur a déjà écrit** et n'a le droit d'y ajouter
 * aucune idée — la différence tient dans une règle du prompt, mais c'est toute la différence.
 *
 * Deux modes, parce que ce sont deux besoins distincts :
 *
 * - `proofread` corrige les fautes sans reformuler. Un log déjà bien écrit doit ressortir mot
 *   pour mot : une « amélioration » spontanée du style serait une perte pour l'auteur.
 * - `rewrite` transforme une suite de notes en texte suivi. Il rédige à partir des idées
 *   présentes, il n'en invente pas.
 *
 * Mêmes contraintes que la traduction (`log-translator.ts`), pour les mêmes raisons : les
 * `@patterns` sont résolus après la saisie et cassent en silence s'ils sont touchés, et le
 * texte est du Markdown qui tient sous les 4000 caractères de Geocaching.com.
 */

import { LanguageModelRegistry, LanguageModelService } from '@theia/ai-core';
import { AgentId, findLostPatterns, requestCleanedText } from './log-ai-common';
import { LexiconEntry, buildLexiconPreservationBlock, findLexiconMentions } from '../geocaching-lexicon';

/** Ce que l'IA a le droit de faire au texte. */
export type LogImprovementMode = 'proofread' | 'rewrite';

/** Un mode, tel qu'il s'affiche dans le menu du bouton. */
export interface LogImprovementModeDescriptor {
    id: LogImprovementMode;
    /** Libellé de l'item de menu. */
    label: string;
    /** Badge du bouton : doit tenir en un mot. */
    badge: string;
    /** Ce que le mode fait, en une ligne. Sert d'infobulle. */
    description: string;
    /** Message affiché une fois le texte remplacé. */
    doneMessage: string;
    /** Participe accordé du bilan de lot : « 12 bloc(s) <participe> ». */
    doneParticiple: string;
}

export const LOG_IMPROVEMENT_MODES: readonly LogImprovementModeDescriptor[] = [
    {
        id: 'proofread',
        label: 'Corriger les fautes',
        badge: 'Fautes',
        description: 'Orthographe, grammaire, ponctuation. Ni reformulation, ni ajout.',
        doneMessage: 'Fautes corrigées.',
        doneParticiple: 'corrigé(s)',
    },
    {
        id: 'rewrite',
        label: 'Rédiger le texte',
        badge: 'Rédiger',
        description: 'Transforme des notes ou des idées en un log agréable à lire, sans rien inventer.',
        doneMessage: 'Texte rédigé à partir de vos notes.',
        doneParticiple: 'rédigé(s)',
    },
];

export const DEFAULT_LOG_IMPROVEMENT_MODE: LogImprovementMode = 'proofread';

export function isLogImprovementMode(value: unknown): value is LogImprovementMode {
    return LOG_IMPROVEMENT_MODES.some(mode => mode.id === value);
}

/** Descripteur d'un mode ; retombe sur le mode par défaut pour une valeur inconnue. */
export function getLogImprovementMode(id: LogImprovementMode): LogImprovementModeDescriptor {
    return LOG_IMPROVEMENT_MODES.find(mode => mode.id === id)
        ?? LOG_IMPROVEMENT_MODES.find(mode => mode.id === DEFAULT_LOG_IMPROVEMENT_MODE)!;
}

/**
 * Construit le prompt. `patternNames` nomme les tokens à ne pas toucher ; `lexiconBlock` porte
 * les seuls termes du lexique repérés dans le texte, et vaut la chaîne vide quand il n'y en a
 * aucun (voir `geocaching-lexicon.ts`).
 */
export function buildLogImprovementPrompt(
    mode: LogImprovementMode,
    patternNames: Set<string>,
    lexiconBlock: string = ''
): string {
    const tokens = [...patternNames].sort().map(name => `@${name}`).join(', ');
    const patternRule = tokens
        ? `- Laisse STRICTEMENT intacts les tokens commençant par @ : ${tokens}. Ne les traduis pas, ne les renomme pas, ne les supprime pas, ne change pas leur casse.`
        : '- Laisse STRICTEMENT intact tout token commençant par @ : ne le renomme pas, ne le supprime pas.';

    const task = mode === 'proofread'
        ? `Tu es un correcteur. Corrige les fautes du log de géocache fourni.

**Ce mode corrige, il ne réécrit pas :**
- Corrige l'orthographe, la grammaire, les accords, la conjugaison, la ponctuation et les espaces.
- Ne reformule pas, ne réordonne pas, ne raccourcis pas : une phrase déjà correcte doit ressortir mot pour mot.
- Les tournures familières, les abréviations, les smileys et les majuscules d'emphase sont des choix de l'auteur, pas des fautes : garde-les.
- Si le texte ne contient aucune faute, renvoie-le inchangé.`
        : `Tu es un rédacteur. Mets en forme les notes de log de géocache fournies.

**Ce mode rédige à partir de ce qui est écrit :**
- Transforme la suite d'idées, de mots-clés ou de phrases brutes en un texte suivi et agréable à lire.
- Reprends TOUTES les idées présentes, et seulement celles-là.
- Reste bref : un log de géocache se lit en quelques phrases.
- Corrige les fautes au passage, et garde le ton de l'auteur — c'est un log personnel, pas un texte administratif.`;

    // La règle « n'invente rien » est la raison d'être de ce module : c'est elle qui sépare une
    // aide à la rédaction d'un faux témoignage envoyé à l'owner de la cache.
    const rules = `**Règles communes :**
- Renvoie UNIQUEMENT le texte final, sans introduction, sans commentaire, sans guillemets d'encadrement.
- N'invente RIEN : aucune météo, aucun paysage, aucun détail sur la cache, sur la recherche ou sur les personnes qui ne soit déjà dans le texte. Si une information manque, elle reste absente.
- Garde la langue de l'original : ce n'est pas une traduction.
- Écris à la première personne, comme le géocacheur qui a écrit ces notes.
${patternRule}
- Conserve la mise en forme Markdown (gras, italique, listes, citations, liens) et ne touche ni aux codes GC, ni aux coordonnées, ni aux URLs.`;

    // Le bloc porte lui-même sa consigne (voir `buildLexiconPreservationBlock`) : un correcteur
    // « répare » spontanément TFTC ou DNF, qu'il prend pour des coquilles.
    const lexicon = lexiconBlock.trim() ? `\n\n${lexiconBlock.trim()}` : '';

    return `${task}\n\n${rules}${lexicon}`;
}

/** Résultat d'une amélioration : le texte produit et ce que le modèle a laissé filer. */
export interface LogImprovementResult {
    text: string;
    lostPatterns: string[];
}

/**
 * Corrige ou rédige un texte de log via le modèle IA.
 *
 * Retourne `undefined` si le texte est vide ou si le modèle n'a rien renvoyé d'exploitable ;
 * lève `NoLanguageModelError` si aucun modèle n'est assigné à l'agent.
 */
export async function improveLogWithAi(
    languageModelRegistry: LanguageModelRegistry,
    languageModelService: LanguageModelService,
    agentId: AgentId,
    text: string,
    mode: LogImprovementMode,
    patternNames: Set<string>,
    lexicon: readonly LexiconEntry[] = []
): Promise<LogImprovementResult | undefined> {
    const source = (text || '').trim();
    if (!source) {
        return undefined;
    }

    const lexiconBlock = buildLexiconPreservationBlock(findLexiconMentions(source, lexicon));
    const prompt = buildLogImprovementPrompt(mode, patternNames, lexiconBlock);

    const improved = await requestCleanedText(
        languageModelRegistry,
        languageModelService,
        agentId,
        `${prompt}\n\nTEXTE :\n${source}`,
        'geoapp-log-improver'
    );

    if (!improved) {
        return undefined;
    }

    return {
        text: improved,
        lostPatterns: findLostPatterns(source, improved, patternNames),
    };
}
