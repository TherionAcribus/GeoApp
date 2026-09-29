import { CancellationError, CancellationToken, Emitter, isCancelled } from '@theia/core';
import { Event as TheiaEvent } from '@theia/core/lib/common/event';
import { inject, injectable, optional, postConstruct } from '@theia/core/shared/inversify';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import {
    LanguageModel,
    LanguageModelRegistry,
    LanguageModelResponse,
    LanguageModelService,
    LanguageModelStreamResponsePart,
    UsageResponsePart,
    UserRequest,
    isLanguageModelStreamResponse,
    isLanguageModelTextResponse,
    isUsageResponsePart,
} from '@theia/ai-core';
import {
    GeoAppAiExecutionRecord,
    GeoAppAiExecutionResult,
    GeoAppAiOperationContext,
    GeoAppAiOperationOptions,
    GeoAppAiOperationRecorder,
    GeoAppAiModelCapability,
    GeoAppAiModelResolution,
    GeoAppAiTaskDescriptor,
    GeoAppAiTokenUsage,
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
    readonly subjectId?: string;
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

export const GEOAPP_AI_EXECUTION_HISTORY_STORAGE_KEY = 'geoapp.ai.executionHistory.v1';
export const GEOAPP_AI_EXECUTION_HISTORY_ENABLED_PREF = 'geoApp.ai.executionHistory.enabled';
export const GEOAPP_AI_EXECUTION_HISTORY_MAX_PREF = 'geoApp.ai.executionHistory.maxEntries';
const GEOAPP_AI_EXECUTION_HISTORY_DEFAULT_MAX = 200;
const GEOAPP_AI_EXECUTION_HISTORY_MIN = 10;
const GEOAPP_AI_EXECUTION_HISTORY_MAX = 1000;

export interface GeoAppAiExecutionHistoryPayload {
    version: 1;
    records: readonly GeoAppAiExecutionRecord[];
}

export interface GeoAppAiExecutionHistoryStore {
    load(): Promise<unknown>;
    save(payload: GeoAppAiExecutionHistoryPayload): Promise<void>;
    clear(): Promise<void>;
}

export const GeoAppAiExecutionHistoryStore = Symbol('GeoAppAiExecutionHistoryStore');

interface InternalTaskExecution {
    operationId: string;
    subjectId?: string;
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

    @inject(GeoAppAiExecutionHistoryStore) @optional()
    protected readonly executionHistoryStore?: GeoAppAiExecutionHistoryStore;

    @inject(PreferenceService) @optional()
    protected readonly preferenceService?: PreferenceService;

    protected persistedHistoryLoaded = false;
    protected persistenceSubscription: { dispose(): unknown } | undefined;
    protected executionHistoryPersistenceIssue: string | undefined;

    @postConstruct()
    protected initializePersistence(): void {
        if (!this.executionHistoryStore || !this.preferenceService) {
            return;
        }
        this.persistenceSubscription = this.preferenceService.onPreferenceChanged(event => {
            if (event.preferenceName === GEOAPP_AI_EXECUTION_HISTORY_ENABLED_PREF) {
                if (this.isExecutionHistoryPersistenceEnabled()) {
                    this.persistedHistoryLoaded = false;
                    void this.restorePersistedHistory();
                } else {
                    this.persistedHistoryLoaded = true;
                    void this.executionHistoryStore?.clear()
                        .catch(error => console.debug('[GeoAppAiExecution] historique persistant non supprimé', error));
                }
            } else if (event.preferenceName === GEOAPP_AI_EXECUTION_HISTORY_MAX_PREF) {
                this.executionHistory.splice(this.executionHistoryLimit());
                void this.persistHistory();
            }
        });
        void this.restorePersistedHistory();
    }

    isExecutionHistoryPersistenceEnabled(): boolean {
        return Boolean(this.executionHistoryStore)
            && this.preferenceService?.get<boolean>(GEOAPP_AI_EXECUTION_HISTORY_ENABLED_PREF, false) === true;
    }

    getExecutionHistoryLimit(): number {
        return this.executionHistoryLimit();
    }

    getExecutionHistoryPersistenceIssue(): string | undefined {
        return this.executionHistoryPersistenceIssue;
    }

    async clearExecutionHistory(): Promise<void> {
        this.executionHistory.length = 0;
        await this.executionHistoryStore?.clear();
    }

    getRunningExecutions(): readonly GeoAppAiExecutionRecord[] {
        return [...this.activeExecutions.values()];
    }

    getRecentExecutions(taskId?: string): readonly GeoAppAiExecutionRecord[] {
        return taskId
            ? this.executionHistory.filter(execution => execution.taskId === taskId)
            : [...this.executionHistory];
    }

    getLatestExecution(taskId: string, subjectId?: string): GeoAppAiExecutionRecord | undefined {
        const matches = (record: GeoAppAiExecutionRecord): boolean =>
            record.taskId === taskId && (subjectId === undefined || record.subjectId === subjectId);
        return [...this.activeExecutions.values()].find(matches)
            ?? this.executionHistory.find(matches);
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
        const subjectId = options.subjectId;
        const sessionId = options.sessionId || `${operationId}-session`;
        let resolution = options.resolution || await this.modelResolutionService.resolveTask(task);
        const backendExecution = options.backendExecution;
        if (backendExecution) {
            const locality = backendExecution.provider === 'openai' || backendExecution.provider === 'openrouter'
                ? 'remote'
                : backendExecution.baseUrl
                    ? checkGeoAppLocalEndpoint(backendExecution.baseUrl).status
                    : resolution.locality;
            const backendModelId = backendExecution.resolvedModelId || backendExecution.model;
            const capabilityEvaluation = backendModelId
                ? await this.modelResolutionService.evaluateTaskCapabilities(task, {
                    identifiers: [backendExecution.resolvedModelId, backendExecution.model, backendExecution.requestedIdentifier],
                    provider: backendExecution.provider,
                    baseUrl: backendExecution.baseUrl,
                })
                : undefined;
            const capabilityChecks = capabilityEvaluation?.capabilityChecks || resolution.capabilityChecks;
            const capabilityIncompatible = Boolean(capabilityChecks?.some(check =>
                check.required && check.status !== 'supported'
            ));
            const previousDiagnostics = resolution.diagnostics.filter(diagnostic =>
                !/^Capacité /i.test(diagnostic)
                && !/Aucun modèle configuré|n’est pas disponible|n’est pas exécutable/i.test(diagnostic)
            );
            const diagnostics = capabilityEvaluation
                ? [...previousDiagnostics, ...capabilityEvaluation.diagnostics]
                : capabilityIncompatible
                    ? resolution.diagnostics
                    : previousDiagnostics;
            const provider = backendExecution.provider || resolution.provider;
            resolution = {
                ...resolution,
                requestedIdentifier: backendExecution.requestedIdentifier || resolution.requestedIdentifier,
                resolvedModelId: backendModelId || backendExecution.provider,
                displayModel: backendExecution.displayModel
                    || (backendModelId ? `${provider || 'backend'}/${backendModelId}` : resolution.displayModel),
                provider,
                transport: 'chat-completions',
                backingModel: backendExecution.model || resolution.backingModel,
                source: backendExecution.source || resolution.source,
                sourceLabel: backendExecution.sourceLabel || resolution.sourceLabel,
                locality,
                status: capabilityIncompatible ? 'unsupported' : 'ready',
                diagnostics: [
                    ...diagnostics,
                    ...(backendModelId ? [] : ['Le modèle effectif sera déterminé par le backend.']),
                ],
                capabilityChecks,
            };
        }
        if (resolution.status !== 'ready' || !resolution.resolvedModelId) {
            const error = new GeoAppAiExecutionUnavailableError(task, resolution);
            this.recordResolutionFailure(task, resolution, operationId, sessionId, error, subjectId);
            throw error;
        }

        const startedAt = new Date();
        const execution: GeoAppAiExecutionRecord = {
            id: this.newId(`${task.id}-exec`),
            operationId,
            subjectId,
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
                errorCode: error === undefined ? undefined : this.errorCode(error),
                errorMessage: error === undefined ? undefined : this.errorMessage(error),
            });
            this.executionHistory.unshift(finished);
            this.executionHistory.splice(this.executionHistoryLimit());
            void this.persistHistory();
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
                subjectId,
                sessionId,
                task: Object.freeze({ ...task }),
                resolution: execution.resolution,
            });
            if (signal?.aborted) {
                const error = abortError();
                finish('cancelled', error);
                throw error;
            }
            this.applyBackendObservation(execution, response);
            return { execution: finish('succeeded') || execution, response };
        } catch (error) {
            finish(signal?.aborted || error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'failed', error);
            throw error;
        }
    }

    async beginTaskExecution(
        taskId: string,
        options: { operationId?: string; subjectId?: string; sessionId?: string } = {}
    ): Promise<GeoAppAiTaskExecution> {
        const task = this.modelResolutionService.getTasks().find(candidate => candidate.id === taskId);
        if (!task) {
            throw new Error(`Tâche IA inconnue : ${taskId}`);
        }
        if (task.executionPath !== 'theia-language-model') {
            throw new Error(`La tâche « ${task.label} » n’utilise pas le registre de modèles Theia.`);
        }

        const operationId = options.operationId || this.newId(`geoapp-${task.id}`);
        const subjectId = options.subjectId;
        const sessionId = options.sessionId || `${operationId}-session`;
        let resolution = await this.modelResolutionService.resolveTask(task);
        if (resolution.status !== 'ready' || !resolution.resolvedModelId) {
            const error = new GeoAppAiExecutionUnavailableError(task, resolution);
            this.recordResolutionFailure(task, resolution, operationId, sessionId, error, subjectId);
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
            this.recordResolutionFailure(task, resolution, operationId, sessionId, error, subjectId);
            throw error;
        }

        const context: InternalTaskExecution = {
            operationId,
            subjectId,
            sessionId,
            task,
            resolution: this.freezeResolution(resolution),
            languageModel,
            requestCount: 0,
        };

        return {
            operationId,
            subjectId,
            sessionId,
            task: Object.freeze({ ...task }),
            resolution: context.resolution,
            sendRequest: (request, requestOptions = {}) => this.executeRequest(context, request, requestOptions),
        };
    }

    async sendTaskRequest(
        taskId: string,
        request: GeoAppAiExecutionRequestInput,
        options: GeoAppAiExecutionRequestOptions & { operationId?: string; subjectId?: string } = {}
    ): Promise<GeoAppAiExecutionResult<LanguageModelResponse>> {
        const execution = await this.beginTaskExecution(taskId, {
            operationId: options.operationId,
            subjectId: options.subjectId,
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
            subjectId: context.subjectId,
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
                errorCode: error === undefined ? undefined : this.errorCode(error),
                errorMessage: error === undefined ? undefined : this.errorMessage(error),
            });
            this.executionHistory.unshift(finished);
            this.executionHistory.splice(this.executionHistoryLimit());
            void this.persistHistory();
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
                if (isLanguageModelTextResponse(response) && response.usage) {
                    execution.tokenUsage = this.toTokenUsage(response.usage);
                }
                const finished = finish('succeeded') || execution;
                return { execution: finished, response };
            }
            return {
                execution,
                response: {
                    ...response,
                    stream: this.instrumentStream(response.stream, execution, finish, cancellationToken),
                },
            };
        } catch (error) {
            finish(cancellationToken?.isCancellationRequested || isCancelled(error) ? 'cancelled' : 'failed', error);
            throw error;
        }
    }

    protected async *instrumentStream(
        stream: AsyncIterable<LanguageModelStreamResponsePart>,
        execution: GeoAppAiExecutionRecord,
        finish: (status: GeoAppAiExecutionRecord['status'], error?: unknown) => GeoAppAiExecutionRecord | undefined,
        cancellationToken?: CancellationToken
    ): AsyncIterable<LanguageModelStreamResponsePart> {
        try {
            for await (const part of stream) {
                if (cancellationToken?.isCancellationRequested) {
                    finish('cancelled', new CancellationError());
                    throw new CancellationError();
                }
                if (isUsageResponsePart(part)) {
                    execution.tokenUsage = this.toTokenUsage(part);
                }
                yield part;
            }
            finish(cancellationToken?.isCancellationRequested ? 'cancelled' : 'succeeded');
        } catch (error) {
            finish(cancellationToken?.isCancellationRequested || isCancelled(error) ? 'cancelled' : 'failed', error);
            throw error;
        }
    }

    protected applyBackendObservation(execution: GeoAppAiExecutionRecord, response: unknown): void {
        const responseRecord = this.asRecord(response);
        const data = this.asRecord(responseRecord?.data) || responseRecord;
        if (!data) {
            return;
        }

        const models = new Set<string>();
        const providers = new Set<string>();
        const usages: GeoAppAiTokenUsage[] = [];
        const usageScopes = new Set<string>();
        const topLevelUsage = this.normalizeTokenUsage(data.usage);
        const visit = (value: unknown): void => {
            const record = this.asRecord(value);
            if (!record) {
                return;
            }
            const reportedModel = this.stringValue(record.reported_model ?? record.reportedModel);
            const model = this.stringValue(record.model);
            if (reportedModel) {
                models.add(reportedModel);
            } else if (model) {
                models.add(model);
            }
            const reportedProvider = this.stringValue(record.reported_provider ?? record.reportedProvider ?? record.provider);
            if (reportedProvider) {
                providers.add(reportedProvider);
            }
            if (record !== data) {
                const usage = this.normalizeTokenUsage(record.usage);
                const batchIndex = record.batch_index ?? record.batchIndex;
                const usageScope = batchIndex === undefined ? undefined : `batch-${String(batchIndex)}`;
                if (usage && (!usageScope || !usageScopes.has(usageScope))) {
                    if (usageScope) {
                        usageScopes.add(usageScope);
                    }
                    usages.push(usage);
                }
            }
            for (const key of ['items', 'results']) {
                const nested = record[key];
                if (Array.isArray(nested)) {
                    nested.forEach(visit);
                }
            }
            visit(record.metadata);
            visit(record.ai_scoring);
        };
        visit(data);

        if (models.size) {
            execution.reportedModel = [...models].join(', ');
        }
        if (providers.size) {
            execution.reportedProvider = [...providers].join(', ');
        }
        const usage = topLevelUsage || this.mergeTokenUsages(usages);
        if (usage) {
            execution.tokenUsage = usage;
        }
    }

    protected normalizeTokenUsage(value: unknown): GeoAppAiTokenUsage | undefined {
        const usage = this.asRecord(value);
        if (!usage) {
            return undefined;
        }
        const normalized: GeoAppAiTokenUsage = {};
        const inputTokens = this.numberValue(usage.input_tokens ?? usage.inputTokens ?? usage.prompt_tokens);
        const outputTokens = this.numberValue(usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens);
        const totalTokens = this.numberValue(usage.total_tokens ?? usage.totalTokens);
        const cacheCreationInputTokens = this.numberValue(usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens);
        const cacheReadInputTokens = this.numberValue(usage.cache_read_input_tokens ?? usage.cacheReadInputTokens);
        if (inputTokens !== undefined) {
            normalized.inputTokens = inputTokens;
        }
        if (outputTokens !== undefined) {
            normalized.outputTokens = outputTokens;
        }
        if (totalTokens !== undefined) {
            normalized.totalTokens = totalTokens;
        }
        if (cacheCreationInputTokens !== undefined) {
            normalized.cacheCreationInputTokens = cacheCreationInputTokens;
        }
        if (cacheReadInputTokens !== undefined) {
            normalized.cacheReadInputTokens = cacheReadInputTokens;
        }
        return Object.values(normalized).length ? normalized : undefined;
    }

    protected mergeTokenUsages(usages: GeoAppAiTokenUsage[]): GeoAppAiTokenUsage | undefined {
        if (!usages.length) {
            return undefined;
        }
        if (usages.length === 1) {
            return usages[0];
        }
        const keys: Array<keyof GeoAppAiTokenUsage> = [
            'inputTokens',
            'outputTokens',
            'totalTokens',
            'cacheCreationInputTokens',
            'cacheReadInputTokens',
        ];
        const merged: GeoAppAiTokenUsage = {};
        for (const key of keys) {
            if (usages.every(usage => usage[key] !== undefined)) {
                merged[key] = usages.reduce((total, usage) => (total || 0) + (usage[key] || 0), 0);
            }
        }
        return Object.values(merged).some(value => value !== undefined) ? merged : undefined;
    }

    protected executionHistoryLimit(): number {
        const configured = Number(this.preferenceService?.get<number>(
            GEOAPP_AI_EXECUTION_HISTORY_MAX_PREF,
            GEOAPP_AI_EXECUTION_HISTORY_DEFAULT_MAX
        ));
        if (!Number.isFinite(configured)) {
            return GEOAPP_AI_EXECUTION_HISTORY_DEFAULT_MAX;
        }
        return Math.min(
            GEOAPP_AI_EXECUTION_HISTORY_MAX,
            Math.max(GEOAPP_AI_EXECUTION_HISTORY_MIN, Math.floor(configured))
        );
    }

    protected async restorePersistedHistory(): Promise<void> {
        if (!this.executionHistoryStore || !this.isExecutionHistoryPersistenceEnabled() || this.persistedHistoryLoaded) {
            return;
        }
        this.persistedHistoryLoaded = true;
        try {
            const stored = await this.executionHistoryStore.load();
            const storedRecord = this.asRecord(stored);
            const rawRecords = Array.isArray(stored)
                ? stored
                : storedRecord && storedRecord.version !== undefined && storedRecord.version !== 1
                    ? []
                    : Array.isArray(storedRecord?.records)
                        ? storedRecord.records
                        : [];
            const persisted = rawRecords
                .map(value => this.normalizePersistedExecution(value))
                .filter((value): value is GeoAppAiExecutionRecord => Boolean(value));
            const knownIds = new Set(this.executionHistory.map(record => record.id));
            this.executionHistory.push(...persisted.filter(record => !knownIds.has(record.id)));
            this.executionHistory.sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
            this.executionHistory.splice(this.executionHistoryLimit());
            for (const record of this.executionHistory) {
                const sequence = /-(\d+)$/.exec(record.id);
                if (sequence) {
                    this.nextId = Math.max(this.nextId, Number(sequence[1]));
                }
            }
            this.executionHistoryPersistenceIssue = undefined;
        } catch (error) {
            this.executionHistoryPersistenceIssue = `lecture impossible : ${this.errorMessage(error)}`;
            console.debug('[GeoAppAiExecution] historique persistant illisible', error);
        }
    }

    protected async persistHistory(): Promise<void> {
        if (!this.executionHistoryStore || !this.isExecutionHistoryPersistenceEnabled()) {
            return;
        }
        try {
            const records = this.executionHistory
                .slice(0, this.executionHistoryLimit())
                .map(record => this.toPersistedExecution(record));
            if (!records.length) {
                await this.executionHistoryStore.clear();
                return;
            }
            await this.executionHistoryStore.save({ version: 1, records });
            this.executionHistoryPersistenceIssue = undefined;
        } catch (error) {
            this.executionHistoryPersistenceIssue = `écriture impossible : ${this.errorMessage(error)}`;
            console.debug('[GeoAppAiExecution] historique persistant non écrit', error);
        }
    }

    protected toPersistedExecution(record: GeoAppAiExecutionRecord): GeoAppAiExecutionRecord {
        const resolution = record.resolution;
        return this.freezeExecution({
            id: record.id,
            operationId: record.operationId,
            subjectId: record.subjectId,
            requestId: record.requestId,
            sessionId: record.sessionId,
            taskId: record.taskId,
            taskLabel: record.taskLabel,
            attempt: record.attempt,
            resolution: this.freezeResolution({
                taskId: resolution.taskId,
                taskLabel: resolution.taskLabel,
                kind: resolution.kind,
                executionPath: resolution.executionPath,
                agentId: resolution.agentId,
                purpose: resolution.purpose,
                requestedIdentifier: resolution.requestedIdentifier,
                resolvedModelId: resolution.resolvedModelId,
                displayModel: resolution.displayModel,
                provider: resolution.provider,
                vendor: resolution.vendor,
                transport: resolution.transport,
                backingModel: resolution.backingModel,
                backingPreference: resolution.backingPreference,
                source: resolution.source,
                sourceLabel: this.sanitizeMetadataString(resolution.sourceLabel),
                locality: resolution.locality,
                status: resolution.status,
                diagnostics: resolution.diagnostics
                    .map(diagnostic => this.sanitizeMetadataString(diagnostic))
                    .filter((diagnostic): diagnostic is string => Boolean(diagnostic)),
                requiresLocalModel: resolution.requiresLocalModel,
                requiredCapabilities: resolution.requiredCapabilities && [...resolution.requiredCapabilities],
                optionalCapabilities: resolution.optionalCapabilities && [...resolution.optionalCapabilities],
                capabilityChecks: resolution.capabilityChecks?.map(check => ({ ...check })),
            }),
            status: record.status,
            startedAt: record.startedAt,
            completedAt: record.completedAt,
            durationMs: record.durationMs,
            reportedModel: this.sanitizeMetadataString(record.reportedModel),
            reportedProvider: this.sanitizeMetadataString(record.reportedProvider),
            tokenUsage: record.tokenUsage && { ...record.tokenUsage },
            errorName: this.sanitizeMetadataString(record.errorName),
            errorCode: record.errorCode,
            errorMessage: this.sanitizeMetadataString(record.errorMessage),
        });
    }

    protected normalizePersistedExecution(value: unknown): GeoAppAiExecutionRecord | undefined {
        const record = this.asRecord(value);
        const resolution = this.asRecord(record?.resolution);
        const status = record?.status;
        if (!record
            || !resolution
            || typeof record.id !== 'string'
            || typeof record.operationId !== 'string'
            || typeof record.requestId !== 'string'
            || typeof record.sessionId !== 'string'
            || typeof record.taskId !== 'string'
            || typeof record.taskLabel !== 'string'
            || typeof record.startedAt !== 'string'
            || (status !== 'succeeded' && status !== 'failed' && status !== 'cancelled')) {
            return undefined;
        }
        return this.freezeExecution({
            id: record.id,
            operationId: record.operationId,
            subjectId: this.stringValue(record.subjectId),
            requestId: record.requestId,
            sessionId: record.sessionId,
            taskId: record.taskId,
            taskLabel: record.taskLabel,
            attempt: this.numberValue(record.attempt) ?? 0,
            resolution: this.freezeResolution({
                taskId: this.stringValue(resolution.taskId) || record.taskId,
                taskLabel: this.stringValue(resolution.taskLabel) || record.taskLabel,
                kind: resolution.kind === 'chat' || resolution.kind === 'internal' || resolution.kind === 'backend'
                    ? resolution.kind
                    : 'internal',
                executionPath: resolution.executionPath === 'backend-plugin' ? 'backend-plugin' : 'theia-language-model',
                agentId: this.stringValue(resolution.agentId),
                purpose: this.stringValue(resolution.purpose),
                requestedIdentifier: this.stringValue(resolution.requestedIdentifier),
                resolvedModelId: this.stringValue(resolution.resolvedModelId),
                displayModel: this.stringValue(resolution.displayModel),
                provider: this.stringValue(resolution.provider),
                vendor: this.stringValue(resolution.vendor),
                transport: resolution.transport === 'chat-completions' || resolution.transport === 'responses-api'
                    ? resolution.transport
                    : resolution.transport === 'theia-managed'
                        ? 'theia-managed'
                        : 'unknown',
                backingModel: this.stringValue(resolution.backingModel),
                backingPreference: this.stringValue(resolution.backingPreference),
                source: ['operation', 'session', 'agent', 'task-preference', 'default', 'unresolved'].includes(String(resolution.source))
                    ? resolution.source as GeoAppAiModelResolution['source']
                    : 'unresolved',
                sourceLabel: this.sanitizeMetadataString(resolution.sourceLabel) || 'historique persisté',
                locality: resolution.locality === 'local' || resolution.locality === 'remote' ? resolution.locality : 'unknown',
                status: ['ready', 'unavailable', 'incompatible', 'unsupported', 'unconfigured'].includes(String(resolution.status))
                    ? resolution.status as GeoAppAiModelResolution['status']
                    : 'unavailable',
                diagnostics: Array.isArray(resolution.diagnostics)
                    ? resolution.diagnostics
                        .filter((diagnostic): diagnostic is string => typeof diagnostic === 'string')
                        .map(diagnostic => this.errorMessage(diagnostic))
                    : [],
                requiresLocalModel: resolution.requiresLocalModel === true,
                requiredCapabilities: Array.isArray(resolution.requiredCapabilities)
                    ? resolution.requiredCapabilities.filter((capability): capability is GeoAppAiModelCapability =>
                        ['vision', 'structured-output', 'tools', 'web'].includes(String(capability)))
                    : undefined,
                optionalCapabilities: Array.isArray(resolution.optionalCapabilities)
                    ? resolution.optionalCapabilities.filter((capability): capability is GeoAppAiModelCapability =>
                        ['vision', 'structured-output', 'tools', 'web'].includes(String(capability)))
                    : undefined,
                capabilityChecks: Array.isArray(resolution.capabilityChecks)
                    ? resolution.capabilityChecks
                        .map(check => this.asRecord(check))
                        .filter((check): check is Record<string, unknown> => Boolean(check))
                        .map(check => ({
                            capability: ['vision', 'structured-output', 'tools', 'web'].includes(String(check.capability))
                                ? check.capability as GeoAppAiModelCapability
                                : 'tools',
                            required: check.required === true,
                            status: check.status === 'supported' || check.status === 'unsupported' ? check.status : 'unknown',
                            source: check.source === 'model' || check.source === 'preference' || check.source === 'provider'
                                ? check.source
                                : 'unverified',
                            detail: this.sanitizeMetadataString(check.detail),
                        }))
                    : undefined,
            }),
            status,
            startedAt: record.startedAt,
            completedAt: this.stringValue(record.completedAt),
            durationMs: this.numberValue(record.durationMs),
            reportedModel: this.sanitizeMetadataString(record.reportedModel),
            reportedProvider: this.sanitizeMetadataString(record.reportedProvider),
            tokenUsage: this.normalizeTokenUsage(record.tokenUsage),
            errorName: this.sanitizeMetadataString(record.errorName),
            errorCode: this.stringValue(record.errorCode),
            errorMessage: this.sanitizeMetadataString(record.errorMessage),
        });
    }

    protected toTokenUsage(usage: UsageResponsePart): GeoAppAiTokenUsage {
        const tokenUsage: GeoAppAiTokenUsage = {
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
        };
        if (usage.cache_creation_input_tokens !== undefined) {
            tokenUsage.cacheCreationInputTokens = usage.cache_creation_input_tokens;
        }
        if (usage.cache_read_input_tokens !== undefined) {
            tokenUsage.cacheReadInputTokens = usage.cache_read_input_tokens;
        }
        return tokenUsage;
    }

    protected asRecord(value: unknown): Record<string, unknown> | undefined {
        return value !== null && typeof value === 'object' && !Array.isArray(value)
            ? value as Record<string, unknown>
            : undefined;
    }

    protected sanitizeMetadataString(value: unknown): string | undefined {
        const text = this.stringValue(value);
        return text ? this.errorMessage(text) : undefined;
    }

    protected stringValue(value: unknown): string | undefined {
        return typeof value === 'string' && value.trim() ? value.trim() : undefined;
    }

    protected numberValue(value: unknown): number | undefined {
        return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    }

    protected errorCode(error: unknown): string {
        if (error instanceof GeoAppAiOutputError || error instanceof Error && error.name === 'GeoAppAiOutputError') {
            return this.safeErrorCode((error as GeoAppAiOutputError).kind);
        }
        if (error instanceof GeoAppAiExecutionUnavailableError || error instanceof Error && error.name === 'GeoAppAiExecutionUnavailableError') {
            const resolution = (error as GeoAppAiExecutionUnavailableError).resolution;
            return this.safeErrorCode(`resolution-${resolution?.status || 'unavailable'}`);
        }
        if (isCancelled(error as Error) || error instanceof Error && error.name === 'AbortError') {
            return 'cancelled';
        }
        const candidate = error as { code?: unknown; status?: unknown; response?: { status?: unknown }; message?: unknown };
        const status = this.numberValue(candidate.response?.status ?? candidate.status);
        if (status !== undefined) {
            return `http-${status}`;
        }
        if (typeof candidate.code === 'string' && candidate.code.trim()) {
            return this.safeErrorCode(candidate.code);
        }
        if (error instanceof Error && error.name) {
            return this.safeErrorCode(error.name);
        }
        return 'unknown-error';
    }

    protected safeErrorCode(value: string): string {
        return value.toLowerCase().replace(/[^a-z0-9_.:-]+/g, '-').slice(0, 80);
    }

    protected recordResolutionFailure(
        task: GeoAppAiTaskDescriptor,
        resolution: GeoAppAiModelResolution,
        operationId: string,
        sessionId: string,
        error: Error,
        subjectId?: string
    ): void {
        const now = new Date().toISOString();
        const record = this.freezeExecution({
            id: this.newId(`${task.id}-resolution`),
            operationId,
            subjectId,
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
            errorCode: this.errorCode(error),
            errorMessage: this.errorMessage(error),
        });
        this.executionHistory.unshift(record);
        this.executionHistory.splice(this.executionHistoryLimit());
        void this.persistHistory();
        this.onDidFinishEmitter.fire(record);
    }

    protected freezeResolution(resolution: GeoAppAiModelResolution): GeoAppAiModelResolution {
        return Object.freeze({
            ...resolution,
            diagnostics: Object.freeze([...resolution.diagnostics]),
            requiredCapabilities: resolution.requiredCapabilities && Object.freeze([...resolution.requiredCapabilities]),
            optionalCapabilities: resolution.optionalCapabilities && Object.freeze([...resolution.optionalCapabilities]),
            capabilityChecks: resolution.capabilityChecks && Object.freeze(
                resolution.capabilityChecks.map(check => Object.freeze({ ...check }))
            ),
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
