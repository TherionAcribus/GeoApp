import {
    EarthCoachGeocacheData,
    EarthCoachMode,
    EarthCoachPromptInput,
    EarthCoachQuickAction,
    GeoImage,
    UserObservation,
} from './earthcoach-types';

function truncateText(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    }
    return `${value.substring(0, maxLength).trim()}...`;
}

function stripHtml(value: string): string {
    if (typeof document !== 'undefined') {
        const temp = document.createElement('div');
        temp.innerHTML = value;
        return (temp.textContent || temp.innerText || '').trim();
    }
    return value.replace(/<[^>]+>/g, ' ').trim();
}

function sanitizeRichText(value?: string, maxLength = 1800): string {
    if (!value) {
        return '';
    }
    return truncateText(stripHtml(value).replace(/\s+/g, ' ').trim(), maxLength);
}

function getDecodedHints(data: EarthCoachGeocacheData): string | undefined {
    if (data.hints_decoded_override) {
        return data.hints_decoded_override;
    }
    if (data.hints_decoded) {
        return data.hints_decoded;
    }
    return data.hints;
}

function buildWaypointsBlock(data: EarthCoachGeocacheData): string[] {
    const waypoints = data.waypoints || [];
    if (!waypoints.length) {
        return [];
    }
    const lines = ['Waypoints:'];
    for (const waypoint of waypoints.slice(0, 8)) {
        const title = [waypoint.prefix, waypoint.lookup, waypoint.name].filter(Boolean).join(' / ') || 'Waypoint';
        const coords = waypoint.gc_coords || (
            waypoint.latitude != null && waypoint.longitude != null
                ? `${waypoint.latitude.toFixed(5)}, ${waypoint.longitude.toFixed(5)}`
                : undefined
        );
        lines.push(`- ${title}${waypoint.type ? ` (${waypoint.type})` : ''}${coords ? ` - ${coords}` : ''}`);
        if (waypoint.note) {
            lines.push(`  Note: ${truncateText(waypoint.note.replace(/\s+/g, ' '), 180)}`);
        }
    }
    if (waypoints.length > 8) {
        lines.push(`- ... ${waypoints.length - 8} waypoint(s) supplementaire(s) non inclus.`);
    }
    return lines;
}

function buildImagesBlock(images: GeoImage[]): string[] {
    if (!images.length) {
        return ['Images: aucune image transmise.'];
    }
    const lines = ['Images transmises:'];
    for (const image of images.slice(0, 10)) {
        const label = image.label ? ` - ${image.label}` : '';
        const description = image.description ? ` (${image.description})` : '';
        lines.push(`- [${image.origin}] ${image.id}${label}${description}`);
    }
    return lines;
}

function buildObservationsBlock(observations: UserObservation[], gcPersonalNote?: string | null): string[] {
    const lines = ['Observations et notes utilisateur:'];
    if (gcPersonalNote?.trim()) {
        lines.push(`- Note personnelle Geocaching.com: ${truncateText(gcPersonalNote.trim().replace(/\s+/g, ' '), 800)}`);
    }
    for (const observation of observations.slice(0, 8)) {
        const source = observation.sourceNoteId ? `note #${observation.sourceNoteId}` : observation.id;
        lines.push(`- ${source}: ${truncateText(observation.note.replace(/\s+/g, ' '), 800)}`);
    }
    if (!gcPersonalNote?.trim() && observations.length === 0) {
        lines.push('- Aucune observation personnelle structuree dans GeoApp pour l instant.');
    }
    if (observations.length > 8) {
        lines.push(`- ... ${observations.length - 8} note(s) supplementaire(s) non incluses.`);
    }
    return lines;
}

function buildActionInstruction(action: EarthCoachQuickAction, mode: EarthCoachMode): string {
    if (action === 'prepare_visit') {
        return 'Action demandee: preparer la visite. Fournis une checklist terrain centree sur ce qu il faut observer, mesurer ou photographier.';
    }
    if (action === 'field_checklist') {
        return 'Action demandee: mode terrain compact. Fournis une checklist courte et directement utilisable sur mobile ou papier.';
    }
    if (action === 'image_gallery') {
        return 'Action demandee: galerie images. Distingue strictement images du listing, photos utilisateur et references pedagogiques.';
    }
    if (action === 'explain_word') {
        return 'Action demandee: expliquer un mot. Demande le terme a expliquer si aucun terme precis n est fourni, puis explique-le simplement dans le contexte EarthCache.';
    }
    if (action === 'illustrate_term') {
        return 'Action demandee: illustrer un terme geologique. Utilise des references externes educational_reference si disponibles, puis precise que les images sont generiques.';
    }
    if (action === 'analyze_observations') {
        return 'Action demandee: analyser les observations personnelles. Separe observation, interpretation et hypothese; signale ce qui manque.';
    }
    if (action === 'resolve' || mode === 'resolver') {
        return 'Action demandee: aider a resoudre avec les observations disponibles, sans inventer le terrain. Propose une synthese exploitable, mais laisse clairement a completer toute observation absente.';
    }
    return 'Action demandee: comprendre cette EarthCache. Explique le but geologique, les notions utiles et les questions a se poser.';
}

export function buildEarthCoachPrompt(input: EarthCoachPromptInput): string {
    const data = input.geocache;
    const description = sanitizeRichText(data.description_html || data.description_raw, 2200);
    const hints = getDecodedHints(data);
    const lines: string[] = [
        '--- CONTEXTE EARTHCACHE ---',
        `Nom: ${data.name}`,
        `ID: ${data.id}`,
        `Code: ${data.gc_code || 'Inconnu'} - Type: ${data.type || 'Inconnu'} - Taille: ${data.size || 'N/A'}`,
        `Difficulte / Terrain: ${data.difficulty ?? '?'} / ${data.terrain ?? '?'}`,
        `Proprietaire: ${data.owner || 'Inconnu'} - Statut: ${data.status || 'Inconnu'}`,
        `Coordonnees affichees: ${data.coordinates_raw || data.original_coordinates_raw || 'Non renseignees'}`,
        data.placed_at ? `Placee le: ${data.placed_at}` : undefined,
        '',
        description ? 'Description du listing (extrait):' : undefined,
        description || undefined,
        hints ? '' : undefined,
        hints ? `Indices (extrait): ${truncateText(hints.trim(), 700)}` : undefined,
        '',
        ...buildWaypointsBlock(data),
        '',
        ...buildImagesBlock(input.images),
        '',
        ...buildObservationsBlock(input.observations, input.gcPersonalNote),
        '',
        '--- MODE EARTHCOACH ---',
        `Mode: ${input.mode}`,
        buildActionInstruction(input.action, input.mode),
        '',
        'Rappel: ne jamais inventer une observation terrain. Si une reponse depend du terrain, indique exactement quoi verifier.',
    ].filter((value): value is string => value !== undefined);

    return lines.join('\n');
}

export function toImageContext(image: GeoImage): { url: string; origin: GeoImage['origin']; id?: string; label?: string; description?: string } {
    return {
        url: image.fileUri,
        origin: image.origin,
        id: image.id,
        label: image.label,
        description: image.description,
    };
}
