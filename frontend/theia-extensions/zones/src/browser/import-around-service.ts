/**
 * Service partagé pour l'import « autour de… » : résolution de la zone de
 * destination (zone existante ou nouvelle zone à créer, cas des cartes libres)
 * puis exécution de l'import en streaming.
 */

import { inject, injectable } from '@theia/core/shared/inversify';
import { GeocachesService } from './geocaches-service';
import { ZonesService } from './zones-service';
import { GeoAppWidgetEventsService } from './geoapp-widget-events-service';
import { ImportAroundRequest, ImportAroundTarget } from './import-around-dialog';

export interface ResolvedImportAroundZone {
    zoneId: number;
    /** Vrai si la zone vient d'être créée pour cet import. */
    created: boolean;
    name?: string;
}

export interface ImportAroundRunOptions {
    onProgress?: (percentage: number, message: string) => void;
    /** Appelé pour chaque erreur non fatale remontée par le flux d'import. */
    onError?: (message: string) => void;
    signal?: AbortSignal;
}

@injectable()
export class ImportAroundService {
    constructor(
        @inject(GeocachesService) protected readonly geocachesService: GeocachesService,
        @inject(ZonesService) protected readonly zonesService: ZonesService,
        @inject(GeoAppWidgetEventsService) protected readonly widgetEventsService: GeoAppWidgetEventsService,
    ) {}

    /**
     * Résout la zone de destination, en créant la zone si l'utilisateur en a
     * demandé une nouvelle.
     */
    async resolveTargetZone(target: ImportAroundTarget): Promise<ResolvedImportAroundZone> {
        if (target.type === 'existing_zone') {
            return { zoneId: target.zone_id, created: false };
        }

        const name = target.name.trim();
        if (!name) {
            throw new Error('Nom de la nouvelle zone manquant');
        }

        const zone = await this.zonesService.create({ name });
        this.widgetEventsService.notifyZoneListChanged();
        return { zoneId: zone.id, created: true, name: zone.name };
    }

    /**
     * Lance l'import dans la zone donnée et renvoie le message de résumé final
     * émis par le backend (s'il y en a un).
     */
    async run(
        zoneId: number,
        request: ImportAroundRequest,
        options: ImportAroundRunOptions = {}
    ): Promise<string | undefined> {
        const { onProgress, onError, signal } = options;

        onProgress?.(0, 'Démarrage…');

        const payload = {
            zone_id: zoneId,
            center: request.center,
            limit: request.limit,
            ...(request.radius_km !== undefined ? { radius_km: request.radius_km } : {}),
            ...(request.min_km !== undefined ? { min_km: request.min_km } : {}),
            ...(request.filters && request.filters.length > 0 ? { filters: request.filters } : {}),
        };

        const response = await this.geocachesService.importAround(payload, signal);
        if (!response.body) {
            throw new Error('Réponse streaming non supportée');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let buffer = '';
        let summary: string | undefined;

        const handleLine = (line: string): void => {
            const trimmed = (line || '').trim();
            if (!trimmed) {
                return;
            }
            try {
                const data = JSON.parse(trimmed);
                if (data.error) {
                    const message = data.message || 'Erreur lors de l\'import';
                    onProgress?.(0, message);
                    onError?.(message);
                    return;
                }

                const percentage = typeof data.progress === 'number' ? data.progress : undefined;
                const message = data.message || '';

                if (percentage !== undefined) {
                    onProgress?.(percentage, message);
                }

                if (data.final_summary) {
                    summary = message;
                }
            } catch (e) {
                console.error('Error parsing import-around progress data:', e);
            }
        };

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                handleLine(line);
            }
        }

        handleLine(buffer);

        return summary;
    }
}
