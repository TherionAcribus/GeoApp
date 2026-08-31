export interface ElevationPoint {
    lat: number;
    lon: number;
    elevation_m: number | null;
    /** `ign_rge_alti` (France, metrique) ou `open-meteo` (mondial, ~90 m). `null` si non resolu. */
    source: string | null;
}

export interface ElevationResult {
    points: ElevationPoint[];
    attribution: string;
    accuracy_note?: string | null;
    min_m?: number;
    max_m?: number;
    difference_m?: number;
    from_cache?: boolean;
}

function formatMeters(value: number): string {
    return `${Math.round(value * 100) / 100} m`;
}

const SOURCE_LABELS: Record<string, string> = {
    ign_rge_alti: 'IGN RGE ALTI',
    'open-meteo': 'Copernicus DEM (~90 m)',
};

/** Resume court et deterministe des altitudes, avec le denivele des qu il y a plusieurs points. */
export function formatElevationSummary(result: ElevationResult): string {
    if (!result.points.length) {
        return 'Aucun point d altitude demande.';
    }
    const lines = result.points.map((point, index) => {
        const label = result.points.length > 1 ? `Point ${index + 1}` : 'Altitude';
        const coords = `${point.lat}, ${point.lon}`;
        if (point.elevation_m === null) {
            return `- ${label} (${coords}): altitude indisponible`;
        }
        const source = point.source ? SOURCE_LABELS[point.source] || point.source : undefined;
        const suffix = source ? ` [${source}]` : '';
        return `- ${label} (${coords}): ${formatMeters(point.elevation_m)}${suffix}`;
    });
    if (result.difference_m !== undefined) {
        lines.push(`- Denivele entre les points: ${formatMeters(result.difference_m)}`);
    }
    return lines.join('\n');
}
