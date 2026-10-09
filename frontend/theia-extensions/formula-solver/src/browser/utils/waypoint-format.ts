import { LetterValue } from '../../common/types';

/**
 * Convertit des coordonnées décimales au format Geocaching
 * ("N 47° 53.123 E 006° 09.456").
 */
export function formatGeocachingCoordinates(lat: number, lon: number): string {
    const latDir = lat >= 0 ? 'N' : 'S';
    const lonDir = lon >= 0 ? 'E' : 'W';

    const absLat = Math.abs(lat);
    const absLon = Math.abs(lon);

    const latDeg = Math.floor(absLat);
    const latMin = (absLat - latDeg) * 60;

    const lonDeg = Math.floor(absLon);
    const lonMin = (absLon - lonDeg) * 60;

    return `${latDir} ${latDeg}° ${latMin.toFixed(3)} ${lonDir} ${String(lonDeg).padStart(3, '0')}° ${lonMin.toFixed(3)}`;
}

/**
 * Note d'un waypoint créé depuis une solution : formule, valeurs et coordonnées.
 *
 * `values` est soit l'état des lettres (calcul simple : valeur calculée, saisie
 * brute et type), soit une combinaison lettre → nombre (candidat de brute force).
 */
export function buildWaypointNote(
    formula: { north: string; east: string } | undefined,
    coords: { ddm?: string; dms?: string; decimal?: string },
    values: Map<string, LetterValue> | Record<string, number>
): string {
    const formulaText = formula ? `${formula.north} ${formula.east}` : 'Formule inconnue';

    let valuesText: string;
    if (values instanceof Map) {
        valuesText = Array.from(values.entries())
            .map(([letter, value]) => `${letter}=${value.value} (${value.rawValue}, type: ${value.type})`)
            .join('\n');
    } else {
        const entries = Object.entries(values)
            .map(([letter, value]) => `${letter}=${value}`)
            .join('\n');
        valuesText = entries || 'Aucune valeur';
    }

    const coordDetails = [coords.ddm, coords.dms, coords.decimal].filter(Boolean).join('\n');

    return `Solution Formula Solver\n\nFormule:\n${formulaText}\n\nValeurs:\n${valuesText}\n\nCoordonnées:\n${coordDetails}`;
}
