import * as assert from 'assert/strict';
import { GeoAppAiModelResolutionService } from '../geoapp-ai-model-resolution-service';

interface ResolutionServices {
    preferences?: Record<string, unknown>;
    models?: Record<string, {
        id: string;
        name?: string;
        vendor?: string;
        capabilities?: Record<string, unknown>;
        model?: string;
        url?: string;
        status?: { status: 'ready' | 'unavailable'; message?: string };
    } | undefined>;
    aliases?: Record<string, string[]>;
    assignedIdentifiers?: Record<string, string>;
    visionModels?: Array<Record<string, unknown>>;
    scorer?: {
        provider: string;
        base_url: string;
        model: string;
        source: 'agent' | 'request' | 'preferences';
        sourceLabel: string;
        theiaModelId?: string;
        assignedIdentifier?: string;
    };
}

function createService(services: ResolutionServices): GeoAppAiModelResolutionService {
    const service = new GeoAppAiModelResolutionService();
    const preferences: Record<string, unknown> = { ...(services.preferences ?? {}) };
    const preferenceUpdates: Array<{ key: string; value: unknown }> = [];
    (service as any).preferenceService = {
        get: <T>(key: string, fallback: T): T =>
            key in preferences ? preferences[key] as T : fallback,
        set: async (key: string, value: unknown) => {
            preferences[key] = value;
            preferenceUpdates.push({ key, value });
        },
        onPreferenceChanged: () => ({ dispose: () => undefined }),
    };
    (service as any).languageModelRegistry = {
        getLanguageModels: async () => Object.values(services.models ?? {}).filter(Boolean),
        getLanguageModel: async (identifier: string) =>
            Object.values(services.models ?? {}).find(model => model?.id === identifier),
        selectLanguageModel: async (request: { identifier?: string }) => {
            const identifier = request.identifier || '';
            const target = services.aliases?.[identifier]?.find(candidate => services.models?.[candidate]) || identifier;
            return services.models?.[target];
        },
        onChange: () => ({ dispose: () => undefined }),
    };
    const requirementsByAgent = new Map<string, Array<{ purpose: string; identifier: string }>>();
    for (const [agentId, identifier] of Object.entries(services.assignedIdentifiers ?? {})) {
        const purposes = agentId === 'geoapp-ocr'
            ? ['vision-ocr']
            : agentId.startsWith('geoapp-formula-solver')
                ? ['formula-solving']
                : ['chat'];
        requirementsByAgent.set(agentId, purposes.map(purpose => ({ purpose, identifier })));
    }
    const updates: Array<{ agentId: string; settings: { languageModelRequirements?: Array<{ purpose: string; identifier: string }> } }> = [];
    (service as any).aiSettingsService = {
        getAgentSettings: async (agentId: string) => ({
            languageModelRequirements: requirementsByAgent.get(agentId),
        }),
        updateAgentSettings: async (agentId: string, settings: { languageModelRequirements?: Array<{ purpose: string; identifier: string }> }) => {
            updates.push({ agentId, settings });
            requirementsByAgent.set(agentId, settings.languageModelRequirements ?? []);
        },
        onDidChange: () => ({ dispose: () => undefined }),
    };
    (service as any).languageModelAliasRegistry = {
        ready: Promise.resolve(),
        getAliases: () => Object.entries(services.aliases ?? {}).map(([id, defaultModelIds]) => ({ id, defaultModelIds })),
        resolveAlias: (id: string) => services.aliases?.[id],
        onDidChange: () => ({ dispose: () => undefined }),
    };
    (service as any).__agentUpdates = updates;
    (service as any).__preferenceUpdates = preferenceUpdates;
    if (services.visionModels) {
        (service as any).fetchJson = async (url: string) =>
            url.endsWith('/models') ? { data: services.visionModels } : undefined;
    }
    if (services.scorer) {
        (service as any).aiScorerModelResolver = {
            resolveForRequest: async () => services.scorer,
        };
    }
    return service;
}

function task(service: GeoAppAiModelResolutionService, id: string) {
    const result = service.getTasks().find(candidate => candidate.id === id);
    assert.ok(result, `task ${id}`);
    return result;
}

async function testAssignedModelAndOpenRouterBackingModel(): Promise<void> {
    const service = createService({
        preferences: {
            'geoApp.ai.openRouter.model.strong': 'anthropic/claude-sonnet',
        },
        assignedIdentifiers: {
            earthcoach: 'openrouter/strong',
        },
        models: {
            'openrouter/strong': { id: 'openrouter/strong', name: 'Strong slot', vendor: 'OpenRouter' },
        },
    });

    const resolved = await service.resolveTask(task(service, 'earthcoach'));
    assert.equal(resolved.agentId, 'earthcoach');
    assert.equal(resolved.requestedIdentifier, 'openrouter/strong');
    assert.equal(resolved.resolvedModelId, 'openrouter/strong');
    assert.equal(resolved.provider, 'openrouter');
    assert.equal(resolved.transport, 'theia-managed');
    assert.equal(resolved.backingModel, 'anthropic/claude-sonnet');
    assert.equal(resolved.backingPreference, 'geoApp.ai.openRouter.model.strong');
    assert.equal(resolved.source, 'agent');
    assert.equal(resolved.locality, 'remote');
    assert.equal(resolved.status, 'ready');
}

async function testStrictLocalModelCompatibility(): Promise<void> {
    const service = createService({
        preferences: {
            'ai-features.ollama.ollamaHost': 'http://localhost:11434',
        },
        models: {
            'default/universal': { id: 'ollama/llama3.1', vendor: 'Ollama' },
        },
    });

    const resolved = await service.resolveTask(task(service, 'chat-local'));
    assert.equal(resolved.resolvedModelId, 'ollama/llama3.1');
    assert.equal(resolved.locality, 'local');
    assert.equal(resolved.status, 'ready');
}

async function testStrictLocalRejectsCloudModel(): Promise<void> {
    const service = createService({
        models: {
            'default/universal': { id: 'openai/gpt-4o', vendor: 'OpenAI' },
        },
    });

    const resolved = await service.resolveTask(task(service, 'chat-local'));
    assert.equal(resolved.locality, 'remote');
    assert.equal(resolved.status, 'incompatible');
    assert.match(resolved.diagnostics.join('\n'), /Non compatible local\/offline/);
}

async function testVisionBackendUsesTaskPreferences(): Promise<void> {
    const service = createService({
        preferences: {
            'geoApp.ocr.visionProvider': 'lmstudio',
            'geoApp.ocr.lmstudio.baseUrl': 'http://127.0.0.1:1234',
            'geoApp.ocr.lmstudio.model': 'vision-local',
            'geoApp.ai.modelCapabilities': {
                'vision-local': { vision: true },
            },
        },
    });

    const resolved = await service.resolveTask(task(service, 'ocr-backend-plugin'));
    assert.equal(resolved.provider, 'lmstudio');
    assert.equal(resolved.backingModel, 'vision-local');
    assert.equal(resolved.source, 'task-preference');
    assert.equal(resolved.transport, 'chat-completions');
    assert.equal(resolved.locality, 'local');
    assert.equal(resolved.status, 'ready');
}

async function testVisionBackendRejectsDeclaredNonVisionModel(): Promise<void> {
    const service = createService({
        preferences: {
            'geoApp.ocr.visionProvider': 'lmstudio',
            'geoApp.ocr.lmstudio.baseUrl': 'http://127.0.0.1:1234',
            'geoApp.ocr.lmstudio.model': 'text-only',
            'geoApp.ai.modelCapabilities': {
                'text-only': { vision: false },
            },
        },
    });

    const resolved = await service.resolveTask(task(service, 'ocr-backend-plugin'));
    assert.equal(resolved.status, 'unsupported');
    assert.equal(resolved.capabilityChecks?.[0].capability, 'vision');
    assert.equal(resolved.capabilityChecks?.[0].status, 'unsupported');
    assert.match(resolved.diagnostics.join('\n'), /Capacité requise vision non supportée/);
}

async function testVisionBackendConfigurationPersistsProviderAndModel(): Promise<void> {
    const service = createService({
        preferences: {
            'geoApp.ai.modelCapabilities': {
                'vendor/new-vision': { vision: true },
            },
        },
    });

    const resolved = await service.setTaskBackendConfiguration('ocr-backend-plugin', 'openrouter', ' vendor/new-vision ');
    const updates = (service as any).__preferenceUpdates as Array<{ key: string; value: unknown }>;

    assert.equal(resolved.provider, 'openrouter');
    assert.equal(resolved.backingModel, 'vendor/new-vision');
    assert.equal(resolved.status, 'ready');
    assert.deepEqual(updates.map(update => update.key), [
        'geoApp.ocr.visionProvider',
        'geoApp.ocr.openRouter.model',
    ]);
}

async function testVisionBackendConfigurationRejectsTextOnlyBeforePersisting(): Promise<void> {
    const service = createService({
        preferences: {
            'geoApp.ai.modelCapabilities': {
                'text-only': { vision: false },
            },
        },
    });

    await assert.rejects(
        service.setTaskBackendConfiguration('ocr-backend-plugin', 'lmstudio', 'text-only'),
        /vision non supportée/
    );
    assert.equal(((service as any).__preferenceUpdates as unknown[]).length, 0);
}

async function testVisionBackendModelChoicesPreferVerifiedVisionModels(): Promise<void> {
    const service = createService({
        preferences: {
            'geoApp.ocr.visionProvider': 'lmstudio',
            'geoApp.ocr.lmstudio.baseUrl': 'http://127.0.0.1:1234',
        },
        visionModels: [
            { id: 'text-model', type: 'llm' },
            { id: 'vision-model', type: 'vlm' },
            { id: 'unknown-model' },
        ],
    });

    const choices = await service.getBackendTaskModelChoices('ocr-backend-plugin');
    assert.equal(choices[0].id, 'vision-model');
    assert.equal(choices[0].ready, true);
    assert.equal(choices.find(choice => choice.id === 'text-model')?.detail, 'vision non supportée');
    assert.equal(choices.find(choice => choice.id === 'unknown-model')?.detail, 'vision non vérifiée');
}

async function testVisionBackendResetPersistsSelectedProviderDefault(): Promise<void> {
    const service = createService({});

    const resolved = await service.resetTaskBackendModel('ocr-backend-plugin', 'openrouter');
    const updates = (service as any).__preferenceUpdates as Array<{ key: string; value: unknown }>;

    assert.equal(resolved.provider, 'openrouter');
    assert.equal(resolved.backingModel, 'openai/gpt-4o-mini');
    assert.deepEqual(updates, [
        { key: 'geoApp.ocr.visionProvider', value: 'openrouter' },
        { key: 'geoApp.ocr.openRouter.model', value: 'openai/gpt-4o-mini' },
    ]);
}

async function testTheiaVisionTaskRejectsDeclaredNonVisionModel(): Promise<void> {
    const service = createService({
        assignedIdentifiers: {
            'geoapp-ocr': 'default/vision',
        },
        models: {
            'default/vision': { id: 'default/vision', vendor: 'Ollama', capabilities: { imageInput: false } },
        },
    });

    const resolved = await service.resolveTask(task(service, 'ocr-theia'));
    assert.equal(resolved.status, 'unsupported');
    assert.equal(resolved.capabilityChecks?.[0].required, true);
    assert.match(resolved.diagnostics.join('\n'), /vision non supportée/);
}

async function testOptionalStructuredOutputIsAdvisoryOnly(): Promise<void> {
    const service = createService({
        assignedIdentifiers: {
            'geoapp-formula-solver-fast': 'default/universal',
        },
        models: {
            'default/universal': { id: 'default/universal', vendor: 'OpenAI', capabilities: { structuredOutput: false } },
        },
    });

    const resolved = await service.resolveTask(task(service, 'formula-fast'));
    assert.equal(resolved.status, 'ready');
    assert.equal(resolved.capabilityChecks?.[0].capability, 'structured-output');
    assert.equal(resolved.capabilityChecks?.[0].required, false);
    assert.match(resolved.diagnostics.join('\n'), /diagnostic non bloquant/);
}

async function testTaskModelAssignmentAcceptsReadyAliasAndPersistsPurpose(): Promise<void> {
    const service = createService({
        aliases: {
            'geoapp/vision': ['ollama/vision'],
        },
        models: {
            'ollama/vision': { id: 'ollama/vision', vendor: 'Ollama', capabilities: { imageInput: true } },
        },
    });

    const resolved = await service.setTaskModel('ocr-theia', 'geoapp/vision');
    const updates = (service as any).__agentUpdates as Array<{ agentId: string; settings: { languageModelRequirements?: Array<{ purpose: string; identifier: string }> } }>;

    assert.equal(resolved.status, 'ready');
    assert.equal(resolved.requestedIdentifier, 'geoapp/vision');
    assert.equal(resolved.resolvedModelId, 'ollama/vision');
    assert.equal(updates.length, 1);
    assert.equal(updates[0].agentId, 'geoapp-ocr');
    assert.deepEqual(updates[0].settings.languageModelRequirements, [
        { purpose: 'vision-ocr', identifier: 'geoapp/vision' },
    ]);
}

async function testTaskModelResetRestoresDefaultRequirement(): Promise<void> {
    const service = createService({
        assignedIdentifiers: {
            'geoapp-chat-fast': 'ollama/custom',
        },
        models: {
            'ollama/custom': { id: 'ollama/custom', vendor: 'Ollama' },
            'default/universal': { id: 'ollama/default', vendor: 'Ollama' },
        },
    });

    const resolved = await service.resetTaskModel('chat-fast');
    const updates = (service as any).__agentUpdates as Array<{ settings: { languageModelRequirements?: unknown[] } }>;

    assert.equal(resolved.status, 'ready');
    assert.equal(resolved.source, 'default');
    assert.equal(resolved.requestedIdentifier, 'default/universal');
    assert.equal(updates[0].settings.languageModelRequirements, undefined);
}

async function testTaskModelAssignmentRejectsIncompatibleModelsBeforePersisting(): Promise<void> {
    const service = createService({
        models: {
            'openai/gpt-4o': { id: 'openai/gpt-4o', vendor: 'OpenAI' },
            'ollama/text-only': { id: 'ollama/text-only', vendor: 'Ollama', capabilities: { imageInput: false } },
        },
    });

    await assert.rejects(
        () => service.setTaskModel('chat-local', 'openai/gpt-4o'),
        /Non compatible local\/offline/
    );
    await assert.rejects(
        () => service.setTaskModel('ocr-theia', 'ollama/text-only'),
        /vision non supportée/i
    );
    assert.equal(((service as any).__agentUpdates as unknown[]).length, 0);
}

async function testModelChoicesExposeModelsAndAliases(): Promise<void> {
    const service = createService({
        aliases: {
            'default/universal': ['ollama/default'],
        },
        models: {
            'ollama/default': { id: 'ollama/default', vendor: 'Ollama' },
            'ollama/offline': { id: 'ollama/offline', vendor: 'Ollama', status: { status: 'unavailable' } },
        },
    });

    const choices = await service.getModelChoices();
    const alias = choices.find(choice => choice.id === 'default/universal');
    const unavailable = choices.find(choice => choice.id === 'ollama/offline');

    assert.equal(alias?.kind, 'alias');
    assert.equal(alias?.ready, true);
    assert.deepEqual(alias?.targetModelIds, ['ollama/default']);
    assert.equal(unavailable?.ready, false);
}

async function testAiScorerKeepsTheiaAndBackendModelIdentity(): Promise<void> {
    const service = createService({
        scorer: {
            provider: 'openrouter',
            base_url: 'https://openrouter.ai/api/v1',
            model: 'openai/gpt-4o-mini',
            source: 'agent',
            sourceLabel: 'affectation Theia de geoapp-ai-scorer',
            theiaModelId: 'openrouter/fast',
            assignedIdentifier: 'default/universal',
        },
    });

    const resolved = await service.resolveTask(task(service, 'ai-scorer'));
    assert.equal(resolved.resolvedModelId, 'openrouter/fast');
    assert.equal(resolved.backingModel, 'openai/gpt-4o-mini');
    assert.equal(resolved.provider, 'openrouter');
    assert.equal(resolved.source, 'agent');
    assert.equal(resolved.executionPath, 'backend-plugin');
    assert.match(resolved.displayModel || '', /openrouter\/fast → openrouter\/openai\/gpt-4o-mini/);
}

async function main(): Promise<void> {
    await testAssignedModelAndOpenRouterBackingModel();
    await testStrictLocalModelCompatibility();
    await testStrictLocalRejectsCloudModel();
    await testVisionBackendUsesTaskPreferences();
    await testVisionBackendRejectsDeclaredNonVisionModel();
    await testVisionBackendConfigurationPersistsProviderAndModel();
    await testVisionBackendConfigurationRejectsTextOnlyBeforePersisting();
    await testVisionBackendModelChoicesPreferVerifiedVisionModels();
    await testVisionBackendResetPersistsSelectedProviderDefault();
    await testTheiaVisionTaskRejectsDeclaredNonVisionModel();
    await testOptionalStructuredOutputIsAdvisoryOnly();
    await testTaskModelAssignmentAcceptsReadyAliasAndPersistsPurpose();
    await testTaskModelResetRestoresDefaultRequirement();
    await testTaskModelAssignmentRejectsIncompatibleModelsBeforePersisting();
    await testModelChoicesExposeModelsAndAliases();
    await testAiScorerKeepsTheiaAndBackendModelIdentity();
    console.log('geoapp-ai-model-resolution-service tests passed');
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
