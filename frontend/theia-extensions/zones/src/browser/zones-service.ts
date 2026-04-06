import { inject, injectable } from '@theia/core/shared/inversify';
import { BackendApiClient } from './backend-api-client';

export type ZoneDto = {
    id: number;
    name: string;
    description?: string;
    created_at?: string;
    geocaches_count?: number;
};

export interface ActiveZoneDto {
    id?: number | null;
}

@injectable()
export class ZonesService {
    constructor(
        @inject(BackendApiClient) protected readonly apiClient: BackendApiClient
    ) {}

    async list<T extends ZoneDto = ZoneDto>(): Promise<T[]> {
        return this.apiClient.requestJson<T[]>(
            '/api/zones',
            {},
            'Erreur lors du chargement des zones'
        );
    }

    async create<T extends ZoneDto = ZoneDto>(input: { name: string; description?: string }): Promise<T> {
        return this.apiClient.requestJson<T>(
            '/api/zones',
            this.apiClient.createJsonInit('POST', input),
            'Erreur lors de la création de la zone'
        );
    }

    async delete(zoneId: number): Promise<void> {
        await this.apiClient.requestVoid(
            `/api/zones/${zoneId}`,
            { method: 'DELETE' },
            'Erreur lors de la suppression de la zone'
        );
    }

    async listGeocaches<T>(zoneId: number): Promise<T[]> {
        return this.apiClient.requestJson<T[]>(
            `/api/zones/${zoneId}/geocaches`,
            {},
            'Erreur lors du chargement des géocaches de la zone'
        );
    }

    async getActiveZone<T extends ActiveZoneDto = ActiveZoneDto>(): Promise<T | undefined> {
        const response = await this.apiClient.request('/api/active-zone');
        if (!response.ok) {
            return undefined;
        }
        return this.apiClient.readOptionalJson<T>(response);
    }

    async setActiveZone(zoneId: number | null): Promise<void> {
        await this.apiClient.requestVoid(
            '/api/active-zone',
            this.apiClient.createJsonInit('POST', { zone_id: zoneId }),
            'Erreur lors de la mise à jour de la zone active'
        );
    }
}


