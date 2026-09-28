import * as assert from 'assert/strict';
import { GeoAppAiScorerModelResolver } from '../services/ai-scorer-model-resolver';

interface ResolverServices {
    preferences?: Record<string, unknown>;
    assignedIdentifier?: string;
    resolvedModelId?: string;
}

function createResolver(services: ResolverServices): GeoAppAiScorerModelResolver {
    const resolver = new GeoAppAiScorerModelResolver();
    (resolver as any).preferenceService = {
        get: <T>(key: string, fallback: T): T =>
            services.preferences && key in services.preferences
                ? services.preferences[key] as T
                : fallback,
    };
    if (services.assignedIdentifier !== undefined) {
        (resolver as any).aiSettingsService = {
            getAgentSettings: async () => ({
                languageModelRequirements: [{ purpose: 'chat', identifier: services.assignedIdentifier }],
            }),
        };
        (resolver as any).languageModelRegistry = {
            selectLanguageModel: async () => ({ id: services.resolvedModelId || services.assignedIdentifier }),
        };
    }
    return resolver;
}

async function testOpenRouterAgentAssignment(): Promise<void> {
    const resolver = createResolver({
        preferences: {
            'geoApp.ai.openRouter.baseUrl': 'https://openrouter.example/api/v1',
            'geoApp.ai.openRouter.apiKey': 'or-key',
            'geoApp.ai.openRouter.model.web': 'perplexity/sonar',
        },
        assignedIdentifier: 'openrouter/web',
    });

    const resolved = await resolver.resolveForRequest({});
    assert.equal(resolved.source, 'agent');
    assert.equal(resolved.provider, 'openrouter');
    assert.equal(resolved.base_url, 'https://openrouter.example/api/v1');
    assert.equal(resolved.model, 'perplexity/sonar');
    assert.equal(resolved.api_key, 'or-key');
}

async function testOpenAiOfficialAssignment(): Promise<void> {
    const resolver = createResolver({
        preferences: {
            'ai-features.openAiOfficial.openAiApiKey': 'openai-key',
        },
        assignedIdentifier: 'openai/gpt-4o-mini',
    });

    const resolved = await resolver.resolveForRequest({});
    assert.equal(resolved.provider, 'openai');
    assert.equal(resolved.base_url, 'https://api.openai.com');
    assert.equal(resolved.model, 'gpt-4o-mini');
    assert.equal(resolved.api_key, 'openai-key');
}

async function testUniversalAliasResolvesToMappedModel(): Promise<void> {
    const resolver = createResolver({
        preferences: {
            'geoApp.ai.openRouter.model.fast': 'openai/gpt-4o-mini',
            'geoApp.ai.openRouter.apiKey': 'or-key',
        },
        assignedIdentifier: 'default/universal',
        resolvedModelId: 'openrouter/fast',
    });

    const resolved = await resolver.resolveForRequest({});
    assert.equal(resolved.provider, 'openrouter');
    assert.equal(resolved.model, 'openai/gpt-4o-mini');
    assert.equal(
        await resolver.describeEffectiveSelection(),
        'openrouter/fast → openrouter/openai/gpt-4o-mini'
    );
}

async function testCustomOpenAiCompatibleEndpoint(): Promise<void> {
    const resolver = createResolver({
        preferences: {
            'ai-features.openAiOfficial.openAiApiKey': 'global-key',
            'ai-features.openAiCustom.customOpenAiModels': [{
                id: 'company-json',
                model: 'json-scorer',
                url: 'https://llm.company.local/v1',
                apiKey: true,
            }],
        },
        assignedIdentifier: 'company-json',
    });

    const resolved = await resolver.resolveForRequest({});
    assert.equal(resolved.provider, 'openai-compatible');
    assert.equal(resolved.base_url, 'https://llm.company.local/v1');
    assert.equal(resolved.model, 'json-scorer');
    assert.equal(resolved.api_key, 'global-key');
}

async function testPreferenceFallbackWithoutAssignment(): Promise<void> {
    const resolver = createResolver({
        preferences: {
            'geoApp.aiScorer.provider': 'lmstudio',
            'geoApp.ocr.lmstudio.baseUrl': 'http://localhost:1234',
            'geoApp.aiScorer.lmstudio.model': 'local-json-model',
        },
    });

    const resolved = await resolver.resolveForRequest({});
    assert.equal(resolved.source, 'preferences');
    assert.equal(resolved.provider, 'lmstudio');
    assert.equal(resolved.base_url, 'http://localhost:1234');
    assert.equal(resolved.model, 'local-json-model');
}

async function testExplicitRequestWinsOverAgentAssignment(): Promise<void> {
    const resolver = createResolver({
        preferences: {
            'geoApp.aiScorer.provider': 'lmstudio',
            'geoApp.aiScorer.lmstudio.model': 'local-json-model',
        },
        assignedIdentifier: 'openrouter/strong',
    });

    const resolved = await resolver.resolveForRequest({
        provider: 'custom-provider',
        base_url: 'http://localhost:9999',
        model: 'explicit-model',
        api_key: 'explicit-key',
    });
    assert.equal(resolved.source, 'request');
    assert.equal(resolved.provider, 'custom-provider');
    assert.equal(resolved.base_url, 'http://localhost:9999');
    assert.equal(resolved.model, 'explicit-model');
    assert.equal(resolved.api_key, 'explicit-key');
}

async function testUnsupportedAssignedModelFailsExplicitly(): Promise<void> {
    const resolver = createResolver({
        assignedIdentifier: 'anthropic/claude-sonnet',
    });

    await assert.rejects(
        () => resolver.resolveForRequest({}),
        /n'est pas exécutable par le backend/
    );
}

async function main(): Promise<void> {
    await testOpenRouterAgentAssignment();
    await testOpenAiOfficialAssignment();
    await testUniversalAliasResolvesToMappedModel();
    await testCustomOpenAiCompatibleEndpoint();
    await testPreferenceFallbackWithoutAssignment();
    await testExplicitRequestWinsOverAgentAssignment();
    await testUnsupportedAssignedModelFailsExplicitly();
    console.log('ai-scorer-model-resolver tests passed');
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
