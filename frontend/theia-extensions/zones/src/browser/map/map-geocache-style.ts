import { Style, Circle, Fill, Stroke, Text, Icon } from 'ol/style';
import { Feature } from 'ol';
import { Geometry, Point } from 'ol/geom';
import { getIconByCacheType } from '../geocache-icon-config';

/**
 * Interface pour les propriétés d'une feature géocache
 */
export interface GeocacheFeatureProperties {
    id: number;
    gc_code: string;
    name: string;
    cache_type: string;
    difficulty?: number;
    terrain?: number;
    found?: boolean;
    selected?: boolean;
}

/**
 * Cache pour les icônes chargées afin d'éviter de recharger les mêmes images
 */
const iconCache = new Map<string, HTMLImageElement>();

/**
 * Génère le chemin vers une icône de géocache
 */
function getIconPath(iconKey: string): string {
    // Le chemin sera relatif au dossier assets/geocache-icons/
    // L'utilisateur va découper les sprites et les placer là
    return `../assets/geocache-icons/${iconKey}.png`;
}

/**
 * Précharge une icône dans le cache
 */
export function preloadIcon(iconKey: string): Promise<HTMLImageElement> {
    if (iconCache.has(iconKey)) {
        return Promise.resolve(iconCache.get(iconKey)!);
    }

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            iconCache.set(iconKey, img);
            resolve(img);
        };
        img.onerror = () => {
            console.warn(`Failed to load geocache icon: ${iconKey}`);
            reject(new Error(`Failed to load icon: ${iconKey}`));
        };
        img.src = getIconPath(iconKey);
    });
}

/**
 * Crée le style pour une feature géocache individuelle
 */
export function createGeocacheStyle(feature: Feature<Geometry>, resolution: number): Style | Style[] {
    const properties = feature.getProperties() as GeocacheFeatureProperties;
    const isSelected = properties.selected === true;
    
    // Récupérer l'icône correspondant au type de cache
    const iconDef = getIconByCacheType(properties.cache_type || 'Unknown Cache');
    const iconKey = iconDef?.key || 'traditional';

    const scale = isSelected ? 1.2 : 1.0;
    const opacity = properties.found ? 0.6 : 1.0;

    try {
        const style = new Style({
            image: new Icon({
                src: getIconPath(iconKey),
                scale: scale,
                opacity: opacity,
                anchor: [0.5, 0.5], // Ancre au centre de l'icône (pour les disques)
            }),
            zIndex: isSelected ? 1000 : 1
        });

        // Si sélectionné, ajouter un cercle de surbrillance
        if (isSelected) {
            return [
                new Style({
                    image: new Circle({
                        radius: 25,
                        fill: new Fill({
                            color: 'rgba(0, 122, 255, 0.2)'
                        }),
                        stroke: new Stroke({
                            color: 'rgba(0, 122, 255, 0.8)',
                            width: 3
                        })
                    }),
                    zIndex: 999
                }),
                style
            ];
        }

        return style;
    } catch (error) {
        // Fallback vers un style par défaut si l'icône n'est pas disponible
        console.warn(`Icon not available for ${iconKey}, using default style`, error);
        return createFallbackStyle(isSelected, properties.found);
    }
}

/**
 * Style de secours si les icônes ne sont pas disponibles
 */
function createFallbackStyle(isSelected: boolean, found?: boolean): Style {
    const radius = isSelected ? 10 : 8;
    const opacity = found ? 0.6 : 1.0;

    return new Style({
        image: new Circle({
            radius: radius,
            fill: new Fill({
                color: `rgba(255, 140, 0, ${opacity})` // Orange
            }),
            stroke: new Stroke({
                color: isSelected ? 'rgba(0, 122, 255, 1)' : 'rgba(255, 255, 255, 0.8)',
                width: isSelected ? 3 : 2
            })
        }),
        zIndex: isSelected ? 1000 : 1
    });
}

/**
 * Crée le style pour un cluster de géocaches
 */
export function createClusterStyle(feature: Feature<Geometry>, resolution: number): Style {
    const features = feature.get('features') as Feature<Point>[];
    const size = features ? features.length : 0;

    if (size === 1) {
        // Si le cluster ne contient qu'une feature, utiliser le style normal
        return createGeocacheStyle(features[0], resolution) as Style;
    }

    // Calculer la taille du cercle en fonction du nombre de features
    const radius = Math.min(20 + Math.log(size) * 5, 40);

    return new Style({
        image: new Circle({
            radius: radius,
            fill: new Fill({
                color: 'rgba(0, 150, 136, 0.8)' // Teal
            }),
            stroke: new Stroke({
                color: 'rgba(255, 255, 255, 0.9)',
                width: 2
            })
        }),
        text: new Text({
            text: size.toString(),
            fill: new Fill({
                color: '#fff'
            }),
            font: 'bold 14px sans-serif',
            textBaseline: 'middle'
        }),
        zIndex: 10
    });
}

/**
 * Style pour les waypoints (à utiliser dans le futur)
 */
export function createWaypointStyle(feature: Feature<Geometry>, resolution: number): Style {
    const properties = feature.getProperties();
    const isSelected = properties.selected === true;

    return new Style({
        image: new Circle({
            radius: isSelected ? 8 : 6,
            fill: new Fill({
                color: 'rgba(76, 175, 80, 0.8)' // Vert
            }),
            stroke: new Stroke({
                color: isSelected ? 'rgba(0, 122, 255, 1)' : 'rgba(255, 255, 255, 0.8)',
                width: isSelected ? 3 : 2
            })
        }),
        text: new Text({
            text: properties.name || 'WP',
            offsetY: -15,
            fill: new Fill({
                color: '#333'
            }),
            stroke: new Stroke({
                color: '#fff',
                width: 3
            }),
            font: '12px sans-serif'
        }),
        zIndex: isSelected ? 1000 : 5
    });
}

/**
 * Précharge toutes les icônes de géocaches disponibles
 */
export async function preloadAllGeocacheIcons(): Promise<void> {
    const iconKeys = [
        'traditional', 'multi', 'mystery', 'letterbox', 'wherigo',
        'earth', 'virtual', 'webcam', 'event', 'cito', 'mega', 'giga',
        'ape', 'hq', 'unknown'
    ];

    const promises = iconKeys.map(key => 
        preloadIcon(key).catch(err => {
            console.warn(`Failed to preload icon ${key}:`, err);
        })
    );

    await Promise.all(promises);
}

