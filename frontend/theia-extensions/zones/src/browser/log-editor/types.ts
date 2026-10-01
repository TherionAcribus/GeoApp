/**
 * Types et guards partagés par le widget d'édition de logs et ses sous-composants.
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 1) : aucune logique
 * ici, uniquement des déclarations de types et les guards associés.
 */

/** `skip` n'est pas un type de log Geocaching.com : c'est un marqueur local "cette cache ne sera pas envoyée". */
export type LogTypeValue = 'found' | 'dnf' | 'note' | 'skip';

export const LOG_TYPE_VALUES: readonly LogTypeValue[] = ['found', 'dnf', 'note', 'skip'];

export function isLogTypeValue(value: unknown): value is LogTypeValue {
    return typeof value === 'string' && (LOG_TYPE_VALUES as readonly string[]).includes(value);
}

/**
 * Ce qu'un appel IA fait à une zone de texte du log.
 *
 * Traduire et corriger ne diffèrent que par le prompt et les libellés : verrou, mémoire
 * d'avant-appel, garde-fou de longueur, traitement de lot et rendu sont communs — et l'étaient
 * déjà entre le texte commun et les blocs par cache. Décrire la tâche plutôt que la recopier
 * ramène six points d'entrée de l'UI à deux descriptions.
 */
export interface AiRewriteJob {
    /** Pilote le spinner : lequel des deux boutons tourne pendant l'appel. */
    action: 'translate' | 'improve';
    /** Vrai si rien ne s'oppose à l'appel (langue configurée, aucun appel en cours…). */
    canRun: () => boolean;
    /** Verbe employé dans « … : rien à traduire / corriger ». */
    verb: string;
    /** Transforme le texte ; `undefined` si le modèle n'a rien renvoyé d'exploitable. */
    run: (sourceText: string, subjectId?: string) => Promise<string | undefined>;
    /** Message affiché après le remplacement d'une zone unique. */
    successMessage: string;
    /** Sujet du garde-fou de longueur : « La traduction », « Le texte corrigé ». */
    lengthSubject: string;
    reportError: (error: unknown) => void;
    /** Libellés du traitement de lot, en mode « texte différent par cache ». */
    batch: {
        title: string;
        ok: string;
        /** Message du dialogue de confirmation, qui annonce le nombre d'appels au modèle. */
        confirm: (count: number) => string;
        /** Première partie du bilan : « 12 bloc(s) traduit(s) en Anglais ». */
        done: (count: number) => string;
    };
}

export type SubmissionStatus = 'ok' | 'failed' | 'skipped';

/** Catégories de signalement, codes de c:geo (`ReportProblemType`). */
export type ProblemCategory = 'needsMaintenance' | 'logFull' | 'logWet' | 'damaged' | 'missing' | 'other' | 'archive';

/**
 * Signalement d'un problème sur une cache : un second log (Needs Maintenance ou
 * Needs Archived), envoyé après le log principal, à la même date.
 */
export interface ProblemReport {
    category: ProblemCategory;
    text: string;
}

/**
 * Issue de l'envoi d'un signalement. `uncertain` : la réponse s'est perdue, le
 * signalement a peut-être été créé — il n'est jamais renvoyé automatiquement.
 */
export type ProblemSubmitStatus = 'ok' | 'failed' | 'uncertain';

/** Signalements d'un brouillon ou d'une entrée d'historique, par géocache. */
export interface ProblemReportsRecord {
    reports: Record<number, ProblemReport>;
    status: Record<number, ProblemSubmitStatus>;
    references: Record<number, string>;
}

export function isSubmissionStatus(value: unknown): value is SubmissionStatus {
    return value === 'ok' || value === 'failed' || value === 'skipped';
}

export type ImageUploadStatus = 'pending' | 'uploading' | 'ok' | 'failed';

/** Résultat d'un lot d'uploads de photos pour une géocache. */
export interface ImagesUploadResult {
    /** GUIDs des photos réellement acceptées par Geocaching.com. */
    guids: string[];
    total: number;
    failed: number;
}

export interface SelectedLogImage {
    id: string;
    file: File;
    status: ImageUploadStatus;
    imageGuid?: string;
    error?: string;
}

export interface GeocacheListItem {
    id: number;
    gc_code: string;
    name: string;
    owner?: string;
    favorites_count?: number;
    /** Logs stockés en local, pas le total du site : inutilisable comme dénominateur. */
    logs_count?: number;
    /** Total de logs annoncé par Geocaching.com, tous types confondus. */
    logs_total_available?: number;
    /** Trouvailles annoncées par Geocaching.com (Found + Attended + Webcam). */
    finds_count?: number;
    /** Pourcentage de favoris calculé côté backend sur `finds_count`. */
    favorites_percent?: number;
    placed_at?: string | null;
    cache_type?: string;
    /** La géocache est déjà marquée comme trouvée : un second "Found it" est refusé par Geocaching.com. */
    already_found?: boolean;
    found_date?: string | null;
}

export interface LogHistoryEntry {
    id: string;
    createdAt: string;
    logDate: string;
    /** Langue de traduction au moment de l'envoi. Absent des entrées écrites avant la fonctionnalité. */
    logLanguage?: string;
    useSameTextForAll: boolean;
    globalText: string;
    perCacheText: Record<number, string>;
    logType: LogTypeValue;
    perCacheLogType: Record<number, LogTypeValue>;
    perCacheFavorite: Record<number, boolean>;
    /** Issue de l'envoi par géocache (`ok`/`failed`/`skipped`). Absent des entrées anciennes. */
    perCacheSubmitStatus?: Record<number, SubmissionStatus>;
    /** Signalements (NM / NA) et leur issue. Absent des entrées antérieures. */
    problems?: ProblemReportsRecord;
    /**
     * Journal TB de l'envoi : entrées réellement parties par géocache et sort
     * final de chaque dépôt (`confirmed`/`failed`/`uncertain`). Informatif
     * seulement — jamais réappliqué comme choix à la navigation dans
     * l'historique. Codes publics TB… uniquement, jamais de codes de suivi.
     * Absent des entrées antérieures aux trackables.
     */
    trackables?: {
        sent: Record<number, { code: string; action: string }[]>;
        dropOutcomes: Record<string, string>;
    };
}

/**
 * Sauvegarde automatique de la session de rédaction en cours, indexée par l'ensemble
 * des géocaches ouvertes. Contrairement à l'historique (écrit après un envoi réussi),
 * le brouillon existe dès la première frappe : c'est lui qui survit à une fermeture
 * d'onglet ou à un plantage. Les photos sélectionnées (`File`) ne sont pas sérialisables
 * et ne sont donc pas restaurées.
 */
/**
 * Forme du brouillon. La v2 ne sérialise dans `trackables.actions` que les
 * *écarts* au défaut courant (plus les cibles de dépôt explicites), pour qu'une
 * préférence ou une « dernière action » modifiée entre-temps s'applique aux TBs
 * sans choix exprimé. Les brouillons v1 portaient la table complète ; à la
 * restauration leurs actions sont relues comme des overrides — c'est le choix
 * conservateur (un défaut gelé peut survivre, jamais un choix perdu).
 */
export const LOG_DRAFT_VERSION = 2;

export interface LogDraft {
    /** Version de la forme sérialisée (`LOG_DRAFT_VERSION`). Absent = v1. */
    version?: number;
    savedAt: string;
    /** Ordre d'affichage/d'envoi au moment de la sauvegarde (il pilote `@cache_count`). */
    geocacheIds: number[];
    logDate: string;
    /** Langue de traduction au moment de la sauvegarde. Absent des brouillons antérieurs. */
    logLanguage?: string;
    logType: LogTypeValue;
    useSameTextForAll: boolean;
    globalText: string;
    perCacheText: Record<number, string>;
    perCacheLogType: Record<number, LogTypeValue>;
    perCacheFavorite: Record<number, boolean>;
    /** Logs déjà postés : les restaurer évite de republier après un plantage en cours de lot. */
    perCacheSubmitStatus: Record<number, SubmissionStatus>;
    perCacheSubmitReference: Record<number, string | undefined>;
    /**
     * Signalements (NM / NA) et leur issue : une reprise ne renvoie jamais un
     * signalement parti (`ok`) ou peut-être parti (`uncertain`). Champ facultatif,
     * absent des brouillons antérieurs : pas de changement de version.
     */
    problems?: ProblemReportsRecord;
    /**
     * Actions sur les TBs de mon inventaire (`{actions, dropTargets}`, cf. `trackables.ts`).
     * En v2, `actions` ne contient que les écarts au défaut (overrides) ; en v1,
     * la table complète. `dropResults` retient les dépôts déjà partis dans un
     * lot interrompu (`confirmed`/`uncertain`) : une reprise ne doit jamais les
     * rejouer. Absent des brouillons antérieurs aux trackables.
     */
    trackables?: {
        actions: Record<string, string>;
        dropTargets: Record<string, number>;
        dropResults?: Record<string, 'confirmed' | 'uncertain'>;
    };
}

/**
 * Ce que le GPS a noté pour une cache (widget « Visites GPS »). Affiché comme
 * aide-mémoire dans l'éditeur, jamais copié dans le texte du log.
 */
export interface GpsVisitHint {
    /** Heure locale de la visite (HH:MM). */
    time: string;
    /** Libellé écrit par le GPS : « Found it », « Needs Maintenance »… */
    statusRaw: string;
    /** Commentaire tapé sur le GPS. */
    comment?: string;
    /** Détail des passages réduits à une seule ligne (« 11:42 — Didn't find it »), un par ligne. */
    passes?: string;
    /** Le GPS a noté un « Needs Maintenance » ce jour-là. */
    hasNm?: boolean;
    /** NM sans « Found it » : sur le Garmin, NM remplace le résultat — le type proposé est à confirmer. */
    needsConfirmation?: boolean;
}

/**
 * Pré-remplissage d'un onglet de log ouvert depuis les visites GPS. S'applique après
 * le chargement des géocaches et avant le brouillon : un brouillon existant pour ces
 * mêmes géocaches l'emporte toujours.
 */
export interface LogEditorPrefill {
    source: 'gps-visits';
    /** Jour local des visites (AAAA-MM-JJ) : remplace la date de l'onglet, sans toucher à la date épinglée. */
    logDate: string;
    perCacheLogType: Record<number, LogTypeValue>;
    perCacheVisit: Record<number, GpsVisitHint>;
}

export interface LogTextPattern {
    id: string;
    name: string;
    content: string;
    isBuiltin: boolean;
}

export interface PatternSuggestion {
    id: string;
    label: string;
    description: string;
    insertText: string;
}