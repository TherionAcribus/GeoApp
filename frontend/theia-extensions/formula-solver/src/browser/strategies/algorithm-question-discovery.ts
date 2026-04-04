import { injectable, inject } from '@theia/core/shared/inversify';
import { FormulaSolverService } from '../formula-solver-service';
import { QuestionDiscoveryStrategy } from './question-discovery-strategy';
import { QuestionDiscoveryContext, QuestionDiscoveryResult } from './types';
import { extractVariablesFromFormula } from '../utils/formula-variables';

@injectable()
export class AlgorithmQuestionDiscovery implements QuestionDiscoveryStrategy {
    @inject(FormulaSolverService)
    protected readonly formulaSolverService!: FormulaSolverService;

    async discover(context: QuestionDiscoveryContext): Promise<QuestionDiscoveryResult> {
        const letters = extractVariablesFromFormula(context.formula);
        const extracted = await this.formulaSolverService.extractQuestions({
            text: context.text,
            letters,
            method: 'regex'
        });

        const questionsByLetter = new Map<string, string>();
        for (const letter of letters) {
            questionsByLetter.set(letter, extracted.get(letter) || '');
        }

        return {
            questionsByLetter,
            meta: {
                source: 'algorithm',
                timestampMs: Date.now()
            }
        };
    }
}

