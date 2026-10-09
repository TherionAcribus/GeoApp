import { LetterValue, ValueType } from '../../common/types';
import { parseValueList } from './value-parser';

export interface ValueCalculator {
    calculateChecksum(value: string | number): number;
    calculateReducedChecksum(value: string | number): number;
    calculateLength(value: string | number): number;
}

/**
 * Calcule la valeur numérique d'une lettre à partir de la saisie brute et du
 * type de calcul choisi.
 *
 * Une saisie non vide qui ne donne aucun nombre exploitable (texte avec le
 * type « Valeur », liste vide) est signalée par `error` au lieu de valoir 0
 * en silence.
 */
export function computeLetterValue(
    letter: string,
    rawValue: string,
    type: ValueType,
    calculator: ValueCalculator
): LetterValue {
    const parsed = parseValueList(rawValue);
    const trimmed = rawValue.trim();
    const isTextType = type === 'checksum' || type === 'reduced' || type === 'length';

    const applyType = (input: string | number): number => {
        switch (type) {
            case 'checksum':
                return calculator.calculateChecksum(input);
            case 'reduced':
                return calculator.calculateReducedChecksum(input);
            case 'length':
                return calculator.calculateLength(input);
            default:
                return Number(input);
        }
    };

    let value = 0;
    let values: number[] = [];
    let error: string | undefined;

    if (parsed.isList) {
        // Brute force (préfixe *) : le calcul s'applique à chaque valeur de la liste
        values = parsed.values.map(applyType);
        if (values.length > 0) {
            value = values[0];
        } else {
            error = 'liste de valeurs invalide';
        }
    } else if (trimmed && isTextType) {
        // Le calcul porte sur le texte saisi tel quel ("007" a une longueur de 3,
        // "2CV" un checksum de 2+3+22), pas sur le nombre qu'on pourrait en extraire.
        value = applyType(trimmed);
        values = [value];
    } else if (parsed.values.length > 0) {
        value = parsed.values[0];
        values = [value];
    } else if (trimmed) {
        error = 'valeur non numérique';
    }

    return {
        letter,
        rawValue,
        value,
        type,
        values: values.length > 0 ? values : undefined,
        isList: parsed.isList,
        error
    };
}
