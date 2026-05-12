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
            throw new Error(`Impossible de récupérer les plugins: ${this.getErrorMessage(error)}`);
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
            const response = await this.client.post(`/api/plugins/${name}/execute`, {
                inputs
            }, { signal });
            
            return response.data;
            
        } catch (error) {
            console.error(`Erreur lors de l'exécution du plugin ${name}:`, error);
            throw new Error(`Échec de l'exécution du plugin ${name}: ${this.getErrorMessage(error)}`);
        }
    }
    
    /**
     * Récupère le statut de tous les plugins.
     */
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
     * Détecte les coordonnées GPS dans un texte.
     */
    async detectCoordinates(text: string, options?: {
        includeNumericOnly?: boolean;
        includeWritten?: boolean;
        writtenLanguages?: string[];
        writtenMaxCandidates?: number;
        writtenIncludeDeconcat?: boolean;
        originCoords?: { ddm_lat: string; ddm_lon: string };
    }): Promise<{
        exist: boolean;
        ddm_lat?: string;
        ddm_lon?: string;
        ddm?: string;
        decimal_latitude?: number;
        decimal_longitude?: number;
        written?: any;
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
            console.log('[DEBUG] Envoi POST /api/detect_coordinates:', JSON.stringify(requestBody).substring(0, 200));
            const response = await this.client.post('/api/detect_coordinates', requestBody);
            return response.data;
            
        } catch (error) {
            console.error('Erreur lors de la détection des coordonnées:', error);
            if (axios.isAxiosError(error) && error.response) {
                console.error('[DEBUG] Réponse serveur:', error.response.status, error.response.data);
            }
            // Ne pas throw d'erreur, retourner simplement "pas de coordonnées"
            return { exist: false };
        }
    }
    
    /**
     * Extrait le message d'erreur depuis une erreur Axios.
     */
    private getErrorMessage(error: any): string {
        if (axios.isAxiosError(error)) {
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
