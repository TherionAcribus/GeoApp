import { injectable } from '@theia/core/shared/inversify';
import axios, { AxiosInstance } from 'axios';

export interface BackendPreferencesResponse {
    preferences: Record<string, unknown>;
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

    async fetchAll(): Promise<Record<string, unknown>> {
        const response = await this.client.get<BackendPreferencesResponse | Record<string, unknown>>('/api/preferences');
        if ('preferences' in response.data) {
            return response.data.preferences as Record<string, unknown>;
        }
        return response.data;
    }

    async update(key: string, value: unknown): Promise<void> {
        await this.client.put(`/api/preferences/${encodeURIComponent(key)}`, { value });
    }

    async updateBulk(values: Record<string, unknown>): Promise<void> {
        await this.client.patch('/api/preferences', { values });
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

