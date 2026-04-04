import { AnsweringContext, AnsweringResult } from './types';

export interface AnsweringStrategy {
    answer(context: AnsweringContext): Promise<AnsweringResult>;
}

