import { injectable, inject } from '@theia/core/shared/inversify';
import { FormulaSolverLLMService } from '../formula-solver-llm-service';
import { FormulaDetectionStrategy } from './formula-detection-strategy';
import { FormulaDetectionContext, FormulaDetectionResult } from './types';

@injectable()
export class AiFormulaDetector implements FormulaDetectionStrategy {
    @inject(FormulaSolverLLMService)
    protected readonly llmService!: FormulaSolverLLMService;

    async detect(context: FormulaDetectionContext): Promise<FormulaDetectionResult> {
        const profile = context.aiProfile ?? 'fast';
        const formulas = await this.llmService.detectFormulasWithAI(context.text, profile);
        return {
            formulas,
            meta: {
                source: 'ai',
                profile,
                timestampMs: Date.now()
            }
        };
    }
}

