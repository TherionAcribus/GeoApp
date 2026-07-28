import { Style, Circle, Fill, Stroke, Text, Icon } from 'ol/style';
import { Feature } from 'ol';
import { Geometry } from 'ol/geom';
import { getIconByCacheType, getIconByKey, GEOCACHE_SPRITE_CONFIG, GeocacheIconDefinition } from '../geocache-icon-config';

export type FoundGeocacheDisplayMode = 'transparent' | 'hidden' | 'found-icon';

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
    isWaypoint?: boolean;  // ✅ Indique si c'est un waypoint
    waypointId?: number;   // ✅ ID du waypoint (si isWaypoint = true)
    waypointLabel?: string;
    parentCacheType?: string;
    geocacheLabel?: string;
    showLabel?: boolean;
    friendsNote?: string;   // Ligne « Trouvée par … » de la carte des amis
    bruteForceId?: string; // ✅ ID pour les points brute force (suppression)
}

/**
 * Options pour le style des géocaches
 */
export interface GeocacheStyleOptions {
    opacity?: number;
    scale?: number;
    foundDisplayMode?: FoundGeocacheDisplayMode;
}

// ---------------------------------------------------------------------------
// Caches de styles
//
// OpenLayers appelle la fonction de style par feature et à chaque frame de
// rendu. Recréer Style/Icon/Text/Fill/Stroke à chaque appel génère une forte
// pression GC dès quelques centaines de features. On met donc en cache les
// objets immuables et réutilisables (recommandation OpenLayers).
// ---------------------------------------------------------------------------

/** Style « vide » partagé (feature masquée), évite d'allouer un tableau à chaque appel. */
const EMPTY_STYLE: Style[] = [];

/** Cache des Icon (objet le plus coûteux : il porte le chargement du sprite). */
const iconCache = new Map<string, Icon>();
/** Cache des Style sans label (réutilisables tels quels entre features et frames). */
const geocacheStyleCache = new Map<string, Style | Style[]>();
/** Cache des bulles de cluster, par taille + échelle. */
const clusterBubbleCache = new Map<string, Style>();
/** Cache des styles de secours sans label. */
const fallbackStyleCache = new Map<string, Style>();
/** Cache des styles de waypoint sans label, par couleur + sélection. */
const waypointStyleCache = new Map<string, Style>();

/** Sérialise un nombre en clé de cache stable (évite les flottants verbeux). */
function numKey(value: number): string {
    return value.toFixed(3);
}

/** Récupère (ou crée) une Icon de sprite mise en cache. */
function getCachedIcon(iconDef: GeocacheIconDefinition, scale: number, opacity: number): Icon {
    const key = `${iconDef.key}|${numKey(scale)}|${numKey(opacity)}`;
    let icon = iconCache.get(key);
    if (!icon) {
        icon = new Icon({
            src: GEOCACHE_SPRITE_CONFIG.url,
            size: [iconDef.w, iconDef.h],
            offset: [iconDef.x, iconDef.y],
            scale,
            opacity,
            anchor: [0.5, 0.5] // Ancre au centre de l'icône (pour les disques)
        });
        iconCache.set(key, icon);
    }
    return icon;
}

/** Cercle de surbrillance affiché sous une géocache sélectionnée (constant). */
let selectionHighlightStyle: Style | undefined;
function getSelectionHighlightStyle(): Style {
    if (!selectionHighlightStyle) {
        selectionHighlightStyle = new Style({
            image: new Circle({
                radius: 30,
                fill: new Fill({ color: 'rgba(0, 122, 255, 0.2)' }),
                stroke: new Stroke({ color: 'rgba(0, 122, 255, 0.8)', width: 3 })
            }),
            zIndex: 999
        });
    }
    return selectionHighlightStyle;
}

/**
 * Crée le style pour une feature géocache individuelle en utilisant le sprite sheet
 */
export function createGeocacheStyleFromSprite(feature: Feature<Geometry>, resolution: number, options?: GeocacheStyleOptions): Style | Style[] {
    const properties = feature.getProperties() as GeocacheFeatureProperties;
    const isSelected = properties.selected === true;
    const foundDisplayMode = options?.foundDisplayMode || 'transparent';

    if (properties.found && foundDisplayMode === 'hidden') {
        return EMPTY_STYLE;
    }

    // Récupérer l'icône correspondant au type de cache
    const label = properties.showLabel ? properties.geocacheLabel || `${properties.name} (${properties.gc_code})` : undefined;
    const iconDef = properties.found && foundDisplayMode === 'found-icon'
        ? getIconByKey('found')
        : getIconByCacheType(properties.cache_type || 'Unknown Cache');

    if (!iconDef) {
        // Fallback vers un style par défaut si le type n'est pas trouvé
        return createFallbackStyle(isSelected, properties.found, options, label);
    }

    const baseScale = isSelected ? 1.0 : 0.8;
    const scale = options?.scale ? baseScale * options.scale : baseScale;
    const baseOpacity = properties.found && foundDisplayMode === 'transparent' ? 0.6 : 1.0;
    const opacity = options?.opacity !== undefined ? baseOpacity * options.opacity : baseOpacity;

    // Chemin avec label : le texte est propre à chaque feature. On réutilise l'Icon
    // (coûteuse) mais on crée un Text léger (dont les sous-objets sont partagés).
    if (label) {
        const labeledStyle = new Style({
            image: getCachedIcon(iconDef, scale, opacity),
            text: createLabelStyle(label, -30),
            zIndex: isSelected ? 1000 : 1
        });
        return isSelected ? [getSelectionHighlightStyle(), labeledStyle] : labeledStyle;
    }

    // Chemin sans label (cas par défaut) : style entièrement mis en cache et
    // réutilisé tel quel entre toutes les features et tous les frames.
    const cacheKey = `${iconDef.key}|${numKey(scale)}|${numKey(opacity)}|${isSelected ? 1 : 0}`;
    let cached = geocacheStyleCache.get(cacheKey);
    if (!cached) {
        const iconStyle = new Style({
            image: getCachedIcon(iconDef, scale, opacity),
            zIndex: isSelected ? 1000 : 1
        });
        cached = isSelected ? [getSelectionHighlightStyle(), iconStyle] : iconStyle;
        geocacheStyleCache.set(cacheKey, cached);
    }
    return cached;
}

/**
 * Crée le style pour un cluster de géocaches (basé sur le sprite sheet).
 *
 * - Cluster vide : rien.
 * - Cluster d'une seule géocache : on délègue au style individuel (sprite),
 *   ce qui assure le dégroupage naturel au zoom (icône normale, sélection, label…).
 * - Cluster de plusieurs géocaches : bulle ronde avec le compteur.
 */
export function createClusterStyleFromSprite(feature: Feature<Geometry>, resolution: number, options?: GeocacheStyleOptions): Style | Style[] {
    const innerFeatures = feature.get('features') as Feature<Geometry>[] | undefined;
    const size = innerFeatures ? innerFeatures.length : 0;

    if (size === 0) {
        return EMPTY_STYLE;
    }

    if (size === 1) {
        return createGeocacheStyleFromSprite(innerFeatures![0], resolution, options);
    }

    // Bulle de cluster : rayon qui croît avec le nombre de caches (échelle d'icônes incluse).
    const scale = options?.scale ?? 1;
    const cacheKey = `${size}|${numKey(scale)}`;
    let bubble = clusterBubbleCache.get(cacheKey);
    if (!bubble) {
        const radius = Math.min(14 + Math.log(size) * 5, 28) * Math.max(0.6, scale);
        bubble = new Style({
            image: new Circle({
                radius,
                fill: new Fill({
                    color: 'rgba(0, 122, 204, 0.85)'
                }),
                stroke: new Stroke({
                    color: 'rgba(255, 255, 255, 0.95)',
                    width: 2
                })
            }),
            text: new Text({
                text: size.toString(),
                fill: CLUSTER_TEXT_FILL,
                font: 'bold 12px sans-serif',
                textBaseline: 'middle'
            }),
            zIndex: 50
        });
        clusterBubbleCache.set(cacheKey, bubble);
    }
    return bubble;
}

/**
 * Style de secours si le type de cache n'est pas trouvé
 */
function createFallbackStyle(isSelected: boolean, found?: boolean, options?: GeocacheStyleOptions, label?: string): Style {
    const foundDisplayMode = options?.foundDisplayMode || 'transparent';
    if (found && foundDisplayMode === 'hidden') {
        return new Style({});
    }

    const baseRadius = isSelected ? 10 : 8;
    const radius = options?.scale ? baseRadius * options.scale : baseRadius;
    const baseOpacity = found && foundDisplayMode === 'transparent' ? 0.6 : 1.0;
    const opacity = options?.opacity !== undefined ? baseOpacity * options.opacity : baseOpacity;

    const buildStyle = (text: Text | undefined): Style => new Style({
        image: new Circle({
            radius,
            fill: new Fill({
                color: `rgba(255, 140, 0, ${opacity})` // Orange
            }),
            stroke: new Stroke({
                color: isSelected ? 'rgba(0, 122, 255, 1)' : 'rgba(255, 255, 255, 0.8)',
                width: isSelected ? 3 : 2
            })
        }),
        text,
        zIndex: isSelected ? 1000 : 1
    });

    // Avec label : style frais (texte propre à la feature).
    if (label) {
        return buildStyle(createLabelStyle(label, -22));
    }

    // Sans label : style mis en cache.
    const cacheKey = `${numKey(radius)}|${numKey(opacity)}|${isSelected ? 1 : 0}`;
    let cached = fallbackStyleCache.get(cacheKey);
    if (!cached) {
        cached = buildStyle(undefined);
        fallbackStyleCache.set(cacheKey, cached);
    }
    return cached;
}

/**
 * Style pour les waypoints (à utiliser dans le futur)
 */
export function createWaypointStyleFromSprite(feature: Feature<Geometry>, resolution: number): Style {
    const properties = feature.getProperties();
    const isSelected = properties.selected === true;
    const fillColor = getWaypointColor(properties.parentCacheType);
    const label = properties.showLabel ? (properties.waypointLabel || properties.name || 'WP') : undefined;

    const buildStyle = (text: Text | undefined): Style => new Style({
        image: new Circle({
            radius: isSelected ? 8 : 6,
            fill: new Fill({
                color: fillColor
            }),
            stroke: new Stroke({
                color: isSelected ? 'rgba(0, 122, 255, 1)' : 'rgba(255, 255, 255, 0.8)',
                width: isSelected ? 3 : 2
            })
        }),
        text,
        zIndex: isSelected ? 1000 : 5
    });

    // Avec label : style frais (texte propre à la feature).
    if (label) {
        return buildStyle(createLabelStyle(label, -18));
    }

    // Sans label : style mis en cache, par couleur + sélection.
    const cacheKey = `${fillColor}|${isSelected ? 1 : 0}`;
    let cached = waypointStyleCache.get(cacheKey);
    if (!cached) {
        cached = buildStyle(undefined);
        waypointStyleCache.set(cacheKey, cached);
    }
    return cached;
}

// Sous-objets constants partagés entre tous les Text (immuables → réutilisables).
const CLUSTER_TEXT_FILL = new Fill({ color: '#ffffff' });
const LABEL_FILL = new Fill({ color: '#1f2933' });
const LABEL_STROKE = new Stroke({ color: '#fff', width: 4 });
const LABEL_BACKGROUND_FILL = new Fill({ color: 'rgba(255, 255, 255, 0.78)' });

function createLabelStyle(label: string | undefined, offsetY: number): Text | undefined {
    if (!label) {
        return undefined;
    }

    return new Text({
        text: label,
        offsetY,
        fill: LABEL_FILL,
        stroke: LABEL_STROKE,
        font: '600 11px sans-serif',
        backgroundFill: LABEL_BACKGROUND_FILL,
        padding: [2, 4, 2, 4]
    });
}

function getWaypointColor(cacheType?: string): string {
    const normalizedCacheType = (cacheType || '').toLowerCase();
    if (normalizedCacheType.includes('letterbox')) {
        return 'rgba(156, 54, 181, 0.95)';
    }

    const iconKey = getIconByCacheType(cacheType || '')?.key || 'unknown';
    const colors: Record<string, string> = {
        traditional: 'rgba(47, 158, 68, 0.95)',
        multi: 'rgba(245, 159, 0, 0.95)',
        mystery: 'rgba(25, 113, 194, 0.95)',
        unknown: 'rgba(25, 113, 194, 0.95)',
        letterbox: 'rgba(156, 54, 181, 0.95)',
        wherigo: 'rgba(12, 166, 120, 0.95)',
        earth: 'rgba(116, 143, 252, 0.95)',
        virtual: 'rgba(34, 139, 230, 0.95)',
        webcam: 'rgba(23, 162, 184, 0.95)',
        event: 'rgba(230, 119, 0, 0.95)',
        cito: 'rgba(102, 187, 106, 0.95)',
        mega: 'rgba(214, 51, 108, 0.95)',
        giga: 'rgba(190, 75, 219, 0.95)',
        ape: 'rgba(92, 148, 13, 0.95)',
        hq: 'rgba(73, 80, 87, 0.95)',
        maze: 'rgba(121, 85, 72, 0.95)',
        locationless: 'rgba(96, 125, 139, 0.95)'
    };
    return colors[iconKey] || 'rgba(76, 175, 80, 0.95)';
}

/**
 * Style mis en évidence pour une coordonnée détectée par un plugin
 */
const detectedCoordinateStyleCache = new Map<string, Style[]>();

export function createDetectedCoordinateStyle(feature: Feature<Geometry>): Style[] {
    const isAutoSaved = feature.get('autoSaved') === true;
    const cacheKey = isAutoSaved ? 'auto' : 'manual';

    let cached = detectedCoordinateStyleCache.get(cacheKey);
    if (!cached) {
        const baseColor = isAutoSaved ? 'rgba(46, 204, 113, 0.85)' : 'rgba(52, 152, 219, 0.85)';
        const borderColor = isAutoSaved ? '#2ecc71' : '#3498db';

        cached = [
            new Style({
                image: new Circle({
                    radius: 18,
                    stroke: new Stroke({
                        color: borderColor,
                        width: 4
                    })
                }),
                zIndex: 1900
            }),
            new Style({
                image: new Circle({
                    radius: 10,
                    fill: new Fill({
                        color: baseColor
                    }),
                    stroke: new Stroke({
                        color: '#ffffff',
                        width: 2
                    })
                }),
                zIndex: 2000
            })
        ];
        detectedCoordinateStyleCache.set(cacheKey, cached);
    }
    return cached;
}
