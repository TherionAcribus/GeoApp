import { injectable, inject } from '@theia/core/shared/inversify';
import { FormulaSolverLLMService } from '../formula-solver-llm-service';
import { AnsweringContextCache } from '../answering-context-cache';
import { AnsweringStrategy } from './answering-strategy';
import { AnsweringContext, AnsweringResult, AnswerDetail } from './types';

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
        const detailsByLetter = new Map<string, AnswerDetail>();

        for (const letter of Object.keys(Object.fromEntries(Array.from(context.questionsByLetter.entries())))) {
            const answer = String((answersObj as any)?.[letter] || '');
            answersByLetter.set(letter, answer);
            const perLetterRule = preparedContext.per_letter_rules?.[letter] || '';
            const explanationParts = [
                preparedContext.geocache_summary ? `Résumé: ${preparedContext.geocache_summary}` : '',
                perLetterRule ? `Règle ${letter}: ${perLetterRule}` : ''
            ].filter(Boolean);
            detailsByLetter.set(letter, {
                answer,
                source: 'ai',
                profile,
                explanation: explanationParts.length > 0 ? explanationParts.join('\n') : undefined,
                timestampMs: Date.now()
            });
        }

        return {
            answersByLetter,
            detailsByLetter,
            meta: {
                source: 'ai',
                profile,
                timestampMs: Date.now()
            }
        };
    }
}

