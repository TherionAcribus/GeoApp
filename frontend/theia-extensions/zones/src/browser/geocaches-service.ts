import { inject, injectable } from '@theia/core/shared/inversify';
import { BackendApiClient } from './backend-api-client';

export interface CreateWaypointInput {
    name: string;
    gc_coords: string;
    note?: string;
    type?: string;
}

export interface MoveGeocacheResult {
    already_exists?: boolean;
}

@injectable()
export class GeocachesService {
    constructor(
        @inject(BackendApiClient) protected readonly apiClient: BackendApiClient
    ) {}

    async exportGpx(geocacheIds: number[], filename: string): Promise<Response> {
        return this.apiClient.requestResponse(
            '/api/geocaches/export-gpx',
            this.apiClient.createJsonInit('POST', { geocache_ids: geocacheIds, filename }),
            'Erreur lors de l\'export GPX'
        );
    }

    async importAround(
        request: { zone_id: number; center: unknown; limit: number; radius_km?: number },
        signal?: AbortSignal
    ): Promise<Response> {
        return this.apiClient.requestResponse(
            '/api/geocaches/import-around',
            this.apiClient.createJsonInit('POST', request, { signal }),
            'Erreur lors de l\'import autour'
        );
    }

    async delete(id: number): Promise<void> {
        await this.apiClient.requestVoid(
            `/api/geocaches/${id}`,
            { method: 'DELETE' },
            'Erreur lors de la suppression de la géocache'
        );
    }

    async refresh(id: number): Promise<void> {
        await this.apiClient.requestVoid(
            `/api/geocaches/${id}/refresh`,
            { method: 'POST' },
            'Erreur lors du rafraîchissement de la géocache'
        );
    }

    async move(id: number, targetZoneId: number): Promise<MoveGeocacheResult | undefined> {
        return this.apiClient.requestOptionalJson<MoveGeocacheResult>(
            `/api/geocaches/${id}/move`,
            this.apiClient.createJsonInit('PATCH', { target_zone_id: targetZoneId }),
            'Erreur lors du déplacement de la géocache'
        );
    }

    async copy<T = unknown>(id: number, targetZoneId: number): Promise<T | undefined> {
        return this.apiClient.requestOptionalJson<T>(
            `/api/geocaches/${id}/copy`,
            this.apiClient.createJsonInit('POST', { target_zone_id: targetZoneId }),
            'Erreur lors de la copie de la géocache'
        );
    }

    async get<T>(id: number): Promise<T> {
        return this.apiClient.requestJson<T>(
            `/api/geocaches/${id}`,
            {},
            'Erreur lors du chargement de la géocache'
        );
    }

    async importGpx(file: File, zoneId: number, updateExisting: boolean): Promise<Response> {
        const formData = new FormData();
        formData.append('gpxFile', file);
        formData.append('zone_id', zoneId.toString());
        if (updateExisting) {
            formData.append('updateExisting', 'on');
        }

        return this.apiClient.requestResponse(
            '/api/geocaches/import-gpx',
            { method: 'POST', body: formData },
            'Erreur lors de l\'import du fichier GPX'
        );
    }

    async importBookmarkList(bookmarkCode: string, zoneId: number): Promise<Response> {
        return this.apiClient.requestResponse(
            '/api/geocaches/import-bookmark-list',
            this.apiClient.createJsonInit('POST', {
                bookmark_code: bookmarkCode,
                zone_id: zoneId
            }),
            'Erreur lors de l\'import de la liste de favoris'
        );
    }

    async importPocketQuery(pqCode: string, zoneId: number): Promise<Response> {
        return this.apiClient.requestResponse(
            '/api/geocaches/import-pocket-query',
            this.apiClient.createJsonInit('POST', {
                pq_code: pqCode,
                zone_id: zoneId
            }),
            'Erreur lors de l\'import de la pocket query'
        );
    }

    async addToZone<T = unknown>(zoneId: number, code: string): Promise<T | undefined> {
        return this.apiClient.requestOptionalJson<T>(
            '/api/geocaches/add',
            this.apiClient.createJsonInit('POST', { zone_id: zoneId, code }),
            'Erreur lors de l\'ajout de la géocache'
        );
    }

    async createWaypoint<T = unknown>(geocacheId: number, payload: CreateWaypointInput): Promise<T | undefined> {
        return this.apiClient.requestOptionalJson<T>(
            `/api/geocaches/${geocacheId}/waypoints`,
            this.apiClient.createJsonInit('POST', payload),
            'Erreur lors de la création du waypoint'
        );
    }

    async deleteWaypoint(geocacheId: number, waypointId: number): Promise<void> {
        await this.apiClient.requestVoid(
            `/api/geocaches/${geocacheId}/waypoints/${waypointId}`,
            { method: 'DELETE' },
            'Erreur lors de la suppression du waypoint'
        );
    }

    async setWaypointAsCorrectedCoords(geocacheId: number, waypointId: number): Promise<void> {
        await this.apiClient.requestVoid(
            `/api/geocaches/${geocacheId}/set-corrected-coords/${waypointId}`,
            { method: 'POST' },
            'Erreur lors de la mise à jour des coordonnées corrigées'
        );
    }

    async updateCoordinates<T = unknown>(geocacheId: number, coordinatesRaw: string): Promise<T | undefined> {
        return this.apiClient.requestOptionalJson<T>(
            `/api/geocaches/${geocacheId}/coordinates`,
            this.apiClient.createJsonInit('PUT', { coordinates_raw: coordinatesRaw }),
            'Erreur lors de la mise à jour des coordonnées'
        );
    }
}
