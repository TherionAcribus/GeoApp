import { GeocacheContext, PluginExecutorResumeSnapshot } from '@mysterai/theia-plugins/lib/browser/plugin-executor-widget';
import { ResolutionWorkflowStepRunResponse } from '@mysterai/theia-plugins/lib/common/plugin-protocol';

export interface ArchiveStats {
    total_archived: number;
    solved: number;
    in_progress: number;
    found: number;
    by_cache_type: Record<string, number>;
    by_resolution_method: Record<string, number>;
}

export interface ArchiveSettings {
    auto_sync_enabled: boolean;
}

export interface ArchiveSettingsUpdateResponse extends ArchiveSettings {
    warning?: string | null;
}

export interface ArchiveHistoryEntry {
    entry_id?: string;
    recorded_at?: string;
    source?: string;
    workflow_kind?: string;
    workflow_confidence?: number;
    control_status?: string;
    final_confidence?: number;
    current_text?: string;
    recommendation_source_text?: string;
    latest_event?: {
        category?: string;
        message?: string;
        detail?: string;
        timestamp?: string;
    } | null;
    resume_state?: PluginExecutorResumeSnapshot | null;
}

export interface ArchiveDiagnostics {
    source?: string;
    updated_at?: string;
    current_text?: string;
    workflow_resolution?: {
        primary?: {
            kind?: string;
            confidence?: number;
            score?: number;
            reason?: string;
            forced?: boolean;
        } | null;
        explanation?: string[];
        next_actions?: string[];
        execution?: Record<string, unknown> | null;
    } | null;
    resume_state?: PluginExecutorResumeSnapshot | null;
    history_state?: ArchiveHistoryEntry[];
}

export interface ArchiveEntry {
    id?: number;
    gc_code: string;
    name?: string;
    cache_type?: string;
    difficulty?: number;
    terrain?: number;
    solved_status?: string;
    resolution_method?: string;
    solved_coordinates_raw?: string;
    solved_latitude?: number;
    solved_longitude?: number;
    original_coordinates_raw?: string;
    waypoints_snapshot?: unknown[] | null;
    found?: boolean;
    updated_at?: string;
    resolution_diagnostics?: ArchiveDiagnostics | null;
}

export interface GeocacheApiResponse {
    id?: number;
    gc_code?: string;
    name?: string;
    difficulty?: number;
    terrain?: number;
    latitude?: number;
    longitude?: number;
    coordinates_raw?: string;
    original_coordinates_raw?: string;
    description_html?: string;
    description_override_html?: string;
    description_raw?: string;
    description_override_raw?: string;
    hints?: string;
    hints_decoded?: string;
    hints_decoded_override?: string;
    waypoints?: unknown[];
    images?: Array<{ url?: string }>;
    checkers?: Array<{ id?: number; name?: string; url?: string }>;
}

export interface ArchiveListResponse {
    total: number;
    page: number;
    per_page: number;
    pages: number;
    archives: ArchiveEntry[];
}

export type BulkFilter = 'all' | 'by_status' | 'orphaned' | 'before_date';

export interface BulkDeleteArchivesInput {
    confirm: true;
    filter: BulkFilter;
    status?: string;
    before_date?: string;
}

export interface BulkDeleteArchivesResponse {
    deleted: number;
    filter: BulkFilter;
    warning?: string;
}

export interface ArchiveListSummary {
    meta: string;
    eventLabel: string;
    eventText: string;
}

export interface ReplayableWorkflowStep {
    id: string;
    title?: string;
    status?: string;
}

export type ArchiveWorkflowLogEntry = PluginExecutorResumeSnapshot['workflowEntries'][number];

export interface PrepareArchiveHistoryContextResult {
    context: GeocacheContext;
    usedArchiveFallback: boolean;
}

export interface ReplayArchiveHistoryResult {
    context: GeocacheContext;
    nextStep: ReplayableWorkflowStep;
    response: ResolutionWorkflowStepRunResponse;
    updatedSnapshot: PluginExecutorResumeSnapshot;
    usedArchiveFallback: boolean;
}

export const BULK_FILTER_LABELS: Record<BulkFilter, string> = {
    all: 'Toutes les archives',
    by_status: 'Par statut de resolution',
    orphaned: 'Orphelines (geocache supprimee)',
    before_date: 'Anterieures a une date',
};

export const STATUS_OPTIONS = [
    { value: 'not_solved', label: 'Non resolues' },
    { value: 'in_progress', label: 'En cours' },
    { value: 'solved', label: 'Resolues' },
];

export const ARCHIVE_STATUS_FILTER_OPTIONS = [
    { value: '', label: 'Tous les statuts' },
    ...STATUS_OPTIONS,
];

export const WORKFLOW_KIND_LABELS: Record<string, string> = {
    general: 'General',
    secret_code: 'Code secret',
    formula: 'Formule',
    checker: 'Checker',
    hidden_content: 'Contenu cache',
    image_puzzle: 'Image',
    coord_transform: 'Coordonnees',
};

export const CONTROL_STATUS_LABELS: Record<string, string> = {
    ready: 'Pret',
    awaiting_input: 'Attente saisie',
    budget_exhausted: 'Budget epuise',
    stopped: 'Arrete',
    completed: 'Termine',
};

export const REPLAYABLE_WORKFLOW_STEP_IDS = new Set([
    'execute-metasolver',
    'search-answers',
    'calculate-final-coordinates',
    'validate-with-checker',
]);
