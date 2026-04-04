import { FormulaSolverAiProfile } from './geoapp-formula-solver-agents';

export type FormulaDetectionMethod = 'algorithm' | 'ai' | 'manual';
export type QuestionsMethod = 'none' | 'algorithm' | 'ai';
export type AnswersMode = 'manual' | 'ai-bulk' | 'ai-per-question';

export interface FormulaSolverStepConfig {
    formulaDetectionMethod: FormulaDetectionMethod;
    questionsMethod: QuestionsMethod;
    answersMode: AnswersMode;

    /**
     * Profils IA par étape (utilisés quand la méthode/option fait appel à l'IA).
     */
    aiProfileForFormula: FormulaSolverAiProfile;
    aiProfileForQuestions: FormulaSolverAiProfile;
    aiProfileForAnswers: FormulaSolverAiProfile;
}

export interface WebSearchOptions {
    enabled: boolean;
    maxResults: number;
}

