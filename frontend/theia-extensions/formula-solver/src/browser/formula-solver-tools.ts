/**
 * Tool Functions pour l'Agent Formula Solver
 * Expose les fonctionnalités du Formula Solver comme tools utilisables par l'agent IA
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { MessageService } from '@theia/core';
import {
    ToolInvocationRegistry,
    ToolRequest,
    ToolRequestParameters,
    ToolRequestParametersProperties,
    ToolCallResult
} from '@theia/ai-core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import axios, { AxiosInstance } from 'axios';
import { PreferenceService, PreferenceChange } from '@theia/core/lib/common/preferences/preference-service';

/**
 * Gestionnaire des Tool Functions Formula Solver
 */
@injectable()
export class FormulaSolverToolsManager implements FrontendApplicationContribution {

    static readonly PROVIDER_NAME = 'formula-solver';

    @inject(ToolInvocationRegistry)
    protected readonly toolRegistry!: ToolInvocationRegistry;

    @inject(MessageService)
    protected readonly messages!: MessageService;

    private apiClient: AxiosInstance;
    private baseUrl: string;

    constructor() {
        // NOTE: les injections @inject ne sont pas disponibles dans le constructor.
        // L'initialisation se fait dans onStart().
        this.baseUrl = 'http://localhost:8000';
        this.apiClient = axios.create({ baseURL: `${this.baseUrl}/api/formula-solver` });
    }

    async onStart(): Promise<void> {
        // Initialiser le client HTTP avec l'URL backend issue des préférences.
        const initialUrl = String(this.preferenceService.get('geoApp.backend.apiBaseUrl', 'http://localhost:8000') || 'http://localhost:8000');
        this.updateBaseUrl(initialUrl);

        this.preferenceService.onPreferenceChanged((event: PreferenceChange) => {
            if (event.preferenceName === 'geoApp.backend.apiBaseUrl') {
                this.updateBaseUrl(String(event.newValue || 'http://localhost:8000'));
            }
        });

        console.log('[FORMULA-SOLVER-TOOLS] Enregistrement des tools IA...');
        await this.registerTools();
        console.log('[FORMULA-SOLVER-TOOLS] Tools IA enregistrés avec succès');
    }

    /**
     * Enregistre tous les tools Formula Solver
     */
    private async registerTools(): Promise<void> {
        const tools: ToolRequest[] = [
            this.createDetectFormulaTool(),
            this.createFindQuestionsTool(),
            this.createSearchAnswerTool(),
            this.createCalculateValueTool(),
            this.createCalculateCoordinatesTool()
        ];

        for (const tool of tools) {
            try {
                await this.toolRegistry.registerTool(tool);
                console.log(`[FORMULA-SOLVER-TOOLS] Tool enregistré: ${tool.name}`);
            } catch (error) {
                console.error(`[FORMULA-SOLVER-TOOLS] Erreur enregistrement tool ${tool.name}:`, error);
            }
        }
    }

    /**
     * Tool 1: Détection de formule GPS
     */
    private createDetectFormulaTool(): ToolRequest {
        return {
            id: 'formula-solver.detect-formula',
            name: 'detect_formula',
            description: 'Détecte une formule de coordonnées GPS dans un texte de géocache Mystery. Retourne les formules trouvées avec leurs variables.',
            providerName: FormulaSolverToolsManager.PROVIDER_NAME,
            parameters: this.buildParameters({
                text: {
                    type: 'string',
                    description: 'Texte complet de la géocache contenant la formule',
                    required: true
                },
                geocache_id: {
                    type: 'number',
                    description: 'ID optionnel de la géocache pour utiliser sa description',
                    required: false
                }
            }),
            handler: async (argString: string) => this.handleDetectFormula(argString)
        };
    }

    /**
     * Tool 2: Recherche de questions pour variables
     */
    private createFindQuestionsTool(): ToolRequest {
        return {
            id: 'formula-solver.find-questions',
            name: 'find_questions_for_variables',
            description: 'Trouve les questions associées à chaque variable (lettre) d\'une formule. Exemple: A = "Nombre de fenêtres"',
            providerName: FormulaSolverToolsManager.PROVIDER_NAME,
            parameters: this.buildParameters({
                text: {
                    type: 'string',
                    description: 'Texte contenant les questions',
                    required: true
                },
                variables: {
                    type: 'array',
                    description: 'Liste des variables (lettres) à chercher, ex: ["A", "B", "C"]',
                    required: true
                }
            }),
            handler: async (argString: string) => this.handleFindQuestions(argString)
        };
    }

    /**
     * Tool 3: Recherche de réponse sur Internet
     */
    private createSearchAnswerTool(): ToolRequest {
        return {
            id: 'formula-solver.search-answer',
            name: 'search_answer_online',
            description: 'Recherche la réponse à une question sur Internet via DuckDuckGo. Utile pour trouver des informations factuelles.',
            providerName: FormulaSolverToolsManager.PROVIDER_NAME,
            parameters: this.buildParameters({
                question: {
                    type: 'string',
                    description: 'La question à rechercher',
                    required: true
                },
                context: {
                    type: 'string',
                    description: 'Contexte optionnel pour affiner la recherche',
                    required: false
                }
            }),
            handler: async (argString: string) => this.handleSearchAnswer(argString)
        };
    }

    /**
     * Tool 4: Calcul de valeur numérique
     */
    private createCalculateValueTool(): ToolRequest {
        return {
            id: 'formula-solver.calculate-value',
            name: 'calculate_variable_value',
            description: 'Calcule la valeur numérique d\'une variable à partir d\'une réponse. Types: value (nombre direct), checksum (somme des chiffres), reduced_checksum (checksum à 1 chiffre), length (longueur sans espaces)',
            providerName: FormulaSolverToolsManager.PROVIDER_NAME,
            parameters: this.buildParameters({
                answer: {
                    type: 'string',
                    description: 'La réponse textuelle à convertir en nombre',
                    required: true
                },
                type: {
                    type: 'string',
                    description: 'Type de calcul: "value", "checksum", "reduced_checksum", ou "length"',
                    required: true
                }
            }),
            handler: async (argString: string) => this.handleCalculateValue(argString)
        };
    }

    /**
     * Tool 5: Calcul des coordonnées finales
     */
    private createCalculateCoordinatesTool(): ToolRequest {
        return {
            id: 'formula-solver.calculate-coordinates',
            name: 'calculate_final_coordinates',
            description: 'Calcule les coordonnées GPS finales à partir de la formule et des valeurs des variables.',
            providerName: FormulaSolverToolsManager.PROVIDER_NAME,
            parameters: this.buildParameters({
                north_formula: {
                    type: 'string',
                    description: 'Formule Nord, ex: "N 47° 5A.BC"',
                    required: true
                },
                east_formula: {
                    type: 'string',
                    description: 'Formule Est, ex: "E 006° 5D.EF"',
                    required: true
                },
                values: {
                    type: 'array',
                    description: 'Liste de paires variable/valeur, ex: [{"name":"A","value":3},{"name":"B","value":5}].',
                    required: true,
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            name: {
                                type: 'string',
                                description: 'Nom de la variable, ex: A.'
                            },
                            value: {
                                type: 'number',
                                description: 'Valeur numerique de la variable.'
                            }
                        },
                        required: ['name', 'value']
                    }
                }
            }),
            handler: async (argString: string) => this.handleCalculateCoordinates(argString)
        };
    }

    // ========================================================================
    // HANDLERS
    // ========================================================================

    private async handleDetectFormula(argString: string): Promise<ToolCallResult> {
        try {
            const args = JSON.parse(argString);
            console.log('[FORMULA-SOLVER-TOOLS] detect_formula appelé:', args);

            const response = await this.apiClient.post('/ai/detect-formula', {
                text: args.text,
                geocache_id: args.geocache_id
            });

            const data = response.data;
            
            if (data.status === 'error') {
                return { error: data.error };
            }

            return {
                content: JSON.stringify({
                    formulas: data.formulas,
                    context: data.context
                }, null, 2)
            };
        } catch (error: any) {
            console.error('[FORMULA-SOLVER-TOOLS] Erreur detect_formula:', error);
            return { error: error.message || 'Erreur lors de la détection de formule' };
        }
    }

    private async handleFindQuestions(argString: string): Promise<ToolCallResult> {
        try {
            const args = JSON.parse(argString);
            console.log('[FORMULA-SOLVER-TOOLS] find_questions appelé:', args);

            const response = await this.apiClient.post('/ai/find-questions', {
                text: args.text,
                variables: args.variables
            });

            const data = response.data;
            
            if (data.status === 'error') {
                return { error: data.error };
            }

            return {
                content: JSON.stringify({
                    questions: data.questions,
                    found_count: data.found_count,
                    missing: data.missing
                }, null, 2)
            };
        } catch (error: any) {
            console.error('[FORMULA-SOLVER-TOOLS] Erreur find_questions:', error);
            return { error: error.message || 'Erreur lors de la recherche de questions' };
        }
    }

    private async handleSearchAnswer(argString: string): Promise<ToolCallResult> {
        try {
            const args = JSON.parse(argString);
            console.log('[FORMULA-SOLVER-TOOLS] search_answer appelé:', args);

            const response = await this.apiClient.post('/ai/search-answer', {
                question: args.question,
                context: args.context
            });

            const data = response.data;
            
            if (data.status === 'error') {
                return { error: data.error };
            }

            return {
                content: JSON.stringify({
                    results: data.results,
                    best_answer: data.best_answer
                }, null, 2)
            };
        } catch (error: any) {
            console.error('[FORMULA-SOLVER-TOOLS] Erreur search_answer:', error);
            return { error: error.message || 'Erreur lors de la recherche web' };
        }
    }

    private async handleCalculateValue(argString: string): Promise<ToolCallResult> {
        try {
            const args = JSON.parse(argString);
            console.log('[FORMULA-SOLVER-TOOLS] calculate_value appelé:', args);

            const answer = args.answer;
            const type = args.type;

            let result: number;

            switch (type) {
                case 'value':
                    result = parseInt(answer, 10);
                    if (isNaN(result)) {
                        return { error: `Impossible de convertir "${answer}" en nombre` };
                    }
                    break;
                
                case 'checksum':
                    result = this.calculateChecksum(answer);
                    break;
                
                case 'reduced_checksum':
                    result = this.calculateReducedChecksum(answer);
                    break;
                
                case 'length':
                    result = answer.replace(/\s/g, '').length;
                    break;
                
                default:
                    return { error: `Type de calcul inconnu: ${type}` };
            }

            return {
                content: JSON.stringify({
                    answer: answer,
                    type: type,
                    result: result
                }, null, 2)
            };
        } catch (error: any) {
            console.error('[FORMULA-SOLVER-TOOLS] Erreur calculate_value:', error);
            return { error: error.message || 'Erreur lors du calcul de valeur' };
        }
    }

    private async handleCalculateCoordinates(argString: string): Promise<ToolCallResult> {
        try {
            const args = JSON.parse(argString);
            console.log('[FORMULA-SOLVER-TOOLS] calculate_coordinates appelé:', args);

            const values = this.toNamedNumberRecord(args.values);
            if (!values) {
                return { error: 'Le champ values est requis et doit contenir des paires variable/valeur valides.' };
            }

            const response = await this.apiClient.post('/calculate', {
                north_formula: args.north_formula,
                east_formula: args.east_formula,
                values
            });

            const data = response.data;
            
            if (data.status === 'error') {
                return { error: data.error };
            }

            return {
                content: JSON.stringify({
                    coordinates: data.coordinates,
                    distance: data.distance,
                    calculation_steps: data.calculation_steps
                }, null, 2)
            };
        } catch (error: any) {
            console.error('[FORMULA-SOLVER-TOOLS] Erreur calculate_coordinates:', error);
            return { error: error.message || 'Erreur lors du calcul de coordonnées' };
        }
    }

    // ========================================================================
    // HELPERS
    // ========================================================================

    private buildParameters(props: Record<string, any>): ToolRequestParameters {
        const properties: ToolRequestParametersProperties = {};
        const required: string[] = [];

        for (const [key, value] of Object.entries(props)) {
            properties[key] = this.normalizeProperty(value);
            
            if (value.required) {
                required.push(key);
            }
        }

        return {
            type: 'object',
            properties,
            required,
            additionalProperties: false
        } as ToolRequestParameters;
    }

    private normalizeProperty(value: Record<string, any>): Record<string, any> {
        const property: Record<string, any> = { ...value };
        delete property.required;

        if (property.properties && typeof property.properties === 'object') {
            const nestedProperties: Record<string, any> = {};
            for (const [key, nestedValue] of Object.entries(property.properties)) {
                nestedProperties[key] = this.normalizeProperty(nestedValue as Record<string, any>);
            }
            property.properties = nestedProperties;
        }

        if (property.items && typeof property.items === 'object') {
            property.items = this.normalizeProperty(property.items);
        }

        if (property.type === 'object' && property.additionalProperties === undefined) {
            property.additionalProperties = false;
        }

        return property;
    }

    private toNamedNumberRecord(value: unknown): Record<string, number> | undefined {
        if (!value || typeof value !== 'object') {
            return undefined;
        }

        if (Array.isArray(value)) {
            const entries = value
                .map(item => {
                    if (!item || typeof item !== 'object') {
                        return undefined;
                    }
                    const record = item as Record<string, unknown>;
                    const name = typeof record.name === 'string' ? record.name.trim() : '';
                    const rawValue = record.value;
                    const numericValue = typeof rawValue === 'number'
                        ? rawValue
                        : (typeof rawValue === 'string' && rawValue.trim() ? Number(rawValue) : NaN);
                    if (!name || Number.isNaN(numericValue)) {
                        return undefined;
                    }
                    return [name, numericValue] as const;
                })
                .filter((entry): entry is readonly [string, number] => Boolean(entry));

            return entries.length > 0 ? Object.fromEntries(entries) : undefined;
        }

        const entries = Object.entries(value as Record<string, unknown>)
            .map(([key, rawValue]) => {
                const numericValue = typeof rawValue === 'number'
                    ? rawValue
                    : (typeof rawValue === 'string' && rawValue.trim() ? Number(rawValue) : NaN);
                if (!key.trim() || Number.isNaN(numericValue)) {
                    return undefined;
                }
                return [key, numericValue] as const;
            })
            .filter((entry): entry is readonly [string, number] => Boolean(entry));

        return entries.length > 0 ? Object.fromEntries(entries) : undefined;
    }

    private calculateChecksum(value: string | number): number {
        const str = value.toString().replace(/\D/g, '');
        return str.split('').reduce((sum, digit) => sum + parseInt(digit, 10), 0);
    }

    private calculateReducedChecksum(value: string | number): number {
        let result = this.calculateChecksum(value);
        while (result >= 10) {
            result = this.calculateChecksum(result);
        }
        return result;
    }

    @inject(PreferenceService)
    protected readonly preferenceService!: PreferenceService;

    private updateBaseUrl(url: string): void {
        const normalized = this.normalizeBaseUrl(url);
        if (normalized === this.baseUrl) {
            return;
        }
        this.baseUrl = normalized;
        this.apiClient = axios.create({
            baseURL: `${this.baseUrl}/api/formula-solver`,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json'
            }
        });
        console.info('[FORMULA-SOLVER-TOOLS] URL backend mise à jour:', this.baseUrl);
    }

    private normalizeBaseUrl(url: string): string {
        const trimmed = (url || '').trim();
        if (!trimmed) {
            return 'http://localhost:8000';
        }
        return trimmed.replace(/\/+$/, '');
    }
}

