import { Formula } from '../../common/types';
import { FormulaSolverAiProfile } from '../geoapp-formula-solver-agents';
import type { PreparedAnsweringContext } from '../answering-context-cache';

export interface StepMeta {
    source: 'algorithm' | 'ai' | 'manual';
    profile?: FormulaSolverAiProfile;
    timestampMs: number;
}

export interface FormulaDetectionContext {
    text: string;
    geocacheId?: number;
    aiProfile?: FormulaSolverAiProfile;
}

export interface FormulaDetectionResult {
    formulas: Formula[];
    meta: StepMeta;
}

export interface QuestionDiscoveryContext {
    text: string;
    formula: Formula;
    aiProfile?: FormulaSolverAiProfile;
    userHint?: string;
}

export interface QuestionDiscoveryResult {
    questionsByLetter: Map<string, string>;
    meta: StepMeta;
}

export interface AnsweringContext {
    text: string;
    questionsByLetter: Map<string, string>;
    /**
     * Toutes les questions connues (même si on ne répond qu'à une lettre).
     * Sert à construire un contexte global + règles de format.
     */
    allQuestionsByLetter?: Map<string, string>;
    geocacheId?: number;
    geocacheTitle?: string;
    geocacheCode?: string;
    aiProfile?: FormulaSolverAiProfile;
    perQuestionProfile?: Map<string, FormulaSolverAiProfile>;
    webMaxResults?: number;
    webContext?: string;

    /**
     * Overrides UI (si l'utilisateur veut contrôler le contexte / consignes).
     */
    preparedContextOverride?: PreparedAnsweringContext;
    additionalInstructions?: string;
    perLetterExtraInfo?: Record<string, string>;
}

export interface AnsweringResult {
    answersByLetter: Map<string, string>;
    meta: StepMeta;
}

