import { LoggingTaskStatus } from './earthcoach-types';

export interface LoggingTaskDto {
    id: number;
    geocache_id?: number;
    position?: number;
    question?: string;
    guidance?: string | null;
    answer?: string | null;
    status?: string | null;
    requires_photo?: boolean;
    observation_id?: number | null;
    source?: string | null;
}

export interface LoggingTasksApiResponse {
    geocache_id: number;
    gc_code?: string;
    name?: string;
    logging_tasks: LoggingTaskDto[];
}

export interface LoggingTaskInput {
    question: string;
    guidance?: string | null;
    answer?: string | null;
    status?: LoggingTaskStatus;
    requires_photo?: boolean;
    observation_id?: number | null;
    position?: number | null;
}

export interface LoggingTaskDraft {
    question: string;
    guidance: string;
    answer: string;
    status: LoggingTaskStatus;
    requiresPhoto: boolean;
    observationId: string;
}

export const LOGGING_TASK_STATUS_OPTIONS: Array<{ value: LoggingTaskStatus; label: string }> = [
    { value: 'todo', label: 'A traiter' },
    { value: 'field', label: 'A observer sur le terrain' },
    { value: 'answered', label: 'Repondu' },
];

export function getLoggingTaskStatusLabel(status?: LoggingTaskStatus | string | null): string {
    const option = LOGGING_TASK_STATUS_OPTIONS.find(item => item.value === status);
    return option ? option.label : 'A traiter';
}

export function normalizeLoggingTaskStatus(value?: string | null): LoggingTaskStatus {
    return value === 'field' || value === 'answered' ? value : 'todo';
}

function trimToUndefined(value: string): string | null {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function parseOptionalObservationId(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    const parsed = Number(trimmed);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function createLoggingTaskDraft(): LoggingTaskDraft {
    return {
        question: '',
        guidance: '',
        answer: '',
        status: 'todo',
        requiresPhoto: false,
        observationId: '',
    };
}

export function createLoggingTaskDraftFromDto(task: LoggingTaskDto): LoggingTaskDraft {
    return {
        question: task.question || '',
        guidance: task.guidance || '',
        answer: task.answer || '',
        status: normalizeLoggingTaskStatus(task.status),
        requiresPhoto: Boolean(task.requires_photo),
        observationId: task.observation_id != null ? String(task.observation_id) : '',
    };
}

export function buildLoggingTaskInput(draft: LoggingTaskDraft): LoggingTaskInput {
    return {
        question: draft.question.trim(),
        guidance: trimToUndefined(draft.guidance),
        answer: trimToUndefined(draft.answer),
        status: draft.status,
        requires_photo: draft.requiresPhoto,
        observation_id: parseOptionalObservationId(draft.observationId),
    };
}

export interface LoggingTaskSeed {
    taskId: number;
    position: number;
    question: string;
    guidance?: string;
}

/** Construit la graine transmise au widget Observations pour creer une observation liee a une question. */
export function buildLoggingTaskSeed(task: LoggingTaskDto): LoggingTaskSeed {
    return {
        taskId: task.id,
        position: task.position ?? 0,
        question: (task.question || '').trim(),
        guidance: task.guidance?.trim() || undefined,
    };
}

/** Banniere affichee au-dessus du formulaire d'observation quand elle est liee a une question. */
export function formatLoggingTaskSeedLabel(seed: LoggingTaskSeed): string {
    return `Observation liee a la question Q${seed.position}: ${seed.question}`;
}

function coerceBool(value: unknown): boolean {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return value !== 0;
    }
    if (typeof value === 'string') {
        return ['1', 'true', 'yes', 'oui', 'on'].includes(value.trim().toLowerCase());
    }
    return false;
}

/**
 * Normalise la liste de taches proposee par le LLM (tool earthcoach_extract_logging_tasks)
 * en entrees backend propres: questions non vides, ordre par position croissante,
 * indicateur photo coerce et eventuel rappel d'observation.
 */
export function normalizeExtractionTasks(raw: unknown): LoggingTaskInput[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const tasks: LoggingTaskInput[] = [];
    raw.forEach((item, index) => {
        if (!item || typeof item !== 'object') {
            return;
        }
        const record = item as Record<string, unknown>;
        const question = String(record.question ?? '').trim();
        if (!question) {
            return;
        }
        const positionValue = Number(record.position);
        tasks.push({
            question,
            guidance: typeof record.guidance === 'string' ? trimToUndefined(record.guidance) : null,
            status: 'todo',
            requires_photo: coerceBool(record.requires_photo),
            position: Number.isInteger(positionValue) && positionValue > 0 ? positionValue : index + 1,
        });
    });
    return tasks;
}
