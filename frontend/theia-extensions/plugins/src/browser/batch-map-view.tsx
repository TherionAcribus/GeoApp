/**
 * Composant carte OpenLayers intégré pour le BatchPluginExecutorWidget
 * Affiche les géocaches sélectionnées et les coordonnées découvertes en temps réel
 */

import * as React from '@theia/core/shared/react';
import * as ol from 'ol';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import OSM from 'ol/source/OSM';
import { Feature } from 'ol';
import { Geometry, Point } from 'ol/geom';
import { Style, Icon, Fill, Stroke, Circle as CircleStyle, Text } from 'ol/style';
import { Coordinate } from 'ol/coordinate';
import { fromLonLat, toLonLat } from 'ol/proj';
import { boundingExtent } from 'ol/extent';
import { BatchGeocacheContext, BatchGeocacheResult } from './batch-plugin-executor-widget';

interface BatchMapViewProps {
    geocaches: BatchGeocacheContext[];
    results: BatchGeocacheResult[];
    height?: number;
    onGeocacheClick?: (geocache: BatchGeocacheContext) => void;
}

export const BatchMapView: React.FC<BatchMapViewProps> = ({
    geocaches,
    results,
    height = 300,
    onGeocacheClick
}) => {
    const mapRef = React.useRef<HTMLDivElement>(null);
    const mapInstanceRef = React.useRef<Map | null>(null);
    const geocachesLayerRef = React.useRef<VectorLayer<VectorSource<Feature<Geometry>>> | null>(null);
    const detectedLayerRef = React.useRef<VectorLayer<VectorSource<Feature<Geometry>>> | null>(null);

    // Initialiser la carte
    React.useEffect(() => {
        if (!mapRef.current) return;

        // Créer les sources de données
        const geocachesSource = new VectorSource<Feature<Geometry>>();
        const detectedSource = new VectorSource<Feature<Geometry>>();

        // Créer les couches
        const geocachesLayer = new VectorLayer<VectorSource<Feature<Geometry>>>({
            source: geocachesSource,
            style: createGeocacheStyle(),
            zIndex: 10
        });
        geocachesLayerRef.current = geocachesLayer;

        const detectedLayer = new VectorLayer<VectorSource<Feature<Geometry>>>({
            source: detectedSource,
            style: createDetectedStyle(),
            zIndex: 20
        });
        detectedLayerRef.current = detectedLayer;

        // Créer la carte
        const map = new Map({
            target: mapRef.current,
            layers: [
                new TileLayer({
                    source: new OSM()
                }),
                geocachesLayer,
                detectedLayer
            ],
            view: new View({
                center: fromLonLat([2.3522, 48.8566]), // Paris par défaut
                zoom: 10
            }),
            controls: []
        });

        mapInstanceRef.current = map;

        // Centrer sur les géocaches
        if (geocaches.length > 0) {
            centerOnGeocaches(map, geocaches);
        }

        return () => {
            map.dispose();
        };
    }, []);

    // Mettre à jour les géocaches sur la carte
    React.useEffect(() => {
        if (!geocachesLayerRef.current) return;

        const source = geocachesLayerRef.current.getSource();
        if (!source) return;

        // Vider les features existantes
        source.clear();

        // Ajouter les géocaches
        geocaches.forEach(geocache => {
            if (geocache.coordinates?.latitude && geocache.coordinates?.longitude) {
                const feature = new Feature({
                    geometry: new Point(fromLonLat([
                        geocache.coordinates.longitude,
                        geocache.coordinates.latitude
                    ])),
                    geocache: geocache
                });

                source.addFeature(feature);
            }
        });
    }, [geocaches]);

    // Mettre à jour les coordonnées détectées
    React.useEffect(() => {
        if (!detectedLayerRef.current) return;

        const source = detectedLayerRef.current.getSource();
        if (!source) return;

        // Vider les features existantes
        source.clear();

        // Ajouter les coordonnées détectées
        results.forEach(result => {
            if (result.coordinates && result.status === 'completed') {
                const feature = new Feature({
                    geometry: new Point(fromLonLat([
                        result.coordinates.longitude,
                        result.coordinates.latitude
                    ])),
                    result: result,
                    type: 'detected'
                });

                source.addFeature(feature);
            }
        });
    }, [results]);

    // Gérer les clics sur la carte
    React.useEffect(() => {
        if (!mapInstanceRef.current || !onGeocacheClick) return;

        const map = mapInstanceRef.current;

        const handleClick = (event: ol.MapBrowserEvent) => {
            const features = map.getFeaturesAtPixel(event.pixel);
            
            for (const feature of features) {
                const geocache = feature.get('geocache');
                if (geocache) {
                    onGeocacheClick(geocache);
                    break;
                }
            }
        };

        map.on('click', handleClick);

        return () => {
            map.un('click', handleClick);
        };
    }, [onGeocacheClick]);

    return (
        <div style={{ height: `${height}px`, border: '1px solid var(--theia-panel-border)', borderRadius: '4px' }}>
            <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
        </div>
    );
};

/**
 * Style pour les marqueurs de géocaches
 */
function createGeocacheStyle(): Style {
    return new Style({
        image: new CircleStyle({
            radius: 8,
            fill: new Fill({
                color: '#3498db'
            }),
            stroke: new Stroke({
                color: '#2980b9',
                width: 2
            })
        }),
        text: new Text({
            font: '12px Arial',
            fill: new Fill({
                color: '#ffffff'
            }),
            stroke: new Stroke({
                color: '#000000',
                width: 3
            }),
            text: ''
        })
    });
}

/**
 * Style pour les coordonnées détectées
 */
function createDetectedStyle(): Style {
    return new Style({
        image: new CircleStyle({
            radius: 6,
            fill: new Fill({
                color: '#e74c3c'
            }),
            stroke: new Stroke({
                color: '#c0392b',
                width: 2
            })
        })
    });
}

/**
 * Centre la carte sur les géocaches
 */
function centerOnGeocaches(map: Map, geocaches: BatchGeocacheContext[]): void {
    const validCoordinates = geocaches
        .filter(g => g.coordinates?.latitude && g.coordinates?.longitude)
        .map(g => fromLonLat([g.coordinates!.longitude, g.coordinates!.latitude]));

    if (validCoordinates.length === 0) return;

    if (validCoordinates.length === 1) {
        // Centrer sur la seule géocache
        map.getView().setCenter(validCoordinates[0]);
        map.getView().setZoom(13);
    } else {
        // Calculer l'étendue pour englober toutes les géocaches
        const extent = boundingExtent(validCoordinates);
        map.getView().fit(extent, { padding: [20, 20, 20, 20], maxZoom: 15 });
    }
}
