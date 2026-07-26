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
import { ZonesService } from '../zones-service';
import { GeoAppWidgetEventsService } from '../geoapp-widget-events-service';
import { ImportAroundService } from '../import-around-service';
import {
    ImportAroundCenter,
    ImportAroundDialog,
    ImportAroundRequest
} from '../import-around-dialog';

export interface MapContext {
    type: 'zone' | 'geocache' | 'general' | 'custom';
    id?: number;
    label: string;
    /**
     * Zone dont la carte affiche les géocaches. Toujours renseigné pour une carte
     * de zone ; renseigné sur une carte libre après un import qui l'a rattachée à
     * une zone (le type reste `custom` : la carte garde ses fonctions libres).
     */
    zoneId?: number;
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
    /** Etat du dialog « Importer autour… » ouvert depuis le menu contextuel de la carte. */
    private importAround: {
        center?: ImportAroundCenter;
        zones: Array<{ id: number; name: string }>;
        defaultZoneId?: number;
        defaultNewZoneName?: string;
    } | undefined;
    private isImporting = false;
    private autoSelectTimeout: ReturnType<typeof setTimeout> | undefined;
    private resizeTimeout: ReturnType<typeof setTimeout> | undefined;
    private readonly geocacheChangeDisposable: { dispose: () => void };
    private readonly preferenceChangeDisposable: { dispose: () => void };
    private readonly zoneListChangeDisposable: { dispose: () => void };
    private readonly mapPreferenceKeys = [
        'geoApp.map.defaultProvider',
        'geoApp.map.defaultZoom',
        'geoApp.map.geocacheIconScale',
        'geoApp.map.foundGeocacheDisplayMode',
        'geoApp.map.showExclusionZones',
        'geoApp.map.showNearbyGeocaches',
        'geoApp.map.clusteringMode',
        'geoApp.map.clusteringThreshold',
        'geoApp.map.geocoding.provider',
        'geoApp.map.geocoding.geoapifyApiKey',
        'geoApp.map.geocoding.autoFallback'
    ];

    constructor(
        @inject(MapService) protected readonly mapService: MapService,
        @inject(MessageService) protected readonly messageService: MessageService,
        @inject(GeocacheTabsManager) protected readonly geocacheTabsManager: GeocacheTabsManager,
        @inject(PreferenceService) private readonly preferenceService: PreferenceService,
        @inject(GeocachesService) protected readonly geocachesService: GeocachesService,
        @inject(ZonesService) protected readonly zonesService: ZonesService,
        @inject(ImportAroundService) protected readonly importAroundService: ImportAroundService,
        @inject(GeoAppWidgetEventsService) protected readonly widgetEventsService: GeoAppWidgetEventsService,
    ) {
        super();

        this.node.tabIndex = 0;
        this.context = {
            type: 'general',
            label: 'Carte Générale'
        };
        this.mapPreferences = this.readMapPreferences();
        this.preferenceChangeDisposable = this.preferenceService.onPreferenceChanged((event: PreferenceChange) => this.handleMapPreferenceChanged(event));
        this.geocacheChangeDisposable = this.widgetEventsService.onDidChangeGeocache(event => {
            if (this.shouldReloadGeocache(event.geocacheId)) {
                void this.reloadGeocache(event.geocacheId);
            }
        });
        // Renommage d'une zone : les cartes qui l'affichent suivent son nouveau nom.
        this.zoneListChangeDisposable = this.widgetEventsService.onDidChangeZoneList(() => {
            void this.syncZoneLabel();
        });
    }

    /**
     * Réaligne le libellé de la carte sur le nom courant de la zone qu'elle affiche.
     * Sans effet pour les cartes non rattachées à une zone.
     */
    private async syncZoneLabel(): Promise<void> {
        const zoneId = this.context.zoneId;
        if (zoneId === undefined) {
            return;
        }

        try {
            const zones = await this.zonesService.list();
            const zone = zones.find(candidate => candidate.id === zoneId);
            if (!zone) {
                // Zone supprimée : on conserve le libellé actuel.
                return;
            }

            const label = this.context.type === 'zone' ? `Zone: ${zone.name}` : zone.name;
            if (label === this.context.label) {
                return;
            }

            this.context = { ...this.context, label };
            this.title.label = label;
            this.title.caption = `Carte - ${label}`;
            this.mapService.notifyMapContextChanged(this.id);
        } catch (error) {
            console.error('[MapWidget] Unable to refresh the zone label', error);
        }
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
            case 'custom':
                return `geoapp-map-custom-${this.context.id}`;
            default:
                return MapWidget.ID;
        }
    }

    getContext(): MapContext {
        return this.context;
    }

    loadGeocaches(geocaches: MapGeocache[]): void {
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

        const isBatchOrGeneralMap = this.context.type === 'general' || this.context.type === 'custom';
        const onSetDetectedAsCorrectedCoords = isBatchOrGeneralMap ? this.handleSetDetectedAsCorrectedCoords : undefined;
        const onAddWaypointFromDetected = isBatchOrGeneralMap ? this.handleAddWaypointFromDetected : undefined;

        return (
            <React.Fragment>
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
                    onImportAround={this.handleImportAround}
                    preferences={this.mapPreferences}
                    onPreferenceChange={this.handlePreferenceUpdate}
                    onNotify={this.handleNotify}
                />
                {this.importAround && (
                    <ImportAroundDialog
                        zoneId={this.zoneIdOfContext()}
                        zoneName={this.zoneNameOfContext()}
                        zones={this.importAround.zones}
                        defaultZoneId={this.importAround.defaultZoneId}
                        defaultNewZoneName={this.importAround.defaultNewZoneName}
                        initialCenter={this.importAround.center}
                        onImport={this.handleImportAroundConfirmed}
                        onCancel={this.closeImportAroundDialog}
                        isImporting={this.isImporting}
                    />
                )}
            </React.Fragment>
        );
    }

    /** Zone imposée par le contexte de la carte, ou `undefined` (carte libre, générale, géocache). */
    private zoneIdOfContext(): number | undefined {
        return this.context.type === 'zone' ? this.context.id : undefined;
    }

    /** Nom de la zone du contexte, sans le préfixe du libellé de l'onglet. */
    private zoneNameOfContext(): string | undefined {
        if (this.zoneIdOfContext() === undefined) {
            return undefined;
        }
        return this.context.label.replace(/^Zone\s*:\s*/, '');
    }

    /**
     * Ouvre le dialog d'import. Sur une carte de zone, la zone cible est imposée ;
     * sur une carte libre ou générale, l'utilisateur choisit une zone existante ou
     * en crée une nouvelle.
     */
    private handleImportAround = (center: ImportAroundCenter): void => {
        void this.openImportAroundDialog(center);
    };

    private async openImportAroundDialog(center: ImportAroundCenter): Promise<void> {
        const needsTargetChoice = this.zoneIdOfContext() === undefined;

        // Les zones existantes ne sont chargées que si l'utilisateur doit choisir
        // la destination (carte libre, carte générale, carte de géocache).
        let zones: Array<{ id: number; name: string }> = [];
        if (needsTargetChoice) {
            try {
                const loaded = await this.zonesService.list();
                zones = loaded.map(zone => ({ id: zone.id, name: zone.name }));
            } catch (error) {
                console.error('[MapWidget] Unable to load zones', error);
                this.messageService.warn('Impossible de charger la liste des zones : créez une nouvelle zone');
            }
        }

        this.importAround = {
            center,
            zones,
            // Une carte déjà rattachée à une zone (import précédent) la propose par
            // défaut ; sinon on propose la zone de la cache servant de centre.
            defaultZoneId: needsTargetChoice
                ? (this.context.zoneId ?? await this.findCenterZoneId(center))
                : undefined,
            defaultNewZoneName: needsTargetChoice ? this.suggestNewZoneName(center) : undefined
        };
        this.isImporting = false;
        this.update();
    }

    /**
     * Zone de la géocache servant de centre, quand l'import part d'une cache déjà
     * en base : c'est la destination la plus probable.
     */
    private async findCenterZoneId(center: ImportAroundCenter): Promise<number | undefined> {
        if (center.type !== 'geocache_id') {
            return undefined;
        }
        try {
            const geocache = await this.geocachesService.get<{ zone_id?: number }>(center.geocache_id);
            return typeof geocache.zone_id === 'number' ? geocache.zone_id : undefined;
        } catch (error) {
            console.error('[MapWidget] Unable to resolve the zone of the center geocache', error);
            return undefined;
        }
    }

    /** Nom proposé pour une nouvelle zone, dérivé du centre de l'import. */
    private suggestNewZoneName(center: ImportAroundCenter): string {
        switch (center.type) {
            case 'geocache_id':
                return center.gc_code ? `Autour de ${center.gc_code}` : this.context.label;
            case 'gc_code':
                return `Autour de ${center.gc_code}`;
            default:
                return `Autour de ${center.lat.toFixed(4)}, ${center.lon.toFixed(4)}`;
        }
    }

    private closeImportAroundDialog = (): void => {
        if (this.isImporting) {
            return;
        }
        this.importAround = undefined;
        this.update();
    };

    private handleImportAroundConfirmed = async (
        request: ImportAroundRequest,
        onProgress?: (percentage: number, message: string) => void
    ): Promise<void> => {
        this.isImporting = true;
        this.update();

        try {
            const zone = await this.importAroundService.resolveTargetZone(request.target);
            if (zone.created) {
                this.messageService.info(`Zone « ${zone.name} » créée`);
            }

            const zoneName = zone.name ?? this.importAround?.zones.find(z => z.id === zone.zoneId)?.name;

            const summary = await this.importAroundService.run(zone.zoneId, request, {
                onProgress,
                onError: message => this.messageService.error(message)
            });

            this.messageService.info(summary || 'Import terminé');
            this.widgetEventsService.requestZonesRefresh();

            await this.showZoneGeocachesOnMap(zone.zoneId);
            this.attachToZone(zone.zoneId, zoneName);

            this.importAround = undefined;

            // La table de la zone de destination donne accès aux géocaches importées.
            if (this.zoneIdOfContext() === undefined) {
                this.widgetEventsService.requestOpenZone({ zoneId: zone.zoneId, zoneName });
            }
        } catch (error) {
            console.error('[MapWidget] Import around failed', error);
            this.messageService.error('Erreur lors de l\'import autour');
        } finally {
            this.isImporting = false;
            this.update();
        }
    };

    /**
     * Rattache une carte libre à la zone dans laquelle l'import a été fait : la
     * carte prend le nom de la zone dans son onglet et dans le gestionnaire de
     * cartes. Le type reste `custom`, la carte conserve donc ses fonctions de carte
     * libre (coordonnées détectées, waypoints…) et son identifiant de widget.
     */
    private attachToZone(zoneId: number, zoneName?: string): void {
        if (this.context.type !== 'custom') {
            return;
        }

        const label = zoneName || this.context.label;
        if (this.context.zoneId === zoneId && this.context.label === label) {
            return;
        }

        this.context = { ...this.context, zoneId, label };
        this.title.label = label;
        this.title.caption = `Carte - ${label}`;
        this.mapService.notifyMapContextChanged(this.id);
    }

    /**
     * Affiche sur la carte les géocaches de la zone de destination, pour que les
     * caches importées soient visibles immédiatement (les caches déjà affichées
     * sont conservées : une carte libre peut agréger plusieurs zones).
     *
     * Les cartes de géocache sont volontairement laissées inchangées : elles sont
     * centrées sur une seule cache et ses waypoints.
     */
    private async showZoneGeocachesOnMap(zoneId: number): Promise<void> {
        if (this.context.type === 'geocache') {
            return;
        }

        try {
            const zoneGeocaches = await this.zonesService.listGeocaches<MapGeocacheDto>(zoneId);
            const merged = new Map<number, MapGeocache>();
            for (const geocache of this.geocaches) {
                merged.set(geocache.id, geocache);
            }
            for (const dto of zoneGeocaches) {
                const mapped = this.toMapGeocache(dto);
                if (mapped) {
                    merged.set(mapped.id, mapped);
                }
            }
            this.loadGeocaches([...merged.values()]);
        } catch (error) {
            console.error('[MapWidget] Unable to refresh geocaches after import', error);
        }
    }

    private handleNotify = (kind: 'info' | 'warn' | 'error', message: string): void => {
        switch (kind) {
            case 'error':
                this.messageService.error(message);
                break;
            case 'warn':
                this.messageService.warn(message);
                break;
            default:
                this.messageService.info(message);
        }
    };

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
            foundGeocacheDisplayMode: this.preferenceService.get('geoApp.map.foundGeocacheDisplayMode', 'transparent'),
            showExclusionZones: this.preferenceService.get('geoApp.map.showExclusionZones', true),
            showNearbyGeocaches: this.preferenceService.get('geoApp.map.showNearbyGeocaches', false),
            clusteringMode: this.preferenceService.get('geoApp.map.clusteringMode', 'auto'),
            clusteringThreshold: this.preferenceService.get('geoApp.map.clusteringThreshold', 200),
            geocodingProvider: this.preferenceService.get('geoApp.map.geocoding.provider', 'photon'),
            geoapifyApiKey: this.preferenceService.get('geoApp.map.geocoding.geoapifyApiKey', ''),
            geocodingAutoFallback: this.preferenceService.get('geoApp.map.geocoding.autoFallback', true)
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
        this.zoneListChangeDisposable.dispose();
        if (this.mapInstance) {
            this.mapInstance.setTarget(undefined);
            this.mapInstance = null;
        }
        super.dispose();
    }
}
