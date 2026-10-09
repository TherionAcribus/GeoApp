/**
 * Distance maximale entre les coordonnées publiées d'une Mystery et sa finale
 * (règle des 2 miles de geocaching.com).
 */
export const MYSTERY_MAX_DISTANCE_MILES = 2;
export const KM_PER_MILE = 1.609344;
export const MYSTERY_MAX_DISTANCE_KM = MYSTERY_MAX_DISTANCE_MILES * KM_PER_MILE;

/** Distance en kilomètres entre deux points (formule de Haversine). */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const toRad = (degrees: number): number => (degrees * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
