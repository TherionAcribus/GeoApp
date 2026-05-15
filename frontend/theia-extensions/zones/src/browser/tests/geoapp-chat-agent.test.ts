import * as assert from 'assert/strict';
import { ToolRequest } from '@theia/ai-core';

import { GeoAppChatAgent } from '../geoapp-chat-agent';
import { GeoAppChatPolicyService } from '../geoapp-chat-policy-service';
import { GeoAppAiToolCatalog } from '../geoapp-chat-tool-catalog';

type FakePreferenceValues = Record<string, unknown>;

class FakeToolInvocationRegistry {
    constructor(readonly tools: ToolRequest[]) {}

    getAllFunctions(): ToolRequest[] {
        return this.tools;
    }
}

class FakePreferenceService {
    constructor(readonly values: FakePreferenceValues = {}) {}

    get<T>(key: string, defaultValue?: T): T {
        return (this.values[key] as T | undefined) ?? (defaultValue as T);
    }
}

function tool(id: string, name: string, description = ''): ToolRequest {
    return {
        id,
        name,
        description,
        providerName: id.startsWith('geoapp.') || id.startsWith('plugin.') || id.startsWith('formula-solver.') ? 'GeoApp' : 'Theia',
        parameters: {},
        handler: async () => undefined,
    } as unknown as ToolRequest;
}

function createPolicyService(preferences: FakePreferenceValues = {}, tools = createTools()): GeoAppChatPolicyService {
    const catalog = new GeoAppAiToolCatalog();
    (catalog as any).toolRegistry = new FakeToolInvocationRegistry(tools);

    const policyService = new GeoAppChatPolicyService();
    (policyService as any).catalog = catalog;
    (policyService as any).preferenceService = new FakePreferenceService(preferences);
    return policyService;
}

function createTools(): ToolRequest[] {
    return [
        tool('geoapp.checkers.run', 'run_checker'),
        tool('plugin.coordinate_projection', 'coordinate_projection'),
        tool('geoapp.coordinates.save-found', 'save_found_coordinates'),
        tool('formula-solver.calculate-coordinates', 'calculate_final_coordinates'),
    ];
}

function createRequest(settings: Record<string, unknown> = {}): any {
    return {
        id: 'request-1',
        session: {
            id: 'session-1',
            settings,
        },
        response: {
            cancellationToken: undefined,
        },
    };
}

async function testSendLlmRequestUsesPolicyFilteredTools(): Promise<void> {
    const policyService = createPolicyService({
        'geoApp.chat.toolPolicy.overrides': {
            'plugin.coordinate_projection': 'disabled',
            'geoapp.coordinates.save-found': 'confirm',
        },
    });
    const agent = new GeoAppChatAgent();
    (agent as any).chatPolicyService = policyService;

    let capturedTools: ToolRequest[] | undefined;
    (agent as any).languageModelService = {
        sendRequest: async (_languageModel: unknown, request: { tools?: ToolRequest[] }) => {
            capturedTools = request.tools;
            return {};
        },
    };

    await (agent as any).sendLlmRequest(
        createRequest(),
        [],
        [
            tool('theia.generic.read', 'theia_read'),
            tool('plugin.coordinate_projection', 'coordinate_projection'),
        ],
        { id: 'fake-lm' },
        'geoapp-chat-system-guided',
        false
    );

    assert.ok(capturedTools);
    assert.deepEqual(capturedTools!.map(candidate => candidate.name), [
        'theia_read',
        'run_checker',
        'save_found_coordinates',
        'calculate_final_coordinates',
    ]);
    assert.deepEqual(capturedTools!.map(candidate => candidate.id), [
        'theia.generic.read',
        'run_checker',
        'save_found_coordinates',
        'calculate_final_coordinates',
    ]);
    assert.ok(capturedTools!.find(candidate => candidate.name === 'save_found_coordinates')?.confirmAlwaysAllow);
    assert.equal(capturedTools!.some(candidate => candidate.name === 'coordinate_projection'), false);
}

async function testSystemMessageContainsResolvedPromptAndPolicy(): Promise<void> {
    const policyService = createPolicyService({
        'geoApp.chat.promptPack': 'safe',
    });
    const agent = new GeoAppChatAgent();
    (agent as any).chatPolicyService = policyService;
    const functionDescriptions = new Map<string, ToolRequest>([
        ['getSkillFileContent', tool('getSkillFileContent', 'getSkillFileContent')],
    ]);
    (agent as any).promptService = {
        getResolvedPromptFragment: async (variantId: string) => ({
            id: variantId,
            text: `RESOLVED PROMPT ${variantId}`,
            functionDescriptions,
        }),
        getPromptVariantInfo: () => ({
            variantId: 'geoapp-chat-system-safe',
            isCustomized: true,
        }),
    };

    const description = await (agent as any).getSystemMessageDescription({
        model: {},
        request: createRequest(),
    });

    assert.ok(description);
    assert.ok(description.text.includes('RESOLVED PROMPT geoapp-chat-system-safe'));
    assert.ok(description.text.includes('Politique GeoApp active :'));
    assert.ok(description.text.includes('- Prompt pack : safe'));
    assert.equal(description.promptVariantId, 'geoapp-chat-system-safe');
    assert.equal(description.isPromptVariantCustomized, true);
    assert.equal(description.functionDescriptions, functionDescriptions);
}

async function run(): Promise<void> {
    await testSendLlmRequestUsesPolicyFilteredTools();
    await testSystemMessageContainsResolvedPromptAndPolicy();
    // eslint-disable-next-line no-console
    console.log('geoapp-chat-agent tests passed');
}

void run();
