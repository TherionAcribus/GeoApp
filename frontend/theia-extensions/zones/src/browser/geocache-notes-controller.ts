import { inject, injectable } from '@theia/core/shared/inversify';
import { GcPersonalNoteAutoSyncMode, GeocacheDetailsPreferencesController } from './geocache-details-preferences-controller';
import { GeocacheNotesService } from './geocache-notes-service';
import {
    GeocacheNoteDto,
    GeocacheNoteType,
    GeocacheNotesApiResponse,
    SyncFromGeocachingResponse,
    SyncNoteToGeocachingResponse
} from './geocache-notes-types';

export type GeocacheNoteSyncConflictDecision = 'append' | 'replace' | 'cancel';

export interface SyncUserNoteToGeocachingRequest {
    geocacheId: number;
    note: GeocacheNoteDto;
    gcPersonalNote: string | null;
}

export interface SyncUserNoteToGeocachingResult {
    cancelled?: boolean;
    syncedFromGeocaching?: SyncFromGeocachingResponse;
    syncedToGeocaching?: SyncNoteToGeocachingResponse;
}

@injectable()
export class GeocacheNotesController {
    constructor(
        @inject(GeocacheNotesService) protected readonly notesService: GeocacheNotesService,
        @inject(GeocacheDetailsPreferencesController) protected readonly preferencesController: GeocacheDetailsPreferencesController
    ) {}

    getGcPersonalNoteAutoSyncMode(): GcPersonalNoteAutoSyncMode {
        return this.preferencesController.getGcPersonalNoteAutoSyncMode();
    }

    async loadNotes(geocacheId: number): Promise<GeocacheNotesApiResponse> {
        return this.notesService.getNotes(geocacheId);
    }

    async createNote(geocacheId: number, content: string, noteType: GeocacheNoteType): Promise<void> {
        await this.notesService.createNote(geocacheId, {
            content,
            note_type: noteType,
            source: 'user'
        });
    }

    async updateNote(noteId: number, content: string, noteType: GeocacheNoteType): Promise<void> {
        await this.notesService.updateNote(noteId, {
            content,
            note_type: noteType
        });
    }

    async deleteNote(noteId: number): Promise<void> {
        await this.notesService.deleteNote(noteId);
    }

    async syncFromGeocaching(geocacheId: number): Promise<SyncFromGeocachingResponse> {
        return this.notesService.syncFromGeocaching(geocacheId);
    }

    async syncUserNoteToGeocaching(
        request: SyncUserNoteToGeocachingRequest,
        resolveConflict: (existingGcNote: string, newText: string) => Promise<GeocacheNoteSyncConflictDecision>
    ): Promise<SyncUserNoteToGeocachingResult> {
        if (request.note.source !== 'user') {
            return { cancelled: true };
        }

        const newText = (request.note.content || '').trim();
        let finalContent = newText;
        let existingGcNote = (request.gcPersonalNote || '').trim();
        let syncedFromGeocaching: SyncFromGeocachingResponse | undefined;

        if (!existingGcNote) {
            syncedFromGeocaching = await this.notesService.syncFromGeocaching(request.geocacheId);
            existingGcNote = (syncedFromGeocaching.gc_personal_note || '').trim();
        }

        if (existingGcNote.length > 0) {
            const decision = await resolveConflict(existingGcNote, newText);
            if (decision === 'cancel') {
                return { cancelled: true, syncedFromGeocaching };
            }

            if (decision === 'append') {
                finalContent = existingGcNote && newText
                    ? `${existingGcNote}\n\n${newText}`
                    : existingGcNote || newText;
            }
        }

        const syncedToGeocaching = await this.notesService.syncToGeocaching(
            request.note.id,
            request.geocacheId,
            finalContent
        );

        return {
            syncedFromGeocaching,
            syncedToGeocaching
        };
    }
}
