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
    geocacheDetailsService?: unknown;
    logsFetchService?: unknown;
    logsAnalysisService?: unknown;
    friendsService?: unknown;
    archiveService?: unknown;
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
        'aide_find_geocache',
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

// §7 : aide_find_geocache résout d'abord par code GC, puis par nom via la
// recherche globale ; les autres tools acceptent gc_code en relais de geocache_id.
async function testFindGeocacheByCodeAndName(): Promise<void> {
    const searchCalls: string[] = [];
    const manager = createManager({
        geocachesService: {
            getByCode: async (code: string) => code === 'GC8ABCD'
                ? { id: 42, gc_code: 'GC8ABCD', name: 'La Cache', zone_id: 3 }
                : Promise.reject(new Error('404')),
        },
        globalSearchService: {
            searchDirect: async (query: string) => {
                searchCalls.push(query);
                return {
                    geocacheResults: [
                        { id: 7, gc_code: 'GC111', name: 'Chêne creux', zone_id: 1 },
                        { id: 8, gc_code: 'GC222', name: 'Chêne creux bis', zone_id: 2 },
                    ],
                    counts: { geocaches: 2 },
                };
            },
        },
    });
    const tools = manager.buildAllTools();
    const find = findTool(tools, 'aide_find_geocache');

    const byCode = await call(find, { gc_code: 'gc8abcd' });
    assert.equal(byCode.success, true);
    assert.equal((byCode.data as { geocaches: Array<{ id: number }> }).geocaches[0].id, 42);
    assert.equal(searchCalls.length, 0);

    const byName = await call(find, { name: 'chêne creux', zone_id: 2 });
    assert.deepEqual((byName.data as { geocaches: Array<{ id: number }> }).geocaches.map(g => g.id), [8]);

    const notFound = await call(find, { gc_code: 'GCXXXXX' });
    assert.equal(notFound.success, false);
}

// gc_code est accepté en relais de geocache_id sur open/get_details.
async function testOpenGeocacheAcceptsGcCode(): Promise<void> {
    const opened: number[] = [];
    const manager = createManager({
        geocachesService: { getByCode: async () => ({ id: 42 }) },
        geocacheTabsManager: { openGeocacheDetails: async (opts: { geocacheId: number }) => { opened.push(opts.geocacheId); } },
    });
    const tools = manager.buildAllTools();

    const result = await call(findTool(tools, 'aide_open_geocache'), { gc_code: 'GC8ABCD' });
    assert.equal(result.success, true);
    assert.deepEqual(opened, [42]);
}

// §8 : aide_list_geocaches_in_zone est paginé et annonce le total.
async function testListGeocachesPagination(): Promise<void> {
    const geocaches = Array.from({ length: 120 }, (_, i) => ({ id: i + 1, gc_code: `GC${i}`, name: `Cache ${i}` }));
    const manager = createManager({
        zonesService: { listGeocachesTree: async () => geocaches },
    });
    const tools = manager.buildAllTools();

    const page1 = await call(findTool(tools, 'aide_list_geocaches_in_zone'), { zone_id: 1 });
    const data1 = page1.data as { total: number; limit: number; geocaches: unknown[] };
    assert.equal(data1.total, 120);
    assert.equal(data1.geocaches.length, 50);

    const page3 = await call(findTool(tools, 'aide_list_geocaches_in_zone'), { zone_id: 1, limit: 50, offset: 100 });
    const data3 = page3.data as { geocaches: Array<{ id: number }> };
    assert.equal(data3.geocaches.length, 20);
    assert.equal(data3.geocaches[0].id, 101);
}

// §6 : les mutations waypoints/notes notifient les widgets pour rafraîchir la fiche.
async function testWaypointAndNoteEvents(): Promise<void> {
    const events: Array<{ geocacheId: number; reason: string }> = [];
    const manager = createManager({
        geocachesService: {
            createWaypoint: async () => ({ id: 5 }),
            deleteWaypoint: async () => undefined,
        },
        notesService: {
            createNote: async () => undefined,
            updateNote: async () => undefined,
            deleteNote: async () => undefined,
        },
        widgetEventsService: {
            notifyGeocacheChanged: (event: { geocacheId: number; reason: string }) => { events.push(event); },
        },
    });
    const tools = manager.buildAllTools();

    await call(findTool(tools, 'aide_create_waypoint'), { geocache_id: 9, name: 'Final', gc_coords: 'N 48° 51.500 E 002° 17.600' });
    await call(findTool(tools, 'aide_delete_waypoint'), { geocache_id: 9, waypoint_id: 5 });
    await call(findTool(tools, 'aide_create_note'), { geocache_id: 9, content: 'test' });
    await call(findTool(tools, 'aide_update_note'), { note_id: 3, content: 'x', geocache_id: 9 });
    await call(findTool(tools, 'aide_delete_note'), { note_id: 3, geocache_id: 9 });
    // Sans geocache_id, update/delete ne notifient pas (l'id de cache est inconnu).
    await call(findTool(tools, 'aide_update_note'), { note_id: 3, content: 'x' });

    assert.deepEqual(events.map(e => e.reason), [
        'waypoint-created',
        'waypoint-deleted',
        'note-created',
        'note-updated',
        'note-deleted',
    ]);
    assert.ok(events.every(e => e.geocacheId === 9));
}

// §9 : aide_get_geocache_details rend le listing complet (description HTML
// nettoyee, indices decodes, waypoints, checkers) partage avec l'agent GeoApp.
async function testGetGeocacheDetailsListing(): Promise<void> {
    const manager = createManager({
        geocachesService: {
            getByCode: async () => ({ id: 9 }),
            get: async () => ({
                id: 9,
                gc_code: 'GC9',
                name: 'Mystery',
                description_html: '<p>Indice &agrave; chercher <b>ici</b></p>',
                hints_decoded: 'sous le pont',
                waypoints: [{ prefix: 'FI', name: 'Final', type: 'Final Location', gc_coords: 'N 48 51.500 E 002 17.600' }],
                checkers: [{ name: 'Certitude', url: 'https://certitudes.org/x' }],
            }),
        },
    });
    const tools = manager.buildAllTools();
    const res = await call(findTool(tools, 'aide_get_geocache_details'), { gc_code: 'GC9' });
    assert.equal(res.success, true);
    const data = res.data as { listing: string; description_truncated: boolean };
    assert.match(data.listing, /LISTING COMPLET/);
    assert.match(data.listing, /Indice à chercher ici/);
    assert.match(data.listing, /sous le pont/);
    assert.match(data.listing, /Certitude: https:\/\/certitudes.org\/x/);
    assert.equal(data.description_truncated, false);
}

// §11 : les parametres `required` du schema sont verifies avant l'execution
// du handler — un appel incomplet renvoie une erreur explicite.
async function testRequiredParamsValidation(): Promise<void> {
    let called = 0;
    const manager = createManager({
        zonesService: { delete: async () => { called++; } },
        widgetEventsService: { requestZonesRefresh: () => undefined },
    });
    const tools = manager.buildAllTools();
    const del = findTool(tools, 'aide_delete_zone');

    const missing = await call(del, {});
    assert.equal(missing.success, false);
    assert.match(missing.error!, /zone_id/);
    assert.equal(called, 0);

    const partial = await call(del, { zone_id: 3 });
    assert.equal(partial.success, false);
    assert.match(partial.error!, /zone_name/);
    assert.equal(called, 0);

    const completed = await call(del, { zone_id: 3, zone_name: 'Bretagne' });
    assert.equal(completed.success, true);
    assert.equal(called, 1);
}

// Nouveaux tools statut/coordonnees : appels service + evenements de refresh.
async function testStatusAndWaypointTools(): Promise<void> {
    const events: string[] = [];
    const calls: Array<[number, unknown]> = [];
    const manager = createManager({
        geocachesService: { getByCode: async () => ({ id: 9 }) },
        geocacheDetailsService: {
            updateSolvedStatus: async (id: number, status: string) => { calls.push([id, status]); },
            saveWaypoint: async (id: number, wpId: number, payload: unknown) => { calls.push([wpId, payload]); },
        },
        widgetEventsService: {
            notifyGeocacheChanged: (e: { reason: string }) => { events.push(e.reason); },
        },
    });
    const tools = manager.buildAllTools();

    const status = await call(findTool(tools, 'aide_set_solved_status'), { gc_code: 'GC9', status: 'solved' });
    assert.equal(status.success, true);
    assert.deepEqual(calls[0], [9, 'solved']);

    const invalid = await call(findTool(tools, 'aide_set_solved_status'), { geocache_id: 9, status: 'bof' });
    assert.equal(invalid.success, false);

    const wp = await call(findTool(tools, 'aide_update_waypoint'), {
        geocache_id: 9, waypoint_id: 5, name: 'Final', note: 'x',
    });
    assert.equal(wp.success, true);
    assert.deepEqual(calls[1], [5, { name: 'Final', note: 'x' }]);

    assert.deepEqual(events, ['solved-status-updated', 'waypoint-updated']);
}

// Operations par lot : poursuite apres echec + resume succeeded/failed.
async function testBatchGeocacheTools(): Promise<void> {
    let refreshCount = 0;
    const deleted: number[] = [];
    const events: string[] = [];
    const manager = createManager({
        geocachesService: {
            delete: async (id: number) => {
                if (id === 2) { throw new Error('verrouillée'); }
                deleted.push(id);
            },
            move: async () => undefined,
        },
        widgetEventsService: {
            requestZonesRefresh: () => { refreshCount++; },
            notifyGeocacheChanged: (e: { reason: string }) => { events.push(e.reason); },
        },
    });
    const tools = manager.buildAllTools();

    const res = await call(findTool(tools, 'aide_delete_geocaches'), { geocache_ids: [1, 2, 3] });
    assert.equal(res.success, true);
    const summary = res.data as { succeeded: number[]; failed: Array<{ id: number }> };
    assert.deepEqual(summary.succeeded, [1, 3]);
    assert.equal(summary.failed.length, 1);
    assert.equal(summary.failed[0].id, 2);
    assert.equal(refreshCount, 1);
    assert.deepEqual(events, ['deleted', 'deleted']);

    // Sans geocache_ids, la validation bloque avant tout appel.
    const missing = await call(findTool(tools, 'aide_delete_geocaches'), {});
    assert.equal(missing.success, false);
    assert.deepEqual(deleted, [1, 3]);
}

// Lectures logs/amis/archive : passthrough compact, sans confirmation.
async function testReadTools(): Promise<void> {
    const manager = createManager({
        geocachesService: { getByCode: async () => ({ id: 9 }) },
        logsAnalysisService: {
            collectLogsToAnalyze: async () => ({
                storedCount: 2,
                totalAvailable: 10,
                logs: [
                    { id: 1, author: 'Bob', date: '2025-01-01', log_type: 'Found it', text: 'TFTC' },
                    { id: 2, author: 'Al', date: '2025-01-02', log_type: 'Note', text: 'x'.repeat(500) },
                ],
            }),
        },
        friendsService: {
            loadGeocacheFinds: async () => ({ success: true, friends: [{ name: 'Sam' }] }),
        },
        geocacheDetailsService: {
            getArchiveStatus: async () => ({ exists: true, needs_sync: false }),
        },
    });
    const tools = manager.buildAllTools();

    const logs = await call(findTool(tools, 'aide_get_geocache_logs'), { gc_code: 'GC9' });
    assert.equal(logs.success, true);
    const logsData = logs.data as { logs: Array<{ text: string }> };
    assert.equal(logsData.logs.length, 2);
    assert.ok(logsData.logs[1].text.length <= 400);

    const finds = await call(findTool(tools, 'aide_get_friend_finds_for_geocache'), { gc_code: 'GC9' });
    assert.equal(finds.success, true);

    const archive = await call(findTool(tools, 'aide_archive_status'), { gc_code: 'GC9' });
    assert.equal(archive.success, true);
    assert.equal((archive.data as { exists: boolean }).exists, true);
}

async function run(): Promise<void> {
    testConfirmationFlags();
    await testZoneMutationsRequestRefresh();
    await testSetActiveZoneAcceptsNull();
    await testSetPreferenceValidation();
    await testFindGeocacheByCodeAndName();
    await testOpenGeocacheAcceptsGcCode();
    await testListGeocachesPagination();
    await testWaypointAndNoteEvents();
    await testGetGeocacheDetailsListing();
    await testRequiredParamsValidation();
    await testStatusAndWaypointTools();
    await testBatchGeocacheTools();
    await testReadTools();
    // eslint-disable-next-line no-console
    console.log('doc-action-tools tests passed');
}

void run();
