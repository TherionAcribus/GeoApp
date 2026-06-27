export interface GeologyUnit {
    name?: string | null;
    strat_name?: string | null;
    lithology?: string | null;
    description?: string | null;
    comments?: string | null;
    age_text?: string | null;
    b_age?: number | string | null;
    t_age?: number | string | null;
    scale?: string | null;
    source?: number | string | null;
    color?: string | null;
}

export interface GeologyResult {
    lat: number;
    lon: number;
    source: string;
    attribution: string;
    units: GeologyUnit[];
    from_cache?: boolean;
}

function cleanText(value: unknown): string | undefined {
    if (typeof value === 'number') {
        return String(value);
    }
    if (typeof value === 'string' && value.trim()) {
        return value.trim();
    }
    return undefined;
}

/** Resume court et deterministe d'un resultat geologique, utilisable dans le chat ou un widget. */
export function formatGeologySummary(result: GeologyResult): string {
    if (!result.units.length) {
        return 'Aucune unite geologique cartographiee n a ete trouvee a ces coordonnees.';
    }
    const lines: string[] = [];
    result.units.forEach((unit, index) => {
        const title = cleanText(unit.name) || cleanText(unit.strat_name) || `Unite ${index + 1}`;
        const details = [
            cleanText(unit.lithology) ? `lithologie: ${cleanText(unit.lithology)}` : undefined,
            cleanText(unit.age_text) ? `age: ${cleanText(unit.age_text)}` : undefined,
            cleanText(unit.scale) ? `echelle: ${cleanText(unit.scale)}` : undefined,
        ].filter(Boolean).join('; ');
        lines.push(details ? `- ${title} (${details})` : `- ${title}`);
        const description = cleanText(unit.description);
        if (description) {
            lines.push(`  ${description}`);
        }
    });
    return lines.join('\n');
}
