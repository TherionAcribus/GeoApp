import { inject, injectable } from '@theia/core/shared/inversify';
import { GeocacheDetailsService } from './geocache-details-service';

export type GeocacheArchiveStatus = 'synced' | 'needs_sync' | 'none' | 'loading';

export interface GeocacheArchiveState {
    status: GeocacheArchiveStatus;
    updatedAt?: string;
}

@injectable()
export class GeocacheDetailsArchiveController {
    constructor(
        @inject(GeocacheDetailsService) protected readonly geocacheDetailsService: GeocacheDetailsService
    ) {}

    async loadArchiveState(gcCode?: string): Promise<GeocacheArchiveState> {
        if (!gcCode) {
            return { status: 'none' };
        }

        try {
            const json = await this.geocacheDetailsService.getArchiveStatus(gcCode);
            if (!json) {
                return { status: 'none' };
            }
            if (json.exists) {
                return {
                    status: 'synced',
                    updatedAt: json.updated_at
                };
            }
            if (json.needs_sync) {
                return { status: 'needs_sync' };
            }
            return { status: 'none' };
        } catch {
            return { status: 'none' };
        }
    }

    async syncArchive(gcCode: string): Promise<GeocacheArchiveState> {
        const json = await this.geocacheDetailsService.syncArchive(gcCode);
        if (json?.synced && json.archive) {
            return {
                status: 'synced',
                updatedAt: json.archive.updated_at
            };
        }
        return { status: 'needs_sync' };
    }
}
