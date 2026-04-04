import { injectable, inject } from '@theia/core/shared/inversify';
import { FormulaSolverLLMService } from '../formula-solver-llm-service';
import { AnsweringContextCache } from '../answering-context-cache';
import { AnsweringStrategy } from './answering-strategy';
import { AnsweringContext, AnsweringResult } from './types';

@injectable()
export class AiPerQuestionAnswering implements AnsweringStrategy {
    @inject(FormulaSolverLLMService)
    protected readonly llmService!: FormulaSolverLLMService;

    @inject(AnsweringContextCache)
    protected readonly answeringContextCache!: AnsweringContextCache;

    async answer(context: AnsweringContext): Promise<AnsweringResult> {
        const defaultProfile = context.aiProfile ?? 'fast';
        const answersByLetter = new Map<string, string>();

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
            const extraUserInfo = [
                (context.additionalInstructions || '').trim(),
                (context.perLetterExtraInfo?.[letter] || '').trim()
            ].filter(Boolean).join('\n\n');
            const answer = await this.llmService.answerSingleQuestionWithContext({
                letter,
                question,
                geocacheTitle: context.geocacheTitle,
                geocacheCode: context.geocacheCode,
                context: preparedContext,
                extraUserInfo
            }, profile);
            answersByLetter.set(letter, answer);
        }

        return {
            answersByLetter,
            meta: {
                source: 'ai',
                profile: defaultProfile,
                timestampMs: Date.now()
            }
        };
    }
}

