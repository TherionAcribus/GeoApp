import { FormulaDetectionContext, FormulaDetectionResult } from './types';

export interface FormulaDetectionStrategy {
    detect(context: FormulaDetectionContext): Promise<FormulaDetectionResult>;
}

