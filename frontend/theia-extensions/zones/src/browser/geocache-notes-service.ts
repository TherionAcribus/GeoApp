import { inject, injectable } from '@theia/core/shared/inversify';
import { BackendApiClient } from './backend-api-client';
import {
    CreateGeocacheNoteInput,
    GeocacheNoteDto,
    GeocacheNotesApiResponse,
    SyncFromGeocachingResponse,
    SyncNoteToGeocachingResponse,
    UpdateGeocacheNoteInput
} from './geocache-notes-types';

@injectable()
export class GeocacheNotesService {
    constructor(
        @inject(BackendApiClient) protected readonly apiClient: BackendApiClient
    ) {}

    async getNotes(geocacheId: number): Promise<GeocacheNotesApiResponse> {
        return this.apiClient.requestJson<GeocacheNotesApiResponse>(
            `/api/geocaches/${geocacheId}/notes`,
            {},
            'Erreur lors du chargement des notes'
        );
    }

    async createNote(geocacheId: number, payload: CreateGeocacheNoteInput): Promise<GeocacheNoteDto> {
        const response = await this.apiClient.requestJson<{ note: GeocacheNoteDto }>(
            `/api/geocaches/${geocacheId}/notes`,
            this.apiClient.createJsonInit('POST', payload),
            'Erreur lors de la creation de la note'
        );
        return response.note;
    }

    async updateNote(noteId: number, payload: UpdateGeocacheNoteInput): Promise<GeocacheNoteDto> {
        const response = await this.apiClient.requestJson<{ note: GeocacheNoteDto }>(
            `/api/notes/${noteId}`,
            this.apiClient.createJsonInit('PUT', payload),
            'Erreur lors de la mise a jour de la note'
        );
        return response.note;
    }

    async deleteNote(noteId: number): Promise<void> {
        await this.apiClient.requestVoid(
            `/api/notes/${noteId}`,
            { method: 'DELETE' },
            'Erreur lors de la suppression de la note'
        );
    }

    async syncFromGeocaching(geocacheId: number, force: boolean = false): Promise<SyncFromGeocachingResponse> {
        const query = force ? '?force=true' : '';
        return this.apiClient.requestJson<SyncFromGeocachingResponse>(
            `/api/geocaches/${geocacheId}/notes/sync-from-geocaching${query}`,
            { method: 'POST' },
            'Erreur lors de la synchronisation des notes Geocaching.com'
        );
    }

    async syncToGeocaching(
        noteId: number,
        geocacheId: number,
        content: string
    ): Promise<SyncNoteToGeocachingResponse> {
        return this.apiClient.requestJson<SyncNoteToGeocachingResponse>(
            `/api/notes/${noteId}/sync-to-geocaching?geocacheId=${geocacheId}`,
            this.apiClient.createJsonInit('POST', { content }),
            'Erreur lors de l\'envoi de la note vers Geocaching.com'
        );
    }

    async syncPersonalNoteToGeocaching(geocacheId: number, content: string): Promise<SyncNoteToGeocachingResponse> {
        return this.apiClient.requestJson<SyncNoteToGeocachingResponse>(
            `/api/geocaches/${geocacheId}/notes/sync-to-geocaching`,
            this.apiClient.createJsonInit('POST', { content }),
            'Erreur lors de l\'envoi de la note vers Geocaching.com'
        );
    }
}
