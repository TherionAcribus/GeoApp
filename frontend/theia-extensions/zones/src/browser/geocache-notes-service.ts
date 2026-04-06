import { inject, injectable } from '@theia/core/shared/inversify';
import { BackendApiClient } from './backend-api-client';
import {
    CreateGeocacheNoteInput,
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

    async createNote(geocacheId: number, payload: CreateGeocacheNoteInput): Promise<void> {
        await this.apiClient.requestVoid(
            `/api/geocaches/${geocacheId}/notes`,
            this.apiClient.createJsonInit('POST', payload),
            'Erreur lors de la creation de la note'
        );
    }

    async updateNote(noteId: number, payload: UpdateGeocacheNoteInput): Promise<void> {
        await this.apiClient.requestVoid(
            `/api/notes/${noteId}`,
            this.apiClient.createJsonInit('PUT', payload),
            'Erreur lors de la mise a jour de la note'
        );
    }

    async deleteNote(noteId: number): Promise<void> {
        await this.apiClient.requestVoid(
            `/api/notes/${noteId}`,
            { method: 'DELETE' },
            'Erreur lors de la suppression de la note'
        );
    }

    async syncFromGeocaching(geocacheId: number): Promise<SyncFromGeocachingResponse> {
        return this.apiClient.requestJson<SyncFromGeocachingResponse>(
            `/api/geocaches/${geocacheId}/notes/sync-from-geocaching`,
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
}
