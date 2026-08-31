import { EarthCoachContext } from './earthcoach-context-service';

export interface EarthCoachFieldChecklistSection {
    title: string;
    items: string[];
}

export interface EarthCoachFieldChecklist {
    title: string;
    subtitle: string;
    /** Reference stable de la cache (code GC sinon id GeoApp): stockage local et nom de fichier exporte. */
    reference: string;
    meta: string[];
    sections: EarthCoachFieldChecklistSection[];
}

function stripHtml(value?: string): string {
    if (!value) {
        return '';
    }
    return value
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();
}

function truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    }
    return `${value.slice(0, maxLength).trim()}...`;
}

function extractQuestions(text: string): string[] {
    const normalized = text.replace(/\s+/g, ' ');
    const matches = normalized.match(/[^.!?]*\?/g) || [];
    return matches
        .map(question => question.trim())
        .filter(question => question.length > 8)
        .slice(0, 6)
        .map(question => truncate(question, 220));
}

function unique(items: string[]): string[] {
    return [...new Set(items.map(item => item.trim()).filter(Boolean))];
}

export function buildEarthCoachFieldChecklist(context: EarthCoachContext): EarthCoachFieldChecklist {
    const geocache = context.geocacheData;
    const description = stripHtml(geocache.description_html || geocache.description_raw);
    const hints = stripHtml(geocache.hints_decoded_override || geocache.hints_decoded || geocache.hints);
    const questions = extractQuestions(`${description} ${hints}`);
    const waypoints = geocache.waypoints || [];
    const listingImageCount = context.images.filter(image => image.origin === 'cache_listing').length;
    const userImageCount = context.images.filter(image => image.origin === 'user_observation').length;

    const observe = unique([
        'Nature de la roche ou du sol visible sur place.',
        'Couleur dominante et variations de couleur.',
        'Texture : grains, cristaux, couches, cassures, porosite.',
        'Presence possible de fossiles, coquilles, mineraux ou inclusions.',
        'Organisation du paysage : relief, affleurement, erosion, pente, faille ou strates.',
        listingImageCount > 0 ? 'Comparer prudemment avec les images du listing sans les traiter comme vos observations.' : '',
    ]);

    const measure = unique([
        'Dimensions utiles : hauteur, largeur, epaisseur ou distance approximative si le listing le demande.',
        'Orientation ou direction visible : pente, alignement, stratification, fracture.',
        'Position : waypoint, point d observation, coordonnees ou repere local.',
        'Echelle de vos photos : objet, main, carnet ou repere stable.',
    ]);

    const photograph = unique([
        'Vue generale du site pour replacer l observation dans le paysage.',
        'Gros plan de la roche, texture, strate, fossile ou mineral pertinent.',
        'Photo avec echelle si une taille ou epaisseur doit etre estimee.',
        'Photo distincte pour chaque point d observation important.',
        userImageCount > 0 ? 'Verifier que vos photos utilisateur sont bien separees des images du listing.' : '',
    ]);

    const loggingTasks = [...(context.loggingTasks || [])].sort((left, right) => left.position - right.position);
    const questionsSection = loggingTasks.length
        ? loggingTasks.map(task => {
            const flags = [
                task.requiresPhoto ? 'photo requise' : '',
                task.status === 'answered' ? 'deja repondu' : '',
            ].filter(Boolean).join(', ');
            return `Q${task.position}: ${truncate(task.question.replace(/\s+/g, ' '), 220)}${flags ? ` (${flags})` : ''}`;
        })
        : questions.length
            ? questions
            : ['Relire les questions du listing sur place et noter les donnees exactes qu elles demandent.'];

    const waypointsSection = waypoints.length
        ? waypoints.slice(0, 8).map(waypoint => {
            const name = [waypoint.prefix, waypoint.lookup, waypoint.name].filter(Boolean).join(' / ') || 'Waypoint';
            const coords = waypoint.gc_coords || (
                waypoint.latitude != null && waypoint.longitude != null
                    ? `${waypoint.latitude.toFixed(5)}, ${waypoint.longitude.toFixed(5)}`
                    : ''
            );
            return `${name}${waypoint.type ? ` (${waypoint.type})` : ''}${coords ? ` - ${coords}` : ''}`;
        })
        : ['Aucun waypoint specifique fourni dans le contexte EarthCoach.'];

    const notForget = unique([
        'Noter uniquement ce que vous observez vraiment sur place.',
        'Separer observation, interpretation et hypothese dans vos notes.',
        'Ne pas transformer une image pedagogique en preuve terrain.',
        'Ne pas supposer qu une image du listing correspond exactement a votre observation.',
        'Ajouter une note GeoApp apres la visite avec vos mesures, photos et incertitudes.',
    ]);

    return {
        title: geocache.name,
        subtitle: `${geocache.gc_code || 'Code GC inconnu'} - EarthCoach terrain`,
        reference: geocache.gc_code || String(geocache.id),
        meta: [
            `ID GeoApp: ${geocache.id}`,
            `D/T: ${geocache.difficulty ?? '?'} / ${geocache.terrain ?? '?'}`,
            `Coordonnees: ${geocache.coordinates_raw || geocache.original_coordinates_raw || 'non renseignees'}`,
            `Images listing: ${listingImageCount} - Photos utilisateur: ${userImageCount}`,
            `Observations deja notees: ${context.observations.length}`,
        ],
        sections: [
            { title: 'A observer', items: observe },
            { title: 'A mesurer ou estimer', items: measure },
            { title: 'A photographier', items: photograph },
            { title: 'Questions du listing', items: questionsSection },
            { title: 'Waypoints et reperes', items: waypointsSection },
            { title: 'A ne pas oublier', items: notForget },
        ],
    };
}

/**
 * Cle stable d'un item de checklist (section + texte). Widget et formateur
 * Markdown doivent utiliser la meme cle pour s'accorder sur l'etat coche.
 */
export function fieldChecklistItemKey(sectionTitle: string, item: string): string {
    return `${sectionTitle}\u0000${item}`;
}

export function formatEarthCoachFieldChecklistMarkdown(
    checklist: EarthCoachFieldChecklist,
    checkedKeys?: ReadonlySet<string>
): string {
    const lines = [
        `# ${checklist.title}`,
        '',
        checklist.subtitle,
        '',
        ...checklist.meta.map(item => `- ${item}`),
        '',
    ];
    for (const section of checklist.sections) {
        lines.push(`## ${section.title}`);
        lines.push('');
        lines.push(...section.items.map(item => {
            const mark = checkedKeys?.has(fieldChecklistItemKey(section.title, item)) ? 'x' : ' ';
            return `- [${mark}] ${item}`;
        }));
        lines.push('');
    }
    return lines.join('\n').trim();
}

function slugifyForFileName(value: string, maxLength: number): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, maxLength)
        .replace(/-+$/g, '');
}

function formatLocalDateStamp(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Nom de fichier propose lors de l'export terrain : prefixe stable, reference
 * de la cache (code GC sinon id GeoApp, sinon titre) et date locale de sortie.
 * Volontairement pur pour rester testable et identique d'un export a l'autre.
 */
export function buildEarthCoachFieldChecklistFileName(
    checklist: EarthCoachFieldChecklist,
    date: Date = new Date()
): string {
    const referenceSlug = slugifyForFileName(checklist.reference || '', 40);
    // Une cache sans code GC retombe sur son id GeoApp : on le prefixe pour que
    // le fichier reste lisible hors de l'application.
    const reference = /^[0-9]+$/.test(referenceSlug)
        ? `geoapp-${referenceSlug}`
        : referenceSlug || slugifyForFileName(checklist.title || '', 40) || 'earthcache';
    return `earthcoach-terrain-${reference}-${formatLocalDateStamp(date)}.md`;
}
