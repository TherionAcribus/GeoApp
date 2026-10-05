import * as assert from 'assert/strict';
import { GeoAppAiSetupService } from '../geoapp-ai-setup-service';

interface FakeModel {
    id: string;
    name?: string;
    model?: string;
    status?: { status: 'ready' | 'unavailable' };
}

interface SetupServices {
    preferences?: Record<string, unknown>;
    models?: FakeModel[];
    /** Modèles enregistrés à la volée quand une préférence change (simule les fournisseurs). */
    registerOnPreference?: (key: string, value: unknown, models: FakeModel[]) => void;
    aideStatus?: string;
    fetch?: (url: string) => unknown;
    send?: (model: FakeModel) => Promise<unknown>;
    aliasTargets?: string[];
}

function createService(services: SetupServices = {}) {
    const service = new GeoAppAiSetupService();
    const preferences: Record<string, unknown> = { ...(services.preferences ?? {}) };
    const models: FakeModel[] = [...(services.models ?? [])];
    const aliasSelections: Array<{ aliasId: string; modelId: string }> = [];
    const sent: FakeModel[] = [];
    let selected: string | undefined;

    (service as any).preferenceService = {
        ready: Promise.resolve(),
        get: <T>(key: string, fallback: T): T => key in preferences ? preferences[key] as T : fallback,
        set: async (key: string, value: unknown) => {
            preferences[key] = value;
            services.registerOnPreference?.(key, value, models);
        },
    };
    (service as any).modelResolutionService = {
        onDidChange: () => ({ dispose: () => undefined }),
        resolveAll: async () => [{ taskId: 'aide', status: services.aideStatus ?? 'unavailable', diagnostics: [] }],
        normalizeModelsEndpoint: (baseUrl: string) => /\/v\d+$/.test(baseUrl) ? baseUrl : `${baseUrl}/v1`,
        fetchJson: async (url: string) => {
            if (!services.fetch) {
                throw new Error('fetch failed');
            }
            return services.fetch(url);
        },
    };
    (service as any).languageModelRegistry = {
        getLanguageModels: async () => models,
        getLanguageModel: async (id: string) => models.find(model => model.id === id),
        onChange: () => ({ dispose: () => undefined }),
    };
    (service as any).languageModelAliasRegistry = {
        ready: Promise.resolve(),
        resolveAlias: () => selected ? [selected] : services.aliasTargets ?? ['anthropic/claude-opus-5'],
        selectModelForAlias: (aliasId: string, modelId: string) => {
            aliasSelections.push({ aliasId, modelId });
            selected = modelId || undefined;
        },
    };
    (service as any).languageModelService = {
        sendRequest: async (model: FakeModel) => {
            sent.push(model);
            return services.send ? services.send(model) : { text: 'OK' };
        },
    };
    (service as any).delay = async () => undefined;
    (service as any).scheduleStatusChange = () => undefined;
    return { service, preferences, models, aliasSelections, sent };
}

function reasonOf(result: unknown): string | undefined {
    return (result as { reason?: string }).reason;
}

async function testStatusFollowsAideTask(): Promise<void> {
    const notReady = createService({ aideStatus: 'unavailable' });
    assert.equal((await notReady.service.getStatus()).ready, false);

    const ready = createService({
        aideStatus: 'ready',
        aliasTargets: ['openrouter/strong'],
        models: [{ id: 'openrouter/strong' }],
        preferences: { 'geoApp.ai.openRouter.model.strong': 'vendor/model-x', 'geoApp.ai.setup.dismissed': true },
    });
    const status = await ready.service.getStatus();
    assert.equal(status.ready, true);
    assert.equal(status.dismissed, true);
    assert.equal(status.providerId, 'openrouter');
    assert.equal(status.defaultModelId, 'openrouter/strong');
    assert.equal(status.defaultModelLabel, 'vendor/model-x');
}

async function testApplyOpenRouter(): Promise<void> {
    const context = createService({
        registerOnPreference: (key, value, models) => {
            if (key === 'geoApp.ai.openRouter.model.strong') {
                models.splice(0, models.length, { id: 'openrouter/strong', model: String(value) });
            }
        },
        // Le slot existe déjà avec l'ancien modèle : apply doit attendre le nouveau.
        models: [{ id: 'openrouter/strong', model: 'old/model' }],
    });
    await context.service.saveCredentials('openrouter', { apiKey: '  sk-or-secret-123456  ' });
    assert.equal(context.preferences['geoApp.ai.openRouter.apiKey'], 'sk-or-secret-123456');
    assert.equal(context.preferences['geoApp.ai.openRouter.enabled'], true);

    const phases: string[] = [];
    const result = await context.service.apply('openrouter', 'vendor/model-x', phase => phases.push(phase));
    assert.equal(result.ok, true);
    assert.deepEqual(phases, ['connection', 'model', 'test', 'activation']);
    assert.equal(context.preferences['geoApp.ai.openRouter.model.strong'], 'vendor/model-x');
    assert.equal(context.sent[0]?.model, 'vendor/model-x');
    assert.deepEqual(context.aliasSelections, [{ aliasId: 'default/universal', modelId: 'openrouter/strong' }]);
}

async function testApplyWithoutKeyIsRefused(): Promise<void> {
    const context = createService();
    const result = await context.service.apply('anthropic', 'claude-x');
    assert.equal(result.ok, false);
    assert.equal((result as { phase?: string }).phase, 'connection');
    assert.equal(context.aliasSelections.length, 0);
}

async function testApplyOllamaKeepsExistingModels(): Promise<void> {
    const context = createService({
        preferences: { 'ai-features.ollama.ollamaModels': ['existing:7b'] },
        registerOnPreference: (key, value, models) => {
            if (key === 'ai-features.ollama.ollamaModels') {
                models.splice(0, models.length, ...(value as string[]).map(name => ({ id: `ollama/${name}` })));
            }
        },
    });
    const result = await context.service.apply('ollama', 'new:8b');
    assert.equal(result.ok, true);
    assert.deepEqual(context.preferences['ai-features.ollama.ollamaModels'], ['existing:7b', 'new:8b']);
    assert.equal(context.aliasSelections[0]?.modelId, 'ollama/new:8b');

    await context.service.apply('ollama', 'new:8b');
    assert.deepEqual(context.preferences['ai-features.ollama.ollamaModels'], ['existing:7b', 'new:8b']);
}

async function testApplyLmStudioUpsertsCustomModel(): Promise<void> {
    const context = createService({
        preferences: {
            'ai-features.openAiCustom.customOpenAiModels': [
                { id: 'mine', model: 'mine', url: 'http://example/v1' },
                { id: 'lmstudio/qwen', model: 'qwen', url: 'http://old:1/v1', enableStreaming: false },
            ],
            'geoApp.ocr.lmstudio.baseUrl': 'http://localhost:1234',
        },
        registerOnPreference: (key, value, models) => {
            if (key === 'ai-features.openAiCustom.customOpenAiModels') {
                models.splice(0, models.length, ...(value as Array<{ id: string }>).map(entry => ({ id: entry.id })));
            }
        },
    });
    const result = await context.service.apply('lmstudio', 'qwen');
    assert.equal(result.ok, true);
    const entries = context.preferences['ai-features.openAiCustom.customOpenAiModels'] as Array<Record<string, unknown>>;
    assert.equal(entries.length, 2);
    assert.deepEqual(entries[0], { id: 'mine', model: 'mine', url: 'http://example/v1' });
    assert.equal(entries[1].url, 'http://localhost:1234/v1');
    assert.equal(entries[1].enableStreaming, false);
    assert.equal(context.aliasSelections[0]?.modelId, 'lmstudio/qwen');
}

async function testFailedTestLeavesAliasUntouched(): Promise<void> {
    const context = createService({
        preferences: { 'ai-features.anthropic.AnthropicApiKey': 'sk-ant-secret-abcdef' },
        models: [{ id: 'anthropic/claude-x' }],
        send: async () => { throw new Error('401 invalid x-api-key sk-ant-secret-abcdef'); },
    });
    const result = await context.service.apply('anthropic', 'claude-x');
    assert.equal(result.ok, false);
    const failure = result as { phase?: string; reason?: string; detail?: string };
    assert.equal(failure.phase, 'test');
    assert.equal(failure.reason, 'invalid-key');
    assert.ok(failure.detail && !failure.detail.includes('sk-ant-secret-abcdef'), 'la clé ne doit pas apparaître');
    assert.equal(context.aliasSelections.length, 0);
}

async function testFailureClassification(): Promise<void> {
    const cases: Array<[unknown, string]> = [
        [Object.assign(new Error('Unauthorized'), { status: 401 }), 'invalid-key'],
        [new Error('402 Payment Required'), 'no-credit'],
        [new Error('429 rate limit'), 'no-credit'],
        [new Error('404 model not found'), 'model-not-found'],
        [new Error('fetch failed'), 'unreachable'],
        [Object.assign(new Error('boom'), { code: 'ECONNREFUSED' }), 'unreachable'],
        [new Error('something odd'), 'unknown'],
    ];
    for (const [error, expected] of cases) {
        const context = createService({
            models: [{ id: 'openai/gpt-x' }],
            send: async () => { throw error; },
        });
        const result = await context.service.testModel('openai/gpt-x');
        assert.equal(reasonOf(result), expected, String((error as Error).message));
    }
    const missing = await createService().service.testModel('openai/absent');
    assert.equal(reasonOf(missing), 'not-registered');
}

async function testStreamErrorsAreCaught(): Promise<void> {
    const context = createService({
        models: [{ id: 'google/gemini-x' }],
        send: async () => ({
            stream: (async function* () {
                yield { content: 'O' };
                throw new Error('403 forbidden');
            })(),
        }),
    });
    const result = await context.service.testModel('google/gemini-x');
    assert.equal(reasonOf(result), 'invalid-key');
}

async function testListModels(): Promise<void> {
    const openRouter = createService({
        fetch: () => ({
            data: [
                { id: 'b/with-tools', name: 'B', supported_parameters: ['tools'], architecture: { input_modalities: ['text', 'image'] } },
                { id: 'a/no-tools', supported_parameters: ['temperature'] },
            ],
        }),
    });
    const routed = await openRouter.service.listModels('openrouter');
    assert.deepEqual(routed.map(model => model.id), ['b/with-tools']);
    assert.equal(routed[0].supportsVision, true);
    assert.equal(openRouter.service.getPreselectedModel('openrouter', routed), undefined);

    const anthropic = createService({
        models: [
            { id: 'anthropic/claude-haiku-4-5' },
            { id: 'anthropic/claude-opus-5' },
            { id: 'anthropic/offline', status: { status: 'unavailable' } },
            { id: 'openai/gpt-x' },
        ],
    });
    const discovered = await anthropic.service.listModels('anthropic');
    assert.deepEqual(discovered.map(model => model.id), ['claude-opus-5', 'claude-haiku-4-5']);
    assert.equal(discovered[0].recommended, true);
    assert.equal(anthropic.service.getPreselectedModel('anthropic', discovered), 'claude-opus-5');

    const local = createService({
        fetch: url => url.endsWith('/api/tags')
            ? { models: [{ name: 'llama:8b' }] }
            : { data: [{ id: 'qwen' }] },
    });
    assert.deepEqual(await local.service.detectLocalProviders(), [
        { id: 'ollama', endpoint: 'http://localhost:11434', models: ['llama:8b'] },
        { id: 'lmstudio', endpoint: 'http://localhost:1234', models: ['qwen'] },
    ]);
    assert.deepEqual(await createService().service.detectLocalProviders(), []);
}

async function testProviderStateNeverExposesKey(): Promise<void> {
    const context = createService({ preferences: { 'ai-features.google.apiKey': 'AIza-secret-key' } });
    const state = context.service.getProviderState('google');
    assert.deepEqual(state, { configured: true });
    assert.equal(context.service.redact('échec avec AIza-secret-key et Bearer abc.def'), 'échec avec [clé masquée] et Bearer [clé masquée]');
}

async function run(): Promise<void> {
    await testStatusFollowsAideTask();
    await testApplyOpenRouter();
    await testApplyWithoutKeyIsRefused();
    await testApplyOllamaKeepsExistingModels();
    await testApplyLmStudioUpsertsCustomModel();
    await testFailedTestLeavesAliasUntouched();
    await testFailureClassification();
    await testStreamErrorsAreCaught();
    await testListModels();
    await testProviderStateNeverExposesKey();
    console.log('geoapp-ai-setup-service tests passed');
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
