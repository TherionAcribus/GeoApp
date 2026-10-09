/**
 * Syntaxe unique des listes de valeurs à essayer (brute force).
 *
 * Utilisée par le panneau « Mode Brute Force » et, précédée de `*`, par le
 * champ Valeur d'une lettre (`*1-5`).
 *
 * Un pattern est une suite d'éléments séparés par `,` ou `;` :
 * - `7`        : une valeur
 * - `1-5`      : de 1 à 5 inclus (`1<>5` et `1<==>5` sont équivalents)
 * - `<5` `<=5` : chiffres de 0 jusqu'à 5 (exclu / inclus)
 * - `>5` `>=5` : chiffres de 5 (exclu / inclus) jusqu'à 9
 * - `*`        : tous les chiffres, 0 à 9
 *
 * Exemple : `1-3,7,>=8` → 1, 2, 3, 7, 8, 9.
 */

/** Au-delà, un pattern est refusé plutôt que développé (`0-99999999`). */
export const MAX_VALUES_PER_PATTERN = 1000;

const ALL_DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * Développe un élément de pattern, ou retourne undefined s'il est invalide.
 */
function parsePatternItem(item: string): number[] | undefined {
    if (item === '*') {
        return ALL_DIGITS;
    }

    if (/^\d+$/.test(item)) {
        return [parseInt(item, 10)];
    }

    // Plage inclusive : 1-5, 1<>5, 1<=>5, 1<==>5
    const range = item.match(/^(\d+)\s*(?:-|<=?=?>)\s*(\d+)$/);
    if (range) {
        const a = parseInt(range[1], 10);
        const b = parseInt(range[2], 10);
        const min = Math.min(a, b);
        const max = Math.max(a, b);
        if (max - min + 1 > MAX_VALUES_PER_PATTERN) {
            return undefined;
        }
        const values: number[] = [];
        for (let value = min; value <= max; value++) {
            values.push(value);
        }
        return values;
    }

    // Comparaison, bornée aux chiffres 0 à 9
    const comparison = item.match(/^(<=?|>=?)\s*(\d+)$/);
    if (comparison) {
        const threshold = parseInt(comparison[2], 10);
        switch (comparison[1]) {
            case '<': return ALL_DIGITS.filter(digit => digit < threshold);
            case '<=': return ALL_DIGITS.filter(digit => digit <= threshold);
            case '>': return ALL_DIGITS.filter(digit => digit > threshold);
            default: return ALL_DIGITS.filter(digit => digit >= threshold);
        }
    }

    return undefined;
}

/**
 * Développe un pattern en valeurs triées et sans doublon. Retourne une liste
 * vide si le pattern est vide, contient un élément invalide ou donne plus de
 * `MAX_VALUES_PER_PATTERN` valeurs : un pattern à moitié compris n'est jamais
 * appliqué partiellement.
 */
export function parseValuePattern(pattern: string): number[] {
    const items = pattern.split(/[,;]/).map(item => item.trim()).filter(item => item.length > 0);
    if (items.length === 0) {
        return [];
    }

    const values = new Set<number>();
    for (const item of items) {
        const itemValues = parsePatternItem(item);
        if (!itemValues) {
            return [];
        }
        itemValues.forEach(value => values.add(value));
        if (values.size > MAX_VALUES_PER_PATTERN) {
            return [];
        }
    }

    return Array.from(values).sort((a, b) => a - b);
}

/**
 * Écrit une liste de valeurs triées de façon compacte : "1-3, 7, 9".
 */
export function formatValues(values: number[]): string {
    const parts: string[] = [];
    let start = 0;
    while (start < values.length) {
        let end = start;
        while (end + 1 < values.length && values[end + 1] === values[end] + 1) {
            end++;
        }
        if (end - start >= 2) {
            parts.push(`${values[start]}-${values[end]}`);
        } else {
            for (let i = start; i <= end; i++) {
                parts.push(String(values[i]));
            }
        }
        start = end + 1;
    }
    return parts.join(', ');
}

export class ValueRangeParser {

    /**
     * Parse un pattern et retourne les valeurs correspondantes. Le `*` de tête
     * du champ Valeur (`*1-5`) est accepté ici aussi.
     */
    static parsePattern(pattern: string): number[] {
        const trimmed = pattern.trim();
        if (trimmed === '*') {
            return ALL_DIGITS;
        }
        return parseValuePattern(trimmed.startsWith('*') ? trimmed.slice(1) : trimmed);
    }

    /**
     * Vérifie si un pattern est valide
     */
    static isValidPattern(pattern: string): boolean {
        return this.parsePattern(pattern).length > 0;
    }

    /**
     * Retourne une description textuelle du pattern
     */
    static getPatternDescription(pattern: string): string {
        const values = this.parsePattern(pattern);
        if (values.length === 0) {
            return 'Pattern invalide';
        }
        if (values.length === 1) {
            return `Valeur unique : ${values[0]}`;
        }
        return `${values.length} valeurs : ${formatValues(values)}`;
    }
}

/**
 * Génère toutes les combinaisons possibles de valeurs
 */
export class CombinationGenerator {
    
    /**
     * Génère toutes les combinaisons à partir des plages de valeurs
     * 
     * Exemple :
     * A: [1, 2], B: [3, 4] => [{A:1, B:3}, {A:1, B:4}, {A:2, B:3}, {A:2, B:4}]
     */
    static generateCombinations(ranges: Map<string, number[]>, limit: number = this.getMaxCombinations()): Array<Record<string, number>> {
        const letters = Array.from(ranges.keys());
        const combinations: Array<Record<string, number>> = [];
        
        if (letters.length === 0) {
            return combinations;
        }
        
        // Fonction récursive pour générer les combinaisons
        const generate = (index: number, current: Record<string, number>) => {
            if (combinations.length >= limit) {
                return;
            }

            if (index === letters.length) {
                combinations.push({ ...current });
                return;
            }
            
            const letter = letters[index];
            const values = ranges.get(letter) || [];
            
            for (const value of values) {
                current[letter] = value;
                generate(index + 1, current);
            }
        };
        
        generate(0, {});
        return combinations;
    }
    
    /**
     * Compte le nombre total de combinaisons possibles
     */
    static countCombinations(ranges: Map<string, number[]>): number {
        let count = 1;
        for (const values of ranges.values()) {
            count *= values.length;
        }
        return count;
    }
    
    /**
     * Limite le nombre de combinaisons pour éviter les calculs excessifs
     */
    static getMaxCombinations(): number {
        return 1000; // Limite raisonnable
    }
}
