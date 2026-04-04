/**
 * Utilitaires pour parser les valeurs saisies dans les champs
 * Supporte les formats:
 * - Valeur unique: "5"
 * - Brute force avec préfixe *:
 *   - Liste: "*2,3,4"
 *   - Plage: "*1-5" ou "*0-9"
 *   - Plage <>: "*2<>9"
 *   - Comparaison: "*<5", "*>=7", "*<=3", "*>8"
 *   - Combinaison: "*1-3,5,7-9"
 */

export interface ParsedValue {
    /** Valeur brute saisie */
    raw: string;
    /** Liste de valeurs numériques extraites */
    values: number[];
    /** True si la valeur représente une liste (plusieurs valeurs) */
    isList: boolean;
}

/**
 * Parse une valeur saisie et extrait toutes les valeurs numériques possibles
 */
export function parseValueList(input: string): ParsedValue {
    const trimmed = input.trim();
    
    if (!trimmed) {
        return {
            raw: input,
            values: [],
            isList: false
        };
    }

    // Vérifier si c'est du brute force (préfixe *)
    const isBruteForce = trimmed.startsWith('*');
    const content = isBruteForce ? trimmed.substring(1).trim() : trimmed;

    // Si pas de préfixe *, c'est une valeur simple
    if (!isBruteForce) {
        const num = parseInt(content, 10);
        if (!isNaN(num)) {
            return {
                raw: input,
                values: [num],
                isList: false
            };
        }
        return {
            raw: input,
            values: [],
            isList: false
        };
    }

    const values: number[] = [];

    // Cas spécial: "*" seul => toutes les valeurs 0..9
    // (doc: `*` - Toutes les valeurs (0-9))
    if (!content) {
        for (let i = 0; i <= 9; i++) {
            values.push(i);
        }
        return {
            raw: input,
            values,
            isList: true
        };
    }
    
    // Détecter le type de pattern
    
    // 1. Plage avec <> (ex: "2<>9")
    const rangeLtGtMatch = content.match(/^(\d+)\s*<>\s*(\d+)$/);
    if (rangeLtGtMatch) {
        const start = parseInt(rangeLtGtMatch[1], 10);
        const end = parseInt(rangeLtGtMatch[2], 10);
        
        if (!isNaN(start) && !isNaN(end)) {
            const min = Math.min(start, end);
            const max = Math.max(start, end);
            
            for (let i = min; i <= max; i++) {
                values.push(i);
            }
        }
        
        return {
            raw: input,
            values,
            isList: true
        };
    }
    
    // 2. Opérateurs de comparaison (ex: "<5", ">=7", "<=3", ">8")
    const comparisonMatch = content.match(/^(<=?|>=?)\s*(\d+)$/);
    if (comparisonMatch) {
        const operator = comparisonMatch[1];
        const threshold = parseInt(comparisonMatch[2], 10);
        
        if (!isNaN(threshold)) {
            // Générer les valeurs de 0 à 9 (ou ajuster selon le contexte)
            const MAX_DIGIT = 9;
            
            for (let i = 0; i <= MAX_DIGIT; i++) {
                let matches = false;
                
                switch (operator) {
                    case '<':
                        matches = i < threshold;
                        break;
                    case '<=':
                        matches = i <= threshold;
                        break;
                    case '>':
                        matches = i > threshold;
                        break;
                    case '>=':
                        matches = i >= threshold;
                        break;
                }
                
                if (matches) {
                    values.push(i);
                }
            }
        }
        
        return {
            raw: input,
            values,
            isList: true
        };
    }
    
    // 3. Liste avec virgules et plages traditionnelles (ex: "2,3,4" ou "1-5" ou "1-3,5,7-9")
    const parts = content.split(',').map(p => p.trim());
    
    for (const part of parts) {
        // Vérifier si c'est une plage (ex: "1-5")
        const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
        
        if (rangeMatch) {
            // C'est une plage
            const start = parseInt(rangeMatch[1], 10);
            const end = parseInt(rangeMatch[2], 10);
            
            if (!isNaN(start) && !isNaN(end)) {
                const min = Math.min(start, end);
                const max = Math.max(start, end);
                
                for (let i = min; i <= max; i++) {
                    if (!values.includes(i)) {
                        values.push(i);
                    }
                }
            }
        } else {
            // C'est une valeur simple
            const num = parseInt(part, 10);
            if (!isNaN(num) && !values.includes(num)) {
                values.push(num);
            }
        }
    }
    
    // Trier les valeurs
    values.sort((a, b) => a - b);
    
    return {
        raw: input,
        values,
        isList: true  // Avec préfixe *, c'est toujours une liste
    };
}

/**
 * Formate une liste de valeurs pour affichage
 */
export function formatValueList(values: number[]): string {
    if (values.length === 0) return '-';
    if (values.length === 1) return values[0].toString();
    
    // Détection de plages continues pour simplifier l'affichage
    const ranges: string[] = [];
    let rangeStart = values[0];
    let rangeEnd = values[0];
    
    for (let i = 1; i < values.length; i++) {
        if (values[i] === rangeEnd + 1) {
            // Continue la plage
            rangeEnd = values[i];
        } else {
            // Fin de plage, ajouter
            if (rangeStart === rangeEnd) {
                ranges.push(rangeStart.toString());
            } else if (rangeEnd === rangeStart + 1) {
                ranges.push(`${rangeStart},${rangeEnd}`);
            } else {
                ranges.push(`${rangeStart}-${rangeEnd}`);
            }
            rangeStart = values[i];
            rangeEnd = values[i];
        }
    }
    
    // Ajouter la dernière plage
    if (rangeStart === rangeEnd) {
        ranges.push(rangeStart.toString());
    } else if (rangeEnd === rangeStart + 1) {
        ranges.push(`${rangeStart},${rangeEnd}`);
    } else {
        ranges.push(`${rangeStart}-${rangeEnd}`);
    }
    
    return ranges.join(', ');
}

/**
 * Exemples d'utilisation:
 * 
 * // Valeur simple (pas de brute force)
 * parseValueList("5")           → { values: [5], isList: false }
 * 
 * // Brute force avec préfixe *
 * parseValueList("*2,3,4")      → { values: [2,3,4], isList: true }
 * parseValueList("*1-5")        → { values: [1,2,3,4,5], isList: true }
 * parseValueList("*1-3,5,7-9")  → { values: [1,2,3,5,7,8,9], isList: true }
 * parseValueList("*0-9")        → { values: [0,1,2,3,4,5,6,7,8,9], isList: true }
 * 
 * // Plage avec <>
 * parseValueList("*2<>9")       → { values: [2,3,4,5,6,7,8,9], isList: true }
 * 
 * // Opérateurs de comparaison
 * parseValueList("*<5")         → { values: [0,1,2,3,4], isList: true }
 * parseValueList("*>=7")        → { values: [7,8,9], isList: true }
 * parseValueList("*<=3")        → { values: [0,1,2,3], isList: true }
 * parseValueList("*>5")         → { values: [6,7,8,9], isList: true }
 */
