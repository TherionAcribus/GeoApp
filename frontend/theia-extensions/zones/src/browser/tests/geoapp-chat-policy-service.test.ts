import * as assert from 'assert/strict';
import { ToolRequest } from '@theia/ai-core';

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
        providerName: 'GeoApp',
        parameters: {},
        handler: async () => undefined,
    } as unknown as ToolRequest;
}

function createTools(): ToolRequest[] {
    return [
        tool('geoapp.checkers.run', 'run_checker'),
        tool('plugin.coordinate_projection', 'coordinate_projection'),
        tool('geoapp.coordinates.save-found', 'save_found_coordinates'),
        tool('formula-solver.search-answer', 'search_answer_online'),
        tool('formula-solver.calculate-coordinates', 'calculate_final_coordinates'),
        tool('geoapp.plugins.workflow.run-step', 'run_geocache_workflow_step'),
        tool('plugin.dynamic_ocr', 'dynamic_ocr', 'OCR local helper'),
    ];
}

function createServices(preferences: FakePreferenceValues = {}, tools = createTools()): {
    catalog: GeoAppAiToolCatalog;
    policyService: GeoAppChatPolicyService;
} {
    const catalog = new GeoAppAiToolCatalog();
    (catalog as any).toolRegistry = new FakeToolInvocationRegistry(tools);

    const policyService = new GeoAppChatPolicyService();
    (policyService as any).catalog = catalog;
    (policyService as any).preferenceService = new FakePreferenceService(preferences);

    return { catalog, policyService };
}

function names(toolRequests: ToolRequest[]): string[] {
    return toolRequests.map(request => request.name).sort();
}

function testCatalogMapsStaticAndDynamicTools(): void {
    const { catalog } = createServices();
    const checker = catalog.getEntry('geoapp.checkers.run');
    assert.ok(checker);
    assert.equal(checker?.publicName, 'run_checker');
    assert.equal(checker?.category, 'checkers');
    assert.equal(checker?.risk, 'network');
    assert.equal(checker?.network, true);
    assert.equal(checker?.defaultEnabled, true);

    const dynamic = catalog.getEntry('plugin.dynamic_ocr');
    assert.ok(dynamic);
    assert.equal(dynamic?.category, 'image');
    assert.equal(dynamic?.defaultEnabled, false);
    assert.equal(dynamic?.dynamic, true);
}

function testGuidedProfileEnablesDefaultsAndConfirmsRiskyTools(): void {
    const { policyService } = createServices();
    const policy = policyService.resolvePolicy();
    const exposed = policyService.getManagedToolRequests(policy);

    assert.deepEqual(names(exposed), [
        'calculate_final_coordinates',
        'coordinate_projection',
        'run_checker',
        'run_geocache_workflow_step',
        'save_found_coordinates',
        'search_answer_online',
    ]);
    assert.equal(policy.confirmToolIds.has('geoapp.checkers.run'), true);
    assert.equal(policy.confirmToolIds.has('geoapp.coordinates.save-found'), true);
    assert.equal(policy.confirmToolIds.has('formula-solver.search-answer'), true);
    assert.equal(policy.confirmToolIds.has('geoapp.plugins.workflow.run-step'), true);
    assert.equal(policy.confirmToolIds.has('plugin.coordinate_projection'), false);
    assert.ok(exposed.find(request => request.name === 'run_checker')?.confirmAlwaysAllow);
}

function testOfflineProfileRemovesNetworkAndHighRiskTools(): void {
    const { policyService } = createServices({
        'geoApp.chat.behaviorProfile.default': 'offline',
    });
    const policy = policyService.resolvePolicy();

    assert.equal(policy.enabledToolIds.has('plugin.coordinate_projection'), true);
    assert.equal(policy.enabledToolIds.has('formula-solver.calculate-coordinates'), true);
    assert.equal(policy.enabledToolIds.has('geoapp.coordinates.save-found'), true);
    assert.equal(policy.enabledToolIds.has('geoapp.checkers.run'), false);
    assert.equal(policy.enabledToolIds.has('formula-solver.search-answer'), false);
    assert.equal(policy.enabledToolIds.has('geoapp.plugins.workflow.run-step'), false);
}

function testOverridesDisableAndForceConfirmationByRegistryId(): void {
    const { policyService } = createServices({
        'geoApp.chat.toolPolicy.overrides': {
            'plugin.coordinate_projection': 'disabled',
            'plugin.dynamic_ocr': 'confirm',
        },
    });
    const policy = policyService.resolvePolicy();

    assert.equal(policy.enabledToolIds.has('plugin.coordinate_projection'), false);
    assert.equal(policy.disabledToolIds.has('plugin.coordinate_projection'), true);
    assert.equal(policy.enabledToolIds.has('plugin.dynamic_ocr'), true);
    assert.equal(policy.confirmToolIds.has('plugin.dynamic_ocr'), true);
    assert.ok(policyService.getManagedToolRequests(policy).find(request => request.name === 'dynamic_ocr')?.confirmAlwaysAllow);
}

function testWorkflowSpecificBehaviorProfile(): void {
    const { policyService } = createServices({
        'geoApp.chat.behaviorProfile.default': 'guided',
        'geoApp.chat.behaviorProfile.workflow.checker': 'safe',
    });
    const policy = policyService.resolvePolicy({
        session: {
            settings: {
                commonSettings: {
                    geoapp: {
                        workflowKind: 'checker',
                    },
                },
            },
        },
    } as any);

    assert.equal(policy.behaviorProfile, 'safe');
    assert.equal(policy.enabledToolIds.has('geoapp.checkers.run'), false);
    assert.equal(policy.enabledToolIds.has('plugin.coordinate_projection'), true);
}

function run(): void {
    testCatalogMapsStaticAndDynamicTools();
    testGuidedProfileEnablesDefaultsAndConfirmsRiskyTools();
    testOfflineProfileRemovesNetworkAndHighRiskTools();
    testOverridesDisableAndForceConfirmationByRegistryId();
    testWorkflowSpecificBehaviorProfile();
    // eslint-disable-next-line no-console
    console.log('geoapp-chat-policy-service tests passed');
}

run();
