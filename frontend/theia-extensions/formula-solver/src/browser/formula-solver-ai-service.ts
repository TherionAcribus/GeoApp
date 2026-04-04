/**
 * Service d'interaction avec l'Agent Formula Solver
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { MessageService } from '@theia/core';
import { FormulaSolverLLMService } from './formula-solver-llm-service';
import { Formula } from '../common/types';
import { ensureFormulaFragments } from './utils/formula-fragments';
import { FormulaSolverAiProfile } from './geoapp-formula-solver-agents';

export const FormulaSolverAIService = Symbol('FormulaSolverAIService');

export interface AIResolutionResult {
    status: 'success' | 'error' | 'partial';
    formulas?: Formula[];
    questions?: Map<string, string>;
    answers?: Map<string, string>;
    values?: Map<string, number>;
    coordinates?: {
        latitude: number;
        longitude: number;
        ddm: string;
        dms: string;
        decimal: string;
    };
    steps?: string[];
    error?: string;
    conversation_id?: string;
}

/**
 * Service pour interagir avec l'Agent Formula Solver
 */
export interface FormulaSolverAIService {
    /**
     * Résout une formule de géocache avec l'IA
     */
    solveWithAI(text: string, geocacheId?: number, profile?: FormulaSolverAiProfile): Promise<AIResolutionResult>;
    
    /**
     * Vérifie si l'IA est disponible
     */
    isAIAvailable(): Promise<boolean>;
}

@injectable()
export class FormulaSolverAIServiceImpl implements FormulaSolverAIService {

    @inject(MessageService)
    protected readonly messageService!: MessageService;

    @inject(FormulaSolverLLMService)
    protected readonly llmService!: FormulaSolverLLMService;

    constructor() {
        console.log('[FORMULA-SOLVER-AI] Service AI initialisé avec LLM direct');
    }

    /**
     * Résout une formule avec l'IA via l'Agent Formula Solver
     */
    async solveWithAI(text: string, geocacheId?: number, profile: FormulaSolverAiProfile = 'fast'): Promise<AIResolutionResult> {
        console.log('[FORMULA-SOLVER-AI] 🚀 DÉMARRAGE RÉSOLUTION IA AVEC AGENT');
        console.log('[FORMULA-SOLVER-AI] 📝 Texte à analyser:', text.substring(0, 100) + (text.length > 100 ? '...' : ''));

        // Pas besoin de vérifier l'agent, on utilise le LLM directement

        const result: AIResolutionResult = {
            status: 'partial',
            steps: []
        };

        try {
            // Étape 1: Détection de la formule avec IA
            console.log('[FORMULA-SOLVER-AI] 🔍 ÉTAPE 1: Détection de formule');
            result.steps!.push('🔍 Détection de la formule avec IA...');

            const formulas = await this.llmService.detectFormulasWithAI(text, profile);
            if (formulas && formulas.length > 0) {
                result.formulas = formulas;
                const formulaStr = `${formulas[0].north} ${formulas[0].east}`;
                console.log('[FORMULA-SOLVER-AI] ✅ Formule IA trouvée:', formulaStr);
                result.steps!.push(`✅ Formule IA: ${formulaStr}`);
            } else {
                console.log('[FORMULA-SOLVER-AI] ❌ Aucune formule IA détectée');
                result.steps!.push('❌ Aucune formule détectée par IA');
                return result;
            }

            // Étape 2: Extraction des variables et questions
            console.log('[FORMULA-SOLVER-AI] ❓ ÉTAPE 2: Extraction questions');
            result.steps!.push('❓ Extraction des questions avec IA...');

            const formula = result.formulas![0];
            const variables = this.extractVariablesFromFormula(formula);
            console.log('[FORMULA-SOLVER-AI] 🔤 Variables trouvées:', variables);

            if (variables.length > 0) {
                const questions = await this.llmService.extractQuestionsWithAI(text, variables, profile);
                if (questions) {
                    result.questions = new Map(Object.entries(questions));
                    const foundCount = Array.from(result.questions.values()).filter(q => q).length;
                    console.log(`[FORMULA-SOLVER-AI] ✅ Questions IA: ${foundCount}/${variables.length}`);
                    result.steps!.push(`✅ ${foundCount}/${variables.length} questions trouvées par IA`);
                }
            }

            // Étape 3: Recherche des réponses
            if (result.questions && result.questions.size > 0) {
                console.log('[FORMULA-SOLVER-AI] 🔍 ÉTAPE 3: Recherche réponses');
                result.steps!.push('🔍 Recherche des réponses avec IA...');

                const questionsObj: { [key: string]: string } = {};
                result.questions.forEach((value, key) => {
                    questionsObj[key] = value;
                });

                const answers = await this.llmService.searchAnswersWithAI(questionsObj, text.substring(0, 200), profile);
                if (answers) {
                    result.answers = new Map(Object.entries(answers));
                    console.log('[FORMULA-SOLVER-AI] ✅ Réponses IA trouvées:', Array.from(result.answers.entries()));
                    result.steps!.push(`✅ ${result.answers.size} réponses trouvées par IA`);
                }
            }

            // Résolution IA terminée - les calculs sont faits par l'algorithme
            console.log('[FORMULA-SOLVER-AI] ✅ RÉSOLUTION IA TERMINÉE - Calculs à faire avec l\'algorithme');
            result.steps!.push('✅ Résolution IA terminée - Utilisez l\'algorithme pour les calculs');
            result.status = 'success';

            console.log('[FORMULA-SOLVER-AI] ✅ RÉSOLUTION IA TERMINÉE');
            return result;

        } catch (error: any) {
            const message = error instanceof Error ? error.message : 'Erreur inconnue';
            console.error('[FORMULA-SOLVER-AI] Erreur résolution IA:', error);
            return {
                status: 'error',
                error: message,
                steps: ['Erreur lors de la résolution IA']
            };
        }
    }

    /**
     * Vérifie si l'IA est disponible (Language Model Service)
     */
    async isAIAvailable(): Promise<boolean> {
        try {
            // Tester si on peut accéder au service LLM
            const available = !!this.llmService;
            console.log('[FORMULA-SOLVER-AI] Service LLM disponible:', available);
            return available;
        } catch (error) {
            console.error('[FORMULA-SOLVER-AI] Erreur vérification LLM:', error);
            return false;
        }
    }

    // ========================================================================
    // MÉTHODES PRIVÉES - UTILITAIRES
    // ========================================================================

    /**
     * Extrait les variables (lettres) d'une formule
     */
    private extractVariablesFromFormula(formula: Formula): string[] {
        ensureFormulaFragments(formula);

        const variables = new Set<string>();
        const fragments = formula.fragments;

        if (fragments) {
            const collect = (part: { variables: string[] }) => {
                part.variables.forEach(letter => variables.add(letter));
            };

            [fragments.north, fragments.east].forEach(axis => {
                collect(axis.degrees);
                collect(axis.minutes);
                axis.decimals.forEach(collect);
            });

            return Array.from(variables).sort();
        }

        // Fallback ultra simple si le découpage échoue
        const formulaText = `${formula.north} ${formula.east}`;
        const allLetters = formulaText.match(/[A-Z]/g) || [];
        const cardinalPoints = new Set(['N', 'S', 'E', 'W', 'O']);

        allLetters.forEach(letter => {
            const upper = letter.toUpperCase();
            if (cardinalPoints.has(upper)) {
                const letterIndex = formulaText.indexOf(letter);
                const beforeLetter = formulaText.substring(0, letterIndex);
                const afterLetter = formulaText.substring(letterIndex + 1);

                if ((beforeLetter.match(/\s*$/) || beforeLetter.length === 0) && afterLetter.match(/^\d/)) {
                    return;
                }
            }
            variables.add(letter.toUpperCase());
        });

        return Array.from(variables).sort();
    }
}