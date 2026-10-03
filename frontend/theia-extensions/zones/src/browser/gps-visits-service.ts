import { inject, injectable } from '@theia/core/shared/inversify';
import { BackendApiClient } from './backend-api-client';
import {
    DetectedDevice,
    GpsImportReport,
    GpsDayResolution,
    GpsFoundCheck,
    GpsPreparation,
    GpsResolutionResult,
    GpsUndo,
    GpsVisitSnapshot,
    GpsVisitState,
    GpsVisitsListing,
} from './gps-visits-model';

/** Client de `/api/gps-visits` (voir documentation/garmin-visites-technique.md). */
@injectable()
export class GpsVisitsService {
    constructor(
        @inject(BackendApiClient) protected readonly apiClient: BackendApiClient
    ) {}

    /** GPS branchés (dossier Garmin : visites, traces, GPX des caches). */
    async detect(): Promise<DetectedDevice[]> {
        const body = await this.apiClient.requestJson<{ devices?: DetectedDevice[] }>(
            '/api/gps-visits/detect', {}, 'Erreur lors de la recherche du GPS'
        );
        return body.devices || [];
    }

    /** Tout le GPS : visites (XML puis TXT), GPX des caches, positionnement sur les traces. */
    async importDevice(root: string): Promise<GpsImportReport> {
        return this.apiClient.requestJson<GpsImportReport>(
            '/api/gps-visits/import',
            this.apiClient.createJsonInit('POST', { device: root }),
            "Erreur lors de l'import du GPS"
        );
    }

    /** Fichiers déposés (GPS sans lettre de lecteur) : visites XML/TXT, traces et GPX de caches. */
    async importFiles(files: File[]): Promise<GpsImportReport> {
        const formData = new FormData();
        for (const file of files) {
            formData.append('files', file);
        }
        return this.apiClient.requestJson<GpsImportReport>(
            '/api/gps-visits/import', { method: 'POST', body: formData }, "Erreur lors de l'import des visites"
        );
    }

    /** Positionne les visites sur les traces du GPS branché (toutes celles à loguer, ou ces jours). */
    async position(days?: string[]): Promise<{ positioned: number; no_track: number; days: number }> {
        return this.apiClient.requestJson(
            '/api/gps-visits/position',
            this.apiClient.createJsonInit('POST', days ? { days } : {}),
            'Erreur lors du positionnement des visites'
        );
    }

    async importPath(path: string): Promise<GpsImportReport> {
        return this.apiClient.requestJson<GpsImportReport>(
            '/api/gps-visits/import',
            this.apiClient.createJsonInit('POST', { path }),
            'Erreur lors de l\'import des visites'
        );
    }

    /** `previous_cutoff` : point de départ d'avant, pour « Annuler » (nul : il n'y en avait pas). */
    async setCutoff(since: string): Promise<{ cutoff: string; to_history: number; to_pending: number; previous_cutoff: string | null }> {
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

    /** Récapitulatif de « Préparer la sortie » pour ces visites, dans cette zone (ou une zone à créer). */
    async prepare(visitIds: number[], zoneId?: number): Promise<GpsPreparation> {
        return this.apiClient.requestJson<GpsPreparation>(
            '/api/gps-visits/prepare',
            this.apiClient.createJsonInit('POST', zoneId === undefined ? { visit_ids: visitIds } : { visit_ids: visitIds, zone_id: zoneId }),
            'Erreur lors de la préparation de la sortie'
        );
    }

    /**
     * Ajoute les caches des visites à la zone de la sortie. Flux de progression (une ligne
     * JSON par cache) à lire avec `consumeImportStream` ; annulable par `cancelZoneOperation`.
     */
    async startZoneOperation(
        operationId: string,
        zone: { zoneId: number } | { newZoneName: string },
        visitIds: number[]
    ): Promise<Response> {
        const target = 'zoneId' in zone ? { zone_id: zone.zoneId } : { new_zone_name: zone.newZoneName };
        return this.apiClient.requestResponse(
            '/api/gps-visits/zone-operations',
            this.apiClient.createJsonInit('POST', { operation_id: operationId, visit_ids: visitIds, ...target }),
            "Erreur lors de l'ajout à la zone"
        );
    }

    /** En cours : arrêt entre deux caches. Terminé : retrait immédiat des caches ajoutées. */
    async cancelZoneOperation(operationId: string): Promise<{ state?: string; message?: string }> {
        return this.apiClient.requestJson(
            `/api/gps-visits/zone-operations/${encodeURIComponent(operationId)}/cancel`,
            this.apiClient.createJsonInit('POST'),
            "Erreur lors de l'annulation de l'ajout"
        );
    }

    /** Candidats pour une visite sans code. `deep` : aussi l'ordre de mes trouvailles (~1 min). */
    async candidates(visitId: number, deep = false): Promise<GpsResolutionResult> {
        return this.apiClient.requestJson<GpsResolutionResult>(
            `/api/gps-visits/${visitId}/candidates${deep ? '?deep=1' : ''}`,
            {},
            'Erreur lors de la recherche de candidats'
        );
    }

    /** Rattache une visite sans code à une cache, ou la détache (`gcCode` nul). Renvoie l'état d'avant. */
    async resolve(
        visitId: number, gcCode: string | null, source: 'neighbours' | 'my_finds' | 'track' | 'manual' = 'manual'
    ): Promise<GpsVisitSnapshot[]> {
        const body = await this.apiClient.requestJson<{ previous?: GpsVisitSnapshot[] }>(
            `/api/gps-visits/${visitId}/resolve`,
            this.apiClient.createJsonInit('POST', { gc_code: gcCode, source }),
            'Erreur lors du rattachement de la visite'
        );
        return body.previous ?? [];
    }

    /** Annule une action de la liste : état, rattachement ou point de départ d'avant. */
    async restore(undo: GpsUndo): Promise<void> {
        await this.apiClient.requestJson(
            '/api/gps-visits/restore',
            this.apiClient.createJsonInit('POST', undo),
            "Erreur lors de l'annulation"
        );
    }

    /** « Vérifier sur Geocaching.com » : ma date de trouvaille des caches à loguer données. */
    async checkFound(visitIds: number[]): Promise<GpsFoundCheck> {
        return this.apiClient.requestJson<GpsFoundCheck>(
            '/api/gps-visits/check-found',
            this.apiClient.createJsonInit('POST', { visit_ids: visitIds }),
            'Erreur lors de la vérification sur Geocaching.com'
        );
    }

    /** Tracés enregistrés de ces jours : lignes de [lat, lon]. */
    async tracks(days: string[]): Promise<Record<string, Array<[number, number]>>> {
        if (days.length === 0) {
            return {};
        }
        const body = await this.apiClient.requestJson<{ tracks: { day: string; points: [number, number, number][] }[] }>(
            `/api/gps-visits/tracks?days=${encodeURIComponent(days.join(','))}`, {}, 'Erreur lors du chargement des tracés'
        );
        return Object.fromEntries(body.tracks.map(track => [track.day, track.points.map(([lat, lon]) => [lat, lon] as [number, number])]));
    }

    /** Une cache proposée pour chaque visite sans code du jour, d'après la trace (jusqu'à une minute). */
    async dayResolution(day: string): Promise<GpsDayResolution> {
        return this.apiClient.requestJson<GpsDayResolution>(
            '/api/gps-visits/day-resolution',
            this.apiClient.createJsonInit('POST', { day }),
            'Erreur lors de la recherche des caches du jour'
        );
    }

    /** Rattache plusieurs visites sans code d'un coup. */
    async resolveBatch(
        items: { visit_id: number; gc_code: string; source: 'track' | 'manual' }[]
    ): Promise<{ resolved: number; previous: GpsVisitSnapshot[] }> {
        const body = await this.apiClient.requestJson<{ resolved: number; previous?: GpsVisitSnapshot[] }>(
            '/api/gps-visits/resolve-batch',
            this.apiClient.createJsonInit('POST', { items }),
            'Erreur lors du rattachement des visites'
        );
        return { resolved: body.resolved, previous: body.previous ?? [] };
    }

    /** Renvoie aussi l'état d'avant des visites changées, pour « Annuler ». */
    async setState(ids: number[], state: Exclude<GpsVisitState, 'history'>): Promise<{ updated: number; previous: GpsVisitSnapshot[] }> {
        const body = await this.apiClient.requestJson<{ updated: number; previous?: GpsVisitSnapshot[] }>(
            '/api/gps-visits/state',
            this.apiClient.createJsonInit('POST', { ids, state }),
            'Erreur lors de la mise à jour des visites'
        );
        return { updated: body.updated, previous: body.previous ?? [] };
    }
}
