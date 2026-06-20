import {
    EarthCoachGeocacheData,
    EarthCoachMode,
    EarthCoachPromptInput,
    EarthCoachQuickAction,
    EarthCoachVerbosity,
    GeoImage,
    UserObservation,
} from './earthcoach-types';

interface EarthCoachPromptLimits {
    description: number;
    hints: number;
    waypointNote: number;
    note: number;
    observation: number;
    waypoints: number;
    observations: number;
    images: number;
}

const PROMPT_LIMITS_BY_VERBOSITY: Record<EarthCoachVerbosity, EarthCoachPromptLimits> = {
    compact: {
        description: 900,
        hints: 350,
        waypointNote: 120,
        note: 450,
        observation: 450,
        waypoints: 5,
        observations: 5,
        images: 6,
    },
    normal: {
        description: 1800,
        hints: 700,
        waypointNote: 180,
        note: 800,
        observation: 800,
        waypoints: 8,
        observations: 8,
        images: 10,
    },
    detailed: {
        description: 3200,
        hints: 1200,
        waypointNote: 260,
        note: 1200,
        observation: 1200,
        waypoints: 12,
        observations: 12,
        images: 12,
    },
};

function normalizeVerbosity(value?: EarthCoachVerbosity): EarthCoachVerbosity {
    if (value === 'normal' || value === 'detailed') {
        return value;
    }
    return 'compact';
}

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

function buildWaypointsBlock(data: EarthCoachGeocacheData, limits: EarthCoachPromptLimits): string[] {
    const waypoints = data.waypoints || [];
    if (!waypoints.length) {
        return [];
    }
    const lines = ['Waypoints:'];
    for (const waypoint of waypoints.slice(0, limits.waypoints)) {
        const title = [waypoint.prefix, waypoint.lookup, waypoint.name].filter(Boolean).join(' / ') || 'Waypoint';
        const coords = waypoint.gc_coords || (
            waypoint.latitude != null && waypoint.longitude != null
                ? `${waypoint.latitude.toFixed(5)}, ${waypoint.longitude.toFixed(5)}`
                : undefined
        );
        lines.push(`- ${title}${waypoint.type ? ` (${waypoint.type})` : ''}${coords ? ` - ${coords}` : ''}`);
        if (waypoint.note) {
            lines.push(`  Note: ${truncateText(waypoint.note.replace(/\s+/g, ' '), limits.waypointNote)}`);
        }
    }
    if (waypoints.length > limits.waypoints) {
        lines.push(`- ... ${waypoints.length - limits.waypoints} waypoint(s) supplementaire(s) non inclus.`);
    }
    return lines;
}

function buildImagesBlock(images: GeoImage[], limits: EarthCoachPromptLimits): string[] {
    if (!images.length) {
        return ['Images: aucune image transmise.'];
    }
    const lines = ['Images transmises:'];
    for (const image of images.slice(0, limits.images)) {
        const label = image.label ? ` - ${image.label}` : '';
        const description = image.description ? ` (${image.description})` : '';
        lines.push(`- [${image.origin}] ${image.id}${label}${description}`);
    }
    if (images.length > limits.images) {
        lines.push(`- ... ${images.length - limits.images} image(s) supplementaire(s) non incluses.`);
    }
    return lines;
}

function buildObservationsBlock(
    observations: UserObservation[],
    limits: EarthCoachPromptLimits,
    gcPersonalNote?: string | null
): string[] {
    const lines = ['Observations et notes utilisateur:'];
    if (gcPersonalNote?.trim()) {
        lines.push(`- Note personnelle Geocaching.com: ${truncateText(gcPersonalNote.trim().replace(/\s+/g, ' '), limits.note)}`);
    }
    for (const observation of observations.slice(0, limits.observations)) {
        const source = observation.sourceNoteId ? `note #${observation.sourceNoteId}` : observation.id;
        const details = [
            observation.source === 'structured' ? `type=${observation.observationType || 'observation'}` : undefined,
            observation.observedAt ? `date=${observation.observedAt}` : undefined,
            observation.waypointId ? `waypoint=${observation.waypointId}` : undefined,
            observation.coordinatesRaw ? `coords=${observation.coordinatesRaw}` : undefined,
            observation.coordinates && !observation.coordinatesRaw
                ? `coords=${observation.coordinates.lat.toFixed(5)}, ${observation.coordinates.lon.toFixed(5)}`
                : undefined,
            observation.images.length ? `images=${observation.images.map(image => `${image.id}:${image.origin}`).join(', ')}` : undefined,
        ].filter(Boolean).join('; ');
        lines.push(`- ${source}${details ? ` (${details})` : ''}: ${truncateText(observation.note.replace(/\s+/g, ' '), limits.observation)}`);
    }
    if (!gcPersonalNote?.trim() && observations.length === 0) {
        lines.push('- Aucune observation personnelle structuree dans GeoApp pour l instant.');
    }
    if (observations.length > limits.observations) {
        lines.push(`- ... ${observations.length - limits.observations} note(s) supplementaire(s) non incluses.`);
    }
    return lines;
}

function buildActionInstruction(action: EarthCoachQuickAction, mode: EarthCoachMode, verbosity: EarthCoachVerbosity): string {
    if (action === 'prepare_visit') {
        if (verbosity === 'compact') {
            return 'Action demandee: preparer la visite. Fournis une checklist courte et actionnable, centree sur observer, mesurer, photographier.';
        }
        return 'Action demandee: preparer la visite. Fournis une checklist terrain centree sur ce qu il faut observer, mesurer ou photographier.';
    }
    if (action === 'field_checklist') {
        return 'Action demandee: mode terrain compact. Fournis une checklist courte et directement utilisable sur mobile ou papier.';
    }
    if (action === 'observations') {
        return 'Action demandee: gerer les observations terrain structurees. Separe observation, hypothese et interpretation, et relie les photos sans les confondre avec des references.';
    }
    if (action === 'image_gallery') {
        return 'Action demandee: galerie images. Distingue strictement images du listing, photos utilisateur et references pedagogiques.';
    }
    if (action === 'explain_word') {
        if (verbosity === 'compact') {
            return 'Action demandee: expliquer un mot. Donne une definition breve, contextualisee, sans cours general.';
        }
        return 'Action demandee: expliquer un mot. Demande le terme a expliquer si aucun terme precis n est fourni, puis explique-le simplement dans le contexte EarthCache.';
    }
    if (action === 'illustrate_term') {
        return 'Action demandee: illustrer un terme geologique. Utilise des references externes educational_reference si disponibles, puis precise que les images sont generiques.';
    }
    if (action === 'analyze_observations') {
        return 'Action demandee: analyser les observations personnelles. Separe observation, interpretation et hypothese; signale ce qui manque.';
    }
    if (action === 'resolve' || mode === 'resolver') {
        if (verbosity === 'compact') {
            return 'Action demandee: aider a resoudre avec les observations disponibles, sans inventer le terrain. Propose une synthese courte, avec champs a completer si le terrain manque.';
        }
        return 'Action demandee: aider a resoudre avec les observations disponibles, sans inventer le terrain. Propose une synthese exploitable, mais laisse clairement a completer toute observation absente.';
    }
    if (verbosity === 'compact') {
        return 'Action demandee: faire un compte rendu rapide du listing. Resume le but geologique, les questions et les points a verifier; evite le cours general sur le concept d EarthCache.';
    }
    if (verbosity === 'detailed') {
        return 'Action demandee: comprendre cette EarthCache. Explique le but geologique, les notions utiles, les indices du listing et les questions a se poser.';
    }
    return 'Action demandee: comprendre cette EarthCache. Resume le but geologique, les notions utiles et les questions a se poser.';
}

function buildVerbosityInstruction(verbosity: EarthCoachVerbosity): string[] {
    if (verbosity === 'compact') {
        return [
            '--- STYLE DE REPONSE ---',
            'Verbosite: compact.',
            'Pour le premier compte rendu, vise 5 puces maximum ou un tres court paragraphe.',
            'Commence par ce qui sert a comprendre le listing; n explique le concept general d EarthCache que si le listing le rend indispensable.',
        ];
    }
    if (verbosity === 'detailed') {
        return [
            '--- STYLE DE REPONSE ---',
            'Verbosite: detaillee.',
            'Tu peux developper davantage les notions geologiques utiles, tout en restant fonde sur le listing et les observations fournies.',
        ];
    }
    return [
        '--- STYLE DE REPONSE ---',
        'Verbosite: normale.',
        'Fais une synthese lisible et pratique, sans cours general inutile.',
    ];
}

export function buildEarthCoachPrompt(input: EarthCoachPromptInput): string {
    const verbosity = normalizeVerbosity(input.verbosity);
    const limits = PROMPT_LIMITS_BY_VERBOSITY[verbosity];
    const data = input.geocache;
    const description = sanitizeRichText(data.description_html || data.description_raw, limits.description);
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
        hints ? `Indices (extrait): ${truncateText(hints.trim(), limits.hints)}` : undefined,
        '',
        ...buildWaypointsBlock(data, limits),
        '',
        ...buildImagesBlock(input.images, limits),
        '',
        ...buildObservationsBlock(input.observations, limits, input.gcPersonalNote),
        '',
        '--- MODE EARTHCOACH ---',
        `Mode: ${input.mode}`,
        buildActionInstruction(input.action, input.mode, verbosity),
        '',
        ...buildVerbosityInstruction(verbosity),
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

export function selectEarthCoachImagesForChat(images: GeoImage[], limit = 5, preferredImageIds: string[] = []): GeoImage[] {
    if (preferredImageIds.length) {
        const byId = new Map<string, GeoImage>();
        for (const image of images) {
            if (!byId.has(image.id)) {
                byId.set(image.id, image);
            }
        }
        const seenPreferred = new Set<string>();
        return preferredImageIds
            .map(id => byId.get(id))
            .filter((image): image is GeoImage => Boolean(image))
            .filter(image => {
                const key = `${image.origin}:${image.id}:${image.fileUri}`;
                if (seenPreferred.has(key)) {
                    return false;
                }
                seenPreferred.add(key);
                return true;
            });
    }
    const priority: Record<GeoImage['origin'], number> = {
        user_observation: 0,
        cache_listing: 1,
        educational_reference: 2,
    };
    const seen = new Set<string>();
    return images
        .map((image, index) => ({ image, index }))
        .sort((left, right) => {
            const priorityDelta = priority[left.image.origin] - priority[right.image.origin];
            return priorityDelta || left.index - right.index;
        })
        .filter(({ image }) => {
            const key = `${image.origin}:${image.id}:${image.fileUri}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        })
        .slice(0, limit)
        .map(item => item.image);
}
