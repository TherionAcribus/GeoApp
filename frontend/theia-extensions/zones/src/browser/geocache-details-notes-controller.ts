import { inject, injectable } from '@theia/core/shared/inversify';
import { GeocacheDetailsPreferencesController } from './geocache-details-preferences-controller';
import { GeocacheNotesService } from './geocache-notes-service';
import { GeocacheNotesApiResponse } from './geocache-notes-types';

@injectable()
export class GeocacheDetailsNotesController {
    constructor(
        @inject(GeocacheDetailsPreferencesController) protected readonly preferencesController: GeocacheDetailsPreferencesController,
        @inject(GeocacheNotesService) protected readonly geocacheNotesService: GeocacheNotesService
    ) {}

    /** Contenu complet des notes, chargé à la demande (aperçu déplié). */
    async loadNotes(geocacheId: number): Promise<GeocacheNotesApiResponse> {
        return this.geocacheNotesService.getNotes(geocacheId);
    }

    async loadNotesCount(geocacheId?: number): Promise<number | undefined> {
        if (!geocacheId) {
            return undefined;
        }

        const data = await this.geocacheNotesService.getNotes(geocacheId);
        return Array.isArray(data.notes) ? data.notes.length : 0;
    }

    async autoSyncFromDetailsIfEnabled(geocacheId?: number): Promise<void> {
        if (!geocacheId) {
            return;
        }
        if (this.preferencesController.getGcPersonalNoteAutoSyncMode() !== 'onDetailsOpen') {
            return;
        }
        await this.geocacheNotesService.syncFromGeocaching(geocacheId);
    }
}
