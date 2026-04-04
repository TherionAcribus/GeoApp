import { injectable, inject } from '@theia/core/shared/inversify';
import { FormulaSolverService } from '../formula-solver-service';
import { FormulaDetectionStrategy } from './formula-detection-strategy';
import { FormulaDetectionContext, FormulaDetectionResult } from './types';

@injectable()
export class AlgorithmFormulaDetector implements FormulaDetectionStrategy {
    @inject(FormulaSolverService)
    protected readonly formulaSolverService!: FormulaSolverService;

    async detect(context: FormulaDetectionContext): Promise<FormulaDetectionResult> {
        const formulas = await this.formulaSolverService.detectFormulas({
            text: context.text,
            geocache_id: context.geocacheId
        });

        return {
            formulas,
            meta: {
                source: 'algorithm',
                timestampMs: Date.now()
            }
        };
    }
}

