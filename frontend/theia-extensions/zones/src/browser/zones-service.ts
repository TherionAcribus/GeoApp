import { inject, injectable } from '@theia/core/shared/inversify';
import { BackendApiClient } from './backend-api-client';

export type ZoneDto = {
    id: number;
    name: string;
    description?: string;
    created_at?: string;
    geocaches_count?: number;
    latest_geocache_created_at?: string | null;
    latest_resolution_updated_at?: string | null;
    /** Zone technique (« Amis ») : absente de la liste sauf `includeHidden`. */
    is_hidden?: boolean;
};

export interface ActiveZoneDto {
    id?: number | null;
}

@injectable()
export class ZonesService {
    constructor(
        @inject(BackendApiClient) protected readonly apiClient: BackendApiClient
    ) {}

    /**
     * Zones triées par nom. Les zones techniques (la zone « Amis ») sont exclues
     * par défaut : seul l'arbre les demande, et seulement si la préférence
     * `geoApp.friends.zone.visible` est activée.
     */
    async list<T extends ZoneDto = ZoneDto>(includeHidden: boolean = false): Promise<T[]> {
        return this.apiClient.requestJson<T[]>(
            includeHidden ? '/api/zones?include_hidden=true' : '/api/zones',
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

    async update<T extends ZoneDto = ZoneDto>(zoneId: number, input: { name: string; description?: string }): Promise<T> {
        return this.apiClient.requestJson<T>(
            `/api/zones/${zoneId}/rename`,
            this.apiClient.createJsonInit('POST', input),
            'Erreur lors de la mise à jour de la zone'
        );
    }

    async duplicate<T extends ZoneDto = ZoneDto>(zoneId: number, input: { name: string; description?: string }): Promise<T> {
        return this.apiClient.requestJson<T>(
            `/api/zones/${zoneId}/duplicate`,
            this.apiClient.createJsonInit('POST', input),
            'Erreur lors de la duplication de la zone'
        );
    }

    async merge<T = unknown>(zoneId: number, input: { target_zone_id: number }): Promise<T> {
        return this.apiClient.requestJson<T>(
            `/api/zones/${zoneId}/merge`,
            this.apiClient.createJsonInit('POST', input),
            'Erreur lors de la fusion de la zone'
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

    /**
     * Variante allégée de {@link listGeocaches} pour l'arbre de navigation :
     * ne renvoie que les champs affichés (id, gc_code, name, cache_type,
     * difficulty, terrain, found), sans waypoints/notes/attributs ni les
     * requêtes N+1 associées.
     */
    async listGeocachesTree<T>(zoneId: number): Promise<T[]> {
        return this.apiClient.requestJson<T[]>(
            `/api/zones/${zoneId}/geocaches/tree`,
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


