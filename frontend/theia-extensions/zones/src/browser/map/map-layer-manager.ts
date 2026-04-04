import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Map from 'ol/Map';
import { Point, Circle, LineString, Polygon } from 'ol/geom';
import Geometry from 'ol/geom/Geometry';
import { Style, Fill, Stroke, Circle as CircleStyle } from 'ol/style';
import { createClusterSource } from './map-clustering';
import { createClusterStyle } from './map-geocache-style';
import { createGeocacheStyleFromSprite, createWaypointStyleFromSprite, createDetectedCoordinateStyle, GeocacheFeatureProperties, GeocacheStyleOptions } from './map-geocache-style-sprite';
import { lonLatToMapCoordinate } from './map-utils';
import { createTileLayer, DEFAULT_PROVIDER_ID } from './map-tile-providers';
import { DetectedCoordinateHighlight, FormulaSolverPreviewOverlay } from './map-service';

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
    private currentTileProviderId: string;

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
            style: createGeocacheStyleFromSprite,
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
            zIndex: 20
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
                const styleOptions: GeocacheStyleOptions = { opacity: 0.6, scale: 0.7 };
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
            difficulty: geocache.difficulty,
            terrain: geocache.terrain,
            found: geocache.found,
            selected: false
        } as GeocacheFeatureProperties);

        this.geocacheVectorSource.addFeature(feature);
        return feature;
    }

    /**
     * Ajoute plusieurs géocaches à la carte
     */
    addGeocaches(geocaches: MapGeocache[]): void {
        console.log('[MapLayerManager] addGeocaches appelé avec:', geocaches.length, 'géocaches');
        
        // Effacer les waypoints existants
        this.clearWaypoints();
        
        const features = geocaches.map(geocache => {
            const coordinate = lonLatToMapCoordinate(geocache.longitude, geocache.latitude);
            console.log(`[MapLayerManager] Géocache ${geocache.gc_code}: lon=${geocache.longitude}, lat=${geocache.latitude} -> coord=`, coordinate);
            
            const feature = new Feature({
                geometry: new Point(coordinate)
            });

            feature.setId(geocache.id);
            feature.setProperties({
                id: geocache.id,
                gc_code: geocache.gc_code,
                name: geocache.name,
                cache_type: geocache.cache_type,
                difficulty: geocache.difficulty,
                terrain: geocache.terrain,
                found: geocache.found,
                selected: false
            } as GeocacheFeatureProperties);

            return feature;
        });

        console.log('[MapLayerManager] Features créées:', features.length);
        this.geocacheVectorSource.addFeatures(features);
        console.log('[MapLayerManager] Features ajoutées à la source vectorielle');
        console.log('[MapLayerManager] Nombre total de features dans la source:', this.geocacheVectorSource.getFeatures().length);
        
        // Ajouter les waypoints et coordonnées originales
        geocaches.forEach(geocache => {
            // Ajouter les coordonnées originales si la cache est corrigée
            if (geocache.is_corrected && 
                geocache.original_latitude !== null && 
                geocache.original_latitude !== undefined &&
                geocache.original_longitude !== null && 
                geocache.original_longitude !== undefined) {
                this.addWaypoint(
                    `orig_${geocache.id}`,
                    `${geocache.gc_code} - Original`,
                    geocache.original_longitude,
                    geocache.original_latitude
                );
            }
            
            // Ajouter les waypoints
            if (geocache.waypoints && geocache.waypoints.length > 0) {
                geocache.waypoints.forEach(waypoint => {
                    if (waypoint.latitude !== null && 
                        waypoint.latitude !== undefined &&
                        waypoint.longitude !== null && 
                        waypoint.longitude !== undefined) {
                        this.addWaypoint(
                            waypoint.id,
                            waypoint.name || waypoint.lookup || `WP${waypoint.id}`,
                            waypoint.longitude,
                            waypoint.latitude
                        );
                    }
                });
            }
        });
    }

    /**
     * Supprime une géocache de la carte par son ID
     */
    removeGeocache(geocacheId: number): void {
        const feature = this.geocacheVectorSource.getFeatureById(geocacheId);
        if (feature) {
            this.geocacheVectorSource.removeFeature(feature);
        }
    }

    /**
     * Supprime toutes les géocaches de la carte
     */
    clearGeocaches(): void {
        this.geocacheVectorSource.clear();
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
        console.log(`[MapLayerManager] selectGeocache appelé pour geocacheId:`, geocacheId);

        // Désélectionner toutes les géocaches
        this.geocacheVectorSource.getFeatures().forEach(feature => {
            feature.set('selected', false);
        });

        // Sélectionner la géocache demandée
        const feature = this.geocacheVectorSource.getFeatureById(geocacheId);
        if (feature) {
            console.log(`[MapLayerManager] Feature trouvée pour geocacheId ${geocacheId}, sélection en cours`);
            feature.set('selected', true);
            // Forcer le recalcul du style
            feature.changed();
        } else {
            console.warn(`[MapLayerManager] Aucune feature trouvée pour geocacheId ${geocacheId}. Features disponibles:`,
                this.geocacheVectorSource.getFeatures().map(f => f.getId()));
        }
    }

    /**
     * Désélectionne toutes les géocaches
     */
    deselectAllGeocaches(): void {
        this.geocacheVectorSource.getFeatures().forEach(feature => {
            feature.set('selected', false);
            feature.changed();
        });
    }

    /**
     * Ajoute un waypoint
     */
    addWaypoint(id: number | string, name: string, lon: number, lat: number): Feature<Point> {
        const coordinate = lonLatToMapCoordinate(lon, lat);
        
        const feature = new Feature({
            geometry: new Point(coordinate)
        });

        feature.setId(`waypoint_${id}`);
        feature.setProperties({
            id: id,
            name: name,
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
        console.log('[MapLayerManager] showDetectedCoordinate called', highlight);
        
        // Par défaut on remplace l'ancien point (clear).
        // Si replaceExisting === false, on garde l'existant (mode multi-points géré aussi par showMultipleDetectedCoordinates).
        const shouldClear = highlight.replaceExisting !== false;
        if (shouldClear) {
            console.log('[MapLayerManager] Clearing previous detected coordinates');
            this.detectedCoordinateSource.clear();
        }

        if (highlight.latitude === undefined || highlight.longitude === undefined) {
            console.log('[MapLayerManager] Invalid coordinates, skipping');
            return;
        }

        const coordinate = lonLatToMapCoordinate(highlight.longitude, highlight.latitude);
        console.log('[MapLayerManager] Creating feature at coordinate', coordinate);
        
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
        console.log('[MapLayerManager] Feature added to detectedCoordinateSource, total features:', this.detectedCoordinateSource.getFeatures().length);
    }

    /**
     * Affiche plusieurs coordonnées détectées simultanément (pour brute force)
     */
    showMultipleDetectedCoordinates(highlights: DetectedCoordinateHighlight[]): void {
        console.log('[MapLayerManager] showMultipleDetectedCoordinates called', highlights.length);
        
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
        
        console.log('[MapLayerManager] Added', highlights.length, 'features to detectedCoordinateSource, total:', this.detectedCoordinateSource.getFeatures().length);
    }

    clearDetectedCoordinate(): void {
        this.detectedCoordinateSource.clear();
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
     * Active ou désactive le clustering
     */
    setClusteringEnabled(enabled: boolean): void {
        if (enabled) {
            this.geocacheLayer.setSource(this.geocacheClusterSource);
            this.geocacheLayer.setStyle(createClusterStyle);
        } else {
            this.geocacheLayer.setSource(this.geocacheVectorSource as any);
            this.geocacheLayer.setStyle(createGeocacheStyleFromSprite);
        }
    }

    /**
     * Ajoute les géocaches voisines à afficher
     */
    addNearbyGeocaches(geocaches: MapGeocache[]): void {
        console.log('[MapLayerManager] addNearbyGeocaches appelé avec:', geocaches.length, 'géocaches voisines');

        // Effacer les géocaches voisines existantes
        this.clearNearbyGeocaches();

        const features = geocaches.map(geocache => {
            const coordinate = lonLatToMapCoordinate(geocache.longitude, geocache.latitude);
            console.log(`[MapLayerManager] Géocache voisine ${geocache.gc_code}: lon=${geocache.longitude}, lat=${geocache.latitude} -> coord=`, coordinate);

            const feature = new Feature({
                geometry: new Point(coordinate)
            });

            feature.setId(`nearby_${geocache.id}`);
            feature.setProperties({
                id: geocache.id,
                gc_code: geocache.gc_code,
                name: geocache.name,
                cache_type: geocache.cache_type,
                difficulty: geocache.difficulty,
                terrain: geocache.terrain,
                found: geocache.found,
                selected: false,
                isNearby: true  // Marquer comme géocache voisine
            } as GeocacheFeatureProperties);

            return feature;
        });

        console.log('[MapLayerManager] Features voisines créées:', features.length);
        this.nearbyGeocacheVectorSource.addFeatures(features);
        console.log('[MapLayerManager] Features voisines ajoutées à la source vectorielle');
    }

    /**
     * Efface toutes les géocaches voisines
     */
    clearNearbyGeocaches(): void {
        console.log('[MapLayerManager] clearNearbyGeocaches');
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
        console.log('[MapLayerManager] showExclusionZones pour', geocaches.length, 'géocaches');

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

        console.log('[MapLayerManager] Création de', features.length, 'zones d\'exclusion');
        this.exclusionZoneVectorSource.addFeatures(features);
    }

    /**
     * Masque toutes les zones d'exclusion
     */
    clearExclusionZones(): void {
        console.log('[MapLayerManager] clearExclusionZones');
        this.exclusionZoneVectorSource.clear();
    }

    /**
     * Nettoie toutes les couches
     */
    dispose(): void {
        this.clearGeocaches();
        this.clearWaypoints();
        this.clearDetectedCoordinate();
        this.clearNearbyGeocaches();
        this.clearExclusionZones();
    }
}

