/**
 * Écritures équivalentes ramenées aux opérateurs de base. Même table que
 * `normalize_formula` (backend, coordinate_calculator.py) : toute évolution
 * doit être faite des deux côtés.
 */
const SYMBOL_ALIASES: Array<[RegExp, string]> = [
    [/[×✕·⋅∙]/g, '*'],
    [/÷/g, '/'],
    [/[−–—]/g, '-'],
    [/[[{]/g, '('],
    [/[\]}]/g, ')'],
    [/²/g, '^2'],
    [/³/g, '^3']
];

/**
 * Ramène une coordonnée-formule (un axe) à l'écriture attendue par la preview
 * et le calcul :
 *
 * - symboles : `×` `·` → `*`, `÷` → `/`, tirets longs → `-`, crochets et
 *   accolades → parenthèses, `²` `³` → `^2` `^3` ;
 * - `x` minuscule entre deux opérandes → `*` ;
 * - variables en minuscules → majuscules, si la formule n'a aucune majuscule ;
 * - `:` entre deux opérandes → `/` ;
 * - virgule décimale → point (`53,ABC` → `53.ABC`).
 *
 * Le point cardinal de tête n'est jamais modifié, sauf pour sa casse.
 */
export function normalizeFormulaAxis(formula: string): string {
    let result = formula || '';
    for (const [pattern, replacement] of SYMBOL_ALIASES) {
        result = result.replace(pattern, replacement);
    }
    result = result.replace(/\s+/g, ' ').trim();

    let prefix = '';
    let body = result;
    const cardinal = result.match(/^([NSEWO])(\s*)/i);
    if (cardinal) {
        prefix = cardinal[1].toUpperCase() + cardinal[2];
        body = result.slice(cardinal[0].length);
    }

    if (/[A-Z]/.test(body)) {
        // Variables en majuscules : un x minuscule entre deux opérandes est une multiplication
        for (let pass = 0; pass < 2; pass++) {
            body = body.replace(/([0-9A-Z)])\s*x\s*([0-9A-Z(])/g, '$1*$2');
        }
    } else {
        // Tout en minuscules : x n'est une multiplication que s'il est isolé par des
        // espaces ou collé à un chiffre ou une parenthèse ("axb" reste trois variables)
        for (let pass = 0; pass < 2; pass++) {
            body = body.replace(/([0-9a-z)])\s+x\s+([0-9a-z(])/g, '$1*$2');
            body = body.replace(/([0-9)])x([0-9a-z(])/g, '$1*$2');
            body = body.replace(/([0-9a-z)])x([0-9(])/g, '$1*$2');
        }
        body = body.toUpperCase();
    }

    for (let pass = 0; pass < 2; pass++) {
        body = body.replace(/([0-9A-Z)])\s*:\s*([0-9A-Z(])/g, '$1/$2');
    }

    // Virgule décimale : une seule virgule, après les degrés, et aucun point
    if (!body.includes('.') && /^[^,]*[°º][^,]*,[^,]*$/.test(body)) {
        body = body.replace(',', '.');
    }

    return `${prefix}${body}`;
}
