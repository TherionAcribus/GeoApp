export type GeoCalculationOperation =
    | 'height_from_shadow'
    | 'scale_from_reference'
    | 'slope_angle'
    | 'distance_between_coordinates'
    | 'age_from_rate'
    | 'flow_rate'
    | 'circumference_to_diameter'
    | 'average';

export interface GeoCalculationResult {
    operation: GeoCalculationOperation;
    value: number;
    unit: string;
    formula: string;
    inputs: Record<string, number | string>;
    extra?: Record<string, number | string>;
    note: string;
}

export const GEO_CALCULATION_OPERATIONS: GeoCalculationOperation[] = [
    'height_from_shadow',
    'scale_from_reference',
    'slope_angle',
    'distance_between_coordinates',
    'age_from_rate',
    'flow_rate',
    'circumference_to_diameter',
    'average',
];

const FIELD_NOTE = 'Calcul deterministe a partir des valeurs fournies. Verifie que ces mesures viennent bien du terrain; ne presente pas ce resultat comme une observation directe.';

type Params = Record<string, unknown>;

function requireNumber(params: Params, key: string): number {
    const raw = params[key];
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
    if (!Number.isFinite(value)) {
        throw new Error(`Le parametre numerique "${key}" est requis.`);
    }
    return value;
}

function requireNonZero(params: Params, key: string): number {
    const value = requireNumber(params, key);
    if (value === 0) {
        throw new Error(`Le parametre "${key}" ne doit pas etre zero.`);
    }
    return value;
}

function optionalString(params: Params, key: string, fallback: string): string {
    const raw = params[key];
    if (typeof raw === 'string' && raw.trim()) {
        return raw.trim();
    }
    return fallback;
}

export function roundTo(value: number, digits: number): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function roundSmart(value: number): number {
    const abs = Math.abs(value);
    if (abs >= 100) {
        return roundTo(value, 1);
    }
    if (abs >= 1) {
        return roundTo(value, 2);
    }
    return roundTo(value, 4);
}

function heightFromShadow(params: Params): GeoCalculationResult {
    const referenceHeight = requireNumber(params, 'reference_height');
    const referenceShadow = requireNonZero(params, 'reference_shadow');
    const objectShadow = requireNumber(params, 'object_shadow');
    const unit = optionalString(params, 'unit', 'm');
    const value = referenceHeight * (objectShadow / referenceShadow);
    return {
        operation: 'height_from_shadow',
        value: roundSmart(value),
        unit,
        formula: 'hauteur = hauteur_reference x (ombre_objet / ombre_reference)',
        inputs: { reference_height: referenceHeight, reference_shadow: referenceShadow, object_shadow: objectShadow, unit },
        note: `${FIELD_NOTE} L'ombre de reference et l'ombre de l'objet doivent etre mesurees au meme moment.`,
    };
}

function scaleFromReference(params: Params): GeoCalculationResult {
    const referenceReal = requireNumber(params, 'reference_real');
    const referenceMeasured = requireNonZero(params, 'reference_measured');
    const targetMeasured = requireNumber(params, 'target_measured');
    const unit = optionalString(params, 'unit', 'm');
    const value = targetMeasured * (referenceReal / referenceMeasured);
    return {
        operation: 'scale_from_reference',
        value: roundSmart(value),
        unit,
        formula: 'taille_reelle = mesure_cible x (taille_reelle_reference / mesure_reference)',
        inputs: { reference_real: referenceReal, reference_measured: referenceMeasured, target_measured: targetMeasured, unit },
        note: `${FIELD_NOTE} La reference et la cible doivent etre mesurees dans la meme image ou avec la meme echelle.`,
    };
}

function slopeAngle(params: Params): GeoCalculationResult {
    const rise = requireNumber(params, 'rise');
    const run = requireNonZero(params, 'run');
    const angleDeg = Math.atan2(rise, run) * (180 / Math.PI);
    const slopePercent = (rise / run) * 100;
    return {
        operation: 'slope_angle',
        value: roundTo(angleDeg, 2),
        unit: 'degres',
        formula: 'angle = atan(denivele / distance_horizontale)',
        inputs: { rise, run },
        extra: { slope_percent: roundTo(slopePercent, 2) },
        note: `${FIELD_NOTE} Denivele (rise) et distance horizontale (run) dans la meme unite.`,
    };
}

function toRadians(value: number): number {
    return value * (Math.PI / 180);
}

function distanceBetweenCoordinates(params: Params): GeoCalculationResult {
    const lat1 = requireNumber(params, 'lat1');
    const lon1 = requireNumber(params, 'lon1');
    const lat2 = requireNumber(params, 'lat2');
    const lon2 = requireNumber(params, 'lon2');
    for (const [key, value] of [['lat1', lat1], ['lat2', lat2]] as Array<[string, number]>) {
        if (value < -90 || value > 90) {
            throw new Error(`${key} doit etre entre -90 et 90.`);
        }
    }
    for (const [key, value] of [['lon1', lon1], ['lon2', lon2]] as Array<[string, number]>) {
        if (value < -180 || value > 180) {
            throw new Error(`${key} doit etre entre -180 et 180.`);
        }
    }
    const earthRadius = 6371000;
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const meters = earthRadius * c;
    return {
        operation: 'distance_between_coordinates',
        value: roundTo(meters, 1),
        unit: 'm',
        formula: 'distance = formule de Haversine (rayon terrestre 6371 km)',
        inputs: { lat1, lon1, lat2, lon2 },
        extra: { kilometers: roundTo(meters / 1000, 3) },
        note: FIELD_NOTE,
    };
}

function ageFromRate(params: Params): GeoCalculationResult {
    const amount = requireNumber(params, 'amount');
    const rate = requireNonZero(params, 'rate');
    const amountUnit = optionalString(params, 'amount_unit', 'mm');
    const timeUnit = optionalString(params, 'time_unit', 'an');
    const value = amount / rate;
    return {
        operation: 'age_from_rate',
        value: roundSmart(value),
        unit: timeUnit,
        formula: 'duree = quantite / taux',
        inputs: { amount, rate, amount_unit: amountUnit, time_unit: timeUnit },
        note: `${FIELD_NOTE} La quantite (${amountUnit}) et le taux (${amountUnit}/${timeUnit}) doivent utiliser la meme unite de longueur.`,
    };
}

function flowRate(params: Params): GeoCalculationResult {
    const volume = requireNumber(params, 'volume');
    const time = requireNonZero(params, 'time');
    const volumeUnit = optionalString(params, 'volume_unit', 'L');
    const timeUnit = optionalString(params, 'time_unit', 's');
    const value = volume / time;
    return {
        operation: 'flow_rate',
        value: roundSmart(value),
        unit: `${volumeUnit}/${timeUnit}`,
        formula: 'debit = volume / temps',
        inputs: { volume, time, volume_unit: volumeUnit, time_unit: timeUnit },
        note: FIELD_NOTE,
    };
}

function circumferenceToDiameter(params: Params): GeoCalculationResult {
    const circumference = requireNumber(params, 'circumference');
    if (circumference < 0) {
        throw new Error('circumference doit etre positif.');
    }
    const unit = optionalString(params, 'unit', 'm');
    const diameter = circumference / Math.PI;
    return {
        operation: 'circumference_to_diameter',
        value: roundSmart(diameter),
        unit,
        formula: 'diametre = circonference / pi',
        inputs: { circumference, unit },
        extra: { radius: roundSmart(diameter / 2) },
        note: FIELD_NOTE,
    };
}

function average(params: Params): GeoCalculationResult {
    const raw = params.values;
    if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error('Le parametre "values" doit etre une liste de nombres non vide.');
    }
    const values = raw.map((item, index) => {
        const value = typeof item === 'number' ? item : typeof item === 'string' && item.trim() !== '' ? Number(item) : NaN;
        if (!Number.isFinite(value)) {
            throw new Error(`values[${index}] n'est pas un nombre valide.`);
        }
        return value;
    });
    const unit = optionalString(params, 'unit', '');
    const sum = values.reduce((total, value) => total + value, 0);
    const mean = sum / values.length;
    return {
        operation: 'average',
        value: roundSmart(mean),
        unit,
        formula: 'moyenne = somme des valeurs / nombre de valeurs',
        inputs: { count: values.length, unit },
        extra: {
            sum: roundSmart(sum),
            min: roundSmart(Math.min(...values)),
            max: roundSmart(Math.max(...values)),
        },
        note: FIELD_NOTE,
    };
}

const OPERATIONS: Record<GeoCalculationOperation, (params: Params) => GeoCalculationResult> = {
    height_from_shadow: heightFromShadow,
    scale_from_reference: scaleFromReference,
    slope_angle: slopeAngle,
    distance_between_coordinates: distanceBetweenCoordinates,
    age_from_rate: ageFromRate,
    flow_rate: flowRate,
    circumference_to_diameter: circumferenceToDiameter,
    average: average,
};

export function runEarthCoachCalculation(operation: string, params: Params): GeoCalculationResult {
    const handler = OPERATIONS[operation as GeoCalculationOperation];
    if (!handler) {
        throw new Error(`Operation inconnue: "${operation}". Operations disponibles: ${GEO_CALCULATION_OPERATIONS.join(', ')}.`);
    }
    return handler(params || {});
}
