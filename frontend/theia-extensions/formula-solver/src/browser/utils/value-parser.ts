/**
 * Lecture de la saisie du champ Valeur d'une lettre :
 * - valeur unique : "5"
 * - brute force, avec le préfixe `*` : "*", "*2,3,4", "*1-5", "*<5", "*1-3,7,>=8"...
 *
 * La syntaxe après `*` est celle du panneau « Mode Brute Force »
 * (voir `common/value-range-parser.ts`).
 */

import { parseValuePattern } from '../../common/value-range-parser';

export interface ParsedValue {
    /** Valeur brute saisie */
    raw: string;
    /** Liste de valeurs numériques extraites */
    values: number[];
    /** True si la saisie est un brute force (préfixe `*`), même si elle est invalide */
    isList: boolean;
}

/**
 * Parse une valeur saisie et extrait toutes les valeurs numériques possibles
 */
export function parseValueList(input: string): ParsedValue {
    const trimmed = input.trim();

    if (!trimmed) {
        return { raw: input, values: [], isList: false };
    }

    if (trimmed.startsWith('*')) {
        const content = trimmed.substring(1).trim();
        // "*" seul : tous les chiffres
        return { raw: input, values: parseValuePattern(content || '*'), isList: true };
    }

    // Valeur simple. Seul un entier complet est numérique : "2CV" ou "007 bis"
    // ne valent pas 2 ou 7.
    const num = /^[+-]?\d+$/.test(trimmed) ? parseInt(trimmed, 10) : NaN;
    return { raw: input, values: isNaN(num) ? [] : [num], isList: false };
}
