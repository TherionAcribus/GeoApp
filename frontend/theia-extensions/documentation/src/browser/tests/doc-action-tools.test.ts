import * as assert from 'assert/strict';
import type { ToolRequest } from '@theia/ai-core';
import type { DocActionToolsManager } from '../doc-action-tools';

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

const { DocActionToolsManager: Manager } = require('../doc-action-tools') as {
    DocActionToolsManager: typeof DocActionToolsManager;
};

function createManager(services: {
    zonesService?: unknown;
    geocachesService?: unknown;
    notesService?: unknown;
    geocacheTabsManager?: unknown;
    zoneTabsManager?: unknown;
    widgetEventsService?: unknown;
    pluginsService?: unknown;
    pluginTabsManager?: unknown;
    alphabetsService?: unknown;
    alphabetTabsManager?: unknown;
    preferenceStore?: unknown;
    globalSearchService?: unknown;
    docSearchService?: unknown;
    docContentService?: unknown;
    commandService?: unknown;
    toolRegistry?: unknown;
}): DocActionToolsManager {
    const manager = new Manager();
    for (const [key, value] of Object.entries(services)) {
        if (value !== undefined) {
            (manager as any)[key] = value;
        }
    }
    return manager;
}

function findTool(tools: ToolRequest[], id: string): ToolRequest {
    const tool = tools.find(t => t.id === id);
    assert.ok(tool, `tool ${id} introuvable`);
    return tool!;
}

async function call(tool: ToolRequest, args: Record<string, unknown> = {}): Promise<{ success: boolean; data?: unknown; error?: string }> {
    const raw = await tool.handler(JSON.stringify(args), {} as any);
    return JSON.parse(typeof raw === 'string' ? raw : String(raw));
}

// Les actions irréversibles et réseau doivent toujours passer par la confirmation
// Theia ; les lectures et simples ouvertures n'en ont pas besoin.
function testConfirmationFlags(): void {
    const tools = createManager({}).buildAllTools();

    for (const id of [
        'aide_merge_zone',
        'aide_delete_zone',
        'aide_add_geocache_by_code',
        'aide_copy_geocache_to_zone',
        'aide_move_geocache',
        'aide_update_coordinates',
        'aide_refresh_geocache',
        'aide_export_gpx',
        'aide_delete_geocache',
        'aide_delete_waypoint',
        'aide_delete_note',
        'aide_sync_notes_from_geocaching',
    ]) {
        assert.ok(findTool(tools, id).confirmAlwaysAllow, `confirmation manquante sur ${id}`);
    }

    for (const id of [
        'aide_list_zones',
        'aide_create_zone',
        'aide_rename_zone',
        'aide_duplicate_zone',
        'aide_set_active_zone',
        'aide_get_geocache_details',
        'aide_list_geocaches_in_zone',
        'aide_get_nearby_geocaches',
        'aide_create_waypoint',
        'aide_set_waypoint_as_corrected',
        'aide_list_notes',
        'aide_create_note',
        'aide_update_note',
        'aide_list_plugins',
        'aide_run_plugin',
        'aide_set_preference',
        'aide_reset_preference',
        'aide_search',
        'aide_search_docs',
    ]) {
        assert.equal(findTool(tools, id).confirmAlwaysAllow, undefined, `confirmation inattendue sur ${id}`);
    }
}

// Écritures de zones : le handler doit rafraîchir la liste des zones.
async function testZoneMutationsRequestRefresh(): Promise<void> {
    let refreshCount = 0;
    const zonesService = {
        create: async (payload: unknown) => ({ id: 42, ...(payload as object) }),
        delete: async () => undefined,
    };
    const manager = createManager({
        zonesService,
        widgetEventsService: { requestZonesRefresh: () => { refreshCount++; } },
    });
    const tools = manager.buildAllTools();

    const created = await call(findTool(tools, 'aide_create_zone'), { name: 'Test' });
    assert.equal(created.success, true);
    assert.equal((created.data as { id: number }).id, 42);
    assert.equal(refreshCount, 1);

    await call(findTool(tools, 'aide_delete_zone'), { zone_id: 42, zone_name: 'Test' });
    assert.equal(refreshCount, 2);
}

// aide_set_active_zone : la description promet la désactivation via null.
async function testSetActiveZoneAcceptsNull(): Promise<void> {
    const calls: Array<number | null> = [];
    const manager = createManager({
        zonesService: { setActiveZone: async (id: number | null) => { calls.push(id); } },
        widgetEventsService: { requestZonesRefresh: () => undefined },
    });
    const tools = manager.buildAllTools();

    await call(findTool(tools, 'aide_set_active_zone'), { zone_id: 7 });
    await call(findTool(tools, 'aide_set_active_zone'), { zone_id: null });
    assert.deepEqual(calls, [7, null]);
}

// aide_set_preference : validation type/enum/plage + protection des clés sensibles.
async function testSetPreferenceValidation(): Promise<void> {
    const written: Record<string, unknown> = {};
    const preferenceStore = {
        schema: {
            properties: {
                'geoApp.map.zoom': { type: 'integer', minimum: 1, maximum: 20, default: 10 },
                'geoApp.chat.promptPack': { type: 'string', enum: ['guided', 'safe'], default: 'guided' },
                'geoApp.api.key': { type: 'string', 'x-sensitive': true },
            },
        },
        setValue: async (key: string, value: unknown) => { written[key] = value; },
    };
    const manager = createManager({ preferenceStore });
    const tools = manager.buildAllTools();
    const setPref = findTool(tools, 'aide_set_preference');

    assert.equal((await call(setPref, { key: 'inconnu', value: 'x' })).success, false);
    assert.equal((await call(setPref, { key: 'geoApp.api.key', value: 'x' })).success, false);
    assert.equal((await call(setPref, { key: 'geoApp.chat.promptPack', value: 'autre' })).success, false);
    assert.equal((await call(setPref, { key: 'geoApp.map.zoom', value: '99' })).success, false);
    assert.equal((await call(setPref, { key: 'geoApp.map.zoom', value: 'abc' })).success, false);

    assert.equal((await call(setPref, { key: 'geoApp.map.zoom', value: '15' })).success, true);
    assert.equal(written['geoApp.map.zoom'], 15);
    assert.equal((await call(setPref, { key: 'geoApp.chat.promptPack', value: 'safe' })).success, true);
}

async function run(): Promise<void> {
    testConfirmationFlags();
    await testZoneMutationsRequestRefresh();
    await testSetActiveZoneAcceptsNull();
    await testSetPreferenceValidation();
    // eslint-disable-next-line no-console
    console.log('doc-action-tools tests passed');
}

void run();
