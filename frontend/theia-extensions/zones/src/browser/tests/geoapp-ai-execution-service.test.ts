import * as assert from 'assert/strict';
import { CancellationError, CancellationToken } from '@theia/core';
import { GeoAppAiExecutionService, GeoAppAiOutputError } from '../geoapp-ai-execution-service';
import { GeoAppAiModelResolutionService } from '../geoapp-ai-model-resolution-service';

interface FakeModel {
    id: string;
    name?: string;
    vendor?: string;
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
    get<T>(key: string, fallback: T): T {
        return key === 'ai-features.ollama.ollamaHost' ? 'http://localhost:11434' as T : fallback;
    }

    onPreferenceChanged(): { dispose(): void } {
        return { dispose: () => undefined };
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
}): {
    executionService: GeoAppAiExecutionService;
    registry: FakeLanguageModelRegistry;
    llm: FakeLanguageModelService;
} {
    const registry = new FakeLanguageModelRegistry(options.models ?? {
        'default/universal': { id: 'ollama/llama3.1', name: 'Llama', vendor: 'Ollama' },
    });
    const llm = new FakeLanguageModelService(options.response);
    const resolutionService = new GeoAppAiModelResolutionService();
    (resolutionService as any).preferenceService = new FakePreferenceService();
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
    return { executionService, registry, llm };
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

async function run(): Promise<void> {
    await testSuccessfulExecutionKeepsResolutionSnapshot();
    await testSharedOperationKeepsModelSnapshotAndAttempts();
    await testUnavailableResolutionDoesNotDispatch();
    await testStrictLocalResolutionDoesNotDispatchCloudModel();
    await testCancellationBeforeDispatchDoesNotCallProvider();
    await testCancellationDuringStreamIsRecordedOnce();
    await testStreamUsageIsRecordedAfterCompletion();
    await testBackendOperationRecordsReportedModelAndUsage();
    await testOutputValidationKeepsBusinessErrorCode();
    await testBackendOperationUsesRuntimeSnapshotWithoutTheiaDispatch();
    await testProviderFailureIsRecordedAndSanitized();
    console.log('geoapp-ai-execution-service tests passed');
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
