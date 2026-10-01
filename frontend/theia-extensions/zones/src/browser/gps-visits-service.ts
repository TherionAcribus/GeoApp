import { inject, injectable } from '@theia/core/shared/inversify';
import { BackendApiClient } from './backend-api-client';
import {
    DetectedVisitsFile,
    GpsImportReport,
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

    async setState(ids: number[], state: Exclude<GpsVisitState, 'history'>): Promise<number> {
        const body = await this.apiClient.requestJson<{ updated: number }>(
            '/api/gps-visits/state',
            this.apiClient.createJsonInit('POST', { ids, state }),
            'Erreur lors de la mise à jour des visites'
        );
        return body.updated;
    }
}
