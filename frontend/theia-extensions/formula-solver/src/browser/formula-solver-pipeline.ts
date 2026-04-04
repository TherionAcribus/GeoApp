import { injectable, inject } from '@theia/core/shared/inversify';
import { Formula } from '../common/types';
import { FormulaSolverAiProfile } from './geoapp-formula-solver-agents';
import { AnswersMode, FormulaDetectionMethod, QuestionsMethod } from './formula-solver-config';
import { AlgorithmFormulaDetector } from './strategies/algorithm-formula-detector';
import { AiFormulaDetector } from './strategies/ai-formula-detector';
import { AlgorithmQuestionDiscovery } from './strategies/algorithm-question-discovery';
import { AiQuestionDiscovery } from './strategies/ai-question-discovery';
import { NoneQuestionDiscovery } from './strategies/none-question-discovery';
import { AiBulkAnswering } from './strategies/ai-bulk-answering';
import { AiPerQuestionAnswering } from './strategies/ai-per-question-answering';
import { BackendWebSearchAnswering } from './strategies/backend-web-search-answering';
import { FormulaDetectionResult, QuestionDiscoveryResult, AnsweringResult } from './strategies/types';
import type { PreparedAnsweringContext } from './answering-context-cache';

export type AnswersEngine = 'ai' | 'backend-web-search';

export interface DetectFormulaParams {
    text: string;
    geocacheId?: number;
    method: FormulaDetectionMethod;
    aiProfile: FormulaSolverAiProfile;
}

export interface DiscoverQuestionsParams {
    text: string;
    formula: Formula;
    method: QuestionsMethod;
    aiProfile: FormulaSolverAiProfile;
    userHint?: string;
}

export interface AnswerQuestionsParams {
    text: string;
    questionsByLetter: Map<string, string>;
    allQuestionsByLetter?: Map<string, string>;
    geocacheId?: number;
    geocacheTitle?: string;
    geocacheCode?: string;
    preparedContextOverride?: PreparedAnsweringContext;
    additionalInstructions?: string;
    perLetterExtraInfo?: Record<string, string>;
    mode: AnswersMode;
    engine: AnswersEngine;
    aiProfile: FormulaSolverAiProfile;
    perQuestionProfile?: Map<string, FormulaSolverAiProfile>;
    webMaxResults?: number;
    webContext?: string;
}

@injectable()
export class FormulaSolverPipeline {
    @inject(AlgorithmFormulaDetector) protected readonly algorithmFormulaDetector!: AlgorithmFormulaDetector;
    @inject(AiFormulaDetector) protected readonly aiFormulaDetector!: AiFormulaDetector;

    @inject(NoneQuestionDiscovery) protected readonly noneQuestionDiscovery!: NoneQuestionDiscovery;
    @inject(AlgorithmQuestionDiscovery) protected readonly algorithmQuestionDiscovery!: AlgorithmQuestionDiscovery;
    @inject(AiQuestionDiscovery) protected readonly aiQuestionDiscovery!: AiQuestionDiscovery;

    @inject(AiBulkAnswering) protected readonly aiBulkAnswering!: AiBulkAnswering;
    @inject(AiPerQuestionAnswering) protected readonly aiPerQuestionAnswering!: AiPerQuestionAnswering;
    @inject(BackendWebSearchAnswering) protected readonly backendWebSearchAnswering!: BackendWebSearchAnswering;

    async detectFormula(params: DetectFormulaParams): Promise<FormulaDetectionResult> {
        switch (params.method) {
            case 'ai':
                return await this.aiFormulaDetector.detect({
                    text: params.text,
                    geocacheId: params.geocacheId,
                    aiProfile: params.aiProfile
                });
            case 'manual':
                return {
                    formulas: [],
                    meta: { source: 'manual', timestampMs: Date.now() }
                };
            case 'algorithm':
            default:
                return await this.algorithmFormulaDetector.detect({
                    text: params.text,
                    geocacheId: params.geocacheId
                });
        }
    }

    async discoverQuestions(params: DiscoverQuestionsParams): Promise<QuestionDiscoveryResult> {
        switch (params.method) {
            case 'none':
                return await this.noneQuestionDiscovery.discover({
                    text: params.text,
                    formula: params.formula
                });
            case 'ai':
                return await this.aiQuestionDiscovery.discover({
                    text: params.text,
                    formula: params.formula,
                    aiProfile: params.aiProfile,
                    userHint: params.userHint
                });
            case 'algorithm':
            default:
                return await this.algorithmQuestionDiscovery.discover({
                    text: params.text,
                    formula: params.formula
                });
        }
    }

    async answerQuestions(params: AnswerQuestionsParams): Promise<AnsweringResult> {
        if (params.mode === 'manual') {
            return {
                answersByLetter: new Map(),
                meta: { source: 'manual', timestampMs: Date.now() }
            };
        }

        if (params.engine === 'backend-web-search') {
            return await this.backendWebSearchAnswering.answer({
                text: params.text,
                questionsByLetter: params.questionsByLetter,
                allQuestionsByLetter: params.allQuestionsByLetter,
                geocacheId: params.geocacheId,
                geocacheTitle: params.geocacheTitle,
                geocacheCode: params.geocacheCode,
                webMaxResults: params.webMaxResults,
                webContext: params.webContext,
                preparedContextOverride: params.preparedContextOverride,
                additionalInstructions: params.additionalInstructions,
                perLetterExtraInfo: params.perLetterExtraInfo
            });
        }

        if (params.mode === 'ai-per-question') {
            return await this.aiPerQuestionAnswering.answer({
                text: params.text,
                questionsByLetter: params.questionsByLetter,
                allQuestionsByLetter: params.allQuestionsByLetter,
                geocacheId: params.geocacheId,
                geocacheTitle: params.geocacheTitle,
                geocacheCode: params.geocacheCode,
                aiProfile: params.aiProfile,
                perQuestionProfile: params.perQuestionProfile,
                preparedContextOverride: params.preparedContextOverride,
                additionalInstructions: params.additionalInstructions,
                perLetterExtraInfo: params.perLetterExtraInfo
            });
        }

        // ai-bulk par défaut
        return await this.aiBulkAnswering.answer({
            text: params.text,
            questionsByLetter: params.questionsByLetter,
            allQuestionsByLetter: params.allQuestionsByLetter,
            geocacheId: params.geocacheId,
            geocacheTitle: params.geocacheTitle,
            geocacheCode: params.geocacheCode,
            aiProfile: params.aiProfile,
            preparedContextOverride: params.preparedContextOverride,
            additionalInstructions: params.additionalInstructions,
            perLetterExtraInfo: params.perLetterExtraInfo
        });
    }
}

