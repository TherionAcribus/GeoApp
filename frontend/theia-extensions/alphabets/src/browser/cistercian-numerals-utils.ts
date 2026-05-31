export type CistercianPlace = 'units' | 'tens' | 'hundreds' | 'thousands';

export interface CistercianDigits {
    units: number;
    tens: number;
    hundreds: number;
    thousands: number;
}

export interface CistercianPolyline {
    place: CistercianPlace;
    digit: number;
    points: Array<[number, number]>;
}

const BASE_PATHS: Record<number, Array<[number, number]>> = {
    1: [[1, 0], [2, 0]],
    2: [[1, 1], [2, 1]],
    3: [[1, 0], [2, 1]],
    4: [[1, 1], [2, 0]],
    5: [[1, 1], [2, 0], [1, 0]],
    6: [[2, 0], [2, 1]],
    7: [[1, 0], [2, 0], [2, 1]],
    8: [[1, 1], [2, 1], [2, 0]],
    9: [[1, 1], [2, 1], [2, 0], [1, 0]]
};

export function clampCistercianValue(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.min(9999, Math.trunc(value)));
}

export function clampCistercianDigit(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.min(9, Math.trunc(value)));
}

export function digitsFromCistercianValue(value: number): CistercianDigits {
    const normalized = clampCistercianValue(value);
    return {
        thousands: Math.floor(normalized / 1000) % 10,
        hundreds: Math.floor(normalized / 100) % 10,
        tens: Math.floor(normalized / 10) % 10,
        units: normalized % 10
    };
}

export function cistercianValueFromDigits(digits: CistercianDigits): number {
    return clampCistercianDigit(digits.thousands) * 1000
        + clampCistercianDigit(digits.hundreds) * 100
        + clampCistercianDigit(digits.tens) * 10
        + clampCistercianDigit(digits.units);
}

export function getCistercianPolylines(value: number): CistercianPolyline[] {
    const digits = digitsFromCistercianValue(value);
    return (Object.entries(digits) as Array<[CistercianPlace, number]>)
        .map(([place, digit]) => ({
            place,
            digit,
            points: pointsForPlace(digit, place)
        }))
        .filter(polyline => polyline.points.length > 0);
}

export function renderCistercianSvg(value: number): string {
    const normalized = clampCistercianValue(value);
    const polylines = getCistercianPolylines(normalized)
        .map(polyline =>
            `<polyline points="${polyline.points.map(([x, y]) => `${x},${y}`).join(' ')}" />`
        )
        .join('\n  ');
    const body = [
        '<line x1="48" y1="12" x2="48" y2="132" />',
        polylines
    ].filter(Boolean).join('\n  ');

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 144" width="96" height="144" role="img" aria-label="Cistercian numeral ${normalized}"><g fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">\n  ${body}\n</g></svg>`;
}

function pointsForPlace(digit: number, place: CistercianPlace): Array<[number, number]> {
    const base = BASE_PATHS[clampCistercianDigit(digit)];
    if (!base) {
        return [];
    }

    if (place === 'units') {
        return base.map(toSvgPoint);
    }
    if (place === 'tens') {
        return base.map(([x, y]) => toSvgPoint([2 - x, y]));
    }
    if (place === 'hundreds') {
        return base.map(([x, y]) => toSvgPoint([x, 3 - y]));
    }
    return base.map(([x, y]) => toSvgPoint([2 - x, 3 - y]));
}

function toSvgPoint([x, y]: [number, number]): [number, number] {
    return [16 + x * 32, 12 + y * 40];
}
