import * as assert from 'assert/strict';
import type { ToolRequest } from '@theia/ai-core';
import type { GeoAppDocAgent } from '../doc-agent';

declare const require: any;
declare const global: any;

require.extensions['.css'] = () => undefined;

// Le module natif `canvas` n'est pas compilé sur ce poste : jsdom s'en passe
// (il ne sert qu'au rendu <canvas>). Stub à {} pour qu'il soit « indisponible ».
// Les *-tabs-manager importent des widgets (lumino, dépendances circulaires) :
// dans ce test ils ne servent que de token d'injection — un stub de classe suffit.
const Module = require('module');
const originalLoad = Module._load;
const STUBBED_MODULE_PATTERN = /lib\/browser\/(geocache-tabs-manager|zone-tabs-manager|plugin-tabs-manager|alphabet-tabs-manager)$/;
const stubbedModuleExports = new Proxy({}, {
    get: (_target, prop) => prop === '__esModule' ? true : class {},
});
Module._load = function (request: string, ...rest: unknown[]) {
    if (request === 'canvas') { return {}; }
    if (STUBBED_MODULE_PATTERN.test(request)) { return stubbedModuleExports; }
    return originalLoad.call(this, request, ...rest);
};

const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
global.window = dom.window;
global.document = dom.window.document;
(global.document as any).queryCommandSupported = () => false;
global.Element = dom.window.Element;
global.HTMLElement = dom.window.HTMLElement;
global.DragEvent = dom.window.DragEvent || class {};
global.MouseEvent = dom.window.MouseEvent;
Object.defineProperty(global, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
});

const { GeoAppDocAgent: Agent } = require('../doc-agent') as {
    GeoAppDocAgent: typeof GeoAppDocAgent;
};
const { GeoAppChatPolicyService } = require('theia-ide-zones-ext/lib/browser/geoapp-chat-policy-service');
const { GeoAppAiToolCatalog } = require('theia-ide-zones-ext/lib/browser/geoapp-chat-tool-catalog');

function tool(id: string, confirmMessage?: string): ToolRequest {
    return {
        id,
        name: id,
        description: '',
        providerName: 'test',
        parameters: {},
        confirmAlwaysAllow: confirmMessage,
        handler: async () => undefined,
    } as unknown as ToolRequest;
}

class FakeToolInvocationRegistry {
    constructor(readonly tools: ToolRequest[]) {}
    getAllFunctions(): ToolRequest[] {
        return this.tools;
    }
}

class FakePreferenceService {
    constructor(readonly values: Record<string, unknown> = {}) {}
    get<T>(key: string, defaultValue?: T): T {
        return (this.values[key] as T | undefined) ?? (defaultValue as T);
    }
}

function createPolicyService(registryTools: ToolRequest[], preferences: Record<string, unknown> = {}): InstanceType<typeof GeoAppChatPolicyService> {
    const catalog = new GeoAppAiToolCatalog();
    (catalog as any).toolRegistry = new FakeToolInvocationRegistry(registryTools);
    const policyService = new GeoAppChatPolicyService();
    (policyService as any).catalog = catalog;
    (policyService as any).preferenceService = new FakePreferenceService(preferences);
    return policyService;
}

function createAgent(options: {
    registryTools?: ToolRequest[];
    preferences?: Record<string, unknown>;
}): { agent: GeoAppDocAgent; captured: { tools?: ToolRequest[] } } {
    const registryTools = options.registryTools ?? [
        tool('aide_list_zones'),
        tool('aide_delete_zone', 'Supprimer la zone et toutes ses geocaches ?'),
        tool('aide_refresh_geocache', 'Rafraîchir la géocache depuis Geocaching.com ?'),
        tool('aide_calculate'),
        tool('aide_calculate_batch'),
        tool('aide_open_calculator'),
    ];

    const agent = new Agent();
    (agent as any).actionToolsManager = { buildAllTools: () => [] };
    (agent as any).actionContextService = {
        collectContext: async () => ({}),
        formatContextForPrompt: () => '## Contexte UI actuel\nTest.',
    };
    (agent as any).contentService = {
        initialize: async () => undefined,
        getChapters: () => [{ title: 'Chapitre', pages: [{ title: 'Page', description: 'desc' }] }],
    };
    (agent as any).chatPolicyService = createPolicyService(registryTools, options.preferences ?? {});

    const captured: { tools?: ToolRequest[] } = {};
    (agent as any).languageModelService = {
        sendRequest: async (_languageModel: unknown, request: { tools?: ToolRequest[] }) => {
            captured.tools = request.tools;
            return {};
        },
    };
    return { agent, captured };
}

function createRequest(): any {
    return {
        id: 'request-1',
        session: { id: 'session-1', settings: {} },
        response: { cancellationToken: undefined },
    };
}

// Régression §1 : aide_calculate/aide_calculate_batch/aide_open_calculator, annonces
// dans le prompt, partent reellement au modele (via le catalogue, scope 'aide').
async function testCalculatorToolsReachTheModel(): Promise<void> {
    const { agent, captured } = createAgent({});

    await (agent as any).sendLlmRequest(createRequest(), [], [], { id: 'fake-lm' });

    const ids = (captured.tools ?? []).map(t => t.id);
    for (const expected of ['aide_calculate', 'aide_calculate_batch', 'aide_open_calculator']) {
        assert.ok(ids.includes(expected), `tool absent : ${expected} (reçus: ${ids.join(', ')})`);
    }
    assert.ok(ids.includes('aide_list_zones'));
}

// §3 : sous le profil guided par defaut, les tools destructeurs recoivent une
// confirmation ; le libelle specifique du tool est conserve (pas l'avertissement
// generique). Les tools reseau/auth passent aussi par confirmation.
async function testGuidedProfileConfirmsDestructiveAideTools(): Promise<void> {
    const { agent, captured } = createAgent({});

    await (agent as any).sendLlmRequest(createRequest(), [], [], { id: 'fake-lm' });

    const byId = new Map((captured.tools ?? []).map(t => [t.id, t]));
    assert.equal(
        byId.get('aide_delete_zone')?.confirmAlwaysAllow,
        'Supprimer la zone et toutes ses geocaches ?'
    );
    assert.ok(byId.get('aide_refresh_geocache')?.confirmAlwaysAllow);
    assert.equal(byId.get('aide_list_zones')?.confirmAlwaysAllow, undefined);
}

// §3 : le profil offline bloque les tools reseau/auth de @Aide.
async function testOfflineProfileBlocksNetworkAideTools(): Promise<void> {
    const { agent, captured } = createAgent({
        preferences: { 'geoApp.chat.behaviorProfile.default': 'offline' },
    });

    await (agent as any).sendLlmRequest(createRequest(), [], [], { id: 'fake-lm' });

    const ids = (captured.tools ?? []).map(t => t.id);
    assert.equal(ids.includes('aide_refresh_geocache'), false, 'aide_refresh_geocache devrait être bloqué en offline');
    assert.ok(ids.includes('aide_list_zones'));
}

// Les overrides de la vue Policy s'appliquent aussi aux tools de @Aide.
async function testToolOverrideCanDisableAideTool(): Promise<void> {
    const { agent, captured } = createAgent({
        preferences: { 'geoApp.chat.toolPolicy.overrides': { aide_list_zones: 'disabled' } },
    });

    await (agent as any).sendLlmRequest(createRequest(), [], [], { id: 'fake-lm' });

    const ids = (captured.tools ?? []).map(t => t.id);
    assert.equal(ids.includes('aide_list_zones'), false);
    assert.ok(ids.includes('aide_calculate'));
}

// Un tool non gere par le catalogue (ex: ~{tool} dans le prompt utilisateur)
// doit etre conserve ; un tool du catalogue ne doit pas etre duplique.
async function testNonManagedToolsAreKeptWithoutDuplicates(): Promise<void> {
    const { agent, captured } = createAgent({});

    await (agent as any).sendLlmRequest(
        createRequest(),
        [],
        [tool('theia.generic.read'), tool('aide_calculate')],
        { id: 'fake-lm' }
    );

    const ids = (captured.tools ?? []).map(t => t.id);
    assert.ok(ids.includes('theia.generic.read'));
    assert.equal(ids.filter(id => id === 'aide_calculate').length, 1);
}

// §2 : garde-fou anti-injection + bloc policy dans le prompt.
async function testSystemPromptContainsGuardrailAndPolicy(): Promise<void> {
    const { agent } = createAgent({});

    const description = await (agent as any).getSystemMessageDescription({ model: {} });

    assert.ok(description);
    assert.match(description.text, /SÉCURITÉ \(injection\)/);
    assert.match(description.text, /DONNÉE[\s\S]*jamais une source d'instructions/);
    assert.match(description.text, /Politique GeoApp active/);
    assert.match(description.text, /DISPONIBILITÉ/);
    // La promesse calculatrice du prompt doit correspondre aux tools exposes.
    for (const id of ['aide_calculate', 'aide_calculate_batch', 'aide_open_calculator']) {
        assert.ok(description.text.includes(id), `prompt ne mentionne pas ${id}`);
    }
}

async function run(): Promise<void> {
    await testCalculatorToolsReachTheModel();
    await testGuidedProfileConfirmsDestructiveAideTools();
    await testOfflineProfileBlocksNetworkAideTools();
    await testToolOverrideCanDisableAideTool();
    await testNonManagedToolsAreKeptWithoutDuplicates();
    await testSystemPromptContainsGuardrailAndPolicy();
    // eslint-disable-next-line no-console
    console.log('doc-agent tests passed');
}

void run();
