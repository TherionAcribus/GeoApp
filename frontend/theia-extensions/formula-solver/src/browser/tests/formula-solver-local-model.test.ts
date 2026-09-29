import * as assert from 'assert/strict';

import { FormulaSolverLLMService } from '../formula-solver-llm-service';
import {
    GeoAppAiExecutionService,
    GeoAppAiOutputError,
} from 'theia-ide-zones-ext/lib/browser/geoapp-ai-execution-service';
import { GeoAppAiModelResolutionService } from 'theia-ide-zones-ext/lib/browser/geoapp-ai-model-resolution-service';
import {
    GeoAppFormulaSolverFastAgentId,
    GeoAppFormulaSolverLocalAgentId,
} from '../geoapp-formula-solver-agents';

class FakeLanguageModelRegistry {
    readonly selections: Array<{ agent: string; purpose: string; identifier: string }> = [];

    constructor(private readonly model?: { id: string; name?: string; vendor?: string }) {}

    async selectLanguageModel(request: { agent: string; purpose: string; identifier: string }): Promise<typeof this.model> {
        this.selections.push(request);
        return this.model;
    }

    async getLanguageModel(id: string): Promise<typeof this.model> {
        return this.model?.id === id ? this.model : undefined;
    }

    onChange(): { dispose(): void } {
        return { dispose: () => undefined };
    }
}

class FakeLanguageModelService {
    readonly calls: Array<{ model: unknown; request: { agentId?: string } }> = [];

    constructor(private readonly response: unknown = {
        parsed: { formulas: [] },
        content: '{"formulas":[]}',
    }) {}

    async sendRequest(model: unknown, request: { agentId?: string }): Promise<unknown> {
        this.calls.push({ model, request });
        return this.response;
    }
}

class FakePreferenceService {
    constructor(private readonly values: Record<string, unknown> = {}) {}

    get<T>(key: string, defaultValue?: T): T | undefined {
        return Object.prototype.hasOwnProperty.call(this.values, key)
            ? this.values[key] as T
            : defaultValue;
    }

    onPreferenceChanged(): { dispose(): void } {
        return { dispose: () => undefined };
    }
}

function makeService(
    model: { id: string; name?: string; vendor?: string } | undefined,
    preferences: Record<string, unknown> = {},
    response?: unknown
): {
    service: FormulaSolverLLMService;
    registry: FakeLanguageModelRegistry;
    llm: FakeLanguageModelService;
} {
    const service = new FormulaSolverLLMService();
    const registry = new FakeLanguageModelRegistry(model);
    const llm = new FakeLanguageModelService(response === undefined ? {
        parsed: { formulas: [] },
        content: '{"formulas":[]}',
    } : response);
    const resolutionService = new GeoAppAiModelResolutionService();
    (resolutionService as any).preferenceService = new FakePreferenceService(preferences);
    (resolutionService as any).languageModelRegistry = registry;
    const executionService = new GeoAppAiExecutionService();
    (executionService as any).modelResolutionService = resolutionService;
    (executionService as any).languageModelRegistry = registry;
    (executionService as any).languageModelService = llm;
    (service as any).aiExecutionService = executionService;
    return { service, registry, llm };
}

async function testLocalOllamaModelIsAllowed(): Promise<void> {
    const { service, registry, llm } = makeService(
        { id: 'ollama/llama3.1', name: 'Llama 3.1', vendor: 'ollama' },
        { 'ai-features.ollama.ollamaHost': 'http://localhost:11434' }
    );

    const response = await (service as any).callLLM('prompt', 'test-local', 'local');

    assert.equal(response, '{"formulas":[]}');
    assert.equal(registry.selections.length, 1);
    assert.deepEqual(registry.selections[0], {
        agent: GeoAppFormulaSolverLocalAgentId,
        purpose: 'formula-solving',
        identifier: 'default/universal',
    });
    assert.equal(llm.calls.length, 1);
    assert.equal(llm.calls[0].request.agentId, GeoAppFormulaSolverLocalAgentId);
}

async function testLocalCloudModelIsRejectedWithoutCall(): Promise<void> {
    const { service, llm } = makeService({ id: 'openai/gpt-4o', name: 'GPT-4o' });

    await assert.rejects(
        () => (service as any).callLLM('prompt', 'test-local-cloud', 'local'),
        /Aucun repli cloud n'a été appliqué/
    );
    assert.equal(llm.calls.length, 0);
}

async function testLocalWithoutReadyModelIsRejectedWithoutCall(): Promise<void> {
    const { service, llm } = makeService(undefined);

    await assert.rejects(
        () => (service as any).callLLM('prompt', 'test-local-missing', 'local'),
        /aucun repli cloud n'a été appliqué/i
    );
    assert.equal(llm.calls.length, 0);
}

async function testAllowlistedUnknownModelIsAllowed(): Promise<void> {
    const { service, llm } = makeService(
        { id: 'company-llm/local-small' },
        { 'geoApp.ai.localModelIds': ['company-llm/*'] }
    );

    await (service as any).callLLM('prompt', 'test-allowlist', 'local');
    assert.equal(llm.calls.length, 1);
}

async function testFastProfileKeepsNormalCloudBehavior(): Promise<void> {
    const { service, registry, llm } = makeService({ id: 'openai/gpt-4o-mini' });

    await (service as any).callLLM('prompt', 'test-fast', 'fast');

    assert.equal(registry.selections[0].agent, GeoAppFormulaSolverFastAgentId);
    assert.equal(llm.calls.length, 1);
}

async function testInvalidJsonDoesNotBecomeAnEmptyFormulaList(): Promise<void> {
    const { service } = makeService({ id: 'openai/gpt-4o-mini' }, {}, { text: 'réponse non structurée' });

    await assert.rejects(
        () => service.detectFormulasWithAI('texte', 'fast'),
        (error: unknown) => error instanceof GeoAppAiOutputError && error.kind === 'invalid-json'
    );
}

async function testInvalidSchemaDoesNotBecomeAnEmptyQuestionMap(): Promise<void> {
    const { service } = makeService({ id: 'openai/gpt-4o-mini' }, {}, {
        parsed: { unexpected: true },
        content: '{"unexpected":true}',
    });

    await assert.rejects(
        () => service.extractQuestionsWithAI('texte', ['A'], 'fast'),
        (error: unknown) => error instanceof GeoAppAiOutputError && error.kind === 'schema-mismatch'
    );
}

async function run(): Promise<void> {
    await testLocalOllamaModelIsAllowed();
    await testLocalCloudModelIsRejectedWithoutCall();
    await testLocalWithoutReadyModelIsRejectedWithoutCall();
    await testAllowlistedUnknownModelIsAllowed();
    await testFastProfileKeepsNormalCloudBehavior();
    await testInvalidJsonDoesNotBecomeAnEmptyFormulaList();
    await testInvalidSchemaDoesNotBecomeAnEmptyQuestionMap();
    // eslint-disable-next-line no-console
    console.log('formula-solver-local-model tests passed');
}

void run();
