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

export interface FrenchGeologyLithology {
    description?: string | null;
    rock_type?: string | null;
    code?: string | null;
    scale?: string | null;
    layer?: string | null;
}

export interface FrenchGeologySheet {
    number?: string | null;
    name?: string | null;
    scale?: string | null;
    notice_url?: string | null;
    infoterre_url?: string | null;
}

export interface FrenchGeologyBorehole {
    bss_id?: string | null;
    label?: string | null;
    commune?: string | null;
    departement?: string | null;
    lat?: string | number | null;
    lon?: string | number | null;
    url?: string | null;
}

export interface FrenchGeologyResult {
    lat: number;
    lon: number;
    source: string;
    attribution: string;
    covered: boolean;
    note?: string | null;
    lithology?: FrenchGeologyLithology | null;
    sheet?: FrenchGeologySheet | null;
    boreholes: FrenchGeologyBorehole[];
    from_cache?: boolean;
}

/** Resume court et deterministe du contexte BRGM, utilisable dans le chat ou un widget. */
export function formatFrenchGeologySummary(result: FrenchGeologyResult): string {
    if (!result.covered) {
        return 'Ces coordonnees sont hors de la couverture BRGM (France metropolitaine): utilise le contexte Macrostrat mondial.';
    }
    const lines: string[] = [];
    const lithology = result.lithology;
    if (lithology) {
        const label = [cleanText(lithology.description), cleanText(lithology.rock_type)].filter(Boolean).join(' - ');
        const scale = cleanText(lithology.scale);
        lines.push(scale ? `- Lithologie BRGM (${scale}): ${label}` : `- Lithologie BRGM: ${label}`);
    }
    const sheet = result.sheet;
    if (sheet && (cleanText(sheet.number) || cleanText(sheet.name))) {
        const title = [cleanText(sheet.number), cleanText(sheet.name)].filter(Boolean).join(' ');
        lines.push(`- Carte geologique ${cleanText(sheet.scale) || '1/50 000'} n ${title}`);
        const notice = cleanText(sheet.notice_url);
        if (notice) {
            lines.push(`  Notice explicative: ${notice}`);
        }
    }
    result.boreholes.forEach(borehole => {
        const label = cleanText(borehole.label) || cleanText(borehole.bss_id);
        if (!label) {
            return;
        }
        const place = cleanText(borehole.commune);
        lines.push(place ? `- Forage BSS proche: ${label} (${place})` : `- Forage BSS proche: ${label}`);
    });
    if (!lines.length) {
        return 'Aucune donnee BRGM n a ete trouvee a ces coordonnees.';
    }
    return lines.join('\n');
}
