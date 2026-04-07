import { inject, injectable } from '@theia/core/shared/inversify';
import { ResolutionWorkflowStepRunResponse } from '@mysterai/theia-plugins/lib/common/plugin-protocol';
import { BackendApiClient } from './backend-api-client';
import {
    ArchiveEntry,
    ArchiveListResponse,
    ArchiveSettings,
    ArchiveSettingsUpdateResponse,
    ArchiveStats,
    BulkDeleteArchivesInput,
    BulkDeleteArchivesResponse,
    GeocacheApiResponse
} from './archive-manager-types';

export interface ListArchivesRequest {
    page: number;
    perPage?: number;
    solvedStatus?: string;
    gcCode?: string;
}

@injectable()
export class ArchiveManagerService {
    constructor(
        @inject(BackendApiClient) protected readonly apiClient: BackendApiClient
    ) {}

    async getStats(): Promise<ArchiveStats> {
        return this.apiClient.requestJson<ArchiveStats>(
            '/api/archive/stats',
            {},
            'Erreur lors du chargement des statistiques d\'archive'
        );
    }

    async getSettings(): Promise<ArchiveSettings> {
        return this.apiClient.requestJson<ArchiveSettings>(
            '/api/archive/settings',
            {},
            'Erreur lors du chargement des parametres d\'archive'
        );
    }

    async updateSettings(autoSyncEnabled: boolean): Promise<ArchiveSettingsUpdateResponse> {
        return this.apiClient.requestJson<ArchiveSettingsUpdateResponse>(
            '/api/archive/settings',
            this.apiClient.createJsonInit('PUT', { auto_sync_enabled: autoSyncEnabled }),
            'Erreur lors de la mise a jour des parametres d\'archive'
        );
    }

    async listArchives(request: ListArchivesRequest): Promise<ArchiveListResponse> {
        const params = new URLSearchParams({
            page: String(request.page),
            per_page: String(request.perPage ?? 12),
        });
        if (request.solvedStatus) {
            params.set('solved_status', request.solvedStatus);
        }
        if (request.gcCode?.trim()) {
            params.set('gc_code', request.gcCode.trim().toUpperCase());
        }

        return this.apiClient.requestJson<ArchiveListResponse>(
            `/api/archive?${params.toString()}`,
            {},
            'Erreur lors du chargement des archives'
        );
    }

    async getArchive(gcCode: string): Promise<ArchiveEntry> {
        return this.apiClient.requestJson<ArchiveEntry>(
            `/api/archive/${encodeURIComponent(gcCode)}`,
            {},
            'Erreur lors du chargement du detail d\'archive'
        );
    }

    async getLiveGeocacheByCode(gcCode: string): Promise<GeocacheApiResponse | null> {
        const response = await this.apiClient.request(`/api/geocaches/by-code/${encodeURIComponent(gcCode)}`);
        if (response.status === 404 || response.status === 409) {
            return null;
        }
        await this.apiClient.ensureOk(response, 'Erreur lors du chargement de la geocache live');
        return await this.apiClient.readOptionalJson<GeocacheApiResponse>(response) ?? null;
    }

    async runWorkflowNextStep(request: Record<string, unknown>): Promise<ResolutionWorkflowStepRunResponse> {
        return this.apiClient.requestJson<ResolutionWorkflowStepRunResponse>(
            '/api/plugins/workflow/run-next-step',
            this.apiClient.createJsonInit('POST', request),
            'Erreur lors du rejeu workflow'
        );
    }

    async updateResolutionDiagnostics(gcCode: string, diagnostics: Record<string, unknown>): Promise<void> {
        await this.apiClient.requestVoid(
            `/api/archive/${encodeURIComponent(gcCode)}/resolution-diagnostics`,
            this.apiClient.createJsonInit('PUT', diagnostics),
            'Erreur lors de la persistance du diagnostic d\'archive'
        );
    }

    async bulkDeleteArchives(payload: BulkDeleteArchivesInput): Promise<BulkDeleteArchivesResponse> {
        return this.apiClient.requestJson<BulkDeleteArchivesResponse>(
            '/api/archive',
            this.apiClient.createJsonInit('DELETE', payload),
            'Erreur lors de la suppression en masse des archives'
        );
    }
}
