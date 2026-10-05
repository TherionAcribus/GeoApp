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
    /**
     * Dossier : une « superzone » qui montre les géocaches de ses zones membres
     * (`zone_ids`) sans en porter en propre. Absent de la liste sauf `includeFolders`.
     */
    is_folder?: boolean;
    /** Zones rangées dans le dossier (dossiers uniquement). */
    zone_ids?: number[];
    /** Dossiers où la zone est rangée. */
    folder_ids?: number[];
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
     *
     * Les dossiers sont exclus eux aussi, parce que la plupart des appelants
     * cherchent une zone où écrire : `includeFolders` les ajoute (arbre, tableau).
     */
    async list<T extends ZoneDto = ZoneDto>(includeHidden: boolean = false, includeFolders: boolean = false): Promise<T[]> {
        const params: string[] = [];
        if (includeHidden) {
            params.push('include_hidden=true');
        }
        if (includeFolders) {
            params.push('include_folders=true');
        }
        return this.apiClient.requestJson<T[]>(
            params.length > 0 ? `/api/zones?${params.join('&')}` : '/api/zones',
            {},
            'Erreur lors du chargement des zones'
        );
    }

    /** Une zone ou un dossier, avec ses compteurs (et `zone_ids` pour un dossier). */
    async get<T extends ZoneDto = ZoneDto>(zoneId: number): Promise<T> {
        return this.apiClient.requestJson<T>(
            `/api/zones/${zoneId}`,
            {},
            'Erreur lors du chargement de la zone'
        );
    }

    async addToFolder<T extends ZoneDto = ZoneDto>(folderId: number, zoneId: number): Promise<T> {
        return this.apiClient.requestJson<T>(
            `/api/zones/${folderId}/members/${zoneId}`,
            { method: 'POST' },
            'Erreur lors du rangement de la zone dans le dossier'
        );
    }

    async removeFromFolder<T extends ZoneDto = ZoneDto>(folderId: number, zoneId: number): Promise<T> {
        return this.apiClient.requestJson<T>(
            `/api/zones/${folderId}/members/${zoneId}`,
            { method: 'DELETE' },
            'Erreur lors du retrait de la zone du dossier'
        );
    }

    async create<T extends ZoneDto = ZoneDto>(input: { name: string; description?: string; is_folder?: boolean }): Promise<T> {
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


