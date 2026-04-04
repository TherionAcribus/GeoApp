import { QuestionDiscoveryContext, QuestionDiscoveryResult } from './types';

export interface QuestionDiscoveryStrategy {
    discover(context: QuestionDiscoveryContext): Promise<QuestionDiscoveryResult>;
}

