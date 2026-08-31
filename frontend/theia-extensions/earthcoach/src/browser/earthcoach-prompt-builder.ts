import {
    EarthCoachGeocacheData,
    EarthCoachMode,
    EarthCoachPromptInput,
    EarthCoachQuickAction,
    EarthCoachVerbosity,
    GeoImage,
    LoggingTask,
    UserObservation,
} from './earthcoach-types';

interface EarthCoachPromptLimits {
    description: number;
    hints: number;
    waypointNote: number;
    note: number;
    observation: number;
    loggingTaskText: number;
    waypoints: number;
    observations: number;
    loggingTasks: number;
    images: number;
}

const PROMPT_LIMITS_BY_VERBOSITY: Record<EarthCoachVerbosity, EarthCoachPromptLimits> = {
    compact: {
        description: 900,
        hints: 350,
        waypointNote: 120,
        note: 450,
        observation: 450,
        loggingTaskText: 300,
        waypoints: 5,
        observations: 5,
        loggingTasks: 10,
        images: 6,
    },
    normal: {
        description: 1800,
        hints: 700,
        waypointNote: 180,
        note: 800,
        observation: 800,
        loggingTaskText: 500,
        waypoints: 8,
        observations: 8,
        loggingTasks: 15,
        images: 10,
    },
    detailed: {
        description: 3200,
        hints: 1200,
        waypointNote: 260,
        note: 1200,
        observation: 1200,
        loggingTaskText: 800,
        waypoints: 12,
        observations: 12,
        loggingTasks: 25,
        images: 12,
    },
};

const LOGGING_TASK_STATUS_LABELS: Record<LoggingTask['status'], string> = {
    todo: 'a traiter',
    field: 'a observer sur le terrain',
    answered: 'repondu',
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

function clipText(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    }
    if (maxLength <= 3) {
        return value.substring(0, Math.max(0, maxLength));
    }
    return `${value.substring(0, maxLength - 3).trim()}...`;
}

// Balises de bloc: on insere un saut de ligne autour pour que le texte extrait
// garde la structure du listing (paragraphes, items de liste, cellules). Sans
// cela `textContent` colle `<p>a</p><p>b</p>` en "ab" et toute segmentation du
// listing devient impossible.
const BLOCK_LEVEL_TAG_PATTERN =
    /<\s*\/?\s*(?:p|div|br|hr|li|ul|ol|dl|dt|dd|tr|td|th|table|thead|tbody|section|article|header|footer|aside|main|blockquote|pre|h[1-6])\b[^>]*>/gi;

/** `textContent` remonte aussi le code des <script>/<style>: on les retire avant. */
function dropInertMarkup(value: string): string {
    return value
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ');
}

function insertBlockBreaks(value: string): string {
    return value.replace(BLOCK_LEVEL_TAG_PATTERN, match => `\n${match}\n`);
}

/** Entites les plus frequentes des listings, pour le chemin sans DOMParser. */
function decodeCommonEntities(value: string): string {
    return value
        .replace(/&nbsp;/gi, ' ')
        .replace(/&(?:quot|#34);/gi, '"')
        .replace(/&(?:apos|#39);/gi, "'")
        .replace(/&(?:lt|#60);/gi, '<')
        .replace(/&(?:gt|#62);/gi, '>')
        .replace(/&amp;/gi, '&');
}

function normalizePlainText(value: string): string {
    return value
        .replace(/\r\n?/g, '\n')
        .replace(/[^\S\n]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{2,}/g, '\n')
        .trim();
}

function stripHtml(value: string): string {
    // On evite `div.innerHTML = value`: assigner innerHTML declenche le
    // telechargement des <img src> du listing (requetes reseau vers
    // geocaching.com a chaque ouverture d'EarthCoach). DOMParser produit un
    // document inerte qui n'effectue aucun chargement de ressource.
    const withBreaks = insertBlockBreaks(dropInertMarkup(value));
    if (typeof DOMParser !== 'undefined') {
        const parsed = new DOMParser().parseFromString(withBreaks, 'text/html');
        return normalizePlainText(parsed.body.textContent || '');
    }
    return normalizePlainText(decodeCommonEntities(withBreaks.replace(/<[^>]+>/g, ' ')));
}

/**
 * Part du budget de description reservee au debut du listing (contexte
 * geologique). Le reste finance les passages porteurs de questions, qui dans
 * les EarthCaches se trouvent presque toujours a la fin.
 */
const DESCRIPTION_HEAD_RATIO = 0.55;
/** Longueur au-dela de laquelle un bloc est redecoupe en phrases. */
const DESCRIPTION_SEGMENT_MAX = 320;
/** En dessous, garder un fragment de plus n apporte plus rien d exploitable. */
const DESCRIPTION_MIN_SEGMENT = 80;
/** Marqueur insere a la place des passages omis, pour que le LLM voie les trous. */
export const DESCRIPTION_GAP_MARKER = '[...]';

/** Formulations qui annoncent la section "conditions de log" d une EarthCache. */
const STRONG_QUESTION_PATTERNS: RegExp[] = [
    /logging (?:task|requirement|condition)/,
    /requirements? (?:for|to) log/,
    /to (?:log|claim) (?:this|your|it)/,
    /pour (?:pouvoir |bien )?(?:logger|valider|enregistrer)/,
    /afin de (?:pouvoir )?(?:logger|valider)/,
    /conditions? de (?:validation|log)/,
    /questions? (?:a|du|de la|des|suivantes)/,
    /taches? de log/,
];

/** Vocabulaire de demande adressee au geocacheur. */
const QUESTION_PATTERNS: RegExp[] = [
    /\bquestions?\b/,
    /\brepond(?:re|ez|s)\b/,
    /\banswers?\b/,
    /\benvoy(?:ez|er)\b/,
    /\bsend\b/,
    /\b(?:e-?mail|courriel|message)\b/,
    /\bphotos?\b/,
];

/** Verbes de releve terrain: signal plus faible, un listing en contient partout. */
const MEASUREMENT_PATTERNS: RegExp[] = [
    /\bmesur/,
    /\bestim/,
    /\bdecri/,
    /\bdescribe\b/,
    /\bcombien\b/,
    /\bquels?\b/,
    /\bquelles?\b/,
    /\bhow (?:many|much|wide|high|long|old|deep)\b/,
    /\bwhat (?:is|are|colou?r|kind|type)\b/,
];

/** Puce ou numerotation en tete de bloc: forme habituelle des questions listees. */
const LIST_ITEM_PATTERN = /^(?:[-*•·●▪]|\(?\d{1,2}\)?\s*[.):\-–]|[a-h]\s*[.):])\s+/;

function countMatches(patterns: RegExp[], value: string): number {
    return patterns.reduce((total, pattern) => (pattern.test(value) ? total + 1 : total), 0);
}

/**
 * Accents et casse varient d un listing a l autre (et beaucoup sont en anglais):
 * on score sur une copie normalisee pour que les marqueurs restent simples.
 */
function foldForScoring(value: string): string {
    return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Score de "ce bloc porte une question du proprietaire", independant de sa position. */
function scoreQuestionMarkers(segment: string): number {
    const folded = foldForScoring(segment);
    let score = 0;
    score += 3 * countMatches(STRONG_QUESTION_PATTERNS, folded);
    score += 2 * countMatches(QUESTION_PATTERNS, folded);
    score += countMatches(MEASUREMENT_PATTERNS, folded);
    if (segment.includes('?')) {
        score += 2;
    }
    if (LIST_ITEM_PATTERN.test(segment)) {
        score += 2;
    }
    return score;
}

/** Score de selection: marqueurs + bonus de fin de listing, ou nichent les questions. */
function scoreSegment(segment: string, index: number, total: number): number {
    let score = scoreQuestionMarkers(segment);
    if (total > 1) {
        if (index / (total - 1) >= 0.7) {
            score += 1;
        }
        if (index === total - 1) {
            score += 1;
        }
    }
    return score;
}

function splitIntoSentences(value: string): string[] {
    const parts = value.split(/([.!?…]+["'»)\]]*\s+)/);
    const sentences: string[] = [];
    for (let index = 0; index < parts.length; index += 2) {
        const sentence = `${parts[index] || ''}${parts[index + 1] || ''}`.trim();
        if (sentence) {
            sentences.push(sentence);
        }
    }
    return sentences.length ? sentences : [value];
}

/**
 * Decoupe le listing en blocs exploitables: paragraphes issus du HTML, puis
 * regroupements de phrases pour les paragraphes trop longs. Un listing ecrit
 * d un seul tenant reste ainsi segmentable, ce qui est indispensable pour en
 * garder la fin.
 */
function segmentDescription(text: string): string[] {
    const segments: string[] = [];
    for (const block of text.split('\n')) {
        const trimmed = block.trim();
        if (!trimmed) {
            continue;
        }
        if (trimmed.length <= DESCRIPTION_SEGMENT_MAX) {
            segments.push(trimmed);
            continue;
        }
        let current = '';
        for (const sentence of splitIntoSentences(trimmed)) {
            if (current && current.length + 1 + sentence.length > DESCRIPTION_SEGMENT_MAX) {
                segments.push(current);
                current = sentence;
            } else {
                current = current ? `${current} ${sentence}` : sentence;
            }
        }
        if (current) {
            segments.push(current);
        }
    }
    return segments;
}

function assembleSegments(kept: Map<number, string>, total: number): { text: string; hasGaps: boolean } {
    const indexes = [...kept.keys()].sort((left, right) => left - right);
    const parts: string[] = [];
    let hasGaps = false;
    let previous = -1;
    for (const index of indexes) {
        if (index > previous + 1) {
            parts.push(DESCRIPTION_GAP_MARKER);
            hasGaps = true;
        }
        parts.push(kept.get(index) as string);
        previous = index;
    }
    if (previous >= 0 && previous < total - 1) {
        parts.push(DESCRIPTION_GAP_MARKER);
        hasGaps = true;
    }
    return { text: parts.join('\n'), hasGaps };
}

export interface EarthCoachDescriptionExcerpt {
    /** Texte a injecter dans le prompt, deja plafonne a la limite demandee. */
    text: string;
    /** Vrai si le listing complet ne tenait pas dans le budget. */
    truncated: boolean;
    /** Vrai si l extrait n est pas contigu (des DESCRIPTION_GAP_MARKER ont ete inseres). */
    hasGaps: boolean;
    /** Vrai si le listing contient des passages qui ressemblent aux questions du proprietaire. */
    questionSectionFound: boolean;
}

/**
 * Construit l extrait de description envoye au LLM.
 *
 * Une simple troncature en tete perd systematiquement les questions du
 * proprietaire, qui closent presque toujours un listing EarthCache: tant que
 * les logging tasks ne sont pas extraites, le modele ne les voit alors nulle
 * part. On garde donc le debut (contexte geologique) puis, sur le budget
 * restant, les blocs les mieux notes - marqueurs de question, listes
 * numerotees, fin du listing - reassembles dans l ordre du document.
 */
export function buildEarthCoachDescriptionExcerpt(value: string | undefined, maxLength: number): EarthCoachDescriptionExcerpt {
    const empty: EarthCoachDescriptionExcerpt = { text: '', truncated: false, hasGaps: false, questionSectionFound: false };
    if (!value) {
        return empty;
    }
    const plain = stripHtml(value);
    if (!plain) {
        return empty;
    }
    const segments = segmentDescription(plain);
    if (!segments.length) {
        return empty;
    }
    const questionSectionFound = segments.some(segment => scoreQuestionMarkers(segment) >= 3);

    const full = segments.join('\n');
    if (full.length <= maxLength) {
        return { text: full, truncated: false, hasGaps: false, questionSectionFound };
    }

    const kept = new Map<number, string>();
    let used = 0;

    // 1) Tete du listing: le contexte geologique y est presque toujours pose.
    const headBudget = Math.max(DESCRIPTION_MIN_SEGMENT, Math.round(maxLength * DESCRIPTION_HEAD_RATIO));
    for (let index = 0; index < segments.length; index++) {
        const separator = kept.size ? 1 : 0;
        const remaining = headBudget - used - separator;
        if (remaining <= 0) {
            break;
        }
        const segment = segments[index];
        if (segment.length <= remaining) {
            kept.set(index, segment);
            used += segment.length + separator;
            continue;
        }
        if (!kept.size) {
            // Listing dont le tout premier bloc depasse deja le budget de tete.
            kept.set(index, clipText(segment, remaining));
        }
        break;
    }

    // 2) Budget restant: les passages porteurs de questions, du mieux note au moins bien,
    //    a score egal le plus proche de la fin du listing.
    const candidates = segments
        .map((text, index) => ({ text, index, score: scoreSegment(text, index, segments.length) }))
        .filter(candidate => !kept.has(candidate.index) && candidate.score > 0)
        .sort((left, right) => right.score - left.score || right.index - left.index);

    // Le cout d un fragment depend des marqueurs de trou qu il fait apparaitre ou
    // disparaitre autour de lui: on le mesure sur un assemblage d essai plutot que
    // de l estimer, sinon un budget majore ecarte a tort les blocs courts et bien
    // notes (un intertitre "Pour valider cette EarthCache" par exemple).
    for (const candidate of candidates) {
        const trial = new Map(kept);
        trial.set(candidate.index, candidate.text);
        const trialLength = assembleSegments(trial, segments.length).text.length;
        if (trialLength <= maxLength) {
            kept.set(candidate.index, candidate.text);
            continue;
        }
        const room = maxLength - (trialLength - candidate.text.length);
        if (room >= DESCRIPTION_MIN_SEGMENT) {
            kept.set(candidate.index, clipText(candidate.text, room));
        }
    }

    // 3) Budget encore disponible (listing sans autre passage note): on prolonge le
    //    contexte dans l ordre du document plutot que de laisser de la place vide.
    for (let index = 0; index < segments.length; index++) {
        if (kept.has(index)) {
            continue;
        }
        const trial = new Map(kept);
        trial.set(index, segments[index]);
        if (assembleSegments(trial, segments.length).text.length <= maxLength) {
            kept.set(index, segments[index]);
        }
    }

    const assembled = assembleSegments(kept, segments.length);

    return {
        text: clipText(assembled.text, maxLength),
        truncated: true,
        hasGaps: assembled.hasGaps,
        questionSectionFound,
    };
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

function buildLoggingTasksBlock(
    loggingTasks: LoggingTask[],
    limits: EarthCoachPromptLimits,
    questionSectionFound: boolean
): string[] {
    if (!loggingTasks.length) {
        // Le listing contient visiblement les questions du proprietaire mais elles
        // ne sont pas encore structurees: on demande l extraction au premier usage
        // plutot que de laisser le modele repondre a cote.
        if (!questionSectionFound) {
            return [];
        }
        return [
            'Questions du proprietaire (logging tasks):',
            '- Aucune question n est encore enregistree dans GeoApp, mais le listing en contient (passages conserves ci-dessus).',
            '- Appelle d abord le tool earthcoach_extract_logging_tasks avec ces questions dans l ordre, sans en inventer ni y mettre de reponse, puis poursuis ta reponse.',
        ];
    }
    const ordered = [...loggingTasks].sort((left, right) => left.position - right.position);
    const lines = ['Questions du proprietaire (logging tasks):'];
    for (const task of ordered.slice(0, limits.loggingTasks)) {
        const flags = [
            LOGGING_TASK_STATUS_LABELS[task.status],
            task.requiresPhoto ? 'photo requise' : undefined,
            task.observationId ? `observation liee=${task.observationId}` : undefined,
        ].filter(Boolean).join('; ');
        lines.push(`- Q${task.position} [${flags}]: ${truncateText(task.question.replace(/\s+/g, ' '), limits.loggingTaskText)}`);
        if (task.guidance) {
            lines.push(`  A observer: ${truncateText(task.guidance.replace(/\s+/g, ' '), limits.loggingTaskText)}`);
        }
        if (task.answer) {
            lines.push(`  Reponse brouillon: ${truncateText(task.answer.replace(/\s+/g, ' '), limits.loggingTaskText)}`);
        }
    }
    if (ordered.length > limits.loggingTasks) {
        lines.push(`- ... ${ordered.length - limits.loggingTasks} question(s) supplementaire(s) non incluses.`);
    }
    return lines;
}

function buildResolverTemplateInstruction(loggingTasks: LoggingTask[]): string[] {
    const lines = [
        '--- GABARIT DE RESOLUTION ---',
        'Structure ta reponse question par question. Pour chaque question du proprietaire, fournis exactement ces champs:',
        '- Question: rappel court de la question.',
        '- Reponse proposee: uniquement si elle decoule des observations fournies, sinon "a completer sur le terrain".',
        '- Fondee sur: l observation precise (id ou date) ou la donnee du listing qui justifie la reponse; "aucune" si rien ne la fonde.',
        '- Confiance: elevee / moyenne / faible, selon la qualite des preuves disponibles.',
        '- A completer: ce qu il reste a mesurer ou observer sur place si une donnee manque.',
        'Ne fusionne jamais plusieurs questions. Ne fabrique aucune mesure ou observation manquante: laisse explicitement "a completer".',
    ];
    if (loggingTasks.length) {
        lines.push(`Traite les ${loggingTasks.length} question(s) listees ci-dessus, dans l ordre de leur numero.`);
    } else {
        lines.push('Aucune logging task structuree n est fournie: deduis les questions depuis le listing et applique le meme gabarit.');
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
    if (action === 'geology_context') {
        return 'Action demandee: situer le contexte geologique. Appelle earthcoach_geology_france si la cache est en France metropolitaine, sinon earthcoach_geology_at_point, avec les coordonnees decimales de la cache, puis resume lithologie, age et formation. Ajoute l altitude via earthcoach_elevation_at_point si elle eclaire le site. Cite la notice 1/50 000 quand le tool la fournit, et rappelle que c est une carte generale a confirmer sur le terrain.';
    }
    if (action === 'illustrate_term') {
        return 'Action demandee: illustrer un terme geologique. Utilise des references externes educational_reference si disponibles, puis precise que les images sont generiques.';
    }
    if (action === 'extract_logging_tasks') {
        return 'Action demandee: extraire les questions du proprietaire. Lis le listing et appelle le tool earthcoach_extract_logging_tasks avec les questions dans l ordre, sans en inventer ni y mettre de reponse. Confirme ensuite brievement le nombre de questions enregistrees.';
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
    const loggingTasks = input.loggingTasks || [];
    const descriptionExcerpt = buildEarthCoachDescriptionExcerpt(
        data.description_html || data.description_raw,
        limits.description
    );
    const description = descriptionExcerpt.text;
    const hints = getDecodedHints(data);
    const loggingTasksBlock = buildLoggingTasksBlock(
        loggingTasks,
        limits,
        descriptionExcerpt.questionSectionFound
    );
    const lines: string[] = [
        '--- CONTEXTE EARTHCACHE ---',
        `Nom: ${data.name}`,
        `ID: ${data.id}`,
        `Code: ${data.gc_code || 'Inconnu'} - Type: ${data.type || 'Inconnu'} - Taille: ${data.size || 'N/A'}`,
        `Difficulte / Terrain: ${data.difficulty ?? '?'} / ${data.terrain ?? '?'}`,
        `Proprietaire: ${data.owner || 'Inconnu'} - Statut: ${data.status || 'Inconnu'}`,
        `Coordonnees affichees: ${data.coordinates_raw || data.original_coordinates_raw || 'Non renseignees'}`,
        data.latitude != null && data.longitude != null
            ? `Coordonnees decimales: ${data.latitude}, ${data.longitude}`
            : undefined,
        data.placed_at ? `Placee le: ${data.placed_at}` : undefined,
        '',
        description
            ? `Description du listing (${
                descriptionExcerpt.hasGaps
                    ? `extrait cible, ${DESCRIPTION_GAP_MARKER} marque un passage omis`
                    : descriptionExcerpt.truncated ? 'extrait' : 'integrale'
            }):`
            : undefined,
        description || undefined,
        hints ? '' : undefined,
        hints ? `Indices (extrait): ${truncateText(hints.trim(), limits.hints)}` : undefined,
        '',
        ...buildWaypointsBlock(data, limits),
        '',
        ...buildImagesBlock(input.images, limits),
        '',
        ...buildObservationsBlock(input.observations, limits, input.gcPersonalNote),
        ...(loggingTasksBlock.length ? ['', ...loggingTasksBlock] : []),
        '',
        '--- MODE EARTHCOACH ---',
        `Mode: ${input.mode}`,
        buildActionInstruction(input.action, input.mode, verbosity),
        ...(input.mode === 'resolver' ? ['', ...buildResolverTemplateInstruction(loggingTasks)] : []),
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
