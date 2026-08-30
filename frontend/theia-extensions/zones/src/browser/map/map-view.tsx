import * as React from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import { defaults as defaultControls, ScaleLine, FullScreen } from 'ol/control';
import { defaults as defaultInteractions } from 'ol/interaction';
import Overlay from 'ol/Overlay';
import Feature from 'ol/Feature';
import { Geometry, Point } from 'ol/geom';
import 'ol/ol.css';
import '../../../src/browser/map/map-widget.css';
import { MapLayerManager, MapGeocache, MapLabelMode, ClusteringMode } from './map-layer-manager';
import { MapService, DetectedCoordinateHighlight, FormulaSolverPreviewOverlay } from './map-service';
import { lonLatToMapCoordinate, calculateExtent, mapCoordinateToLonLat, formatGeocachingCoordinates } from './map-utils';
import { TILE_PROVIDERS } from './map-tile-providers';
import { fromLonLat } from 'ol/proj';
import { GeocacheFeatureProperties } from './map-geocache-style-sprite';
import { FoundGeocacheDisplayMode } from './map-geocache-style-sprite';
import { ContextMenu, ContextMenuItem } from '../context-menu';
import type { ImportAroundCenter } from '../import-around-dialog';
import {
    geocodeAddress,
    GeocodingConfig,
    GeocodingProviderId,
    GeocodingResult,
    GEOCODING_PROVIDER_LABELS
} from './map-geocoding';

export interface MapViewPreferences {
    defaultProvider: string;
    defaultZoom: number;
    geocacheIconScale: number;
    foundGeocacheDisplayMode: FoundGeocacheDisplayMode;
    showExclusionZones: boolean;
    showNearbyGeocaches: boolean;
    clusteringMode: ClusteringMode;
    clusteringThreshold: number;
    geocodingProvider: GeocodingProviderId;
    geoapifyApiKey: string;
    geocodingAutoFallback: boolean;
}

export type MapNotifyKind = 'info' | 'warn' | 'error';

export interface MapViewProps {
    mapId?: string;
    mapService: MapService;
    geocaches: MapGeocache[];  // ✅ Données propres à cette carte
    /** Géocaches cochées dans la liste : anneau noir + pulsation à la sélection. */
    selectedGeocacheIds?: number[];
    /**
     * Modifie la sélection du tableau depuis la carte (Ctrl+clic, menu contextuel).
     * Absent sur les cartes sans tableau associé : les entrées de menu correspondantes
     * ne sont alors pas proposées.
     */
    onChangeListSelection?: (geocacheIds: number[], mode: 'toggle' | 'add' | 'remove' | 'clear') => void;
    onMapReady?: (map: Map) => void;
    onLoadNearbyGeocaches?: (geocacheId: number, radiusKm: number) => Promise<MapGeocache[]>;
    onAddWaypoint?: (options: { gcCoords: string; title?: string; note?: string; autoSave?: boolean }) => void;  // ✅ Callback pour ajouter un waypoint (carte géocache)
    onAddWaypointFromDetected?: (geocacheId: number, options: { gcCoords: string; title?: string; note?: string; autoSave?: boolean }) => void;  // ✅ Callback pour ajouter un waypoint depuis une coordonnée détectée (carte batch)
    onDeleteWaypoint?: (waypointId: number) => void;  // ✅ Callback pour supprimer un waypoint
    onSetWaypointAsCorrectedCoords?: (waypointId: number) => void;  // ✅ Callback pour définir comme coordonnées corrigées
    onSetDetectedAsCorrectedCoords?: (geocacheId: number, gcCoords: string) => void;  // ✅ Callback pour corriger les coordonnées d'une géocache depuis une coordonnée détectée
    onOpenGeocacheDetails?: (geocacheId: number, geocacheName: string) => void;  // ✅ Callback pour ouvrir les détails d'une géocache
    onImportAround?: (center: ImportAroundCenter) => void;  // ✅ Callback pour importer des géocaches autour d'un point/d'une cache
    preferences?: MapViewPreferences;
    onPreferenceChange?: (key: string, value: unknown) => void;
    onNotify?: (kind: MapNotifyKind, message: string) => void;
}

/**
 * Composant React qui affiche la carte OpenLayers
 */
export const MapView: React.FC<MapViewProps> = ({
    mapId,
    mapService,
    geocaches,
    selectedGeocacheIds,
    onChangeListSelection,
    onMapReady,
    onLoadNearbyGeocaches,
    onAddWaypoint,
    onAddWaypointFromDetected,
    onDeleteWaypoint,
    onSetWaypointAsCorrectedCoords,
    onSetDetectedAsCorrectedCoords,
    onOpenGeocacheDetails,
    onImportAround,
    preferences,
    onPreferenceChange,
    onNotify
}) => {
    const mapRef = React.useRef<HTMLDivElement>(null);
    const popupRef = React.useRef<HTMLDivElement>(null);
    const mapInstanceRef = React.useRef<any>(null);
    const layerManagerRef = React.useRef<MapLayerManager | null>(null);
    const overlayRef = React.useRef<Overlay | null>(null);
    const geocachesRef = React.useRef<MapGeocache[]>(geocaches);
    const onImportAroundRef = React.useRef<MapViewProps['onImportAround']>(onImportAround);
    // Les gestionnaires de clic / menu contextuel sont installés une seule fois à
    // l'initialisation de la carte : ils lisent la sélection et le callback via des
    // refs pour ne pas capturer des valeurs périmées.
    const onChangeListSelectionRef = React.useRef<MapViewProps['onChangeListSelection']>(onChangeListSelection);
    const selectedGeocacheIdsRef = React.useRef<Set<number>>(new Set());
    const fittedGeocacheKeyRef = React.useRef<string | null>(null);
    const [isInitialized, setIsInitialized] = React.useState(false);
    const initialZoomRef = React.useRef(preferences?.defaultZoom ?? 6);
    const previousDefaultZoomRef = React.useRef(preferences?.defaultZoom ?? 6);
    const [currentProvider, setCurrentProvider] = React.useState(preferences?.defaultProvider ?? 'osm');
    const [geocacheIconScale, setGeocacheIconScale] = React.useState(preferences?.geocacheIconScale ?? 0.75);
    const [foundGeocacheDisplayMode, setFoundGeocacheDisplayMode] = React.useState<FoundGeocacheDisplayMode>(preferences?.foundGeocacheDisplayMode ?? 'transparent');
    const [popupData, setPopupData] = React.useState<GeocacheFeatureProperties | null>(null);
    const [contextMenu, setContextMenu] = React.useState<{ items: ContextMenuItem[]; x: number; y: number } | null>(null);
    const [showNearbyGeocaches, setShowNearbyGeocaches] = React.useState(preferences?.showNearbyGeocaches ?? false);
    const [showExclusionZones, setShowExclusionZones] = React.useState(preferences?.showExclusionZones ?? false);
    const [labelMode, setLabelMode] = React.useState<MapLabelMode>('none');
    const [clusteringMode, setClusteringMode] = React.useState<ClusteringMode>(preferences?.clusteringMode ?? 'auto');
    const [selectedGeocacheId, setSelectedGeocacheId] = React.useState<number | null>(null);
    const [nearbyGeocaches, setNearbyGeocaches] = React.useState<MapGeocache[]>([]);
    const [nearbyLoading, setNearbyLoading] = React.useState(false);

    // Recherche textuelle d'adresse / lieu
    const [searchQuery, setSearchQuery] = React.useState('');
    const [searchResults, setSearchResults] = React.useState<GeocodingResult[]>([]);
    const [searchLoading, setSearchLoading] = React.useState(false);
    const [showSearchResults, setShowSearchResults] = React.useState(false);
    const searchBoxRef = React.useRef<HTMLDivElement>(null);
    const searchRequestIdRef = React.useRef(0);

    const notify = React.useCallback((kind: MapNotifyKind, message: string): void => {
        if (onNotify) {
            onNotify(kind, message);
        } else {
            // Repli minimal si aucun canal de notification n'est fourni.
            console[kind === 'error' ? 'error' : 'warn'](`[MapView] ${message}`);
        }
    }, [onNotify]);

    const geocodingConfig = React.useMemo<GeocodingConfig>(() => ({
        provider: preferences?.geocodingProvider ?? 'photon',
        geoapifyApiKey: preferences?.geoapifyApiKey ?? '',
        autoFallback: preferences?.geocodingAutoFallback ?? true,
        lang: typeof navigator !== 'undefined' ? navigator.language : 'fr'
    }), [preferences?.geocodingProvider, preferences?.geoapifyApiKey, preferences?.geocodingAutoFallback]);

    const goToSearchResult = React.useCallback((result: GeocodingResult): void => {
        const view = mapInstanceRef.current?.getView();
        if (!view) {
            return;
        }

        layerManagerRef.current?.showSearchResult(result.longitude, result.latitude, result.label);

        if (result.bbox) {
            const [minLon, minLat, maxLon, maxLat] = result.bbox;
            const extent = calculateExtent([
                lonLatToMapCoordinate(minLon, minLat),
                lonLatToMapCoordinate(maxLon, maxLat)
            ]);
            if (extent) {
                view.fit(extent, { padding: [80, 80, 80, 80], maxZoom: 17, duration: 400 });
                return;
            }
        }

        view.animate({
            center: lonLatToMapCoordinate(result.longitude, result.latitude),
            zoom: Math.max(view.getZoom() ?? 12, 15),
            duration: 400
        });
    }, []);

    const handleSearchSubmit = React.useCallback(async (event?: React.FormEvent): Promise<void> => {
        event?.preventDefault();

        const query = searchQuery.trim();
        if (!query) {
            return;
        }

        const requestId = ++searchRequestIdRef.current;
        setSearchLoading(true);
        setShowSearchResults(false);

        try {
            const outcome = await geocodeAddress(query, geocodingConfig);
            if (requestId !== searchRequestIdRef.current) {
                return; // Une recherche plus récente a pris le relais.
            }

            if (outcome.fellBack) {
                notify('warn', `Recherche via ${GEOCODING_PROVIDER_LABELS[outcome.usedProvider]} (le fournisseur principal a échoué${outcome.primaryError ? ` : ${outcome.primaryError}` : ''}).`);
            }

            if (outcome.results.length === 0) {
                setSearchResults([]);
                setShowSearchResults(false);
                notify('info', `Aucun résultat pour « ${query} ».`);
                return;
            }

            setSearchResults(outcome.results);

            if (outcome.results.length === 1) {
                setShowSearchResults(false);
                goToSearchResult(outcome.results[0]);
            } else {
                setShowSearchResults(true);
            }
        } catch (error) {
            if (requestId !== searchRequestIdRef.current) {
                return;
            }
            const message = error instanceof Error ? error.message : String(error);
            setSearchResults([]);
            setShowSearchResults(false);
            notify('error', `Échec de la recherche d'adresse : ${message}`);
        } finally {
            if (requestId === searchRequestIdRef.current) {
                setSearchLoading(false);
            }
        }
    }, [searchQuery, geocodingConfig, notify, goToSearchResult]);

    const handleSelectSearchResult = React.useCallback((result: GeocodingResult): void => {
        setShowSearchResults(false);
        goToSearchResult(result);
    }, [goToSearchResult]);

    const handleClearSearch = React.useCallback((): void => {
        searchRequestIdRef.current++;
        setSearchQuery('');
        setSearchResults([]);
        setShowSearchResults(false);
        setSearchLoading(false);
        layerManagerRef.current?.clearSearchResult();
    }, []);

    // Ferme la liste de résultats lors d'un clic en dehors de la zone de recherche.
    React.useEffect(() => {
        if (!showSearchResults) {
            return;
        }
        const handleClickOutside = (event: MouseEvent) => {
            if (searchBoxRef.current && !searchBoxRef.current.contains(event.target as Node)) {
                setShowSearchResults(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showSearchResults]);

    const openGeocacheDetails = React.useCallback((geocacheId: number, geocacheName?: string, gcCode?: string): void => {
        if (!onOpenGeocacheDetails) {
            return;
        }

        onOpenGeocacheDetails(geocacheId, geocacheName || gcCode || 'Cache inconnue');
    }, [onOpenGeocacheDetails]);

    React.useEffect(() => {
        geocachesRef.current = geocaches;
    }, [geocaches]);

    // Le menu contextuel est construit dans un effet monté une seule fois : on lit
    // le callback d'import via une ref pour toujours utiliser la version courante.
    React.useEffect(() => {
        onImportAroundRef.current = onImportAround;
    }, [onImportAround]);

    React.useEffect(() => {
        onChangeListSelectionRef.current = onChangeListSelection;
    }, [onChangeListSelection]);

    React.useEffect(() => {
        selectedGeocacheIdsRef.current = new Set(selectedGeocacheIds ?? []);
    }, [selectedGeocacheIds]);

    React.useEffect(() => {
        if (layerManagerRef.current) {
            layerManagerRef.current.setLabelMode(labelMode);
        }
    }, [labelMode, isInitialized]);

    React.useEffect(() => {
        if (layerManagerRef.current) {
            layerManagerRef.current.setGeocacheIconScale(geocacheIconScale);
        }
    }, [geocacheIconScale, isInitialized]);

    React.useEffect(() => {
        if (layerManagerRef.current) {
            layerManagerRef.current.setFoundGeocacheDisplayMode(foundGeocacheDisplayMode);
        }
    }, [foundGeocacheDisplayMode, isInitialized]);

    React.useEffect(() => {
        if (layerManagerRef.current) {
            layerManagerRef.current.setClusteringMode(clusteringMode);
        }
    }, [clusteringMode, isInitialized]);

    React.useEffect(() => {
        if (!preferences) {
            return;
        }
        setCurrentProvider(preferences.defaultProvider);
        setGeocacheIconScale(preferences.geocacheIconScale);
        setFoundGeocacheDisplayMode(preferences.foundGeocacheDisplayMode);
        setShowNearbyGeocaches(preferences.showNearbyGeocaches);
        setShowExclusionZones(preferences.showExclusionZones);
        setClusteringMode(preferences.clusteringMode);

        if (mapInstanceRef.current && previousDefaultZoomRef.current !== preferences.defaultZoom) {
            mapInstanceRef.current.getView().setZoom(preferences.defaultZoom);
            previousDefaultZoomRef.current = preferences.defaultZoom;
        }
        if (isInitialized && layerManagerRef.current) {
            layerManagerRef.current.changeTileProvider(preferences.defaultProvider);
            layerManagerRef.current.setGeocacheIconScale(preferences.geocacheIconScale);
            layerManagerRef.current.setFoundGeocacheDisplayMode(preferences.foundGeocacheDisplayMode);
            layerManagerRef.current.setClusterThreshold(preferences.clusteringThreshold);
            layerManagerRef.current.setClusteringMode(preferences.clusteringMode);
        }
    }, [preferences, isInitialized]);

    // Initialisation de la carte
    React.useEffect(() => {
        if (!mapRef.current || isInitialized) {
            return;
        }

        // Créer la carte OpenLayers
        const map = new Map({
            target: mapRef.current,
            controls: defaultControls({
                zoom: true,
                rotate: false
            }).extend([
                new ScaleLine(),
                new FullScreen()
            ]),
            interactions: defaultInteractions({
                doubleClickZoom: true,
                dragPan: true,
                mouseWheelZoom: true,
                pinchRotate: false,
                pinchZoom: true
            }),
            view: new View({
                center: fromLonLat([2.3522, 48.8566]), // Paris par défaut
                zoom: initialZoomRef.current,
                minZoom: 3,
                maxZoom: 19
            })
        });

        // Créer le gestionnaire de couches
        const layerManager = new MapLayerManager(map);

        // Créer l'overlay pour le popup
        if (popupRef.current) {
            const overlay = new Overlay({
                element: popupRef.current,
                autoPan: false,  // ✅ Désactiver le recentrage automatique de la carte
                positioning: 'bottom-center',
                stopEvent: true,
                offset: [0, -10]
            });
            map.addOverlay(overlay);
            overlayRef.current = overlay;
        }

        // Déballe les features de cluster : un cluster d'une seule cache est remplacé
        // par la cache elle-même ; un cluster de plusieurs caches est signalé à part
        // pour pouvoir l'éclater (zoom) plutôt que d'ouvrir un popup.
        const unwrapClusterFeatures = (raw: Feature<Geometry>[]): {
            features: Feature<Geometry>[];
            multiCluster?: Feature<Geometry>;
        } => {
            const result: Feature<Geometry>[] = [];
            let multiCluster: Feature<Geometry> | undefined;
            for (const f of raw) {
                const inner = f.get('features') as Feature<Geometry>[] | undefined;
                if (Array.isArray(inner)) {
                    if (inner.length > 1) {
                        if (!multiCluster) {
                            multiCluster = f;
                        }
                    } else if (inner.length === 1) {
                        result.push(inner[0]);
                    }
                } else {
                    result.push(f);
                }
            }
            return { features: result, multiCluster };
        };

        // Éclate un cluster : zoom sur l'étendue des caches qu'il contient.
        const zoomToCluster = (clusterFeature: Feature<Geometry>): void => {
            const view = map.getView();
            const inner = clusterFeature.get('features') as Feature<Geometry>[] | undefined;
            const coords = (inner || [])
                .map(f => (f.getGeometry() as Point | undefined)?.getCoordinates())
                .filter((c): c is number[] => Array.isArray(c));

            const extent = calculateExtent(coords);
            if (extent) {
                view.fit(extent, { padding: [60, 60, 60, 60], maxZoom: 17, duration: 300 });
                return;
            }

            const center = (clusterFeature.getGeometry() as Point | undefined)?.getCoordinates();
            if (center) {
                view.animate({ center, zoom: Math.min((view.getZoom() ?? 10) + 2, 19), duration: 300 });
            }
        };

        /**
         * Ids des géocaches du tableau présentes sous le curseur : les clusters sont
         * déballés, et les waypoints, points détectés et caches voisines (absentes du
         * tableau) sont écartés.
         */
        const collectSelectableGeocacheIds = (raw: Feature<Geometry>[]): number[] => {
            const ids: number[] = [];
            const collect = (f: Feature<Geometry>): void => {
                const props = f.getProperties();
                if (typeof props.id !== 'number' || props.isWaypoint || props.isDetectedCoordinate) {
                    return;
                }
                if (!geocachesRef.current.some(gc => gc.id === props.id) || ids.includes(props.id)) {
                    return;
                }
                ids.push(props.id);
            };
            for (const f of raw) {
                const inner = f.get('features') as Feature<Geometry>[] | undefined;
                if (Array.isArray(inner)) {
                    inner.forEach(collect);
                } else {
                    collect(f);
                }
            }
            return ids;
        };

        /**
         * Bascule la sélection du tableau pour les caches données. Sur un groupe, on
         * choisit une action unique (tout ajouter, ou tout retirer si tout est déjà
         * coché) plutôt que d'inverser cache par cache, ce qui serait imprévisible.
         */
        const requestListSelection = (ids: number[]): void => {
            if (ids.length === 0 || !onChangeListSelectionRef.current) {
                return;
            }
            if (ids.length === 1) {
                onChangeListSelectionRef.current(ids, 'toggle');
                return;
            }
            const allSelected = ids.every(id => selectedGeocacheIdsRef.current.has(id));
            onChangeListSelectionRef.current(ids, allSelected ? 'remove' : 'add');
        };

        // Ajouter le gestionnaire de clic gauche
        map.on('click', (evt) => {
            // Collecter toutes les features au pixel cliqué
            const rawFeatures: Feature<Geometry>[] = [];
            map.forEachFeatureAtPixel(evt.pixel, (f) => {
                rawFeatures.push(f as Feature<Geometry>);
                return false; // Continue pour collecter toutes les features
            });

            // Ctrl+clic (Cmd sur macOS) : coche/décoche dans le tableau au lieu
            // d'ouvrir le popup ou d'éclater le cluster.
            const mouseEvent = evt.originalEvent as MouseEvent | undefined;
            if ((mouseEvent?.ctrlKey || mouseEvent?.metaKey) && onChangeListSelectionRef.current) {
                const selectableIds = collectSelectableGeocacheIds(rawFeatures);
                if (selectableIds.length > 0) {
                    requestListSelection(selectableIds);
                    return;
                }
            }

            const { features, multiCluster } = unwrapClusterFeatures(rawFeatures);

            // Clic sur un cluster de plusieurs caches : on l'éclate au lieu d'ouvrir un popup
            if (multiCluster) {
                setPopupData(null);
                if (overlayRef.current) {
                    overlayRef.current.setPosition(undefined);
                }
                zoomToCluster(multiCluster);
                return;
            }

            if (features.length === 0) {
                setPopupData(null);
                if (overlayRef.current) {
                    overlayRef.current.setPosition(undefined);
                }
                return;
            }

            // Trouver la meilleure feature à afficher
            // Priorité : géocache normale > waypoint > point détecté (brute force)
            let selectedFeature = features[0];
            let selectedProps = selectedFeature.getProperties();

            for (const f of features) {
                const props = f.getProperties();
                // Si on trouve une géocache avec un ID valide (pas juste un point détecté), on la prend
                if (props.id !== undefined && !props.isDetectedCoordinate) {
                    selectedFeature = f;
                    selectedProps = props;
                    break;
                }
                // Sinon, si on trouve un waypoint, on le garde en second choix
                if (props.isWaypoint && selectedProps.isDetectedCoordinate) {
                    selectedFeature = f;
                    selectedProps = props;
                }
            }

            const props = selectedProps as GeocacheFeatureProperties & {
                isDetectedCoordinate?: boolean;
                formatted?: string;
                pluginName?: string;
                gcCode?: string;
                latDecimal?: number;
                lonDecimal?: number;
                waypointTitle?: string;
                waypointNote?: string;
                sourceResultText?: string;
            };

            if (props.isDetectedCoordinate) {
                // Afficher un popup spécifique pour la coordonnée détectée
                const gcCode = props.gcCode || props.gc_code || 'Point détecté';

                // Essayer de retrouver la géocache correspondante pour récupérer le nom / type
                const matchingGeocache = geocachesRef.current.find(gc => gc.gc_code === gcCode);

                const popupContent = {
                    id: -1,
                    gc_code: gcCode,
                    // Pour un point détecté, on affiche en priorité le nom réel de la cache si on le connaît.
                    // Sinon, on se replie sur waypointTitle (envoyé par le frontend comme nom de cache).
                    name: matchingGeocache?.name || props.waypointTitle,
                    cache_type: matchingGeocache?.cache_type || props.formatted || 'Coordonnées temporaires',
                    difficulty: undefined,
                    terrain: undefined,
                    pluginName: props.pluginName,
                    formatted: props.formatted,
                    note: props.waypointNote || props.sourceResultText,
                    coordinates: {
                        decimal: props.latDecimal !== undefined && props.lonDecimal !== undefined
                            ? `${props.latDecimal.toFixed(6)}, ${props.lonDecimal.toFixed(6)}`
                            : undefined,
                        formatted: props.formatted
                    }
                } as any;

                setPopupData(popupContent);
                if (overlayRef.current) {
                    overlayRef.current.setPosition(evt.coordinate);
                }
                return;
            }

            if (props.id !== undefined) {
                if (props.isWaypoint) {
                    setPopupData({
                        ...props,
                        gc_code: 'Waypoint',
                        name: props.waypointLabel || props.name || 'Sans nom',
                        cache_type: props.cache_type || 'Waypoint'
                    });
                } else {
                    setPopupData(props);
                }
                if (overlayRef.current) {
                    overlayRef.current.setPosition(evt.coordinate);
                }
            }
        });

        // Ajouter le gestionnaire de clic droit (menu contextuel)
        const mapElement = mapRef.current;
        const handleContextMenu = (event: MouseEvent) => {
            event.preventDefault();

            // Obtenir les coordonnées du clic sur la carte
            const pixel = map.getEventPixel(event);
            const coordinate = map.getCoordinateFromPixel(pixel);

            // Collecter toutes les features au pixel cliqué
            const rawFeatures: Feature<Geometry>[] = [];
            map.forEachFeatureAtPixel(pixel, (f) => {
                rawFeatures.push(f as Feature<Geometry>);
                return false; // Continue pour collecter toutes les features
            });

            // Déballer les clusters : on ignore les clusters multiples (le menu de
            // coordonnées par défaut sera affiché), et on déballe les singletons.
            const { features } = unwrapClusterFeatures(rawFeatures);

            if (features.length > 0) {
                // Trouver la meilleure feature pour le menu contextuel
                // Priorité : waypoint > géocache normale > point détecté
                let selectedProps = features[0].getProperties();

                for (const f of features) {
                    const props = f.getProperties();
                    // Priorité aux waypoints pour le menu contextuel
                    if (props.isWaypoint) {
                        selectedProps = props;
                        break;
                    }
                    // Ensuite les géocaches normales
                    if (props.id !== undefined && !props.isDetectedCoordinate && !selectedProps.isWaypoint) {
                        selectedProps = props;
                    }
                }

                const props = selectedProps as GeocacheFeatureProperties & {
                    isDetectedCoordinate?: boolean;
                    formatted?: string;
                    pluginName?: string;
                    gcCode?: string;
                    geocacheId?: number;
                    latDecimal?: number;
                    lonDecimal?: number;
                    waypointTitle?: string;
                    waypointNote?: string;
                    sourceResultText?: string;
                };

                // Menu pour waypoint existant
                if (props.isWaypoint) {
                    const waypointDisplayName = props.waypointLabel || props.name || 'Sans nom';
                    const items: ContextMenuItem[] = [
                        {
                            label: `📌 Waypoint: ${waypointDisplayName}`,
                            disabled: true
                        },
                        { separator: true }
                    ];
                    
                    // Option pour définir comme coordonnées corrigées
                    if (onSetWaypointAsCorrectedCoords && props.waypointId !== undefined) {
                        items.push({
                            label: 'Définir comme coordonnées corrigées',
                            icon: '📍',
                            action: () => {
                                onSetWaypointAsCorrectedCoords(props.waypointId!);
                            }
                        });
                    }
                    
                    // Option pour supprimer le waypoint
                    if (onDeleteWaypoint && props.waypointId !== undefined) {
                        items.push({
                            label: 'Supprimer le waypoint',
                            icon: '🗑️',
                            action: () => {
                                onDeleteWaypoint(props.waypointId!);
                            }
                        });
                    }
                    
                    setContextMenu({
                        items,
                        x: event.clientX,
                        y: event.clientY
                    });
                    return;
                }

                // Menu pour coordonnée détectée
                if (props.isDetectedCoordinate) {
                    const lat = props.latDecimal;
                    const lon = props.lonDecimal;
                    const gcCoords = lat !== undefined && lon !== undefined
                        ? formatGeocachingCoordinates(lon, lat)
                        : props.formatted || 'Coordonnées inconnues';

                    const waypointTitle = props.waypointTitle || props.pluginName || 'Coordonnée détectée';
                    const waypointNote = props.waypointNote || props.sourceResultText || props.formatted || '';

                    const items: ContextMenuItem[] = [
                        {
                            label: waypointTitle,
                            disabled: true
                        },
                        { separator: true },
                        {
                            label: `🌍 ${gcCoords}`,
                            action: () => navigator.clipboard.writeText(gcCoords)
                        }
                    ];

                    if (lat !== undefined && lon !== undefined) {
                        items.push({
                            label: `🔢 ${lat.toFixed(6)}, ${lon.toFixed(6)}`,
                            action: () => navigator.clipboard.writeText(`${lat.toFixed(6)}, ${lon.toFixed(6)}`)
                        });
                    }

                    if (props.pluginName) {
                        items.push({
                            label: `🧩 Plugin : ${props.pluginName}`,
                            disabled: true
                        });
                    }

                    if (props.sourceResultText) {
                        items.push({ separator: true });
                        items.push({
                            label: '📋 Copier le texte du résultat',
                            action: () => navigator.clipboard.writeText(props.sourceResultText as string)
                        });
                    }

                    // Option de suppression pour les points brute force
                    if (props.bruteForceId) {
                        items.push({ separator: true });
                        items.push({
                            label: 'Supprimer ce point',
                            icon: '🗑️',
                            action: () => {
                                window.dispatchEvent(new CustomEvent('geoapp-map-remove-brute-force-point', {
                                    detail: { bruteForceId: props.bruteForceId }
                                }));
                            }
                        });
                    }

                    // Options waypoint pour carte géocache (onAddWaypoint)
                    if (onAddWaypoint) {
                        items.push({ separator: true });
                        items.push({
                            label: 'Ajouter un waypoint à valider',
                            icon: '➕',
                            action: () => {
                                onAddWaypoint({
                                    gcCoords,
                                    title: waypointTitle,
                                    note: waypointNote
                                });
                            }
                        });
                        items.push({
                            label: 'Ajouter un waypoint validé',
                            icon: '✅',
                            action: () => {
                                onAddWaypoint({
                                    gcCoords,
                                    title: waypointTitle,
                                    note: waypointNote,
                                    autoSave: true
                                });
                            }
                        });
                    }

                    // Utiliser geocacheId directement depuis les props, ou chercher via gcCode
                    const detectedGcCode = props.gcCode || props.gc_code;
                    const geocacheIdToUse = props.geocacheId || (detectedGcCode ? geocachesRef.current.find(gc => gc.gc_code === detectedGcCode)?.id : undefined);

                    // Options waypoint pour carte batch (onAddWaypointFromDetected)
                    if (onAddWaypointFromDetected && geocacheIdToUse) {
                        items.push({ separator: true });
                        items.push({
                            label: 'Ajouter un waypoint à valider',
                            icon: '➕',
                            action: () => {
                                onAddWaypointFromDetected(geocacheIdToUse, {
                                    gcCoords,
                                    title: waypointTitle,
                                    note: waypointNote
                                });
                            }
                        });
                        items.push({
                            label: 'Ajouter un waypoint validé',
                            icon: '✅',
                            action: () => {
                                onAddWaypointFromDetected(geocacheIdToUse, {
                                    gcCoords,
                                    title: waypointTitle,
                                    note: waypointNote,
                                    autoSave: true
                                });
                            }
                        });
                    }

                    // Option pour corriger les coordonnées de la géocache
                    if (onSetDetectedAsCorrectedCoords && geocacheIdToUse) {
                        items.push({ separator: true });
                        items.push({
                            label: 'Corriger les coordonnées de la cache',
                            icon: '📍',
                            action: () => {
                                onSetDetectedAsCorrectedCoords(geocacheIdToUse, gcCoords);
                            }
                        });
                    }

                    setContextMenu({
                        items,
                        x: event.clientX,
                        y: event.clientY
                    });
                    return;
                }

                // Menu pour géocache normale
                if (props.id !== undefined && !props.isWaypoint && !props.isDetectedCoordinate) {
                    const items: ContextMenuItem[] = [
                        {
                            label: `📍 ${props.gc_code || 'Cache inconnue'}`,
                            disabled: true
                        },
                        {
                            label: props.name || 'Sans nom',
                            disabled: true
                        },
                        { separator: true },
                        {
                            label: 'Ouvrir la cache',
                            icon: '📖',
                            action: () => {
                                if (props.id !== undefined) {
                                    openGeocacheDetails(props.id, props.name, props.gc_code);
                                }
                            }
                        },
                    ];

                    if (onImportAroundRef.current && props.id !== undefined) {
                        const geocacheId = props.id;
                        items.push({
                            label: 'Importer autour…',
                            icon: '📍',
                            action: () => {
                                onImportAroundRef.current?.({
                                    type: 'geocache_id',
                                    geocache_id: geocacheId,
                                    gc_code: props.gc_code,
                                    name: props.name
                                });
                            }
                        });
                    }

                    if (onChangeListSelectionRef.current && props.id !== undefined) {
                        const geocacheId = props.id;
                        const isListSelected = selectedGeocacheIdsRef.current.has(geocacheId);
                        items.push({ separator: true });
                        items.push({
                            label: isListSelected ? 'Retirer de la sélection' : 'Sélectionner dans la liste',
                            icon: isListSelected ? '⬜' : '☑️',
                            action: () => {
                                onChangeListSelectionRef.current?.([geocacheId], 'toggle');
                            }
                        });
                        if (selectedGeocacheIdsRef.current.size > 0) {
                            items.push({
                                label: `Vider la sélection (${selectedGeocacheIdsRef.current.size})`,
                                icon: '🧹',
                                action: () => {
                                    onChangeListSelectionRef.current?.([], 'clear');
                                }
                            });
                        }
                    }

                    setContextMenu({
                        items,
                        x: event.clientX,
                        y: event.clientY
                    });
                    return;
                }
            }

            // Menu contextuel par défaut (coordonnées)
            if (coordinate) {
                const [lon, lat] = mapCoordinateToLonLat(coordinate);
                
                // Créer les items du menu contextuel
                const gcCoords = formatGeocachingCoordinates(lon, lat);
                const items: ContextMenuItem[] = [
                    {
                        label: '📍 Coordonnées',
                        disabled: true
                    },
                    { separator: true },
                    {
                        label: `Format GC: ${gcCoords}`,
                        icon: '🌍',
                        action: () => {
                            navigator.clipboard.writeText(gcCoords);
                        }
                    },
                    {
                        label: `Décimal: ${lat.toFixed(6)}, ${lon.toFixed(6)}`,
                        icon: '🔢',
                        action: () => {
                            navigator.clipboard.writeText(`${lat.toFixed(6)}, ${lon.toFixed(6)}`);
                        }
                    },
                ];

                if (onImportAroundRef.current) {
                    items.push({ separator: true });
                    items.push({
                        label: 'Importer autour de ce point…',
                        icon: '📍',
                        action: () => {
                            onImportAroundRef.current?.({ type: 'point', lat, lon });
                        }
                    });
                }

                // Ajouter l'option "Ajouter un waypoint" si le callback est disponible
                if (onAddWaypoint) {
                    items.push({ separator: true });
                    items.push({
                        label: 'Ajouter un waypoint',
                        icon: '📌',
                        action: () => {
                            onAddWaypoint({ gcCoords });
                        }
                    });
                }

                if (onChangeListSelectionRef.current) {
                    // Clic droit sur un cluster : il est écarté plus haut (il ne
                    // représente pas une cache), mais on peut cocher tout le groupe.
                    const groupIds = collectSelectableGeocacheIds(rawFeatures);
                    if (groupIds.length > 1) {
                        const allSelected = groupIds.every(id => selectedGeocacheIdsRef.current.has(id));
                        items.push({ separator: true });
                        items.push({
                            label: allSelected
                                ? `Retirer les ${groupIds.length} caches du groupe`
                                : `Sélectionner les ${groupIds.length} caches du groupe`,
                            icon: allSelected ? '⬜' : '☑️',
                            action: () => {
                                requestListSelection(groupIds);
                            }
                        });
                    }
                    if (selectedGeocacheIdsRef.current.size > 0) {
                        items.push({ separator: true });
                        items.push({
                            label: `Vider la sélection (${selectedGeocacheIdsRef.current.size})`,
                            icon: '🧹',
                            action: () => {
                                onChangeListSelectionRef.current?.([], 'clear');
                            }
                        });
                    }
                }

                setContextMenu({
                    items,
                    x: event.clientX,
                    y: event.clientY
                });
            }
        };
        
        mapElement.addEventListener('contextmenu', handleContextMenu);

        mapInstanceRef.current = map;
        layerManagerRef.current = layerManager;
        setIsInitialized(true);

        if (onMapReady) {
            onMapReady(map);
        }

        // Cleanup lors du démontage
        return () => {
            if (mapElement) {
                mapElement.removeEventListener('contextmenu', handleContextMenu);
            }
            if (layerManagerRef.current) {
                layerManagerRef.current.dispose();
            }
            if (mapInstanceRef.current) {
                mapInstanceRef.current.setTarget(undefined);
                mapInstanceRef.current = null;
            }
            setIsInitialized(false);
        };
    }, []);

    // Gestion du resize
    React.useEffect(() => {
        if (!mapInstanceRef.current) {
            return;
        }

        const handleResize = () => {
            if (mapInstanceRef.current) {
                mapInstanceRef.current.updateSize();
            }
        };

        window.addEventListener('resize', handleResize);

        // Forcer un update après un court délai (pour les transitions CSS)
        const timeout = setTimeout(() => {
            handleResize();
        }, 100);

        return () => {
            window.removeEventListener('resize', handleResize);
            clearTimeout(timeout);
        };
    }, [isInitialized]);

    // Écoute des événements du MapService - Sélection de géocache
    React.useEffect(() => {
        if (!mapInstanceRef.current || !layerManagerRef.current) {
            return;
        }

        const disposable = mapService.onDidSelectGeocache(geocache => {
            if (geocache.mapId && geocache.mapId !== mapId) {
                return;
            }

            if (!mapInstanceRef.current || !layerManagerRef.current) {
                return;
            }

            // Mettre à jour l'état de la géocache sélectionnée
            setSelectedGeocacheId(geocache.id);

            // Sélectionner visuellement la géocache
            layerManagerRef.current.selectGeocache(geocache.id);

            // Centrer la carte sur la géocache
            const coordinate = lonLatToMapCoordinate(geocache.longitude, geocache.latitude);
            const view = mapInstanceRef.current.getView();
            view.animate({
                center: coordinate,
                zoom: Math.max(view.getZoom() || 10, 15),
                duration: 500
            });
        });

        return () => disposable.dispose();
    }, [isInitialized, mapId, mapService, onPreferenceChange]);

    // Écoute des événements du MapService - Désélection
    React.useEffect(() => {
        if (!layerManagerRef.current) {
            return;
        }

        const disposable = mapService.onDidDeselectGeocache(() => {
            if (layerManagerRef.current) {
                layerManagerRef.current.deselectAllGeocaches();
            }
            // Remettre à zéro la géocache sélectionnée
            setSelectedGeocacheId(null);
            // Désactiver l'affichage des géocaches voisines
            setShowNearbyGeocaches(false);
            // Remettre à zéro les géocaches voisines
            setNearbyGeocaches([]);
        });

        return () => disposable.dispose();
    }, [isInitialized, mapService]);

    // Écoute des événements de mise en évidence d'une coordonnée détectée
    React.useEffect(() => {
        if (!mapInstanceRef.current || !layerManagerRef.current) {
            return;
        }

        const applyHighlight = (highlight?: DetectedCoordinateHighlight) => {
            
            if (!layerManagerRef.current) {
                return;
            }

            if (!highlight) {
                layerManagerRef.current.clearDetectedCoordinate();
                return;
            }

            layerManagerRef.current.showDetectedCoordinate(highlight);

            const coordinate = lonLatToMapCoordinate(highlight.longitude, highlight.latitude);
            const view = mapInstanceRef.current?.getView();
            if (view) {
                const currentZoom = view.getZoom() ?? 13;
                view.animate({
                    center: coordinate,
                    duration: 400,
                    zoom: currentZoom < 15 ? 15 : currentZoom
                });
            }
        };

        const disposable = mapService.onDidHighlightCoordinate(highlight => {
            applyHighlight(highlight);
        });

        // Listener pour les highlights multiples (Brute Force)
        const disposableMulti = mapService.onDidHighlightCoordinates(highlights => {
            
            if (!layerManagerRef.current) {
                return;
            }

            if (highlights.length === 0) {
                // Effacer tous les points
                layerManagerRef.current.clearDetectedCoordinate();
                return;
            }

            // Afficher tous les points
            layerManagerRef.current.showMultipleDetectedCoordinates(highlights);

            // Centrer sur le premier point ou sur l'ensemble
            if (highlights.length > 0) {
                const firstPoint = highlights[0];
                const coordinate = lonLatToMapCoordinate(firstPoint.longitude, firstPoint.latitude);
                const view = mapInstanceRef.current?.getView();
                if (view) {
                    const currentZoom = view.getZoom() ?? 13;
                    view.animate({
                        center: coordinate,
                        duration: 400,
                        zoom: currentZoom < 13 ? 13 : currentZoom
                    });
                }
            }
        });

        const lastHighlight = mapService.getLastHighlightedCoordinate();
        if (lastHighlight) {
            applyHighlight(lastHighlight);
        }

        return () => {
            applyHighlight(undefined);
            disposable.dispose();
            disposableMulti.dispose();
        };
    }, [isInitialized, mapService]);

    // Overlay preview Formula Solver (zone/ligne/point estimés)
    React.useEffect(() => {
        if (!isInitialized || !layerManagerRef.current) {
            return;
        }

        const applyOverlay = (overlay: FormulaSolverPreviewOverlay | undefined) => {
            if (!layerManagerRef.current) {
                return;
            }
            if (!overlay) {
                layerManagerRef.current.clearFormulaSolverPreviewOverlay();
                return;
            }
            layerManagerRef.current.setFormulaSolverPreviewOverlay(overlay);
        };

        const disposable = mapService.onDidUpdateFormulaSolverPreviewOverlay(overlay => {
            applyOverlay(overlay);
        });

        const last = mapService.getLastFormulaSolverPreviewOverlay();
        if (last) {
            applyOverlay(last);
        }

        return () => {
            applyOverlay(undefined);
            disposable.dispose();
        };
    }, [isInitialized, mapService]);

    // ✅ Réagit aux changements de géocaches passées en props
    React.useEffect(() => {
        if (!mapInstanceRef.current || !layerManagerRef.current) {
            return;
        }

        if (geocaches.length === 0) {
            layerManagerRef.current.clearGeocaches();
            fittedGeocacheKeyRef.current = null;
            return;
        }

        // Synchronisation incrémentale : seules les features modifiées sont touchées
        layerManagerRef.current.syncGeocaches(geocaches);

        const geocacheKey = geocaches.map(gc => gc.id).join(',');
        if (fittedGeocacheKeyRef.current === geocacheKey) {
            // Même ensemble de géocaches (ex. rechargement d'une seule cache) → pas de recadrage
            return;
        }

        // Centrer la carte sur les géocaches
        const coordinates = geocaches.map(gc =>
            lonLatToMapCoordinate(gc.longitude, gc.latitude)
        );
        const extent = calculateExtent(coordinates);

        if (extent) {
            const view = mapInstanceRef.current.getView();
            view.fit(extent, {
                padding: [50, 50, 50, 50],
                maxZoom: 15,
                duration: 500
            });
            fittedGeocacheKeyRef.current = geocacheKey;
        }
    }, [geocaches, isInitialized]);

    // Sélection par cases à cocher dans la liste des géocaches.
    // Déclaré après l'effet de synchronisation pour que les features existent déjà.
    React.useEffect(() => {
        if (!layerManagerRef.current) {
            return;
        }
        layerManagerRef.current.setListSelection(selectedGeocacheIds ?? []);
    }, [selectedGeocacheIds, geocaches, isInitialized]);

    // Gestion de l'affichage des géocaches voisines
    React.useEffect(() => {
        if (!layerManagerRef.current || !selectedGeocacheId || !showNearbyGeocaches || !onLoadNearbyGeocaches) {
            // Effacer les géocaches voisines si elles ne doivent pas être affichées
            if (layerManagerRef.current) {
                layerManagerRef.current.clearNearbyGeocaches();
            }
            // Remettre à zéro l'état des géocaches voisines
            setNearbyGeocaches([]);
            setNearbyLoading(false);
            return;
        }

        // Récupérer les géocaches voisines
        let cancelled = false;

        const fetchNearbyGeocaches = async () => {
            setNearbyLoading(true);
            try {
                const data = { nearby_geocaches: await onLoadNearbyGeocaches(selectedGeocacheId, 5) };
                if (cancelled) {
                    return;
                }

                // Convertir les données pour MapGeocache
                const nearbyGeocachesData: MapGeocache[] = data.nearby_geocaches.map((gc: any) => ({
                    id: gc.id,
                    gc_code: gc.gc_code,
                    name: gc.name,
                    cache_type: gc.cache_type,
                    latitude: gc.latitude,
                    longitude: gc.longitude,
                    difficulty: gc.difficulty,
                    terrain: gc.terrain,
                    found: gc.found,
                    is_corrected: gc.is_corrected
                }));

                // Mettre à jour l'état des géocaches voisines
                setNearbyGeocaches(nearbyGeocachesData);

                // Ajouter les géocaches voisines à la carte
                if (layerManagerRef.current) {
                    layerManagerRef.current.addNearbyGeocaches(nearbyGeocachesData);
                }

            } catch (error) {
                console.error('[MapView] Erreur lors de la récupération des géocaches voisines:', error);
            } finally {
                if (!cancelled) {
                    setNearbyLoading(false);
                }
            }
        };

        fetchNearbyGeocaches();

        return () => {
            cancelled = true;
        };

    }, [selectedGeocacheId, showNearbyGeocaches, isInitialized, onLoadNearbyGeocaches]);

    // Gestion de l'affichage des zones d'exclusion
    React.useEffect(() => {
        if (!layerManagerRef.current) {
            return;
        }

        if (showExclusionZones && (geocaches.length > 0 || nearbyGeocaches.length > 0)) {
            // Combiner les géocaches principales et voisines pour les zones d'exclusion
            const allGeocaches = [...geocaches, ...nearbyGeocaches];
            layerManagerRef.current.showExclusionZones(allGeocaches);
        } else {
            layerManagerRef.current.clearExclusionZones();
        }
    }, [showExclusionZones, geocaches, nearbyGeocaches, isInitialized]);

    // Écoute des événements du MapService - Changement de fond de carte
    React.useEffect(() => {
        if (!layerManagerRef.current) {
            return;
        }

        const disposable = mapService.onDidChangeTileProvider(providerId => {
            if (layerManagerRef.current) {
                layerManagerRef.current.changeTileProvider(providerId);
                setCurrentProvider(providerId);
                onPreferenceChange?.('geoApp.map.defaultProvider', providerId);
            }
        });

        return () => disposable.dispose();
    }, [isInitialized, mapService]);

    // Interface de changement de fond de carte
    const handleProviderChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const providerId = event.target.value;
        mapService.changeTileProvider(providerId);
        onPreferenceChange?.('geoApp.map.defaultProvider', providerId);
    };

    const handleNearbyToggle = (checked: boolean) => {
        setShowNearbyGeocaches(checked);
        onPreferenceChange?.('geoApp.map.showNearbyGeocaches', checked);
    };

    const handleExclusionToggle = (checked: boolean) => {
        setShowExclusionZones(checked);
        onPreferenceChange?.('geoApp.map.showExclusionZones', checked);
    };

    const handleLabelModeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        setLabelMode(event.target.value as MapLabelMode);
    };

    const handleIconScaleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const value = Number(event.target.value);
        setGeocacheIconScale(value);
        onPreferenceChange?.('geoApp.map.geocacheIconScale', value);
    };

    const handleFoundDisplayModeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const value = event.target.value as FoundGeocacheDisplayMode;
        setFoundGeocacheDisplayMode(value);
        onPreferenceChange?.('geoApp.map.foundGeocacheDisplayMode', value);
    };

    const handleClusteringModeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const value = event.target.value as ClusteringMode;
        setClusteringMode(value);
        onPreferenceChange?.('geoApp.map.clusteringMode', value);
    };

    const canOpenPopupGeocache = Boolean(popupData && popupData.id > 0 && !(popupData as GeocacheFeatureProperties).isWaypoint);

    return (
        <div className="geoapp-map-view">
            {/* Barre d'outils */}
            <div className="geoapp-map-toolbar">
                {/* Recherche textuelle d'adresse / lieu */}
                <div className="geoapp-map-search" ref={searchBoxRef}>
                    <form className="geoapp-map-search__form" onSubmit={handleSearchSubmit}>
                        <input
                            type="text"
                            className="geoapp-map-search__input"
                            value={searchQuery}
                            placeholder="Rechercher une adresse, un lieu…"
                            onChange={e => setSearchQuery(e.target.value)}
                            onFocus={() => {
                                if (searchResults.length > 1) {
                                    setShowSearchResults(true);
                                }
                            }}
                            aria-label="Rechercher une adresse ou un lieu"
                        />
                        {searchQuery && (
                            <button
                                type="button"
                                className="geoapp-map-search__clear"
                                onClick={handleClearSearch}
                                title="Effacer la recherche"
                                aria-label="Effacer la recherche"
                            >
                                ×
                            </button>
                        )}
                        <button
                            type="submit"
                            className="geoapp-map-search__button"
                            disabled={searchLoading || !searchQuery.trim()}
                            title="Rechercher"
                        >
                            {searchLoading ? (
                                <span
                                    className="geoapp-map-toolbar__spinner"
                                    role="status"
                                    aria-label="Recherche en cours"
                                />
                            ) : (
                                '🔍'
                            )}
                        </button>
                    </form>

                    {showSearchResults && searchResults.length > 0 && (
                        <ul className="geoapp-map-search__results">
                            {searchResults.map((result, index) => (
                                <li key={`${result.provider}-${index}-${result.latitude}-${result.longitude}`}>
                                    <button
                                        type="button"
                                        className="geoapp-map-search__result"
                                        onClick={() => handleSelectSearchResult(result)}
                                    >
                                        {result.label}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <label>
                    Fond de cartes:
                    <select value={currentProvider} onChange={handleProviderChange}>
                        {TILE_PROVIDERS.map(provider => (
                            <option key={provider.id} value={provider.id}>
                                {provider.name}
                            </option>
                        ))}
                    </select>
                </label>

                {/* Bouton pour afficher/masquer les géocaches voisines */}
                <label>
                    <input
                        type="checkbox"
                        checked={showNearbyGeocaches}
                        onChange={e => handleNearbyToggle(e.target.checked)}
                        disabled={!selectedGeocacheId}
                    />
                    Géocaches voisines (5km)
                    {nearbyLoading && (
                        <span
                            className="geoapp-map-toolbar__spinner"
                            role="status"
                            aria-label="Chargement des géocaches voisines"
                            title="Chargement…"
                        />
                    )}
                </label>

                {/* Bouton pour afficher/masquer les zones d'exclusion */}
                <label>
                    <input
                        type="checkbox"
                        checked={showExclusionZones}
                        onChange={e => handleExclusionToggle(e.target.checked)}
                    />
                    Zones d'exclusion (161m)
                </label>

                <label>
                    Trouvées:
                    <select value={foundGeocacheDisplayMode} onChange={handleFoundDisplayModeChange}>
                        <option value="transparent">Transparentes</option>
                        <option value="hidden">Masquées</option>
                        <option value="found-icon">Icône Found it</option>
                    </select>
                </label>

                <label>
                    Taille icônes:
                    <select value={geocacheIconScale} onChange={handleIconScaleChange}>
                        <option value={0.5}>Très petite</option>
                        <option value={0.65}>Petite</option>
                        <option value={0.75}>Normale</option>
                        <option value={0.9}>Grande</option>
                        <option value={1.1}>Très grande</option>
                    </select>
                </label>

                <label>
                    Intitulés:
                    <select value={labelMode} onChange={handleLabelModeChange}>
                        <option value="none">Masqués</option>
                        <option value="geocaches">Caches</option>
                        <option value="waypoints">Waypoints</option>
                        <option value="all">Caches + WP</option>
                    </select>
                </label>

                <label>
                    Regroupement:
                    <select
                        value={clusteringMode}
                        onChange={handleClusteringModeChange}
                        title="Regroupe les géocaches proches en grappes (clusters)"
                    >
                        <option value="auto">Automatique</option>
                        <option value="always">Toujours</option>
                        <option value="never">Jamais</option>
                    </select>
                </label>
            </div>

            {/* Conteneur de la carte */}
            <div ref={mapRef} className="geoapp-map-view__canvas">
                {/* Popup d'information */}
                <div 
                    ref={popupRef}
                    style={{
                        display: popupData ? 'block' : 'none',
                        position: 'absolute',
                        background: 'var(--theia-editor-background)',
                        border: '2px solid var(--theia-focusBorder)',
                        borderRadius: '4px',
                        padding: '12px',
                        minWidth: '220px',
                        boxShadow: '0 3px 14px rgba(0,0,0,0.4)',
                        pointerEvents: 'auto'
                    }}
                >
                    {popupData && (
                        <div style={{ color: 'var(--theia-foreground)' }}>
                            {/* Bouton fermer */}
                            <button
                                onClick={() => {
                                    setPopupData(null);
                                    if (overlayRef.current) {
                                        overlayRef.current.setPosition(undefined);
                                    }
                                }}
                                style={{
                                    position: 'absolute',
                                    top: '4px',
                                    right: '4px',
                                    background: 'transparent',
                                    border: 'none',
                                    color: 'var(--theia-descriptionForeground)',
                                    fontSize: '16px',
                                    cursor: 'pointer',
                                    padding: '4px 8px',
                                    lineHeight: '1'
                                }}
                                title="Fermer"
                            >
                                ×
                            </button>

                            {/* Titre : GC + nom */}
                            {canOpenPopupGeocache ? (
                                <button
                                    type="button"
                                    onMouseDown={(event) => {
                                        event.stopPropagation();
                                    }}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        openGeocacheDetails(popupData.id, popupData.name, popupData.gc_code);
                                    }}
                                    style={{
                                        all: 'unset',
                                        display: 'block',
                                        fontWeight: 'bold',
                                        fontSize: '14px',
                                        marginBottom: '6px',
                                        color: 'var(--theia-textLink-foreground)',
                                        cursor: 'pointer'
                                    }}
                                    title="Ouvrir la cache"
                                >
                                    {popupData.gc_code}
                                    {popupData.name ? ` - ${popupData.name}` : ''}
                                </button>
                            ) : (
                                <div style={{
                                    fontWeight: 'bold',
                                    fontSize: '14px',
                                    marginBottom: '6px',
                                    color: 'var(--theia-textLink-foreground)'
                                }}>
                                    {popupData.gc_code}
                                    {popupData.name ? ` - ${popupData.name}` : ''}
                                </div>
                            )}

                            {/* Amis ayant logué cette cache (carte des amis) */}
                            {popupData.friendsNote && (
                                <div style={{
                                    fontSize: '11px',
                                    color: 'var(--theia-foreground)',
                                    marginTop: '2px',
                                    marginBottom: '2px'
                                }}>
                                    👥 {popupData.friendsNote}
                                </div>
                            )}

                            {/* D/T */}
                            <div style={{
                                fontSize: '12px',
                                color: 'var(--theia-descriptionForeground)',
                                marginTop: '4px',
                                display: 'flex',
                                gap: '12px'
                            }}>
                                {popupData.difficulty !== undefined && (
                                    <span>D: {popupData.difficulty.toFixed(1)}</span>
                                )}
                                {popupData.terrain !== undefined && (
                                    <span>T: {popupData.terrain.toFixed(1)}</span>
                                )}
                            </div>

                            {/* Type / info complémentaire */}
                            <div style={{
                                fontSize: '11px',
                                color: 'var(--theia-descriptionForeground)',
                                marginTop: '6px',
                                fontStyle: 'italic'
                            }}>
                                {popupData.cache_type}
                            </div>

                            {/* Note / valeurs brute force (pour les points détectés) */}
                            {(popupData as any).note && (
                                <div style={{
                                    fontSize: '11px',
                                    color: 'var(--theia-foreground)',
                                    marginTop: '8px',
                                    padding: '6px 8px',
                                    backgroundColor: 'var(--theia-input-background)',
                                    borderRadius: '3px',
                                    whiteSpace: 'pre-wrap',
                                    fontFamily: 'var(--theia-code-font-family)',
                                    lineHeight: '1.4'
                                }}>
                                    {(popupData as any).note}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Menu contextuel */}
            {contextMenu && (
                <ContextMenu
                    items={contextMenu.items}
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onClose={() => setContextMenu(null)}
                />
            )}
        </div>
    );
};

