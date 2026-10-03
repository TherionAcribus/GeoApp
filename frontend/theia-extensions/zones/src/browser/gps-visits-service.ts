import { inject, injectable } from '@theia/core/shared/inversify';
import { BackendApiClient } from './backend-api-client';
import {
    DetectedVisitsFile,
    GpsImportReport,
    GpsPreparation,
    GpsResolutionResult,
    GpsVisitState,
    GpsVisitsListing,
} from './gps-visits-model';

/** Client de `/api/gps-visits` (voir documentation/garmin-visites-technique.md). */
@injectable()
export class GpsVisitsService {
    constructor(
        @inject(BackendApiClient) protected readonly apiClient: BackendApiClient
    ) {}

    async detect(): Promise<DetectedVisitsFile[]> {
        const body = await this.apiClient.requestJson<{ files: DetectedVisitsFile[] }>(
            '/api/gps-visits/detect', {}, 'Erreur lors de la recherche du GPS'
        );
        return body.files || [];
    }

    async importFile(file: File): Promise<GpsImportReport> {
        const formData = new FormData();
        formData.append('visitsFile', file);
        return this.apiClient.requestJson<GpsImportReport>(
            '/api/gps-visits/import', { method: 'POST', body: formData }, 'Erreur lors de l\'import des visites'
        );
    }

    async importPath(path: string): Promise<GpsImportReport> {
        return this.apiClient.requestJson<GpsImportReport>(
            '/api/gps-visits/import',
            this.apiClient.createJsonInit('POST', { path }),
            'Erreur lors de l\'import des visites'
        );
    }

    async setCutoff(since: string): Promise<{ cutoff: string; to_history: number; to_pending: number }> {
        return this.apiClient.requestJson(
            '/api/gps-visits/cutoff',
            this.apiClient.createJsonInit('POST', { since }),
            'Erreur lors du choix du point de départ'
        );
    }

    async list(states: GpsVisitState[] = ['pending']): Promise<GpsVisitsListing> {
        return this.apiClient.requestJson<GpsVisitsListing>(
            `/api/gps-visits?state=${encodeURIComponent(states.join(','))}`,
            {},
            'Erreur lors du chargement des visites'
        );
    }

    /** Récapitulatif de « Préparer la sortie » pour ces visites, dans cette zone (ou une zone à créer). */
    async prepare(visitIds: number[], zoneId?: number): Promise<GpsPreparation> {
        return this.apiClient.requestJson<GpsPreparation>(
            '/api/gps-visits/prepare',
            this.apiClient.createJsonInit('POST', zoneId === undefined ? { visit_ids: visitIds } : { visit_ids: visitIds, zone_id: zoneId }),
            'Erreur lors de la préparation de la sortie'
        );
    }

    /**
     * Ajoute les caches des visites à la zone de la sortie. Flux de progression (une ligne
     * JSON par cache) à lire avec `consumeImportStream` ; annulable par `cancelZoneOperation`.
     */
    async startZoneOperation(
        operationId: string,
        zone: { zoneId: number } | { newZoneName: string },
        visitIds: number[]
    ): Promise<Response> {
        const target = 'zoneId' in zone ? { zone_id: zone.zoneId } : { new_zone_name: zone.newZoneName };
        return this.apiClient.requestResponse(
            '/api/gps-visits/zone-operations',
            this.apiClient.createJsonInit('POST', { operation_id: operationId, visit_ids: visitIds, ...target }),
            "Erreur lors de l'ajout à la zone"
        );
    }

    /** En cours : arrêt entre deux caches. Terminé : retrait immédiat des caches ajoutées. */
    async cancelZoneOperation(operationId: string): Promise<{ state?: string; message?: string }> {
        return this.apiClient.requestJson(
            `/api/gps-visits/zone-operations/${encodeURIComponent(operationId)}/cancel`,
            this.apiClient.createJsonInit('POST'),
            "Erreur lors de l'annulation de l'ajout"
        );
    }

    /** Candidats pour une visite sans code. `deep` : aussi l'ordre de mes trouvailles (~1 min). */
    async candidates(visitId: number, deep = false): Promise<GpsResolutionResult> {
        return this.apiClient.requestJson<GpsResolutionResult>(
            `/api/gps-visits/${visitId}/candidates${deep ? '?deep=1' : ''}`,
            {},
            'Erreur lors de la recherche de candidats'
        );
    }

    /** Rattache une visite sans code à une cache, ou la détache (`gcCode` nul). */
    async resolve(visitId: number, gcCode: string | null, source: 'neighbours' | 'my_finds' | 'manual' = 'manual'): Promise<void> {
        await this.apiClient.requestJson(
            `/api/gps-visits/${visitId}/resolve`,
            this.apiClient.createJsonInit('POST', { gc_code: gcCode, source }),
            'Erreur lors du rattachement de la visite'
        );
    }

    async setState(ids: number[], state: Exclude<GpsVisitState, 'history'>): Promise<number> {
        const body = await this.apiClient.requestJson<{ updated: number }>(
            '/api/gps-visits/state',
            this.apiClient.createJsonInit('POST', { ids, state }),
            'Erreur lors de la mise à jour des visites'
        );
        return body.updated;
    }
}
