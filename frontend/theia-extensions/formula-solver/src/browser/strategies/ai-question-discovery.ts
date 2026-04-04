import { injectable, inject } from '@theia/core/shared/inversify';
import { FormulaSolverLLMService } from '../formula-solver-llm-service';
import { QuestionDiscoveryStrategy } from './question-discovery-strategy';
import { QuestionDiscoveryContext, QuestionDiscoveryResult } from './types';
import { extractVariablesFromFormula } from '../utils/formula-variables';

@injectable()
export class AiQuestionDiscovery implements QuestionDiscoveryStrategy {
    @inject(FormulaSolverLLMService)
    protected readonly llmService!: FormulaSolverLLMService;

    async discover(context: QuestionDiscoveryContext): Promise<QuestionDiscoveryResult> {
        const profile = context.aiProfile ?? 'fast';
        const letters = extractVariablesFromFormula(context.formula);
        const questionsObj = await this.llmService.extractQuestionsWithAI(context.text, letters, profile, {
            userHint: context.userHint
        });

        const questionsByLetter = new Map<string, string>();
        for (const letter of letters) {
            const raw = String((questionsObj as any)?.[letter] || '').trim();
            const suspiciousNumberOnly = /^\d+$/.test(raw);

            // Heuristique: si l'IA renvoie juste "1", "2", ... tenter de récupérer
            // une consigne du type "A = ..." directement depuis le texte.
            let resolved = raw;
            if (!resolved || suspiciousNumberOnly) {
                const assignment = extractAssignmentLine(context.text, letter);
                if (assignment) {
                    resolved = assignment;
                } else if (suspiciousNumberOnly) {
                    const numbered = extractNumberedItemLine(context.text, raw);
                    if (numbered) {
                        resolved = numbered;
                    } else {
                        // On préfère vide plutôt qu'un numéro
                        resolved = '';
                    }
                }
            }

            questionsByLetter.set(letter, resolved);
        }

        return {
            questionsByLetter,
            meta: {
                source: 'ai',
                profile,
                timestampMs: Date.now()
            }
        };
    }
}

function extractAssignmentLine(text: string, letter: string): string | undefined {
    const re = new RegExp(`^\\s*${escapeRegex(letter)}\\s*=\\s*([^\\n\\r]+)`, 'gmi');
    const match = re.exec(text);
    if (!match) {
        return undefined;
    }
    return match[1].trim();
}

function extractNumberedItemLine(text: string, numberStr: string): string | undefined {
    const n = escapeRegex(numberStr);
    const re = new RegExp(`^\\s*${n}\\s*[\\/\\.)\\-–—:]\\s*([^\\n\\r]+)`, 'gmi');
    const match = re.exec(text);
    if (!match) {
        return undefined;
    }
    return match[1].trim();
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
}

