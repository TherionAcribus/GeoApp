/**
 * File « Loguer / Découvrir » du widget Trackables (lot 5.2) : logique pure.
 *
 * Le champ multi-codes accepte un collage libre — codes de suivi, codes publics
 * TB…, URLs `coord.info` ou `?tracker=` — qui est dédoublonné puis résolu par
 * `POST /api/trackables/lookup` (jamais de code en URL). Chaque élément porte
 * un état `pending → ready → submitting → confirmed | rejected | unknown`
 * (« unknown » = résultat distant ambigu : à vérifier, jamais renvoyé à l'aveugle).
 *
 * Règle de secret : `inputCode` et le code de suivi saisi ne sont JAMAIS
 * persistés — `sanitizeQueueForStorage` les retire ; le code de suivi vit en
 * mémoire ou dans la base du backend (après un lookup réussi).
 */

/** Types de log TB côté Geocaching.com (miroir de `TrackableLogType` backend). */
export const TRACKABLE_LOG_TYPE_IDS = {
    NOTE: 4,
    RETRIEVED: 13,
    DROPPED_OFF: 14,
    GRABBED: 19,
    DISCOVERED: 48,
    VISITED: 75,
} as const;

/** Libellés de repli quand `log-info` n'a pas fourni `allowed_log_types`. */
export const TRACKABLE_LOG_TYPE_FALLBACK_LABELS: Record<number, string> = {
    4: 'Note',
    5: 'Archivé',
    13: 'Retiré de la cache',
    14: 'Déposé',
    16: 'Transféré',
    19: 'Pris ailleurs',
    48: 'Découvert',
    74: 'Marqué manquant',
    75: 'Visité',
};

/** Seuls les logs « Note » se passent du code de suivi côté site. */
export function trackableLogTypeNeedsTrackingCode(logTypeId: number | undefined): boolean {
    return logTypeId !== undefined && logTypeId !== TRACKABLE_LOG_TYPE_IDS.NOTE;
}

/** Types exigeant une cache cible (miroir de TRACKABLE_LOG_TYPES_NEEDING_GEOCACHE backend). */
const TRACKABLE_LOG_TYPES_NEEDING_GEOCACHE = new Set<number>([TRACKABLE_LOG_TYPE_IDS.RETRIEVED]);

export function trackableLogTypeNeedsGeocache(logTypeId: number | undefined): boolean {
    return logTypeId !== undefined && TRACKABLE_LOG_TYPES_NEEDING_GEOCACHE.has(logTypeId);
}

/**
 * Types proposés quand `log-info` n'a pas répondu : la sélection courante du
 * site. Le backend revalide avant tout envoi — ces choix ne sont pas acquis.
 */
export const TRACKABLE_LOG_TYPE_FALLBACK_CHOICES: readonly { id: number; label: string }[] = [
    TRACKABLE_LOG_TYPE_IDS.NOTE,
    TRACKABLE_LOG_TYPE_IDS.RETRIEVED,
    TRACKABLE_LOG_TYPE_IDS.DROPPED_OFF,
    TRACKABLE_LOG_TYPE_IDS.GRABBED,
    TRACKABLE_LOG_TYPE_IDS.DISCOVERED,
    TRACKABLE_LOG_TYPE_IDS.VISITED,
].map(id => ({ id, label: TRACKABLE_LOG_TYPE_FALLBACK_LABELS[id] ?? `Type ${id}` }));

export type TrackableQueueStatus =
    | 'pending'      // code analysé, lookup pas encore tenté
    | 'preflight'    // lookup / log-info en cours
    | 'ready'        // résolu — envoi possible (code de suivi éventuellement à saisir)
    | 'submitting'   // POST en cours
    | 'confirmed'    // le site a confirmé (succès ou réconciliation)
    | 'rejected'     // refus net du site ou coupure AVANT réponse (réessai possible)
    | 'unknown'      // coupure au résultat ambigu : vérifier sur le site, ne pas renvoyer
    | 'error';       // lookup impossible, code invalide, code à ressaisir

export interface TrackableQueueItem {
    /** Identité stable de l'élément (clé React et persistance) — jamais un code. */
    key: string;
    /** Code saisi tel quel — peut être un code de suivi : jamais persisté ni affiché en clair. */
    inputCode: string;
    /** Code public résolu par le lookup. */
    reference_code?: string;
    name?: string | null;
    owner_username?: string | null;
    current_geocache_code?: string | null;
    current_geocache_name?: string | null;
    /** Le backend connaît le code de suivi (inventaire, ou lookup réussi sur le code de suivi). */
    has_tracking_code?: boolean;
    /** Types autorisés par la page de log du TB (relecture distante). */
    allowed_log_types?: { id: number; label: string }[];
    logTypeId?: number;
    /** Cache visée par un « Retiré » (préremplie depuis la fiche cache du lot 4). */
    geocacheCode?: string;
    /** Le backend a refusé par conflit de localisation — bouton « Confirmer » affiché. */
    locationConflictPending?: boolean;
    /** L'utilisateur a confirmé le conflit de localisation (409 du backend). */
    locationConflictConfirmed?: boolean;
    status: TrackableQueueStatus;
    /** Détail lisible : message d'erreur, « déjà en cours », « interrompu »… */
    statusDetail?: string;
    /** Lien direct vers la fiche quand le résultat distant est ambigu. */
    trackable_url?: string;
}

/* ---------------------------------------------------------------------------
 * Analyse du collage multi-codes
 * ------------------------------------------------------------------------- */

/** Codes publics : TB + suite sans I, L, O, S, U (TravelBugConnector). */
const TB_PUBLIC_CODE_RE = /\bTB[0-9A-HJKMNPQRTV-Z]+\b/gi;
/**
 * Paramètres d'URL porteurs d'un code : `tracker=` (code de suivi) et
 * `coord.info/` (code public, repris aussi par le motif TB ci-dessous).
 */
const URL_CODE_RE = /(?:tracker=|coord\.info\/)([A-Z0-9]{3,15})/gi;
/**
 * Jetons libres plausibles pour un code de suivi : 4–10 caractères
 * alphanumériques contenant au moins un chiffre (les mots pleins ne passent pas).
 */
const BARE_TOKEN_RE = /\b(?=[A-Z0-9]*\d)[A-Z0-9]{4,10}\b/gi;

/** Vrai si le jeton est un code public TB… affichable (un code de suivi ne l'est jamais). */
export function isLikelyPublicCode(code: string): boolean {
    return /^TB[0-9A-HJKMNPQRTV-Z]+$/i.test(code.trim());
}

/** Code affichable de l'élément : le code public résolu, TB saisi, sinon un libellé masqué. */
export function queueItemDisplayCode(item: Pick<TrackableQueueItem, 'reference_code' | 'inputCode'>): string {
    if (item.reference_code) {
        return item.reference_code;
    }
    if (isLikelyPublicCode(item.inputCode)) {
        return item.inputCode.toUpperCase();
    }
    return '(code saisi)';
}

/** Extrait les codes d'un collage libre, dédoublonnés dans l'ordre d'apparition. */
export function parseTrackableCodeTokens(text: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (raw: string | undefined | null): void => {
        const code = (raw ?? '').trim().toUpperCase();
        if (code && !seen.has(code)) {
            seen.add(code);
            out.push(code);
        }
    };
    // Les URL d'abord : le paramètre porte le code de suivi exact.
    for (const match of text.matchAll(URL_CODE_RE)) {
        push(match[1]);
    }
    for (const match of text.matchAll(TB_PUBLIC_CODE_RE)) {
        push(match[0]);
    }
    for (const match of text.matchAll(BARE_TOKEN_RE)) {
        push(match[0]);
    }
    return out;
}

/* ---------------------------------------------------------------------------
 * File : compteurs et transitions pures
 * ------------------------------------------------------------------------- */

export interface TrackableQueueCounts {
    total: number;
    ready: number;
    submitting: number;
    confirmed: number;
    rejected: number;
    unknown: number;
    errors: number;
    /** Éléments dont le sort est connu (confirmé ou refusé). */
    settled: number;
}

export function trackableQueueCounts(items: readonly TrackableQueueItem[]): TrackableQueueCounts {
    const counts: TrackableQueueCounts = {
        total: items.length, ready: 0, submitting: 0, confirmed: 0,
        rejected: 0, unknown: 0, errors: 0, settled: 0,
    };
    for (const item of items) {
        if (item.status === 'ready' || item.status === 'pending' || item.status === 'preflight') {
            counts.ready += item.status === 'ready' ? 1 : 0;
        } else if (item.status === 'submitting') {
            counts.submitting += 1;
        } else if (item.status === 'confirmed') {
            counts.confirmed += 1;
        } else if (item.status === 'rejected') {
            counts.rejected += 1;
        } else if (item.status === 'unknown') {
            counts.unknown += 1;
        } else {
            counts.errors += 1;
        }
    }
    counts.settled = counts.confirmed + counts.rejected;
    return counts;
}

/**
 * Type de log par défaut d'un élément : l'action préremplie (retirer/découvrir)
 * si le site l'autorise, sinon « Découvert », sinon le premier type permis.
 */
export function defaultTrackableLogType(
    allowedLogTypes: readonly { id: number }[],
    preferredAction?: string
): number | undefined {
    if (allowedLogTypes.length === 0) {
        return undefined;
    }
    const allowed = new Set(allowedLogTypes.map(t => t.id));
    const preferred = preferredAction === 'retrieve'
        ? TRACKABLE_LOG_TYPE_IDS.RETRIEVED
        : preferredAction === 'discover' ? TRACKABLE_LOG_TYPE_IDS.DISCOVERED : undefined;
    if (preferred !== undefined && allowed.has(preferred)) {
        return preferred;
    }
    if (allowed.has(TRACKABLE_LOG_TYPE_IDS.DISCOVERED)) {
        return TRACKABLE_LOG_TYPE_IDS.DISCOVERED;
    }
    return allowedLogTypes[0].id;
}

/* ---------------------------------------------------------------------------
 * Persistance sans secret (reprise après fermeture / plantage)
 * ------------------------------------------------------------------------- */

export const TRACKABLE_QUEUE_STORAGE_VERSION = 1;

/** Élément persistable : aucun code de suivi, aucune saisie brute. */
export interface StoredTrackableQueueItem {
    key?: string;
    reference_code?: string;
    name?: string | null;
    owner_username?: string | null;
    current_geocache_code?: string | null;
    has_tracking_code?: boolean;
    allowed_log_types?: { id: number; label: string }[];
    logTypeId?: number;
    status: TrackableQueueStatus;
    statusDetail?: string;
    trackable_url?: string;
}

export interface StoredTrackableQueue {
    version: number;
    logDate?: string;
    logText?: string;
    items: StoredTrackableQueueItem[];
}

export function sanitizeQueueForStorage(items: readonly TrackableQueueItem[]): StoredTrackableQueueItem[] {
    return items.map(item => ({
        key: item.key,
        reference_code: item.reference_code,
        name: item.name,
        owner_username: item.owner_username,
        current_geocache_code: item.current_geocache_code,
        has_tracking_code: item.has_tracking_code,
        allowed_log_types: item.allowed_log_types?.map(t => ({ id: t.id, label: t.label })),
        logTypeId: item.logTypeId,
        // 'submitting' restauré = envoi interrompu au résultat inconnu.
        status: item.status === 'submitting'
            ? 'unknown'
            : item.status === 'preflight' ? 'pending' : item.status,
        statusDetail: item.status === 'submitting'
            ? 'Envoi interrompu avant la réponse : à vérifier sur Geocaching.com.'
            : item.statusDetail,
        trackable_url: item.trackable_url,
    }));
}

/**
 * Restaure une file persistée. Les éléments jamais résolus (pas de `reference_code`)
 * ne peuvent pas repartir : leur saisie brute n'a pas été conservée — ils
 * repassent en erreur « code à ressaisir ».
 */
export function restoreQueueFromStorage(raw: unknown): StoredTrackableQueueItem[] {
    if (!raw || typeof raw !== 'object') {
        return [];
    }
    const items = (raw as { items?: unknown }).items;
    if (!Array.isArray(items)) {
        return [];
    }
    const restored: StoredTrackableQueueItem[] = [];
    for (const entry of items) {
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        const item = entry as StoredTrackableQueueItem;
        if (!item.reference_code) {
            restored.push({
                status: 'error',
                statusDetail: 'Saisie non persistée (code de suivi jamais stocké) : ressaisir le code.',
            });
            continue;
        }
        restored.push({
            ...item,
            status: item.status === 'submitting' || item.status === 'preflight' ? 'unknown' : item.status,
            statusDetail: item.status === 'submitting' || item.status === 'preflight'
                ? 'Envoi interrompu avant la réponse : à vérifier sur Geocaching.com.'
                : item.statusDetail,
        });
    }
    return restored;
}

/** Bilan copiable de la file — codes publics seulement, jamais de code de suivi. */
export function buildTrackableQueueReport(items: readonly TrackableQueueItem[]): string {
    const counts = trackableQueueCounts(items);
    const lines = [
        `File de logs trackables : ${counts.total} élément(s) — `
        + `${counts.confirmed} confirmé(s), ${counts.rejected} refusé(s), `
        + `${counts.unknown} à vérifier, ${counts.errors} en erreur.`,
    ];
    for (const item of items) {
        const label = item.reference_code ?? '(code non résolu)';
        const detail = item.statusDetail ? ` — ${item.statusDetail}` : '';
        lines.push(`${label} : ${item.status}${detail}`);
    }
    return lines.join('\n');
}
