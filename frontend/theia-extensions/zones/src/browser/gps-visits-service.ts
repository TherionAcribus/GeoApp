import { inject, injectable } from '@theia/core/shared/inversify';
import { BackendApiClient } from './backend-api-client';
import {
    DetectedVisitsFile,
    GpsImportReport,
    GpsPreparedDay,
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

    async prepare(day: string, zoneId?: number): Promise<GpsPreparedDay> {
        return this.apiClient.requestJson<GpsPreparedDay>(
            '/api/gps-visits/prepare',
            this.apiClient.createJsonInit('POST', zoneId === undefined ? { day } : { day, zone_id: zoneId }),
            'Erreur lors de la préparation des logs'
        );
    }

    /** Flux de progression (une ligne JSON par cache), à lire avec `consumeImportStream`. */
    async importMissing(zoneId: number, gcCodes: string[], signal?: AbortSignal): Promise<Response> {
        return this.apiClient.requestResponse(
            '/api/gps-visits/import-missing',
            this.apiClient.createJsonInit('POST', { zone_id: zoneId, gc_codes: gcCodes }, { signal }),
            'Erreur lors de l\'import des caches'
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
