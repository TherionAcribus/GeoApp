import { injectable, inject } from '@theia/core/shared/inversify';
import { FormulaSolverLLMService } from '../formula-solver-llm-service';
import { FormulaSolverService } from '../formula-solver-service';
import type { FormulaSolverService as IFormulaSolverService } from '../formula-solver-service';
import { AnsweringContextCache } from '../answering-context-cache';
import { AnsweringStrategy } from './answering-strategy';
import { AnsweringContext, AnsweringResult, AnswerDetail, ValueType } from './types';

@injectable()
export class AiPerQuestionAnswering implements AnsweringStrategy {
    @inject(FormulaSolverLLMService)
    protected readonly llmService!: FormulaSolverLLMService;

    @inject(FormulaSolverService)
    protected readonly formulaSolverService!: IFormulaSolverService;

    @inject(AnsweringContextCache)
    protected readonly answeringContextCache!: AnsweringContextCache;

    async answer(context: AnsweringContext): Promise<AnsweringResult> {
        const defaultProfile = context.aiProfile ?? 'fast';
        const answersByLetter = new Map<string, string>();
        const detailsByLetter = new Map<string, AnswerDetail>();

        const allQuestions = context.allQuestionsByLetter ?? context.questionsByLetter;
        const questionsObj: Record<string, string> = {};
        allQuestions.forEach((q, letter) => { questionsObj[letter] = q || ''; });

        const preparedContext = context.preparedContextOverride ?? await this.answeringContextCache.getOrBuild({
            geocacheId: context.geocacheId,
            geocacheTitle: context.geocacheTitle,
            geocacheCode: context.geocacheCode,
            text: context.text,
            questionsByLetter: questionsObj,
            targetLetters: Array.from(context.questionsByLetter.keys()),
            profile: defaultProfile
        });

        // Les questions vides ont une réponse immédiate ; seules les questions
        // non vides déclenchent un appel LLM/web.
        const pending: Array<[string, string]> = [];
        for (const [letter, question] of context.questionsByLetter.entries()) {
            if (!question) {
                answersByLetter.set(letter, '');
            } else {
                pending.push([letter, question]);
            }
        }

        // Résout une lettre (appel LLM ou web + LLM) et propage la réponse.
        const processLetter = async ([letter, question]: [string, string]): Promise<void> => {
            const profile = context.perQuestionProfile?.get(letter) ?? defaultProfile;

            let answer: string;
            let detail: AnswerDetail;

            // Si le profil est "web", faire d'abord une recherche web puis passer les résultats au LLM
            if (profile === 'web') {
                const webResult = await this._answerWithWebSearch(letter, question, context, preparedContext);
                answer = webResult.answer;
                detail = webResult.detail;
            } else {
                const extraUserInfo = [
                    (context.additionalInstructions || '').trim(),
                    (context.perLetterExtraInfo?.[letter] || '').trim()
                ].filter(Boolean).join('\n\n');
                const result = await this.llmService.answerSingleQuestionWithContext({
                    letter,
                    question,
                    geocacheTitle: context.geocacheTitle,
                    geocacheCode: context.geocacheCode,
                    context: preparedContext,
                    extraUserInfo
                }, profile);
                answer = result.answer;
                detail = {
                    answer: result.answer,
                    source: 'ai',
                    profile,
                    explanation: result.explanation || undefined,
                    valueType: (result.valueType as ValueType) || undefined,
                    timestampMs: Date.now()
                };
            }

            answersByLetter.set(letter, answer);
            detailsByLetter.set(letter, detail);

            // Appeler le callback de progression si fourni (mode streaming)
            if (context.onAnswer) {
                context.onAnswer(letter, answer, detail);
            }
        };

        const concurrency = this._resolveConcurrency(context, pending, defaultProfile);
        await runWithConcurrency(pending, concurrency, processLetter);

        return {
            answersByLetter,
            detailsByLetter,
            meta: {
                source: 'ai',
                profile: defaultProfile,
                timestampMs: Date.now()
            }
        };
    }

    /**
     * Détermine le nombre de réponses IA traitées simultanément.
     * Concurrence 1 si toutes les lettres utilisent un modèle local (les serveurs
     * LMStudio/Ollama traitent une requête à la fois), sinon la valeur demandée (défaut 3).
     */
    protected _resolveConcurrency(
        context: AnsweringContext,
        pending: Array<[string, string]>,
        defaultProfile: string
    ): number {
        if (pending.length <= 1) {
            return 1;
        }
        const allLocal = pending.every(([letter]) =>
            (context.perQuestionProfile?.get(letter) ?? defaultProfile) === 'local'
        );
        if (allLocal) {
            return 1;
        }
        const requested = context.maxConcurrency ?? 3;
        return Math.max(1, requested);
    }

    /**
     * Mode "Web + IA" : recherche web puis extraction intelligente par LLM.
     */
    protected async _answerWithWebSearch(
        letter: string,
        question: string,
        context: AnsweringContext,
        preparedContext: any
    ): Promise<{ answer: string; detail: AnswerDetail }> {
        // 1. Faire la recherche web via le backend
        const webContext = context.webContext ?? context.text.substring(0, 200);
        const maxResults = context.webMaxResults ?? 5;
        const webSearchResult = await this.formulaSolverService.searchAnswerWeb({
            question,
            context: webContext,
            maxResults
        });

        const webSnippets = (webSearchResult.results || [])
            .filter((r: any) => r.type !== 'no_result')
            .map((r: any, i: number) => `[${i + 1}] ${r.text} (source: ${r.source || '?'})`)
            .join('\n');

        // 2. Passer les résultats au LLM pour extraction intelligente
        const webInfoBlock = webSnippets
            ? `\nRésultats de recherche Internet pour cette question:\n${webSnippets}\n`
            : '\nAucun résultat trouvé sur Internet pour cette question.\n';

        const extraUserInfo = [
            (context.additionalInstructions || '').trim(),
            (context.perLetterExtraInfo?.[letter] || '').trim(),
            webInfoBlock
        ].filter(Boolean).join('\n\n');

        // Utiliser le profil "fast" pour l'extraction (le web a déjà fourni l'info)
        const result = await this.llmService.answerSingleQuestionWithContext({
            letter,
            question,
            geocacheTitle: context.geocacheTitle,
            geocacheCode: context.geocacheCode,
            context: preparedContext,
            extraUserInfo
        }, 'fast');

        return {
            answer: result.answer,
            detail: {
                answer: result.answer,
                source: 'web',
                profile: 'web',
                explanation: result.explanation || undefined,
                valueType: (result.valueType as ValueType) || undefined,
                webResults: webSearchResult.results,
                timestampMs: Date.now()
            }
        };
    }
}

/**
 * Exécute `worker` sur chaque item avec au plus `limit` tâches simultanées.
 *
 * Préserve la sémantique « la première erreur interrompt le lot » : dès qu'une
 * tâche échoue, on cesse d'en lancer de nouvelles et on rejette avec cette
 * erreur une fois les tâches déjà en cours terminées (comportement identique à
 * l'ancienne boucle séquentielle, vu par l'appelant).
 */
export async function runWithConcurrency<T>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>
): Promise<void> {
    if (items.length === 0) {
        return;
    }

    const effectiveLimit = Math.max(1, Math.min(limit, items.length));
    let nextIndex = 0;
    let hasError = false;
    let firstError: unknown;

    const runNext = async (): Promise<void> => {
        while (!hasError) {
            const currentIndex = nextIndex++;
            if (currentIndex >= items.length) {
                return;
            }
            try {
                await worker(items[currentIndex]);
            } catch (error) {
                if (!hasError) {
                    hasError = true;
                    firstError = error;
                }
                return;
            }
        }
    };

    await Promise.all(Array.from({ length: effectiveLimit }, () => runNext()));

    if (hasError) {
        throw firstError;
    }
}

