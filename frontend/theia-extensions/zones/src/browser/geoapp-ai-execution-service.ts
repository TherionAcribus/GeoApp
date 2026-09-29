import { CancellationError, CancellationToken, Emitter, isCancelled } from '@theia/core';
import { Event as TheiaEvent } from '@theia/core/lib/common/event';
import { inject, injectable } from '@theia/core/shared/inversify';
import {
    LanguageModel,
    LanguageModelRegistry,
    LanguageModelResponse,
    LanguageModelService,
    LanguageModelStreamResponsePart,
    UserRequest,
    isLanguageModelStreamResponse,
} from '@theia/ai-core';
import {
    GeoAppAiExecutionRecord,
    GeoAppAiExecutionResult,
    GeoAppAiOperationContext,
    GeoAppAiOperationOptions,
    GeoAppAiOperationRecorder,
    GeoAppAiModelResolution,
    GeoAppAiTaskDescriptor,
} from '@mysterai/theia-plugins/lib/common/ai-model-contract';
import { GeoAppAiModelResolutionService } from './geoapp-ai-model-resolution-service';
import { checkGeoAppLocalEndpoint } from './geoapp-local-model-guard';

export interface GeoAppAiExecutionRequestOptions {
    requestId?: string;
    sessionId?: string;
    cancellationToken?: CancellationToken;
}

export type GeoAppAiExecutionRequestInput = Omit<UserRequest, 'agentId' | 'requestId' | 'sessionId' | 'cancellationToken'>;

export interface GeoAppAiTaskExecution {
    readonly operationId: string;
    readonly sessionId: string;
    readonly task: Readonly<GeoAppAiTaskDescriptor>;
    readonly resolution: Readonly<GeoAppAiModelResolution>;
    sendRequest(
        request: GeoAppAiExecutionRequestInput,
        options?: GeoAppAiExecutionRequestOptions
    ): Promise<GeoAppAiExecutionResult<LanguageModelResponse>>;
}

export class GeoAppAiExecutionUnavailableError extends Error {
    constructor(
        readonly task: GeoAppAiTaskDescriptor,
        readonly resolution: GeoAppAiModelResolution
    ) {
        const diagnostic = resolution.diagnostics.length ? ` ${resolution.diagnostics.join(' ')}` : '';
        super(`La tâche IA « ${task.label} » n’est pas exécutable (${resolution.status}).${diagnostic}`);
        this.name = 'GeoAppAiExecutionUnavailableError';
    }
}

export type GeoAppAiOutputErrorKind =
    | 'empty-response'
    | 'invalid-json'
    | 'schema-mismatch'
    | 'truncated-response'
    | 'unsupported-response';

export class GeoAppAiOutputError extends Error {
    constructor(
        readonly kind: GeoAppAiOutputErrorKind,
        message: string,
        readonly retryable = false
    ) {
        super(message);
        this.name = 'GeoAppAiOutputError';
    }
}

export function isGeoAppAiRetryableError(error: unknown): boolean {
    if (!error || isCancelled(error as Error) || error instanceof Error && error.name === 'AbortError') {
        return false;
    }
    if (error instanceof GeoAppAiOutputError) {
        return error.retryable;
    }
    if (error instanceof GeoAppAiExecutionUnavailableError || error instanceof Error && error.name === 'GeoAppAiExecutionUnavailableError') {
        return false;
    }

    const candidate = error as { code?: unknown; status?: unknown; response?: { status?: unknown }; message?: unknown };
    const status = Number(candidate.response?.status ?? candidate.status);
    if (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500) {
        return true;
    }
    if (status >= 400 && status < 500) {
        return false;
    }

    const code = typeof candidate.code === 'string' ? candidate.code : '';
    if (/^(?:ECONNABORTED|ECONNRESET|ERR_NETWORK|ETIMEDOUT)$/i.test(code)) {
        return true;
    }
    const message = typeof candidate.message === 'string' ? candidate.message : '';
    if (/\b(?:400|401|403|404|422)\b/.test(message)) {
        return false;
    }
    return /\b(?:408|409|425|429|5\d\d)\b/.test(message)
        || /timeout|timed out|network|fetch failed|connection reset/i.test(message);
}

interface InternalTaskExecution {
    operationId: string;
    sessionId: string;
    task: GeoAppAiTaskDescriptor;
    resolution: GeoAppAiModelResolution;
    languageModel: LanguageModel;
    requestCount: number;
}

@injectable()
export class GeoAppAiExecutionService implements GeoAppAiOperationRecorder {

    protected readonly onDidStartEmitter = new Emitter<GeoAppAiExecutionRecord>();
    readonly onDidStartExecution: TheiaEvent<GeoAppAiExecutionRecord> = this.onDidStartEmitter.event;

    protected readonly onDidFinishEmitter = new Emitter<GeoAppAiExecutionRecord>();
    readonly onDidFinishExecution: TheiaEvent<GeoAppAiExecutionRecord> = this.onDidFinishEmitter.event;

    protected readonly activeExecutions = new Map<string, GeoAppAiExecutionRecord>();
    protected readonly executionHistory: GeoAppAiExecutionRecord[] = [];
    protected nextId = 0;

    @inject(GeoAppAiModelResolutionService)
    protected readonly modelResolutionService!: GeoAppAiModelResolutionService;

    @inject(LanguageModelRegistry)
    protected readonly languageModelRegistry!: LanguageModelRegistry;

    @inject(LanguageModelService)
    protected readonly languageModelService!: LanguageModelService;

    getRunningExecutions(): readonly GeoAppAiExecutionRecord[] {
        return [...this.activeExecutions.values()];
    }

    getRecentExecutions(taskId?: string): readonly GeoAppAiExecutionRecord[] {
        return taskId
            ? this.executionHistory.filter(execution => execution.taskId === taskId)
            : [...this.executionHistory];
    }

    getLatestExecution(taskId: string): GeoAppAiExecutionRecord | undefined {
        return [...this.activeExecutions.values()].find(record => record.taskId === taskId)
            ?? this.executionHistory.find(execution => execution.taskId === taskId);
    }

    async runOperation<T>(
        taskId: string,
        operation: (context: GeoAppAiOperationContext) => Promise<T>,
        options: GeoAppAiOperationOptions = {}
    ): Promise<GeoAppAiExecutionResult<T>> {
        const task = this.modelResolutionService.getTasks().find(candidate => candidate.id === taskId);
        if (!task) {
            throw new Error(`Tâche IA inconnue : ${taskId}`);
        }
        const operationId = options.operationId || this.newId(`geoapp-${task.id}`);
        const sessionId = options.sessionId || `${operationId}-session`;
        let resolution = options.resolution || await this.modelResolutionService.resolveTask(task);
        const backendExecution = options.backendExecution;
        if (backendExecution) {
            const locality = backendExecution.provider === 'openai' || backendExecution.provider === 'openrouter'
                ? 'remote'
                : backendExecution.baseUrl
                    ? checkGeoAppLocalEndpoint(backendExecution.baseUrl).status
                    : resolution.locality;
            resolution = {
                ...resolution,
                requestedIdentifier: backendExecution.requestedIdentifier || resolution.requestedIdentifier,
                resolvedModelId: backendExecution.resolvedModelId || backendExecution.model || backendExecution.provider,
                displayModel: backendExecution.displayModel || resolution.displayModel,
                provider: backendExecution.provider || resolution.provider,
                transport: 'chat-completions',
                backingModel: backendExecution.model || resolution.backingModel,
                source: backendExecution.source || resolution.source,
                sourceLabel: backendExecution.sourceLabel || resolution.sourceLabel,
                locality,
                status: 'ready',
                diagnostics: backendExecution.model || backendExecution.resolvedModelId ? [] : ['Le modèle effectif sera déterminé par le backend.'],
            };
        }
        if (resolution.status !== 'ready' || !resolution.resolvedModelId) {
            const error = new GeoAppAiExecutionUnavailableError(task, resolution);
            this.recordResolutionFailure(task, resolution, operationId, sessionId, error);
            throw error;
        }

        const startedAt = new Date();
        const execution: GeoAppAiExecutionRecord = {
            id: this.newId(`${task.id}-exec`),
            operationId,
            requestId: options.requestId || `${operationId}-request-1`,
            sessionId,
            taskId: task.id,
            taskLabel: task.label,
            attempt: 1,
            resolution: this.freezeResolution(resolution),
            status: 'running',
            startedAt: startedAt.toISOString(),
        };
        this.activeExecutions.set(execution.id, execution);
        this.onDidStartEmitter.fire(Object.freeze({ ...execution }));

        const signal = options.cancellationSignal;
        const abortError = (): Error => Object.assign(new Error('Opération annulée.'), { name: 'AbortError' });
        const finish = (status: GeoAppAiExecutionRecord['status'], error?: unknown): GeoAppAiExecutionRecord | undefined => {
            if (!this.activeExecutions.delete(execution.id)) {
                return this.executionHistory.find(record => record.id === execution.id);
            }
            const completedAt = new Date();
            const finished = this.freezeExecution({
                ...execution,
                status,
                completedAt: completedAt.toISOString(),
                durationMs: completedAt.getTime() - startedAt.getTime(),
                errorName: error instanceof Error ? error.name : undefined,
                errorMessage: error === undefined ? undefined : this.errorMessage(error),
            });
            this.executionHistory.unshift(finished);
            this.executionHistory.splice(200);
            this.onDidFinishEmitter.fire(finished);
            return finished;
        };
        signal?.addEventListener('abort', () => finish('cancelled', abortError()), { once: true });
        if (signal?.aborted) {
            const error = abortError();
            finish('cancelled', error);
            throw error;
        }

        try {
            const response = await operation({
                operationId,
                sessionId,
                task: Object.freeze({ ...task }),
                resolution: execution.resolution,
            });
            if (signal?.aborted) {
                const error = abortError();
                finish('cancelled', error);
                throw error;
            }
            return { execution: finish('succeeded') || execution, response };
        } catch (error) {
            finish(signal?.aborted || error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'failed', error);
            throw error;
        }
    }

    async beginTaskExecution(
        taskId: string,
        options: { operationId?: string; sessionId?: string } = {}
    ): Promise<GeoAppAiTaskExecution> {
        const task = this.modelResolutionService.getTasks().find(candidate => candidate.id === taskId);
        if (!task) {
            throw new Error(`Tâche IA inconnue : ${taskId}`);
        }
        if (task.executionPath !== 'theia-language-model') {
            throw new Error(`La tâche « ${task.label} » n’utilise pas le registre de modèles Theia.`);
        }

        const operationId = options.operationId || this.newId(`geoapp-${task.id}`);
        const sessionId = options.sessionId || `${operationId}-session`;
        let resolution = await this.modelResolutionService.resolveTask(task);
        if (resolution.status !== 'ready' || !resolution.resolvedModelId) {
            const error = new GeoAppAiExecutionUnavailableError(task, resolution);
            this.recordResolutionFailure(task, resolution, operationId, sessionId, error);
            throw error;
        }

        let languageModel: LanguageModel | undefined;
        try {
            languageModel = await this.languageModelRegistry.getLanguageModel(resolution.resolvedModelId);
        } catch (error) {
            resolution = {
                ...resolution,
                status: 'unavailable',
                diagnostics: [...resolution.diagnostics, `Modèle résolu illisible : ${this.errorMessage(error)}`],
            };
        }
        if (!languageModel) {
            if (resolution.status === 'ready') {
                resolution = {
                    ...resolution,
                    status: 'unavailable',
                    diagnostics: [...resolution.diagnostics, `Le modèle résolu « ${resolution.resolvedModelId} » n’est plus disponible.`],
                };
            }
            const error = new GeoAppAiExecutionUnavailableError(task, resolution);
            this.recordResolutionFailure(task, resolution, operationId, sessionId, error);
            throw error;
        }

        const context: InternalTaskExecution = {
            operationId,
            sessionId,
            task,
            resolution: this.freezeResolution(resolution),
            languageModel,
            requestCount: 0,
        };

        return {
            operationId,
            sessionId,
            task: Object.freeze({ ...task }),
            resolution: context.resolution,
            sendRequest: (request, requestOptions = {}) => this.executeRequest(context, request, requestOptions),
        };
    }

    async sendTaskRequest(
        taskId: string,
        request: GeoAppAiExecutionRequestInput,
        options: GeoAppAiExecutionRequestOptions & { operationId?: string } = {}
    ): Promise<GeoAppAiExecutionResult<LanguageModelResponse>> {
        const execution = await this.beginTaskExecution(taskId, {
            operationId: options.operationId,
            sessionId: options.sessionId,
        });
        return execution.sendRequest(request, options);
    }

    protected async executeRequest(
        context: InternalTaskExecution,
        input: GeoAppAiExecutionRequestInput,
        options: GeoAppAiExecutionRequestOptions
    ): Promise<GeoAppAiExecutionResult<LanguageModelResponse>> {
        const attempt = ++context.requestCount;
        const requestId = options.requestId || `${context.operationId}-request-${attempt}`;
        const sessionId = options.sessionId || context.sessionId;
        const startedAt = new Date();
        const execution: GeoAppAiExecutionRecord = {
            id: this.newId(`${context.task.id}-exec`),
            operationId: context.operationId,
            requestId,
            sessionId,
            taskId: context.task.id,
            taskLabel: context.task.label,
            attempt,
            resolution: context.resolution,
            status: 'running',
            startedAt: startedAt.toISOString(),
        };
        this.activeExecutions.set(execution.id, execution);
        this.onDidStartEmitter.fire(Object.freeze({ ...execution }));

        let cancellationListener: { dispose(): unknown } | undefined;
        const finish = (status: GeoAppAiExecutionRecord['status'], error?: unknown): GeoAppAiExecutionRecord | undefined => {
            cancellationListener?.dispose();
            if (!this.activeExecutions.delete(execution.id)) {
                return this.executionHistory.find(record => record.id === execution.id);
            }
            const completedAt = new Date();
            const finished = this.freezeExecution({
                ...execution,
                status,
                completedAt: completedAt.toISOString(),
                durationMs: completedAt.getTime() - startedAt.getTime(),
                errorName: error instanceof Error ? error.name : undefined,
                errorMessage: error === undefined ? undefined : this.errorMessage(error),
            });
            this.executionHistory.unshift(finished);
            this.executionHistory.splice(200);
            this.onDidFinishEmitter.fire(finished);
            return finished;
        };

        const cancellationToken = options.cancellationToken;
        cancellationListener = cancellationToken?.onCancellationRequested(() => finish('cancelled'));

        if (cancellationToken?.isCancellationRequested) {
            finish('cancelled', new CancellationError());
            throw new CancellationError();
        }

        const request: UserRequest = {
            ...input,
            agentId: context.task.agentId,
            requestId,
            sessionId,
            cancellationToken,
        };

        try {
            const response = await this.languageModelService.sendRequest(context.languageModel, request);
            if (cancellationToken?.isCancellationRequested) {
                finish('cancelled', new CancellationError());
                throw new CancellationError();
            }
            if (!isLanguageModelStreamResponse(response)) {
                const finished = finish('succeeded') || execution;
                return { execution: finished, response };
            }
            return {
                execution,
                response: {
                    ...response,
                    stream: this.instrumentStream(response.stream, finish, cancellationToken),
                },
            };
        } catch (error) {
            finish(cancellationToken?.isCancellationRequested || isCancelled(error) ? 'cancelled' : 'failed', error);
            throw error;
        }
    }

    protected async *instrumentStream(
        stream: AsyncIterable<LanguageModelStreamResponsePart>,
        finish: (status: GeoAppAiExecutionRecord['status'], error?: unknown) => GeoAppAiExecutionRecord | undefined,
        cancellationToken?: CancellationToken
    ): AsyncIterable<LanguageModelStreamResponsePart> {
        try {
            for await (const part of stream) {
                if (cancellationToken?.isCancellationRequested) {
                    finish('cancelled', new CancellationError());
                    throw new CancellationError();
                }
                yield part;
            }
            finish(cancellationToken?.isCancellationRequested ? 'cancelled' : 'succeeded');
        } catch (error) {
            finish(cancellationToken?.isCancellationRequested || isCancelled(error) ? 'cancelled' : 'failed', error);
            throw error;
        }
    }

    protected recordResolutionFailure(
        task: GeoAppAiTaskDescriptor,
        resolution: GeoAppAiModelResolution,
        operationId: string,
        sessionId: string,
        error: Error
    ): void {
        const now = new Date().toISOString();
        const record = this.freezeExecution({
            id: this.newId(`${task.id}-resolution`),
            operationId,
            requestId: `${operationId}-resolution`,
            sessionId,
            taskId: task.id,
            taskLabel: task.label,
            attempt: 0,
            resolution: this.freezeResolution(resolution),
            status: 'failed',
            startedAt: now,
            completedAt: now,
            durationMs: 0,
            errorName: error.name,
            errorMessage: this.errorMessage(error),
        });
        this.executionHistory.unshift(record);
        this.executionHistory.splice(200);
        this.onDidFinishEmitter.fire(record);
    }

    protected freezeResolution(resolution: GeoAppAiModelResolution): GeoAppAiModelResolution {
        return Object.freeze({
            ...resolution,
            diagnostics: Object.freeze([...resolution.diagnostics]),
        }) as GeoAppAiModelResolution;
    }

    protected freezeExecution(execution: GeoAppAiExecutionRecord): GeoAppAiExecutionRecord {
        return Object.freeze(execution);
    }

    protected newId(prefix: string): string {
        return `${prefix}-${Date.now().toString(36)}-${++this.nextId}`;
    }

    protected errorMessage(error: unknown): string {
        const raw = error instanceof Error ? error.message : String(error);
        return raw
            .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
            .replace(/\b(api[_-]?key|access[_-]?token|authorization)\s*=\s*[^\s&;,]+/gi, '$1=[redacted]')
            .replace(/\b(?:sk|xox[baprs]|ghp|gho|pat)_[A-Za-z0-9_-]{8,}\b/g, '[redacted]');
    }
}
