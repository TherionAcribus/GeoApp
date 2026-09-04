/**
 * Mise en forme du bundle d'analyse de sortie pour l'IA.
 *
 * Ce module ne produit que des **données** : l'instruction de tâche et le plan du rapport
 * vivent dans le prompt système de l'agent `geoapp-outing-analyzer`. La seule exception
 * est la ligne finale, qui rappelle la commande.
 *
 * Deux partis pris de rédaction :
 *
 * - **une section absente vaut mieux qu'une section vide** : « Hint : aucun » coûte des
 *   tokens et n'apprend rien ;
 * - **les drapeaux non résolus sont écrits en toutes lettres** (`NON RÉSOLU`), parce que
 *   c'est ce marqueur que le prompt système va chercher pour déclencher la recherche de
 *   l'outil précis dans le listing, le hint et les logs. Un drapeau que le backend a déjà
 *   refermé en balayant le listing ou le hint ne le porte donc pas : il annonce sa source
 *   à la place, pour que le rapport puisse la citer.
 *
 * Fonctions pures, sans dépendance Theia : testables telles quelles.
 */

import {
    OutingAnalysisBundle,
    OutingAnalysisGeocache,
    OutingDetailLevel,
    OutingGearSignal,
    OutingGeography,
    OutingHealthLevel,
    OutingLogExcerpt,
    OutingLoggingTask,
    OutingNote,
    OutingRoute,
    OutingSunTimes,
    OutingTimeBudget,
    OutingTimeEstimate,
    OutingWalkingCluster,
    OutingWaypoint,
} from './outing-analysis-types';

export interface OutingPromptContext {
    zoneName?: string;
    /** Date de la sortie, au format lisible. Par défaut, la date du jour. */
    outingDate?: string;
    detailLevel: OutingDetailLevel;
}

export interface OutingPromptSize {
    chars: number;
    approxTokens: number;
}

/**
 * Ratio caractères/token retenu pour le français, volontairement conservateur :
 * mieux vaut surestimer le coût et avertir un peu trop tôt que laisser partir un
 * prompt qui dépasse la fenêtre du modèle.
 */
const CHARS_PER_TOKEN = 3.6;

const HEALTH_LABELS: Record<OutingHealthLevel, string> = {
    ok: 'saine',
    watch: 'à surveiller',
    risky: 'risquée',
    very_risky: 'très risquée',
    unknown: 'inconnue (aucun log local)',
};

const SOLVED_LABELS: Record<string, string> = {
    solved: 'oui',
    in_progress: 'en cours',
    not_solved: 'non',
};

/** Nombre de logs récents conservés dans le prompt selon le niveau de détail. */
const RECENT_LOGS_IN_PROMPT: Record<OutingDetailLevel, number> = {
    light: 3,
    standard: 5,
    full: 10,
};

function isFilled(value: unknown): boolean {
    return value !== undefined && value !== null && String(value).trim() !== '';
}

function formatDate(iso: string | null | undefined): string {
    if (!isFilled(iso)) {
        return '';
    }
    // Les dates du bundle sont ISO : la partie calendaire suffit, l'heure n'apporte rien.
    return String(iso).slice(0, 10);
}

function formatNumber(value: number | null | undefined): string {
    return value === null || value === undefined ? '?' : String(value);
}

/** Une ligne « - Clé : valeur », omise si la valeur est vide. */
function bullet(label: string, value: unknown): string | undefined {
    return isFilled(value) ? `- ${label} : ${String(value).trim()}` : undefined;
}

/** Durée en heures et minutes : « 12 h 19 » se lit mieux que « 739 minutes ». */
function formatDuration(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    return `${hours} h ${`${minutes - hours * 60}`.padStart(2, '0')}`;
}

/**
 * Durée courte : « 45 min » sous l'heure, « 2 h 35 » au-delà.
 *
 * Une estimation par cache se lit en minutes, un budget de journée en heures. Basculer au
 * bon moment évite les « 395 min » qu'il faut diviser de tête devant son sac.
 */
function formatMinutes(minutes: number): string {
    return minutes < 60 ? `${minutes} min` : formatDuration(minutes);
}

function quoteBlock(text: string): string {
    return text
        .split('\n')
        .map(line => `  > ${line.trim()}`)
        .join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Blocs par géocache
// ─────────────────────────────────────────────────────────────────────────────

function formatIdentityLine(geocache: OutingAnalysisGeocache): string {
    const parts = [
        isFilled(geocache.type) ? `Type : ${geocache.type}` : undefined,
        isFilled(geocache.size) ? `Taille : ${geocache.size}` : undefined,
        `D ${formatNumber(geocache.difficulty)} / T ${formatNumber(geocache.terrain)}`,
        isFilled(geocache.favorites_count) ? `Favoris : ${geocache.favorites_count}` : undefined,
        isFilled(geocache.logs_count) ? `Logs : ${geocache.logs_count}` : undefined,
    ].filter(Boolean);
    return `- ${parts.join(' | ')}`;
}

const CONFIDENCE_LABELS: Record<string, string> = {
    high: 'confiance bonne',
    medium: 'confiance moyenne',
    low: 'confiance faible',
};

/**
 * Temps sur place estimé, avec le détail de son calcul.
 *
 * Le détail n'est pas décoratif : c'est ce qui autorise le modèle à **corriger** le
 * chiffre plutôt qu'à le recopier ou à l'ignorer. Voir qu'une multi coûte quarante-cinq
 * minutes dont vingt d'étapes présumées, c'est savoir exactement quel terme discuter quand
 * le listing dit que la multi en compte six.
 *
 * La ligne rappelle que le trajet n'y est pas : c'est la confusion la plus coûteuse d'un
 * budget de journée, et elle passerait inaperçue si on ne l'écrivait pas.
 */
function formatTimeEstimate(estimate: OutingTimeEstimate | undefined): string | undefined {
    // Tolérant à un backend plus ancien que le front : le bloc vient du réseau.
    if (!estimate) {
        return undefined;
    }
    const detail = (estimate.components || [])
        .map(component => `${component.label} ${component.minutes}`)
        .join(' + ');
    const confidence = CONFIDENCE_LABELS[estimate.confidence] || estimate.confidence;
    const why = estimate.confidence_reasons && estimate.confidence_reasons.length > 0
        ? ` — ${estimate.confidence_reasons.join(' ; ')}`
        : '';
    const capped = estimate.capped_park_and_grab ? ', plafonné park & grab' : '';

    return `- Temps sur place estimé (trajet exclu) : ${formatMinutes(estimate.minutes)} `
        + `(${estimate.low_minutes}–${estimate.high_minutes} min, ${confidence}${why})`
        + `${detail !== '' ? ` — calcul : ${detail}${capped}` : ''}`;
}

function formatStatusLine(geocache: OutingAnalysisGeocache): string {
    const solved = SOLVED_LABELS[geocache.solved || ''] || geocache.solved || 'inconnu';
    const coordinates = isFilled(geocache.coordinates)
        ? `${geocache.coordinates}${geocache.is_corrected ? ' (corrigées)' : ' (publiées)'}`
        : 'inconnues';
    return `- Statut : ${geocache.status || 'inconnu'} | Résolue : ${solved} | Coordonnées : ${coordinates}`;
}

/**
 * Alerte « déjà trouvée ».
 *
 * Une cache trouvée dans une sélection de sortie est le plus souvent une erreur de
 * sélection — mais pas toujours : on refait une multi, on accompagne quelqu'un. D'où une
 * alerte à confirmer, pas une exclusion silencieuse.
 */
function formatFoundLine(geocache: OutingAnalysisGeocache): string | undefined {
    if (!geocache.found) {
        return undefined;
    }
    const when = isFilled(geocache.found_date) ? ` le ${formatDate(geocache.found_date)}` : '';
    return `- ALERTE : géocache DÉJÀ TROUVÉE${when} — vérifier qu'elle a sa place dans la sortie.`;
}

function formatHealthLine(geocache: OutingAnalysisGeocache): string {
    const { level, reasons } = geocache.health;
    const label = HEALTH_LABELS[level] || level;
    const detail = reasons.length > 0 ? ` — ${reasons.join(' ; ')}` : '';
    return `- Santé : ${label}${detail}`;
}

/** D'où vient une pré-résolution, en toutes lettres pour que le rapport puisse la citer. */
const RESOLUTION_SOURCE_LABELS: Record<string, string> = {
    listing: 'le listing',
    hint: 'le hint',
};

/**
 * Ligne des signaux matériel.
 *
 * Trois rendus, pour trois états :
 *
 * - résolu par l'attribut : `flashlight (lampe / frontale)` ;
 * - résolu par le backend depuis le texte : `special_tool (résolu depuis le listing :
 *   fishing_rod)`. Le libellé d'origine (« nature à déterminer ») est abandonné — la
 *   nature *est* déterminée — mais la source est nommée, pour que l'IA la cite ;
 * - toujours ouvert : `(NON RÉSOLU)`, qui n'est pas cosmétique. C'est la consigne au
 *   modèle d'aller chercher l'outil précis dans le texte plutôt que de s'arrêter au
 *   drapeau.
 */
function formatGearSignals(signals: OutingGearSignal[]): string | undefined {
    const gear = signals.filter(signal => signal.kind === 'gear');
    if (gear.length === 0) {
        return undefined;
    }
    const rendered = gear.map(signal => {
        const source = RESOLUTION_SOURCE_LABELS[signal.resolved_from || ''];
        if (source && signal.resolved_gear && signal.resolved_gear.length > 0) {
            return `${signal.signal} (résolu depuis ${source} : ${signal.resolved_gear.join(', ')})`;
        }
        return signal.resolved
            ? `${signal.signal} (${signal.label})`
            : `${signal.signal} (NON RÉSOLU : ${signal.label})`;
    });
    return `- Signaux matériel : ${rendered.join(', ')}`;
}

/**
 * Matériel nommé dans le listing complet et dans le hint.
 *
 * Repérage lexical fait côté backend, sur le texte **entier** : il survit à la troncature
 * de l'extrait, et surtout à sa suppression. En mode léger, où aucun listing n'est
 * transmis, c'est la seule chose que l'IA saura du listing — pour quelques tokens.
 */
function formatGearMentions(geocache: OutingAnalysisGeocache): string | undefined {
    // Tolérant à un bundle plus ancien que le front : les champs viennent du réseau.
    const inListing = geocache.gear_mentions_in_listing || [];
    const inHint = geocache.gear_mentions_in_hint || [];
    const parts = [
        inListing.length > 0 ? `listing : ${inListing.join(', ')}` : undefined,
        inHint.length > 0 ? `hint : ${inHint.join(', ')}` : undefined,
    ].filter(Boolean);
    if (parts.length === 0) {
        return undefined;
    }
    return `- Matériel nommé dans le texte (repérage GeoApp) — ${parts.join(' ; ')}`;
}

function formatContextSignals(signals: OutingGearSignal[]): string | undefined {
    const context = signals.filter(signal => signal.kind === 'context');
    if (context.length === 0) {
        return undefined;
    }
    return `- Contexte : ${context.map(signal => signal.label).join(', ')}`;
}

function formatAttributes(geocache: OutingAnalysisGeocache): string | undefined {
    if (geocache.attributes.length === 0) {
        return undefined;
    }
    const rendered = geocache.attributes.map(
        attribute => (attribute.is_negative ? `NON ${attribute.label}` : attribute.label)
    );
    return `- Attributs : ${rendered.join(', ')}`;
}

/**
 * Un waypoint sur une ligne : identité, type, coordonnées, note.
 *
 * Les coordonnées sont l'information utile — un waypoint « Parking » sans coordonnées ne
 * mène nulle part, et le dire évite que le rapport promette un parking introuvable. Le
 * type est rendu parce qu'il porte du sens à lui seul (Parking Area, Trailhead, Stage).
 */
function formatWaypointLine(waypoint: OutingWaypoint): string {
    const identity = [waypoint.prefix, waypoint.name].filter(isFilled).join(' ').trim();
    const parts = [
        identity !== '' ? identity : 'waypoint sans nom',
        isFilled(waypoint.type) ? `[${waypoint.type}]` : undefined,
        isFilled(waypoint.coordinates) ? String(waypoint.coordinates) : 'coordonnées absentes',
        isFilled(waypoint.note_excerpt) ? `« ${waypoint.note_excerpt} »` : undefined,
    ].filter(Boolean);
    return `  > ${parts.join(' — ')}`;
}

function formatWaypoints(geocache: OutingAnalysisGeocache): string | undefined {
    if (geocache.waypoints_count === 0) {
        return undefined;
    }
    if (geocache.waypoints.length === 0) {
        return `- Waypoints : ${geocache.waypoints_count}`;
    }
    return [
        `- Waypoints (${geocache.waypoints_count}) :`,
        ...geocache.waypoints.map(formatWaypointLine),
    ].join('\n');
}

/**
 * Note personnelle geocaching.com.
 *
 * Rendue avant le listing, et volontairement : elle est plus courte, plus récente et
 * écrite par l'utilisateur lui-même. Quand elle dit « parking rue des Lilas », elle vaut
 * mieux que trois paragraphes de description.
 */
function formatPersonalNote(geocache: OutingAnalysisGeocache): string | undefined {
    if (!isFilled(geocache.personal_note)) {
        return undefined;
    }
    const suffix = geocache.personal_note_truncated ? ' (extrait tronqué)' : '';
    return `- Note personnelle${suffix} :\n${quoteBlock(String(geocache.personal_note))}`;
}

function formatNoteLine(note: OutingNote): string {
    const origin = [note.note_type, note.source_plugin || note.source].filter(isFilled).join(', ');
    const head = [formatDate(note.updated_at), origin].filter(isFilled).join(' — ');
    return `  > [${head}] « ${note.content_excerpt} »`;
}

function formatNotes(geocache: OutingAnalysisGeocache): string | undefined {
    if (geocache.notes.length === 0) {
        return undefined;
    }
    const omitted = geocache.notes_count - geocache.notes.length;
    const suffix = omitted > 0 ? ` (${omitted} note(s) plus ancienne(s) non reprise(s))` : '';
    return [
        `- Notes GeoApp${suffix} :`,
        ...geocache.notes.map(formatNoteLine),
    ].join('\n');
}

/**
 * Questions d'EarthCache.
 *
 * Ce sont les seules caches où la tâche se fait sur place sans rien à trouver : oublier
 * une observation oblige à revenir. Les questions déjà répondues sont marquées, pour que
 * le rapport n'en fasse pas une charge de travail qui n'existe plus.
 */
function formatLoggingTaskLine(task: OutingLoggingTask): string {
    const flags = [
        task.answered ? 'déjà répondue' : undefined,
        task.requires_photo ? 'PHOTO REQUISE' : undefined,
    ].filter(Boolean);
    const suffix = flags.length > 0 ? ` (${flags.join(', ')})` : '';
    const guidance = isFilled(task.guidance) ? ` — à observer : ${task.guidance}` : '';
    return `  > ${task.question}${guidance}${suffix}`;
}

function formatLoggingTasks(geocache: OutingAnalysisGeocache): string | undefined {
    if (geocache.logging_tasks.length === 0) {
        return undefined;
    }
    const photo = geocache.logging_tasks_photo_required ? ', appareil photo nécessaire' : '';
    return [
        `- Questions à répondre sur place (${geocache.logging_tasks_count}${photo}) :`,
        ...geocache.logging_tasks.map(formatLoggingTaskLine),
    ].join('\n');
}

/**
 * Qualité de la source d'un log, accolée à son en-tête.
 *
 * « ami » n'est pas décoratif : un conseil matériel venant de quelqu'un qu'on connaît se
 * pondère autrement qu'un log anonyme, et le rapport peut le citer comme tel.
 */
function formatLogOrigin(log: OutingLogExcerpt): string {
    const flags = [
        log.is_friend_log ? 'ami' : undefined,
        log.is_favorite ? 'favori' : undefined,
    ].filter(Boolean);
    return flags.length > 0 ? `, ${flags.join(', ')}` : '';
}

function formatLogLine(log: OutingLogExcerpt, options: { withType?: boolean; withMatched?: boolean }): string {
    const head = [formatDate(log.date), log.author].filter(isFilled).join(', ') + formatLogOrigin(log);
    const type = options.withType && isFilled(log.type) ? ` ${log.type} —` : '';
    const matched = options.withMatched && log.matched && log.matched.length > 0
        ? ` (matériel repéré : ${log.matched.join(', ')})`
        : '';
    return `  > [${head}]${type} « ${log.text_excerpt} »${matched}`;
}

function formatLogSection(
    title: string,
    logs: OutingLogExcerpt[],
    options: { withType?: boolean; withMatched?: boolean } = {}
): string | undefined {
    if (logs.length === 0) {
        return undefined;
    }
    return [`- ${title} :`, ...logs.map(log => formatLogLine(log, options))].join('\n');
}

function formatGeocacheBlock(
    geocache: OutingAnalysisGeocache,
    index: number,
    detailLevel: OutingDetailLevel
): string {
    const listing = geocache.listing_excerpt.trim();
    const showListing = detailLevel !== 'light' && listing !== '';
    const recentLimit = RECENT_LOGS_IN_PROMPT[detailLevel];

    const lines: Array<string | undefined> = [
        `### ${index}. ${geocache.gc_code} — ${geocache.name}`,
        formatIdentityLine(geocache),
        formatTimeEstimate(geocache.time_estimate),
        formatStatusLine(geocache),
        geocache.unsolved_mystery
            ? '- ALERTE : mystery non résolue, les coordonnées publiées ne sont pas les bonnes.'
            : undefined,
        formatFoundLine(geocache),
        formatHealthLine(geocache),
        formatAttributes(geocache),
        formatGearSignals(geocache.gear_signals),
        formatGearMentions(geocache),
        formatContextSignals(geocache.gear_signals),
        formatWaypoints(geocache),
        bullet('Hint', geocache.hint),
        // Les trois sources écrites par l'utilisateur passent avant le listing : elles
        // sont plus courtes, plus récentes, et souvent seules à porter l'information.
        formatPersonalNote(geocache),
        formatNotes(geocache),
        formatLoggingTasks(geocache),
        showListing
            ? `- Listing${geocache.listing_truncated ? ' (extrait tronqué)' : ''} :\n${quoteBlock(listing)}`
            : undefined,
        formatLogSection('Logs mentionnant du matériel', geocache.gear_logs, { withMatched: true }),
        formatLogSection('Logs suggérant une recherche longue', geocache.search_effort_logs),
        formatLogSection('Logs récents', geocache.recent_logs.slice(0, recentLimit), { withType: true }),
    ];

    return lines.filter(Boolean).join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// En-tête
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Section « Fiabilité des données ».
 *
 * Elle passe **avant** les géocaches, pour que le modèle sache ce qu'il ne sait pas
 * avant de lire quoi que ce soit. Sans cette précaution, une cache sans logs se lit
 * comme une cache sans problème.
 */
function formatReliabilitySection(bundle: OutingAnalysisBundle): string | undefined {
    const lines: string[] = [];

    if (bundle.without_local_logs.length > 0) {
        lines.push(
            `- ${bundle.without_local_logs.length} géocache(s) sans logs locaux : `
            + `${bundle.without_local_logs.join(', ')}. Leur santé n'est PAS évaluable et aucune `
            + `information de log n'est disponible pour elles. N'en tire aucune conclusion.`
        );
    }

    if (bundle.stats.unsolved_mysteries > 0) {
        const unsolved = bundle.geocaches
            .filter(geocache => geocache.unsolved_mystery)
            .map(geocache => geocache.gc_code);
        lines.push(
            `- ${bundle.stats.unsolved_mysteries} mystery(s) non résolue(s) : ${unsolved.join(', ')}. `
            + `Sans coordonnées corrigées, s'y déplacer ne sert à rien.`
        );
    }

    if (bundle.stats.unresolved_gear_signals > 0) {
        lines.push(
            `- ${bundle.stats.unresolved_gear_signals} drapeau(x) matériel NON RÉSOLU(S) : `
            + `l'attribut signale un besoin sans dire lequel. Cherche l'objet précis dans le `
            + `listing, le hint et les logs, et dis-le clairement quand tu ne le trouves pas.`
        );
    }

    if (bundle.stats.presolved_gear_signals > 0) {
        lines.push(
            `- ${bundle.stats.presolved_gear_signals} drapeau(x) matériel déjà refermé(s) par `
            + `GeoApp : l'objet est nommé dans le listing ou le hint, repéré par balayage du `
            + `texte complet. Reprends-les comme CONFIRMÉS en citant cette source — y compris `
            + `en mode léger, où le listing lui-même ne t'est pas transmis.`
        );
    }

    if (bundle.stale_logs.length > 0) {
        lines.push(
            `- ${bundle.stale_logs.length} géocache(s) dont les logs locaux sont périmés : `
            + `${bundle.stale_logs.join(', ')}. Leur santé décrit un passé arrêté à la date de `
            + `collecte, pas l'état d'aujourd'hui. Traite-la comme une indication, pas comme un fait.`
        );
    }

    if (bundle.already_found.length > 0) {
        lines.push(
            `- ${bundle.already_found.length} géocache(s) DÉJÀ TROUVÉE(S) dans la sélection : `
            + `${bundle.already_found.join(', ')}. Signale-les d'emblée : c'est le plus souvent `
            + `une erreur de sélection, à retirer ou à confirmer avant de partir.`
        );
    }

    if (bundle.missing.length > 0) {
        lines.push(
            `- ${bundle.missing.length} géocache(s) demandée(s) mais introuvable(s) en base : `
            + `elles ne figurent pas ci-dessous.`
        );
    }

    if (lines.length === 0) {
        return undefined;
    }

    return ['## Fiabilité des données', ...lines].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Géographie et lumière du jour
// ─────────────────────────────────────────────────────────────────────────────

const EXCLUSION_LABELS: Record<string, string> = {
    no_coordinates: 'aucune coordonnée en base',
    unsolved_mystery: 'mystery non résolue, coordonnées publiées trompeuses',
};

function formatExtent(geography: OutingGeography): string | undefined {
    const box = geography.bounding_box;
    if (!box) {
        return undefined;
    }
    const spread = geography.max_pair_distance_km;
    const between = spread !== null && spread !== undefined
        ? ` — ${spread} km entre les deux caches les plus éloignées`
        : '';
    return `- Étendue : ${box.width_km} km d'est en ouest sur ${box.height_km} km du nord au sud${between}`;
}

function formatExclusions(geography: OutingGeography): string | undefined {
    if (geography.excluded.length === 0) {
        return undefined;
    }
    const rendered = geography.excluded.map(
        item => `${item.gc_code} (${EXCLUSION_LABELS[item.reason] || item.reason})`
    );
    return `- ${geography.excluded.length} géocache(s) hors du calcul géographique : ${rendered.join(', ')}`;
}

/**
 * Ordre de visite.
 *
 * Rendu comme une proposition et non comme un itinéraire : l'heuristique est nommée, et
 * la mention « à vol d'oiseau » revient. Le modèle est libre de le réordonner — il en
 * sait plus que le calcul sur les contraintes horaires, la cache de nuit ou la marée —
 * mais il part d'un ordre cohérent au lieu de l'ordre de sélection.
 */
function formatRoute(route: OutingRoute | null): string | undefined {
    if (!route || route.legs.length === 0) {
        return undefined;
    }
    const lines = route.legs.map(leg => {
        const identity = [leg.gc_code, leg.name].filter(isFilled).join(' — ');
        const step = leg.position === 1
            ? 'départ'
            : `+${leg.leg_km} km, cumul ${leg.cumulative_km} km`;
        return `  > ${leg.position}. ${identity} (${step})`;
    });
    return [
        `- Ordre de visite indicatif (plus proche voisin optimisé, ${route.total_km} km cumulés `
        + `à vol d'oiseau, plus longue étape ${route.longest_leg_km} km) :`,
        ...lines,
    ].join('\n');
}

function formatWalkingClusters(clusters: OutingWalkingCluster[]): string | undefined {
    if (!clusters || clusters.length === 0) {
        return undefined;
    }
    const lines = clusters.map(
        cluster => `  > ${cluster.gc_codes.join(', ')} (${cluster.count} caches, `
            + `${cluster.span_km} km d'un bout à l'autre)`
    );
    return [
        '- Groupes enchaînables à pied depuis un même stationnement (moins de 400 m entre voisines) :',
        ...lines,
    ].join('\n');
}

/**
 * Lumière du jour.
 *
 * C'est la contrainte qui borne toute la sortie : elle décide du nombre de caches
 * réalisables, de la place de la cache de nuit dans la journée, et du statut de la
 * frontale — accessoire ou outil principal.
 */
function formatSun(sun: OutingSunTimes | null): string | undefined {
    if (!sun) {
        return undefined;
    }
    const zone = `heure locale, UTC${sun.utc_offset}`;

    if (sun.polar_state) {
        const phenomenon = sun.polar_state === 'polar_day'
            ? 'le soleil ne se couche pas de la journée'
            : 'le soleil ne se lève pas de la journée';
        return `- Lumière du jour le ${sun.date} : ${phenomenon} à cette latitude.`;
    }

    const parts = [
        isFilled(sun.sunrise_local) ? `lever ${sun.sunrise_local}` : undefined,
        isFilled(sun.sunset_local) ? `COUCHER ${sun.sunset_local}` : undefined,
        isFilled(sun.civil_dusk_local) ? `nuit noire vers ${sun.civil_dusk_local}` : undefined,
    ].filter(Boolean);
    const length = sun.day_length_minutes !== null && sun.day_length_minutes !== undefined
        ? ` — ${formatDuration(sun.day_length_minutes)} de jour`
        : '';

    return `- Lumière du jour le ${sun.date} : ${parts.join(', ')} (${zone})${length}.`;
}

/**
 * Section géographique.
 *
 * Elle passe avant les fiches : savoir que la sortie tient dans deux kilomètres carrés,
 * ou au contraire qu'elle en traverse trente, change la lecture de chaque cache qui suit.
 *
 * La dernière ligne n'est pas une précaution de style. Une distance à vol d'oiseau prise
 * pour une distance de marche fausse toute la planification, et c'est l'erreur que le
 * modèle commettrait spontanément.
 */
function formatGeographySection(bundle: OutingAnalysisBundle): string | undefined {
    // Tolérant à un backend plus ancien que le front : le bloc vient du réseau.
    const geography = bundle.geography;
    if (!geography) {
        return undefined;
    }

    const lines = [
        formatExtent(geography),
        formatExclusions(geography),
        formatRoute(geography.route),
        formatWalkingClusters(geography.walking_clusters),
        formatSun(geography.sun),
    ].filter(Boolean) as string[];

    if (lines.length === 0) {
        return undefined;
    }

    if (geography.route || geography.max_pair_distance_km !== null) {
        lines.push(
            "- Toutes ces distances sont à VOL D'OISEAU, calculées par GeoApp : ni route, ni "
            + 'sentier, ni dénivelé. Le trajet réel est toujours plus long. La seule conversion '
            + "en durée est celle de la section « Temps estimé », qui applique un facteur de "
            + "détour annoncé : reprends-la, n'en fabrique pas une autre."
        );
    }

    return ['## Géographie et lumière du jour', ...lines].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Budget temps
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ligne de trajet, avec ses hypothèses écrites.
 *
 * C'est le seul endroit du prompt où une distance à vol d'oiseau se transforme en durée.
 * Le facteur de détour et les vitesses sont donnés en clair pour que le modèle puisse les
 * discuter — « 45 km/h, c'est optimiste pour la montagne » est une remarque utile ; une
 * durée sans hypothèse ne se discute pas, elle se croit ou se jette.
 */
function formatTravel(budget: OutingTimeBudget): string | undefined {
    const travel = budget.travel;
    if (!travel) {
        return undefined;
    }
    const walking = travel.walking_minutes > 0
        ? `, plus ${travel.walking_km_estimated} km à pied (${travel.walking_minutes} min)`
        : '';
    const { driving_speed_kmh, road_detour_factor, stop_overhead_minutes } = travel.assumptions;

    return `- Trajet estimé : ${formatMinutes(travel.minutes)} pour ${travel.legs_count} étape(s) — `
        + `${travel.road_km_estimated} km de route (${travel.crow_flies_km} km à vol d'oiseau `
        + `× ${road_detour_factor}) à ${driving_speed_kmh} km/h, ${travel.driving_stops} arrêt(s) `
        + `à ${stop_overhead_minutes} min${walking}.`;
}

/**
 * Section « Temps estimé ».
 *
 * Elle existe parce qu'un modèle qui chiffre des durées au fil du texte se contredit d'une
 * cache à l'autre : trente minutes pour une T4 ici, dix pour une T4 là. Les durées sont
 * donc calculées avant, par la même grille pour toutes les caches, et le modèle n'a plus
 * qu'à les ajuster — ce qu'on lui demande explicitement, à condition qu'il dise pourquoi.
 *
 * Placée après la géographie et avant les fiches : le budget de la journée décide de ce
 * qu'on lit ensuite comme « faisable » ou « à sacrifier ».
 */
function formatTimeBudgetSection(bundle: OutingAnalysisBundle): string | undefined {
    // Tolérant à un backend plus ancien que le front : le bloc vient du réseau.
    const budget = bundle.time_budget;
    if (!budget || budget.geocaches_count === 0) {
        return undefined;
    }

    const lines: Array<string | undefined> = [
        `- Temps sur place, ${budget.geocaches_count} cache(s) : ${formatMinutes(budget.on_site_minutes)} `
        + `(fourchette ${formatMinutes(budget.on_site_low_minutes)} – `
        + `${formatMinutes(budget.on_site_high_minutes)})`,
        formatTravel(budget),
        `- TOTAL : ${formatMinutes(budget.total_minutes)} `
        + `(fourchette ${formatMinutes(budget.total_low_minutes)} – `
        + `${formatMinutes(budget.total_high_minutes)})`
        + `${budget.includes_travel ? '' : ", sans trajet — l'ordre de visite n'est pas calculable"}.`,
    ];

    // Retranchements proposés, jamais appliqués : c'est à l'utilisateur de décider s'il
    // retire une cache déjà trouvée ou une mystery qu'il résoudra peut-être ce soir.
    const deductions = [
        budget.already_found_minutes > 0
            ? `${formatMinutes(budget.already_found_minutes)} sur des caches déjà trouvées`
            : undefined,
        budget.unsolved_mystery_minutes > 0
            ? `${formatMinutes(budget.unsolved_mystery_minutes)} sur des mystery non résolues`
            : undefined,
    ].filter(Boolean);
    if (deductions.length > 0) {
        lines.push(
            `- Dont ${deductions.join(' et ')} : à retrancher si ces caches sortent de la sortie.`
        );
    }

    if (budget.heaviest.length > 0) {
        const rendered = budget.heaviest.map(
            item => `${item.gc_code} (${formatMinutes(item.minutes)})`
        );
        lines.push(`- Les plus chronophages : ${rendered.join(', ')}`);
    }

    lines.push(
        `- Ces durées viennent d'une heuristique GeoApp (${budget.method}) appliquée à toutes `
        + 'les caches de la même façon : type, D/T, marche annoncée, étapes, logs de recherche '
        + 'longue, questions sur place. Elles ne comptent ni pause, ni repas, ni imprévu, et '
        + "ignorent le dénivelé. Ajuste-les quand tu as mieux, en disant sur quoi tu t'appuies."
    );

    return ['## Temps estimé', ...(lines.filter(Boolean) as string[])].join('\n');
}

function formatHeader(bundle: OutingAnalysisBundle, context: OutingPromptContext): string {
    const zone = context.zoneName?.trim() || 'sélection';
    const count = bundle.geocaches.length;
    // La date retenue par le backend fait foi en second : c'est elle qui a servi au calcul
    // solaire, et une divergence entre l'en-tête et le coucher du soleil serait illisible.
    const outingDate = context.outingDate?.trim()
        || bundle.outing_date
        || formatDate(bundle.generated_at);

    return [
        `# Analyse de sortie — ${zone} — ${count} géocache(s)`,
        `Date de la sortie : ${outingDate}`,
        `Données extraites le : ${formatDate(bundle.generated_at)}`,
        `Niveau de détail : ${context.detailLevel}`,
    ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// API publique
// ─────────────────────────────────────────────────────────────────────────────

export function buildOutingAnalysisPrompt(
    bundle: OutingAnalysisBundle,
    context: OutingPromptContext
): string {
    const sections: Array<string | undefined> = [
        formatHeader(bundle, context),
        formatReliabilitySection(bundle),
        formatGeographySection(bundle),
        formatTimeBudgetSection(bundle),
    ];

    if (bundle.geocaches.length > 0) {
        sections.push('## Géocaches');
        bundle.geocaches.forEach((geocache, position) => {
            sections.push(formatGeocacheBlock(geocache, position + 1, context.detailLevel));
        });
    } else {
        sections.push('## Géocaches\n\nAucune géocache exploitable dans cette sélection.');
    }

    sections.push('Produis le rapport de préparation de sortie selon ton format.');

    return sections.filter(Boolean).join('\n\n');
}

/**
 * Taille du prompt, pour avertir avant l'envoi.
 *
 * L'estimation de tokens est approximative par construction — chaque modèle a son
 * tokenizer. Elle sert à repérer un ordre de grandeur problématique, pas à décider.
 */
export function estimateOutingPromptSize(prompt: string): OutingPromptSize {
    const chars = prompt.length;
    return { chars, approxTokens: Math.ceil(chars / CHARS_PER_TOKEN) };
}
