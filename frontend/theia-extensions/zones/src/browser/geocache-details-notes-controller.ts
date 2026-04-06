import { inject, injectable } from '@theia/core/shared/inversify';
import { GeocacheDetailsPreferencesController } from './geocache-details-preferences-controller';
import { GeocacheDetailsService } from './geocache-details-service';

@injectable()
export class GeocacheDetailsNotesController {
    constructor(
        @inject(GeocacheDetailsPreferencesController) protected readonly preferencesController: GeocacheDetailsPreferencesController,
        @inject(GeocacheDetailsService) protected readonly geocacheDetailsService: GeocacheDetailsService
    ) {}

    async loadNotesCount(geocacheId?: number): Promise<number | undefined> {
        if (!geocacheId) {
            return undefined;
        }

        const data = await this.geocacheDetailsService.getNotes(geocacheId);
        return Array.isArray(data.notes) ? data.notes.length : 0;
    }

    async autoSyncFromDetailsIfEnabled(geocacheId?: number): Promise<void> {
        if (!geocacheId) {
            return;
        }
        if (this.preferencesController.getGcPersonalNoteAutoSyncMode() !== 'onDetailsOpen') {
            return;
        }
        await this.geocacheDetailsService.syncNotesFromGeocaching(geocacheId);
    }
}
