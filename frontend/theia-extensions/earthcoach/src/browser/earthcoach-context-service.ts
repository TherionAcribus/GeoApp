import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { BackendApiClient } from 'theia-ide-zones-ext/lib/browser/backend-api-client';
import { GeocachesService } from 'theia-ide-zones-ext/lib/browser/geocaches-service';
import { GeocacheNotesService } from 'theia-ide-zones-ext/lib/browser/geocache-notes-service';
import { GeocacheNoteDto } from 'theia-ide-zones-ext/lib/browser/geocache-notes-types';
import { GeocacheDto } from 'theia-ide-zones-ext/lib/browser/geocache-details-types';
import {
    EarthCoachGeocacheData,
    GeoImage,
    UserObservation,
} from './earthcoach-types';

interface WidgetInfo {
    geocacheId?: number;
    geocacheData?: GeocacheDto;
}

interface BackendGeocacheImageDto {
    id?: number;
    url?: string;
    source_url?: string;
    image_type?: string;
    title?: string;
    note?: string;
}

interface UserObservationDto {
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

export interface EarthCoachContext {
    geocacheData: EarthCoachGeocacheData;
    observations: UserObservation[];
    gcPersonalNote?: string | null;
    images: GeoImage[];
}

@injectable()
export class EarthCoachContextService implements FrontendApplicationContribution {

    protected initialized = false;
    protected lastGeocache: WidgetInfo | undefined;

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

    async collectContext(input?: { geocacheData?: EarthCoachGeocacheData; geocacheId?: number }): Promise<EarthCoachContext | undefined> {
        this.ensureInitialized();
        const geocacheData = await this.resolveGeocacheData(input);
        if (!geocacheData) {
            return undefined;
        }

        const images = await this.loadImages(geocacheData);
        const structuredObservations = await this.loadStructuredObservations(geocacheData.id);
        const notesResponse = await this.loadNotes(geocacheData.id);
        const noteObservations = structuredObservations.length
            ? []
            : this.notesToObservations(geocacheData.id, notesResponse?.notes || []);
        const observations = [...structuredObservations, ...noteObservations];
        return {
            geocacheData,
            observations,
            gcPersonalNote: notesResponse?.gc_personal_note,
            images: this.mergeImages(images, structuredObservations.flatMap(observation => observation.images)),
        };
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
    }

    protected async resolveGeocacheData(input?: { geocacheData?: EarthCoachGeocacheData; geocacheId?: number }): Promise<EarthCoachGeocacheData | undefined> {
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

    protected async loadNotes(geocacheId: number): Promise<{ gc_personal_note?: string | null; notes: GeocacheNoteDto[] } | undefined> {
        try {
            return await this.notesService.getNotes(geocacheId);
        } catch (error) {
            console.warn('[EarthCoach] Unable to load notes', error);
            return undefined;
        }
    }

    protected notesToObservations(geocacheId: number, notes: GeocacheNoteDto[]): UserObservation[] {
        return notes
            .filter(note => note.source === 'user' && Boolean((note.content || '').trim()))
            .map(note => ({
                id: `note-${note.id}`,
                cacheId: String(geocacheId),
                userId: 'local-user',
                observationType: 'observation',
                note: note.content,
                observedAt: note.created_at || note.updated_at || undefined,
                createdAt: note.created_at || note.updated_at || new Date(0).toISOString(),
                source: 'note',
                sourceNoteId: note.id,
                images: [],
            }));
    }

    protected async loadStructuredObservations(geocacheId: number): Promise<UserObservation[]> {
        try {
            const baseUrl = this.apiClient.getBaseUrl();
            const response = await fetch(`${baseUrl}/api/geocaches/${geocacheId}/observations`, { credentials: 'include' });
            if (!response.ok) {
                return [];
            }
            const payload = await response.json() as { observations?: UserObservationDto[] };
            return (payload.observations || []).map(observation => {
                const images = (observation.images || [])
                    .map((image, index) => this.mapBackendImage(geocacheId, image, index))
                    .filter((image): image is GeoImage => Boolean(image));
                return {
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
                    images,
                };
            }).filter(observation => Boolean(observation.note.trim()));
        } catch (error) {
            console.warn('[EarthCoach] Unable to load structured observations', error);
            return [];
        }
    }

    protected async loadImages(geocacheData: EarthCoachGeocacheData): Promise<GeoImage[]> {
        const images = await this.loadBackendImages(geocacheData.id);
        if (images.length) {
            return images;
        }
        const legacyImages = ((geocacheData as any).images || []) as Array<{ url?: string }>;
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

    protected async loadBackendImages(geocacheId: number): Promise<GeoImage[]> {
        try {
            const baseUrl = this.apiClient.getBaseUrl();
            const response = await fetch(`${baseUrl}/api/geocaches/${geocacheId}/images`, { credentials: 'include' });
            if (!response.ok) {
                return [];
            }
            const images = await response.json() as BackendGeocacheImageDto[];
            return images
                .map((image, index) => this.mapBackendImage(geocacheId, image, index))
                .filter((image): image is GeoImage => Boolean(image));
        } catch (error) {
            console.warn('[EarthCoach] Unable to load images', error);
            return [];
        }
    }

    protected mapBackendImage(geocacheId: number, image: BackendGeocacheImageDto, index: number): GeoImage | undefined {
        const baseUrl = this.apiClient.getBaseUrl();
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

    protected mergeImages(primary: GeoImage[], secondary: GeoImage[]): GeoImage[] {
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
}
