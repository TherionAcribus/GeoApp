/**
 * Service pour communiquer avec l'API Backend des alphabets.
 */
import { inject, injectable } from '@theia/core/shared/inversify';
import { PreferenceChange, PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { Alphabet, AlphabetSearchOptions, AssociatedGeocache, DetectedCoordinates, DistanceInfo } from '../../common/alphabet-protocol';
import axios, { AxiosInstance } from 'axios';

const BACKEND_BASE_URL_PREF = 'geoApp.backend.apiBaseUrl';
const DEFAULT_API_BASE_URL = 'http://localhost:8000';

interface BackendGeocache {
    id?: string;
    database_id?: number;
    gc_code: string;
    name: string;
    gc_lat?: string;
    gc_lon?: string;
}

@injectable()
export class AlphabetsService {

    private client: AxiosInstance;
    private baseUrl: string;
    private cache: Map<string, Alphabet> = new Map();
    private listCache: Alphabet[] | null = null;
    private cacheTimeout: number = 5 * 60 * 1000; // 5 minutes
    private lastCacheTime: number = 0;

    constructor(
        @inject(PreferenceService) private readonly preferenceService: PreferenceService
    ) {
        this.baseUrl = this.normalizeBaseUrl(this.getBackendBaseUrl());
        this.client = this.createClient(this.baseUrl);

        this.preferenceService.onPreferenceChanged((event: PreferenceChange) => {
            if (event.preferenceName === BACKEND_BASE_URL_PREF) {
                this.updateBaseUrl(this.getBackendBaseUrl());
            }
        });
    }

    /**
     * Récupère la liste de tous les alphabets disponibles.
     * Supporte la recherche avec options.
     */
    async listAlphabets(searchOptions?: AlphabetSearchOptions): Promise<Alphabet[]> {
        try {
            // Si pas de recherche et cache valide, retourner le cache
            if (!searchOptions && this.listCache && (Date.now() - this.lastCacheTime < this.cacheTimeout)) {
                return this.listCache;
            }

            const params: Record<string, string | boolean> = {};
            if (searchOptions) {
                if (searchOptions.query) {
                    params.search = searchOptions.query;
                }
                if (searchOptions.search_in_name !== undefined) {
                    params.search_in_name = searchOptions.search_in_name;
                }
                if (searchOptions.search_in_tags !== undefined) {
                    params.search_in_tags = searchOptions.search_in_tags;
                }
                if (searchOptions.search_in_readme !== undefined) {
                    params.search_in_readme = searchOptions.search_in_readme;
                }
            }

            const response = await this.client.get<Alphabet[]>('/api/alphabets', { params });
            
            // Mettre en cache uniquement si pas de recherche
            if (!searchOptions) {
                this.listCache = response.data;
                this.lastCacheTime = Date.now();
            }
            
            return response.data;
        } catch (error) {
            console.error('Error fetching alphabets list:', error);
            throw error;
        }
    }

    /**
     * Récupère la configuration complète d'un alphabet spécifique.
     */
    async getAlphabet(alphabetId: string): Promise<Alphabet> {
        try {
            // Vérifier le cache
            if (this.cache.has(alphabetId)) {
                return this.cache.get(alphabetId)!;
            }

            const response = await this.client.get<Alphabet>(`/api/alphabets/${encodeURIComponent(alphabetId)}`);
            
            // Mettre en cache
            this.cache.set(alphabetId, response.data);
            
            return response.data;
        } catch (error) {
            console.error(`Error fetching alphabet ${alphabetId}:`, error);
            throw error;
        }
    }

    /**
     * Récupère l'URL complète d'une police d'alphabet.
     */
    getFontUrl(alphabetId: string): string {
        return `${this.baseUrl}/api/alphabets/${encodeURIComponent(alphabetId)}/font`;
    }

    /**
     * Récupère l'URL complète d'une ressource (image) d'alphabet.
     */
    getResourceUrl(alphabetId: string, resourcePath: string): string {
        const encodedPath = resourcePath.split('/').map(part => encodeURIComponent(part)).join('/');
        return `${this.baseUrl}/api/alphabets/${encodeURIComponent(alphabetId)}/resource/${encodedPath}`;
    }

    /**
     * Force la redécouverte des alphabets (invalide le cache).
     */
    async discoverAlphabets(): Promise<{ count: number; alphabets: Alphabet[] }> {
        try {
            const response = await this.client.post<{ status: string; count: number; alphabets: Alphabet[] }>(
                '/api/alphabets/discover'
            );
            
            // Invalider le cache
            this.listCache = null;
            this.cache.clear();
            
            return {
                count: response.data.count,
                alphabets: response.data.alphabets
            };
        } catch (error) {
            console.error('Error discovering alphabets:', error);
            throw error;
        }
    }

    /**
     * Détecte les coordonnées GPS dans un texte.
     */
    async detectCoordinates(
        text: string,
        originCoords?: { ddm_lat: string; ddm_lon: string }
    ): Promise<DetectedCoordinates> {
        try {
            const payload: Record<string, unknown> = {
                text,
                include_numeric_only: true,
                include_written: true
            };
            
            if (originCoords) {
                payload.origin_coords = originCoords;
            }

            const response = await this.client.post<DetectedCoordinates>(
                '/api/detect_coordinates',
                payload
            );
            
            return response.data;
        } catch (error) {
            console.error('Error detecting coordinates:', error);
            throw error;
        }
    }

    /**
     * Calcule la distance entre deux coordonnées.
     */
    async calculateDistance(
        originLat: string,
        originLon: string,
        destLat: string,
        destLon: string
    ): Promise<DistanceInfo> {
        try {
            const response = await this.client.post<any>(
                '/api/calculate_coordinates',
                {
                    formula: `${destLat} ${destLon}`,  // Format factice pour l'API
                    origin_lat: originLat,
                    origin_lon: originLon,
                    variables: {}
                }
            );
            
            if (response.data.distance_from_origin) {
                return response.data.distance_from_origin;
            }
            
            throw new Error('Distance not available in response');
        } catch (error) {
            console.error('Error calculating distance:', error);
            throw error;
        }
    }

    /**
     * Invalide le cache pour un alphabet spécifique.
     */
    invalidateCache(alphabetId?: string): void {
        if (alphabetId) {
            this.cache.delete(alphabetId);
        } else {
            this.cache.clear();
            this.listCache = null;
        }
    }

    async getGeocacheByCode(code: string): Promise<AssociatedGeocache> {
        const normalizedCode = code.trim().toUpperCase();
        const response = await this.client.get<BackendGeocache>(
            `/api/geocaches/by-code/${encodeURIComponent(normalizedCode)}`
        );
        const data = response.data;
        return {
            id: data.id,
            databaseId: data.database_id,
            code: data.gc_code,
            name: data.name,
            gc_lat: data.gc_lat,
            gc_lon: data.gc_lon
        };
    }

    private createClient(baseUrl: string): AxiosInstance {
        return axios.create({
            baseURL: baseUrl,
            timeout: 30000
        });
    }

    private updateBaseUrl(url: string): void {
        this.baseUrl = this.normalizeBaseUrl(url);
        this.client = this.createClient(this.baseUrl);
        this.invalidateCache();
    }

    private normalizeBaseUrl(url: string): string {
        const trimmed = (url || '').trim();
        return (trimmed || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
    }

    private getBackendBaseUrl(): string {
        return String(this.preferenceService.get(BACKEND_BASE_URL_PREF, DEFAULT_API_BASE_URL) || DEFAULT_API_BASE_URL);
    }
}



