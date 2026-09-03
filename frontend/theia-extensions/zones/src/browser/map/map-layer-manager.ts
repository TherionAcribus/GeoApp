import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Map from 'ol/Map';
import { Point, Circle, LineString, Polygon } from 'ol/geom';
import Geometry from 'ol/geom/Geometry';
import { Style, Fill, Stroke, Circle as CircleStyle, Text } from 'ol/style';
import { getVectorContext } from 'ol/render';
import { unByKey } from 'ol/Observable';
import { EventsKey } from 'ol/events';
import { Coordinate } from 'ol/coordinate';
import { createClusterSource } from './map-clustering';
import { createGeocacheStyleFromSprite, createClusterStyleFromSprite, createWaypointStyleFromSprite, createDetectedCoordinateStyle, FoundGeocacheDisplayMode, GeocacheFeatureProperties, GeocacheStyleOptions } from './map-geocache-style-sprite';
import { lonLatToMapCoordinate } from './map-utils';
import { createTileLayer, DEFAULT_PROVIDER_ID } from './map-tile-providers';
import { DetectedCoordinateHighlight, FormulaSolverPreviewOverlay } from './map-service';

export type MapLabelMode = 'none' | 'geocaches' | 'waypoints' | 'all';

export type ClusteringMode = 'auto' | 'always' | 'never';

/**
 * Interface pour un waypoint de géocache
 */
export interface MapWaypoint {
    id: number;
    prefix: string | null;
    lookup: string | null;
    name: string | null;
    type: string | null;
    latitude: number | null;
    longitude: number | null;
    gc_coords: string | null;
    note: string | null;
}

/**
 * Interface pour une géocache à afficher sur la carte
 */
export interface MapGeocache {
    id: number;
    gc_code: string;
    name: string;
    cache_type: string;
    latitude: number;
    longitude: number;
    difficulty?: number;
    terrain?: number;
    found?: boolean;
    is_corrected?: boolean;
    original_latitude?: number;
    original_longitude?: number;
    waypoints?: MapWaypoint[];
    /**
     * Ligne libre affichée dans la popup, sous le titre. Utilisée par la carte des
     * amis (« Trouvée par Pseudo1, Pseudo2 — 26/07 ») ; vide ailleurs.
     */
    friendsNote?: string;
}

/**
 * Gestionnaire des couches de la carte
 * Gère les couches de tuiles (fond de carte) et les couches vectorielles (géocaches, waypoints)
 */
export class MapLayerManager {
    private map: Map;
    private tileLayer: any;
    private geocacheVectorSource: VectorSource<Feature<Point>>;
    private geocacheClusterSource: any;
    private geocacheLayer: any;
    private waypointVectorSource: VectorSource<Feature<Point>>;
    private waypointLayer: any;
    private detectedCoordinateSource: VectorSource<Feature<Point>>;
    private detectedCoordinateLayer: any;
    private nearbyGeocacheVectorSource: VectorSource<Feature<Point>>;
    private nearbyGeocacheLayer: any;
    private exclusionZoneVectorSource: VectorSource<Feature<Geometry>>;
    private exclusionZoneLayer: any;
    private formulaSolverPreviewVectorSource: VectorSource<Feature<Geometry>>;
    private formulaSolverPreviewLayer: any;
    private searchResultSource: VectorSource<Feature<Point>>;
    private searchResultLayer: any;
    private currentTileProviderId: string;
    private labelMode: MapLabelMode = 'none';
    private geocacheIconScale = 0.75;
    private foundGeocacheDisplayMode: FoundGeocacheDisplayMode = 'transparent';
    private clusteringEnabled = false;
    /** Mode de regroupement : 'auto' (selon le seuil), 'always' ou 'never'. */
    private clusteringMode: ClusteringMode = 'auto';
    /** Seuil de géocaches au-delà duquel le clustering est activé automatiquement (mode 'auto'). */
    private clusterThreshold = 200;
    /**
     * Signature de rendu par géocache (id → hash) pour ne re-synchroniser que ce qui change.
     * NB : `Map` est importé d'OpenLayers dans ce fichier, on utilise donc explicitement
     * le `Map` natif via `globalThis.Map`.
     */
    private geocacheSignatures = new globalThis.Map<number, string>();
    /** Identifiants des features waypoint rattachées à chaque géocache (id → feature ids). */
    private geocacheWaypointFeatureIds = new globalThis.Map<number, Array<number | string>>();
    /**
     * Géocaches cochées dans la liste (source de vérité : la propriété `listSelected`
     * des features en est dérivée, y compris pour celles créées plus tard).
     */
    private listSelectedIds = new globalThis.Set<number>();
    /**
     * Cercles de regroupement « cache + ses waypoints » (id de géocache → couleur).
     * Source de vérité : la propriété `groupColor` des features (géocache et
     * waypoints) en est dérivée, y compris pour celles créées plus tard.
     */
    private groupColors = new globalThis.Map<number, string>();
    /** Pulsations en cours (anneau qui s'élargit sur une cache qu'on vient de cocher). */
    private selectionPulses: Array<{ coordinate: Coordinate; start: number }> = [];
    /** Abonnement `postrender` actif tant qu'une pulsation est en cours. */
    private selectionPulseListener: EventsKey | undefined;
    /** Géocaches ayant déjà pulsé, pour ne pas les refaire pulser à chaque mise à jour. */
    private pulsedIds = new globalThis.Set<number>();
    /** Évaluation de la pulsation différée, le temps que la sélection se stabilise. */
    private pulseEvaluationTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(map: Map) {
        this.map = map;
        this.currentTileProviderId = DEFAULT_PROVIDER_ID;

        // Initialiser la couche de tuiles (fond de carte)
        this.tileLayer = createTileLayer(this.currentTileProviderId);
        this.map.addLayer(this.tileLayer);

        // Initialiser la couche vectorielle pour les géocaches
        this.geocacheVectorSource = new VectorSource<Feature<Point>>();
        this.geocacheClusterSource = createClusterSource(this.geocacheVectorSource);
        
        // Par défaut, afficher les géocaches individuellement (sans clustering)
        this.geocacheLayer = new VectorLayer({
            source: this.geocacheVectorSource as any,
            style: (feature, resolution) => createGeocacheStyleFromSprite(
                feature as Feature<Geometry>,
                resolution,
                { scale: this.geocacheIconScale, foundDisplayMode: this.foundGeocacheDisplayMode }
            ),
            properties: {
                name: 'geocaches'
            },
            zIndex: 10
        });
        this.map.addLayer(this.geocacheLayer);

        // Initialiser la couche pour les waypoints (pour usage futur)
        this.waypointVectorSource = new VectorSource<Feature<Point>>();
        this.waypointLayer = new VectorLayer({
            source: this.waypointVectorSource,
            style: createWaypointStyleFromSprite,
            properties: {
                name: 'waypoints'
            },
            zIndex: 5
        });
        this.map.addLayer(this.waypointLayer);

        // Couche pour une coordonnée détectée temporaire
        this.detectedCoordinateSource = new VectorSource<Feature<Point>>();
        this.detectedCoordinateLayer = new VectorLayer({
            source: this.detectedCoordinateSource,
            style: createDetectedCoordinateStyle,
            properties: {
                name: 'detected-coordinate'
            },
            zIndex: 30
        });
        this.map.addLayer(this.detectedCoordinateLayer);

        // Couche pour les géocaches voisines
        this.nearbyGeocacheVectorSource = new VectorSource<Feature<Point>>();
        this.nearbyGeocacheLayer = new VectorLayer({
            source: this.nearbyGeocacheVectorSource,
            style: (feature, resolution) => {
                const styleOptions: GeocacheStyleOptions = {
                    opacity: 0.6,
                    scale: this.geocacheIconScale * 0.7,
                    foundDisplayMode: this.foundGeocacheDisplayMode
                };
                return createGeocacheStyleFromSprite(feature as Feature<Geometry>, resolution, styleOptions);
            },
            properties: {
                name: 'nearby-geocaches'
            },
            zIndex: 5 // En dessous des géocaches normales
        });
        this.map.addLayer(this.nearbyGeocacheLayer);

        // Couche pour les zones d'exclusion (cercles de 161m)
        this.exclusionZoneVectorSource = new VectorSource<Feature<Geometry>>();
        this.exclusionZoneLayer = new VectorLayer({
            source: this.exclusionZoneVectorSource,
            style: this.createExclusionZoneStyle.bind(this),
            properties: {
                name: 'exclusion-zones'
            },
            zIndex: 1 // Tout en bas pour ne pas gêner
        });
        this.map.addLayer(this.exclusionZoneLayer);

        // Couche pour l'overlay "preview" du Formula Solver (zone/ligne/point estimés)
        this.formulaSolverPreviewVectorSource = new VectorSource<Feature<Geometry>>();
        this.formulaSolverPreviewLayer = new VectorLayer({
            source: this.formulaSolverPreviewVectorSource,
            style: this.createFormulaSolverPreviewStyle.bind(this),
            properties: {
                name: 'formula-solver-preview'
            },
            zIndex: 25
        });
        this.map.addLayer(this.formulaSolverPreviewLayer);

        // Couche pour le résultat de recherche d'adresse (marqueur temporaire)
        this.searchResultSource = new VectorSource<Feature<Point>>();
        this.searchResultLayer = new VectorLayer({
            source: this.searchResultSource,
            style: this.createSearchResultStyle.bind(this),
            properties: {
                name: 'search-result'
            },
            zIndex: 40 // Au-dessus de tout le reste
        });
        this.map.addLayer(this.searchResultLayer);
    }

    /**
     * Change le fournisseur de tuiles (fond de carte)
     */
    changeTileProvider(providerId: string): void {
        if (providerId === this.currentTileProviderId) {
            return;
        }

        this.currentTileProviderId = providerId;
        this.map.removeLayer(this.tileLayer);
        this.tileLayer = createTileLayer(providerId);
        this.map.getLayers().insertAt(0, this.tileLayer);
    }

    setFormulaSolverPreviewOverlay(overlay?: FormulaSolverPreviewOverlay): void {
        this.formulaSolverPreviewVectorSource.clear();
        if (!overlay) {
            return;
        }

        // 1) Cercle de contrainte (ex: 2 miles autour des coords fictives)
        if (overlay.circle) {
            const center = lonLatToMapCoordinate(overlay.circle.centerLon, overlay.circle.centerLat);
            // EPSG:3857 est une projection: 1 “mètre carte” ne correspond pas à 1m au sol.
            // Pour avoir un rayon “au sol” ~radiusMeters, on compense par le facteur 1/cos(lat).
            const latRad = (overlay.circle.centerLat * Math.PI) / 180;
            const scale = Math.max(0.2, Math.cos(latRad)); // garde-fou
            const projectedRadius = overlay.circle.radiusMeters / scale;
            const circleGeom = new Circle(center, projectedRadius);
            const circleFeature = new Feature({ geometry: circleGeom });
            circleFeature.setProperties({
                isFormulaSolverPreview: true,
                isFormulaSolverPreviewCircle: true,
                previewRole: 'circle',
                gcCode: overlay.gcCode,
                geocacheId: overlay.geocacheId
            });
            this.formulaSolverPreviewVectorSource.addFeature(circleFeature);
        }

        // 2) Candidate(s): brut (rouge si hors zone) + clippé (bleu)
        const raw = overlay.candidateRaw;
        const clipped = overlay.candidateClipped;

        const addCandidateFeature = (candidate: any, role: 'candidateRaw' | 'candidateClipped') => {
            const b = candidate.bounds;
            const minLon = b.minLon;
            const maxLon = b.maxLon;
            const minLat = b.minLat;
            const maxLat = b.maxLat;

            let geometry: Geometry | undefined;
            if (candidate.kind === 'point') {
                const centerLon = (minLon + maxLon) / 2;
                const centerLat = (minLat + maxLat) / 2;
                geometry = new Point(lonLatToMapCoordinate(centerLon, centerLat));
            } else if (candidate.kind === 'line-lat') {
                const lat = (minLat + maxLat) / 2;
                geometry = new LineString([
                    lonLatToMapCoordinate(minLon, lat),
                    lonLatToMapCoordinate(maxLon, lat)
                ]);
            } else if (candidate.kind === 'line-lon') {
                const lon = (minLon + maxLon) / 2;
                geometry = new LineString([
                    lonLatToMapCoordinate(lon, minLat),
                    lonLatToMapCoordinate(lon, maxLat)
                ]);
            } else {
                const coords = [
                    lonLatToMapCoordinate(minLon, minLat),
                    lonLatToMapCoordinate(maxLon, minLat),
                    lonLatToMapCoordinate(maxLon, maxLat),
                    lonLatToMapCoordinate(minLon, maxLat),
                    lonLatToMapCoordinate(minLon, minLat)
                ];
                geometry = new Polygon([coords]);
            }

            if (!geometry) {
                return;
            }

            const feature = new Feature({ geometry });
            feature.setProperties({
                isFormulaSolverPreview: true,
                isFormulaSolverPreviewCircle: false,
                previewRole: role,
                kind: candidate.kind,
                formatted: candidate.formatted,
                gcCode: overlay.gcCode,
                geocacheId: overlay.geocacheId
            });
            this.formulaSolverPreviewVectorSource.addFeature(feature);
        };

        // Afficher d'abord le clippé (bleu), puis le brut (rouge) au-dessus (dashed).
        if (clipped) {
            addCandidateFeature(clipped, 'candidateClipped');
        }
        if (raw) {
            addCandidateFeature(raw, 'candidateRaw');
        }
    }

    clearFormulaSolverPreviewOverlay(): void {
        this.formulaSolverPreviewVectorSource.clear();
    }

    private createFormulaSolverPreviewStyle(feature: Feature<Geometry>): Style {
        const isCircle = Boolean((feature as any).get('isFormulaSolverPreviewCircle'));
        const role = String((feature as any).get('previewRole') || '');

        const isRaw = role === 'candidateRaw';

        const strokeColor = isCircle
            ? 'rgba(255, 165, 0, 0.9)'
            : (isRaw ? 'rgba(220, 20, 60, 0.95)' : 'rgba(0, 122, 204, 0.9)');
        const fillColor = isCircle
            ? 'rgba(255, 165, 0, 0.04)'
            : (isRaw ? 'rgba(220, 20, 60, 0.02)' : 'rgba(0, 122, 204, 0.08)');

        const geometry = feature.getGeometry();
        const isPoint = geometry instanceof Point;

        // Pour les points, on utilise un style "marker" explicite (sinon c'est ambigu / parfois invisible).
        if (isPoint) {
            return new Style({
                image: new CircleStyle({
                    radius: 6,
                    fill: new Fill({ color: fillColor }),
                    stroke: new Stroke({
                        color: strokeColor,
                        width: 2,
                        lineDash: isRaw ? [6, 4] : undefined
                    })
                })
            });
        }

        // Polygones / lignes / cercles: style léger (pas de fill opaque)
        return new Style({
            stroke: new Stroke({
                color: strokeColor,
                width: 2,
                lineDash: isRaw ? [6, 4] : undefined
            }),
            fill: new Fill({
                color: fillColor
            })
        });
    }

    /**
     * Récupère l'ID du fournisseur de tuiles actuel
     */
    getCurrentTileProvider(): string {
        return this.currentTileProviderId;
    }

    setLabelMode(mode: MapLabelMode): void {
        if (this.labelMode === mode) {
            return;
        }
        this.labelMode = mode;
        this.refreshLabelVisibility();
    }

    setGeocacheIconScale(scale: number): void {
        const safeScale = Number.isFinite(scale) ? Math.min(1.4, Math.max(0.4, scale)) : 0.75;
        if (this.geocacheIconScale === safeScale) {
            return;
        }
        this.geocacheIconScale = safeScale;
        this.refreshGeocacheLayer();
        this.nearbyGeocacheVectorSource.changed();
    }

    setFoundGeocacheDisplayMode(mode: FoundGeocacheDisplayMode): void {
        if (this.foundGeocacheDisplayMode === mode) {
            return;
        }
        this.foundGeocacheDisplayMode = mode;
        this.refreshGeocacheLayer();
        this.nearbyGeocacheVectorSource.changed();
    }

    private shouldShowGeocacheLabels(): boolean {
        return this.labelMode === 'geocaches' || this.labelMode === 'all';
    }

    private shouldShowWaypointLabels(): boolean {
        return this.labelMode === 'waypoints' || this.labelMode === 'all';
    }

    private refreshLabelVisibility(): void {
        this.geocacheVectorSource.getFeatures().forEach(feature => {
            feature.set('showLabel', this.shouldShowGeocacheLabels());
            feature.changed();
        });
        this.nearbyGeocacheVectorSource.getFeatures().forEach(feature => {
            feature.set('showLabel', this.shouldShowGeocacheLabels());
            feature.changed();
        });
        this.waypointVectorSource.getFeatures().forEach(feature => {
            feature.set('showLabel', this.shouldShowWaypointLabels());
            feature.changed();
        });
        if (this.clusteringEnabled) {
            this.geocacheClusterSource.changed();
        }
    }

    /**
     * Ajoute une géocache à la carte
     */
    addGeocache(geocache: MapGeocache): Feature<Point> {
        const coordinate = lonLatToMapCoordinate(geocache.longitude, geocache.latitude);
        
        const feature = new Feature({
            geometry: new Point(coordinate)
        });

        feature.setId(geocache.id);
        feature.setProperties({
            id: geocache.id,
            gc_code: geocache.gc_code,
            name: geocache.name,
            cache_type: geocache.cache_type,
            geocacheLabel: `${geocache.name} (${geocache.gc_code})`,
            showLabel: this.shouldShowGeocacheLabels(),
            difficulty: geocache.difficulty,
            terrain: geocache.terrain,
            found: geocache.found,
            friendsNote: geocache.friendsNote,
            selected: false
        } as GeocacheFeatureProperties);

        this.geocacheVectorSource.addFeature(feature);
        return feature;
    }

    /**
     * Ajoute plusieurs géocaches à la carte (remplace l'ensemble courant).
     * Conservé pour compatibilité : délègue à la synchronisation incrémentale.
     */
    addGeocaches(geocaches: MapGeocache[]): void {
        this.clearGeocaches();
        this.syncGeocaches(geocaches);
    }

    /**
     * Synchronise l'affichage avec la liste de géocaches fournie, en ne touchant
     * qu'aux features réellement modifiées (ajout / mise à jour / suppression).
     * Évite de reconstruire toutes les features et tous les waypoints à chaque
     * changement (ex. ajout d'un waypoint sur une seule cache).
     */
    syncGeocaches(geocaches: MapGeocache[]): void {
        const incomingIds = new Set<number>();
        for (const geocache of geocaches) {
            incomingIds.add(geocache.id);
        }

        // 1. Supprimer les géocaches qui ne sont plus présentes (+ leurs waypoints)
        for (const feature of [...this.geocacheVectorSource.getFeatures()]) {
            const id = feature.getId();
            if (typeof id === 'number' && !incomingIds.has(id)) {
                this.geocacheVectorSource.removeFeature(feature);
                this.removeWaypointsForGeocache(id);
                this.geocacheSignatures.delete(id);
            }
        }

        // 2. Ajouter / mettre à jour uniquement ce qui a changé
        const newFeatures: Feature<Point>[] = [];
        for (const geocache of geocaches) {
            const signature = this.computeGeocacheSignature(geocache);
            if (this.geocacheSignatures.get(geocache.id) === signature) {
                continue; // inchangé → rien à faire
            }

            const existing = this.geocacheVectorSource.getFeatureById(geocache.id) as Feature<Point> | null;
            if (existing) {
                this.updateGeocacheFeature(existing, geocache);
                this.removeWaypointsForGeocache(geocache.id);
                this.addWaypointsForGeocache(geocache);
            } else {
                newFeatures.push(this.buildGeocacheFeature(geocache));
                this.addWaypointsForGeocache(geocache);
            }
            this.geocacheSignatures.set(geocache.id, signature);
        }

        if (newFeatures.length > 0) {
            this.geocacheVectorSource.addFeatures(newFeatures);
        }

        // Activer/désactiver le clustering selon le volume de géocaches
        this.applyClusteringState();
    }

    /**
     * Calcule une signature de rendu pour détecter si une géocache a changé.
     * Exclut volontairement l'état de sélection (géré séparément).
     */
    private computeGeocacheSignature(geocache: MapGeocache): string {
        const waypoints = (geocache.waypoints || [])
            .map(w => `${w.id}:${w.latitude}:${w.longitude}:${w.name || w.lookup || ''}:${w.type || ''}`)
            .join(';');
        return [
            geocache.latitude,
            geocache.longitude,
            geocache.cache_type,
            geocache.name,
            geocache.gc_code,
            geocache.found ? 1 : 0,
            geocache.difficulty,
            geocache.terrain,
            geocache.is_corrected ? 1 : 0,
            geocache.original_latitude,
            geocache.original_longitude,
            geocache.friendsNote,
            waypoints
        ].join('|');
    }

    /** Applique les propriétés de rendu sur une feature géocache (préserve la sélection). */
    private applyGeocacheProperties(feature: Feature<Point>, geocache: MapGeocache): void {
        feature.setProperties({
            id: geocache.id,
            gc_code: geocache.gc_code,
            name: geocache.name,
            cache_type: geocache.cache_type,
            geocacheLabel: `${geocache.name} (${geocache.gc_code})`,
            showLabel: this.shouldShowGeocacheLabels(),
            difficulty: geocache.difficulty,
            terrain: geocache.terrain,
            found: geocache.found,
            friendsNote: geocache.friendsNote,
            selected: feature.get('selected') === true,
            listSelected: this.listSelectedIds.has(geocache.id),
            groupColor: this.groupColors.get(geocache.id)
        } as GeocacheFeatureProperties);
    }

    /** Construit une nouvelle feature géocache. */
    private buildGeocacheFeature(geocache: MapGeocache): Feature<Point> {
        const feature = new Feature<Point>({
            geometry: new Point(lonLatToMapCoordinate(geocache.longitude, geocache.latitude))
        });
        feature.setId(geocache.id);
        this.applyGeocacheProperties(feature, geocache);
        return feature;
    }

    /** Met à jour une feature géocache existante (géométrie + propriétés) sans la recréer. */
    private updateGeocacheFeature(feature: Feature<Point>, geocache: MapGeocache): void {
        const coordinate = lonLatToMapCoordinate(geocache.longitude, geocache.latitude);
        const geometry = feature.getGeometry();
        if (geometry) {
            geometry.setCoordinates(coordinate);
        } else {
            feature.setGeometry(new Point(coordinate));
        }
        this.applyGeocacheProperties(feature, geocache);
    }

    /** Ajoute les waypoints (coordonnées originales + waypoints) d'une géocache et mémorise leurs ids. */
    private addWaypointsForGeocache(geocache: MapGeocache): void {
        const featureIds: Array<number | string> = [];

        // Coordonnées originales si la cache est corrigée
        if (geocache.is_corrected &&
            geocache.original_latitude != null &&
            geocache.original_longitude != null) {
            const feature = this.addWaypoint(
                `orig_${geocache.id}`,
                'Original',
                geocache.original_longitude,
                geocache.original_latitude,
                {
                    geocacheId: geocache.id,
                    geocacheName: geocache.name,
                    gcCode: geocache.gc_code,
                    cacheType: geocache.cache_type
                }
            );
            const id = feature.getId();
            if (id !== undefined) {
                featureIds.push(id);
            }
        }

        // Waypoints
        if (geocache.waypoints && geocache.waypoints.length > 0) {
            for (const waypoint of geocache.waypoints) {
                if (waypoint.latitude != null && waypoint.longitude != null) {
                    const feature = this.addWaypoint(
                        waypoint.id,
                        waypoint.name || waypoint.lookup || `WP${waypoint.id}`,
                        waypoint.longitude,
                        waypoint.latitude,
                        {
                            geocacheId: geocache.id,
                            geocacheName: geocache.name,
                            gcCode: geocache.gc_code,
                            cacheType: geocache.cache_type
                        }
                    );
                    const id = feature.getId();
                    if (id !== undefined) {
                        featureIds.push(id);
                    }
                }
            }
        }

        if (featureIds.length > 0) {
            this.geocacheWaypointFeatureIds.set(geocache.id, featureIds);
        } else {
            this.geocacheWaypointFeatureIds.delete(geocache.id);
        }
    }

    /** Supprime les features waypoint rattachées à une géocache. */
    private removeWaypointsForGeocache(geocacheId: number): void {
        const featureIds = this.geocacheWaypointFeatureIds.get(geocacheId);
        if (!featureIds) {
            return;
        }
        for (const id of featureIds) {
            const feature = this.waypointVectorSource.getFeatureById(id);
            if (feature) {
                this.waypointVectorSource.removeFeature(feature);
            }
        }
        this.geocacheWaypointFeatureIds.delete(geocacheId);
    }

    /**
     * Supprime une géocache de la carte par son ID (+ ses waypoints)
     */
    removeGeocache(geocacheId: number): void {
        const feature = this.geocacheVectorSource.getFeatureById(geocacheId);
        if (feature) {
            this.geocacheVectorSource.removeFeature(feature);
        }
        this.removeWaypointsForGeocache(geocacheId);
        this.geocacheSignatures.delete(geocacheId);
        this.applyClusteringState();
    }

    /**
     * Supprime toutes les géocaches de la carte
     */
    clearGeocaches(): void {
        this.geocacheVectorSource.clear();
        this.waypointVectorSource.clear();
        this.geocacheSignatures.clear();
        this.geocacheWaypointFeatureIds.clear();
        this.applyClusteringState();
    }

    /**
     * Récupère une feature géocache par son ID
     */
    getGeocacheFeature(geocacheId: number): Feature<Point> | null {
        return this.geocacheVectorSource.getFeatureById(geocacheId) as Feature<Point> | null;
    }

    /**
     * Récupère toutes les features géocaches
     */
    getAllGeocacheFeatures(): Feature<Point>[] {
        return this.geocacheVectorSource.getFeatures();
    }

    /**
     * Met en surbrillance une géocache (la sélectionne visuellement)
     */
    selectGeocache(geocacheId: number): void {

        // Désélectionner toutes les géocaches
        this.geocacheVectorSource.getFeatures().forEach(feature => {
            feature.set('selected', false);
        });

        // Sélectionner la géocache demandée
        const feature = this.geocacheVectorSource.getFeatureById(geocacheId);
        if (feature) {
            feature.set('selected', true);
            // Forcer le recalcul du style
            feature.changed();
            if (this.clusteringEnabled) {
                this.geocacheClusterSource.changed();
            }
        } else {
            console.warn(`[MapLayerManager] Aucune feature trouvée pour geocacheId ${geocacheId}. Features disponibles:`,
                this.geocacheVectorSource.getFeatures().map(f => f.getId()));
        }
    }

    /**
     * Reflète la sélection par cases à cocher de la liste des géocaches : un anneau
     * noir entoure chaque cache cochée, et celles qui viennent de l'être signalent
     * leur apparition par une brève pulsation.
     */
    setListSelection(geocacheIds: number[]): void {
        const next = new globalThis.Set(geocacheIds);
        const previous = this.listSelectedIds;
        if (next.size === previous.size && [...next].every(id => previous.has(id))) {
            return;
        }
        this.listSelectedIds = next;

        // L'anneau, lui, suit immédiatement : c'est le retour visuel du clic.
        for (const feature of this.geocacheVectorSource.getFeatures()) {
            const id = feature.getId();
            if (typeof id !== 'number') {
                continue;
            }
            const isSelected = next.has(id);
            if (feature.get('listSelected') === isSelected) {
                continue;
            }
            feature.set('listSelected', isSelected);
            feature.changed();
        }

        if (this.clusteringEnabled) {
            this.geocacheClusterSource.changed();
        }
        this.schedulePulseEvaluation();
    }

    /**
     * Applique les cercles de regroupement « cache + ses waypoints ».
     *
     * La couleur est portée par la géocache et par chacun de ses waypoints, sur
     * deux couches distinctes : c'est ce qui donne l'impression d'un seul et même
     * groupe. Indépendant de la sélection (anneau noir), avec lequel il cohabite.
     */
    setGroupHighlights(colorsByGeocacheId: ReadonlyMap<number, string>): void {
        const unchanged = colorsByGeocacheId.size === this.groupColors.size &&
            [...colorsByGeocacheId].every(([id, color]) => this.groupColors.get(id) === color);
        if (unchanged) {
            return;
        }
        this.groupColors = new globalThis.Map(colorsByGeocacheId);

        for (const feature of this.geocacheVectorSource.getFeatures()) {
            const id = feature.getId();
            if (typeof id !== 'number') {
                continue;
            }
            const color = this.groupColors.get(id);
            if (feature.get('groupColor') === color) {
                continue;
            }
            feature.set('groupColor', color);
            feature.changed();
        }

        for (const feature of this.waypointVectorSource.getFeatures()) {
            const parentId = feature.get('parentGeocacheId');
            const color = typeof parentId === 'number' ? this.groupColors.get(parentId) : undefined;
            if (feature.get('groupColor') === color) {
                continue;
            }
            feature.set('groupColor', color);
            feature.changed();
        }

        if (this.clusteringEnabled) {
            this.geocacheClusterSource.changed();
        }
    }

    /**
     * Diffère la décision « qui vient d'être coché ».
     *
     * Une sélection venue de la carte fait un aller-retour par le tableau, qui en
     * est le propriétaire, et traverse au passage plusieurs rendus successifs :
     * évaluée à chaque étape, la pulsation se déclencherait aussi sur les caches
     * déjà cochées qui repassent transitoirement par un état intermédiaire. On
     * attend donc que la sélection se stabilise avant de comparer.
     */
    private schedulePulseEvaluation(): void {
        if (this.pulseEvaluationTimer) {
            clearTimeout(this.pulseEvaluationTimer);
        }
        this.pulseEvaluationTimer = setTimeout(() => {
            this.pulseEvaluationTimer = undefined;
            this.pulseNewlySelected();
        }, MapLayerManager.SELECTION_PULSE_SETTLE_DELAY);
    }

    /** Fait pulser les caches cochées depuis la dernière évaluation. */
    private pulseNewlySelected(): void {
        const coordinates: Coordinate[] = [];
        for (const id of this.listSelectedIds) {
            if (this.pulsedIds.has(id)) {
                continue;
            }
            const feature = this.geocacheVectorSource.getFeatureById(id) as Feature<Point> | null;
            const coordinate = feature?.getGeometry()?.getCoordinates();
            if (coordinate) {
                coordinates.push(coordinate);
            }
        }
        // Une cache décochée doit pouvoir repulser si on la recoche plus tard.
        this.pulsedIds = new globalThis.Set(this.listSelectedIds);
        this.startSelectionPulse(coordinates);
    }

    /** Durée d'une pulsation de sélection, en millisecondes. */
    private static readonly SELECTION_PULSE_DURATION = 550;

    /**
     * Délai d'attente avant d'évaluer la pulsation, en millisecondes. Doit couvrir
     * l'aller-retour tableau ↔ carte (quelques rendus React) tout en restant
     * imperceptible.
     */
    private static readonly SELECTION_PULSE_SETTLE_DELAY = 100;

    /**
     * Démarre une pulsation sur les points donnés. Le dessin se fait dans le
     * contexte vectoriel du `postrender` de la couche géocaches : rien n'est ajouté
     * à la source, donc ni le clustering ni les clics ne sont perturbés.
     */
    private startSelectionPulse(coordinates: Coordinate[]): void {
        if (coordinates.length === 0) {
            return;
        }
        const start = Date.now();
        for (const coordinate of coordinates) {
            this.selectionPulses.push({ coordinate, start });
        }
        if (!this.selectionPulseListener) {
            this.selectionPulseListener = this.geocacheLayer.on('postrender', this.renderSelectionPulse);
        }
        this.map.render();
    }

    private readonly renderSelectionPulse = (event: any): void => {
        const now = Date.now();
        const duration = MapLayerManager.SELECTION_PULSE_DURATION;
        this.selectionPulses = this.selectionPulses.filter(pulse => now - pulse.start < duration);

        if (this.selectionPulses.length === 0) {
            this.stopSelectionPulse();
            return;
        }

        const vectorContext = getVectorContext(event);
        for (const pulse of this.selectionPulses) {
            const progress = (now - pulse.start) / duration;
            vectorContext.setStyle(new Style({
                image: new CircleStyle({
                    radius: 12 + progress * 26,
                    stroke: new Stroke({
                        color: `rgba(17, 17, 17, ${1 - progress})`,
                        width: 3
                    })
                })
            }));
            vectorContext.drawGeometry(new Point(pulse.coordinate));
        }
        this.map.render();
    };

    /** Coupe l'abonnement `postrender` une fois toutes les pulsations terminées. */
    private stopSelectionPulse(): void {
        if (this.selectionPulseListener) {
            unByKey(this.selectionPulseListener);
            this.selectionPulseListener = undefined;
        }
        this.selectionPulses = [];
    }

    /**
     * Désélectionne toutes les géocaches
     */
    deselectAllGeocaches(): void {
        this.geocacheVectorSource.getFeatures().forEach(feature => {
            feature.set('selected', false);
            feature.changed();
        });
        if (this.clusteringEnabled) {
            this.geocacheClusterSource.changed();
        }
    }

    /**
     * Ajoute un waypoint
     */
    addWaypoint(
        id: number | string,
        name: string,
        lon: number,
        lat: number,
        parent?: { geocacheId?: number; geocacheName: string; gcCode: string; cacheType: string }
    ): Feature<Point> {
        const coordinate = lonLatToMapCoordinate(lon, lat);
        
        const feature = new Feature({
            geometry: new Point(coordinate)
        });

        feature.setId(`waypoint_${id}`);
        feature.setProperties({
            id: id,
            name: name,
            waypointLabel: parent ? `${parent.geocacheName} (${parent.gcCode}) - ${name}` : name,
            parentCacheType: parent?.cacheType,
            parentGeocacheId: parent?.geocacheId,
            groupColor: parent?.geocacheId !== undefined ? this.groupColors.get(parent.geocacheId) : undefined,
            gc_code: parent?.gcCode,
            cache_type: parent?.cacheType || 'Waypoint',
            showLabel: this.shouldShowWaypointLabels(),
            type: 'waypoint',
            selected: false,
            isWaypoint: true,  // ✅ Marquer comme waypoint pour le menu contextuel
            waypointId: typeof id === 'number' ? id : undefined  // ✅ ID numérique du waypoint (pas pour les waypoints "orig_")
        });

        this.waypointVectorSource.addFeature(feature);
        return feature;
    }

    /**
     * Supprime tous les waypoints
     */
    clearWaypoints(): void {
        this.waypointVectorSource.clear();
    }

    /**
     * Affiche une coordonnée détectée temporaire sur la carte.
     */
    showDetectedCoordinate(highlight: DetectedCoordinateHighlight): void {
        
        // Par défaut on remplace l'ancien point (clear).
        // Si replaceExisting === false, on garde l'existant (mode multi-points géré aussi par showMultipleDetectedCoordinates).
        const shouldClear = highlight.replaceExisting !== false;
        if (shouldClear) {
            this.detectedCoordinateSource.clear();
        }

        if (highlight.latitude === undefined || highlight.longitude === undefined) {
            return;
        }

        const coordinate = lonLatToMapCoordinate(highlight.longitude, highlight.latitude);
        
        const feature = new Feature({
            geometry: new Point(coordinate)
        });

        feature.setProperties({
            isDetectedCoordinate: true,
            formatted: highlight.formatted,
            pluginName: highlight.pluginName,
            autoSaved: highlight.autoSaved,
            gcCode: highlight.gcCode,
            geocacheId: highlight.geocacheId,
            latDecimal: highlight.latitude,
            lonDecimal: highlight.longitude,
            replaceExisting: highlight.replaceExisting,
            waypointTitle: highlight.waypointTitle,
            waypointNote: highlight.waypointNote,
            sourceResultText: highlight.sourceResultText,
            bruteForceId: highlight.bruteForceId,
            gc_code: highlight.gcCode || 'Point détecté',
            name: highlight.waypointTitle || highlight.pluginName || highlight.formatted || 'Coordonnée détectée',
            cache_type: 'Coordonnée détectée',
            note: highlight.waypointNote || highlight.sourceResultText || highlight.formatted || '',
            coordinatesFormatted: highlight.formatted
        });

        this.detectedCoordinateSource.addFeature(feature);
    }

    /**
     * Affiche plusieurs coordonnées détectées simultanément (pour brute force)
     */
    showMultipleDetectedCoordinates(highlights: DetectedCoordinateHighlight[]): void {
        
        // Effacer les points précédents
        this.detectedCoordinateSource.clear();
        
        // Ajouter chaque point
        for (const highlight of highlights) {
            if (highlight.latitude === undefined || highlight.longitude === undefined) {
                console.warn('[MapLayerManager] Skipping invalid coordinate', highlight);
                continue;
            }

            const coordinate = lonLatToMapCoordinate(highlight.longitude, highlight.latitude);
            
            const feature = new Feature({
                geometry: new Point(coordinate)
            });

            feature.setProperties({
                isDetectedCoordinate: true,
                formatted: highlight.formatted,
                pluginName: highlight.pluginName,
                autoSaved: highlight.autoSaved,
                gcCode: highlight.gcCode,
                geocacheId: highlight.geocacheId,
                latDecimal: highlight.latitude,
                lonDecimal: highlight.longitude,
                replaceExisting: highlight.replaceExisting,
                waypointTitle: highlight.waypointTitle,
                waypointNote: highlight.waypointNote,
                sourceResultText: highlight.sourceResultText,
                bruteForceId: highlight.bruteForceId,
                gc_code: highlight.gcCode || 'Point détecté',
                name: highlight.waypointTitle || highlight.pluginName || highlight.formatted || 'Coordonnée détectée',
                cache_type: 'Coordonnée détectée',
                note: highlight.waypointNote || highlight.sourceResultText || highlight.formatted || '',
                coordinatesFormatted: highlight.formatted
            });

            this.detectedCoordinateSource.addFeature(feature);
        }
        
    }

    clearDetectedCoordinate(): void {
        this.detectedCoordinateSource.clear();
    }

    /**
     * Affiche un marqueur temporaire pour un résultat de recherche d'adresse.
     * Remplace le marqueur précédent.
     */
    showSearchResult(lon: number, lat: number, label?: string): void {
        this.searchResultSource.clear();

        if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
            return;
        }

        const feature = new Feature({
            geometry: new Point(lonLatToMapCoordinate(lon, lat))
        });
        feature.setProperties({
            isSearchResult: true,
            searchLabel: label || ''
        });
        this.searchResultSource.addFeature(feature);
    }

    /**
     * Efface le marqueur de résultat de recherche.
     */
    clearSearchResult(): void {
        this.searchResultSource.clear();
    }

    /**
     * Style du marqueur de résultat de recherche (épingle mise en évidence + libellé).
     */
    private createSearchResultStyle(feature: Feature<Geometry>): Style {
        const label = String(feature.get('searchLabel') || '');
        return new Style({
            image: new CircleStyle({
                radius: 8,
                fill: new Fill({ color: 'rgba(220, 20, 60, 0.85)' }),
                stroke: new Stroke({ color: '#ffffff', width: 2 })
            }),
            text: label
                ? new Text({
                    text: label.length > 60 ? `${label.slice(0, 57)}…` : label,
                    offsetY: -16,
                    font: '12px sans-serif',
                    fill: new Fill({ color: '#ffffff' }),
                    backgroundFill: new Fill({ color: 'rgba(0, 0, 0, 0.7)' }),
                    padding: [3, 5, 3, 5],
                    overflow: true
                })
                : undefined
        });
    }

    /**
     * Récupère la source vectorielle des géocaches (pour interactions avancées)
     */
    getGeocacheVectorSource(): VectorSource<Feature<Point>> {
        return this.geocacheVectorSource;
    }

    /**
     * Récupère la source de clustering (pour interactions avancées)
     */
    getGeocacheClusterSource(): any {
        return this.geocacheClusterSource;
    }

    /**
     * Active ou désactive le clustering des géocaches.
     * Le style de cluster s'appuie sur le sprite : un cluster d'une seule cache
     * retombe sur l'icône individuelle, ce qui assure le dégroupage au zoom.
     */
    setClusteringEnabled(enabled: boolean): void {
        if (enabled === this.clusteringEnabled) {
            return;
        }
        this.clusteringEnabled = enabled;

        if (enabled) {
            this.geocacheLayer.setSource(this.geocacheClusterSource);
            this.geocacheLayer.setStyle((feature, resolution) => createClusterStyleFromSprite(
                feature as Feature<Geometry>,
                resolution,
                { scale: this.geocacheIconScale, foundDisplayMode: this.foundGeocacheDisplayMode }
            ));
        } else {
            this.geocacheLayer.setSource(this.geocacheVectorSource as any);
            this.geocacheLayer.setStyle((feature, resolution) => createGeocacheStyleFromSprite(
                feature as Feature<Geometry>,
                resolution,
                { scale: this.geocacheIconScale, foundDisplayMode: this.foundGeocacheDisplayMode }
            ));
        }
    }

    /**
     * Indique si le clustering est actuellement actif.
     */
    isClusteringEnabled(): boolean {
        return this.clusteringEnabled;
    }

    /**
     * Définit le mode de regroupement et réévalue l'état du clustering.
     */
    setClusteringMode(mode: ClusteringMode): void {
        if (this.clusteringMode === mode) {
            return;
        }
        this.clusteringMode = mode;
        this.applyClusteringState();
    }

    /**
     * Définit le seuil d'activation automatique du clustering (mode 'auto').
     */
    setClusterThreshold(threshold: number): void {
        const safe = Number.isFinite(threshold) ? Math.max(1, Math.floor(threshold)) : 200;
        if (this.clusterThreshold === safe) {
            return;
        }
        this.clusterThreshold = safe;
        this.applyClusteringState();
    }

    /**
     * Active/désactive le clustering selon le mode courant et le nombre de géocaches.
     */
    private applyClusteringState(): void {
        let shouldCluster: boolean;
        switch (this.clusteringMode) {
            case 'always':
                shouldCluster = true;
                break;
            case 'never':
                shouldCluster = false;
                break;
            default: {
                const count = this.geocacheVectorSource.getFeatures().length;
                shouldCluster = count >= this.clusterThreshold;
            }
        }
        this.setClusteringEnabled(shouldCluster);
    }

    /**
     * Force le rafraîchissement visuel de la couche géocaches, en tenant compte
     * de la source active (vectorielle ou cluster).
     */
    private refreshGeocacheLayer(): void {
        this.geocacheVectorSource.changed();
        if (this.clusteringEnabled) {
            this.geocacheClusterSource.changed();
        }
    }

    /**
     * Ajoute les géocaches voisines à afficher
     */
    addNearbyGeocaches(geocaches: MapGeocache[]): void {

        // Effacer les géocaches voisines existantes
        this.clearNearbyGeocaches();

        const features = geocaches.map(geocache => {
            const coordinate = lonLatToMapCoordinate(geocache.longitude, geocache.latitude);

            const feature = new Feature({
                geometry: new Point(coordinate)
            });

            feature.setId(`nearby_${geocache.id}`);
            feature.setProperties({
                id: geocache.id,
                gc_code: geocache.gc_code,
                name: geocache.name,
                cache_type: geocache.cache_type,
                geocacheLabel: `${geocache.name} (${geocache.gc_code})`,
                showLabel: this.shouldShowGeocacheLabels(),
                difficulty: geocache.difficulty,
                terrain: geocache.terrain,
                found: geocache.found,
                selected: false,
                isNearby: true  // Marquer comme géocache voisine
            } as GeocacheFeatureProperties);

            return feature;
        });

        this.nearbyGeocacheVectorSource.addFeatures(features);
    }

    /**
     * Efface toutes les géocaches voisines
     */
    clearNearbyGeocaches(): void {
        this.nearbyGeocacheVectorSource.clear();
    }

    /**
     * Crée le style pour une zone d'exclusion (cercle de 161m)
     */
    private createExclusionZoneStyle(feature: Feature<Geometry>): Style | Style[] {
        const properties = feature.getProperties() as {
            zoneType: 'traditional' | 'corrected' | 'multi' | 'letterbox';
        };

        let fillColor: string;
        let strokeColor: string;

        // Couleurs selon le type de zone d'exclusion
        switch (properties.zoneType) {
            case 'traditional':
                fillColor = 'rgba(0, 255, 0, 0.1)'; // Vert transparent
                strokeColor = 'rgba(0, 255, 0, 0.5)';
                break;
            case 'corrected':
                fillColor = 'rgba(255, 255, 0, 0.1)'; // Jaune transparent
                strokeColor = 'rgba(255, 255, 0, 0.5)';
                break;
            case 'multi':
                fillColor = 'rgba(255, 165, 0, 0.1)'; // Orange transparent
                strokeColor = 'rgba(255, 165, 0, 0.5)';
                break;
            case 'letterbox':
                fillColor = 'rgba(128, 0, 128, 0.1)'; // Violet transparent
                strokeColor = 'rgba(128, 0, 128, 0.5)';
                break;
            default:
                fillColor = 'rgba(255, 0, 0, 0.1)'; // Rouge transparent par défaut
                strokeColor = 'rgba(255, 0, 0, 0.5)';
        }

        return new Style({
            fill: new Fill({
                color: fillColor
            }),
            stroke: new Stroke({
                color: strokeColor,
                width: 2,
                lineDash: [5, 5] // Ligne en pointillés
            })
        });
    }

    /**
     * Affiche les zones d'exclusion autour des géocaches selon les règles
     */
    showExclusionZones(geocaches: MapGeocache[]): void {

        // Effacer les zones existantes
        this.clearExclusionZones();

        const features: Feature<Geometry>[] = [];

        geocaches.forEach(geocache => {
            let shouldShowZone = false;
            let zoneType: 'traditional' | 'corrected' | 'multi' | 'letterbox' = 'traditional';

            // Logique selon les règles spécifiées
            const cacheType = geocache.cache_type?.toLowerCase();

            if (cacheType === 'traditional') {
                // Toujours afficher pour les Traditional
                shouldShowZone = true;
                zoneType = 'traditional';
            } else if ((cacheType === 'mystery' || cacheType === 'wherigo') && geocache.is_corrected) {
                // Afficher seulement si corrigé pour Mystery et Wherigo
                shouldShowZone = true;
                zoneType = 'corrected';
            } else if (cacheType === 'multi') {
                // Toujours afficher pour les Multi (couleur différente)
                shouldShowZone = true;
                zoneType = 'multi';
            } else if (cacheType === 'letterbox') {
                // Toujours afficher pour les Letterbox (couleur différente)
                shouldShowZone = true;
                zoneType = 'letterbox';
            }

            if (shouldShowZone && geocache.latitude && geocache.longitude) {
                const centerCoordinate = lonLatToMapCoordinate(geocache.longitude, geocache.latitude);

                // Créer un cercle de 161m
                // En projection Web Mercator (EPSG:3857), les unités sont des mètres à l'équateur
                // Pour plus de précision, on ajuste selon la latitude :
                // Plus on s'éloigne de l'équateur, plus les distances horizontales sont compressées
                const radiusMeters = 161;
                const latitude = geocache.latitude;

                // Facteur de correction pour la projection Mercator
                // cos(latitude) compense la distortion de la projection
                const mercatorCorrection = Math.cos((latitude * Math.PI) / 180);
                const radiusInMapUnits = radiusMeters / mercatorCorrection;

                const circleGeometry = new Circle(centerCoordinate, radiusInMapUnits);

                const feature = new Feature(circleGeometry);
                feature.setProperties({
                    zoneType: zoneType,
                    geocacheId: geocache.id,
                    geocacheCode: geocache.gc_code
                });

                features.push(feature);
            }
        });

        this.exclusionZoneVectorSource.addFeatures(features);
    }

    /**
     * Masque toutes les zones d'exclusion
     */
    clearExclusionZones(): void {
        this.exclusionZoneVectorSource.clear();
    }

    /**
     * Nettoie toutes les couches
     */
    dispose(): void {
        if (this.pulseEvaluationTimer) {
            clearTimeout(this.pulseEvaluationTimer);
            this.pulseEvaluationTimer = undefined;
        }
        this.stopSelectionPulse();
        this.clearGeocaches();
        this.clearWaypoints();
        this.clearDetectedCoordinate();
        this.clearNearbyGeocaches();
        this.clearExclusionZones();
        this.clearSearchResult();
    }
}

