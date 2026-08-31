import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { BackendApiClient } from 'theia-ide-zones-ext/lib/browser/backend-api-client';
import { GeocachesService } from 'theia-ide-zones-ext/lib/browser/geocaches-service';
import { GeocacheNotesService } from 'theia-ide-zones-ext/lib/browser/geocache-notes-service';
import { GeocacheNoteDto } from 'theia-ide-zones-ext/lib/browser/geocache-notes-types';
import { GeocacheDto } from 'theia-ide-zones-ext/lib/browser/geocache-details-types';
import { EarthCoachGeocacheData, GeoImage, LoggingTask, UserObservation } from './earthcoach-types';
import { LoggingTaskDto } from './earthcoach-logging-tasks';
import {
    EARTHCOACH_LOGGING_TASKS_UPDATED_EVENT,
    EARTHCOACH_OBSERVATIONS_UPDATED_EVENT,
    GEOAPP_GEOCACHE_IMAGES_UPDATED_EVENT,
    readUpdatedGeocacheId,
    subscribeEarthCoachDataUpdates,
} from './earthcoach-events';
import {
    assembleEarthCoachContext,
    BackendGeocacheImageDto,
    createEmptyEarthCoachContextPayload,
    EarthCoachContext,
    EarthCoachContextApiResponse,
    EarthCoachContextCache,
    EarthCoachContextPayload,
    mapBackendImages,
    mapLoggingTasks,
    mapObservations,
    parseEarthCoachContextResponse,
    UserObservationDto,
} from './earthcoach-context-data';

interface WidgetInfo {
    geocacheId?: number;
    geocacheData?: GeocacheDto;
}

export interface EarthCoachContextRequest {
    geocacheData?: EarthCoachGeocacheData;
    geocacheId?: number;
    /**
     * Ignore le micro-cache. A utiliser apres une mutation (creation d'une
     * observation, extraction de questions, ajout de photo): un widget qui se
     * rafraichit doit voir la donnee qu'il vient d'ecrire.
     */
    forceRefresh?: boolean;
}

export { EarthCoachContext } from './earthcoach-context-data';

@injectable()
export class EarthCoachContextService implements FrontendApplicationContribution {

    protected initialized = false;
    protected lastGeocache: WidgetInfo | undefined;
    protected readonly cache = new EarthCoachContextCache();
    /**
     * Passe a false des qu'un backend repond 404 sur la route agregee: une
     * version plus ancienne ne la connait pas, on retombe alors definitivement
     * sur les quatre routes unitaires plutot que de payer un 404 a chaque fois.
     */
    protected aggregatedEndpointAvailable = true;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    @inject(GeocachesService)
    protected readonly geocachesService!: GeocachesService;

    @inject(GeocacheNotesService)
    protected readonly notesService!: GeocacheNotesService;

    @inject(BackendApiClient)
    protected readonly apiClient!: BackendApiClient;

    onStart(): void {
        this.ensureInitialized();
    }

    /**
     * Resout seulement la geocache active (sans charger images, observations,
     * notes ni logging tasks). Utile pour verifier tot qu'il s'agit d'une
     * EarthCache et afficher le QuickPick avant la collecte reseau complete.
     */
    async resolveGeocache(input?: EarthCoachContextRequest): Promise<EarthCoachGeocacheData | undefined> {
        this.ensureInitialized();
        return this.resolveGeocacheData(input);
    }

    async collectContext(input?: EarthCoachContextRequest): Promise<EarthCoachContext | undefined> {
        this.ensureInitialized();
        const geocacheData = await this.resolveGeocacheData(input);
        if (!geocacheData) {
            return undefined;
        }
        const payload = await this.cache.load(
            geocacheData.id,
            () => this.loadPayload(geocacheData.id),
            { forceRefresh: input?.forceRefresh }
        );
        return assembleEarthCoachContext(geocacheData, payload);
    }

    /** Oublie les donnees en cache d'une geocache (ou de toutes sans argument). */
    invalidate(geocacheId?: number): void {
        if (geocacheId === undefined) {
            this.cache.clear();
            return;
        }
        this.cache.invalidate(geocacheId);
    }

    protected ensureInitialized(): void {
        if (this.initialized) {
            return;
        }
        this.initialized = true;
        this.shell.onDidChangeActiveWidget(({ newValue }) => {
            const info = this.parseWidget(newValue as any);
            if (info?.geocacheId || info?.geocacheData) {
                this.lastGeocache = info;
            }
        });
        // Toute mutation signalee peremptorise le cache de la geocache visee:
        // meme si l'appelant oublie `forceRefresh`, il ne relira pas d'anciennes
        // observations ou questions.
        subscribeEarthCoachDataUpdates(
            [
                EARTHCOACH_OBSERVATIONS_UPDATED_EVENT,
                EARTHCOACH_LOGGING_TASKS_UPDATED_EVENT,
                GEOAPP_GEOCACHE_IMAGES_UPDATED_EVENT,
            ],
            detail => {
                const geocacheId = readUpdatedGeocacheId(detail);
                if (geocacheId !== undefined) {
                    this.cache.invalidate(geocacheId);
                }
            }
        );
    }

    protected async resolveGeocacheData(input?: EarthCoachContextRequest): Promise<EarthCoachGeocacheData | undefined> {
        if (input?.geocacheData) {
            return input.geocacheData;
        }
        if (input?.geocacheId) {
            return this.geocachesService.get<GeocacheDto>(input.geocacheId);
        }

        const activeInfo = this.parseWidget(this.shell.activeWidget as any) || this.parseWidget(this.shell.currentWidget as any);
        const contextInfo = activeInfo?.geocacheId || activeInfo?.geocacheData ? activeInfo : this.lastGeocache;
        if (contextInfo?.geocacheData) {
            return contextInfo.geocacheData;
        }
        if (contextInfo?.geocacheId) {
            return this.geocachesService.get<GeocacheDto>(contextInfo.geocacheId);
        }
        return undefined;
    }

    protected parseWidget(widget: any): WidgetInfo | undefined {
        if (!widget?.id || !String(widget.id).startsWith('geocache.details.widget')) {
            return undefined;
        }
        const geocacheData = widget.data as GeocacheDto | undefined;
        if (geocacheData?.id) {
            return { geocacheId: geocacheData.id, geocacheData };
        }
        if (typeof widget.geocacheId === 'number') {
            return { geocacheId: widget.geocacheId };
        }
        return undefined;
    }

    /**
     * Charge la part reseau du contexte. Un seul aller-retour via la route
     * agregee; les quatre routes unitaires ne servent que de repli.
     */
    protected async loadPayload(geocacheId: number): Promise<EarthCoachContextPayload> {
        if (this.aggregatedEndpointAvailable) {
            const aggregated = await this.loadAggregatedPayload(geocacheId);
            if (aggregated) {
                return aggregated;
            }
        }
        return this.loadPayloadFromUnitaryEndpoints(geocacheId);
    }

    protected async loadAggregatedPayload(geocacheId: number): Promise<EarthCoachContextPayload | undefined> {
        try {
            const baseUrl = this.apiClient.getBaseUrl();
            const response = await fetch(`${baseUrl}/api/geocaches/${geocacheId}/earthcoach-context`, { credentials: 'include' });
            if (response.status === 404) {
                // 404 sur une geocache existante et 404 "route inconnue" se
                // distinguent par le corps: seule la route sert un message.
                const payload = await response.json().catch(() => undefined) as { error?: string } | undefined;
                if (payload?.error === 'Geocache not found') {
                    return createEmptyEarthCoachContextPayload();
                }
                this.aggregatedEndpointAvailable = false;
                return undefined;
            }
            if (!response.ok) {
                return undefined;
            }
            const payload = await response.json() as EarthCoachContextApiResponse;
            return parseEarthCoachContextResponse(baseUrl, geocacheId, payload);
        } catch (error) {
            console.warn('[EarthCoach] Unable to load aggregated context', error);
            return undefined;
        }
    }

    /** Repli historique: quatre lectures paralleles. */
    protected async loadPayloadFromUnitaryEndpoints(geocacheId: number): Promise<EarthCoachContextPayload> {
        const [images, observations, loggingTasks, notesResponse] = await Promise.all([
            this.loadBackendImages(geocacheId),
            this.loadStructuredObservations(geocacheId),
            this.loadLoggingTasks(geocacheId),
            this.loadNotes(geocacheId),
        ]);
        return {
            images,
            observations,
            loggingTasks,
            notes: notesResponse?.notes || [],
            gcPersonalNote: notesResponse?.gc_personal_note,
        };
    }

    protected async loadNotes(geocacheId: number): Promise<{ gc_personal_note?: string | null; notes: GeocacheNoteDto[] } | undefined> {
        try {
            return await this.notesService.getNotes(geocacheId);
        } catch (error) {
            console.warn('[EarthCoach] Unable to load notes', error);
            return undefined;
        }
    }

    protected async loadStructuredObservations(geocacheId: number): Promise<UserObservation[]> {
        try {
            const baseUrl = this.apiClient.getBaseUrl();
            const response = await fetch(`${baseUrl}/api/geocaches/${geocacheId}/observations`, { credentials: 'include' });
            if (!response.ok) {
                return [];
            }
            const payload = await response.json() as { observations?: UserObservationDto[] };
            return mapObservations(baseUrl, geocacheId, payload.observations);
        } catch (error) {
            console.warn('[EarthCoach] Unable to load structured observations', error);
            return [];
        }
    }

    protected async loadLoggingTasks(geocacheId: number): Promise<LoggingTask[]> {
        try {
            const baseUrl = this.apiClient.getBaseUrl();
            const response = await fetch(`${baseUrl}/api/geocaches/${geocacheId}/logging-tasks`, { credentials: 'include' });
            if (!response.ok) {
                return [];
            }
            const payload = await response.json() as { logging_tasks?: LoggingTaskDto[] };
            return mapLoggingTasks(geocacheId, payload.logging_tasks);
        } catch (error) {
            console.warn('[EarthCoach] Unable to load logging tasks', error);
            return [];
        }
    }

    protected async loadBackendImages(geocacheId: number): Promise<GeoImage[]> {
        try {
            const baseUrl = this.apiClient.getBaseUrl();
            const response = await fetch(`${baseUrl}/api/geocaches/${geocacheId}/images`, { credentials: 'include' });
            if (!response.ok) {
                return [];
            }
            const images = await response.json() as BackendGeocacheImageDto[];
            return mapBackendImages(baseUrl, geocacheId, images);
        } catch (error) {
            console.warn('[EarthCoach] Unable to load images', error);
            return [];
        }
    }
}
