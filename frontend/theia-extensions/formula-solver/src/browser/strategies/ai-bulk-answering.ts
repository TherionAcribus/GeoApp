import { injectable, inject } from '@theia/core/shared/inversify';
import { FormulaSolverLLMService } from '../formula-solver-llm-service';
import { AnsweringContextCache } from '../answering-context-cache';
import { AnsweringStrategy } from './answering-strategy';
import { AnsweringContext, AnsweringResult } from './types';

@injectable()
export class AiBulkAnswering implements AnsweringStrategy {
    @inject(FormulaSolverLLMService)
    protected readonly llmService!: FormulaSolverLLMService;

    @inject(AnsweringContextCache)
    protected readonly answeringContextCache!: AnsweringContextCache;

    async answer(context: AnsweringContext): Promise<AnsweringResult> {
        const profile = context.aiProfile ?? 'fast';

        const allQuestions = context.allQuestionsByLetter ?? context.questionsByLetter;
        const questionsObj: Record<string, string> = {};
        allQuestions.forEach((question, letter) => {
            questionsObj[letter] = question || '';
        });

        const preparedContext = context.preparedContextOverride ?? await this.answeringContextCache.getOrBuild({
            geocacheId: context.geocacheId,
            geocacheTitle: context.geocacheTitle,
            geocacheCode: context.geocacheCode,
            text: context.text,
            questionsByLetter: questionsObj,
            targetLetters: Array.from(context.questionsByLetter.keys()),
            profile
        });

        // Pour le mode bulk, on peut rester sur searchAnswersWithAI mais avec un "contexte" enrichi
        const extra = (context.additionalInstructions || '').trim();
        const extraBlock = extra ? `\n\nInfos complémentaires (utilisateur):\n${extra}` : '';

        const perLetterExtra = context.perLetterExtraInfo
            ? Object.entries(context.perLetterExtraInfo)
                .filter(([, v]) => (v || '').trim())
                .map(([k, v]) => `${k}: ${String(v).trim()}`)
                .join('\n')
            : '';
        const perLetterExtraBlock = perLetterExtra ? `\n\nInfos par lettre (utilisateur):\n${perLetterExtra}` : '';

        const enrichedContext = [
            preparedContext.geocache_summary ? `Résumé: ${preparedContext.geocache_summary}` : '',
            preparedContext.global_rules?.length ? `Règles:\n- ${preparedContext.global_rules.join('\n- ')}` : ''
        ].filter(Boolean).join('\n\n') + extraBlock + perLetterExtraBlock;

        const answersObj = await this.llmService.searchAnswersWithAI(
            Object.fromEntries(Array.from(context.questionsByLetter.entries())),
            enrichedContext || context.text.substring(0, 500),
            profile
        );
        const answersByLetter = new Map<string, string>();

        for (const letter of Object.keys(Object.fromEntries(Array.from(context.questionsByLetter.entries())))) {
            answersByLetter.set(letter, String((answersObj as any)?.[letter] || ''));
        }

        return {
            answersByLetter,
            meta: {
                source: 'ai',
                profile,
                timestampMs: Date.now()
            }
        };
    }
}

