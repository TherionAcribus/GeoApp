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

export interface EarthCoachPreparedRequest {
    requestId: string;
    geocacheId: number;
    action: EarthCoachSendAction;
    preparedAt: string;
    listing: {
        language: string;
        fingerprint: string;
        reliableSeparation: boolean;
        html: string;
        text: string;
    };
    generalComment?: string;
    observations: UserObservation[];
    loggingTasks: LoggingTask[];
    images: EarthCoachPreparedImage[];
    groups: EarthCoachWorkspaceGroup[];
    unavailableImages: Array<{ id: string; label?: string; reason: string }>;
}

export interface EarthCoachResultProposal {
    task_id?: number;
    question: string;
    status: 'ready' | 'partial' | 'missing';
    answer?: string;
    evidence_ids?: string[];
    confidence?: 'high' | 'medium' | 'low';
    missing?: string | null;
}

export interface EarthCoachResult {
    id: number;
    geocache_id: number;
    request_id: string;
    action: 'analyze' | 'resolve';
    session_id?: string | null;
    context_snapshot: EarthCoachPreparedRequest | Record<string, unknown>;
    proposals: EarthCoachResultProposal[];
    markdown?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
}

export interface EarthCoachWorkspaceOpenOptions {
    pendingAction?: EarthCoachSendAction;
    sourceAction?: EarthCoachQuickAction;
}
