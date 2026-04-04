import { Formula } from '../../common/types';
import { ensureFormulaFragments } from './formula-fragments';

/**
 * Extrait les variables (lettres) d'une formule en s'appuyant sur les fragments quand c'est possible.
 * Les points cardinaux (N, S, E, W, O) sont ignorés par `ensureFormulaFragments`.
 */
export function extractVariablesFromFormula(formula: Formula): string[] {
    const enriched = ensureFormulaFragments({ ...formula });
    const fragments = enriched.fragments;

    if (fragments) {
        const variables = new Set<string>();
        const collect = (part: { variables: string[] }) => part.variables.forEach(letter => variables.add(letter));
        [fragments.north, fragments.east].forEach(axis => {
            collect(axis.degrees);
            collect(axis.minutes);
            axis.decimals.forEach(collect);
        });
        return Array.from(variables).sort();
    }

    // Fallback simple si pas de fragments
    const raw = `${formula.north} ${formula.east}`.toUpperCase();
    const cleaned = raw.replace(/[NSEWO]\s*/g, '');
    const matches = cleaned.match(/[A-Z]/g) || [];
    return Array.from(new Set(matches)).sort();
}

