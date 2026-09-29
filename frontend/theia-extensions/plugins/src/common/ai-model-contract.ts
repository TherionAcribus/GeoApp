export type GeoAppAiTaskKind = 'chat' | 'internal' | 'backend';
export type GeoAppAiExecutionPath = 'theia-language-model' | 'backend-plugin';
export type GeoAppAiModelSource = 'operation' | 'session' | 'agent' | 'task-preference' | 'default' | 'unresolved';
export type GeoAppAiModelLocality = 'local' | 'remote' | 'unknown';
export type GeoAppAiModelStatus = 'ready' | 'unavailable' | 'incompatible' | 'unsupported' | 'unconfigured';
export type GeoAppAiModelTransport = 'theia-managed' | 'chat-completions' | 'responses-api' | 'unknown';

export interface GeoAppAiTaskDescriptor {
    id: string;
    label: string;
    agentId?: string;
    purpose?: string;
    kind: GeoAppAiTaskKind;
    executionPath: GeoAppAiExecutionPath;
    requiresLocalModel?: boolean;
}

export interface GeoAppAiModelResolution {
    taskId: string;
    taskLabel: string;
    kind: GeoAppAiTaskKind;
    executionPath: GeoAppAiExecutionPath;
    agentId?: string;
    purpose?: string;
    requestedIdentifier?: string;
    resolvedModelId?: string;
    displayModel?: string;
    provider?: string;
    vendor?: string;
    transport?: GeoAppAiModelTransport;
    backingModel?: string;
    backingPreference?: string;
    source: GeoAppAiModelSource;
    sourceLabel: string;
    locality: GeoAppAiModelLocality;
    status: GeoAppAiModelStatus;
    diagnostics: string[];
    requiresLocalModel?: boolean;
}

export type GeoAppAiExecutionStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface GeoAppAiTokenUsage {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
}

export interface GeoAppAiExecutionRecord {
    /** Identifiant unique de cet appel/tentative. */
    id: string;
    /** Identifiant commun aux appels appartenant à la même opération métier. */
    operationId: string;
    requestId: string;
    sessionId: string;
    taskId: string;
    taskLabel: string;
    attempt: number;
    /** Instantané figé au moment de l'envoi : une modification ultérieure d'alias ne le réécrit pas. */
    resolution: Readonly<GeoAppAiModelResolution>;
    status: GeoAppAiExecutionStatus;
    startedAt: string;
    completedAt?: string;
    durationMs?: number;
    /** Modèle réellement rapporté par la réponse, lorsque le fournisseur le retourne. */
    reportedModel?: string;
    /** Fournisseur rapporté par la réponse, utile pour les plugins backend. */
    reportedProvider?: string;
    /** Usage retourné par le fournisseur ; les champs absents restent inconnus. */
    tokenUsage?: GeoAppAiTokenUsage;
    errorName?: string;
    /** Code stable pour distinguer les erreurs métier, HTTP, annulation et validation de sortie. */
    errorCode?: string;
    errorMessage?: string;
}

export interface GeoAppAiExecutionResult<TResponse = unknown> {
    execution: GeoAppAiExecutionRecord;
    response: TResponse;
}

export interface GeoAppAiOperationContext {
    operationId: string;
    sessionId: string;
    task: Readonly<GeoAppAiTaskDescriptor>;
    resolution: Readonly<GeoAppAiModelResolution>;
}

export interface GeoAppAiBackendExecutionModel {
    provider?: string;
    baseUrl?: string;
    model?: string;
    requestedIdentifier?: string;
    resolvedModelId?: string;
    displayModel?: string;
    source?: GeoAppAiModelSource;
    sourceLabel?: string;
}

export interface GeoAppAiOperationOptions {
    operationId?: string;
    sessionId?: string;
    requestId?: string;
    /** Instantané fourni par un adaptateur qui a déjà résolu la configuration d'exécution. */
    resolution?: GeoAppAiModelResolution;
    /** Paramètres réellement envoyés par un chemin backend lorsqu'ils diffèrent de la configuration résolue. */
    backendExecution?: GeoAppAiBackendExecutionModel;
    cancellationSignal?: AbortSignal;
}

export const GeoAppAiOperationRecorder = Symbol('GeoAppAiOperationRecorder');

export interface GeoAppAiOperationRecorder {
    runOperation<T>(
        taskId: string,
        operation: (context: GeoAppAiOperationContext) => Promise<T>,
        options?: GeoAppAiOperationOptions
    ): Promise<GeoAppAiExecutionResult<T>>;
    getLatestExecution(taskId: string): GeoAppAiExecutionRecord | undefined;
}
