import * as assert from 'assert/strict';
import type { DocActionContextService } from '../doc-action-context-service';

declare const require: any;
declare const global: any;

require.extensions['.css'] = () => undefined;

// parseWidget est prive : on teste le rendu via formatContextForPrompt et la
// collecte via collectContext avec un shell factice.
// ApplicationShell -> lumino exige un DOM : meme preambule jsdom que les
// autres tests de l'extension (canvas natif non compile sur ce poste).
const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request: string, ...rest: unknown[]) {
    if (request === 'canvas') { return {}; }
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

const { DocActionContextService: Service } = require('../doc-action-context-service') as {
    DocActionContextService: typeof DocActionContextService;
};

function createService(options?: {
    activeWidget?: { id: string; [key: string]: unknown };
    widgets?: Array<{ id: string; [key: string]: unknown }>;
    activeZone?: { id?: number | null; name?: string } | undefined;
}): DocActionContextService {
    const service = new Service();
    (service as any).shell = {
        activeWidget: options?.activeWidget,
        getWidgets: () => options?.widgets ?? [],
        onDidChangeActiveWidget: () => ({ dispose: () => undefined }),
    };
    (service as any).zonesService = {
        getActiveZone: async () => options?.activeZone,
    };
    return service;
}

// §13 : la selection cochee de la table de zone est exposee au prompt.
async function testZoneTableSelectionExposed(): Promise<void> {
    const table = {
        id: 'zone.geocaches.widget:3',
        zoneId: 3,
        zoneName: 'Bretagne',
        selectedGeocacheIds: [11, 12, 13],
    };
    const service = createService({
        activeWidget: table,
        widgets: [table],
        activeZone: { id: 3, name: 'Bretagne' },
    });

    const context = await service.collectContext();
    assert.equal(context.activeWidget?.kind, 'zone-geocaches');
    assert.deepEqual(context.activeWidget?.selection, [11, 12, 13]);

    const text = service.formatContextForPrompt(context);
    assert.match(text, /3 géocache\(s\) cochée\(s\)/);
    assert.match(text, /geocache_ids=\[11,12,13\]/);
}

// §13 : les widgets elargis sont reconnus (plugin executor, logs, carte...).
async function testExtendedWidgetKinds(): Promise<void> {
    const executor = { id: 'plugin-executor-widget:0', selectedPlugin: 'morse_code' };
    const logs = { id: 'geocache.logs.widget:9', geocacheId: 9 };
    const service = createService({
        widgets: [executor, logs, { id: 'geoapp-map' }, { id: 'theia-editor' }],
    });

    const context = await service.collectContext();
    const kinds = context.openTabs.map(tab => tab.kind);
    assert.deepEqual(kinds, ['plugin-executor', 'logs', 'map']);

    const executorTab = context.openTabs.find(tab => tab.kind === 'plugin-executor');
    assert.equal(executorTab?.pluginName, 'morse_code');
    const logsTab = context.openTabs.find(tab => tab.kind === 'logs');
    assert.equal(logsTab?.geocacheId, 9);

    const text = service.formatContextForPrompt(context);
    assert.match(text, /plugin: morse_code/);
}

async function run(): Promise<void> {
    await testZoneTableSelectionExposed();
    await testExtendedWidgetKinds();
    // eslint-disable-next-line no-console
    console.log('doc-action-context tests passed');
}

void run();
