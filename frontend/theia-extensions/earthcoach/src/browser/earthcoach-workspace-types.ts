import { EarthCoachQuickAction, GeoImage, LoggingTask, UserObservation } from './earthcoach-types';

export type EarthCoachGroupRole = 'overview' | 'detail' | 'masked' | 'original' | 'before' | 'after' | 'other';
export type EarthCoachSendAction = 'analyze_observations' | 'resolve';
export type EarthCoachSaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface EarthCoachWorkspaceImageContext {
    id?: number | null;
    image_id: number;
    included: boolean;
    comment?: string | null;
    waypoint_id?: number | null;
    observation_id?: number | null;
    position: number;
}

export interface EarthCoachWorkspaceGroupMember {
    image_id: number;
    role: EarthCoachGroupRole;
    position: number;
}

export interface EarthCoachWorkspaceGroup {
    id?: number | null;
    title: string;
    instruction?: string | null;
    waypoint_id?: number | null;
    position: number;
    members: EarthCoachWorkspaceGroupMember[];
}

export interface EarthCoachWorkspace {
    geocache_id: number;
    version: number;
    exists: boolean;
    general_comment?: string | null;
    selected_language?: string | null;
    description_fingerprint?: string | null;
    image_contexts: EarthCoachWorkspaceImageContext[];
    groups: EarthCoachWorkspaceGroup[];
    created_at?: string | null;
    updated_at?: string | null;
}

export interface EarthCoachWorkspaceInput {
    version: number;
    general_comment?: string | null;
    selected_language?: string | null;
    description_fingerprint?: string | null;
    image_contexts: EarthCoachWorkspaceImageContext[];
    groups: EarthCoachWorkspaceGroup[];
}

export interface EarthCoachDescriptionVersion {
    language: string;
    label: string;
    html: string;
    text: string;
    complete: boolean;
    source: 'override' | 'segmented' | 'full';
}

export interface EarthCoachDescriptionSelection {
    fingerprint: string;
    selectedLanguage: string;
    selected: EarthCoachDescriptionVersion;
    versions: EarthCoachDescriptionVersion[];
    reliable: boolean;
    notice?: string;
}

export interface EarthCoachPreparedImage {
    id: string;
    origin: GeoImage['origin'];
    label?: string;
    fileUri: string;
    comment?: string;
    waypointId?: number;
    observationId?: number;
}

/** `reply` : l'utilisateur repond a ce qui restait a completer (texte et/ou photos). */
export type EarthCoachRefineFocus = 'deepen' | 'contest' | 'reply';

/**
 * Reprise ciblee d'une seule question : la capture ne cree pas de resultat,
 * elle remplace la proposition de cette question dans le resultat existant.
 */
export interface EarthCoachRefineTarget {
    /** Resultat auquel rattacher la proposition recapturee. */
    resultId: number;
    focus: EarthCoachRefineFocus;
    /**
     * Position de la proposition visee dans le resultat. Le texte ne suffit
     * pas : deux stations peuvent poser la meme question mot pour mot.
     */
    proposalIndex?: number;
    /** Proposition precedente a depasser, reprise dans le prompt. */
    previous: EarthCoachResultProposal;
    /** Les autres propositions du resultat, pour les deductions croisees entre questions. */
    siblings?: EarthCoachResultProposal[];
    /** Reponse libre de l'utilisateur (focus `reply`). */
    userReply?: string;
    /** Photos ajoutees avec cette reponse, a examiner en priorite (focus `reply`). */
    userImageIds?: string[];
}

export interface EarthCoachPreparedRequest {
    requestId: string;
    geocacheId: number;
    action: EarthCoachSendAction;
    preparedAt: string;
    responseLanguage?: string;
    listing: {
        language: string;
        fingerprint: string;
        reliableSeparation: boolean;
        html: string;
        text: string;
    };
    generalComment?: string;
    /** Geologie et altitude du site, recuperees en code avant l'envoi. */
    siteContext?: string;
    observations: UserObservation[];
    loggingTasks: LoggingTask[];
    images: EarthCoachPreparedImage[];
    groups: EarthCoachWorkspaceGroup[];
    unavailableImages: Array<{ id: string; label?: string; reason: string }>;
    refine?: EarthCoachRefineTarget;
    /**
     * Questions de precision posees via earthcoach_ask_user : le modele attend
     * la reponse de l'utilisateur avant de capturer. Etat pose a l'execution,
     * pas une donnee preparee; conserve dans l'instantane comme trace.
     */
    awaitingInput?: string[];
}

/**
 * Ce dont depend la reponse: `knowledge` = listing ou connaissance
 * geologique, `photo` = lisible sur les images transmises, `field` = releve
 * sur place impossible a deduire. L'interdit d'inventer ne vise que `field`.
 */
export type EarthCoachQuestionType = 'knowledge' | 'photo' | 'field';

/** Sur quoi repose la reponse candidate. */
export type EarthCoachAnswerBasis = 'observation' | 'photo' | 'listing' | 'geology' | 'tool';

export interface EarthCoachResultProposal {
    task_id?: number;
    /** Rang de la question dans le listing (Q1, Q2...), donne par le modele quand aucune question n'est enregistree. */
    question_number?: number;
    /** Lieu auquel la question se rapporte (station, waypoint, etape), absent pour une cache a lieu unique. */
    location?: string;
    question: string;
    question_type?: EarthCoachQuestionType;
    question_translation?: string;
    status: 'ready' | 'partial' | 'missing';
    answer?: string;
    /** Raisonnement qui justifie la reponse, une ou deux phrases. */
    reasoning?: string;
    basis?: EarthCoachAnswerBasis[];
    evidence_ids?: string[];
    confidence?: 'high' | 'medium' | 'low';
    missing?: string | null;
}

export interface EarthCoachSnapshotTask {
    id: number;
    position?: number | null;
    question?: string | null;
    /** Absent des resultats anterieurs a la distinction des consignes photo. */
    kind?: string | null;
}

export interface EarthCoachResult {
    id: number;
    geocache_id: number;
    request_id: string;
    action: 'analyze' | 'resolve';
    session_id?: string | null;
    /** Absent de la liste (`GET .../earthcoach-results`), trop lourd : voir `snapshot_tasks`. */
    context_snapshot?: EarthCoachPreparedRequest | Record<string, unknown>;
    /** Questions de l'instantane, version legere : numerotation des propositions. */
    snapshot_tasks?: EarthCoachSnapshotTask[];
    /** Version effective : corrections utilisateur si elles existent, sinon version IA. */
    proposals: EarthCoachResultProposal[];
    /** Version brute produite par le modele, pour comparaison ou reinitialisation. */
    ai_proposals?: EarthCoachResultProposal[];
    /** true quand l'utilisateur a corrige les propositions du modele. */
    proposals_edited?: boolean;
    markdown?: string | null;
    /** Reponse finale generee depuis les propositions relues, rattachee a ce resultat. */
    final_answer?: string | null;
    /** Traduction de controle du message final dans la langue de l'utilisateur (jamais envoyee). */
    final_answer_control?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
}

export interface EarthCoachWorkspaceOpenOptions {
    pendingAction?: EarthCoachSendAction;
    sourceAction?: EarthCoachQuickAction;
}
