import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core/lib/common/message-service';
import { ConfirmDialog, Dialog } from '@theia/core/lib/browser';
import * as React from 'react';
import { MapView, MapViewPreferences } from './map-view';
import { MapService } from './map-service';
import { MapGeocache } from './map-layer-manager';
import { PreferenceService, PreferenceChange } from '@theia/core/lib/common/preferences/preference-service';
import { GeocacheTabsManager } from '../geocache-tabs-manager';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';
import { GeocachesService } from '../geocaches-service';
import { GeoAppWidgetEventsService } from '../geoapp-widget-events-service';

export interface MapContext {
    type: 'zone' | 'geocache' | 'general';
    id?: number;
    label: string;
}

interface MapGeocacheDto {
    id: number;
    gc_code: string;
    name: string;
    cache_type?: string;
    type?: string;
    latitude?: number | null;
    longitude?: number | null;
    difficulty?: number;
    terrain?: number;
    found?: boolean;
    is_corrected?: boolean;
    original_latitude?: number | null;
    original_longitude?: number | null;
    waypoints?: MapGeocache['waypoints'];
}

@injectable()
export class MapWidget extends ReactWidget {
    static readonly ID = 'geoapp-map';
    static readonly LABEL = 'GeoApp - Carte';

    private mapInstance: any = null;
    private context: MapContext;
    private geocaches: MapGeocache[] = [];
    private mapPreferences: MapViewPreferences;
    private autoSelectTimeout: ReturnType<typeof setTimeout> | undefined;
    private resizeTimeout: ReturnType<typeof setTimeout> | undefined;
    private readonly geocacheChangeDisposable: { dispose: () => void };
    private readonly preferenceChangeDisposable: { dispose: () => void };
    private readonly mapPreferenceKeys = [
        'geoApp.map.defaultProvider',
        'geoApp.map.defaultZoom',
        'geoApp.map.geocacheIconScale',
        'geoApp.map.showExclusionZones',
        'geoApp.map.showNearbyGeocaches'
    ];

    constructor(
        @inject(MapService) protected readonly mapService: MapService,
        @inject(MessageService) protected readonly messageService: MessageService,
        @inject(GeocacheTabsManager) protected readonly geocacheTabsManager: GeocacheTabsManager,
        @inject(PreferenceService) private readonly preferenceService: PreferenceService,
        @inject(GeocachesService) protected readonly geocachesService: GeocachesService,
        @inject(GeoAppWidgetEventsService) protected readonly widgetEventsService: GeoAppWidgetEventsService,
    ) {
        super();

        this.node.tabIndex = 0;
        this.context = {
            type: 'general',
            label: 'Carte Generale'
        };
        this.mapPreferences = this.readMapPreferences();
        this.preferenceChangeDisposable = this.preferenceService.onPreferenceChanged((event: PreferenceChange) => this.handleMapPreferenceChanged(event));
        this.geocacheChangeDisposable = this.widgetEventsService.onDidChangeGeocache(event => {
            if (this.shouldReloadGeocache(event.geocacheId)) {
                void this.reloadGeocache(event.geocacheId);
            }
        });
    }

    setContext(context: MapContext): void {
        this.context = context;
        this.id = this.generateId();
        this.title.label = context.label;
        this.title.caption = `Carte - ${context.label}`;
        this.update();
    }

    private generateId(): string {
        switch (this.context.type) {
            case 'zone':
                return `geoapp-map-zone-${this.context.id}`;
            case 'geocache':
                return `geoapp-map-geocache-${this.context.id}`;
            default:
                return MapWidget.ID;
        }
    }

    getContext(): MapContext {
        return this.context;
    }

    loadGeocaches(geocaches: MapGeocache[]): void {
        console.log(`[MapWidget ${this.id}] loadGeocaches:`, geocaches.length, 'geocaches');
        this.geocaches = geocaches;

        this.clearAutoSelectTimeout();
        if (this.context.type === 'geocache' && this.context.id && geocaches.length > 0) {
            const geocacheToSelect = geocaches.find(gc => gc.id === this.context.id);
            if (geocacheToSelect) {
                this.autoSelectTimeout = setTimeout(() => {
                    if (!this.mapInstance) {
                        return;
                    }
                    this.mapService.selectGeocache({
                        id: geocacheToSelect.id,
                        gc_code: geocacheToSelect.gc_code,
                        name: geocacheToSelect.name,
                        latitude: geocacheToSelect.latitude,
                        longitude: geocacheToSelect.longitude,
                        cache_type: geocacheToSelect.cache_type,
                        mapId: this.id
                    });
                }, 500);
            }
        }

        this.update();
    }

    getGeocaches(): MapGeocache[] {
        return this.geocaches;
    }

    private shouldReloadGeocache(geocacheId: number): boolean {
        if (this.context.type === 'geocache' && this.context.id === geocacheId) {
            return true;
        }
        return this.geocaches.some(geocache => geocache.id === geocacheId);
    }

    private async reloadGeocache(geocacheId: number): Promise<void> {
        try {
            const updated = await this.geocachesService.get<MapGeocacheDto>(geocacheId);
            const mapped = this.toMapGeocache(updated);
            if (!mapped) {
                return;
            }

            const existingIndex = this.geocaches.findIndex(geocache => geocache.id === geocacheId);
            if (existingIndex >= 0) {
                this.geocaches = [
                    ...this.geocaches.slice(0, existingIndex),
                    mapped,
                    ...this.geocaches.slice(existingIndex + 1)
                ];
            } else if (this.context.type === 'geocache' && this.context.id === geocacheId) {
                this.geocaches = [mapped];
            } else {
                return;
            }

            this.update();
        } catch (error) {
            console.error('[MapWidget] Unable to reload geocache', geocacheId, error);
        }
    }

    private toMapGeocache(data: MapGeocacheDto): MapGeocache | undefined {
        if (typeof data.latitude !== 'number' || typeof data.longitude !== 'number') {
            return undefined;
        }

        return {
            id: data.id,
            gc_code: data.gc_code,
            name: data.name,
            cache_type: data.cache_type || data.type || '',
            latitude: data.latitude,
            longitude: data.longitude,
            difficulty: data.difficulty,
            terrain: data.terrain,
            found: data.found,
            is_corrected: data.is_corrected,
            original_latitude: data.original_latitude ?? undefined,
            original_longitude: data.original_longitude ?? undefined,
            waypoints: data.waypoints || []
        };
    }

    @postConstruct()
    protected init(): void {
        this.id = this.generateId();
        this.title.label = this.context.label;
        this.title.caption = `Carte - ${this.context.label}`;
        this.title.closable = true;
        this.title.iconClass = 'fa fa-map';

        this.addClass('geoapp-map-widget');
        this.update();
    }

    protected render(): React.ReactNode {
        const isGeocacheMap = this.context.type === 'geocache' && this.context.id;
        const onAddWaypoint = isGeocacheMap ? this.handleAddWaypoint : undefined;
        const onDeleteWaypoint = isGeocacheMap ? this.handleDeleteWaypoint : undefined;
        const onSetWaypointAsCorrectedCoords = isGeocacheMap ? this.handleSetWaypointAsCorrectedCoords : undefined;

        const isBatchOrGeneralMap = this.context.type === 'general';
        const onSetDetectedAsCorrectedCoords = isBatchOrGeneralMap ? this.handleSetDetectedAsCorrectedCoords : undefined;
        const onAddWaypointFromDetected = isBatchOrGeneralMap ? this.handleAddWaypointFromDetected : undefined;

        return (
            <MapView
                mapId={this.id}
                mapService={this.mapService}
                geocaches={this.geocaches}
                onMapReady={this.handleMapReady}
                onLoadNearbyGeocaches={this.handleLoadNearbyGeocaches}
                onAddWaypoint={onAddWaypoint}
                onAddWaypointFromDetected={onAddWaypointFromDetected}
                onDeleteWaypoint={onDeleteWaypoint}
                onSetWaypointAsCorrectedCoords={onSetWaypointAsCorrectedCoords}
                onSetDetectedAsCorrectedCoords={onSetDetectedAsCorrectedCoords}
                onOpenGeocacheDetails={this.handleOpenGeocacheDetails}
                preferences={this.mapPreferences}
                onPreferenceChange={this.handlePreferenceUpdate}
            />
        );
    }

    private sanitizeCoordinates(gcCoords: string): string {
        return gcCoords.replace(/'/g, '');
    }

    private async confirmAction(title: string, msg: string, ok: string): Promise<boolean> {
        const dialog = new ConfirmDialog({
            title,
            msg,
            ok,
            cancel: Dialog.CANCEL
        });
        return dialog.open();
    }

    private async saveWaypoint(
        geocacheId: number,
        options: { gcCoords: string; title?: string; note?: string }
    ): Promise<void> {
        await this.geocachesService.createWaypoint(geocacheId, {
            name: options.title || 'Waypoint detecte',
            gc_coords: this.sanitizeCoordinates(options.gcCoords),
            note: options.note || '',
            type: 'User Waypoint'
        });
        this.widgetEventsService.notifyGeocacheChanged({
            geocacheId,
            reason: 'waypoint-created',
            source: 'map'
        });
    }

    private async openWaypointEditorForGeocache(
        geocacheId: number,
        options: { gcCoords: string; title?: string; note?: string },
        gcCode?: string,
        geocacheName?: string
    ): Promise<void> {
        if (!gcCode || typeof window === 'undefined') {
            this.messageService.warn('Impossible d ouvrir le formulaire du waypoint pour cette geocache');
            return;
        }

        await this.geocacheTabsManager.openGeocacheDetails({
            geocacheId,
            name: geocacheName
        });

        window.setTimeout(() => {
            window.dispatchEvent(new CustomEvent('geoapp-plugin-add-waypoint', {
                detail: {
                    gcCoords: this.sanitizeCoordinates(options.gcCoords),
                    waypointTitle: options.title,
                    waypointNote: options.note,
                    autoSave: false,
                    geocache: { gcCode }
                }
            }));
        }, 150);
    }

    private handleAddWaypoint = (options: { gcCoords: string; title?: string; note?: string; autoSave?: boolean }): void => {
        if (this.context.type !== 'geocache' || !this.context.id) {
            return;
        }

        if (options.autoSave) {
            void this.saveWaypoint(this.context.id, options).then(() => {
                this.messageService.info('Waypoint cree avec succes');
            }).catch(error => {
                console.error('[MapWidget] Failed to add waypoint:', error);
                this.messageService.error('Erreur lors de l ajout du waypoint');
            });
            return;
        }

        const geocache = this.geocaches.find(item => item.id === this.context.id);
        void this.openWaypointEditorForGeocache(this.context.id, options, geocache?.gc_code, geocache?.name).catch(error => {
            console.error('[MapWidget] Failed to open waypoint editor:', error);
            this.messageService.error('Impossible d ouvrir les details de la geocache');
        });
    };

    private handleDeleteWaypoint = async (waypointId: number): Promise<void> => {
        if (this.context.type !== 'geocache' || !this.context.id) {
            return;
        }

        const confirmed = await this.confirmAction(
            'Supprimer le waypoint',
            'Voulez-vous vraiment supprimer ce waypoint ?',
            'Supprimer'
        );
        if (!confirmed) {
            return;
        }

        try {
            await this.geocachesService.deleteWaypoint(this.context.id, waypointId);
            this.widgetEventsService.notifyGeocacheChanged({
                geocacheId: this.context.id,
                reason: 'waypoint-deleted',
                source: 'map'
            });
            this.messageService.info('Waypoint supprime');
        } catch (error) {
            console.error('[MapWidget] Failed to delete waypoint:', error);
            this.messageService.error('Erreur lors de la suppression du waypoint');
        }
    };

    private handleSetWaypointAsCorrectedCoords = async (waypointId: number): Promise<void> => {
        if (this.context.type !== 'geocache' || !this.context.id) {
            return;
        }

        const confirmed = await this.confirmAction(
            'Definir comme coordonnees corrigees',
            'Voulez-vous utiliser ce waypoint comme coordonnees corrigees de la geocache ?',
            'Confirmer'
        );
        if (!confirmed) {
            return;
        }

        try {
            await this.geocachesService.setWaypointAsCorrectedCoords(this.context.id, waypointId);
            this.widgetEventsService.notifyGeocacheChanged({
                geocacheId: this.context.id,
                reason: 'corrected-coordinates-updated',
                source: 'map'
            });
            this.messageService.info('Coordonnees corrigees mises a jour');
        } catch (error) {
            console.error('[MapWidget] Failed to set corrected coordinates:', error);
            this.messageService.error('Erreur lors de la mise a jour des coordonnees corrigees');
        }
    };

    private handleAddWaypointFromDetected = async (
        geocacheId: number,
        options: { gcCoords: string; title?: string; note?: string; autoSave?: boolean }
    ): Promise<void> => {
        try {
            await this.saveWaypoint(geocacheId, options);
            if (options.autoSave) {
                this.messageService.info('Waypoint cree avec succes');
            } else {
                this.messageService.info('Waypoint ajoute - ouvrez la geocache pour le modifier');
            }
        } catch (error) {
            console.error('[MapWidget] Failed to add detected waypoint:', error);
            this.messageService.error('Erreur lors de l ajout du waypoint');
        }
    };

    private handleSetDetectedAsCorrectedCoords = async (geocacheId: number, gcCoords: string): Promise<void> => {
        try {
            await this.geocachesService.updateCoordinates(geocacheId, this.sanitizeCoordinates(gcCoords));
            this.widgetEventsService.notifyGeocacheChanged({
                geocacheId,
                reason: 'corrected-coordinates-updated',
                source: 'map'
            });
            this.messageService.info('Coordonnees corrigees mises a jour');
        } catch (error) {
            console.error('[MapWidget] Failed to update corrected coordinates:', error);
            this.messageService.error('Erreur lors de la mise a jour des coordonnees');
        }
    };

    private readMapPreferences(): MapViewPreferences {
        return {
            defaultProvider: this.preferenceService.get('geoApp.map.defaultProvider', 'osm'),
            defaultZoom: this.preferenceService.get('geoApp.map.defaultZoom', 6),
            geocacheIconScale: this.preferenceService.get('geoApp.map.geocacheIconScale', 0.75),
            showExclusionZones: this.preferenceService.get('geoApp.map.showExclusionZones', true),
            showNearbyGeocaches: this.preferenceService.get('geoApp.map.showNearbyGeocaches', false)
        };
    }

    private handleMapPreferenceChanged(event: PreferenceChange): void {
        if (!event.preferenceName || !this.mapPreferenceKeys.includes(event.preferenceName)) {
            return;
        }
        this.mapPreferences = this.readMapPreferences();
        this.update();
    }

    private handlePreferenceUpdate = (key: string, value: unknown): void => {
        void this.preferenceService.set(key, value, PreferenceScope.User);
    };

    private handleOpenGeocacheDetails = async (geocacheId: number, geocacheName: string): Promise<void> => {
        try {
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('geoapp-open-geocache-details', {
                    detail: { geocacheId, geocacheName }
                }));
            }

            await this.geocacheTabsManager.openGeocacheDetails({
                geocacheId,
                name: geocacheName
            });
        } catch (error) {
            console.error('[MapWidget] Failed to open geocache details:', error);
            this.messageService.error('Impossible d ouvrir les details de la geocache');
        }
    };

    private handleLoadNearbyGeocaches = async (geocacheId: number, radiusKm: number): Promise<MapGeocache[]> => {
        const data = await this.geocachesService.getNearby<MapGeocacheDto>(geocacheId, radiusKm);
        return data.nearby_geocaches
            .map(item => this.toMapGeocache(item))
            .filter((item): item is MapGeocache => Boolean(item));
    };

    private handleMapReady = (map: any): void => {
        this.mapInstance = map;

        map.on('moveend', () => {
            const view = map.getView();
            const center = view.getCenter();
            const zoom = view.getZoom();

            if (center && zoom !== undefined) {
                this.mapService.updateView(center, zoom);
            }
        });
    };

    protected onResize(msg: any): void {
        super.onResize(msg);
        if (this.mapInstance) {
            this.updateMapSize();
        }
    }

    protected onActivateRequest(msg: any): void {
        super.onActivateRequest(msg);
        this.node.focus();

        if (this.mapInstance) {
            this.clearResizeTimeout();
            this.resizeTimeout = setTimeout(() => {
                if (this.mapInstance) {
                    this.updateMapSize();
                }
            }, 100);
        }
    }

    private clearAutoSelectTimeout(): void {
        if (this.autoSelectTimeout) {
            clearTimeout(this.autoSelectTimeout);
            this.autoSelectTimeout = undefined;
        }
    }

    private clearResizeTimeout(): void {
        if (this.resizeTimeout) {
            clearTimeout(this.resizeTimeout);
            this.resizeTimeout = undefined;
        }
    }

    private updateMapSize(): void {
        const updateFn = (this.mapInstance as any)?.updateSize;
        if (typeof updateFn === 'function') {
            updateFn.call(this.mapInstance);
        }
    }

    dispose(): void {
        this.clearAutoSelectTimeout();
        this.clearResizeTimeout();
        this.geocacheChangeDisposable.dispose();
        this.preferenceChangeDisposable.dispose();
        if (this.mapInstance) {
            this.mapInstance.setTarget(undefined);
            this.mapInstance = null;
        }
        super.dispose();
    }
}
