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

        for (const [letter, question] of context.questionsByLetter.entries()) {
            if (!question) {
                answersByLetter.set(letter, '');
                continue;
            }

            const profile = context.perQuestionProfile?.get(letter) ?? defaultProfile;

            // Si le profil est "web", faire d'abord une recherche web puis passer les résultats au LLM
            if (profile === 'web') {
                const webResult = await this._answerWithWebSearch(letter, question, context, preparedContext);
                answersByLetter.set(letter, webResult.answer);
                detailsByLetter.set(letter, webResult.detail);
                continue;
            }

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
            answersByLetter.set(letter, result.answer);

            detailsByLetter.set(letter, {
                answer: result.answer,
                source: 'ai',
                profile,
                explanation: result.explanation || undefined,
                valueType: (result.valueType as ValueType) || undefined,
                timestampMs: Date.now()
            });
        }

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

