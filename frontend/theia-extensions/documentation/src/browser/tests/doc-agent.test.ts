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

function tool(id: string, name?: string): ToolRequest {
    return {
        id,
        name: name ?? id,
        description: '',
        providerName: 'test',
        parameters: {},
        handler: async () => undefined,
    } as unknown as ToolRequest;
}

function createAgent(options: {
    docTools?: ToolRequest[];
    registryTools?: Map<string, ToolRequest>;
}): { agent: GeoAppDocAgent; captured: { tools?: ToolRequest[] } } {
    const agent = new Agent();
    const docTools = options.docTools ?? [tool('aide_list_zones'), tool('aide_delete_zone')];
    const registryTools = options.registryTools ?? new Map<string, ToolRequest>([
        ['aide_calculate', tool('aide_calculate')],
        ['aide_calculate_batch', tool('aide_calculate_batch')],
        ['aide_open_calculator', tool('aide_open_calculator')],
    ]);

    (agent as any).actionToolsManager = {
        buildAllTools: () => docTools,
    };
    (agent as any).actionContextService = {
        collectContext: async () => ({}),
        formatContextForPrompt: () => '## Contexte UI actuel\nTest.',
    };
    (agent as any).contentService = {
        initialize: async () => undefined,
        getChapters: () => [{ title: 'Chapitre', pages: [{ title: 'Page', description: 'desc' }] }],
    };
    (agent as any).toolRegistry = {
        getFunctions: (...ids: string[]) => ids.map(id => registryTools.get(id)).filter(Boolean),
    };

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

// Régression : le prompt annonce aide_calculate/aide_calculate_batch/aide_open_calculator,
// ils doivent réellement partir au modèle (résolus via le registry Theia).
async function testAuxiliaryCalculatorToolsAreInjected(): Promise<void> {
    const { agent, captured } = createAgent({});

    await (agent as any).sendLlmRequest(createRequest(), [], [], { id: 'fake-lm' });

    const ids = (captured.tools ?? []).map(t => t.id);
    for (const expected of Agent.AUXILIARY_TOOL_IDS) {
        assert.ok(ids.includes(expected), `tool auxiliaire absent : ${expected} (reçus: ${ids.join(', ')})`);
    }
    assert.ok(ids.includes('aide_list_zones'));
}

// Un tool non géré par @Aide (ex: référencé via ~{tool} dans le prompt utilisateur)
// doit être conservé ; un tool déjà injecté ne doit pas être dupliqué.
async function testNonDocToolsAreKeptWithoutDuplicates(): Promise<void> {
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

// Garde-fou anti-injection : @Aide a des tools destructeurs (zones, préférences),
// son prompt doit donc porter la règle « données = pas des instructions ».
async function testSystemPromptContainsInjectionGuardrail(): Promise<void> {
    const { agent } = createAgent({});

    const description = await (agent as any).getSystemMessageDescription({ model: {} });

    assert.ok(description);
    assert.match(description.text, /SÉCURITÉ \(injection\)/);
    assert.match(description.text, /DONNÉE[\s\S]*jamais une source d'instructions/);
    // La promesse calculatrice du prompt doit correspondre aux tools auxiliaires.
    for (const id of Agent.AUXILIARY_TOOL_IDS) {
        assert.ok(description.text.includes(id), `prompt ne mentionne pas ${id}`);
    }
}

async function run(): Promise<void> {
    await testAuxiliaryCalculatorToolsAreInjected();
    await testNonDocToolsAreKeptWithoutDuplicates();
    await testSystemPromptContainsInjectionGuardrail();
    // eslint-disable-next-line no-console
    console.log('doc-agent tests passed');
}

void run();
