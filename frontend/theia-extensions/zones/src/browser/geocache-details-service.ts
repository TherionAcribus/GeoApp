import { inject, injectable } from '@theia/core/shared/inversify';
import { BackendApiClient } from './backend-api-client';

export interface SaveWaypointInput {
    prefix?: string;
    lookup?: string;
    name?: string;
    type?: string;
    gc_coords?: string;
    note?: string;
    note_override?: string;
}

export interface UpdateDescriptionInput {
    description_override_raw?: string;
    description_override_html?: string;
}

export interface UpdateTranslatedContentInput {
    description_override_html?: string;
    description_override_raw?: string;
    hints_decoded_override?: string;
    waypoints?: Array<{ id: number; note_override: string }>;
}

export interface NotesListResponse {
    notes?: unknown[];
}

export interface ArchiveStatusResponse {
    exists?: boolean;
    needs_sync?: boolean;
    updated_at?: string;
}

export interface ArchiveSyncResponse {
    synced?: boolean;
    archive?: {
        updated_at?: string;
    };
}

@injectable()
export class GeocacheDetailsService {
    constructor(
        @inject(BackendApiClient) protected readonly apiClient: BackendApiClient
    ) {}

    async saveWaypoint<T = unknown>(
        geocacheId: number,
        waypointId: number | 'new' | undefined,
        payload: SaveWaypointInput
    ): Promise<T | undefined> {
        const isCreate = waypointId === undefined || waypointId === 'new';
        const path = isCreate
            ? `/api/geocaches/${geocacheId}/waypoints`
            : `/api/geocaches/${geocacheId}/waypoints/${waypointId}`;
        const method = isCreate ? 'POST' : 'PUT';
        return this.apiClient.requestOptionalJson<T>(
            path,
            this.apiClient.createJsonInit(method, payload),
            'Erreur lors de la sauvegarde du waypoint'
        );
    }

    async updateDescription(geocacheId: number, payload: UpdateDescriptionInput): Promise<void> {
        await this.apiClient.requestVoid(
            `/api/geocaches/${geocacheId}/description`,
            this.apiClient.createJsonInit('PUT', payload),
            'Erreur lors de la mise à jour de la description'
        );
    }

    async resetDescription(geocacheId: number): Promise<void> {
        await this.apiClient.requestVoid(
            `/api/geocaches/${geocacheId}/reset-description`,
            { method: 'POST' },
            'Erreur lors de la réinitialisation de la description'
        );
    }

    async resetCoordinates(geocacheId: number): Promise<void> {
        await this.apiClient.requestVoid(
            `/api/geocaches/${geocacheId}/reset-coordinates`,
            { method: 'POST' },
            'Erreur lors de la réinitialisation des coordonnées'
        );
    }

    async pushCorrectedCoordinates<T = { error?: string }>(geocacheId: number): Promise<T | undefined> {
        return this.apiClient.requestOptionalJson<T>(
            `/api/geocaches/${geocacheId}/push-corrected-coordinates`,
            { method: 'POST' },
            'Erreur lors de l\'envoi des coordonnées corrigées'
        );
    }

    async updateSolvedStatus(
        geocacheId: number,
        solvedStatus: 'not_solved' | 'in_progress' | 'solved'
    ): Promise<void> {
        await this.apiClient.requestVoid(
            `/api/geocaches/${geocacheId}/solved-status`,
            this.apiClient.createJsonInit('PUT', { solved_status: solvedStatus }),
            'Erreur lors de la mise à jour du statut'
        );
    }

    async syncNotesFromGeocaching<T = unknown>(geocacheId: number): Promise<T | undefined> {
        return this.apiClient.requestOptionalJson<T>(
            `/api/geocaches/${geocacheId}/notes/sync-from-geocaching`,
            { method: 'POST' },
            'Erreur lors de la synchronisation des notes Geocaching.com'
        );
    }

    async getNotes<T extends NotesListResponse = NotesListResponse>(geocacheId: number): Promise<T> {
        return this.apiClient.requestJson<T>(
            `/api/geocaches/${geocacheId}/notes`,
            {},
            'Erreur lors du chargement des notes'
        );
    }

    async updateTranslatedContent(
        geocacheId: number,
        payload: UpdateTranslatedContentInput
    ): Promise<void> {
        await this.apiClient.requestVoid(
            `/api/geocaches/${geocacheId}/translated-content`,
            this.apiClient.createJsonInit('PUT', payload),
            'Erreur lors de l\'enregistrement du contenu traduit'
        );
    }

    async pushWaypointCoordinates<T = { error?: string }>(
        geocacheId: number,
        waypointId: number
    ): Promise<T | undefined> {
        return this.apiClient.requestOptionalJson<T>(
            `/api/geocaches/${geocacheId}/waypoints/${waypointId}/push-coordinates`,
            { method: 'POST' },
            'Erreur lors de l\'envoi des coordonnées du waypoint'
        );
    }

    async getArchiveStatus<T extends ArchiveStatusResponse = ArchiveStatusResponse>(gcCode: string): Promise<T | undefined> {
        const response = await this.apiClient.request(`/api/archive/${encodeURIComponent(gcCode)}/status`);
        if (!response.ok) {
            return undefined;
        }
        return this.apiClient.readOptionalJson<T>(response);
    }

    async syncArchive<T extends ArchiveSyncResponse = ArchiveSyncResponse>(gcCode: string): Promise<T | undefined> {
        return this.apiClient.requestOptionalJson<T>(
            `/api/archive/${encodeURIComponent(gcCode)}/sync`,
            { method: 'POST' },
            'Erreur lors de la synchronisation de l\'archive'
        );
    }

    async resolveWorkflow<T>(geocacheId: number): Promise<T> {
        return this.apiClient.requestJson<T>(
            '/api/plugins/workflow/resolve',
            this.apiClient.createJsonInit('POST', { geocache_id: geocacheId }),
            'Erreur lors de la résolution du workflow'
        );
    }
}
