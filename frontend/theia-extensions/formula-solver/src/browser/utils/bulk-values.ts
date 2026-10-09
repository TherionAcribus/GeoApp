export interface BulkValue {
    letter: string;
    value: string;
}

/**
 * Extrait des affectations « lettre = valeur » d'un texte libre.
 *
 * Accepte `=` ou `:` et des séparateurs variés (virgule, point-virgule, retour
 * à la ligne, simple espace) : "A=3, B=7", "A: 3; B: 7", "A=3 B=7" ou une
 * affectation par ligne. La valeur peut être du texte ("D = Tour Eiffel").
 * Si une lettre apparaît plusieurs fois, la dernière affectation l'emporte.
 */
export function parseBulkValues(text: string): BulkValue[] {
    // Début d'affectation : une lettre isolée suivie de = ou :
    const assignment = /(^|[^A-Za-z0-9])([A-Za-z])\s*[=:]/g;
    const starts: Array<{ letter: string; nameStart: number; valueStart: number }> = [];

    let match: RegExpExecArray | null;
    while ((match = assignment.exec(text)) !== null) {
        starts.push({
            letter: match[2].toUpperCase(),
            nameStart: match.index + match[1].length,
            valueStart: match.index + match[0].length
        });
    }

    const byLetter = new Map<string, string>();
    starts.forEach((start, index) => {
        const valueEnd = index + 1 < starts.length ? starts[index + 1].nameStart : text.length;
        const value = text
            .slice(start.valueStart, valueEnd)
            .split(/\r?\n/)[0]
            .replace(/[\s,;]+$/, '')
            .trim();
        if (value) {
            // Réinsérer pour que l'ordre reflète la dernière affectation
            byLetter.delete(start.letter);
            byLetter.set(start.letter, value);
        }
    });

    return Array.from(byLetter.entries()).map(([letter, value]) => ({ letter, value }));
}
