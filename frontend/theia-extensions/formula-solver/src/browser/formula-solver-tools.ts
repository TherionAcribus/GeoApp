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
import { FormulaSolverService } from './formula-solver-service';

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

    @inject(FormulaSolverService)
    protected readonly formulaSolverService!: FormulaSolverService;

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
                this.updateBaseUrl(this.getBackendBaseUrl());
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
            this.createFetchUrlTool(),
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
            description: 'Recherche des informations sur Internet via DuckDuckGo. Utile pour resoudre les enigmes de connaissance (faits, listes, noms, dates). Renvoie des extraits (snippets) avec leur source. Pour lire le contenu complet d\'une page trouvee, enchaine avec ~fetch_url.',
            providerName: FormulaSolverToolsManager.PROVIDER_NAME,
            parameters: this.buildParameters({
                question: {
                    type: 'string',
                    description: 'La question ou les mots-cles a rechercher',
                    required: true
                },
                context: {
                    type: 'string',
                    description: 'Contexte optionnel pour affiner la recherche (ex: nom/lieu de la geocache). Si omis et geocache_id fourni, GeoApp ajoute le nom de la cache.',
                    required: false
                },
                mode: {
                    type: 'string',
                    description: 'auto = recherche optimisee pour une variable de formule (un fait court). research = garde la question quasi intacte, ideal pour les listes/connaissances ouvertes (ex: "9 lieux-dits"). Defaut: auto.',
                    enum: ['auto', 'research'],
                    required: false
                },
                max_results: {
                    type: 'number',
                    description: 'Nombre maximum de resultats (defaut 5).',
                    required: false
                },
                geocache_id: {
                    type: 'number',
                    description: 'Optionnel: id de la geocache pour enrichir automatiquement le contexte de recherche.',
                    required: false
                }
            }),
            handler: async (argString: string) => this.handleSearchAnswer(argString)
        };
    }

    /**
     * Tool: Lecture du contenu textuel d'une page web
     */
    private createFetchUrlTool(): ToolRequest {
        return {
            id: 'formula-solver.fetch-url',
            name: 'fetch_url',
            description: 'Lit le contenu textuel d\'une page web (http/https) et le renvoie nettoye. A utiliser apres ~search_answer_online pour ouvrir une source prometteuse et en extraire des informations precises (listes, noms, valeurs).',
            providerName: FormulaSolverToolsManager.PROVIDER_NAME,
            parameters: this.buildParameters({
                url: {
                    type: 'string',
                    description: 'URL complete de la page a lire (doit commencer par http:// ou https://).',
                    required: true
                },
                max_chars: {
                    type: 'number',
                    description: 'Longueur maximale du texte extrait (defaut 6000, max 20000).',
                    required: false
                }
            }),
            handler: async (argString: string) => this.handleFetchUrl(argString)
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

            return JSON.stringify({
                    formulas: data.formulas,
                    context: data.context
                }, null, 2);
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

            return JSON.stringify({
                    questions: data.questions,
                    found_count: data.found_count,
                    missing: data.missing
                }, null, 2);
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
                context: args.context,
                raw: args.mode === 'research',
                max_results: args.max_results,
                geocache_id: args.geocache_id
            });

            const data = response.data;
            
            if (data.status === 'error') {
                return { error: data.error };
            }

            return JSON.stringify({
                    results: data.results,
                    best_answer: data.best_answer
                }, null, 2);
        } catch (error: any) {
            console.error('[FORMULA-SOLVER-TOOLS] Erreur search_answer:', error);
            return { error: error.message || 'Erreur lors de la recherche web' };
        }
    }

    private async handleFetchUrl(argString: string): Promise<ToolCallResult> {
        try {
            const args = JSON.parse(argString);
            console.log('[FORMULA-SOLVER-TOOLS] fetch_url appelé:', args);

            const response = await this.apiClient.post('/ai/fetch-url', {
                url: args.url,
                max_chars: args.max_chars
            });

            const data = response.data;

            if (data.status === 'error') {
                return { error: data.error || 'Impossible de lire la page' };
            }

            return JSON.stringify({
                    url: data.url,
                    title: data.title,
                    text: data.text,
                    truncated: data.truncated
                }, null, 2);
        } catch (error: any) {
            console.error('[FORMULA-SOLVER-TOOLS] Erreur fetch_url:', error);
            return { error: error.message || 'Erreur lors de la lecture de la page web' };
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
                    // Délégué à FormulaSolverService : même algorithme que le champ
                    // "Checksum" du widget (lettres A=1..Z=26 + chiffres), pour que
                    // l'agent IA et la saisie manuelle produisent le même résultat.
                    result = this.formulaSolverService.calculateChecksum(answer);
                    break;

                case 'reduced_checksum':
                    result = this.formulaSolverService.calculateReducedChecksum(answer);
                    break;
                
                case 'length':
                    result = answer.replace(/\s/g, '').length;
                    break;
                
                default:
                    return { error: `Type de calcul inconnu: ${type}` };
            }

            return JSON.stringify({
                    answer: answer,
                    type: type,
                    result: result
                }, null, 2);
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

            return JSON.stringify({
                    coordinates: data.coordinates,
                    distance: data.distance,
                    calculation_steps: data.calculation_steps
                }, null, 2);
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

    private getBackendBaseUrl(): string {
        return String(this.preferenceService.get('geoApp.backend.apiBaseUrl', 'http://localhost:8000') || 'http://localhost:8000');
    }
}

