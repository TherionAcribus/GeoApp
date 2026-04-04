/**
 * Service frontend pour interagir avec l'API Formula Solver.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import axios, { AxiosInstance } from 'axios';
import { PreferenceService, PreferenceChange } from '@theia/core/lib/common/preferences/preference-service';
import { CalculationResult, Formula } from '../common/types';

export const FormulaSolverService = Symbol('FormulaSolverService');

export interface DetectFormulasParams {
    text?: string;
    geocache_id?: number;
}

export interface ExtractQuestionsParams {
    text?: string;
    geocache_id?: number;
    letters: string[];
    method?: 'regex' | 'ai';
}

export interface CalculateCoordinatesParams {
    northFormula: string;
    eastFormula: string;
    values: Record<string, number>;
    originLat?: number;
    originLon?: number;
}

export interface SearchAnswerWebParams {
    question: string;
    context?: string;
    maxResults?: number;
}

export interface SearchAnswerWebResult {
    bestAnswer?: string;
    results?: Array<{
        text?: string;
        source?: string;
        score?: number;
        type?: string;
    }>;
}

export interface SearchAnswersWebBatchParams {
    questions: Record<string, string>;
    context?: string;
    maxResults?: number;
}

export interface FormulaSolverGeocache {
    id: number;
    gc_code: string;
    name: string;
    description: string;
    latitude?: number;
    longitude?: number;
}

export interface FormulaSolverService {
    detectFormulas(params: DetectFormulasParams): Promise<Formula[]>;
    extractQuestions(params: ExtractQuestionsParams): Promise<Map<string, string>>;
    calculateCoordinates(params: CalculateCoordinatesParams): Promise<CalculationResult>;
    getGeocache(id: number): Promise<FormulaSolverGeocache>;
    searchAnswerWeb(params: SearchAnswerWebParams): Promise<SearchAnswerWebResult>;
    searchAnswersWebBatch(params: SearchAnswersWebBatchParams): Promise<Map<string, SearchAnswerWebResult>>;
    calculateChecksum(value: string | number): number;
    calculateReducedChecksum(value: string | number): number;
    calculateLength(value: string | number): number;
}

@injectable()
export class FormulaSolverServiceImpl implements FormulaSolverService {
    protected api: AxiosInstance;
    protected baseUrl: string;

    constructor(
        @inject(PreferenceService) private readonly preferenceService: PreferenceService
    ) {
        const initialUrl = String(this.preferenceService.get('geoApp.backend.apiBaseUrl', 'http://localhost:8000') || 'http://localhost:8000');
        this.baseUrl = this.normalizeBaseUrl(initialUrl);
        this.api = this.createClient(this.baseUrl);

        this.preferenceService.onPreferenceChanged((event: PreferenceChange) => {
            if (event.preferenceName === 'geoApp.backend.apiBaseUrl') {
                this.updateBaseUrl(String(event.newValue || 'http://localhost:8000'));
            }
        });
    }

    async detectFormulas(params: DetectFormulasParams): Promise<Formula[]> {
        const response = await this.api.post('/detect-formulas', params);
        return response.data?.formulas ?? [];
    }

    async extractQuestions(params: ExtractQuestionsParams): Promise<Map<string, string>> {
        const response = await this.api.post('/extract-questions', params);
        const questions = response.data?.questions ?? {};
        return new Map<string, string>(Object.entries(questions));
    }

    async calculateCoordinates(params: CalculateCoordinatesParams): Promise<CalculationResult> {
        const response = await this.api.post('/calculate', {
            north_formula: params.northFormula,
            east_formula: params.eastFormula,
            values: params.values,
            origin_lat: params.originLat,
            origin_lon: params.originLon
        });
        return response.data;
    }

    async getGeocache(id: number): Promise<FormulaSolverGeocache> {
        const response = await this.api.get(`/geocache/${id}`);
        return response.data?.geocache;
    }

    async searchAnswerWeb(params: SearchAnswerWebParams): Promise<SearchAnswerWebResult> {
        const response = await this.api.post('/ai/search-answer', {
            question: params.question,
            context: params.context,
            max_results: params.maxResults
        });

        return {
            bestAnswer: response.data?.best_answer,
            results: response.data?.results
        };
    }

    async searchAnswersWebBatch(params: SearchAnswersWebBatchParams): Promise<Map<string, SearchAnswerWebResult>> {
        try {
            const response = await this.api.post('/ai/search-answers', {
                questions: params.questions,
                context: params.context,
                max_results: params.maxResults
            });

            const raw = response.data?.answers ?? {};
            return new Map<string, SearchAnswerWebResult>(
                Object.entries(raw).map(([letter, value]: [string, any]) => ([
                    letter,
                    {
                        bestAnswer: value?.best_answer,
                        results: value?.results
                    }
                ]))
            );
        } catch (error) {
            // Fallback: exécuter question par question si l'endpoint batch n'est pas disponible.
            const entries = Object.entries(params.questions);
            const results = new Map<string, SearchAnswerWebResult>();
            for (const [letter, question] of entries) {
                if (!question) {
                    results.set(letter, { bestAnswer: '', results: [] });
                    continue;
                }
                const single = await this.searchAnswerWeb({
                    question,
                    context: params.context,
                    maxResults: params.maxResults
                });
                results.set(letter, single);
            }
            return results;
        }
    }

    calculateChecksum(value: string | number): number {
        const str = value.toString().toUpperCase();

        // Si la chaîne contient des lettres, convertir chaque lettre en sa position dans l'alphabet
        // et additionner. Sinon, utiliser seulement les chiffres présents.
        const hasLetters = /[A-Z]/.test(str);

        if (hasLetters) {
            // Convertir les lettres en positions (A=1, B=2, ..., Z=26)
            return str.split('').reduce((sum, char) => {
                const code = char.charCodeAt(0);
                if (code >= 65 && code <= 90) { // A-Z
                    return sum + (code - 64); // A=1, B=2, etc.
                } else if (code >= 48 && code <= 57) { // 0-9
                    return sum + parseInt(char, 10);
                }
                return sum; // Ignorer les autres caractères
            }, 0);
        } else {
            // Comportement original : seulement les chiffres
            const digitsOnly = str.replace(/\D/g, '');
            return digitsOnly.split('').reduce((sum, digit) => sum + parseInt(digit, 10), 0);
        }
    }

    calculateReducedChecksum(value: string | number): number {
        let result = this.calculateChecksum(value);
        while (result >= 10) {
            result = this.calculateChecksum(result);
        }
        return result;
    }

    calculateLength(value: string | number): number {
        return value.toString().replace(/\s+/g, '').length;
    }

    protected createClient(baseURL: string): AxiosInstance {
        return axios.create({
            baseURL: `${baseURL}/api/formula-solver`,
            timeout: 30000,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    protected updateBaseUrl(url: string): void {
        const normalized = this.normalizeBaseUrl(url);
        if (normalized === this.baseUrl) {
            return;
        }
        this.baseUrl = normalized;
        this.api = this.createClient(this.baseUrl);
        console.info('[FORMULA-SOLVER] URL backend mise à jour:', this.baseUrl);
    }

    protected normalizeBaseUrl(url: string): string {
        const trimmed = (url || '').trim();
        if (!trimmed) {
            return 'http://localhost:8000';
        }
        return trimmed.replace(/\/+$/, '');
    }
}
