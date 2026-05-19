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

        const notesResponse = await this.loadNotes(geocacheData.id);
        const observations = this.notesToObservations(geocacheData.id, notesResponse?.notes || []);
        const images = await this.loadImages(geocacheData);
        return {
            geocacheData,
            observations,
            gcPersonalNote: notesResponse?.gc_personal_note,
            images,
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
                note: note.content,
                createdAt: note.created_at || note.updated_at || new Date(0).toISOString(),
                sourceNoteId: note.id,
                images: [],
            }));
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
            const images = await response.json() as Array<{
                id?: number;
                url?: string;
                source_url?: string;
                image_type?: string;
                title?: string;
                note?: string;
            }>;
            return images
                .map((image, index) => {
                    const rawUrl = (image.url || image.source_url || '').trim();
                    if (!rawUrl) {
                        return undefined;
                    }
                    const fileUri = rawUrl.startsWith('/') ? `${baseUrl}${rawUrl}` : rawUrl;
                    const sourceUrl = (image.source_url || '').trim().toLowerCase();
                    const origin = sourceUrl.startsWith('geoapp-upload://') ? 'user_observation' : 'cache_listing';
                    const geoImage: GeoImage = {
                        id: image.id != null ? String(image.id) : `image-${index + 1}`,
                        origin,
                        cacheId: String(geocacheId),
                        label: image.title || `Image ${index + 1}`,
                        description: image.note,
                        fileUri,
                    };
                    return geoImage;
                })
                .filter((image): image is GeoImage => Boolean(image));
        } catch (error) {
            console.warn('[EarthCoach] Unable to load images', error);
            return [];
        }
    }
}
