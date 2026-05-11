const parseDdMCoordinate = (value?: string): number | null => {
    if (!value) {
        return null;
    }
    const normalized = value.trim().replace(/[,']/g, '.');
    const match = normalized.match(/^([NSEW])\s*(\d+)[°\s]+([\d.]+)/i);
    if (!match) {
        return null;
    }
    const direction = match[1].toUpperCase();
    const degrees = Number(match[2]);
    const minutes = Number(match[3]);
    if (Number.isNaN(degrees) || Number.isNaN(minutes)) {
        return null;
    }
    let decimal = degrees + minutes / 60;
    if (direction === 'S' || direction === 'W') {
        decimal = -decimal;
    }
    return decimal;
};

const convertDdMPairToDecimal = (latStr?: string, lonStr?: string): { latitude: number; longitude: number } | null => {
    const lat = parseDdMCoordinate(latStr);
    const lon = parseDdMCoordinate(lonStr);

    if (lat === null || lon === null) {
        return null;
    }

    return { latitude: lat, longitude: lon };
};

const convertCombinedCoordsToDecimal = (formatted?: string): { latitude: number; longitude: number } | null => {
    if (!formatted) {
        return null;
    }
    const trimmed = formatted.trim();

    // Format décimal simple "48.8566, 2.3522" ou "48.8566 2.3522"
    const decimalMatch = trimmed.match(/(-?\d+\.?\d*)[\s,]+(-?\d+\.?\d*)/);
    if (decimalMatch && !/[NSEW]/i.test(trimmed)) {
        const lat = Number(decimalMatch[1]);
        const lon = Number(decimalMatch[2]);
        if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
            return { latitude: lat, longitude: lon };
        }
    }

    // Format DDM combiné "N 48° 51.396 E 002° 21.132"
    const ddmMatch = trimmed.match(/([NS][^EW]*?\d[^EW]*)(?:\s+|,)([EW].+)/i);
    if (ddmMatch) {
        return convertDdMPairToDecimal(ddmMatch[1], ddmMatch[2]);
    }

    // Si déjà séparé par une virgule, tenter une conversion directe
    const parts = trimmed.split(',');
    if (parts.length === 2) {
        return convertDdMPairToDecimal(parts[0], parts[1]);
    }

    return null;
};

export const extractDecimalCoordinates = (
    coordinates: any,
    fallbackFormatted?: string
): { latitude: number; longitude: number } | null => {
    if (!coordinates) {
        return convertCombinedCoordsToDecimal(fallbackFormatted);
    }

    if (typeof coordinates.latitude === 'number' && typeof coordinates.longitude === 'number') {
        return {
            latitude: coordinates.latitude,
            longitude: coordinates.longitude
        };
    }

    const backendDecimalLat = Number(
        coordinates.decimalLatitude ??
        coordinates.decimal_latitude ??
        coordinates.latitude_decimal ??
        coordinates.lat_decimal
    );
    const backendDecimalLon = Number(
        coordinates.decimalLongitude ??
        coordinates.decimal_longitude ??
        coordinates.longitude_decimal ??
        coordinates.lon_decimal
    );
    if (!Number.isNaN(backendDecimalLat) && !Number.isNaN(backendDecimalLon)) {
        return {
            latitude: backendDecimalLat,
            longitude: backendDecimalLon
        };
    }

    const fromStrings = convertDdMPairToDecimal(coordinates.latitude, coordinates.longitude);
    if (fromStrings) {
        return fromStrings;
    }

    return convertCombinedCoordsToDecimal(fallbackFormatted);
};

export const deriveCoordinatesFromItem = (item: any): any | undefined => {
    if (!item) {
        return undefined;
    }

    if (item.coordinates) {
        return {
            ...item.coordinates,
            decimal_latitude: item.coordinates.decimal_latitude ?? item.decimal_latitude ?? item.decimalLatitude,
            decimal_longitude: item.coordinates.decimal_longitude ?? item.decimal_longitude ?? item.decimalLongitude
        };
    }

    const metadata = item.metadata as any;
    const gpsCoordinates = metadata?.gps_coordinates;
    if (gpsCoordinates && gpsCoordinates.exist) {
        return {
            latitude: gpsCoordinates.ddm_lat || '',
            longitude: gpsCoordinates.ddm_lon || '',
            formatted: gpsCoordinates.ddm || '',
            decimal_latitude: gpsCoordinates.decimal_latitude,
            decimal_longitude: gpsCoordinates.decimal_longitude
        };
    }

    if (typeof item.decimal_latitude === 'number' && typeof item.decimal_longitude === 'number') {
        return {
            latitude: item.decimal_latitude,
            longitude: item.decimal_longitude,
            formatted: item.coordinates?.formatted,
            decimal_latitude: item.decimal_latitude,
            decimal_longitude: item.decimal_longitude
        };
    }

    return undefined;
};
