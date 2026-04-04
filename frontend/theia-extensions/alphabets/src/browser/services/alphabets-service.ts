/**
 * Service pour communiquer avec l'API Backend des alphabets.
 */
import { injectable } from '@theia/core/shared/inversify';
import { Alphabet, AlphabetSearchOptions, DetectedCoordinates, DistanceInfo } from '../../common/alphabet-protocol';
import axios from 'axios';

const API_BASE_URL = 'http://127.0.0.1:8000';

@injectable()
export class AlphabetsService {
    
    private cache: Map<string, Alphabet> = new Map();
    private listCache: Alphabet[] | null = null;
    private cacheTimeout: number = 5 * 60 * 1000; // 5 minutes
    private lastCacheTime: number = 0;

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

            const params: any = {};
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

            const response = await axios.get<Alphabet[]>(`${API_BASE_URL}/api/alphabets`, { params });
            
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

            const response = await axios.get<Alphabet>(`${API_BASE_URL}/api/alphabets/${alphabetId}`);
            
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
        return `${API_BASE_URL}/api/alphabets/${alphabetId}/font`;
    }

    /**
     * Récupère l'URL complète d'une ressource (image) d'alphabet.
     */
    getResourceUrl(alphabetId: string, resourcePath: string): string {
        return `${API_BASE_URL}/api/alphabets/${alphabetId}/resource/${resourcePath}`;
    }

    /**
     * Force la redécouverte des alphabets (invalide le cache).
     */
    async discoverAlphabets(): Promise<{ count: number; alphabets: Alphabet[] }> {
        try {
            const response = await axios.post<{ status: string; count: number; alphabets: Alphabet[] }>(
                `${API_BASE_URL}/api/alphabets/discover`
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
            const payload: any = {
                text,
                include_numeric_only: true
            };
            
            if (originCoords) {
                payload.origin_coords = originCoords;
            }

            const response = await axios.post<DetectedCoordinates>(
                `${API_BASE_URL}/api/detect_coordinates`,
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
            const response = await axios.post<any>(
                `${API_BASE_URL}/api/calculate_coordinates`,
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
}



