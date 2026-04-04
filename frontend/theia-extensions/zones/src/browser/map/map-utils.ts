import { fromLonLat, toLonLat } from 'ol/proj';
import { Extent, getCenter } from 'ol/extent';
import { Coordinate } from 'ol/coordinate';

/**
 * Convertit des coordonnées WGS84 (lat, lon) en Web Mercator (EPSG:3857)
 * utilisé par OpenLayers pour l'affichage.
 */
export function lonLatToMapCoordinate(lon: number, lat: number): Coordinate {
    return fromLonLat([lon, lat]);
}

/**
 * Convertit des coordonnées Web Mercator en WGS84 (lat, lon)
 */
export function mapCoordinateToLonLat(coordinate: Coordinate): [number, number] {
    return toLonLat(coordinate) as [number, number];
}

/**
 * Parse une chaîne de coordonnées dans différents formats courants
 * Formats supportés :
 * - "48.8566, 2.3522" (lat, lon)
 * - "N 48° 51.396 E 002° 21.132" (format Geocaching)
 * - "48.8566 2.3522"
 * - "48°51'23.8"N 2°21'07.9"E" (DMS)
 */
export function parseCoordinates(coordString: string): { lat: number; lon: number } | null {
    if (!coordString || typeof coordString !== 'string') {
        return null;
    }

    // Format décimal simple: "48.8566, 2.3522" ou "48.8566 2.3522"
    const decimalMatch = coordString.match(/(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)/);
    if (decimalMatch) {
        const lat = parseFloat(decimalMatch[1]);
        const lon = parseFloat(decimalMatch[2]);
        if (!isNaN(lat) && !isNaN(lon)) {
            return { lat, lon };
        }
    }

    // Format Geocaching: "N 48° 51.396 E 002° 21.132"
    const geocachingMatch = coordString.match(/([NS])\s*(\d+)°\s*(\d+\.?\d*)\s*([EW])\s*(\d+)°\s*(\d+\.?\d*)/i);
    if (geocachingMatch) {
        let lat = parseFloat(geocachingMatch[2]) + parseFloat(geocachingMatch[3]) / 60;
        let lon = parseFloat(geocachingMatch[5]) + parseFloat(geocachingMatch[6]) / 60;
        
        if (geocachingMatch[1].toUpperCase() === 'S') lat = -lat;
        if (geocachingMatch[4].toUpperCase() === 'W') lon = -lon;
        
        return { lat, lon };
    }

    // Format DMS: 48°51'23.8"N 2°21'07.9"E
    const dmsMatch = coordString.match(/(\d+)°(\d+)'([\d.]+)"([NS])\s*(\d+)°(\d+)'([\d.]+)"([EW])/i);
    if (dmsMatch) {
        let lat = parseFloat(dmsMatch[1]) + parseFloat(dmsMatch[2]) / 60 + parseFloat(dmsMatch[3]) / 3600;
        let lon = parseFloat(dmsMatch[5]) + parseFloat(dmsMatch[6]) / 60 + parseFloat(dmsMatch[7]) / 3600;
        
        if (dmsMatch[4].toUpperCase() === 'S') lat = -lat;
        if (dmsMatch[8].toUpperCase() === 'W') lon = -lon;
        
        return { lat, lon };
    }

    return null;
}

/**
 * Calcule l'étendue (bbox) qui englobe tous les points donnés
 * avec une marge optionnelle en pixels
 */
export function calculateExtent(coordinates: Coordinate[], paddingPixels: number = 50): Extent | null {
    if (coordinates.length === 0) {
        return null;
    }

    if (coordinates.length === 1) {
        // Pour un seul point, créer une petite étendue autour
        const [x, y] = coordinates[0];
        const offset = 1000; // ~1km en mètres Web Mercator
        return [x - offset, y - offset, x + offset, y + offset];
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const coord of coordinates) {
        const [x, y] = coord;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    }

    return [minX, minY, maxX, maxY];
}

/**
 * Calcule le centre d'une étendue
 */
export function getCenterOfExtent(extent: Extent): Coordinate {
    return getCenter(extent);
}

/**
 * Formatte des coordonnées pour l'affichage
 */
export function formatCoordinates(lon: number, lat: number, format: 'decimal' | 'dms' = 'decimal'): string {
    if (format === 'decimal') {
        return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    }

    // Format DMS
    const latDir = lat >= 0 ? 'N' : 'S';
    const lonDir = lon >= 0 ? 'E' : 'W';
    const absLat = Math.abs(lat);
    const absLon = Math.abs(lon);

    const latDeg = Math.floor(absLat);
    const latMin = Math.floor((absLat - latDeg) * 60);
    const latSec = ((absLat - latDeg) * 60 - latMin) * 60;

    const lonDeg = Math.floor(absLon);
    const lonMin = Math.floor((absLon - lonDeg) * 60);
    const lonSec = ((absLon - lonDeg) * 60 - lonMin) * 60;

    return `${latDeg}°${latMin}'${latSec.toFixed(1)}"${latDir} ${lonDeg}°${lonMin}'${lonSec.toFixed(1)}"${lonDir}`;
}

/**
 * Convertit des coordonnées décimales au format Geocaching
 * Format: "N 48° 51.396 E 002° 21.132"
 */
export function formatGeocachingCoordinates(lon: number, lat: number): string {
    const formatMinutes = (minutes: number): string => {
        const value = minutes.toFixed(3);
        return minutes < 10 ? `0${value}` : value;
    };

    const latDir = lat >= 0 ? 'N' : 'S';
    const lonDir = lon >= 0 ? 'E' : 'W';
    const absLat = Math.abs(lat);
    const absLon = Math.abs(lon);

    const latDeg = Math.floor(absLat);
    const latMin = formatMinutes((absLat - latDeg) * 60);

    const lonDeg = Math.floor(absLon);
    const lonMin = formatMinutes((absLon - lonDeg) * 60);

    // Formater la longitude avec des zéros devant si nécessaire (ex: 002°)
    const lonDegFormatted = lonDeg.toString().padStart(3, '0');

    return `${latDir} ${latDeg}° ${latMin} ${lonDir} ${lonDegFormatted}° ${lonMin}`;
}

/**
 * Calcule la distance entre deux points en kilomètres (formule Haversine)
 */
export function calculateDistance(lon1: number, lat1: number, lon2: number, lat2: number): number {
    const R = 6371; // Rayon de la Terre en km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function toRad(degrees: number): number {
    return degrees * Math.PI / 180;
}


