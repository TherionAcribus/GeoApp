/**
 * Service de communication avec l'API backend pour les plugins.
 * 
 * Ce service encapsule toutes les requêtes HTTP vers le backend Flask
 * pour la gestion des plugins.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
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

@injectable()
export class PluginsServiceImpl implements IPluginsService {
    
    private client: AxiosInstance;
    private baseUrl: string;
    
    constructor(
        @inject(PreferenceService) private readonly preferenceService: PreferenceService,
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
            const response = await this.client.post(`/api/plugins/${name}/execute`, {
                inputs
            }, { signal, timeout });
            
            return response.data;
            
        } catch (error) {
            console.error(`Erreur lors de l'exécution du plugin ${name}:`, error);
            throw new Error(`Échec de l'exécution du plugin ${name}: ${this.getErrorMessage(error)}`);
        }
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
     * Si provider/model ne sont pas fournis, les lit depuis les preferences geoApp.aiScorer.*
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

        // 1. Determiner le provider effectif
        let resolvedProvider = payload.provider || '';
        if (!resolvedProvider) {
            const scorerProv = String(this.preferenceService.get('geoApp.aiScorer.provider', 'auto') || 'auto');
            if (scorerProv !== 'auto') {
                resolvedProvider = scorerProv;
            } else {
                // auto : OpenRouter si API key disponible, sinon LMStudio
                const orKey = String(this.preferenceService.get('geoApp.ai.openRouter.apiKey', '') || '');
                resolvedProvider = orKey.trim() ? 'openrouter' : 'lmstudio';
            }
        }
        payload.provider = resolvedProvider;

        // 2. Resoudre model / base_url / api_key si pas deja fournis
        if (resolvedProvider === 'openrouter') {
            if (!payload.model) {
                payload.model = String(
                    this.preferenceService.get('geoApp.aiScorer.openRouter.model', '')
                    || this.preferenceService.get('geoApp.ai.openRouter.model.strong', 'openai/gpt-4o')
                );
            }
            if (!payload.base_url) {
                payload.base_url = String(
                    this.preferenceService.get('geoApp.ai.openRouter.baseUrl', 'https://openrouter.ai/api/v1')
                );
            }
            if (!payload.api_key) {
                payload.api_key = String(
                    this.preferenceService.get('geoApp.ai.openRouter.apiKey', '')
                );
            }
        } else {
            if (!payload.model) {
                payload.model = String(
                    this.preferenceService.get('geoApp.aiScorer.lmstudio.model', '')
                    || this.preferenceService.get('geoApp.ocr.lmstudio.model', '')
                    || ''
                );
            }
            if (!payload.base_url) {
                payload.base_url = String(
                    this.preferenceService.get('geoApp.ocr.lmstudio.baseUrl', 'http://localhost:1234')
                );
            }
        }


        try {
            const response = await this.client.post('/api/plugins/ai-score', payload, {
                timeout: ((request.timeout_sec || 90) + 10) * 1000,
                signal: request.signal,
            });
            return response.data;
        } catch (error) {
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
