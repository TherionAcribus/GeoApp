import { injectable, inject } from '@theia/core/shared/inversify';
import { FormulaSolverService } from '../formula-solver-service';
import { AnsweringStrategy } from './answering-strategy';
import { AnsweringContext, AnsweringResult } from './types';

@injectable()
export class BackendWebSearchAnswering implements AnsweringStrategy {
    @inject(FormulaSolverService)
    protected readonly formulaSolverService!: FormulaSolverService;

    async answer(context: AnsweringContext): Promise<AnsweringResult> {
        const maxResults = context.webMaxResults ?? 5;
        const webContext = context.webContext ?? context.text.substring(0, 200);

        const questionsObj: Record<string, string> = {};
        context.questionsByLetter.forEach((question, letter) => {
            questionsObj[letter] = question || '';
        });

        const batch = await this.formulaSolverService.searchAnswersWebBatch({
            questions: questionsObj,
            context: webContext,
            maxResults
        });

        const answersByLetter = new Map<string, string>();
        Object.keys(questionsObj).forEach(letter => {
            const item = batch.get(letter);
            answersByLetter.set(letter, item?.bestAnswer || '');
        });

        return {
            answersByLetter,
            meta: {
                source: 'algorithm',
                timestampMs: Date.now()
            }
        };
    }
}

