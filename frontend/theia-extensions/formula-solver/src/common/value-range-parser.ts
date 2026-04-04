/**
 * Parser pour les patterns de plages de valeurs
 * Permet de tester plusieurs valeurs pour une lettre
 */

export interface ValueRange {
    letter: string;
    pattern: string;
    values: number[];
}

/**
 * Parse un pattern et génère les valeurs correspondantes
 * 
 * Patterns supportés :
 * - * : 0-9
 * - <X : valeurs < X
 * - <=X : valeurs <= X
 * - >X : valeurs > X
 * - >=X : valeurs >= X
 * - X<>Y : valeurs strictement entre X et Y (X < v < Y)
 * - X<==>Y : valeurs entre X et Y inclus (X <= v <= Y)
 */
export class ValueRangeParser {
    
    /**
     * Parse un pattern et retourne les valeurs correspondantes
     */
    static parsePattern(pattern: string): number[] {
        const trimmed = pattern.trim();
        
        // Pattern : * (toutes les valeurs 0-9)
        if (trimmed === '*') {
            return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
        }
        
        // Pattern : X<==>Y (inclus)
        const inclusiveRangeMatch = trimmed.match(/^(\d+)<==?>(\d+)$/);
        if (inclusiveRangeMatch) {
            const start = parseInt(inclusiveRangeMatch[1], 10);
            const end = parseInt(inclusiveRangeMatch[2], 10);
            return this.generateRange(start, end, true, true);
        }
        
        // Pattern : X<>Y (exclusif)
        const exclusiveRangeMatch = trimmed.match(/^(\d+)<>(\d+)$/);
        if (exclusiveRangeMatch) {
            const start = parseInt(exclusiveRangeMatch[1], 10);
            const end = parseInt(exclusiveRangeMatch[2], 10);
            return this.generateRange(start, end, false, false);
        }
        
        // Pattern : <=X
        const lteMatch = trimmed.match(/^<=(\d+)$/);
        if (lteMatch) {
            const max = parseInt(lteMatch[1], 10);
            return this.generateRange(0, max, true, true);
        }
        
        // Pattern : <X
        const ltMatch = trimmed.match(/^<(\d+)$/);
        if (ltMatch) {
            const max = parseInt(ltMatch[1], 10);
            return this.generateRange(0, max, true, false);
        }
        
        // Pattern : >=X
        const gteMatch = trimmed.match(/^>=(\d+)$/);
        if (gteMatch) {
            const min = parseInt(gteMatch[1], 10);
            return this.generateRange(min, 9, true, true);
        }
        
        // Pattern : >X
        const gtMatch = trimmed.match(/^>(\d+)$/);
        if (gtMatch) {
            const min = parseInt(gtMatch[1], 10);
            return this.generateRange(min, 9, false, true);
        }
        
        // Valeur unique (nombre simple)
        const singleValue = parseInt(trimmed, 10);
        if (!isNaN(singleValue)) {
            return [singleValue];
        }
        
        // Pattern invalide
        return [];
    }
    
    /**
     * Génère une plage de valeurs
     */
    private static generateRange(
        start: number, 
        end: number, 
        includeStart: boolean, 
        includeEnd: boolean
    ): number[] {
        const values: number[] = [];
        const min = includeStart ? start : start + 1;
        const max = includeEnd ? end : end - 1;
        
        for (let i = min; i <= max; i++) {
            values.push(i);
        }
        
        return values;
    }
    
    /**
     * Vérifie si un pattern est valide
     */
    static isValidPattern(pattern: string): boolean {
        const values = this.parsePattern(pattern);
        return values.length > 0;
    }
    
    /**
     * Retourne une description textuelle du pattern
     */
    static getPatternDescription(pattern: string): string {
        const trimmed = pattern.trim();
        
        if (trimmed === '*') {
            return 'Toutes les valeurs (0-9)';
        }
        
        const inclusiveRangeMatch = trimmed.match(/^(\d+)<==?>(\d+)$/);
        if (inclusiveRangeMatch) {
            return `Valeurs entre ${inclusiveRangeMatch[1]} et ${inclusiveRangeMatch[2]} inclus`;
        }
        
        const exclusiveRangeMatch = trimmed.match(/^(\d+)<>(\d+)$/);
        if (exclusiveRangeMatch) {
            return `Valeurs entre ${exclusiveRangeMatch[1]} et ${exclusiveRangeMatch[2]} (exclusif)`;
        }
        
        const lteMatch = trimmed.match(/^<=(\d+)$/);
        if (lteMatch) {
            return `Valeurs <= ${lteMatch[1]}`;
        }
        
        const ltMatch = trimmed.match(/^<(\d+)$/);
        if (ltMatch) {
            return `Valeurs < ${ltMatch[1]}`;
        }
        
        const gteMatch = trimmed.match(/^>=(\d+)$/);
        if (gteMatch) {
            return `Valeurs >= ${gteMatch[1]}`;
        }
        
        const gtMatch = trimmed.match(/^>(\d+)$/);
        if (gtMatch) {
            return `Valeurs > ${gtMatch[1]}`;
        }
        
        const singleValue = parseInt(trimmed, 10);
        if (!isNaN(singleValue)) {
            return `Valeur unique : ${singleValue}`;
        }
        
        return 'Pattern invalide';
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
    static generateCombinations(ranges: Map<string, number[]>): Array<Record<string, number>> {
        const letters = Array.from(ranges.keys());
        const combinations: Array<Record<string, number>> = [];
        
        if (letters.length === 0) {
            return combinations;
        }
        
        // Fonction récursive pour générer les combinaisons
        const generate = (index: number, current: Record<string, number>) => {
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
