/**
 * Configuration des icônes de géocaches basée sur un sprite sheet
 * 
 * Ce fichier définit tous les types de géocaches et leurs positions dans le sprite sheet.
 * Il permet d'utiliser facilement les icônes dans toute l'application.
 */

import { GEOCACHING_SPRITE_DATA_URL } from './geocache-sprite-data';

/**
 * Interface définissant une icône de géocache dans le sprite sheet
 */
export interface GeocacheIconDefinition {
    /** Clé unique identifiant le type de géocache */
    key: string;
    /** Position X dans le sprite sheet (en pixels) */
    x: number;
    /** Position Y dans le sprite sheet (en pixels) */
    y: number;
    /** Largeur de l'icône (en pixels) */
    w: number;
    /** Hauteur de l'icône (en pixels) */
    h: number;
    /** Label descriptif du type de géocache */
    label: string;
}

/**
 * Configuration du sprite sheet des géocaches
 */
export interface GeocacheSpriteConfig {
    /** URL relative du sprite sheet */
    url: string;
    /** Largeur totale du sprite sheet (en pixels) */
    sheetWidth: number;
    /** Hauteur totale du sprite sheet (en pixels) */
    sheetHeight: number;
    /** Liste de toutes les icônes disponibles */
    items: GeocacheIconDefinition[];
}

/**
 * Configuration principale du sprite sheet des géocaches
 * 
 * @example
 * ```typescript
 * import { GEOCACHE_SPRITE_CONFIG, getIconByKey } from './geocache-icon-config';
 * 
 * // Récupérer une icône par sa clé
 * const icon = getIconByKey('trad');
 * ```
 */
export const GEOCACHE_SPRITE_CONFIG: GeocacheSpriteConfig = {
    url: GEOCACHING_SPRITE_DATA_URL,
    sheetWidth: 1800,
    sheetHeight: 200,
    items: [
        { key: 'traditional',           x: 0,    y: 0, w: 50, h: 50, label: 'Traditional Cache' },
        { key: 'ape',                   x: 100,  y: 0, w: 50, h: 50, label: 'Project APE Cache' },
        { key: 'hq',                    x: 200,  y: 0, w: 50, h: 50, label: 'Groundspeak HQ' },
        { key: 'multi',                 x: 300,  y: 0, w: 50, h: 50, label: 'Multi-Cache' },
        { key: 'event',                 x: 400,  y: 0, w: 50, h: 50, label: 'Event Cache' },
        { key: 'cito',                  x: 500,  y: 0, w: 50, h: 50, label: 'Cache In Trash Out Event' },
        { key: 'mega',                  x: 600,  y: 0, w: 50, h: 50, label: 'Mega-Event Cache' },
        { key: 'giga',                  x: 700,  y: 0, w: 50, h: 50, label: 'Giga-Event Cache' },
        { key: 'maze',                  x: 800,  y: 0, w: 50, h: 50, label: 'GPS Adventures Exhibit' },
        { key: 'earth',                 x: 900,  y: 0, w: 50, h: 50, label: 'Earthcache' },
        { key: 'virtual',               x: 1000, y: 0, w: 50, h: 50, label: 'Virtual Cache' },
        { key: 'webcam',                x: 1100, y: 0, w: 50, h: 50, label: 'Webcam Cache' },
        { key: 'locationless',          x: 1200, y: 0, w: 50, h: 50, label: 'Locationless (Reverse) Cache' },
        { key: 'mystery',               x: 1300, y: 0, w: 50, h: 50, label: 'Mystery Cache' },
        { key: 'letterbox',             x: 1400, y: 0, w: 50, h: 50, label: 'Letterbox Hybrid' },
        { key: 'wherigo',               x: 1500, y: 0, w: 50, h: 50, label: 'Wherigo Cache' },
        { key: 'unknown',               x: 1300, y: 0, w: 50, h: 50, label: 'Unknown Cache' },
    ]
};

/**
 * Map pour accès rapide aux icônes par clé
 */
const iconMap = new Map<string, GeocacheIconDefinition>();
GEOCACHE_SPRITE_CONFIG.items.forEach(item => {
    iconMap.set(item.key.toLowerCase(), item);
});

/**
 * Mapping des types de géocaches retournés par l'API vers les clés d'icônes
 * 
 * Permet de convertir les différentes variantes de noms de types en clés standardisées
 */
export const CACHE_TYPE_TO_ICON_KEY: Record<string, string> = {
    // Types standards
    'Traditional Cache': 'traditional',
    'Multi-cache': 'multi',
    'Multi-Cache': 'multi',
    'Mystery Cache': 'mystery',
    'Unknown Cache': 'mystery',
    'Letterbox Hybrid': 'letterbox',
    'Wherigo Cache': 'wherigo',
    'Earthcache': 'earth',
    'EarthCache': 'earth',
    'Virtual Cache': 'virtual',
    'Webcam Cache': 'webcam',
    'Event Cache': 'event',
    'Cache In Trash Out Event': 'cito',
    'CITO': 'cito',
    'Mega-Event Cache': 'mega',
    'Giga-Event Cache': 'giga',
    'Project APE Cache': 'ape',
    'Groundspeak HQ': 'hq',
    'GPS Adventures Exhibit': 'maze',
    'Locationless (Reverse) Cache': 'locationless',
    
    // Variantes en minuscules
    'traditional': 'traditional',
    'multi': 'multi',
    'mystery': 'mystery',
    'unknown': 'mystery',
    'letterbox': 'letterbox',
    'wherigo': 'wherigo',
    'earth': 'earth',
    'virtual': 'virtual',
    'webcam': 'webcam',
    'event': 'event',
    'cito': 'cito',
    'mega': 'mega',
    'giga': 'giga',
    'ape': 'ape',
    'hq': 'hq',
};

/**
 * Récupère la définition d'une icône par sa clé
 * 
 * @param key - La clé du type de géocache (insensible à la casse)
 * @returns La définition de l'icône ou undefined si non trouvée
 * 
 * @example
 * ```typescript
 * const icon = getIconByKey('traditional');
 * if (icon) {
 *   console.log(icon.label); // "Traditional Cache"
 * }
 * ```
 */
export function getIconByKey(key: string): GeocacheIconDefinition | undefined {
    return iconMap.get(key.toLowerCase());
}

/**
 * Récupère la définition d'une icône à partir du type de géocache
 * 
 * @param cacheType - Le type de géocache tel que retourné par l'API
 * @returns La définition de l'icône ou undefined si non trouvée
 * 
 * @example
 * ```typescript
 * const icon = getIconByCacheType('Traditional Cache');
 * if (icon) {
 *   console.log(icon.x, icon.y); // 0, 0
 * }
 * ```
 */
export function getIconByCacheType(cacheType: string): GeocacheIconDefinition | undefined {
    const iconKey = CACHE_TYPE_TO_ICON_KEY[cacheType];
    if (!iconKey) {
        // Essayer de trouver une correspondance partielle
        const lowerCacheType = cacheType.toLowerCase();
        for (const [key, iconKey] of Object.entries(CACHE_TYPE_TO_ICON_KEY)) {
            if (key.toLowerCase().includes(lowerCacheType) || lowerCacheType.includes(key.toLowerCase())) {
                return getIconByKey(iconKey);
            }
        }
        return undefined;
    }
    return getIconByKey(iconKey);
}

/**
 * Récupère toutes les définitions d'icônes disponibles
 * 
 * @returns Un tableau de toutes les définitions d'icônes
 */
export function getAllIcons(): GeocacheIconDefinition[] {
    return GEOCACHE_SPRITE_CONFIG.items;
}

