import * as React from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import { defaults as defaultControls, ScaleLine, FullScreen } from 'ol/control';
import { defaults as defaultInteractions } from 'ol/interaction';
import Overlay from 'ol/Overlay';
import 'ol/ol.css';
import { MapLayerManager, MapGeocache } from './map-layer-manager';
import { MapService, DetectedCoordinateHighlight, FormulaSolverPreviewOverlay } from './map-service';
import { lonLatToMapCoordinate, calculateExtent, mapCoordinateToLonLat, formatGeocachingCoordinates } from './map-utils';
import { TILE_PROVIDERS } from './map-tile-providers';
import { fromLonLat } from 'ol/proj';
import { GeocacheFeatureProperties } from './map-geocache-style-sprite';
import { ContextMenu, ContextMenuItem } from '../context-menu';

export interface MapViewPreferences {
    defaultProvider: string;
    defaultZoom: number;
    showExclusionZones: boolean;
    showNearbyGeocaches: boolean;
}

export interface MapViewProps {
    mapService: MapService;
    geocaches: MapGeocache[];  // ✅ Données propres à cette carte
    onMapReady?: (map: Map) => void;
    onAddWaypoint?: (options: { gcCoords: string; title?: string; note?: string; autoSave?: boolean }) => void;  // ✅ Callback pour ajouter un waypoint (carte géocache)
    onAddWaypointFromDetected?: (geocacheId: number, options: { gcCoords: string; title?: string; note?: string; autoSave?: boolean }) => void;  // ✅ Callback pour ajouter un waypoint depuis une coordonnée détectée (carte batch)
    onDeleteWaypoint?: (waypointId: number) => void;  // ✅ Callback pour supprimer un waypoint
    onSetWaypointAsCorrectedCoords?: (waypointId: number) => void;  // ✅ Callback pour définir comme coordonnées corrigées
    onSetDetectedAsCorrectedCoords?: (geocacheId: number, gcCoords: string) => void;  // ✅ Callback pour corriger les coordonnées d'une géocache depuis une coordonnée détectée
    onOpenGeocacheDetails?: (geocacheId: number, geocacheName: string) => void;  // ✅ Callback pour ouvrir les détails d'une géocache
    preferences?: MapViewPreferences;
    onPreferenceChange?: (key: string, value: unknown) => void;
}

/**
 * Composant React qui affiche la carte OpenLayers
 */
export const MapView: React.FC<MapViewProps> = ({
    mapService,
    geocaches,
    onMapReady,
    onAddWaypoint,
    onAddWaypointFromDetected,
    onDeleteWaypoint,
    onSetWaypointAsCorrectedCoords,
    onSetDetectedAsCorrectedCoords,
    onOpenGeocacheDetails,
    preferences,
    onPreferenceChange
}) => {
    const mapRef = React.useRef<HTMLDivElement>(null);
    const popupRef = React.useRef<HTMLDivElement>(null);
    const mapInstanceRef = React.useRef<any>(null);
    const layerManagerRef = React.useRef<MapLayerManager | null>(null);
    const overlayRef = React.useRef<Overlay | null>(null);
    const [isInitialized, setIsInitialized] = React.useState(false);
    const initialZoomRef = React.useRef(preferences?.defaultZoom ?? 6);
    const [currentProvider, setCurrentProvider] = React.useState(preferences?.defaultProvider ?? 'osm');
    const [popupData, setPopupData] = React.useState<GeocacheFeatureProperties | null>(null);
    const [contextMenu, setContextMenu] = React.useState<{ items: ContextMenuItem[]; x: number; y: number } | null>(null);
    const [showNearbyGeocaches, setShowNearbyGeocaches] = React.useState(preferences?.showNearbyGeocaches ?? false);
    const [showExclusionZones, setShowExclusionZones] = React.useState(preferences?.showExclusionZones ?? false);
    const [selectedGeocacheId, setSelectedGeocacheId] = React.useState<number | null>(null);
    const [nearbyGeocaches, setNearbyGeocaches] = React.useState<MapGeocache[]>([]);

    React.useEffect(() => {
        if (!preferences) {
            return;
        }
        setCurrentProvider(preferences.defaultProvider);
        setShowNearbyGeocaches(preferences.showNearbyGeocaches);
        setShowExclusionZones(preferences.showExclusionZones);

        if (mapInstanceRef.current) {
            mapInstanceRef.current.getView().setZoom(preferences.defaultZoom);
        }
        if (isInitialized && layerManagerRef.current) {
            layerManagerRef.current.changeTileProvider(preferences.defaultProvider);
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
                stopEvent: false,
                offset: [0, -10]
            });
            map.addOverlay(overlay);
            overlayRef.current = overlay;
        }

        // Ajouter le gestionnaire de clic gauche
        map.on('click', (evt) => {
            const feature = map.forEachFeatureAtPixel(evt.pixel, (f) => f);
            if (!feature) {
                setPopupData(null);
                if (overlayRef.current) {
                    overlayRef.current.setPosition(undefined);
                }
                return;
            }

            const props = feature.getProperties() as GeocacheFeatureProperties & {
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
                const matchingGeocache = geocaches.find(gc => gc.gc_code === gcCode);

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
                setPopupData(props);
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
            
            // Vérifier si on a cliqué sur une feature (géocache ou waypoint)
            const feature = map.forEachFeatureAtPixel(pixel, (f) => f);
            
            if (feature) {
                const props = feature.getProperties() as GeocacheFeatureProperties & {
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
                if (props.isWaypoint && props.waypointId !== undefined) {
                    const items: ContextMenuItem[] = [
                        {
                            label: `📌 Waypoint: ${props.name || 'Sans nom'}`,
                            disabled: true
                        },
                        { separator: true }
                    ];
                    
                    // Option pour définir comme coordonnées corrigées
                    if (onSetWaypointAsCorrectedCoords) {
                        items.push({
                            label: 'Définir comme coordonnées corrigées',
                            icon: '📍',
                            action: () => {
                                onSetWaypointAsCorrectedCoords(props.waypointId!);
                            }
                        });
                    }
                    
                    // Option pour supprimer le waypoint
                    if (onDeleteWaypoint) {
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
                                console.log('[MapView] Suppression du point brute force', props.bruteForceId);
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
                    const geocacheIdToUse = props.geocacheId || (detectedGcCode ? geocaches.find(gc => gc.gc_code === detectedGcCode)?.id : undefined);

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
                                if (onOpenGeocacheDetails && props.id !== undefined) {
                                    onOpenGeocacheDetails(props.id, props.name || props.gc_code || 'Cache inconnue');
                                }
                            }
                        },
                        {
                            label: 'Importer autour…',
                            icon: '📍',
                            action: () => {
                                window.dispatchEvent(new CustomEvent('geoapp-import-around', {
                                    detail: {
                                        center: {
                                            type: 'geocache_id',
                                            geocache_id: props.id,
                                            gc_code: props.gc_code,
                                            name: props.name
                                        }
                                    }
                                }));
                            }
                        }
                    ];

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
                            console.log('Coordonnées GC copiées');
                        }
                    },
                    {
                        label: `Décimal: ${lat.toFixed(6)}, ${lon.toFixed(6)}`,
                        icon: '🔢',
                        action: () => {
                            navigator.clipboard.writeText(`${lat.toFixed(6)}, ${lon.toFixed(6)}`);
                            console.log('Coordonnées décimales copiées');
                        }
                    },
                    { separator: true },
                    {
                        label: 'Importer autour de ce point…',
                        icon: '📍',
                        action: () => {
                            window.dispatchEvent(new CustomEvent('geoapp-import-around', {
                                detail: {
                                    center: {
                                        type: 'point',
                                        lat,
                                        lon
                                    }
                                }
                            }));
                        }
                    }
                ];
                
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
    }, [isInitialized, mapService, onPreferenceChange]);

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
        console.log('[MapView] Setting up highlight listener', {
            isInitialized,
            hasMapInstance: !!mapInstanceRef.current,
            hasLayerManager: !!layerManagerRef.current
        });

        if (!mapInstanceRef.current || !layerManagerRef.current) {
            console.log('[MapView] Skipping highlight listener - map not ready');
            return;
        }

        const applyHighlight = (highlight?: DetectedCoordinateHighlight) => {
            console.log('[MapView] applyHighlight called', highlight);
            
            if (!layerManagerRef.current) {
                console.log('[MapView] No layerManager, skipping');
                return;
            }

            if (!highlight) {
                console.log('[MapView] Clearing detected coordinate');
                layerManagerRef.current.clearDetectedCoordinate();
                return;
            }

            console.log('[MapView] Showing detected coordinate on map', {
                lat: highlight.latitude,
                lon: highlight.longitude,
                formatted: highlight.formatted
            });

            layerManagerRef.current.showDetectedCoordinate(highlight);

            const coordinate = lonLatToMapCoordinate(highlight.longitude, highlight.latitude);
            const view = mapInstanceRef.current?.getView();
            if (view) {
                const currentZoom = view.getZoom() ?? 13;
                console.log('[MapView] Animating to coordinate, zoom:', currentZoom < 15 ? 15 : currentZoom);
                view.animate({
                    center: coordinate,
                    duration: 400,
                    zoom: currentZoom < 15 ? 15 : currentZoom
                });
            }
        };

        console.log('[MapView] Registering highlight event listener');
        const disposable = mapService.onDidHighlightCoordinate(highlight => {
            console.log('[MapView] Highlight event received!', highlight);
            applyHighlight(highlight);
        });

        // Listener pour les highlights multiples (Brute Force)
        const disposableMulti = mapService.onDidHighlightCoordinates(highlights => {
            console.log('[MapView] Multiple highlights received!', highlights.length);
            
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
            console.log('[MapView] Applying last highlight from cache', lastHighlight);
            applyHighlight(lastHighlight);
        }

        return () => {
            console.log('[MapView] Cleaning up highlight listener');
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

        console.log('[MapView] Géocaches reçues en props:', geocaches.length);
        
        // Effacer les géocaches existantes
        layerManagerRef.current.clearGeocaches();

        // Ajouter les nouvelles géocaches
        if (geocaches.length > 0) {
            console.log('[MapView] Ajout de', geocaches.length, 'géocaches à la carte');
            layerManagerRef.current.addGeocaches(geocaches);

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
                console.log('[MapView] Vue ajustée aux géocaches');
            }
        }
    }, [geocaches, isInitialized]);

    // Gestion de l'affichage des géocaches voisines
    React.useEffect(() => {
        if (!layerManagerRef.current || !selectedGeocacheId || !showNearbyGeocaches) {
            // Effacer les géocaches voisines si elles ne doivent pas être affichées
            if (layerManagerRef.current) {
                layerManagerRef.current.clearNearbyGeocaches();
            }
            // Remettre à zéro l'état des géocaches voisines
            setNearbyGeocaches([]);
            return;
        }

        // Récupérer les géocaches voisines
        const fetchNearbyGeocaches = async () => {
            try {
                console.log('[MapView] Récupération des géocaches voisines pour geocache', selectedGeocacheId);
                const backendBaseUrl = 'http://localhost:8000';
                const response = await fetch(`${backendBaseUrl}/api/geocaches/${selectedGeocacheId}/nearby?radius=5`, {
                    credentials: 'include'
                });

                if (!response.ok) {
                    throw new Error(`Erreur HTTP: ${response.status}`);
                }

                const data = await response.json();
                console.log('[MapView] Géocaches voisines reçues:', data.nearby_geocaches.length);

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
            }
        };

        fetchNearbyGeocaches();

    }, [selectedGeocacheId, showNearbyGeocaches, isInitialized]);

    // Gestion de l'affichage des zones d'exclusion
    React.useEffect(() => {
        if (!layerManagerRef.current) {
            return;
        }

        if (showExclusionZones && (geocaches.length > 0 || nearbyGeocaches.length > 0)) {
            // Combiner les géocaches principales et voisines pour les zones d'exclusion
            const allGeocaches = [...geocaches, ...nearbyGeocaches];
            console.log('[MapView] Affichage des zones d\'exclusion pour', allGeocaches.length, 'géocaches (', geocaches.length, 'principales +', nearbyGeocaches.length, 'voisines)');
            layerManagerRef.current.showExclusionZones(allGeocaches);
        } else {
            console.log('[MapView] Masquage des zones d\'exclusion');
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

    return (
        <div style={{ 
            width: '100%', 
            height: '100%', 
            position: 'relative',
            display: 'flex',
            flexDirection: 'column'
        }}>
            {/* Barre d'outils */}
            <div style={{
                padding: '8px',
                background: 'var(--theia-editor-background)',
                borderBottom: '1px solid var(--theia-panel-border)',
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
            }}>
                <label style={{
                    fontSize: '12px',
                    color: 'var(--theia-foreground)'
                }}>
                    Fond de cartes:
                </label>
                <select
                    value={currentProvider}
                    onChange={handleProviderChange}
                    style={{
                        padding: '4px 8px',
                        fontSize: '12px',
                        background: 'var(--theia-input-background)',
                        color: 'var(--theia-input-foreground)',
                        border: '1px solid var(--theia-input-border)',
                        borderRadius: '2px',
                        cursor: 'pointer'
                    }}
                >
                    {TILE_PROVIDERS.map(provider => (
                        <option key={provider.id} value={provider.id}>
                            {provider.name}
                        </option>
                    ))}
                </select>

                {/* Bouton pour afficher/masquer les géocaches voisines */}
                <label style={{
                    fontSize: '12px',
                    color: 'var(--theia-foreground)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                }}>
                    <input
                        type="checkbox"
                        checked={showNearbyGeocaches}
                        onChange={e => handleNearbyToggle(e.target.checked)}
                        disabled={!selectedGeocacheId}
                        style={{
                            margin: 0,
                            cursor: selectedGeocacheId ? 'pointer' : 'not-allowed'
                        }}
                    />
                    Géocaches voisines (5km)
                </label>

                {/* Bouton pour afficher/masquer les zones d'exclusion */}
                <label style={{
                    fontSize: '12px',
                    color: 'var(--theia-foreground)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                }}>
                    <input
                        type="checkbox"
                        checked={showExclusionZones}
                        onChange={e => handleExclusionToggle(e.target.checked)}
                        style={{
                            margin: 0,
                            cursor: 'pointer'
                        }}
                    />
                    Zones d'exclusion (161m)
                </label>
            </div>

            {/* Conteneur de la carte */}
            <div 
                ref={mapRef} 
                style={{ 
                    flex: 1,
                    width: '100%',
                    background: 'var(--theia-editor-background)',
                    position: 'relative'
                }}
            >
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
                        pointerEvents: 'none'
                    }}
                >
                    {popupData && (
                        <div style={{ color: 'var(--theia-foreground)' }}>
                            {/* Titre : GC + nom */}
                            <div style={{ 
                                fontWeight: 'bold', 
                                fontSize: '14px',
                                marginBottom: '6px',
                                color: 'var(--theia-textLink-foreground)'
                            }}>
                                {popupData.gc_code}
                                {popupData.name ? ` - ${popupData.name}` : ''}
                            </div>

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

