import { CoordinateFragments, Formula, FormulaFragment, FormulaFragments, FragmentKind, FragmentStatus } from '../../common/types';

type Axis = 'north' | 'east';

interface FragmentBuildOptions {
    kind: FragmentKind;
    raw: string;
    label: string;
    expectedLength?: number;
    index?: number;
}

/**
 * Ajoute les fragments à une formule si nécessaire.
 */
export function ensureFormulaFragments(formula: Formula): Formula {
    if (formula.fragments) {
        return formula;
    }

    try {
        const fragments: FormulaFragments = {
            north: parseCoordinateFragments(formula.north, 'north'),
            east: parseCoordinateFragments(formula.east, 'east')
        };
        formula.fragments = fragments;
    } catch (error) {
        console.warn('[FORMULA-FRAGMENTS] Impossible de parser la formule', formula, error);
    }

    return formula;
}

/**
 * Parse une coordonnée GPS pour en extraire les fragments (cardinale, degrés, minutes, décimales)
 */
export function parseCoordinateFragments(coordinate: string, axis: Axis): CoordinateFragments {
    const original = coordinate.trim();
    const trimmed = original.replace(/\s+/g, ' ').trim();

    const cardinalMatch = trimmed.match(/^([NSEWO])\s*/i);
    const cardinal = (cardinalMatch ? cardinalMatch[1] : axis === 'north' ? 'N' : 'E').toUpperCase();
    let remainder = cardinalMatch ? trimmed.slice(cardinalMatch[0].length).trim() : trimmed;

    const degreeSplit = remainder.split('°');
    const degreesRaw = (degreeSplit[0] || '').trim();
    remainder = degreeSplit[1] ? degreeSplit[1].trim() : '';

    const minuteSplit = remainder.split('.');
    const minutesRaw = (minuteSplit[0] || '').trim();
    const decimalsRaw = minuteSplit.length > 1 ? minuteSplit.slice(1).join('.').trim() : '';

    const decimalValues = extractDecimalFragments(decimalsRaw, 3);

    const expectedDegreesLength = axis === 'north' ? 2 : 3;

    return {
        original: coordinate,
        cardinal: buildFragment({
            kind: 'cardinal',
            raw: cardinal,
            label: 'Cardinal',
            expectedLength: 1
        }, 'fixed'),
        degrees: buildFragment({
            kind: 'degrees',
            raw: degreesRaw,
            label: 'Degrés',
            expectedLength: expectedDegreesLength
        }),
        minutes: buildFragment({
            kind: 'minutes',
            raw: minutesRaw,
            label: 'Minutes',
            expectedLength: 2
        }),
        decimals: decimalValues.map((value, index) =>
            buildFragment({
                kind: 'decimal',
                raw: value,
                label: `Décimale ${index + 1}`,
                expectedLength: 1,
                index
            })
        )
    };
}

/**
 * Construit un fragment enrichi avec métadonnées et statut.
 */
function buildFragment(options: FragmentBuildOptions, forcedStatus?: FragmentStatus): FormulaFragment {
    const cleaned = options.raw.replace(/\s+/g, '');
    // Le point cardinal (N/E/S/W/O) n'est pas une variable, mais les lettres
    // peuvent être des variables (y compris 'E') dans les expressions.
    const variables = options.kind === 'cardinal' ? [] : extractVariables(cleaned);
    const isPureNumber = cleaned.length > 0 && /^[0-9]+$/.test(cleaned);

    let status: FragmentStatus = forcedStatus || 'pending';
    let actualLength: number | undefined;
    let notes: string | undefined;

    if (!cleaned) {
        status = 'empty';
        notes = 'Fragment vide';
    } else if (!forcedStatus) {
        if (isPureNumber) {
            actualLength = cleaned.length;
            if (options.expectedLength && actualLength !== options.expectedLength) {
                status = 'length-mismatch';
                notes = `Longueur attendue: ${options.expectedLength}`;
            } else {
                status = 'ok';
            }
        } else {
            status = 'pending';
        }
    }

    return {
        kind: options.kind,
        label: options.label,
        raw: options.raw,
        cleaned,
        variables,
        expectedLength: options.expectedLength,
        actualLength,
        status,
        notes,
        index: options.index
    };
}

/**
 * Extrait les variables d'un fragment (lettres majuscules hors points cardinaux).
 */
function extractVariables(value: string): string[] {
    const matches = value.match(/[A-Z]/g) || [];
    const variables = new Set<string>();
    matches.forEach(letter => variables.add(letter.toUpperCase()));
    return Array.from(variables).sort();
}

/**
 * Découpe les décimales (3 fragments maximum) en respectant les parenthèses.
 */
function extractDecimalFragments(value: string, count: number): string[] {
    const fragments: string[] = [];
    let buffer = '';
    let depth = 0;

    const pushBuffer = () => {
        if (buffer.trim()) {
            fragments.push(buffer.trim());
            buffer = '';
        }
    };

    for (let i = 0; i < value.length && fragments.length < count; i++) {
        const char = value[i];

        if (char === '(') {
            if (depth === 0) {
                pushBuffer();
            }
            depth += 1;
            buffer += char;
        } else if (char === ')') {
            buffer += char;
            depth = Math.max(0, depth - 1);
            if (depth === 0) {
                pushBuffer();
            }
        } else if (depth === 0 && /\s/.test(char)) {
            pushBuffer();
        } else {
            buffer += char;
        }
    }

    pushBuffer();

    while (fragments.length < count) {
        fragments.push('');
    }

    return fragments.slice(0, count);
}

/**
 * Évalue une expression mathématique simple de manière sécurisée
 * Supporte +, -, *, / et les parenthèses, ainsi que les variables (lettres majuscules)
 */
export function evaluateExpression(expression: string, values?: Map<string, { value: number }>): number {
    if (!expression || !expression.trim()) {
        return NaN;
    }

    try {
        // Nettoyer l'expression
        let cleaned = expression.replace(/\s+/g, '');

        // Vérifier que l'expression ne contient que des caractères autorisés (chiffres, opérateurs, parenthèses, lettres)
        if (!/^[0-9+\-*/().A-Z]+$/.test(cleaned)) {
            console.warn(`[FORMULA-FRAGMENTS] Expression invalide (caractères non autorisés): ${expression}`);
            return NaN;
        }

        // Remplacer les variables par leurs valeurs si elles sont disponibles
        if (values) {
            for (const [letter, letterValue] of values.entries()) {
                const regex = new RegExp(letter, 'g');
                cleaned = cleaned.replace(regex, letterValue.value.toString());
            }
        }

        // Vérifier s'il reste des lettres non remplacées (variables sans valeur)
        if (/[A-Z]/.test(cleaned)) {
            console.warn(`[FORMULA-FRAGMENTS] Variables non définies dans l'expression: ${cleaned} (original: ${expression})`);
            return NaN;
        }

        // Évaluation sécurisée avec Function (plus sûr que eval)
        // eslint-disable-next-line no-new-func
        const result = new Function(`"use strict"; return (${cleaned})`)();

        // Vérifier que le résultat est un nombre fini (pas NaN, pas Infinity, pas -Infinity)
        if (typeof result !== 'number' || !isFinite(result)) {
            console.warn(`[FORMULA-FRAGMENTS] Résultat invalide pour ${expression}: ${result} (type: ${typeof result})`);
            return NaN;
        }

        return result;
    } catch (error) {
        console.warn(`[FORMULA-FRAGMENTS] Erreur évaluation ${expression}:`, error);
        return NaN;
    }
}

/**
 * Met à jour les statuts des fragments avec les calculs
 */
export function updateFragmentsWithCalculations(
    fragments: CoordinateFragments,
    values: Map<string, { value: number }>
): CoordinateFragments {
    const updated = { ...fragments };

    // Fonction helper pour calculer un fragment
    const calculateFragment = (fragment: FormulaFragment): FormulaFragment => {
        if (fragment.kind !== 'decimal' || !fragment.cleaned) {
            return fragment;
        }

        const result = evaluateExpression(fragment.cleaned, values);
        if (isNaN(result)) {
            return {
                ...fragment,
                status: 'invalid' as const,
                notes: 'Expression invalide ou variables manquantes'
            };
        }

        const resultStr = result.toString();
        const actualLength = resultStr.length;
        const expectedLength = fragment.expectedLength || 1;

        let status: FragmentStatus = 'ok';
        let notes: string | undefined;

        if (actualLength !== expectedLength) {
            status = 'length-mismatch';
            notes = `Longueur attendue: ${expectedLength}, obtenue: ${actualLength}`;
        }

        return {
            ...fragment,
            status,
            actualLength,
            notes
        };
    };

    // Mettre à jour les décimales
    updated.decimals = fragments.decimals.map(calculateFragment);

    return updated;
}

