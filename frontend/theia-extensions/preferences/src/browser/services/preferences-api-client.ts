import { injectable } from '@theia/core/shared/inversify';
import axios, { AxiosInstance } from 'axios';

export interface BackendPreferencesResponse {
    preferences: Record<string, unknown>;
    /**
     * Clés réellement stockées côté Flask (ligne `AppConfig` existante), à distinguer
     * des clés qui ne renvoient que leur `default` de schéma. Absent sur un backend
     * plus ancien : le client doit alors se rabattre sur l'ensemble des clés listées.
     */
    storedKeys?: string[];
    /** Clés `x-sensitive` : jamais renvoyées en clair par le backend. */
    sensitiveKeys?: string[];
}

@injectable()
export class PreferencesApiClient {

    private client: AxiosInstance;
    private baseUrl: string;

    constructor() {
        this.baseUrl = 'http://localhost:8000';
        this.client = this.createClient(this.baseUrl);
    }

    setBaseUrl(url: string | undefined): void {
        const sanitized = (url || 'http://localhost:8000').replace(/\/+$/, '');
        if (sanitized === this.baseUrl) {
            return;
        }
        this.baseUrl = sanitized;
        this.client = this.createClient(this.baseUrl);
    }

    async fetchAll(): Promise<BackendPreferencesResponse> {
        const response = await this.client.get<BackendPreferencesResponse | Record<string, unknown>>('/api/preferences');
        const data = response.data;
        if (data && typeof data === 'object' && 'preferences' in data) {
            return data as BackendPreferencesResponse;
        }
        return { preferences: data as Record<string, unknown> };
    }

    async update(key: string, value: unknown): Promise<void> {
        await this.client.put(`/api/preferences/${encodeURIComponent(key)}`, { value });
    }

    async updateBulk(values: Record<string, unknown>): Promise<void> {
        await this.client.patch('/api/preferences', { values });
    }

    /** Supprime la valeur stockée côté Flask : la préférence retombe sur le défaut du schéma. */
    async reset(key: string): Promise<void> {
        await this.client.delete(`/api/preferences/${encodeURIComponent(key)}`);
    }

    private createClient(baseURL: string): AxiosInstance {
        return axios.create({
            baseURL,
            timeout: 15000,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }
}
