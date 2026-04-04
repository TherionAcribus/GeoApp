import { injectable } from '@theia/core/shared/inversify';
import { QuestionDiscoveryStrategy } from './question-discovery-strategy';
import { QuestionDiscoveryContext, QuestionDiscoveryResult } from './types';
import { extractVariablesFromFormula } from '../utils/formula-variables';

@injectable()
export class NoneQuestionDiscovery implements QuestionDiscoveryStrategy {
    async discover(context: QuestionDiscoveryContext): Promise<QuestionDiscoveryResult> {
        const letters = extractVariablesFromFormula(context.formula);
        const questionsByLetter = new Map<string, string>(letters.map(letter => [letter, '']));
        return {
            questionsByLetter,
            meta: {
                source: 'manual',
                timestampMs: Date.now()
            }
        };
    }
}

