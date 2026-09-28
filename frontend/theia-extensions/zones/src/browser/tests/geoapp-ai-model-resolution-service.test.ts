import * as assert from 'assert/strict';
import { GeoAppAiModelResolutionService } from '../geoapp-ai-model-resolution-service';

interface ResolutionServices {
    preferences?: Record<string, unknown>;
    models?: Record<string, { id: string; name?: string; vendor?: string } | undefined>;
    assignedIdentifiers?: Record<string, string>;
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
    (service as any).preferenceService = {
        get: <T>(key: string, fallback: T): T =>
            services.preferences && key in services.preferences
                ? services.preferences[key] as T
                : fallback,
        onPreferenceChanged: () => ({ dispose: () => undefined }),
    };
    (service as any).languageModelRegistry = {
        selectLanguageModel: async (request: { identifier?: string }) =>
            services.models?.[request.identifier || ''],
        onChange: () => ({ dispose: () => undefined }),
    };
    (service as any).aiSettingsService = {
        getAgentSettings: async (agentId: string) => ({
            languageModelRequirements: services.assignedIdentifiers?.[agentId]
                ? [{ purpose: 'chat', identifier: services.assignedIdentifiers[agentId] }]
                : undefined,
        }),
    };
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
    await testAiScorerKeepsTheiaAndBackendModelIdentity();
    console.log('geoapp-ai-model-resolution-service tests passed');
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
