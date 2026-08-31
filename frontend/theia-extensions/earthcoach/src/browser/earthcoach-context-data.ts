import { GeocacheNoteDto } from 'theia-ide-zones-ext/lib/browser/geocache-notes-types';
import {
    EarthCoachGeocacheData,
    GeoImage,
    LoggingTask,
    LoggingTaskStatus,
    UserObservation,
} from './earthcoach-types';
import { LoggingTaskDto } from './earthcoach-logging-tasks';

/**
 * Duree de vie du micro-cache de contexte EarthCoach.
 *
 * Une session EarthCoach enchaine les actions ("Comprendre" puis "Preparer la
 * visite" puis "Checklist"): sans cache, chaque action rechargeait images,
 * observations, questions et notes alors que rien n'avait bouge entre deux
 * clics. Le cache est volontairement court, et de toute facon invalide des
 * qu'une mutation est signalee: il couvre l'enchainement immediat, pas la
 * fraicheur a moyen terme.
 */
export const EARTHCOACH_CONTEXT_CACHE_TTL_MS = 45_000;

export interface BackendGeocacheImageDto {
    id?: number;
    url?: string;
    source_url?: string;
    image_type?: string;
    title?: string;
    note?: string;
}

export interface UserObservationDto {
    id: number;
    geocache_id?: number;
    cache_id?: string;
    user_id?: string;
    observation_type?: 'observation' | 'hypothesis' | 'interpretation';
    content?: string;
    note?: string;
    observed_at?: string | null;
    created_at?: string | null;
    waypoint_id?: number | null;
    coordinates_raw?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    images?: BackendGeocacheImageDto[];
}

/** Reponse de GET /api/geocaches/<id>/earthcoach-context. */
export interface EarthCoachContextApiResponse {
    geocache_id?: number;
    gc_code?: string;
    name?: string;
    gc_personal_note?: string | null;
    images?: BackendGeocacheImageDto[];
    observations?: UserObservationDto[];
    logging_tasks?: LoggingTaskDto[];
    notes?: GeocacheNoteDto[];
}

/**
 * Donnees reseau d'une geocache, telles que mises en cache.
 *
 * On ne cache pas le `EarthCoachContext` assemble mais uniquement la part
 * reseau: la geocache elle-meme est fournie par l'appelant (widget actif,
 * requete explicite) et peut etre plus fraiche que l'entree de cache.
 */
export interface EarthCoachContextPayload {
    /** Images cote backend, avant repli sur les images du listing. */
    images: GeoImage[];
    /** Observations structurees, avant repli sur les notes utilisateur. */
    observations: UserObservation[];
    loggingTasks: LoggingTask[];
    notes: GeocacheNoteDto[];
    gcPersonalNote?: string | null;
}

export interface EarthCoachContext {
    geocacheData: EarthCoachGeocacheData;
    observations: UserObservation[];
    loggingTasks: LoggingTask[];
    gcPersonalNote?: string | null;
    images: GeoImage[];
}

export function createEmptyEarthCoachContextPayload(): EarthCoachContextPayload {
    return { images: [], observations: [], loggingTasks: [], notes: [], gcPersonalNote: undefined };
}

export function mapBackendImage(
    baseUrl: string,
    geocacheId: number,
    image: BackendGeocacheImageDto,
    index: number
): GeoImage | undefined {
    const rawUrl = (image.url || image.source_url || '').trim();
    if (!rawUrl) {
        return undefined;
    }
    const fileUri = rawUrl.startsWith('/') ? `${baseUrl}${rawUrl}` : rawUrl;
    const sourceUrl = (image.source_url || '').trim().toLowerCase();
    const origin = sourceUrl.startsWith('geoapp-upload://') ? 'user_observation' : 'cache_listing';
    return {
        id: image.id != null ? String(image.id) : `image-${index + 1}`,
        origin,
        cacheId: String(geocacheId),
        label: image.title || `Image ${index + 1}`,
        description: image.note,
        fileUri,
    };
}

export function mapBackendImages(
    baseUrl: string,
    geocacheId: number,
    images: BackendGeocacheImageDto[] | undefined
): GeoImage[] {
    return (images || [])
        .map((image, index) => mapBackendImage(baseUrl, geocacheId, image, index))
        .filter((image): image is GeoImage => Boolean(image));
}

export function mapObservations(
    baseUrl: string,
    geocacheId: number,
    observations: UserObservationDto[] | undefined
): UserObservation[] {
    return (observations || []).map(observation => ({
        id: `observation-${observation.id}`,
        cacheId: String(observation.geocache_id ?? observation.cache_id ?? geocacheId),
        userId: observation.user_id || 'local-user',
        waypointId: observation.waypoint_id != null ? String(observation.waypoint_id) : undefined,
        observationType: observation.observation_type || 'observation',
        note: observation.content || observation.note || '',
        observedAt: observation.observed_at || undefined,
        createdAt: observation.created_at || observation.observed_at || new Date(0).toISOString(),
        coordinates: observation.latitude != null && observation.longitude != null
            ? { lat: observation.latitude, lon: observation.longitude }
            : undefined,
        coordinatesRaw: observation.coordinates_raw || undefined,
        source: 'structured' as const,
        images: mapBackendImages(baseUrl, geocacheId, observation.images),
    })).filter(observation => Boolean(observation.note.trim()));
}

export function normalizeLoggingTaskStatus(value: string | null | undefined): LoggingTaskStatus {
    return value === 'field' || value === 'answered' ? value : 'todo';
}

export function mapLoggingTask(geocacheId: number, task: LoggingTaskDto, index: number): LoggingTask | undefined {
    const question = (task.question || '').trim();
    if (!question) {
        return undefined;
    }
    return {
        id: `logging-task-${task.id}`,
        geocacheId: String(task.geocache_id ?? geocacheId),
        position: task.position ?? index + 1,
        question,
        guidance: task.guidance?.trim() || undefined,
        answer: task.answer?.trim() || undefined,
        status: normalizeLoggingTaskStatus(task.status),
        requiresPhoto: Boolean(task.requires_photo),
        observationId: task.observation_id != null ? `observation-${task.observation_id}` : undefined,
        source: task.source?.trim() || undefined,
    };
}

export function mapLoggingTasks(geocacheId: number, tasks: LoggingTaskDto[] | undefined): LoggingTask[] {
    return (tasks || [])
        .map((task, index) => mapLoggingTask(geocacheId, task, index))
        .filter((task): task is LoggingTask => Boolean(task));
}

/** Convertit la reponse de l'endpoint agrege en donnees de contexte. */
export function parseEarthCoachContextResponse(
    baseUrl: string,
    geocacheId: number,
    payload: EarthCoachContextApiResponse | undefined
): EarthCoachContextPayload {
    return {
        images: mapBackendImages(baseUrl, geocacheId, payload?.images),
        observations: mapObservations(baseUrl, geocacheId, payload?.observations),
        loggingTasks: mapLoggingTasks(geocacheId, payload?.logging_tasks),
        notes: payload?.notes || [],
        gcPersonalNote: payload?.gc_personal_note,
    };
}

export function notesToObservations(geocacheId: number, notes: GeocacheNoteDto[]): UserObservation[] {
    return notes
        .filter(note => note.source === 'user' && Boolean((note.content || '').trim()))
        .map(note => ({
            id: `note-${note.id}`,
            cacheId: String(geocacheId),
            userId: 'local-user',
            observationType: 'observation' as const,
            note: note.content,
            observedAt: note.created_at || note.updated_at || undefined,
            createdAt: note.created_at || note.updated_at || new Date(0).toISOString(),
            source: 'note' as const,
            sourceNoteId: note.id,
            images: [],
        }));
}

export function mergeImages(primary: GeoImage[], secondary: GeoImage[]): GeoImage[] {
    const seen = new Set<string>();
    const merged: GeoImage[] = [];
    for (const image of [...primary, ...secondary]) {
        const key = `${image.origin}:${image.id}:${image.fileUri}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        merged.push(image);
    }
    return merged;
}

/** Images du listing brut, utilisees quand le backend n'en connait aucune. */
export function legacyListingImages(geocacheData: EarthCoachGeocacheData): GeoImage[] {
    const legacyImages = (geocacheData as { images?: Array<{ url?: string }> }).images || [];
    return legacyImages
        .map((image, index) => {
            if (!image.url) {
                return undefined;
            }
            const geoImage: GeoImage = {
                id: `legacy-${index + 1}`,
                origin: 'cache_listing',
                cacheId: String(geocacheData.id),
                label: `Image listing ${index + 1}`,
                fileUri: image.url,
            };
            return geoImage;
        })
        .filter((image): image is GeoImage => Boolean(image));
}

/**
 * Assemble le contexte expose aux widgets et au prompt: repli des images sur le
 * listing, repli des observations sur les notes utilisateur, fusion des photos
 * attachees aux observations.
 */
export function assembleEarthCoachContext(
    geocacheData: EarthCoachGeocacheData,
    payload: EarthCoachContextPayload
): EarthCoachContext {
    const images = payload.images.length ? payload.images : legacyListingImages(geocacheData);
    const noteObservations = payload.observations.length
        ? []
        : notesToObservations(geocacheData.id, payload.notes);
    return {
        geocacheData,
        observations: [...payload.observations, ...noteObservations],
        loggingTasks: payload.loggingTasks,
        gcPersonalNote: payload.gcPersonalNote,
        images: mergeImages(images, payload.observations.flatMap(observation => observation.images)),
    };
}

interface CacheEntry {
    payload: EarthCoachContextPayload;
    storedAt: number;
}

interface InFlightEntry {
    promise: Promise<EarthCoachContextPayload>;
    /**
     * Generation de la geocache au moment ou la requete est partie: une requete
     * lancee avant une invalidation a lu des donnees d'avant la mutation, on ne
     * doit ni la rejoindre ni cacher son resultat.
     */
    generation: number;
}

/**
 * Micro-cache TTL par geocache. Il memorise aussi la requete en vol, pour que
 * deux widgets ouverts d'affilee partagent un seul aller-retour reseau.
 */
export class EarthCoachContextCache {

    protected readonly entries = new Map<number, CacheEntry>();
    protected readonly inFlight = new Map<number, InFlightEntry>();
    protected readonly generations = new Map<number, number>();

    constructor(
        protected readonly ttlMs: number = EARTHCOACH_CONTEXT_CACHE_TTL_MS,
        protected readonly now: () => number = () => Date.now()
    ) { }

    get(geocacheId: number): EarthCoachContextPayload | undefined {
        const entry = this.entries.get(geocacheId);
        if (!entry) {
            return undefined;
        }
        if (this.now() - entry.storedAt >= this.ttlMs) {
            this.entries.delete(geocacheId);
            return undefined;
        }
        return entry.payload;
    }

    set(geocacheId: number, payload: EarthCoachContextPayload): void {
        this.entries.set(geocacheId, { payload, storedAt: this.now() });
    }

    invalidate(geocacheId: number): void {
        this.entries.delete(geocacheId);
        this.generations.set(geocacheId, this.generationOf(geocacheId) + 1);
    }

    clear(): void {
        for (const geocacheId of this.entries.keys()) {
            this.generations.set(geocacheId, this.generationOf(geocacheId) + 1);
        }
        this.entries.clear();
    }

    protected generationOf(geocacheId: number): number {
        return this.generations.get(geocacheId) || 0;
    }

    /**
     * Renvoie les donnees en cache si elles sont fraiches, sinon lance (ou
     * rejoint) un chargement. `forceRefresh` ignore l'entree en cache; il ne
     * rejoint un chargement en vol que s'il a demarre apres la derniere
     * invalidation, sinon il relit le reseau.
     */
    async load(
        geocacheId: number,
        loader: () => Promise<EarthCoachContextPayload>,
        options?: { forceRefresh?: boolean }
    ): Promise<EarthCoachContextPayload> {
        if (options?.forceRefresh) {
            this.entries.delete(geocacheId);
        } else {
            const cached = this.get(geocacheId);
            if (cached) {
                return cached;
            }
        }
        const generation = this.generationOf(geocacheId);
        const pending = this.inFlight.get(geocacheId);
        if (pending && pending.generation === generation) {
            return pending.promise;
        }
        const promise = loader().then(payload => {
            if (this.generationOf(geocacheId) === generation) {
                this.set(geocacheId, payload);
            }
            return payload;
        }).finally(() => {
            if (this.inFlight.get(geocacheId)?.generation === generation) {
                this.inFlight.delete(geocacheId);
            }
        });
        this.inFlight.set(geocacheId, { promise, generation });
        return promise;
    }
}
