import { LetterValue } from '../../common/types';
import { CoordinatePreviewEngine } from '../preview/coordinate-preview-engine';
import { distanceKm } from './distance';

/** Au-delà de 3 lettres (1000 combinaisons, ~15 ms), la déduction devient lente et peu utile. */
export const MAX_DEDUCED_LETTERS = 3;

export interface DeductionCandidate {
    values: Record<string, number>;
    latitude: number;
    longitude: number;
    /** Coordonnée affichable, ex: "N47°53.123 E006°09.456" */
    formatted: string;
    distanceKm: number;
}

export interface DeductionResult {
    /** Lettres sans valeur sur lesquelles porte la déduction */
    letters: string[];
    /** Nombre de combinaisons essayées (10 par lettre) */
    tested: number;
    /** Combinaisons donnant une coordonnée valide dans le rayon, la plus proche d'abord */
    candidates: DeductionCandidate[];
    /** Chiffres encore possibles pour chaque lettre, d'après les candidats */
    possibleByLetter: Map<string, number[]>;
}

/**
 * Cherche quels chiffres (0 à 9) peuvent prendre les lettres manquantes pour
 * que la coordonnée soit valide et à moins de `maxDistanceKm` de l'origine.
 *
 * Hypothèse : chaque lettre manquante vaut un seul chiffre. C'est toujours
 * vrai pour une lettre écrite dans la coordonnée ("N 47° 5A.BCD"), pas
 * forcément pour une lettre qui n'apparaît que dans une expression ("(A+B)").
 */
export function deduceMissingLetters(
    engine: CoordinatePreviewEngine,
    formula: { north: string; east: string },
    values: Map<string, LetterValue>,
    missingLetters: string[],
    origin: { latitude: number; longitude: number },
    maxDistanceKm: number
): DeductionResult {
    const letters = [...missingLetters].sort();
    const candidates: DeductionCandidate[] = [];
    const tested = Math.pow(10, letters.length);

    for (let index = 0; index < tested; index++) {
        const trial = new Map(values);
        const assignment: Record<string, number> = {};
        let rest = index;
        for (let i = letters.length - 1; i >= 0; i--) {
            const digit = rest % 10;
            rest = Math.floor(rest / 10);
            assignment[letters[i]] = digit;
            trial.set(letters[i], { letter: letters[i], rawValue: String(digit), value: digit, type: 'value' });
        }

        const preview = engine.build(formula, trial);
        const { north, east } = preview;
        if (north.status !== 'valid' || east.status !== 'valid' ||
            north.decimalDegrees === undefined || east.decimalDegrees === undefined) {
            continue;
        }

        const distance = distanceKm(origin.latitude, origin.longitude, north.decimalDegrees, east.decimalDegrees);
        if (distance > maxDistanceKm) {
            continue;
        }

        candidates.push({
            values: assignment,
            latitude: north.decimalDegrees,
            longitude: east.decimalDegrees,
            formatted: `${north.display} ${east.display}`,
            distanceKm: distance
        });
    }

    candidates.sort((a, b) => a.distanceKm - b.distanceKm);

    const possibleByLetter = new Map<string, number[]>();
    for (const letter of letters) {
        const digits = Array.from(new Set(candidates.map(c => c.values[letter]))).sort((a, b) => a - b);
        possibleByLetter.set(letter, digits);
    }

    return { letters, tested, candidates, possibleByLetter };
}

/**
 * Résume un ensemble de chiffres : "4", "4 ou 5", "2 à 6", "0, 3, 7", "0 à 9 (aucune contrainte)".
 */
export function describeDigits(digits: number[]): string {
    if (digits.length === 0) {
        return 'aucun';
    }
    if (digits.length === 1) {
        return String(digits[0]);
    }
    if (digits.length === 10) {
        return '0 à 9 (aucune contrainte)';
    }
    if (digits.length === 2) {
        return `${digits[0]} ou ${digits[1]}`;
    }
    const contiguous = digits[digits.length - 1] - digits[0] === digits.length - 1;
    return contiguous ? `${digits[0]} à ${digits[digits.length - 1]}` : digits.join(', ');
}
