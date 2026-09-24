import { inject, injectable } from '@theia/core/shared/inversify';
import { BackendApiClient } from './backend-api-client';
import { OutingAnalysisBundle, OutingAnalysisOptions, OutingLogsStatus } from './outing-analysis-types';

export interface CreateWaypointInput {
    name: string;
    gc_coords: string;
    note?: string;
    type?: string;
}

export interface MoveGeocacheResult {
    already_exists?: boolean;
}

export interface NearbyGeocachesResult<T = unknown> {
    center_geocache: {
        id: number;
        gc_code: string;
        latitude: number;
        longitude: number;
    };
    nearby_geocaches: T[];
    radius_km: number;
}

@injectable()
export class GeocachesService {
    constructor(
        @inject(BackendApiClient) protected readonly apiClient: BackendApiClient
    ) {}

    async exportGpx(geocacheIds: number[], filename: string, signal?: AbortSignal): Promise<Response> {
        return this.apiClient.requestResponse(
            '/api/geocaches/export-gpx',
            this.apiClient.createJsonInit('POST', { geocache_ids: geocacheIds, filename }, { signal }),
            'Erreur lors de l\'export GPX'
        );
    }

    async importAround(
        request: { zone_id: number; center: unknown; limit: number; radius_km?: number; min_km?: number; filters?: unknown[] },
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

    /**
     * Détails complets d'une géocache.
     * `options.recentLogsCount` active les extras de fiche détail (nombre de notes,
     * résumé des logs récents) calculés côté serveur dans la même requête.
     */
    async get<T>(id: number, options?: { recentLogsCount?: number }): Promise<T> {
        const params = options
            ? `?details_extras=1&recent_logs_count=${encodeURIComponent(String(options.recentLogsCount ?? 5))}`
            : '';
        return this.apiClient.requestJson<T>(
            `/api/geocaches/${id}${params}`,
            {},
            'Erreur lors du chargement de la géocache'
        );
    }

    /** Recherche une géocache par son code GC (ex: "GC8ABCD"), optionnellement dans une zone. */
    async getByCode<T = unknown>(gcCode: string, zoneId?: number): Promise<T> {
        const zoneQuery = zoneId != null ? `?zone_id=${encodeURIComponent(String(zoneId))}` : '';
        return this.apiClient.requestJson<T>(
            `/api/geocaches/by-code/${encodeURIComponent(gcCode)}${zoneQuery}`,
            {},
            'Erreur lors de la recherche de la géocache'
        );
    }

    /**
     * Vue légère de plusieurs géocaches en une requête (`to_summary()` côté backend).
     * Passer `full: true` pour les champs complets (description, hint, waypoints).
     */
    async getBatch<T = unknown>(ids: number[], options?: { full?: boolean }): Promise<{ geocaches: T[]; missing: number[] }> {
        return this.apiClient.requestJson<{ geocaches: T[]; missing: number[] }>(
            `/api/geocaches/batch?ids=${encodeURIComponent(ids.join(','))}${options?.full ? '&full=1' : ''}`,
            {},
            'Erreur lors du chargement des géocaches'
        );
    }

    async getNearby<T = unknown>(id: number, radiusKm: number = 5): Promise<NearbyGeocachesResult<T>> {
        return this.apiClient.requestJson<NearbyGeocachesResult<T>>(
            `/api/geocaches/${id}/nearby?radius=${encodeURIComponent(String(radiusKm))}`,
            {},
            'Erreur lors du chargement des geocaches voisines'
        );
    }

    async importGpx(file: File, zoneId: number, updateExisting: boolean, signal?: AbortSignal): Promise<Response> {
        const formData = new FormData();
        formData.append('gpxFile', file);
        formData.append('zone_id', zoneId.toString());
        if (updateExisting) {
            formData.append('updateExisting', 'on');
        }

        return this.apiClient.requestResponse(
            '/api/geocaches/import-gpx',
            { method: 'POST', body: formData, signal },
            'Erreur lors de l\'import du fichier GPX'
        );
    }

    async importBookmarkList(bookmarkCode: string, zoneId: number, updateExisting: boolean, signal?: AbortSignal): Promise<Response> {
        return this.apiClient.requestResponse(
            '/api/geocaches/import-bookmark-list',
            this.apiClient.createJsonInit('POST', {
                bookmark_code: bookmarkCode,
                zone_id: zoneId,
                update_existing: updateExisting
            }, { signal }),
            'Erreur lors de l\'import de la liste de favoris'
        );
    }

    async importPocketQuery(pqCode: string, zoneId: number, updateExisting: boolean, signal?: AbortSignal): Promise<Response> {
        return this.apiClient.requestResponse(
            '/api/geocaches/import-pocket-query',
            this.apiClient.createJsonInit('POST', {
                pq_code: pqCode,
                zone_id: zoneId,
                update_existing: updateExisting
            }, { signal }),
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

    /**
     * Bundle d'analyse de sortie pour un lot de géocaches.
     *
     * Un seul aller-retour là où il faudrait sinon deux appels par cache (détails puis
     * logs) : le serveur assemble listing, hint, attributs, santé et logs pertinents, et
     * applique lui-même les troncatures.
     */
    async fetchAnalysisBundle(
        geocacheIds: number[],
        options: OutingAnalysisOptions = {},
        signal?: AbortSignal
    ): Promise<OutingAnalysisBundle> {
        return this.apiClient.requestJson<OutingAnalysisBundle>(
            '/api/geocaches/analysis-bundle',
            this.apiClient.createJsonInit('POST', {
                ids: geocacheIds,
                listing_chars: options.listingChars,
                recent_logs_count: options.recentLogsCount,
                gear_logs_count: options.gearLogsCount,
                outing_date: options.outingDate,
            }, { signal }),
            'Erreur lors de la préparation de l\'analyse IA'
        );
    }

    /**
     * Fraîcheur des logs locaux d'un lot, sans rien récupérer sur geocaching.com.
     *
     * Appelé avant le bundle : c'est ce qui permet de proposer un rafraîchissement au
     * moment où il est encore utile, plutôt que de le regretter dans un avertissement
     * une fois le rapport parti.
     */
    async fetchLogsStatus(geocacheIds: number[], signal?: AbortSignal): Promise<OutingLogsStatus> {
        return this.apiClient.requestJson<OutingLogsStatus>(
            '/api/geocaches/analysis-logs-status',
            this.apiClient.createJsonInit('POST', { ids: geocacheIds }, { signal }),
            'Erreur lors de la lecture de l\'état des logs'
        );
    }

    /**
     * Rafraîchit les logs d'une géocache depuis Geocaching.com.
     *
     * Une géocache à la fois : l'appel scrape le logbook, et paralléliser sur une
     * sélection entière reviendrait à marteler geocaching.com. Pour un lot,
     * préférer `refreshLogsBatch` — un seul aller-retour au lieu d'un par cache.
     */
    async refreshLogs(id: number, count: number, signal?: AbortSignal): Promise<void> {
        await this.apiClient.requestVoid(
            `/api/geocaches/${id}/logs/refresh?count=${encodeURIComponent(String(count))}`,
            { method: 'POST', signal },
            'Erreur lors du rafraîchissement des logs'
        );
    }

    /**
     * Rafraîchit les logs de plusieurs géocaches en un seul appel streaming.
     *
     * Retourne la `Response` brute pour consommation NDJSON ligne par ligne
     * (`LogsRefreshBatchEvent`) : la boucle vit côté serveur, qui étale les
     * appels vers Geocaching.com et peut s'arrêter proprement si le client
     * se déconnecte.
     */
    async refreshLogsBatch(ids: number[], count: number, signal?: AbortSignal): Promise<Response> {
        const response = await this.apiClient.request(
            '/api/geocaches/logs/refresh-batch',
            this.apiClient.createJsonInit('POST', { geocache_ids: ids, count }, signal ? { signal } : {}),
        );
        await this.apiClient.ensureOk(response, 'Erreur lors du rafraîchissement des logs');
        return response;
    }
}
