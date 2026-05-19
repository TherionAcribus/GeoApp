import { injectable, inject } from '@theia/core/shared/inversify';
import { CommandService } from '@theia/core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import {
    ToolInvocationRegistry,
    ToolRequest,
    ToolRequestParameters,
    ToolCallResult,
} from '@theia/ai-core';
import { ZonesService } from 'theia-ide-zones-ext/lib/browser/zones-service';
import { GeocachesService } from 'theia-ide-zones-ext/lib/browser/geocaches-service';
import { GeocacheNotesService } from 'theia-ide-zones-ext/lib/browser/geocache-notes-service';
import { GeocacheTabsManager } from 'theia-ide-zones-ext/lib/browser/geocache-tabs-manager';
import { ZoneTabsManager } from 'theia-ide-zones-ext/lib/browser/zone-tabs-manager';
import { GeoAppWidgetEventsService } from 'theia-ide-zones-ext/lib/browser/geoapp-widget-events-service';
import { PluginsService } from '@mysterai/theia-plugins/lib/common/plugin-protocol';
import { PluginTabsManager } from '@mysterai/theia-plugins/lib/browser/plugin-tabs-manager';
import { AlphabetsService } from '@mysterai/theia-alphabets/lib/browser/services/alphabets-service';
import { AlphabetTabsManager } from '@mysterai/theia-alphabets/lib/browser/alphabet-tabs-manager';
import { GeoPreferenceStore } from '@mysterai/theia-preferences/lib/browser/geo-preference-store';
import { GeoPreferenceDefinition } from '@mysterai/theia-preferences/lib/browser/geo-preferences-schema';
import { GlobalSearchService } from 'theia-ide-search-ext/lib/browser/global-search-service';

export const AIDE_TOOL_PREFIX = 'aide_';

const ok = (data: unknown): string => JSON.stringify({ success: true, data });
const err = (message: string): string => JSON.stringify({ success: false, error: message });

function buildParams(
    props: Record<string, { type: string; description: string; required?: boolean; enum?: string[] }>
): ToolRequestParameters {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(props)) {
        const { required: isRequired, ...rest } = value;
        properties[key] = rest;
        if (isRequired) { required.push(key); }
    }
    return { type: 'object', properties, required, additionalProperties: false } as ToolRequestParameters;
}

function parseArgs(argString: string): Record<string, any> {
    try {
        return JSON.parse(argString || '{}');
    } catch {
        return {};
    }
}

@injectable()
export class DocActionToolsManager implements FrontendApplicationContribution {

    static readonly PROVIDER_NAME = 'geoapp.aide';

    @inject(ToolInvocationRegistry)
    protected readonly toolRegistry!: ToolInvocationRegistry;

    @inject(CommandService)
    protected readonly commandService!: CommandService;

    @inject(ZonesService)
    protected readonly zonesService!: ZonesService;

    @inject(GeocachesService)
    protected readonly geocachesService!: GeocachesService;

    @inject(GeocacheNotesService)
    protected readonly notesService!: GeocacheNotesService;

    @inject(GeocacheTabsManager)
    protected readonly geocacheTabsManager!: GeocacheTabsManager;

    @inject(ZoneTabsManager)
    protected readonly zoneTabsManager!: ZoneTabsManager;

    @inject(GeoAppWidgetEventsService)
    protected readonly widgetEventsService!: GeoAppWidgetEventsService;

    @inject(PluginsService)
    protected readonly pluginsService!: PluginsService;

    @inject(PluginTabsManager)
    protected readonly pluginTabsManager!: PluginTabsManager;

    @inject(AlphabetsService)
    protected readonly alphabetsService!: AlphabetsService;

    @inject(AlphabetTabsManager)
    protected readonly alphabetTabsManager!: AlphabetTabsManager;

    @inject(GeoPreferenceStore)
    protected readonly preferenceStore!: GeoPreferenceStore;

    @inject(GlobalSearchService)
    protected readonly globalSearchService!: GlobalSearchService;

    async onStart(): Promise<void> {
        const tools = this.buildAllTools();
        for (const tool of tools) {
            try {
                await this.toolRegistry.registerTool(tool);
            } catch (e) {
                console.warn(`[AIDE-TOOLS] Could not register tool ${tool.id}:`, e);
            }
        }
    }

    buildAllTools(): ToolRequest[] {
        return [
            ...this.buildNavigationTools(),
            ...this.buildZoneTools(),
            ...this.buildGeocacheTools(),
            ...this.buildWaypointTools(),
            ...this.buildNoteTools(),
            ...this.buildPluginTools(),
            ...this.buildAlphabetTools(),
            ...this.buildPreferenceTools(),
            ...this.buildSearchTools(),
        ];
    }

    // ─── Preferences ──────────────────────────────────────────────────────────

    private buildPreferenceTools(): ToolRequest[] {
        return [
            {
                id: 'aide_list_preferences',
                name: 'aide_list_preferences',
                description: 'Liste toutes les préférences GeoApp avec leur valeur courante, type, description et valeurs possibles. ' +
                    'Catégories disponibles : ai, earthcoach, chat, ui, map, plugins, ocr, images, updates, backend, logs, search. ' +
                    'Les valeurs sensibles (clés API) sont masquées.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    category: { type: 'string', description: 'Filtrer par catégorie (ex: "ai", "map", "ui"). Laisser vide pour tout retourner.', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const entries = args.category
                            ? [...(this.preferenceStore.definitionsByCategory.get(args.category) ?? [])]
                            : this.preferenceStore.definitions;
                        const snapshot = this.preferenceStore.getSnapshot();
                        return ok(entries.map(({ key, definition }) => {
                            const def = definition as GeoPreferenceDefinition;
                            return {
                                key,
                                category: def['x-category'],
                                type: def.type,
                                description: def.description,
                                default: def.default,
                                enum: def.enum,
                                minimum: def.minimum,
                                maximum: def.maximum,
                                value: def['x-sensitive'] ? '***' : snapshot[key],
                                sensitive: def['x-sensitive'] ?? false,
                            };
                        }));
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_get_preference',
                name: 'aide_get_preference',
                description: 'Retourne la valeur courante et les métadonnées d\'une préférence GeoApp spécifique.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    key: { type: 'string', description: 'Clé de la préférence (ex: "geoApp.ai.enabled", "geoApp.map.defaultProvider").', required: true },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const def = this.preferenceStore.schema.properties?.[args.key] as GeoPreferenceDefinition | undefined;
                        if (!def) { return err(`Préférence inconnue : "${args.key}".`); }
                        if (def['x-sensitive']) { return err(`Cette préférence est sensible et ne peut pas être lue par @Aide.`); }
                        const snapshot = this.preferenceStore.getSnapshot();
                        return ok({
                            key: args.key,
                            value: snapshot[args.key],
                            default: def.default,
                            type: def.type,
                            description: def.description,
                            enum: def.enum,
                            minimum: def.minimum,
                            maximum: def.maximum,
                            category: def['x-category'],
                        });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_set_preference',
                name: 'aide_set_preference',
                description: 'Modifie la valeur d\'une préférence GeoApp. Valide le type, les valeurs enum et les plages numériques. ' +
                    'Les préférences sensibles (clés API) sont protégées et ne peuvent pas être modifiées.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    key: { type: 'string', description: 'Clé de la préférence à modifier (ex: "geoApp.ai.enabled").', required: true },
                    value: { type: 'string', description: 'Nouvelle valeur. Booléens: "true"/"false". Nombres: "42". Enum: la valeur choisie.', required: true },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const def = this.preferenceStore.schema.properties?.[args.key] as GeoPreferenceDefinition | undefined;
                        if (!def) { return err(`Préférence inconnue : "${args.key}".`); }
                        if (def['x-sensitive']) { return err(`Cette préférence est sensible et ne peut pas être modifiée par @Aide.`); }
                        let coerced: unknown = args.value;
                        if (def.type === 'boolean') {
                            coerced = args.value === true || String(args.value).toLowerCase() === 'true';
                        } else if (def.type === 'integer') {
                            coerced = parseInt(String(args.value), 10);
                            if (isNaN(coerced as number)) { return err(`Valeur invalide pour "${args.key}" : attendu un entier.`); }
                        } else if (def.type === 'number') {
                            coerced = parseFloat(String(args.value));
                            if (isNaN(coerced as number)) { return err(`Valeur invalide pour "${args.key}" : attendu un nombre.`); }
                        }
                        if (def.enum && !(def.enum as unknown[]).includes(coerced)) {
                            return err(`Valeur invalide pour "${args.key}". Valeurs acceptées : ${(def.enum as unknown[]).join(', ')}`);
                        }
                        if (def.minimum !== undefined && (coerced as number) < def.minimum) {
                            return err(`Valeur trop petite pour "${args.key}" : minimum ${def.minimum}.`);
                        }
                        if (def.maximum !== undefined && (coerced as number) > def.maximum) {
                            return err(`Valeur trop grande pour "${args.key}" : maximum ${def.maximum}.`);
                        }
                        await this.preferenceStore.setValue(args.key, coerced);
                        return ok(`Préférence "${args.key}" mise à jour : ${JSON.stringify(coerced)}.`);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
        ];
    }

    // ─── Navigation ──────────────────────────────────────────────────────────

    private buildNavigationTools(): ToolRequest[] {
        return [
            {
                id: 'aide_open_documentation',
                name: 'aide_open_documentation',
                description: 'Ouvre le widget de documentation GeoApp.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({}),
                handler: async () => {
                    try {
                        await this.commandService.executeCommand('geoapp.documentation.open');
                        return ok('Documentation ouverte.');
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_open_preferences',
                name: 'aide_open_preferences',
                description: 'Ouvre le panneau des préférences GeoApp.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    category: { type: 'string', description: 'Catégorie optionnelle à afficher directement (ex: "earthcoach", "chat", "ai", "map").', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        await this.commandService.executeCommand('geo-preferences:open', { category: args.category });
                        return ok('Préférences ouvertes.');
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_open_plugins_panel',
                name: 'aide_open_plugins_panel',
                description: 'Ouvre le navigateur de plugins GeoApp.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({}),
                handler: async () => {
                    try {
                        await this.commandService.executeCommand('plugins.openBrowser');
                        return ok('Panneau plugins ouvert.');
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_open_alphabets_panel',
                name: 'aide_open_alphabets_panel',
                description: 'Ouvre la liste des alphabets GeoApp (décodage de symboles).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({}),
                handler: async () => {
                    try {
                        await this.commandService.executeCommand('alphabets.openList');
                        return ok('Panneau alphabets ouvert.');
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_open_map',
                name: 'aide_open_map',
                description: 'Ouvre ou affiche la carte des géocaches.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({}),
                handler: async () => {
                    try {
                        await this.commandService.executeCommand('geoapp.map.toggle');
                        return ok('Carte affichée.');
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_open_archive_manager',
                name: 'aide_open_archive_manager',
                description: 'Ouvre le gestionnaire d\'archive GPX.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({}),
                handler: async () => {
                    try {
                        await this.commandService.executeCommand('geoapp.archive.manager.open');
                        return ok('Gestionnaire d\'archive ouvert.');
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_open_zones_list',
                name: 'aide_open_zones_list',
                description: 'Ouvre le panneau latéral de liste des zones.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({}),
                handler: async () => {
                    try {
                        await this.commandService.executeCommand('zones:open');
                        return ok('Liste des zones ouverte.');
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_open_zone_tab',
                name: 'aide_open_zone_tab',
                description: 'Ouvre l\'onglet tableau de géocaches d\'une zone.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    zone_id: { type: 'number', description: 'ID de la zone à ouvrir.', required: true },
                    zone_name: { type: 'string', description: 'Nom optionnel de la zone (pour l\'onglet).', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        await this.zoneTabsManager.openZone({ zoneId: args.zone_id, zoneName: args.zone_name });
                        return ok(`Zone ${args.zone_id} ouverte.`);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_open_geocache',
                name: 'aide_open_geocache',
                description: 'Ouvre la fiche de détails d\'une géocache.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    geocache_id: { type: 'number', description: 'ID de la géocache à ouvrir.', required: true },
                    name: { type: 'string', description: 'Nom optionnel de la géocache (pour l\'onglet).', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        await this.geocacheTabsManager.openGeocacheDetails({ geocacheId: args.geocache_id, name: args.name });
                        return ok(`Géocache ${args.geocache_id} ouverte.`);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
        ];
    }

    // ─── Plugins ──────────────────────────────────────────────────────────────

    private buildPluginTools(): ToolRequest[] {
        return [
            {
                id: 'aide_list_plugins',
                name: 'aide_list_plugins',
                description: 'Retourne la liste complète des plugins disponibles avec leurs catégories et tags. ' +
                    'Ne filtre PAS par texte : pour trouver un plugin à partir d\'un concept sémantique ' +
                    '(ex: "magie", "téléphone", "morse"), récupérez la liste complète puis identifiez ' +
                    'le plugin par vos propres connaissances. Filtre optionnel par catégorie API uniquement.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    category: { type: 'string', description: 'Filtrer par catégorie API (ex: "cipher", "encoding", "morse"). Laisser vide pour tout retourner.', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const filters: any = {};
                        if (args.category) { filters.category = args.category; }
                        const plugins = await this.pluginsService.listPlugins(filters);
                        let tagsMap: Map<string, string[]> = new Map();
                        try {
                            const eligible = await this.pluginsService.getMetasolverEligiblePlugins('all');
                            for (const ep of eligible.plugins) {
                                tagsMap.set(ep.name, ep.tags);
                            }
                        } catch { /* tags optionnels */ }
                        return ok(plugins.map(p => ({
                            name: p.name,
                            description: p.description,
                            categories: p.categories,
                            tags: tagsMap.get(p.name) ?? [],
                            source: p.source,
                            enabled: p.enabled,
                        })));
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_get_plugin_info',
                name: 'aide_get_plugin_info',
                description: 'Retourne les détails complets d\'un plugin : description, catégories, paramètres d\'entrée, auteur.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    plugin_name: { type: 'string', description: 'Nom exact du plugin (tel que retourné par aide_list_plugins).', required: true },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const plugin = await this.pluginsService.getPlugin(args.plugin_name);
                        return ok({
                            name: plugin.name,
                            description: plugin.description,
                            categories: plugin.categories,
                            source: plugin.source,
                            enabled: plugin.enabled,
                            author: plugin.author,
                            version: plugin.version,
                            heavy_cpu: plugin.heavy_cpu,
                            needs_network: plugin.needs_network,
                            input_types: plugin.input_types,
                        });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_open_plugin_tab',
                name: 'aide_open_plugin_tab',
                description: 'Ouvre un onglet de déchiffrement avec un plugin pré-sélectionné.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    plugin_name: { type: 'string', description: 'Nom exact du plugin à ouvrir (tel que retourné par aide_list_plugins).', required: true },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        await this.pluginTabsManager.openPlugin({ pluginName: args.plugin_name });
                        return ok(`Plugin "${args.plugin_name}" ouvert.`);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
        ];
    }

    // ─── Alphabets ────────────────────────────────────────────────────────────

    private buildAlphabetTools(): ToolRequest[] {
        return [
            {
                id: 'aide_list_alphabets',
                name: 'aide_list_alphabets',
                description: 'Liste les alphabets de décodage de symboles disponibles. Accepte un texte de recherche optionnel pour trouver un alphabet par nom, tag ou description.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    search: { type: 'string', description: 'Texte de recherche optionnel (ex: "gallifreyen", "alien", "runes").', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const options = args.search
                            ? { query: args.search, search_in_name: true, search_in_tags: true, search_in_readme: true }
                            : undefined;
                        const alphabets = await this.alphabetsService.listAlphabets(options);
                        return ok(alphabets.map(a => ({
                            id: a.id,
                            name: a.name,
                            description: a.description,
                            type: a.type,
                            tags: a.tags,
                            source: a.source,
                        })));
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_get_alphabet_info',
                name: 'aide_get_alphabet_info',
                description: 'Retourne les détails d\'un alphabet : nom, description, tags, type de rendu (polices ou images), jeu de caractères supportés.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    alphabet_id: { type: 'string', description: 'ID de l\'alphabet (tel que retourné par aide_list_alphabets).', required: true },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const alphabet = await this.alphabetsService.getAlphabet(args.alphabet_id);
                        return ok({
                            id: alphabet.id,
                            name: alphabet.name,
                            description: alphabet.description,
                            type: alphabet.type,
                            tags: alphabet.tags,
                            source: alphabet.source,
                            sources: alphabet.sources,
                            config: {
                                renderType: alphabet.alphabetConfig.type,
                                hasUpperCase: alphabet.alphabetConfig.hasUpperCase,
                                letters: alphabet.alphabetConfig.characters.letters,
                                numbers: alphabet.alphabetConfig.characters.numbers,
                                specialChars: Object.keys(alphabet.alphabetConfig.characters.special ?? {}),
                            },
                        });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_open_alphabet_tab',
                name: 'aide_open_alphabet_tab',
                description: 'Ouvre un onglet de décodage de symboles pour un alphabet spécifique.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    alphabet_id: { type: 'string', description: 'ID de l\'alphabet à ouvrir (tel que retourné par aide_list_alphabets).', required: true },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        await this.alphabetTabsManager.openAlphabet({ alphabetId: args.alphabet_id });
                        return ok(`Alphabet "${args.alphabet_id}" ouvert.`);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
        ];
    }

    // ─── Zones ───────────────────────────────────────────────────────────────

    private buildZoneTools(): ToolRequest[] {
        return [
            {
                id: 'aide_list_zones',
                name: 'aide_list_zones',
                description: 'Liste toutes les zones de résolution disponibles avec leurs id, noms et descriptions.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({}),
                handler: async () => {
                    try {
                        const zones = await this.zonesService.list<{ id: number; name: string; description?: string }>();
                        return ok(zones);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_create_zone',
                name: 'aide_create_zone',
                description: 'Crée une nouvelle zone de résolution.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    name: { type: 'string', description: 'Nom de la nouvelle zone.', required: true },
                    description: { type: 'string', description: 'Description optionnelle.', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const zone = await this.zonesService.create<{ id: number; name: string }>({
                            name: args.name,
                            description: args.description,
                        });
                        this.widgetEventsService.requestZonesRefresh();
                        return ok(zone);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_delete_zone',
                name: 'aide_delete_zone',
                description: 'Supprime définitivement une zone et toutes ses géocaches. Action irréversible.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    zone_id: { type: 'number', description: 'ID de la zone à supprimer.', required: true },
                    zone_name: { type: 'string', description: 'Nom de la zone (pour confirmation).', required: true },
                }),
                confirmAlwaysAllow: 'Supprimer la zone et toutes ses géocaches ? Cette action est irréversible.',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        await this.zonesService.delete(args.zone_id);
                        this.widgetEventsService.requestZonesRefresh();
                        return ok(`Zone "${args.zone_name}" (id:${args.zone_id}) supprimée.`);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_set_active_zone',
                name: 'aide_set_active_zone',
                description: 'Définit la zone active (sélectionnée) dans GeoApp. Passer null pour désactiver.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    zone_id: { type: 'number', description: 'ID de la zone à activer (ou null pour désactiver).', required: true },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        await this.zonesService.setActiveZone(args.zone_id ?? null);
                        this.widgetEventsService.requestZonesRefresh();
                        return ok(`Zone active définie à ${args.zone_id ?? 'null'}.`);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
        ];
    }

    // ─── Géocaches ───────────────────────────────────────────────────────────

    private buildGeocacheTools(): ToolRequest[] {
        return [
            {
                id: 'aide_get_geocache_details',
                name: 'aide_get_geocache_details',
                description: 'Retourne le contenu complet d\'une géocache : nom, code GC, type, difficulté, terrain, coordonnées, ' +
                    'description (texte brut), indices, waypoints et statut résolu/trouvé. ' +
                    'À appeler quand l\'utilisateur demande le contenu de "cette cache" ou "la cache à l\'écran".',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    geocache_id: { type: 'number', description: 'ID de la géocache.', required: true },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const raw = await this.geocachesService.get<Record<string, unknown>>(args.geocache_id);
                        const desc = typeof raw['description_raw'] === 'string' ? raw['description_raw']
                            : typeof raw['description'] === 'string' ? raw['description'] : null;
                        const hint = raw['hints_decoded'] ?? raw['hint_raw'] ?? raw['hint'] ?? raw['hints'] ?? null;
                        const waypoints = (Array.isArray(raw['waypoints']) ? raw['waypoints'] : [])
                            .map((w: Record<string, unknown>) => ({
                                id: w['id'],
                                name: w['name'],
                                type: w['type'],
                                gc_coords: w['gc_coords'],
                                note: w['note'],
                            }));
                        return ok({
                            id: raw['id'],
                            gc_code: raw['gc_code'],
                            name: raw['name'],
                            owner: raw['owner'],
                            cache_type: raw['cache_type'] ?? raw['type'],
                            difficulty: raw['difficulty'],
                            terrain: raw['terrain'],
                            size: raw['size'],
                            solved: raw['solved'],
                            found: raw['found'],
                            favorites_count: raw['favorites_count'],
                            coordinates_raw: raw['coordinates_raw'],
                            is_corrected: raw['is_corrected'],
                            description: typeof desc === 'string' ? desc.substring(0, 3000) : null,
                            hint,
                            waypoints,
                        });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_list_geocaches_in_zone',
                name: 'aide_list_geocaches_in_zone',
                description: 'Liste les géocaches d\'une zone avec leurs id, code GC et noms.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    zone_id: { type: 'number', description: 'ID de la zone.', required: true },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const geocaches = await this.zonesService.listGeocaches<{ id: number; gc_code: string; name: string }>(args.zone_id);
                        return ok(geocaches);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_add_geocache_by_code',
                name: 'aide_add_geocache_by_code',
                description: 'Ajoute une géocache à une zone en utilisant son code GC (ex: GC12345). Nécessite une connexion Geocaching.com.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    zone_id: { type: 'number', description: 'ID de la zone cible.', required: true },
                    gc_code: { type: 'string', description: 'Code GC de la géocache (ex: "GC12345").', required: true },
                }),
                confirmAlwaysAllow: 'Ajouter cette géocache à la zone ? Une requête sera effectuée vers Geocaching.com.',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const result = await this.geocachesService.addToZone(args.zone_id, args.gc_code);
                        this.widgetEventsService.requestZonesRefresh();
                        return ok(result ?? { added: true });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_copy_geocache_to_zone',
                name: 'aide_copy_geocache_to_zone',
                description: 'Copie une géocache vers une autre zone (sans la supprimer de la zone source).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    geocache_id: { type: 'number', description: 'ID de la géocache à copier.', required: true },
                    target_zone_id: { type: 'number', description: 'ID de la zone cible.', required: true },
                }),
                confirmAlwaysAllow: 'Copier cette géocache vers la zone cible ?',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const result = await this.geocachesService.copy(args.geocache_id, args.target_zone_id);
                        this.widgetEventsService.requestZonesRefresh();
                        return ok(result ?? { copied: true });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_delete_geocache',
                name: 'aide_delete_geocache',
                description: 'Supprime définitivement une géocache et toutes ses données (waypoints, notes). Action irréversible.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    geocache_id: { type: 'number', description: 'ID de la géocache à supprimer.', required: true },
                }),
                confirmAlwaysAllow: 'Supprimer cette géocache et toutes ses données (waypoints, notes) ? Action irréversible.',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        await this.geocachesService.delete(args.geocache_id);
                        this.widgetEventsService.requestZonesRefresh();
                        return ok(`Géocache ${args.geocache_id} supprimée.`);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
        ];
    }

    // ─── Waypoints ───────────────────────────────────────────────────────────

    private buildWaypointTools(): ToolRequest[] {
        return [
            {
                id: 'aide_create_waypoint',
                name: 'aide_create_waypoint',
                description: 'Crée un waypoint sur une géocache (coordonnées au format DDM, ex: "N 48° 51.500 E 002° 17.600").',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    geocache_id: { type: 'number', description: 'ID de la géocache.', required: true },
                    name: { type: 'string', description: 'Nom du waypoint.', required: true },
                    gc_coords: { type: 'string', description: 'Coordonnées au format DDM (ex: "N 48° 51.500 E 002° 17.600").', required: true },
                    note: { type: 'string', description: 'Note optionnelle.', required: false },
                    type: {
                        type: 'string',
                        description: 'Type de waypoint (ex: "Final Location", "Parking Area", "Reference Point").',
                        required: false,
                    },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const result = await this.geocachesService.createWaypoint(args.geocache_id, {
                            name: args.name,
                            gc_coords: args.gc_coords,
                            note: args.note,
                            type: args.type,
                        });
                        return ok(result ?? { created: true });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_delete_waypoint',
                name: 'aide_delete_waypoint',
                description: 'Supprime définitivement un waypoint d\'une géocache. Action irréversible.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    geocache_id: { type: 'number', description: 'ID de la géocache.', required: true },
                    waypoint_id: { type: 'number', description: 'ID du waypoint à supprimer.', required: true },
                }),
                confirmAlwaysAllow: 'Supprimer ce waypoint ? Action irréversible.',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        await this.geocachesService.deleteWaypoint(args.geocache_id, args.waypoint_id);
                        return ok(`Waypoint ${args.waypoint_id} supprimé.`);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
        ];
    }

    // ─── Notes ───────────────────────────────────────────────────────────────

    private buildNoteTools(): ToolRequest[] {
        return [
            {
                id: 'aide_create_note',
                name: 'aide_create_note',
                description: 'Crée une note utilisateur sur une géocache.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    geocache_id: { type: 'number', description: 'ID de la géocache.', required: true },
                    content: { type: 'string', description: 'Contenu de la note.', required: true },
                    note_type: {
                        type: 'string',
                        description: 'Type de note : "user" (note personnelle, défaut) ou "system".',
                        required: false,
                        enum: ['user', 'system'],
                    },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    const noteType = args.note_type === 'system' ? 'system' : 'user';
                    try {
                        await this.notesService.createNote(args.geocache_id, {
                            content: args.content,
                            note_type: noteType,
                            source: 'user',
                        });
                        return ok('Note créée.');
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_update_note',
                name: 'aide_update_note',
                description: 'Met à jour le contenu d\'une note existante.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    note_id: { type: 'number', description: 'ID de la note à modifier.', required: true },
                    content: { type: 'string', description: 'Nouveau contenu de la note.', required: true },
                    note_type: {
                        type: 'string',
                        description: 'Type de note : "user" ou "system".',
                        required: false,
                        enum: ['user', 'system'],
                    },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    const noteType = args.note_type === 'system' ? 'system' : 'user';
                    try {
                        await this.notesService.updateNote(args.note_id, {
                            content: args.content,
                            note_type: noteType,
                        });
                        return ok('Note mise à jour.');
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_delete_note',
                name: 'aide_delete_note',
                description: 'Supprime définitivement une note. Action irréversible.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    note_id: { type: 'number', description: 'ID de la note à supprimer.', required: true },
                }),
                confirmAlwaysAllow: 'Supprimer cette note ? Action irréversible.',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        await this.notesService.deleteNote(args.note_id);
                        return ok(`Note ${args.note_id} supprimée.`);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
        ];
    }

    // ─── Recherche globale ────────────────────────────────────────────────────

    private buildSearchTools(): ToolRequest[] {
        return [
            {
                id: 'aide_open_global_search',
                name: 'aide_open_global_search',
                description: 'Ouvre le panneau de recherche globale GeoApp (sidebar gauche). ' +
                    'Permet de rechercher dans les onglets ouverts et la base de données.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({}),
                handler: async () => {
                    try {
                        await this.commandService.executeCommand('geoapp.globalSearch.open');
                        return ok('Panneau de recherche globale ouvert.');
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_search',
                name: 'aide_search',
                description: 'Recherche un terme dans GeoApp. ' +
                    'Cherche dans la base de données (géocaches, logs, notes) et dans les onglets ouverts. ' +
                    'Scopes disponibles : "all" (tout), "open_tabs" (onglets ouverts seulement), ' +
                    '"database" (toute la BDD), "geocaches", "logs", "notes", "plugins", "alphabets".',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    query: { type: 'string', description: 'Terme à rechercher.', required: true },
                    scope: {
                        type: 'string',
                        description: 'Périmètre de recherche.',
                        required: false,
                        enum: ['all', 'open_tabs', 'database', 'geocaches', 'logs', 'notes', 'plugins', 'alphabets'],
                    },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const scope = args.scope || 'all';
                        const raw = await this.globalSearchService.searchDirect(args.query, scope);

                        const result = {
                            query: args.query,
                            scope,
                            totalCount: raw.totalCount,
                            openTabs: raw.widgetResults.slice(0, 10).map(r => ({
                                widgetTitle: r.widgetTitle,
                                matchCount: r.matchCount,
                                snippets: r.snippets.slice(0, 2).map(s => `${s.prefix}[${s.match}]${s.suffix}`),
                            })),
                            geocaches: raw.geocacheResults.slice(0, 10).map(r => ({
                                id: r.id,
                                gc_code: r.gc_code,
                                name: r.name,
                                zone_id: r.zone_id,
                                total_matches: r.total_matches,
                                snippets: Object.values(r.matches_in).flatMap(m => m.snippets).slice(0, 2).map(s => `${s.prefix}[${s.match}]${s.suffix}`),
                            })),
                            logs: raw.logResults.slice(0, 10).map(r => ({
                                id: r.id,
                                geocache_gc_code: r.geocache_gc_code,
                                geocache_name: r.geocache_name,
                                author: r.author,
                                log_type: r.log_type,
                                date: r.date,
                                snippets: r.snippets.slice(0, 2).map(s => `${s.prefix}[${s.match}]${s.suffix}`),
                            })),
                            notes: raw.noteResults.slice(0, 10).map(r => ({
                                id: r.id,
                                note_type: r.note_type,
                                linked_geocaches: r.linked_geocaches,
                                snippets: r.snippets.slice(0, 2).map(s => `${s.prefix}[${s.match}]${s.suffix}`),
                            })),
                            plugins: raw.pluginResults.slice(0, 5).map(r => ({
                                name: r.name,
                                total_matches: r.total_matches,
                            })),
                            alphabets: raw.alphabetResults.slice(0, 5).map(r => ({
                                id: r.id,
                                name: r.name,
                                total_matches: r.total_matches,
                            })),
                        };
                        return ok(result);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
        ];
    }
}
