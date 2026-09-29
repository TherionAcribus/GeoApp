import * as assert from 'assert/strict';
import { CancellationError, CancellationToken } from '@theia/core';
import { GeoAppAiExecutionService, GeoAppAiExecutionUnavailableError, GeoAppAiOutputError } from '../geoapp-ai-execution-service';
import { GeoAppAiModelResolutionService } from '../geoapp-ai-model-resolution-service';

interface FakeModel {
    id: string;
    name?: string;
    vendor?: string;
    capabilities?: Record<string, unknown>;
    model?: string;
    url?: string;
}

class FakeLanguageModelRegistry {
    readonly selections: Array<{ agent: string; purpose: string; identifier: string }> = [];

    constructor(public models: Record<string, FakeModel | undefined>) {}

    async selectLanguageModel(request: { agent: string; purpose: string; identifier: string }): Promise<FakeModel | undefined> {
        this.selections.push(request);
        return this.models[request.identifier];
    }

    async getLanguageModel(id: string): Promise<FakeModel | undefined> {
        return Object.values(this.models).find(model => model?.id === id);
    }

    onChange(): { dispose(): void } {
        return { dispose: () => undefined };
    }
}

class FakePreferenceService {
    private readonly listeners = new Set<(event: { preferenceName: string }) => void>();

    constructor(private readonly values: Record<string, unknown> = {}) {}

    get<T>(key: string, fallback: T): T {
        if (key in this.values) {
            return this.values[key] as T;
        }
        return key === 'ai-features.ollama.ollamaHost' ? 'http://localhost:11434' as T : fallback;
    }

    async set<T>(key: string, value: T): Promise<void> {
        this.values[key] = value;
        for (const listener of this.listeners) {
            listener({ preferenceName: key });
        }
    }

    onPreferenceChanged(listener: (event: { preferenceName: string }) => void): { dispose(): void } {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }
}

class FakeStorageService {
    readonly data = new Map<string, unknown>();
    loads = 0;
    saves = 0;
    clears = 0;

    async load(): Promise<unknown> {
        this.loads++;
        return this.data.get('geoapp.ai.executionHistory.v1');
    }

    async save(payload: unknown): Promise<void> {
        this.saves++;
        this.data.set('geoapp.ai.executionHistory.v1', payload);
    }

    async clear(): Promise<void> {
        this.clears++;
        this.data.delete('geoapp.ai.executionHistory.v1');
    }
}

class FakeLanguageModelService {
    readonly requests: Array<{ model: FakeModel; request: Record<string, unknown> }> = [];

    constructor(private readonly response: unknown = { text: 'ok' }) {}

    async sendRequest(model: FakeModel, request: Record<string, unknown>): Promise<unknown> {
        this.requests.push({ model, request });
        return this.response;
    }
}

function createServices(options: {
    models?: Record<string, FakeModel | undefined>;
    response?: unknown;
    assignedIdentifiers?: Record<string, string>;
    preferences?: Record<string, unknown>;
    storage?: FakeStorageService;
}): {
    executionService: GeoAppAiExecutionService;
    registry: FakeLanguageModelRegistry;
    llm: FakeLanguageModelService;
    preferenceService: FakePreferenceService;
    storage: FakeStorageService | undefined;
} {
    const registry = new FakeLanguageModelRegistry(options.models ?? {
        'default/universal': { id: 'ollama/llama3.1', name: 'Llama', vendor: 'Ollama' },
    });
    const llm = new FakeLanguageModelService(options.response);
    const preferenceService = new FakePreferenceService(options.preferences);
    const resolutionService = new GeoAppAiModelResolutionService();
    (resolutionService as any).preferenceService = preferenceService;
    (resolutionService as any).languageModelRegistry = registry;
    if (options.assignedIdentifiers) {
        (resolutionService as any).aiSettingsService = {
            getAgentSettings: async (agentId: string) => ({
                languageModelRequirements: options.assignedIdentifiers?.[agentId]
                    ? [{ purpose: 'chat', identifier: options.assignedIdentifiers[agentId] }]
                    : undefined,
            }),
        };
    }

    const executionService = new GeoAppAiExecutionService();
    (executionService as any).modelResolutionService = resolutionService;
    (executionService as any).languageModelRegistry = registry;
    (executionService as any).languageModelService = llm;
    (executionService as any).preferenceService = preferenceService;
    if (options.storage) {
        (executionService as any).executionHistoryStore = options.storage;
    }
    return { executionService, registry, llm, preferenceService, storage: options.storage };
}

function cancelledToken(cancelled = true): CancellationToken & { cancel(): void } {
    const listeners = new Set<() => void>();
    const token = {
        get isCancellationRequested(): boolean {
            return cancelled;
        },
        onCancellationRequested(listener: () => void): { dispose(): void } {
            listeners.add(listener);
            return { dispose: () => listeners.delete(listener) };
        },
        cancel(): void {
            cancelled = true;
            for (const listener of [...listeners]) {
                listener();
            }
        },
    };
    return token as CancellationToken & { cancel(): void };
}

async function testSuccessfulExecutionKeepsResolutionSnapshot(): Promise<void> {
    const { executionService, registry, llm } = createServices({
        models: {
            'openrouter/fast': { id: 'openrouter/fast', name: 'Fast slot', vendor: 'OpenRouter' },
        },
        assignedIdentifiers: {
            'geoapp-translate-description': 'openrouter/fast',
        },
        response: {
            text: 'ok',
            usage: { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 2 },
        },
    });

    const result = await executionService.sendTaskRequest('translate-description', {
        messages: [{ actor: 'user', type: 'text', text: 'hello' }],
    });

    assert.equal(result.execution.status, 'succeeded');
    assert.equal(result.execution.resolution.requestedIdentifier, 'openrouter/fast');
    assert.equal(result.execution.resolution.resolvedModelId, 'openrouter/fast');
    assert.equal(result.execution.resolution.locality, 'remote');
    assert.deepEqual(result.execution.tokenUsage, {
        inputTokens: 7,
        outputTokens: 3,
        cacheReadInputTokens: 2,
    });
    assert.equal(llm.requests.length, 1);
    assert.equal(llm.requests[0].request.agentId, 'geoapp-translate-description');
    assert.equal(registry.selections[0].identifier, 'openrouter/fast');
    assert.ok(Object.isFrozen(result.execution));
    assert.ok(Object.isFrozen(result.execution.resolution));
}

async function testSharedOperationKeepsModelSnapshotAndAttempts(): Promise<void> {
    const { executionService, llm } = createServices({});
    const execution = await executionService.beginTaskExecution('logs-analysis', {
        operationId: 'analysis-42',
    });

    await execution.sendRequest({ messages: [{ actor: 'user', type: 'text', text: 'one' }] });
    await execution.sendRequest({ messages: [{ actor: 'user', type: 'text', text: 'two' }] });

    const history = executionService.getRecentExecutions('logs-analysis');
    assert.equal(history.length, 2);
    assert.deepEqual(history.map(record => record.attempt).sort(), [1, 2]);
    assert.ok(history.every(record => record.operationId === 'analysis-42'));
    assert.ok(history.every(record => record.resolution.resolvedModelId === 'ollama/llama3.1'));
    assert.equal(llm.requests.length, 2);
    assert.ok(llm.requests.every(call => call.request.sessionId === execution.sessionId));
}

async function testUnavailableResolutionDoesNotDispatch(): Promise<void> {
    const { executionService, llm } = createServices({ models: {} });

    await assert.rejects(
        () => executionService.beginTaskExecution('logs-analysis'),
        /n’est pas exécutable \(unavailable\)/
    );
    assert.equal(llm.requests.length, 0);
    const latest = executionService.getLatestExecution('logs-analysis');
    assert.equal(latest?.status, 'failed');
    assert.equal(latest?.attempt, 0);
}

async function testStrictLocalResolutionDoesNotDispatchCloudModel(): Promise<void> {
    const { executionService, llm } = createServices({
        models: {
            'default/universal': { id: 'openai/gpt-4o', vendor: 'OpenAI' },
        },
    });

    await assert.rejects(
        () => executionService.beginTaskExecution('formula-local'),
        /non compatible local/i
    );
    assert.equal(llm.requests.length, 0);
    assert.equal(executionService.getLatestExecution('formula-local')?.status, 'failed');
}

async function testRequiredVisionCapabilityDoesNotDispatch(): Promise<void> {
    const { executionService, llm } = createServices({
        models: {
            'default/universal': { id: 'ollama/text-only', vendor: 'Ollama', capabilities: { imageInput: false } },
        },
    });

    await assert.rejects(
        () => executionService.beginTaskExecution('ocr-theia'),
        /vision non supportée/i
    );
    assert.equal(llm.requests.length, 0);
    assert.equal(executionService.getLatestExecution('ocr-theia')?.status, 'failed');
    assert.equal(executionService.getLatestExecution('ocr-theia')?.errorCode, 'resolution-unsupported');
}

async function testBackendOverrideCannotBypassRequiredCapability(): Promise<void> {
    let called = false;
    const { executionService } = createServices({
        preferences: {
            'geoApp.ocr.visionProvider': 'lmstudio',
            'geoApp.ocr.lmstudio.baseUrl': 'http://localhost:1234',
            'geoApp.ocr.lmstudio.model': 'text-only',
            'geoApp.ai.modelCapabilities': {
                'text-only': { vision: false },
            },
        },
    });

    await assert.rejects(
        () => executionService.runOperation('ocr-backend-plugin', async () => {
            called = true;
            return { status: 'ok' };
        }, {
            backendExecution: {
                provider: 'lmstudio',
                baseUrl: 'http://localhost:1234',
                model: 'text-only',
            },
        }),
        /vision non supportée/i
    );

    assert.equal(called, false);
    assert.equal(executionService.getLatestExecution('ocr-backend-plugin')?.status, 'failed');
}

async function testCancellationBeforeDispatchDoesNotCallProvider(): Promise<void> {
    const { executionService, llm } = createServices({});
    const execution = await executionService.beginTaskExecution('translate-description');

    await assert.rejects(
        () => execution.sendRequest({
            messages: [{ actor: 'user', type: 'text', text: 'cancel me' }],
        }, { cancellationToken: cancelledToken(true) }),
        CancellationError
    );

    assert.equal(llm.requests.length, 0);
    assert.equal(executionService.getLatestExecution('translate-description')?.status, 'cancelled');
}

async function testCancellationDuringStreamIsRecordedOnce(): Promise<void> {
    async function* stream(): AsyncIterable<{ content: string }> {
        yield { content: 'late ' };
        yield { content: 'result' };
    }

    const { executionService } = createServices({ response: { stream: stream() } });
    const token = cancelledToken(false);
    const result = await executionService.sendTaskRequest('translate-description', {
        messages: [{ actor: 'user', type: 'text', text: 'stream' }],
    }, { cancellationToken: token });

    token.cancel();
    let collected = '';
    await assert.rejects(async () => {
        for await (const part of (result.response as { stream: AsyncIterable<{ content: string }> }).stream) {
            collected += part.content;
        }
    }, CancellationError);

    assert.equal(collected, '');
    const history = executionService.getRecentExecutions('translate-description');
    assert.equal(history.length, 1);
    assert.equal(history[0].status, 'cancelled');
    assert.equal(history[0].attempt, 1);
}

async function testStreamUsageIsRecordedAfterCompletion(): Promise<void> {
    async function* stream(): AsyncIterable<unknown> {
        yield { content: 'partial ' };
        yield { input_tokens: 11, output_tokens: 5 };
        yield { content: 'done' };
    }

    const { executionService } = createServices({ response: { stream: stream() } });
    const result = await executionService.sendTaskRequest('translate-description', {
        messages: [{ actor: 'user', type: 'text', text: 'stream' }],
    });

    for await (const _part of (result.response as { stream: AsyncIterable<unknown> }).stream) {
        // consume all stream parts
    }

    const latest = executionService.getLatestExecution('translate-description');
    assert.equal(latest?.status, 'succeeded');
    assert.deepEqual(latest?.tokenUsage, { inputTokens: 11, outputTokens: 5 });
}

async function testBackendOperationRecordsReportedModelAndUsage(): Promise<void> {
    const { executionService } = createServices({});

    const result = await executionService.runOperation('ai-scorer', async () => ({
        data: {
            status: 'ok',
            provider: 'lmstudio',
            model: 'requested-model',
            reported_model: 'provider-model',
            items: [0, 1].map(index => ({
                metadata: {
                    ai_scoring: {
                        provider: 'lmstudio',
                        model: 'requested-model',
                        reported_model: 'provider-model',
                        batch_index: 0,
                        usage: { prompt_tokens: 42, completion_tokens: 8, total_tokens: 50 },
                    },
                },
            })),
        },
    }), {
        backendExecution: {
            provider: 'lmstudio',
            baseUrl: 'http://localhost:1234',
            model: 'requested-model',
        },
    });

    assert.equal(result.execution.status, 'succeeded');
    assert.equal(result.execution.reportedProvider, 'lmstudio');
    assert.equal(result.execution.reportedModel, 'provider-model');
    assert.deepEqual(result.execution.tokenUsage, {
        inputTokens: 42,
        outputTokens: 8,
        totalTokens: 50,
    });
}

async function testOutputValidationKeepsBusinessErrorCode(): Promise<void> {
    const { executionService } = createServices({});

    await assert.rejects(
        () => executionService.runOperation('ai-scorer', async () => {
            throw new GeoAppAiOutputError('invalid-json', 'Réponse non JSON');
        }, {
            backendExecution: {
                provider: 'lmstudio',
                baseUrl: 'http://localhost:1234',
                model: 'local-scorer',
            },
        }),
        GeoAppAiOutputError
    );

    const latest = executionService.getLatestExecution('ai-scorer');
    assert.equal(latest?.status, 'failed');
    assert.equal(latest?.errorCode, 'invalid-json');
}

async function testBackendOperationUsesRuntimeSnapshotWithoutTheiaDispatch(): Promise<void> {
    const { executionService, llm } = createServices({});

    const result = await executionService.runOperation('ai-scorer', async context => {
        assert.equal(context.task.executionPath, 'backend-plugin');
        return { status: 'ok', count: 1 };
    }, {
        backendExecution: {
            provider: 'lmstudio',
            baseUrl: 'http://localhost:1234',
            model: 'local-scorer',
            source: 'operation',
            sourceLabel: 'paramètres explicites de la requête',
        },
    });

    assert.equal(result.response.status, 'ok');
    assert.equal(result.execution.status, 'succeeded');
    assert.equal(result.execution.taskId, 'ai-scorer');
    assert.equal(result.execution.resolution.provider, 'lmstudio');
    assert.equal(result.execution.resolution.locality, 'local');
    assert.equal(llm.requests.length, 0);
}

async function testExecutionsCanBeScopedBySubject(): Promise<void> {
    const { executionService } = createServices({});

    const first = await executionService.beginTaskExecution('translate-description', {
        operationId: 'translation-1',
        subjectId: 'geocache-1',
    });
    await first.sendRequest({ messages: [{ actor: 'user', type: 'text', text: 'one' }] });

    const second = await executionService.beginTaskExecution('translate-description', {
        operationId: 'translation-2',
        subjectId: 'geocache-2',
    });
    await second.sendRequest({ messages: [{ actor: 'user', type: 'text', text: 'two' }] });

    assert.equal(
        executionService.getLatestExecution('translate-description', 'geocache-1')?.operationId,
        'translation-1'
    );
    assert.equal(
        executionService.getLatestExecution('translate-description', 'geocache-2')?.operationId,
        'translation-2'
    );
    assert.equal(
        executionService.getLatestExecution('translate-description', 'geocache-3'),
        undefined
    );
}

async function testBackendOperationKeepsSubjectInContextAndRecord(): Promise<void> {
    const { executionService } = createServices({
        preferences: {
            'geoApp.ai.modelCapabilities': {
                'vision-local': { vision: true },
            },
        },
    });

    const result = await executionService.runOperation('ocr-backend-plugin', async context => {
        assert.equal(context.subjectId, 'image-42');
        return { status: 'ok' };
    }, {
        subjectId: 'image-42',
        backendExecution: {
            provider: 'lmstudio',
            baseUrl: 'http://localhost:1234',
            model: 'vision-local',
        },
    });

    assert.equal(result.execution.subjectId, 'image-42');
    assert.equal(
        executionService.getLatestExecution('ocr-backend-plugin', 'image-42')?.id,
        result.execution.id
    );
    assert.equal(
        executionService.getLatestExecution('ocr-backend-plugin', 'image-43'),
        undefined
    );
}

async function testProviderFailureIsRecordedAndSanitized(): Promise<void> {
    class FailingLlm {
        async sendRequest(): Promise<never> {
            throw new Error('401 Bearer sk-secret-value-123456789 api_key=abcdef123456789');
        }
    }

    const { executionService } = createServices({});
    (executionService as any).languageModelService = new FailingLlm();

    await assert.rejects(
        () => executionService.sendTaskRequest('translate-description', {
            messages: [{ actor: 'user', type: 'text', text: 'fail' }],
        }),
        /401/
    );

    const record = executionService.getLatestExecution('translate-description');
    assert.equal(record?.status, 'failed');
    assert.ok(record?.errorMessage?.includes('[redacted]'));
    assert.ok(!record?.errorMessage?.includes('sk-secret-value-123456789'));
    assert.ok(!record?.errorMessage?.includes('abcdef123456789'));
}

async function testPersistentHistoryRestoresMetadataOnlyAndClearsOnDisable(): Promise<void> {
    const storage = new FakeStorageService();
    storage.data.set('geoapp.ai.executionHistory.v1', {
        version: 1,
        records: [
            'malformed-entry',
            {
                id: 'restored-1',
                taskId: 'translate-description',
                taskLabel: 'Traduction de description',
                subjectId: 'geocache-42',
                status: 'succeeded',
                startedAt: '2026-01-01T00:00:00.000Z',
                completedAt: '2026-01-01T00:00:00.160Z',
                durationMs: 160,
                attempt: 1,
                requestId: 'restore-request',
                operationId: 'restore-operation',
                sessionId: 'restore-session',
                resolution: {
                    taskId: 'translate-description',
                    source: 'default',
                    sourceLabel: 'default',
                    requestedIdentifier: 'default/universal',
                    resolvedModelId: 'ollama/llama3.1',
                    backingModel: 'llama3.1',
                    displayModel: 'default/universal → ollama/llama3.1',
                    provider: 'ollama',
                    locality: 'local',
                    executionPath: 'theia-language-model',
                    transport: 'theia-managed',
                    status: 'ready',
                    diagnostics: [],
                },
                reportedProvider: 'ollama',
                reportedModel: 'llama3.1',
                tokenUsage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
            },
        ],
    });

    const { executionService, preferenceService } = createServices({
        storage,
        preferences: {
            'geoApp.ai.executionHistory.enabled': true,
            'geoApp.ai.executionHistory.maxEntries': 10,
        },
    });
    (executionService as any).initializePersistence();
    await Promise.resolve();
    await Promise.resolve();

    const restored = executionService.getLatestExecution('translate-description', 'geocache-42');
    assert.equal(restored?.id, 'restored-1');
    assert.equal(restored?.reportedModel, 'llama3.1');
    assert.deepEqual(restored?.tokenUsage, { inputTokens: 3, outputTokens: 2, totalTokens: 5 });
    assert.equal(executionService.getRecentExecutions().length, 1);

    const metrics = executionService.getExecutionMetrics();
    assert.equal(metrics.total.executions, 1);
    assert.equal(metrics.total.succeeded, 1);
    assert.equal(metrics.total.durationMs, 160);
    assert.equal(metrics.total.tokenUsage?.totalTokens, 5);
    assert.equal(metrics.byTask[0].key, 'translate-description');
    assert.equal(metrics.byProvider[0].key, 'ollama');

    await preferenceService.set('geoApp.ai.executionHistory.enabled', false);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(executionService.getRecentExecutions().length, 1);
    assert.equal(storage.data.has('geoapp.ai.executionHistory.v1'), false);
}

async function testPersistentHistoryStoresFinalMetadataAndEnforcesLimit(): Promise<void> {
    const storage = new FakeStorageService();
    const { executionService } = createServices({
        storage,
        preferences: {
            'geoApp.ai.executionHistory.enabled': true,
            'geoApp.ai.executionHistory.maxEntries': 10,
        },
        response: { text: 'secret-response-body' },
    });
    (executionService as any).initializePersistence();

    for (let index = 0; index < 12; index++) {
        await executionService.sendTaskRequest('translate-description', {
            messages: [{ actor: 'user', type: 'text', text: `secret-prompt-${index}` }],
        }, {
            operationId: `translation-${index}`,
            subjectId: 'geocache-secret',
        });
        await Promise.resolve();
        await Promise.resolve();
    }

    const stored = storage.data.get('geoapp.ai.executionHistory.v1') as { version: number; records: Array<Record<string, unknown>> };
    assert.equal(executionService.getRecentExecutions('translate-description').length, 10);
    assert.equal(stored.version, 1);
    assert.equal(stored.records.length, 10);
    assert.ok(stored.records.every(record => record.subjectId === 'geocache-secret'));
    assert.ok(stored.records.every(record => record.status === 'succeeded'));
    assert.ok(stored.records.every(record => record.operationId !== undefined));

    const serialized = JSON.stringify(stored);
    assert.ok(!serialized.includes('secret-prompt'));
    assert.ok(!serialized.includes('secret-response-body'));
    assert.ok(!serialized.includes('messages'));
}

async function testPersistentHistoryDoesNotWriteWhenDisabled(): Promise<void> {
    const storage = new FakeStorageService();
    const { executionService } = createServices({ storage });
    (executionService as any).initializePersistence();

    await executionService.sendTaskRequest('translate-description', {
        messages: [{ actor: 'user', type: 'text', text: 'memory only' }],
    });
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(executionService.getRecentExecutions('translate-description').length, 1);
    assert.equal(storage.loads, 0);
    assert.equal(storage.saves, 0);
    assert.equal(storage.clears, 0);
    assert.equal(storage.data.has('geoapp.ai.executionHistory.v1'), false);
}

async function testPersistentHistoryStoresFailedCancelledAndResolutionFailure(): Promise<void> {
    const storage = new FakeStorageService();
    const { executionService } = createServices({
        storage,
        models: {},
        preferences: { 'geoApp.ai.executionHistory.enabled': true },
    });
    (executionService as any).initializePersistence();

    await assert.rejects(
        () => executionService.sendTaskRequest('logs-analysis', {
            messages: [{ actor: 'user', type: 'text', text: 'analyse' }],
        }),
        /n’est pas exécutable/
    );
    await Promise.resolve();
    await Promise.resolve();

    let stored = storage.data.get('geoapp.ai.executionHistory.v1') as { records: Array<Record<string, unknown>> };
    assert.equal(stored.records[0].status, 'failed');
    assert.equal(stored.records[0].errorCode, 'resolution-unavailable');

    const readyServices = createServices({
        storage,
        preferences: { 'geoApp.ai.executionHistory.enabled': true },
    });
    const readyService = readyServices.executionService;
    (readyService as any).initializePersistence();

    await assert.rejects(
        () => readyService.sendTaskRequest('translate-description', {
            messages: [{ actor: 'user', type: 'text', text: 'annulé' }],
        }, { cancellationToken: cancelledToken() }),
        CancellationError
    );
    await Promise.resolve();
    await Promise.resolve();

    stored = storage.data.get('geoapp.ai.executionHistory.v1') as { records: Array<Record<string, unknown>> };
    assert.equal(stored.records[0].status, 'cancelled');
    assert.equal(stored.records[0].errorCode, 'canceled');
}

async function testPersistentHistoryStoresSanitizedError(): Promise<void> {
    class FailingLlm {
        async sendRequest(): Promise<never> {
            throw new Error('Provider failed Bearer sk-secret-value-123456789 api_key=abcdef123456789');
        }
    }

    const storage = new FakeStorageService();
    const { executionService } = createServices({
        storage,
        preferences: { 'geoApp.ai.executionHistory.enabled': true },
    });
    (executionService as any).languageModelService = new FailingLlm();
    (executionService as any).initializePersistence();

    await assert.rejects(
        () => executionService.sendTaskRequest('translate-description', {
            messages: [{ actor: 'user', type: 'text', text: 'secret-prompt' }],
        }),
        /Provider failed/
    );
    await Promise.resolve();
    await Promise.resolve();

    const stored = storage.data.get('geoapp.ai.executionHistory.v1') as { records: Array<Record<string, unknown>> };
    const serialized = JSON.stringify(stored);
    assert.equal(stored.records[0].status, 'failed');
    assert.ok(serialized.includes('[redacted]'));
    assert.ok(!serialized.includes('sk-secret-value-123456789'));
    assert.ok(!serialized.includes('abcdef123456789'));
    assert.ok(!serialized.includes('secret-prompt'));
}

async function testExecutionMetricsAggregateByTaskAndProvider(): Promise<void> {
    const { executionService } = createServices({
        preferences: {
            'geoApp.ai.modelCapabilities': {
                'text-only': { vision: false },
            },
        },
        response: {
            text: 'ok',
            usage: { input_tokens: 2, output_tokens: 3 },
        },
    });

    await executionService.sendTaskRequest('translate-description', {
        messages: [{ actor: 'user', type: 'text', text: 'one' }],
    });
    await executionService.sendTaskRequest('translate-description', {
        messages: [{ actor: 'user', type: 'text', text: 'two' }],
    });
    await assert.rejects(
        () => executionService.sendTaskRequest('translate-description', {
            messages: [{ actor: 'user', type: 'text', text: 'cancelled' }],
        }, { cancellationToken: cancelledToken() }),
        CancellationError
    );
    await assert.rejects(
        () => executionService.runOperation('ocr-backend-plugin', async () => ({ status: 'unused' }), {
            backendExecution: {
                provider: 'lmstudio',
                baseUrl: 'http://localhost:1234',
                model: 'text-only',
            },
        }),
        GeoAppAiExecutionUnavailableError
    );

    const metrics = executionService.getExecutionMetrics();
    assert.equal(metrics.total.executions, 4);
    assert.equal(metrics.total.succeeded, 2);
    assert.equal(metrics.total.cancelled, 1);
    assert.equal(metrics.total.failed, 1);
    assert.equal(metrics.total.successRate, 0.5);
    assert.equal(metrics.total.tokenUsage?.inputTokens, 4);
    assert.equal(metrics.total.tokenUsage?.outputTokens, 6);

    const translate = metrics.byTask.find(bucket => bucket.key === 'translate-description');
    const ocr = metrics.byTask.find(bucket => bucket.key === 'ocr-backend-plugin');
    assert.equal(translate?.executions, 3);
    assert.equal(ocr?.failed, 1);

    const ollama = metrics.byProvider.find(bucket => bucket.key === 'ollama');
    const lmstudio = metrics.byProvider.find(bucket => bucket.key === 'lmstudio');
    assert.equal(ollama?.executions, 3);
    assert.equal(lmstudio?.failed, 1);
}

async function testPersistentHistoryRejectsUnknownVersion(): Promise<void> {
    const storage = new FakeStorageService();
    storage.data.set('geoapp.ai.executionHistory.v1', {
        version: 99,
        records: [{ id: 'future-record' }],
    });
    const { executionService } = createServices({
        storage,
        preferences: { 'geoApp.ai.executionHistory.enabled': true },
    });
    (executionService as any).initializePersistence();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(executionService.getRecentExecutions().length, 0);
}

async function testStorageFailuresDoNotBreakExecution(): Promise<void> {
    class FailingStorage extends FakeStorageService {
        async load(): Promise<unknown> {
            throw new Error('read failed');
        }

        async save(): Promise<void> {
            throw new Error('write failed');
        }
    }

    const { executionService } = createServices({
        storage: new FailingStorage(),
        preferences: { 'geoApp.ai.executionHistory.enabled': true },
    });
    (executionService as any).initializePersistence();

    const result = await executionService.sendTaskRequest('translate-description', {
        messages: [{ actor: 'user', type: 'text', text: 'still works' }],
    });
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(result.execution.status, 'succeeded');
    assert.equal(executionService.getRecentExecutions('translate-description').length, 1);
    assert.equal(executionService.getExecutionHistoryPersistenceIssue(), 'écriture impossible : write failed');
}

async function run(): Promise<void> {
    await testSuccessfulExecutionKeepsResolutionSnapshot();
    await testSharedOperationKeepsModelSnapshotAndAttempts();
    await testUnavailableResolutionDoesNotDispatch();
    await testStrictLocalResolutionDoesNotDispatchCloudModel();
    await testRequiredVisionCapabilityDoesNotDispatch();
    await testBackendOverrideCannotBypassRequiredCapability();
    await testCancellationBeforeDispatchDoesNotCallProvider();
    await testCancellationDuringStreamIsRecordedOnce();
    await testStreamUsageIsRecordedAfterCompletion();
    await testBackendOperationRecordsReportedModelAndUsage();
    await testOutputValidationKeepsBusinessErrorCode();
    await testBackendOperationUsesRuntimeSnapshotWithoutTheiaDispatch();
    await testExecutionsCanBeScopedBySubject();
    await testBackendOperationKeepsSubjectInContextAndRecord();
    await testProviderFailureIsRecordedAndSanitized();
    await testPersistentHistoryRestoresMetadataOnlyAndClearsOnDisable();
    await testPersistentHistoryStoresFinalMetadataAndEnforcesLimit();
    await testPersistentHistoryDoesNotWriteWhenDisabled();
    await testPersistentHistoryStoresFailedCancelledAndResolutionFailure();
    await testPersistentHistoryStoresSanitizedError();
    await testExecutionMetricsAggregateByTaskAndProvider();
    await testPersistentHistoryRejectsUnknownVersion();
    await testStorageFailuresDoNotBreakExecution();
    console.log('geoapp-ai-execution-service tests passed');
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
