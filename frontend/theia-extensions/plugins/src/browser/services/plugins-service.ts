/**
 * Service de communication avec l'API backend pour les plugins.
 * 
 * Ce service encapsule toutes les requêtes HTTP vers le backend Flask
 * pour la gestion des plugins.
 */

import { Emitter } from '@theia/core';
import { injectable, inject, optional } from '@theia/core/shared/inversify';
import axios, { AxiosInstance } from 'axios';
import { PreferenceService, PreferenceChange } from '@theia/core/lib/common/preferences/preference-service';
import {
    Plugin,
    PluginDetails,
    PluginFilters,
    PluginInputs,
    PluginResult,
    PluginsStatus,
    PluginsService as IPluginsService,
    PuzzleStateDeleteResponse,
    PuzzleStateGetResponse,
    PuzzleStateListResponse,
    PuzzleStateSaveRequest,
    PuzzleStateSaveResponse,
    MetasolverEligiblePluginsResponse,
    MetasolverRecommendationRequest,
    MetasolverRecommendationResponse,
    ListingClassificationRequest,
    ListingClassificationResponse,
    ResolutionWorkflowRequest,
    ResolutionWorkflowResponse,
    ResolutionWorkflowStepRunRequest,
    ResolutionWorkflowStepRunResponse
} from '../../common/plugin-protocol';
import { GeoAppAiScorerModelResolver } from './ai-scorer-model-resolver';
import { GeoAppAiExecutionRecord, GeoAppAiOperationRecorder } from '../../common/ai-model-contract';

@injectable()
export class PluginsServiceImpl implements IPluginsService {
    
    private client: AxiosInstance;
    private baseUrl: string;
    private readonly aiExecutionEmitter = new Emitter<GeoAppAiExecutionRecord>();
    readonly onDidUpdateAiExecution = this.aiExecutionEmitter.event;

    private emitLatestAiExecution(taskId: string): void {
        const execution = this.getLatestAiExecution(taskId);
        if (execution) {
            this.aiExecutionEmitter.fire(execution);
        }
    }
    
    constructor(
        @inject(PreferenceService) private readonly preferenceService: PreferenceService,
        @inject(GeoAppAiScorerModelResolver) private readonly aiScorerModelResolver: GeoAppAiScorerModelResolver,
        @inject(GeoAppAiOperationRecorder) @optional() private readonly aiOperationRecorder?: GeoAppAiOperationRecorder,
    ) {
        const initialUrl = String(this.preferenceService.get('geoApp.backend.apiBaseUrl', 'http://localhost:8000') || 'http://localhost:8000');
        this.baseUrl = this.normalizeBaseUrl(initialUrl);
        this.client = this.createClient(this.baseUrl);

        this.preferenceService.onPreferenceChanged((event: PreferenceChange) => {
            if (event.preferenceName === 'geoApp.backend.apiBaseUrl') {
                this.updateBaseUrl(String(this.preferenceService.get('geoApp.backend.apiBaseUrl', 'http://localhost:8000') || 'http://localhost:8000'));
            }
        });
    }
    
    /**
     * Récupère la liste des plugins.
     */
    async listPlugins(filters?: PluginFilters): Promise<Plugin[]> {
        try {
            const params: Record<string, string> = {};
            
            if (filters?.source) {
                params.source = filters.source;
            }
            if (filters?.category) {
                params.category = filters.category;
            }
            if (filters?.enabled !== undefined) {
                params.enabled = filters.enabled.toString();
            }
            if (filters?.includeMetadata) {
                params.include_metadata = 'true';
            }

            const response = await this.client.get('/api/plugins', { params });
            
            // L'API retourne { plugins: Plugin[], total: number, filters: {} }
            const plugins: Plugin[] = response.data.plugins || [];
            
            // Ajouter la catégorie principale si elle existe
            return plugins.map(plugin => ({
                ...plugin,
                category: plugin.categories && plugin.categories.length > 0 
                    ? plugin.categories[0] 
                    : undefined
            }));
            
        } catch (error) {
            console.error('Erreur lors de la récupération des plugins:', error);
            const wrapped = new Error(`Impossible de récupérer les plugins: ${this.getErrorMessage(error)}`);
            // Conserve l'erreur axios d'origine pour permettre aux appelants de
            // distinguer un backend injoignable d'une erreur HTTP.
            (wrapped as Error & { cause?: unknown }).cause = error;
            throw wrapped;
        }
    }
    
    /**
     * Récupère les détails d'un plugin.
     */
    async getPlugin(name: string): Promise<PluginDetails> {
        try {
            const response = await this.client.get(`/api/plugins/${name}`);
            const plugin = response.data;
            
            // Ajouter la catégorie principale si elle existe
            if (plugin.categories && plugin.categories.length > 0 && !plugin.category) {
                plugin.category = plugin.categories[0];
            }
            
            return plugin;
            
        } catch (error) {
            console.error(`Erreur lors de la récupération du plugin ${name}:`, error);
            throw new Error(`Plugin ${name} introuvable: ${this.getErrorMessage(error)}`);
        }
    }
    
    /**
     * Exécute un plugin de manière synchrone.
     */
    async executePlugin(name: string, inputs: PluginInputs, signal?: AbortSignal): Promise<PluginResult> {
        try {
            const timeout = this.getPluginExecutionTimeout(name, inputs);
            const execute = () => this.client.post(`/api/plugins/${name}/execute`, {
                inputs
            }, { signal, timeout });
            const response = name === 'vision_ocr' && this.aiOperationRecorder
                ? (await this.aiOperationRecorder.runOperation('ocr-backend-plugin', async () => {
                    this.emitLatestAiExecution('ocr-backend-plugin');
                    return execute();
                }, {
                    cancellationSignal: signal,
                })).response
                : await execute();
            if (name === 'vision_ocr') {
                this.emitLatestAiExecution('ocr-backend-plugin');
            }
            
            return response.data;
            
        } catch (error) {
            if (name === 'vision_ocr') {
                this.emitLatestAiExecution('ocr-backend-plugin');
            }
            console.error(`Erreur lors de l'exécution du plugin ${name}:`, error);
            throw new Error(`Échec de l'exécution du plugin ${name}: ${this.getErrorMessage(error)}`);
        }
    }

    getLatestAiExecution(taskId: string): GeoAppAiExecutionRecord | undefined {
        return this.aiOperationRecorder?.getLatestExecution(taskId);
    }
    
    /**
     * Récupère le statut de tous les plugins.
     */
    async listPuzzleStates(geocacheId: number): Promise<PuzzleStateListResponse> {
        try {
            const response = await this.client.get(`/api/geocaches/${geocacheId}/puzzle-states`);
            return response.data;
        } catch (error) {
            console.error('Erreur lors de la recuperation des etats de grille:', error);
            throw new Error(`Impossible de recuperer les etats de grille: ${this.getErrorMessage(error)}`);
        }
    }

    async getPuzzleState(
        geocacheId: number,
        puzzleType: string = 'sudoku_classic',
        stateKey: string = 'default'
    ): Promise<PuzzleStateGetResponse> {
        try {
            const response = await this.client.get(`/api/geocaches/${geocacheId}/puzzle-states/current`, {
                params: {
                    puzzle_type: puzzleType,
                    state_key: stateKey,
                },
            });
            return response.data;
        } catch (error) {
            console.error('Erreur lors de la recuperation de l etat de grille:', error);
            throw new Error(`Impossible de recuperer l etat de grille: ${this.getErrorMessage(error)}`);
        }
    }

    async savePuzzleState(geocacheId: number, request: PuzzleStateSaveRequest): Promise<PuzzleStateSaveResponse> {
        try {
            const response = await this.client.put(`/api/geocaches/${geocacheId}/puzzle-states/current`, request);
            return response.data;
        } catch (error) {
            console.error('Erreur lors de la sauvegarde de l etat de grille:', error);
            throw new Error(`Impossible de sauvegarder l etat de grille: ${this.getErrorMessage(error)}`);
        }
    }

    async deletePuzzleState(
        geocacheId: number,
        puzzleType: string = 'sudoku_classic',
        stateKey: string = 'default'
    ): Promise<PuzzleStateDeleteResponse> {
        try {
            const response = await this.client.delete(`/api/geocaches/${geocacheId}/puzzle-states/current`, {
                params: {
                    puzzle_type: puzzleType,
                    state_key: stateKey,
                },
            });
            return response.data;
        } catch (error) {
            console.error('Erreur lors de la suppression de l etat de grille:', error);
            throw new Error(`Impossible de supprimer l etat de grille: ${this.getErrorMessage(error)}`);
        }
    }

    async getPluginsStatus(): Promise<PluginsStatus> {
        try {
            const response = await this.client.get('/api/plugins/status');
            return response.data;
            
        } catch (error) {
            console.error('Erreur lors de la récupération du statut des plugins:', error);
            throw new Error(`Impossible de récupérer le statut: ${this.getErrorMessage(error)}`);
        }
    }
    
    /**
     * Demande au backend de redécouvrir les plugins.
     */
    async discoverPlugins(): Promise<void> {
        try {
            await this.client.post('/api/plugins/discover');
            
        } catch (error) {
            console.error('Erreur lors de la découverte des plugins:', error);
            throw new Error(`Échec de la découverte: ${this.getErrorMessage(error)}`);
        }
    }
    
    /**
     * Recharge un plugin spécifique.
     */
    async reloadPlugin(name: string): Promise<void> {
        try {
            await this.client.post(`/api/plugins/${name}/reload`);
            
        } catch (error) {
            console.error(`Erreur lors du rechargement du plugin ${name}:`, error);
            throw new Error(`Échec du rechargement: ${this.getErrorMessage(error)}`);
        }
    }

    async getMetasolverEligiblePlugins(preset: string = 'all'): Promise<MetasolverEligiblePluginsResponse> {
        try {
            const response = await this.client.get('/api/plugins/metasolver/eligible', {
                params: { preset }
            });
            return response.data;
        } catch (error) {
            console.error('Erreur lors de la récupération des plugins metasolver éligibles:', error);
            throw new Error(`Impossible de récupérer les plugins metasolver: ${this.getErrorMessage(error)}`);
        }
    }

    async recommendMetasolverPlugins(request: MetasolverRecommendationRequest): Promise<MetasolverRecommendationResponse> {
        try {
            const response = await this.client.post('/api/plugins/metasolver/recommend', request);
            return response.data;
        } catch (error) {
            console.error('Erreur lors de la recommandation metasolver:', error);
            throw new Error(`Impossible de recommander les plugins metasolver: ${this.getErrorMessage(error)}`);
        }
    }

    async classifyListing(request: ListingClassificationRequest): Promise<ListingClassificationResponse> {
        try {
            const response = await this.client.post('/api/plugins/listing/classify', request);
            return response.data;
        } catch (error) {
            console.error('Erreur lors de la classification du listing:', error);
            throw new Error(`Impossible de classifier le listing: ${this.getErrorMessage(error)}`);
        }
    }

    async resolveWorkflow(request: ResolutionWorkflowRequest): Promise<ResolutionWorkflowResponse> {
        try {
            const response = await this.client.post('/api/plugins/workflow/resolve', request);
            return response.data;
        } catch (error) {
            console.error('Erreur lors de la resolution du workflow:', error);
            throw new Error(`Impossible de resoudre le workflow: ${this.getErrorMessage(error)}`);
        }
    }

    async runWorkflowStep(request: ResolutionWorkflowStepRunRequest): Promise<ResolutionWorkflowStepRunResponse> {
        try {
            const response = await this.client.post('/api/plugins/workflow/run-next-step', request);
            return response.data;
        } catch (error) {
            console.error('Erreur lors de l execution d une etape du workflow:', error);
            throw new Error(`Impossible d executer l etape du workflow: ${this.getErrorMessage(error)}`);
        }
    }
    
    /**
     * Analyse et score des resultats de plugin via le LLM AI Scorer.
     * Si provider/model ne sont pas fournis, applique d'abord l'affectation Theia
     * de geoapp-ai-scorer puis les preferences geoApp.aiScorer.* en repli.
     */
    async aiScoreItems(request: {
        items: any[];
        plugin_name?: string;
        provider?: string;
        base_url?: string;
        model?: string;
        api_key?: string;
        timeout_sec?: number;
        signal?: AbortSignal;
    }): Promise<{
        status: string;
        items: any[];
        count: number;
        provider: string;
        model: string;
    }> {
        // Resoudre provider/model depuis les preferences (le frontend a toujours les vraies valeurs)
        const payload: any = { ...request };
        // Ne pas envoyer le signal au backend
        delete payload.signal;

        // 1. Une affectation explicite faite à l'agent geoapp-ai-scorer dans Theia
        // pilote l'appel backend. Sans affectation, les préférences historiques
        // geoApp.aiScorer.* restent utilisées. Les champs explicitement fournis
        // par l'appelant ont la priorité la plus forte.
        const resolvedModel = await this.aiScorerModelResolver.resolveForRequest(request);
        payload.provider = resolvedModel.provider;
        payload.base_url = resolvedModel.base_url;
        payload.model = resolvedModel.model;
        payload.api_key = resolvedModel.api_key;

        try {
            const execute = () => this.client.post('/api/plugins/ai-score', payload, {
                timeout: ((request.timeout_sec || 90) + 10) * 1000,
                signal: request.signal,
            });
            const response = this.aiOperationRecorder
                ? (await this.aiOperationRecorder.runOperation('ai-scorer', async () => {
                    this.emitLatestAiExecution('ai-scorer');
                    return execute();
                }, {
                    cancellationSignal: request.signal,
                    backendExecution: {
                        provider: resolvedModel.provider,
                        baseUrl: resolvedModel.base_url,
                        model: resolvedModel.model,
                        requestedIdentifier: resolvedModel.assignedIdentifier || resolvedModel.theiaModelId,
                        resolvedModelId: resolvedModel.theiaModelId || resolvedModel.model,
                        displayModel: resolvedModel.theiaModelId && resolvedModel.model
                            ? `${resolvedModel.theiaModelId} → ${resolvedModel.provider}/${resolvedModel.model}`
                            : `${resolvedModel.provider}/${resolvedModel.model || 'auto-détection'}`,
                        source: resolvedModel.source === 'request'
                            ? 'operation'
                            : resolvedModel.source === 'agent'
                                ? 'agent'
                                : 'task-preference',
                        sourceLabel: resolvedModel.sourceLabel,
                    },
                })).response
                : await execute();
            this.emitLatestAiExecution('ai-scorer');
            return response.data;
        } catch (error) {
            this.emitLatestAiExecution('ai-scorer');
            console.error('[PluginsService] Erreur AI scorer:', error);
            throw new Error(`AI Scorer: ${this.getErrorMessage(error)}`);
        }
    }

    /**
     * Détecte les coordonnées GPS dans un texte.
     */
    async detectCoordinates(text: string, options?: {
        includeNumericOnly?: boolean;
        includeWritten?: boolean;
        writtenLanguages?: string[];
        writtenMaxCandidates?: number;
        writtenIncludeDeconcat?: boolean;
        originCoords?: string | { ddm_lat: string; ddm_lon: string };
    }): Promise<{
        exist: boolean;
        ddm_lat?: string;
        ddm_lon?: string;
        ddm?: string;
        decimal_latitude?: number;
        decimal_longitude?: number;
        written?: any;
        error?: string;
    }> {
        try {
            const requestBody = {
                text,
                include_numeric_only: options?.includeNumericOnly || false,
                include_written: options?.includeWritten || false,
                written_languages: options?.writtenLanguages,
                written_max_candidates: options?.writtenMaxCandidates,
                written_include_deconcat: options?.writtenIncludeDeconcat,
                origin_coords: options?.originCoords
            };
            const response = await this.client.post('/api/detect_coordinates', requestBody);
            return response.data;

        } catch (error) {
            console.error('Erreur lors de la détection des coordonnées:', error);
            if (axios.isAxiosError(error) && error.response) {
                console.error('[DEBUG] Réponse serveur:', error.response.status, error.response.data);
            }
            // Ne pas throw, mais distinguer "pas de coordonnées" d'une "détection indisponible"
            // (backend injoignable) : l'appelant peut afficher un avertissement approprié.
            return { exist: false, error: this.getErrorMessage(error) };
        }
    }

    /**
     * Détecte les coordonnées GPS dans un lot de textes, en une seule requête.
     * Bien plus efficace que N appels à detectCoordinates() en série.
     * Retourne un tableau aligné sur l'index de `texts`.
     */
    async detectCoordinatesBatch(texts: string[], options?: {
        includeNumericOnly?: boolean;
        includeWritten?: boolean;
        writtenLanguages?: string[];
        writtenMaxCandidates?: number;
        writtenIncludeDeconcat?: boolean;
        originCoords?: string | { ddm_lat: string; ddm_lon: string };
        signal?: AbortSignal;
    }): Promise<{
        results: Array<{
            exist: boolean;
            ddm_lat?: string;
            ddm_lon?: string;
            ddm?: string;
            decimal_latitude?: number;
            decimal_longitude?: number;
        }>;
        written_truncated?: boolean;
        error?: string;
    }> {
        if (!texts.length) {
            return { results: [] };
        }
        try {
            const requestBody = {
                texts,
                include_numeric_only: options?.includeNumericOnly || false,
                include_written: options?.includeWritten || false,
                written_languages: options?.writtenLanguages,
                written_max_candidates: options?.writtenMaxCandidates,
                written_include_deconcat: options?.writtenIncludeDeconcat,
                origin_coords: options?.originCoords
            };
            const response = await this.client.post('/api/detect_coordinates_batch', requestBody, {
                signal: options?.signal,
                timeout: 120000,
            });
            return response.data;
        } catch (error) {
            console.error('Erreur lors de la détection batch des coordonnées:', error);
            // Renvoyer un tableau aligné de "pas de coordonnées" + l'erreur, sans throw.
            return {
                results: texts.map(() => ({ exist: false })),
                error: this.getErrorMessage(error),
            };
        }
    }

    /**
     * Extrait le message d'erreur depuis une erreur Axios.
     */
    private getErrorMessage(error: any): string {
        if (axios.isAxiosError(error)) {
            if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
                return 'Le delai d attente de la requete a ete depasse. Le backend peut encore etre en train de calculer.';
            }
            if (error.response) {
                // Erreur retournée par le serveur
                const data = error.response.data;
                return data?.message || data?.error || error.message;
            } else if (error.request) {
                // Pas de réponse du serveur
                return 'Le backend ne répond pas. Vérifiez que le serveur Flask est démarré.';
            }
        }
        
        return error.message || 'Erreur inconnue';
    }

    private getPluginExecutionTimeout(name: string, inputs: PluginInputs): number {
        if (name === 'grid_puzzle_solver') {
            const solverTimeout = Number(inputs?.solver_timeout_ms);
            if (Number.isFinite(solverTimeout) && solverTimeout > 0) {
                return Math.max(45000, Math.floor(solverTimeout) + 15000);
            }
            return 45000;
        }

        // Aligner le timeout HTTP sur le timeout d'exécution backend (préférence)
        // + une marge réseau : sinon le client abandonne pendant que le backend
        // calcule encore, ce qui affiche une erreur et incite à relancer (charge
        // doublée). Le backend applique déjà un timeout dur côté plugin.
        const NETWORK_MARGIN_MS = 15000;
        const timeoutSec = Number(this.preferenceService.get('geoApp.plugins.executor.timeoutSec', 60)) || 60;
        const allowLongRunning = Boolean(this.preferenceService.get('geoApp.plugins.executor.allowLongRunning', false));
        // En mode « plugins longs », le backend peut aller jusqu'au timeout déclaré
        // du plugin (plafonné à 300 s par le schéma) : prévoir large pour ne pas couper.
        const effectiveSec = allowLongRunning ? Math.max(timeoutSec, 300) : timeoutSec;
        return Math.max(30000, effectiveSec * 1000 + NETWORK_MARGIN_MS);
    }

    private createClient(baseURL: string): AxiosInstance {
        return axios.create({
            baseURL,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }

    private updateBaseUrl(url: string): void {
        const normalized = this.normalizeBaseUrl(url);
        if (normalized === this.baseUrl) {
            return;
        }
        this.baseUrl = normalized;
        this.client = this.createClient(this.baseUrl);
        console.info('[PluginsService] URL backend mise à jour:', this.baseUrl);
    }

    private normalizeBaseUrl(url: string): string {
        const trimmed = (url || '').trim();
        if (!trimmed) {
            return 'http://localhost:8000';
        }
        return trimmed.replace(/\/+$/, '');
    }
}
