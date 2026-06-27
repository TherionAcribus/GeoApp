export const EarthCoachAgentId = 'earthcoach';

export const EarthCoachOpenCommandId = 'earthcoach.open';

export const EarthCoachObserveTaskCommandId = 'earthcoach.observeTask';

export type EarthCoachMode = 'coach' | 'resolver';

export type EarthCoachVerbosity = 'compact' | 'normal' | 'detailed';

export type EarthCoachQuickAction =
    | 'understand'
    | 'prepare_visit'
    | 'field_checklist'
    | 'observations'
    | 'logging_tasks'
    | 'extract_logging_tasks'
    | 'image_gallery'
    | 'illustrate_term'
    | 'explain_word'
    | 'geology_context'
    | 'analyze_observations'
    | 'resolve';

export type ImageOrigin =
    | 'cache_listing'
    | 'user_observation'
    | 'educational_reference';

export interface GeoImage {
    id: string;
    origin: ImageOrigin;
    cacheId?: string;
    userId?: string;
    label?: string;
    description?: string;
    takenAt?: string;
    coordinates?: {
        lat: number;
        lon: number;
    };
    fileUri: string;
}

export interface UserObservation {
    id: string;
    cacheId: string;
    userId: string;
    waypointId?: string;
    observationType?: 'observation' | 'hypothesis' | 'interpretation';
    note: string;
    observedAt?: string;
    createdAt: string;
    coordinates?: {
        lat: number;
        lon: number;
    };
    coordinatesRaw?: string;
    source?: 'structured' | 'note';
    sourceNoteId?: number;
    images: GeoImage[];
}

export type LoggingTaskStatus = 'todo' | 'field' | 'answered';

export interface LoggingTask {
    id: string;
    geocacheId: string;
    position: number;
    question: string;
    guidance?: string;
    answer?: string;
    status: LoggingTaskStatus;
    requiresPhoto: boolean;
    observationId?: string;
    source?: string;
}

export interface EarthCoachGeocacheData {
    id: number;
    gc_code?: string;
    name: string;
    type?: string;
    size?: string;
    owner?: string;
    difficulty?: number;
    terrain?: number;
    latitude?: number;
    longitude?: number;
    coordinates_raw?: string;
    original_coordinates_raw?: string;
    placed_at?: string;
    status?: string;
    description_html?: string;
    description_raw?: string;
    hints?: string;
    hints_decoded?: string;
    hints_decoded_override?: string;
    waypoints?: Array<{
        id?: number;
        prefix?: string;
        lookup?: string;
        name?: string;
        type?: string;
        gc_coords?: string;
        latitude?: number;
        longitude?: number;
        note?: string;
    }>;
}

export interface EarthCoachPromptInput {
    geocache: EarthCoachGeocacheData;
    mode: EarthCoachMode;
    action: EarthCoachQuickAction;
    verbosity?: EarthCoachVerbosity;
    observations: UserObservation[];
    loggingTasks?: LoggingTask[];
    gcPersonalNote?: string | null;
    images: GeoImage[];
}

export interface EarthCoachOpenRequest {
    geocacheData?: EarthCoachGeocacheData;
    geocacheId?: number;
    action?: EarthCoachQuickAction;
}
