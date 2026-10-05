import { injectable, inject, optional } from '@theia/core/shared/inversify';
import { CommandService, MessageService, URI } from '@theia/core';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import {
    Agent,
    AgentService,
    AISettingsService,
    LanguageModelAliasRegistry,
    LanguageModelRegistry,
    LanguageModelRequirement,
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
import { GeocacheDetailsService } from 'theia-ide-zones-ext/lib/browser/geocache-details-service';
import { GeocacheLogsFetchService } from 'theia-ide-zones-ext/lib/browser/geocache-logs-fetch-service';
import { GeocacheLogsAnalysisService } from 'theia-ide-zones-ext/lib/browser/geocache-logs-analysis-service';
import { FriendsService } from 'theia-ide-zones-ext/lib/browser/friends-service';
import { ArchiveManagerService } from 'theia-ide-zones-ext/lib/browser/archive-manager-service';
import { GpsVisitsService } from 'theia-ide-zones-ext/lib/browser/gps-visits-service';
import type { GpsUndo, GpsVisitState } from 'theia-ide-zones-ext/lib/browser/gps-visits-model';
import { TrackablesService } from 'theia-ide-zones-ext/lib/browser/trackables-service';
import type { TrackableLogSubmission } from 'theia-ide-zones-ext/lib/browser/trackables-service';
import { GeocacheLogEditorTabsManager } from 'theia-ide-zones-ext/lib/browser/geocache-log-editor-tabs-manager';
import { StorageService } from '@theia/core/lib/browser';
import { submitOneLog, uploadOneLogImage } from 'theia-ide-zones-ext/lib/browser/log-editor/log-submit-service';
import type { SubmitLogPayload } from 'theia-ide-zones-ext/lib/browser/log-editor/log-submit-service';
import { fetchGeocachesBatch, fetchUserStats } from 'theia-ide-zones-ext/lib/browser/log-editor/geocache-loader';
import { resolveAllPatterns, buildPatternsIndex } from 'theia-ide-zones-ext/lib/browser/log-editor/pattern-resolver';
import type { PatternResolutionContext } from 'theia-ide-zones-ext/lib/browser/log-editor/pattern-resolver';
import { loadCustomPatterns } from 'theia-ide-zones-ext/lib/browser/log-editor/pattern-store';
import {
    readDrafts,
    persistDraftToStorage,
    deleteDraftFromStorage,
    getDraftKey,
    loadLogHistory,
    LOG_DRAFTS_STORAGE_KEY,
} from 'theia-ide-zones-ext/lib/browser/log-editor/log-history-store';
import { submitProblemReport, PROBLEM_CATEGORIES, defaultProblemText, PROBLEM_TEXTS_PREF } from 'theia-ide-zones-ext/lib/browser/log-editor/problem-report';
import { improveLogWithAi } from 'theia-ide-zones-ext/lib/browser/log-editor/log-improver';
import { translateLogWithAi } from 'theia-ide-zones-ext/lib/browser/log-editor/log-translator';
import type { LogTranslationMode } from 'theia-ide-zones-ext/lib/browser/log-editor/log-translator';
import { GC_LOG_MAX_LENGTH, DEFAULT_TRANSLATION_NOTICE } from 'theia-ide-zones-ext/lib/browser/log-editor/constants';
import { resolveLexicon } from 'theia-ide-zones-ext/lib/browser/geocaching-lexicon';
import type { LexiconEntry } from 'theia-ide-zones-ext/lib/browser/geocaching-lexicon';
import { sanitizeLogTypeForGeocache, todayIsoDate } from 'theia-ide-zones-ext/lib/browser/log-editor/helpers';
import { LOG_DRAFT_VERSION } from 'theia-ide-zones-ext/lib/browser/log-editor/types';
import type {
    LogDraft,
    LogTypeValue,
    ProblemCategory,
    SelectedLogImage,
} from 'theia-ide-zones-ext/lib/browser/log-editor/types';
import type { TrackablePayloadEntry } from 'theia-ide-zones-ext/lib/browser/log-editor/trackables';
import { MapService, SelectedGeocache } from 'theia-ide-zones-ext/lib/browser/map/map-service';
import { OutingPlanService } from 'theia-ide-zones-ext/lib/browser/outing-plan-service';
import { ImportAroundService, ResolvedImportAroundZone } from 'theia-ide-zones-ext/lib/browser/import-around-service';
import { consumeImportStream } from 'theia-ide-zones-ext/lib/browser/import-stream';
import { BackendApiClient } from 'theia-ide-zones-ext/lib/browser/backend-api-client';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';
import {
    GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF,
    GEOAPP_CHAT_DEFAULT_PROFILE_PREF,
    GEOAPP_CHAT_PRESET_OPTIONS,
    GEOAPP_CHAT_PROMPT_PACK_PREF,
    GEOAPP_CHAT_SKILL_PACK_PREF,
} from 'theia-ide-zones-ext/lib/browser/geoapp-chat-shared';
import {
    buildGeocacheFullListingContext,
    GeocachePromptData,
} from 'theia-ide-zones-ext/lib/browser/geocache-chat-prompt-shared';
import { formatGeocacheVisionPluginModel } from 'theia-ide-zones-ext/lib/browser/geocache-details-preferences-controller';
import { GeoAppAiModelResolutionService } from 'theia-ide-zones-ext/lib/browser/geoapp-ai-model-resolution-service';
import { GeoAppAiExecutionService } from 'theia-ide-zones-ext/lib/browser/geoapp-ai-execution-service';
import {
    checkGeoAppLocalModel,
    GeoAppLocalModelPreferences,
    GEOAPP_LOCAL_MODEL_IDS_PREF,
    isGeoAppStrictLocalAgent,
} from 'theia-ide-zones-ext/lib/browser/geoapp-local-model-guard';
import { PluginsService } from '@mysterai/theia-plugins/lib/common/plugin-protocol';
import { PluginTabsManager } from '@mysterai/theia-plugins/lib/browser/plugin-tabs-manager';
import { GeoAppAiScorerModelResolver, GEOAPP_AI_SCORER_AGENT_ID } from '@mysterai/theia-plugins/lib/browser/services/ai-scorer-model-resolver';
import { AlphabetsService } from '@mysterai/theia-alphabets/lib/browser/services/alphabets-service';
import { AlphabetTabsManager } from '@mysterai/theia-alphabets/lib/browser/alphabet-tabs-manager';
import { GeoPreferenceStore } from '@mysterai/theia-preferences/lib/browser/geo-preference-store';
import { GeoPreferenceDefinition } from '@mysterai/theia-preferences/lib/browser/geo-preferences-schema';
import { GlobalSearchService } from 'theia-ide-search-ext/lib/browser/global-search-service';
import { DocSearchService, resolveDocSearchContent } from './doc-search-service';
import { DocContentService } from './doc-content-service';

export const AIDE_TOOL_PREFIX = 'aide_';

const ok = (data: unknown): string => JSON.stringify({ success: true, data });
const err = (message: string): string => JSON.stringify({ success: false, error: message });

/**
 * Les guides « par usage » des préférences vivent dans le schéma partagé
 * (`x-guides`) et sont servis via `GeoPreferenceStore.guides` : la page
 * Préférences et `@Aide` lisent la même source, qui ne peut plus dériver.
 */


function buildParams(
    props: Record<string, { type: string; description: string; required?: boolean; enum?: unknown[]; items?: unknown }>
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

/**
 * Slots OpenRouter enregistres par GeoApp (geoapp-openrouter-language-models.ts) :
 * l'id Theia est fixe, le modele OpenRouter reel vient de la preference associee.
 */
const OPENROUTER_SLOT_PREFS: Record<string, string> = {
    'openrouter/fast': 'geoApp.ai.openRouter.model.fast',
    'openrouter/strong': 'geoApp.ai.openRouter.model.strong',
    'openrouter/web': 'geoApp.ai.openRouter.model.web',
    'openrouter/vision': 'geoApp.ocr.openRouter.model',
};

/** §35 : paramètre commun aux actions destructrices — simule sans exécuter. */
const DRY_RUN_PARAM = {
    type: 'boolean',
    description: 'Simulation : retourne un aperçu de ce qui serait fait, sans rien modifier.',
    required: false,
};

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

    @inject(DocSearchService)
    protected readonly docSearchService!: DocSearchService;

    @inject(DocContentService)
    protected readonly docContentService!: DocContentService;

    @inject(GeocacheDetailsService)
    protected readonly geocacheDetailsService!: GeocacheDetailsService;

    @inject(GeocacheLogsFetchService)
    protected readonly logsFetchService!: GeocacheLogsFetchService;

    @inject(GeocacheLogsAnalysisService)
    protected readonly logsAnalysisService!: GeocacheLogsAnalysisService;

    @inject(FriendsService)
    protected readonly friendsService!: FriendsService;

    @inject(ArchiveManagerService)
    protected readonly archiveService!: ArchiveManagerService;

    @inject(GpsVisitsService)
    protected readonly gpsVisitsService!: GpsVisitsService;

    @inject(TrackablesService)
    protected readonly trackablesService!: TrackablesService;

    @inject(GeocacheLogEditorTabsManager)
    protected readonly logEditorTabsManager!: GeocacheLogEditorTabsManager;

    @inject(StorageService)
    protected readonly storageService!: StorageService;

    @inject(MapService)
    protected readonly mapService!: MapService;

    @inject(OutingPlanService)
    protected readonly outingPlanService!: OutingPlanService;

    @inject(ImportAroundService)
    protected readonly importAroundService!: ImportAroundService;

    @inject(FileService) @optional()
    protected readonly fileService: FileService | undefined;

    @inject(BackendApiClient)
    protected readonly apiClient!: BackendApiClient;

    @inject(PreferenceService)
    protected readonly preferenceService!: PreferenceService;

    @inject(MessageService)
    protected readonly messageService!: MessageService;

    @inject(AgentService)
    protected readonly agentService!: AgentService;

    @inject(AISettingsService)
    protected readonly aiSettingsService!: AISettingsService;

    @inject(LanguageModelRegistry)
    protected readonly languageModelRegistry!: LanguageModelRegistry;

    @inject(LanguageModelAliasRegistry)
    protected readonly languageModelAliasRegistry!: LanguageModelAliasRegistry;

    @inject(GeoAppAiScorerModelResolver) @optional()
    protected readonly aiScorerModelResolver: GeoAppAiScorerModelResolver | undefined;

    @inject(GeoAppAiModelResolutionService) @optional()
    protected readonly aiModelResolutionService: GeoAppAiModelResolutionService | undefined;

    @inject(GeoAppAiExecutionService) @optional()
    protected readonly aiExecutionService: GeoAppAiExecutionService | undefined;

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
            ...this.buildStatusAndBatchTools(),
            ...this.buildLogTools(),
            ...this.buildFriendTools(),
            ...this.buildArchiveTools(),
            ...this.buildMapTools(),
            ...this.buildOutingTools(),
            ...this.buildTrackableTools(),
            ...this.buildGpsVisitsTools(),
            ...this.buildLogEditorTools(),
            ...this.buildSystemAndImportTools(),
            ...this.buildImportTools(),
            ...this.buildAiModelTools(),
        ].map(tool => this.withRequiredParamsValidation(tool));
    }

    /**
     * Valide les parametres `required` du schema avant d'executer le handler :
     * un appel incomplet renvoie une erreur explicite au modele au lieu d'un
     * echec backend cryptique (zone_id undefined, note_id manquant...).
     */
    protected withRequiredParamsValidation(tool: ToolRequest): ToolRequest {
        const required = Array.isArray(tool.parameters?.required)
            ? tool.parameters.required as string[]
            : [];
        const properties = (tool.parameters?.properties ?? {}) as Record<
            string, { type?: string; enum?: unknown[] }
        >;
        const constrained = Object.entries(properties)
            .filter(([, prop]) => (prop.enum?.length ?? 0) > 0 || prop.type === 'number' || prop.type === 'array')
            .map(([key]) => key);
        if (!required.length && !constrained.length) { return tool; }
        const handler = tool.handler;
        return {
            ...tool,
            handler: async (argString: string, ctx?: unknown) => {
                let args: Record<string, unknown>;
                try {
                    args = JSON.parse(argString || '{}');
                } catch {
                    return err('Arguments JSON invalides.');
                }
                const missing = required.filter(key => args[key] === undefined || args[key] === null);
                if (missing.length) {
                    return err(`Parametre(s) manquant(s) : ${missing.join(', ')}.`);
                }
                for (const [key, prop] of Object.entries(properties)) {
                    const value = args[key];
                    if (value === undefined || value === null) { continue; }
                    if (prop.enum?.length && !prop.enum.includes(value)) {
                        return err(`Parametre "${key}" invalide : attendu parmi ${prop.enum.join(', ')}.`);
                    }
                    if (prop.type === 'number' && !Number.isFinite(Number(value))) {
                        return err(`Parametre "${key}" invalide : nombre attendu.`);
                    }
                    if (prop.type === 'array' && !Array.isArray(value)) {
                        return err(`Parametre "${key}" invalide : liste attendue.`);
                    }
                }
                return handler.call(tool, argString, ctx);
            },
        };
    }

    // ─── Preferences ──────────────────────────────────────────────────────────

    private buildPreferenceTools(): ToolRequest[] {
        return [
            {
                id: 'aide_list_preference_categories',
                name: 'aide_list_preference_categories',
                description: 'Liste les categories reelles des preferences GeoApp avec le nombre de preferences disponibles dans chaque categorie.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({}),
                handler: async () => {
                    try {
                        return ok(Array.from(this.preferenceStore.definitionsByCategory.entries())
                            .map(([category, entries]) => {
                                const sections = new Map<string, number>();
                                for (const { definition } of entries) {
                                    const def = definition as GeoPreferenceDefinition;
                                    const section = def['x-ui']?.section ?? 'Général';
                                    sections.set(section, (sections.get(section) ?? 0) + 1);
                                }
                                return {
                                    category,
                                    count: entries.length,
                                    sections: Array.from(sections.entries())
                                        .map(([section, count]) => ({ section, count }))
                                        .sort((a, b) => a.section.localeCompare(b.section)),
                                };
                            })
                            .sort((a, b) => a.category.localeCompare(b.category)));
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_list_preference_guides',
                name: 'aide_list_preference_guides',
                description: 'Liste les guides par usage de la page Preferences GeoApp avec categories et recherches suggerees.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({}),
                handler: async () => {
                    try {
                        return ok(this.preferenceStore.guides);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_search_preferences',
                name: 'aide_search_preferences',
                description: 'Recherche une preference GeoApp par mots-cles, titre, description, tag, categorie, valeur possible ou cle technique.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    query: { type: 'string', description: 'Texte a rechercher (ex: "checker fenetre", "profil chat", "colonnes tableau").', required: true },
                    category: { type: 'string', description: 'Categorie optionnelle pour limiter la recherche.', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const query = String(args.query || '').trim();
                        if (!query) { return err('Le champ query est requis.'); }
                        const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
                        const normalizedQuery = normalize(query);
                        const entries = args.category
                            ? [...(this.preferenceStore.definitionsByCategory.get(args.category) ?? [])]
                            : this.preferenceStore.definitions;
                        const snapshot = this.preferenceStore.getSnapshot();
                        const matches = entries.filter(({ key, definition }) => {
                            const def = definition as GeoPreferenceDefinition;
                            const haystack = [
                                key,
                                def.title,
                                def.description,
                                def['x-category'],
                                def['x-ui']?.label,
                                def['x-ui']?.section,
                                def['x-ui']?.shortDescription,
                                ...(def['x-tags'] ?? []),
                                ...(def['x-ui']?.keywords ?? []),
                                ...(def.enum ?? []).map(String),
                                ...(def.items?.enum ?? []).map(String),
                            ].filter(Boolean).join(' ');
                            return normalize(haystack).includes(normalizedQuery);
                        }).slice(0, 25);
                        return ok(matches.map(({ key, definition }) => {
                            const def = definition as GeoPreferenceDefinition;
                            return {
                                key,
                                title: def.title,
                                category: def['x-category'],
                                targets: def['x-targets'] ?? ['frontend'],
                                tags: def['x-tags'] ?? [],
                                ui: def['x-ui'] ?? undefined,
                                type: def.type,
                                description: def.description,
                                default: def.default,
                                enum: def.enum,
                                itemEnum: def.items?.enum,
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
                id: 'aide_reset_preference',
                name: 'aide_reset_preference',
                description: 'Reinitialise une preference GeoApp a sa valeur par defaut declaree dans le schema.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    key: { type: 'string', description: 'Cle de la preference a reinitialiser.', required: true },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const def = this.preferenceStore.schema.properties?.[args.key] as GeoPreferenceDefinition | undefined;
                        if (!def) { return err(`Preference inconnue : "${args.key}".`); }
                        if (def['x-sensitive']) { return err(`Cette preference est sensible et ne peut pas etre modifiee par @Aide.`); }
                        if (!('default' in def)) { return err(`La preference "${args.key}" n'a pas de valeur par defaut connue.`); }
                        await this.preferenceStore.reset(args.key);
                        return ok(`Preference "${args.key}" reinitialisee : ${JSON.stringify(def.default)}.`);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_list_preferences',
                name: 'aide_list_preferences',
                description: 'Liste les préférences GeoApp avec leur valeur courante (format compact par défaut : key, titre, valeur, type). ' +
                    'Passer verbose=true pour la description complète, les valeurs possibles et les bornes. ' +
                    'Utilise aide_list_preference_categories pour obtenir la liste exacte des catégories. ' +
                    'Les valeurs sensibles (clés API) sont masquées.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    category: { type: 'string', description: 'Filtrer par catégorie (ex: "ai", "map", "ui"). Laisser vide pour tout retourner.', required: false },
                    verbose: { type: 'string', description: 'Passer "true" pour inclure description, enum, bornes et métadonnées complètes.', required: false },
                    limit: { type: 'number', description: 'Nombre maximum de préférences retournées (défaut 50, max 500).', required: false },
                    offset: { type: 'number', description: 'Index de départ dans la liste (défaut 0).', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const entries = args.category
                            ? [...(this.preferenceStore.definitionsByCategory.get(args.category) ?? [])]
                            : this.preferenceStore.definitions;
                        const snapshot = this.preferenceStore.getSnapshot();
                        const verbose = args.verbose === true || args.verbose === 'true';
                        const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 500);
                        const offset = Math.max(Number(args.offset) || 0, 0);
                        const preferences = entries.slice(offset, offset + limit).map(({ key, definition }) => {
                            const def = definition as GeoPreferenceDefinition;
                            if (!verbose) {
                                return {
                                    key,
                                    title: def.title,
                                    category: def['x-category'],
                                    type: def.type,
                                    value: def['x-sensitive'] ? '***' : snapshot[key],
                                };
                            }
                            return {
                                key,
                                title: def.title,
                                category: def['x-category'],
                                targets: def['x-targets'] ?? ['frontend'],
                                tags: def['x-tags'] ?? [],
                                ui: def['x-ui'] ?? undefined,
                                type: def.type,
                                description: def.description,
                                default: def.default,
                                enum: def.enum,
                                itemEnum: def.items?.enum,
                                minimum: def.minimum,
                                maximum: def.maximum,
                                value: def['x-sensitive'] ? '***' : snapshot[key],
                                sensitive: def['x-sensitive'] ?? false,
                            };
                        });
                        return ok({ total: entries.length, offset, limit, preferences });
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
                            itemEnum: def.items?.enum,
                            minimum: def.minimum,
                            maximum: def.maximum,
                            category: def['x-category'],
                            targets: def['x-targets'] ?? ['frontend'],
                            tags: def['x-tags'] ?? [],
                            ui: def['x-ui'] ?? undefined,
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
                        } else if (def.type === 'object' || def.type === 'array') {
                            if (typeof args.value === 'string') {
                                try {
                                    coerced = JSON.parse(args.value);
                                } catch {
                                    return err(`Valeur invalide pour "${args.key}" : JSON attendu.`);
                                }
                            }
                            if (def.type === 'object' && (!coerced || typeof coerced !== 'object' || Array.isArray(coerced))) {
                                return err(`Valeur invalide pour "${args.key}" : objet JSON attendu.`);
                            }
                            if (def.type === 'array' && !Array.isArray(coerced)) {
                                return err(`Valeur invalide pour "${args.key}" : tableau JSON attendu.`);
                            }
                        }
                        if (def.enum && !(def.enum as unknown[]).includes(coerced)) {
                            return err(`Valeur invalide pour "${args.key}". Valeurs acceptées : ${(def.enum as unknown[]).join(', ')}`);
                        }
                        const itemEnum = def.items?.enum;
                        if (def.type === 'array' && Array.isArray(coerced) && itemEnum) {
                            const invalid = coerced.find(item => !(itemEnum as unknown[]).includes(item));
                            if (invalid !== undefined) {
                                return err(`Valeur invalide pour "${args.key}" : entree non autorisee ${JSON.stringify(invalid)}.`);
                            }
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
                    key: { type: 'string', description: 'Cle optionnelle de preference a afficher directement.', required: false },
                    query: { type: 'string', description: 'Recherche optionnelle a pre-remplir dans le panneau.', required: false },
                    category: { type: 'string', description: 'Catégorie optionnelle à afficher directement (ex: "earthcoach", "chat", "ai", "map").', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        await this.commandService.executeCommand('geo-preferences:open', { category: args.category, key: args.key, query: args.query });
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
                    geocache_id: { type: 'number', description: 'ID de la géocache à ouvrir (ou utiliser gc_code).', required: false },
                    gc_code: { type: 'string', description: 'Code GC (ex: "GC8ABCD"), alternatif à geocache_id.', required: false },
                    name: { type: 'string', description: 'Nom optionnel de la géocache (pour l\'onglet).', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const geocacheId = await this.resolveGeocacheId(args);
                        await this.geocacheTabsManager.openGeocacheDetails({ geocacheId, name: args.name });
                        return ok(`Géocache ${geocacheId} ouverte.`);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_open_formula_solver',
                name: 'aide_open_formula_solver',
                description: 'Ouvre le panneau Formula Solver (résolution de formules de coordonnées).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({}),
                handler: async () => {
                    try {
                        await this.commandService.executeCommand('formula-solver:open');
                        return ok('Formula Solver ouvert.');
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_solve_formula_for_geocache',
                name: 'aide_solve_formula_for_geocache',
                description: 'Charge une géocache dans le Formula Solver et lance son workflow de résolution ' +
                    '(le panneau s\'ouvre ; l\'utilisateur valide ensuite les étapes dans le widget).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    geocache_id: { type: 'number', description: 'ID de la géocache (ou utiliser gc_code).', required: false },
                    gc_code: { type: 'string', description: 'Code GC (ex: "GC8ABCD"), alternatif à geocache_id.', required: false },
                }),
                confirmAlwaysAllow: 'Charger cette géocache dans le Formula Solver et lancer le workflow ?',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const geocacheId = await this.resolveGeocacheId(args);
                        await this.commandService.executeCommand('formula-solver:solve-from-geocache', geocacheId);
                        return ok(`Géocache ${geocacheId} chargée dans le Formula Solver.`);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_set_table_filter',
                name: 'aide_set_table_filter',
                description: 'Applique un filtre de recherche et/ou un tri à la table des géocaches d\'une zone ouverte. ' +
                    'La requête accepte les tokens @champ:valeur (ex: "@type:mystery @solved:not_solved", "@found:true", "@diff:>=3", "@notes:oui") ' +
                    'et du texte libre ; une chaîne vide efface le filtre. Sans zone_id, la requête vise la table visible.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    search_query: { type: 'string', description: 'Requête de recherche complète (tokens @champ:valeur et/ou texte libre). "" efface le filtre.', required: false },
                    zone_id: { type: 'number', description: 'ID de la zone dont la table doit être filtrée. Omettre = table visible.', required: false },
                    sort_by: { type: 'string', description: 'Colonne de tri (id, ex: "name", "difficulty", "terrain", "favorites_count", "placed_at").', required: false },
                    sort_dir: { type: 'string', description: 'Direction du tri.', required: false, enum: ['asc', 'desc'] },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        if (args.search_query === undefined && !args.sort_by) {
                            return err('Rien à appliquer : fournir search_query et/ou sort_by.');
                        }
                        this.widgetEventsService.requestTableFilter({
                            zoneId: args.zone_id !== undefined ? Number(args.zone_id) : undefined,
                            searchQuery: args.search_query !== undefined ? String(args.search_query) : undefined,
                            sortBy: args.sort_by ? String(args.sort_by) : undefined,
                            sortDesc: args.sort_dir === 'desc',
                        });
                        return ok({
                            applied: {
                                search_query: args.search_query,
                                sort_by: args.sort_by,
                                sort_dir: args.sort_dir,
                                zone_id: args.zone_id ?? 'visible',
                            },
                        });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
        ];
    }

    // ─── Plugins ──────────────────────────────────────────────────────────────

    /** Tags MetaSolver mis en cache (60 s) : évite un appel /eligible à chaque liste. */
    private pluginTagsCache?: { at: number; map: Map<string, string[]> };

    protected async getPluginTagsMap(): Promise<Map<string, string[]>> {
        if (this.pluginTagsCache && Date.now() - this.pluginTagsCache.at < 60_000) {
            return this.pluginTagsCache.map;
        }
        const map = new Map<string, string[]>();
        try {
            const eligible = await this.pluginsService.getMetasolverEligiblePlugins('all');
            for (const ep of eligible.plugins) {
                map.set(ep.name, ep.tags);
            }
        } catch { /* tags optionnels */ }
        this.pluginTagsCache = { at: Date.now(), map };
        return map;
    }

    private buildPluginTools(): ToolRequest[] {
        return [
            {
                id: 'aide_list_plugins',
                name: 'aide_list_plugins',
                description: 'Retourne les plugins disponibles avec leurs catégories et tags (paginé : limit/offset, voir total). ' +
                    'Ne filtre PAS par texte : pour trouver un plugin à partir d\'un concept sémantique ' +
                    '(ex: "magie", "téléphone", "morse"), parcourez la liste puis identifiez ' +
                    'le plugin par vos propres connaissances. Filtre optionnel par catégorie API uniquement.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    category: { type: 'string', description: 'Filtrer par catégorie API (ex: "cipher", "encoding", "morse"). Laisser vide pour tout retourner.', required: false },
                    limit: { type: 'number', description: 'Nombre maximum de plugins retournés (défaut 100, max 500).', required: false },
                    offset: { type: 'number', description: 'Index de départ dans la liste (défaut 0).', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const filters: any = {};
                        if (args.category) { filters.category = args.category; }
                        const plugins = await this.pluginsService.listPlugins(filters);
                        const all = Array.isArray(plugins) ? plugins : [];
                        const tagsMap = await this.getPluginTagsMap();
                        const limit = Math.min(Math.max(Number(args.limit) || 100, 1), 500);
                        const offset = Math.max(Number(args.offset) || 0, 0);
                        const page = all.slice(offset, offset + limit).map(p => ({
                            name: p.name,
                            description: p.description,
                            categories: p.categories,
                            tags: tagsMap.get(p.name) ?? [],
                            source: p.source,
                            enabled: p.enabled,
                        }));
                        return ok({ total: all.length, offset, limit, plugins: page });
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
            {
                id: 'aide_run_plugin',
                name: 'aide_run_plugin',
                description: 'Exécute un plugin de déchiffrement sur un texte et retourne le résultat (texte décodé et/ou coordonnées) directement, sans ouvrir d\'onglet. ' +
                    'À utiliser pour décoder/résoudre en place (ex: « décode ce Morse », « applique César +3 »). ' +
                    'Identifie d\'abord le plugin via aide_list_plugins, puis passe son nom exact. ' +
                    'Le texte à traiter va dans "text" ; les paramètres spécifiques au plugin (ex: décalage, clé, alphabet) vont dans "params".',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    plugin_name: { type: 'string', description: 'Nom exact du plugin (tel que retourné par aide_list_plugins).', required: true },
                    text: { type: 'string', description: 'Texte d\'entrée à traiter par le plugin.', required: true },
                    params: { type: 'object', description: 'Paramètres additionnels spécifiques au plugin (ex: { "shift": 3 }, { "key": "SECRET" }). Optionnel.', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const pluginName = String(args.plugin_name || '').trim();
                        if (!pluginName) { return err('Le champ plugin_name est requis.'); }
                        const text = typeof args.text === 'string' ? args.text : '';
                        if (!text.trim()) { return err('Le champ text est requis.'); }
                        const extra = (args.params && typeof args.params === 'object') ? args.params : {};
                        const inputs = { text, ...extra };
                        const result = await this.pluginsService.executePlugin(pluginName, inputs);
                        const items = (Array.isArray(result.results) ? result.results : [])
                            .slice(0, 10)
                            .map((item: any) => {
                                const coords = item?.coordinates;
                                return {
                                    text_output: typeof item?.text_output === 'string'
                                        ? item.text_output.slice(0, 2000)
                                        : undefined,
                                    coordinates: coords
                                        ? (coords.formatted ?? coords.ddm ??
                                           (coords.ddm_lat && coords.ddm_lon ? `${coords.ddm_lat} ${coords.ddm_lon}` : undefined) ??
                                           (coords.latitude != null && coords.longitude != null ? `${coords.latitude}, ${coords.longitude}` : undefined))
                                        : undefined,
                                    confidence: item?.confidence,
                                    method: item?.method,
                                };
                            });
                        return ok({
                            plugin: pluginName,
                            status: result.status,
                            summary: result.summary ?? result.error,
                            text_output: typeof result.text_output === 'string' ? result.text_output.slice(0, 2000) : undefined,
                            results: items,
                        });
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
                        this.messageService.info(`Zone « ${zone.name} » créée.`);
                        return ok(zone);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_rename_zone',
                name: 'aide_rename_zone',
                description: 'Renomme une zone de résolution existante.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    zone_id: { type: 'number', description: 'ID de la zone à renommer.', required: true },
                    new_name: { type: 'string', description: 'Nouveau nom de la zone.', required: true },
                    description: { type: 'string', description: 'Description optionnelle à conserver ou modifier.', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const zone = await this.zonesService.update<{ id: number; name: string; description?: string }>(args.zone_id, {
                            name: args.new_name,
                            description: args.description,
                        });
                        const activeZone = await this.zonesService.getActiveZone<{ id?: number | null }>();
                        if (activeZone?.id === zone.id) {
                            await this.zoneTabsManager.openZone({ zoneId: zone.id, zoneName: zone.name });
                        }
                        this.widgetEventsService.requestZonesRefresh();
                        return ok(zone);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_duplicate_zone',
                name: 'aide_duplicate_zone',
                description: 'Duplique une zone de résolution avec ses géocaches, waypoints et checkers.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    zone_id: { type: 'number', description: 'ID de la zone source à dupliquer.', required: true },
                    name: { type: 'string', description: 'Nom de la nouvelle zone dupliquée.', required: true },
                    description: { type: 'string', description: 'Description optionnelle de la nouvelle zone.', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const zone = await this.zonesService.duplicate<{ id: number; name: string; description?: string; geocaches_count?: number }>(args.zone_id, {
                            name: args.name,
                            description: args.description,
                        });
                        this.widgetEventsService.requestZonesRefresh();
                        return ok(zone);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_merge_zone',
                name: 'aide_merge_zone',
                description: 'Fusionne une zone source dans une zone cible. Les géocaches uniques sont déplacées, les doublons restent dans la cible, puis la zone source est supprimée.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    source_zone_id: { type: 'number', description: 'ID de la zone source à fusionner puis supprimer.', required: true },
                    target_zone_id: { type: 'number', description: 'ID de la zone cible qui recevra les géocaches.', required: true },
                    dry_run: DRY_RUN_PARAM,
                }),
                confirmAlwaysAllow: 'Fusionner ces zones ? Les géocaches uniques seront déplacées vers la cible, puis la zone source sera supprimée.',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        if (args.dry_run) {
                            const zones = await this.zonesService.list<{ id: number; name: string; geocaches_count?: number }>();
                            const source = zones.find(z => z.id === args.source_zone_id);
                            const target = zones.find(z => z.id === args.target_zone_id);
                            return this.dryRunOk('merge_zone', {
                                source: source ?? { id: args.source_zone_id },
                                target: target ?? { id: args.target_zone_id },
                                consequence: 'Les géocaches uniques seraient déplacées vers la cible, puis la zone source supprimée.',
                            });
                        }
                        const result = await this.zonesService.merge(args.source_zone_id, {
                            target_zone_id: args.target_zone_id,
                        });
                        this.widgetEventsService.requestZonesRefresh();
                        this.messageService.info('Zones fusionnées.');
                        return ok(result);
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
                    dry_run: DRY_RUN_PARAM,
                }),
                confirmAlwaysAllow: 'Supprimer la zone et toutes ses géocaches ? Cette action est irréversible.',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        if (args.dry_run) {
                            let geocacheCount: number | undefined;
                            try {
                                const geocaches = await this.zonesService.listGeocaches<unknown[]>(args.zone_id);
                                geocacheCount = geocaches.length;
                            } catch { /* comptage best-effort */ }
                            return this.dryRunOk('delete_zone', {
                                zone_id: args.zone_id,
                                zone_name: args.zone_name,
                                geocaches_count: geocacheCount,
                                consequence: 'La zone et toutes ses géocaches seraient définitivement supprimées.',
                            });
                        }
                        await this.zonesService.delete(args.zone_id);
                        this.widgetEventsService.requestZonesRefresh();
                        this.messageService.info(`Zone « ${args.zone_name} » supprimée.`);
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
                    zone_id: { type: 'number', description: 'ID de la zone à activer. Omettre ou passer null pour désactiver la zone active.', required: false },
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

    /**
     * Résout l'id d'une géocache : `geocache_id` direct, ou `gc_code` (ex: "GC8ABCD")
     * via GET /api/geocaches/by-code. Lève une erreur si aucun n'est exploitable.
     */
    protected async resolveGeocacheId(args: Record<string, any>): Promise<number> {
        const direct = Number(args.geocache_id);
        if (Number.isFinite(direct) && direct > 0) {
            return direct;
        }
        const gcCode = typeof args.gc_code === 'string' ? args.gc_code.trim() : '';
        if (!gcCode) {
            throw new Error('Fournissez geocache_id ou gc_code.');
        }
        const found = await this.geocachesService.getByCode<Record<string, unknown>>(gcCode);
        const id = Number(found?.['id']);
        if (!Number.isFinite(id) || id <= 0) {
            throw new Error(`Aucune géocache trouvée pour le code "${gcCode}".`);
        }
        return id;
    }

    /** Mappe la reponse GET /api/geocaches/<id> (to_dict complet) vers GeocachePromptData. */
    protected toPromptData(raw: Record<string, unknown>): GeocachePromptData {
        const waypoints = (Array.isArray(raw['waypoints']) ? raw['waypoints'] : []) as Array<Record<string, unknown>>;
        const checkers = (Array.isArray(raw['checkers']) ? raw['checkers'] : []) as Array<Record<string, unknown>>;
        return {
            id: Number(raw['id']) || 0,
            gc_code: raw['gc_code'] as string | undefined,
            name: String(raw['name'] ?? ''),
            type: (raw['cache_type'] ?? raw['type']) as string | undefined,
            size: raw['size'] as string | undefined,
            owner: raw['owner'] as string | undefined,
            difficulty: raw['difficulty'] as number | undefined,
            terrain: raw['terrain'] as number | undefined,
            coordinates_raw: raw['coordinates_raw'] as string | undefined,
            original_coordinates_raw: raw['original_coordinates_raw'] as string | undefined,
            placed_at: raw['placed_at'] as string | undefined,
            status: raw['status'] as string | undefined,
            description_html: (raw['description_html'] ?? raw['description_raw'] ?? raw['description']) as string | undefined,
            hints: raw['hints'] as string | undefined,
            hints_decoded: raw['hints_decoded'] as string | undefined,
            hints_decoded_override: raw['hints_decoded_override'] as string | undefined,
            favorites_count: raw['favorites_count'] as number | undefined,
            logs_count: raw['logs_count'] as number | undefined,
            waypoints: waypoints.map(w => ({
                prefix: w['prefix'] as string | undefined,
                lookup: w['lookup'] as string | undefined,
                name: w['name'] as string | undefined,
                type: w['type'] as string | undefined,
                gc_coords: w['gc_coords'] as string | undefined,
                latitude: typeof w['latitude'] === 'number' ? w['latitude'] : undefined,
                longitude: typeof w['longitude'] === 'number' ? w['longitude'] : undefined,
                note: w['note'] as string | undefined,
            })),
            checkers: checkers.map(c => ({
                name: c['name'] as string | undefined,
                url: c['url'] as string | undefined,
            })),
        };
    }

    private buildGeocacheTools(): ToolRequest[] {
        return [
            {
                id: 'aide_find_geocache',
                name: 'aide_find_geocache',
                description: 'Localise une géocache par code GC (ex: "GC8ABCD") ou par nom (recherche plein texte dans la base). ' +
                    'Retourne son geocache_id et sa zone pour enchaîner avec les autres tools. ' +
                    'À appeler avant toute action quand l\'utilisateur cite un code GC ou un nom de cache.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    gc_code: { type: 'string', description: 'Code GC exact (ex: "GC8ABCD"). Prioritaire si fourni.', required: false },
                    name: { type: 'string', description: 'Nom (ou partie du nom) de la géocache, utilisé si gc_code absent ou introuvable.', required: false },
                    zone_id: { type: 'number', description: 'Restreindre à une zone (optionnel).', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    const gcCode = typeof args.gc_code === 'string' ? args.gc_code.trim().toUpperCase() : '';
                    const name = typeof args.name === 'string' ? args.name.trim() : '';
                    try {
                        if (gcCode) {
                            try {
                                const found = await this.geocachesService.getByCode<Record<string, unknown>>(gcCode, args.zone_id);
                                return ok({
                                    match: 'gc_code',
                                    geocaches: [{
                                        id: found['id'],
                                        gc_code: found['gc_code'],
                                        name: found['name'],
                                        zone_id: found['zone_id'],
                                    }],
                                });
                            } catch {
                                if (!name) { return err(`Aucune géocache trouvée pour le code "${gcCode}".`); }
                            }
                        }
                        if (!name) { return err('Fournissez gc_code ou name.'); }
                        const results = await this.globalSearchService.searchDirect(name, 'geocaches');
                        const geocaches = (results.geocacheResults || [])
                            .filter(g => args.zone_id == null || g.zone_id === args.zone_id)
                            .slice(0, 10)
                            .map(g => ({ id: g.id, gc_code: g.gc_code, name: g.name, zone_id: g.zone_id }));
                        return ok({ match: 'name', total: results.counts?.geocaches ?? geocaches.length, geocaches });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_get_geocache_details',
                name: 'aide_get_geocache_details',
                description: 'Retourne le contenu complet d\'une géocache : métadonnées (nom, code GC, D/T, statut), ' +
                    'description intégrale en texte, indices décodés, waypoints détaillés et checkers. ' +
                    'À appeler quand l\'utilisateur demande le contenu de "cette cache" ou "la cache à l\'écran".',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    geocache_id: { type: 'number', description: 'ID de la géocache (ou utiliser gc_code).', required: false },
                    gc_code: { type: 'string', description: 'Code GC (ex: "GC8ABCD"), alternatif à geocache_id.', required: false },
                    max_chars: { type: 'number', description: 'Taille max de la description retournée (défaut 12000).', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const geocacheId = await this.resolveGeocacheId(args);
                        const raw = await this.geocachesService.get<Record<string, unknown>>(geocacheId);
                        const maxChars = Math.min(Math.max(Number(args.max_chars) || 12000, 500), 60000);
                        // Meme rendu que le tool de resolution get_geocache_listing : description
                        // integrale, indices decodes (ROT13), waypoints et checkers formattes.
                        const listing = buildGeocacheFullListingContext(this.toPromptData(raw), {
                            maxDescriptionChars: maxChars,
                        });
                        return ok({
                            id: raw['id'],
                            gc_code: raw['gc_code'],
                            name: raw['name'],
                            zone_id: raw['zone_id'],
                            solved: raw['solved'],
                            found: raw['found'],
                            is_corrected: raw['is_corrected'],
                            description_truncated: listing.descriptionTruncated,
                            listing: listing.text,
                        });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_list_geocaches_in_zone',
                name: 'aide_list_geocaches_in_zone',
                description: 'Liste les géocaches d\'une zone avec leurs id, code GC et noms. ' +
                    'La réponse est paginée : utilisez limit/offset et lisez total pour savoir s\'il reste des résultats.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    zone_id: { type: 'number', description: 'ID de la zone.', required: true },
                    limit: { type: 'number', description: 'Nombre maximum de géocaches retournées (défaut 50, max 500).', required: false },
                    offset: { type: 'number', description: 'Index de départ dans la liste (défaut 0).', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const geocaches = await this.zonesService.listGeocachesTree<{ id: number; gc_code: string; name: string }>(args.zone_id);
                        const all = Array.isArray(geocaches) ? geocaches : [];
                        const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 500);
                        const offset = Math.max(Number(args.offset) || 0, 0);
                        return ok({ total: all.length, offset, limit, geocaches: all.slice(offset, offset + limit) });
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
                    dry_run: DRY_RUN_PARAM,
                }),
                confirmAlwaysAllow: 'Supprimer cette géocache et toutes ses données (waypoints, notes) ? Action irréversible.',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        if (args.dry_run) {
                            let geocache: { name?: string; code?: string } | undefined;
                            try { geocache = await this.geocachesService.get(args.geocache_id); } catch { /* best-effort */ }
                            return this.dryRunOk('delete_geocache', {
                                geocache_id: args.geocache_id,
                                geocache,
                                consequence: 'La géocache et toutes ses données (waypoints, notes) seraient définitivement supprimées.',
                            });
                        }
                        await this.geocachesService.delete(args.geocache_id);
                        this.widgetEventsService.requestZonesRefresh();
                        this.widgetEventsService.notifyGeocacheChanged({
                            geocacheId: args.geocache_id,
                            reason: 'deleted',
                            source: 'chat',
                        });
                        return ok(`Géocache ${args.geocache_id} supprimée.`);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_update_coordinates',
                name: 'aide_update_coordinates',
                description: 'Définit les coordonnées corrigées (solution) d\'une géocache. Écrase les coordonnées corrigées existantes. ' +
                    'Coordonnées au format DDM (ex: "N 48° 51.500 E 002° 17.600").',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    geocache_id: { type: 'number', description: 'ID de la géocache.', required: true },
                    coordinates_raw: { type: 'string', description: 'Coordonnées corrigées au format DDM (ex: "N 48° 51.500 E 002° 17.600").', required: true },
                }),
                confirmAlwaysAllow: 'Enregistrer ces coordonnées comme solution de la géocache ? Les coordonnées corrigées actuelles seront écrasées.',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const coords = String(args.coordinates_raw || '').trim();
                        if (!coords) { return err('Le champ coordinates_raw est requis.'); }
                        const result = await this.geocachesService.updateCoordinates(args.geocache_id, coords);
                        this.widgetEventsService.notifyGeocacheChanged({
                            geocacheId: args.geocache_id,
                            reason: 'corrected-coordinates-updated',
                            source: 'chat',
                        });
                        return ok(result ?? { updated: true, coordinates_raw: coords });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_move_geocache',
                name: 'aide_move_geocache',
                description: 'Déplace une géocache vers une autre zone (la retire de la zone source). Différent de la copie.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    geocache_id: { type: 'number', description: 'ID de la géocache à déplacer.', required: true },
                    target_zone_id: { type: 'number', description: 'ID de la zone cible.', required: true },
                }),
                confirmAlwaysAllow: 'Déplacer cette géocache vers la zone cible ? Elle sera retirée de sa zone actuelle.',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const result = await this.geocachesService.move(args.geocache_id, args.target_zone_id);
                        this.widgetEventsService.requestZonesRefresh();
                        if (result?.already_exists) {
                            return ok({ moved: false, already_exists: true, message: 'La géocache existe déjà dans la zone cible.' });
                        }
                        return ok(result ?? { moved: true });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_get_nearby_geocaches',
                name: 'aide_get_nearby_geocaches',
                description: 'Retourne les géocaches proches d\'une géocache donnée, dans un rayon (km).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    geocache_id: { type: 'number', description: 'ID de la géocache de référence.', required: true },
                    radius_km: { type: 'number', description: 'Rayon de recherche en kilomètres (optionnel).', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const radius = typeof args.radius_km === 'number' ? args.radius_km : undefined;
                        const result = await this.geocachesService.getNearby<Record<string, unknown>>(args.geocache_id, radius);
                        const nearby = (Array.isArray(result.nearby_geocaches) ? result.nearby_geocaches : [])
                            .slice(0, 25)
                            .map(g => ({
                                id: g['id'],
                                gc_code: g['gc_code'],
                                name: g['name'],
                                distance_km: g['distance_km'] ?? g['distance'],
                                latitude: g['latitude'],
                                longitude: g['longitude'],
                            }));
                        return ok({
                            center_geocache: result.center_geocache,
                            radius_km: result.radius_km,
                            count: nearby.length,
                            nearby_geocaches: nearby,
                        });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_refresh_geocache',
                name: 'aide_refresh_geocache',
                description: 'Recharge les données d\'une géocache depuis Geocaching.com (description, waypoints, statut). Nécessite une connexion Geocaching.com.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    geocache_id: { type: 'number', description: 'ID de la géocache à rafraîchir.', required: true },
                }),
                confirmAlwaysAllow: 'Recharger cette géocache depuis Geocaching.com ? Une requête réseau sera effectuée.',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        await this.geocachesService.refresh(args.geocache_id);
                        this.widgetEventsService.requestZonesRefresh();
                        this.widgetEventsService.notifyGeocacheChanged({
                            geocacheId: args.geocache_id,
                            reason: 'refreshed',
                            source: 'chat',
                        });
                        return ok(`Géocache ${args.geocache_id} rechargée depuis Geocaching.com.`);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_export_gpx',
                name: 'aide_export_gpx',
                description: 'Exporte une ou plusieurs géocaches au format GPX et déclenche le téléchargement du fichier.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    geocache_ids: { type: 'array', description: 'Liste des IDs de géocaches à exporter.', required: true, items: { type: 'number' } },
                    filename: { type: 'string', description: 'Nom de fichier souhaité (ex: "export.gpx"). Optionnel.', required: false },
                }),
                confirmAlwaysAllow: 'Exporter ces géocaches au format GPX et télécharger le fichier ?',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const ids = Array.isArray(args.geocache_ids)
                            ? args.geocache_ids.map((v: unknown) => Number(v)).filter((n: number) => !Number.isNaN(n))
                            : [];
                        if (ids.length === 0) { return err('Fournissez au moins un id dans geocache_ids.'); }
                        const filename = String(args.filename || 'export.gpx').trim() || 'export.gpx';
                        const res = await this.geocachesService.exportGpx(ids, filename);
                        const contentDisposition = res.headers.get('Content-Disposition') || '';
                        const filenameMatch = /filename\s*=\s*"?([^";]+)"?/i.exec(contentDisposition);
                        const downloadName = (filenameMatch?.[1] || '').trim() || filename;
                        const blob = await res.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = downloadName;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        window.URL.revokeObjectURL(url);
                        return ok({ exported: true, count: ids.length, filename: downloadName });
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
                        this.widgetEventsService.notifyGeocacheChanged({
                            geocacheId: args.geocache_id,
                            reason: 'waypoint-created',
                            source: 'chat',
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
                    dry_run: DRY_RUN_PARAM,
                }),
                confirmAlwaysAllow: 'Supprimer ce waypoint ? Action irréversible.',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        if (args.dry_run) {
                            return this.dryRunOk('delete_waypoint', {
                                geocache_id: args.geocache_id,
                                waypoint_id: args.waypoint_id,
                                consequence: 'Le waypoint serait définitivement supprimé.',
                            });
                        }
                        await this.geocachesService.deleteWaypoint(args.geocache_id, args.waypoint_id);
                        this.widgetEventsService.notifyGeocacheChanged({
                            geocacheId: args.geocache_id,
                            reason: 'waypoint-deleted',
                            source: 'chat',
                        });
                        return ok(`Waypoint ${args.waypoint_id} supprimé.`);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_set_waypoint_as_corrected',
                name: 'aide_set_waypoint_as_corrected',
                description: 'Définit les coordonnées d\'un waypoint existant comme coordonnées corrigées (solution) de la géocache. ' +
                    'Utile après avoir créé un waypoint « Final » : promouvoir ce waypoint en solution de la cache.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    geocache_id: { type: 'number', description: 'ID de la géocache.', required: true },
                    waypoint_id: { type: 'number', description: 'ID du waypoint à promouvoir en coordonnées corrigées.', required: true },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        await this.geocachesService.setWaypointAsCorrectedCoords(args.geocache_id, args.waypoint_id);
                        this.widgetEventsService.notifyGeocacheChanged({
                            geocacheId: args.geocache_id,
                            reason: 'corrected-coordinates-updated',
                            source: 'chat',
                        });
                        return ok(`Waypoint ${args.waypoint_id} défini comme coordonnées corrigées de la géocache ${args.geocache_id}.`);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
        ];
    }

    // ─── Notes ───────────────────────────────────────────────────────────────

    private buildNoteTools(): ToolRequest[] {
        return [
            {
                id: 'aide_list_notes',
                name: 'aide_list_notes',
                description: 'Retourne les notes d\'une géocache : la note personnelle Geocaching.com et les notes GeoApp (utilisateur et système), avec leur id, contenu, type et source.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    geocache_id: { type: 'number', description: 'ID de la géocache.', required: true },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const response = await this.notesService.getNotes(args.geocache_id);
                        const notes = (Array.isArray(response.notes) ? response.notes : []).map(n => ({
                            id: n.id,
                            note_type: n.note_type,
                            source: n.source,
                            source_plugin: n.source_plugin ?? undefined,
                            content: typeof n.content === 'string' ? n.content.slice(0, 2000) : n.content,
                            created_at: n.created_at,
                            updated_at: n.updated_at,
                        }));
                        return ok({
                            geocache_id: response.geocache_id,
                            gc_code: response.gc_code,
                            name: response.name,
                            gc_personal_note: response.gc_personal_note,
                            gc_personal_note_synced_at: response.gc_personal_note_synced_at,
                            notes,
                        });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
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
                        this.widgetEventsService.notifyGeocacheChanged({
                            geocacheId: args.geocache_id,
                            reason: 'note-created',
                            source: 'chat',
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
                    geocache_id: { type: 'number', description: 'ID de la géocache concernée (recommandé : permet de rafraîchir sa fiche).', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    const noteType = args.note_type === 'system' ? 'system' : 'user';
                    try {
                        await this.notesService.updateNote(args.note_id, {
                            content: args.content,
                            note_type: noteType,
                        }, Number(args.geocache_id) || undefined);
                        const geocacheId = Number(args.geocache_id);
                        if (Number.isFinite(geocacheId) && geocacheId > 0) {
                            this.widgetEventsService.notifyGeocacheChanged({
                                geocacheId,
                                reason: 'note-updated',
                                source: 'chat',
                            });
                        }
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
                    geocache_id: { type: 'number', description: 'ID de la géocache concernée (recommandé : permet de rafraîchir sa fiche).', required: false },
                    dry_run: DRY_RUN_PARAM,
                }),
                confirmAlwaysAllow: 'Supprimer cette note ? Action irréversible.',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        if (args.dry_run) {
                            return this.dryRunOk('delete_note', {
                                note_id: args.note_id,
                                geocache_id: args.geocache_id,
                                consequence: 'La note serait définitivement supprimée.',
                            });
                        }
                        await this.notesService.deleteNote(args.note_id, Number(args.geocache_id) || undefined);
                        const geocacheId = Number(args.geocache_id);
                        if (Number.isFinite(geocacheId) && geocacheId > 0) {
                            this.widgetEventsService.notifyGeocacheChanged({
                                geocacheId,
                                reason: 'note-deleted',
                                source: 'chat',
                            });
                        }
                        return ok(`Note ${args.note_id} supprimée.`);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_sync_notes_from_geocaching',
                name: 'aide_sync_notes_from_geocaching',
                description: 'Récupère la note personnelle de la géocache depuis Geocaching.com et la met à jour dans GeoApp. Nécessite une connexion Geocaching.com.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    geocache_id: { type: 'number', description: 'ID de la géocache.', required: true },
                }),
                confirmAlwaysAllow: 'Récupérer la note personnelle depuis Geocaching.com ? Une requête réseau sera effectuée.',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const result = await this.notesService.syncFromGeocaching(args.geocache_id);
                        this.widgetEventsService.notifyGeocacheChanged({
                            geocacheId: args.geocache_id,
                            reason: 'note-updated',
                            source: 'chat',
                        });
                        return ok({
                            geocache_id: result.geocache_id,
                            gc_code: result.gc_code,
                            gc_personal_note: result.gc_personal_note,
                            gc_personal_note_synced_at: result.gc_personal_note_synced_at,
                        });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_push_note_to_geocaching',
                name: 'aide_push_note_to_geocaching',
                description: 'Envoie du contenu vers la note personnelle Geocaching.com d\'une géocache (accès réseau). ' +
                    'note_id = pousser une note applicative (ids via aide_list_notes) ; content = texte arbitraire ' +
                    '(ex: coordonnées résolues). Par défaut la note perso GC.com est REMPLACÉE ; append=true l\'ajoute à la suite.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    geocache_id: { type: 'number', description: 'ID de la géocache (ou utiliser gc_code).', required: false },
                    gc_code: { type: 'string', description: 'Code GC (ex: "GC8ABCD"), alternatif à geocache_id.', required: false },
                    note_id: { type: 'number', description: 'ID d\'une note applicative à pousser (via aide_list_notes).', required: false },
                    content: { type: 'string', description: 'Texte à pousser si pas de note_id.', required: false },
                    append: { type: 'boolean', description: 'true = ajoute au contenu existant de la note perso GC.com au lieu de le remplacer.', required: false },
                }),
                confirmAlwaysAllow: 'Pousser ce contenu vers la note personnelle Geocaching.com ? ' +
                    'Sans append, le contenu actuel de la note perso sera remplacé.',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const geocacheId = await this.resolveGeocacheId(args);
                        const noteId = args.note_id !== undefined ? Number(args.note_id) : undefined;
                        const rawContent = args.content !== undefined ? String(args.content) : undefined;
                        if (noteId === undefined && rawContent === undefined) {
                            return err('Fournissez note_id (note applicative) ou content (texte).');
                        }

                        let baseContent: string;
                        let gcPersonalNote: string | null = null;
                        if (noteId !== undefined || args.append) {
                            const notesResponse = await this.notesService.getNotes(geocacheId);
                            gcPersonalNote = notesResponse.gc_personal_note;
                            if (noteId !== undefined) {
                                const note = notesResponse.notes.find(n => n.id === noteId);
                                if (!note) {
                                    return err(`Note ${noteId} introuvable sur cette géocache — aide_list_notes pour les ids.`);
                                }
                                baseContent = note.content;
                            } else {
                                baseContent = rawContent!;
                            }
                        } else {
                            baseContent = rawContent!;
                        }

                        const finalContent = args.append && gcPersonalNote?.trim()
                            ? `${gcPersonalNote}\n\n${baseContent}`
                            : baseContent;

                        const result = noteId !== undefined
                            ? await this.notesService.syncToGeocaching(noteId, geocacheId, finalContent)
                            : await this.notesService.syncPersonalNoteToGeocaching(geocacheId, finalContent);
                        this.widgetEventsService.notifyGeocacheChanged({
                            geocacheId,
                            reason: 'note-updated',
                            source: 'chat',
                        });
                        return ok({
                            geocache_id: result.geocache_id,
                            gc_code: result.gc_code,
                            gc_personal_note: result.gc_personal_note,
                            gc_personal_note_last_pushed_at: result.gc_personal_note_last_pushed_at,
                        });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
        ];
    }

    // ─── Recherche globale ────────────────────────────────────────────────────

    private buildSearchTools(): ToolRequest[] {
        return [
            {
                id: 'aide_search_docs',
                name: 'aide_search_docs',
                description: 'Recherche dans la documentation officielle de GeoApp et retourne les sections les plus pertinentes avec leur contenu complet. ' +
                    'À utiliser pour répondre à toute question documentaire (comment, qu\'est-ce que, pourquoi, où, quel). ' +
                    'Donne une requête en mots-clés (ex: "ajouter une zone", "configurer OCR", "checker GeoCheck"). ' +
                    'Réponds ensuite à partir des sections retournées et cite le titre de la page concernée.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    query: { type: 'string', description: 'Termes de recherche (mots-clés du sujet).', required: true },
                    limit: { type: 'number', description: 'Nombre maximum de sections à retourner (défaut 5).', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const query = String(args.query || '').trim();
                        if (!query) { return err('Le champ query est requis.'); }
                        await this.docContentService.initialize();
                        await this.docSearchService.initialize();
                        const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 10);
                        const hits = this.docSearchService.search(query, limit);
                        if (hits.length === 0) {
                            return ok({ query, sections: [], note: 'Aucune section trouvée dans la documentation.' });
                        }
                        const sections = resolveDocSearchContent(
                            hits,
                            pageId => this.docContentService.getSectionsForPage(pageId),
                        );
                        return ok({ query, sections });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
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

    // ─── Statut, coordonnees corrigees et operations par lot ──────────────────

    /** Execute `fn` sur chaque id sans s'arreter au premier echec ; resume le resultat. */
    protected async runBatch(
        ids: unknown,
        fn: (id: number) => Promise<unknown>,
    ): Promise<{ succeeded: number[]; failed: Array<{ id: number; error: string }> }> {
        const succeeded: number[] = [];
        const failed: Array<{ id: number; error: string }> = [];
        const list = Array.isArray(ids) ? ids : [];
        for (const raw of list.slice(0, 200)) {
            const id = Number(raw);
            if (!Number.isFinite(id) || id <= 0) {
                failed.push({ id: 0, error: `id invalide: ${JSON.stringify(raw)}` });
                continue;
            }
            try {
                await fn(id);
                succeeded.push(id);
            } catch (e: any) {
                failed.push({ id, error: e?.message ?? String(e) });
            }
        }
        return { succeeded, failed };
    }

    /** §35 : réponse standard d'une simulation (dry_run) — rien n'a été modifié. */
    protected dryRunOk(action: string, details: Record<string, unknown>): string {
        return ok({ dry_run: true, action, ...details });
    }

    /** Toast utilisateur apres une operation par lot : visibilite hors du chat. */
    protected notifyBatchResult(action: string, summary: { succeeded: number[]; failed: unknown[] }): void {
        const suffix = summary.failed.length ? `, ${summary.failed.length} échec(s)` : '';
        this.messageService.info(`${action} : ${summary.succeeded.length} réussie(s)${suffix}.`);
    }

    private buildStatusAndBatchTools(): ToolRequest[] {
        const geocacheRef: Record<string, { type: string; description: string; required: boolean }> = {
            geocache_id: { type: 'number', description: 'ID de la géocache (ou utiliser gc_code).', required: false },
            gc_code: { type: 'string', description: 'Code GC (ex: "GC8ABCD"), alternatif à geocache_id.', required: false },
        };
        return [
            {
                id: 'aide_set_solved_status',
                name: 'aide_set_solved_status',
                description: 'Change le statut de résolution d\'une géocache : "not_solved" (non résolue), ' +
                    '"in_progress" (en cours) ou "solved" (résolue).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    ...geocacheRef,
                    status: {
                        type: 'string', required: true,
                        description: 'Nouveau statut.',
                        enum: ['not_solved', 'in_progress', 'solved'],
                    },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const geocacheId = await this.resolveGeocacheId(args);
                        const status = args.status as 'not_solved' | 'in_progress' | 'solved';
                        await this.geocacheDetailsService.updateSolvedStatus(geocacheId, status);
                        this.widgetEventsService.notifyGeocacheChanged({ geocacheId, reason: 'solved-status-updated', source: 'chat' });
                        this.messageService.info(`Statut « ${status} » enregistré pour la géocache.`);
                        return ok(`Statut de la géocache ${geocacheId} défini à "${status}".`);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_reset_coordinates',
                name: 'aide_reset_coordinates',
                description: 'Réinitialise les coordonnées corrigées d\'une géocache : la solution enregistrée ' +
                    '(coordonnées modifiées) est effacée et les coordonnées d\'origine sont restaurées.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({ ...geocacheRef, dry_run: DRY_RUN_PARAM }),
                confirmAlwaysAllow: 'Réinitialiser les coordonnées corrigées de cette géocache ? La solution enregistrée sera effacée.',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const geocacheId = await this.resolveGeocacheId(args);
                        if (args.dry_run) {
                            return this.dryRunOk('reset_coordinates', {
                                geocache_id: geocacheId,
                                consequence: 'Les coordonnées corrigées seraient effacées et les coordonnées d\'origine restaurées.',
                            });
                        }
                        await this.geocacheDetailsService.resetCoordinates(geocacheId);
                        this.widgetEventsService.notifyGeocacheChanged({ geocacheId, reason: 'coordinates-reset', source: 'chat' });
                        return ok(`Coordonnées de la géocache ${geocacheId} réinitialisées.`);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_push_corrected_coordinates',
                name: 'aide_push_corrected_coordinates',
                description: 'Envoie les coordonnées corrigées de la géocache au propriétaire sur Geocaching.com ' +
                    '(requiert une session Geocaching.com connectée).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({ ...geocacheRef }),
                confirmAlwaysAllow: 'Envoyer les coordonnées corrigées sur Geocaching.com ?',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const geocacheId = await this.resolveGeocacheId(args);
                        const result = await this.geocacheDetailsService.pushCorrectedCoordinates(geocacheId);
                        if (result && typeof (result as { error?: string }).error === 'string') {
                            return err((result as { error?: string }).error!);
                        }
                        return ok(`Coordonnées corrigées envoyées pour la géocache ${geocacheId}.`);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_update_waypoint',
                name: 'aide_update_waypoint',
                description: 'Met à jour un waypoint existant : nom, coordonnées (format GC "N 48° 51.500 E 002° 17.600"), ' +
                    'note et type. Seuls les champs fournis sont modifiés.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    ...geocacheRef,
                    waypoint_id: { type: 'number', description: 'ID du waypoint à modifier.', required: true },
                    name: { type: 'string', description: 'Nouveau nom.', required: false },
                    gc_coords: { type: 'string', description: 'Nouvelles coordonnées au format DDM.', required: false },
                    note: { type: 'string', description: 'Nouvelle note.', required: false },
                    type: { type: 'string', description: 'Nouveau type (ex: "Final Location").', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const geocacheId = await this.resolveGeocacheId(args);
                        const payload: Record<string, unknown> = {};
                        for (const key of ['name', 'gc_coords', 'note', 'type'] as const) {
                            if (args[key] !== undefined) { payload[key] = args[key]; }
                        }
                        await this.geocacheDetailsService.saveWaypoint(geocacheId, Number(args.waypoint_id), payload);
                        this.widgetEventsService.notifyGeocacheChanged({ geocacheId, reason: 'waypoint-updated', source: 'chat' });
                        return ok(`Waypoint ${args.waypoint_id} de la géocache ${geocacheId} mis à jour.`);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_push_waypoint_coordinates',
                name: 'aide_push_waypoint_coordinates',
                description: 'Envoie les coordonnées d\'un waypoint au propriétaire sur Geocaching.com ' +
                    '(requiert une session Geocaching.com connectée).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    ...geocacheRef,
                    waypoint_id: { type: 'number', description: 'ID du waypoint.', required: true },
                }),
                confirmAlwaysAllow: 'Envoyer les coordonnées de ce waypoint sur Geocaching.com ?',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const geocacheId = await this.resolveGeocacheId(args);
                        const result = await this.geocacheDetailsService.pushWaypointCoordinates(geocacheId, Number(args.waypoint_id));
                        if (result && typeof (result as { error?: string }).error === 'string') {
                            return err((result as { error?: string }).error!);
                        }
                        return ok(`Coordonnées du waypoint ${args.waypoint_id} envoyées.`);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_move_geocaches',
                name: 'aide_move_geocaches',
                description: 'Déplace plusieurs géocaches vers une zone cible en une seule action ' +
                    '(retirées de leur zone d\'origine). Une seule confirmation pour tout le lot.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    geocache_ids: { type: 'array', description: 'Liste des geocache_id à déplacer (ex: sélection de la table).', required: true },
                    target_zone_id: { type: 'number', description: 'ID de la zone cible.', required: true },
                }),
                confirmAlwaysAllow: 'Déplacer les géocaches sélectionnées vers la zone cible ?',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const target = Number(args.target_zone_id);
                        const summary = await this.runBatch(args.geocache_ids, id => this.geocachesService.move(id, target));
                        for (const id of summary.succeeded) {
                            this.widgetEventsService.notifyGeocacheChanged({ geocacheId: id, reason: 'refreshed', source: 'chat' });
                        }
                        if (summary.succeeded.length) { this.widgetEventsService.requestZonesRefresh(); }
                        this.notifyBatchResult('Déplacement', summary);
                        return ok(summary);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_copy_geocaches',
                name: 'aide_copy_geocaches',
                description: 'Copie plusieurs géocaches vers une zone cible en une seule action (les originales restent).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    geocache_ids: { type: 'array', description: 'Liste des geocache_id à copier.', required: true },
                    target_zone_id: { type: 'number', description: 'ID de la zone cible.', required: true },
                }),
                confirmAlwaysAllow: 'Copier les géocaches sélectionnées vers la zone cible ?',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const target = Number(args.target_zone_id);
                        const summary = await this.runBatch(args.geocache_ids, id => this.geocachesService.copy(id, target));
                        if (summary.succeeded.length) { this.widgetEventsService.requestZonesRefresh(); }
                        this.notifyBatchResult('Copie', summary);
                        return ok(summary);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_delete_geocaches',
                name: 'aide_delete_geocaches',
                description: 'Supprime définitivement plusieurs géocaches en une seule action. Irréversible.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    geocache_ids: { type: 'array', description: 'Liste des geocache_id à supprimer.', required: true },
                    dry_run: DRY_RUN_PARAM,
                }),
                confirmAlwaysAllow: 'Supprimer définitivement les géocaches sélectionnées ? Cette action est irréversible.',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        if (args.dry_run) {
                            let batch: { geocaches: Array<{ id: number; name?: string; code?: string }>; missing: number[] } | undefined;
                            try { batch = await this.geocachesService.getBatch(args.geocache_ids); } catch { /* best-effort */ }
                            return this.dryRunOk('delete_geocaches', {
                                geocache_ids: args.geocache_ids,
                                resolved: batch?.geocaches.map(g => ({ id: g.id, name: g.name, code: g.code })),
                                missing: batch?.missing,
                                consequence: `${args.geocache_ids.length} géocache(s) et leurs données seraient définitivement supprimées.`,
                            });
                        }
                        const summary = await this.runBatch(args.geocache_ids, id => this.geocachesService.delete(id));
                        for (const id of summary.succeeded) {
                            this.widgetEventsService.notifyGeocacheChanged({ geocacheId: id, reason: 'deleted', source: 'chat' });
                        }
                        if (summary.succeeded.length) { this.widgetEventsService.requestZonesRefresh(); }
                        this.notifyBatchResult('Suppression', summary);
                        return ok(summary);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
        ];
    }

    // ─── Logs Geocaching.com ──────────────────────────────────────────────────

    private buildLogTools(): ToolRequest[] {
        const geocacheRef: Record<string, { type: string; description: string; required: boolean }> = {
            geocache_id: { type: 'number', description: 'ID de la géocache (ou utiliser gc_code).', required: false },
            gc_code: { type: 'string', description: 'Code GC (ex: "GC8ABCD"), alternatif à geocache_id.', required: false },
        };
        return [
            {
                id: 'aide_get_geocache_logs',
                name: 'aide_get_geocache_logs',
                description: 'Lit les logs STOCKÉS localement d\'une géocache (gratuit, sans accès réseau). ' +
                    'Pour récupérer les logs manquants depuis Geocaching.com, utiliser aide_refresh_logs.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    ...geocacheRef,
                    limit: { type: 'number', description: 'Nombre max de logs retournés (défaut 50, max 200).', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const geocacheId = await this.resolveGeocacheId(args);
                        const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 200);
                        const selection = await this.logsAnalysisService.collectLogsToAnalyze(geocacheId, limit);
                        return ok({
                            geocache_id: geocacheId,
                            stored_count: selection.storedCount,
                            total_available: selection.totalAvailable ?? null,
                            logs: selection.logs.map(log => ({
                                id: log.id,
                                author: log.author,
                                date: log.date,
                                log_type: log.log_type,
                                is_friend_log: log.is_friend_log,
                                is_own_log: log.is_own_log,
                                text: (log.text || '').substring(0, 400),
                            })),
                        });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_get_logs_summary',
                name: 'aide_get_logs_summary',
                description: 'Résumé des logs récents d\'une géocache (types, auteurs, dates, extraits) ' +
                    'sans charger le texte intégral.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    ...geocacheRef,
                    count: { type: 'number', description: 'Nombre de logs récents à résumer (défaut 20).', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const geocacheId = await this.resolveGeocacheId(args);
                        const count = Math.min(Math.max(Number(args.count) || 20, 1), 100);
                        const summary = await this.geocacheDetailsService.getRecentLogsSummary(geocacheId, count);
                        return ok(summary ?? { logs: [] });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_refresh_logs',
                name: 'aide_refresh_logs',
                description: 'Récupère les logs d\'une géocache depuis Geocaching.com et les stocke en base ' +
                    '(accès réseau, requiert une session connectée).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    ...geocacheRef,
                    count: { type: 'number', description: 'Nombre de logs à récupérer (défaut : préférence de l\'app).', required: false },
                }),
                confirmAlwaysAllow: 'Récupérer les logs depuis Geocaching.com ?',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const geocacheId = await this.resolveGeocacheId(args);
                        const options = args.count ? { count: Number(args.count) } : {};
                        const result = await this.logsFetchService.refresh(geocacheId, options);
                        this.widgetEventsService.notifyGeocacheChanged({ geocacheId, reason: 'logs-refreshed', source: 'chat' });
                        return ok(result);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
        ];
    }

    // ─── Amis Geocaching.com ──────────────────────────────────────────────────

    private buildFriendTools(): ToolRequest[] {
        return [
            {
                id: 'aide_list_friend_events',
                name: 'aide_list_friend_events',
                description: 'Liste les événements d\'activité récents des amis Geocaching.com ' +
                    '(trouvailles, logs) déjà synchronisés en base.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    limit: { type: 'number', description: 'Nombre max d\'événements (défaut 30, max 100).', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const limit = Math.min(Math.max(Number(args.limit) || 30, 1), 100);
                        return ok(await this.friendsService.loadEvents(limit));
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_get_friend_stats',
                name: 'aide_get_friend_stats',
                description: 'Statistiques globales des amis (trouvailles synchronisées, couverture, fraîcheur des données).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({}),
                handler: async () => {
                    try {
                        return ok(await this.friendsService.loadStats());
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_get_friend_finds_for_zone',
                name: 'aide_get_friend_finds_for_zone',
                description: 'Pour chaque géocache d\'une zone, indique quels amis l\'ont trouvée ' +
                    '(données synchronisées en base, pas d\'accès réseau).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    zone_id: { type: 'number', description: 'ID de la zone.', required: true },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const finds = await this.friendsService.loadZoneFinds(Number(args.zone_id));
                        const entries = Object.entries(finds);
                        const capped = entries.slice(0, 200);
                        return ok({
                            zone_id: Number(args.zone_id),
                            total: entries.length,
                            finds: Object.fromEntries(capped),
                            truncated: entries.length > capped.length,
                        });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_get_friend_finds_for_geocache',
                name: 'aide_get_friend_finds_for_geocache',
                description: 'Indique quels amis ont trouvé une géocache donnée (données synchronisées en base).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    geocache_id: { type: 'number', description: 'ID de la géocache (ou utiliser gc_code).', required: false },
                    gc_code: { type: 'string', description: 'Code GC, alternatif à geocache_id.', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const geocacheId = await this.resolveGeocacheId(args);
                        return ok(await this.friendsService.loadGeocacheFinds(geocacheId));
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_open_friends',
                name: 'aide_open_friends',
                description: 'Ouvre le widget Amis Geocaching.com sur l\'onglet de la liste d\'amis.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({}),
                handler: async () => {
                    try {
                        await this.commandService.executeCommand('geoapp.friends.open');
                        return ok('Panneau des amis ouvert.');
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_open_friend_activity',
                name: 'aide_open_friend_activity',
                description: 'Ouvre le widget Amis Geocaching.com sur l\'onglet Activité (flux des logs récents des amis).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({}),
                handler: async () => {
                    try {
                        await this.commandService.executeCommand('geoapp.friends.activity.open');
                        return ok('Panneau d\'activité des amis ouvert.');
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
        ];
    }

    // ─── Archive de résolutions ───────────────────────────────────────────────

    private buildArchiveTools(): ToolRequest[] {
        return [
            {
                id: 'aide_list_archive',
                name: 'aide_list_archive',
                description: 'Liste les géocaches archivées (résolutions conservées après suppression de la zone), ' +
                    'paginées et filtrables par statut ou code GC.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    page: { type: 'number', description: 'Numéro de page (défaut 1).', required: false },
                    per_page: { type: 'number', description: 'Entrées par page (défaut 20, max 100).', required: false },
                    solved_status: { type: 'string', description: 'Filtre de statut (ex: "solved").', required: false },
                    gc_code: { type: 'string', description: 'Filtre par code GC.', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const response = await this.archiveService.listArchives({
                            page: Math.max(Number(args.page) || 1, 1),
                            perPage: Math.min(Math.max(Number(args.per_page) || 20, 1), 100),
                            solvedStatus: args.solved_status ? String(args.solved_status) : undefined,
                            gcCode: args.gc_code ? String(args.gc_code) : undefined,
                        });
                        return ok({
                            total: response.total,
                            page: response.page,
                            pages: response.pages,
                            archives: response.archives.map(entry => ({
                                gc_code: entry.gc_code,
                                name: entry.name,
                                cache_type: entry.cache_type,
                                difficulty: entry.difficulty,
                                terrain: entry.terrain,
                                solved_status: entry.solved_status,
                                solved_coordinates_raw: entry.solved_coordinates_raw,
                                updated_at: entry.updated_at,
                            })),
                        });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_archive_status',
                name: 'aide_archive_status',
                description: 'Indique si un code GC possède une archive de résolution et si elle a besoin d\'une synchronisation.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    gc_code: { type: 'string', description: 'Code GC (ex: "GC8ABCD").', required: true },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const status = await this.geocacheDetailsService.getArchiveStatus(String(args.gc_code));
                        return ok(status ?? { exists: false });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_archive_sync',
                name: 'aide_archive_sync',
                description: 'Force la synchronisation de l\'archive d\'une géocache : snapshot des données de résolution ' +
                    'actuelles (statut, coordonnées résolues, note perso) vers l\'archive.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    gc_code: { type: 'string', description: 'Code GC (ex: "GC8ABCD").', required: true },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const result = await this.geocacheDetailsService.syncArchive(String(args.gc_code));
                        return ok(result ?? { gc_code: String(args.gc_code).trim().toUpperCase(), synced: true });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_archive_restore',
                name: 'aide_archive_restore',
                description: 'Restaure les données d\'archive vers la géocache présente en base : statut de résolution, ' +
                    'coordonnées résolues, note perso, flag found. La géocache doit exister dans une zone. Écrase les valeurs actuelles.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    gc_code: { type: 'string', description: 'Code GC (ex: "GC8ABCD").', required: true },
                    dry_run: DRY_RUN_PARAM,
                }),
                confirmAlwaysAllow: 'Restaurer cette archive vers la géocache ? Statut, coordonnées résolues, note perso et found seront écrasés.',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const gcCode = String(args.gc_code).trim().toUpperCase();
                        if (args.dry_run) {
                            const archive = await this.archiveService.getArchive(gcCode);
                            return this.dryRunOk('archive_restore', {
                                gc_code: gcCode,
                                would_restore: {
                                    solved_status: archive.solved_status,
                                    solved_coordinates_raw: archive.solved_coordinates_raw,
                                    personal_note: archive.personal_note ? '(présente)' : undefined,
                                    found: archive.found,
                                },
                                consequence: 'Ces valeurs d\'archive écraseraient les valeurs actuelles de la géocache.',
                            });
                        }
                        const result = await this.archiveService.restoreArchive(gcCode);
                        this.widgetEventsService.requestZonesRefresh();
                        return ok({
                            gc_code: result.gc_code,
                            restored_fields: result.restored_fields,
                        });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_archive_get_settings',
                name: 'aide_archive_get_settings',
                description: 'Lit les paramètres d\'archivage (auto_sync_enabled : synchro automatique des résolutions vers l\'archive).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({}),
                handler: async () => {
                    try {
                        return ok(await this.archiveService.getSettings());
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_archive_set_auto_sync',
                name: 'aide_archive_set_auto_sync',
                description: 'Active ou désactive la synchronisation automatique des résolutions vers l\'archive.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    enabled: { type: 'boolean', description: 'true = synchro automatique activée.', required: true },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        return ok(await this.archiveService.updateSettings(Boolean(args.enabled)));
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_archive_bulk_delete',
                name: 'aide_archive_bulk_delete',
                description: 'Supprime en masse des entrées d\'archive (irréversible). Filtres : all = tout, ' +
                    'by_status (+ status), orphaned (archives sans géocache en base), before_date (+ before_date ISO).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    filter: {
                        type: 'string',
                        description: 'Périmètre de la purge : "all", "by_status", "orphaned" ou "before_date".',
                        required: true,
                        enum: ['all', 'by_status', 'orphaned', 'before_date'],
                    },
                    status: { type: 'string', description: 'Statut ciblé si filter="by_status" (ex: "not_solved").', required: false },
                    before_date: { type: 'string', description: 'Date ISO (AAAA-MM-JJ) si filter="before_date".', required: false },
                    dry_run: DRY_RUN_PARAM,
                }),
                confirmAlwaysAllow: 'Supprimer définitivement des entrées d\'archive en masse ? Action irréversible.',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const filter = String(args.filter);
                        if (filter === 'by_status' && !args.status) {
                            return err('Le paramètre status est requis avec filter="by_status".');
                        }
                        if (filter === 'before_date' && !args.before_date) {
                            return err('Le paramètre before_date (AAAA-MM-JJ) est requis avec filter="before_date".');
                        }
                        if (args.dry_run) {
                            let affected: number | undefined;
                            if (filter === 'all') {
                                affected = (await this.archiveService.getStats()).total_archived;
                            } else if (filter === 'by_status') {
                                affected = (await this.archiveService.listArchives({
                                    page: 1, perPage: 1, solvedStatus: String(args.status),
                                })).total;
                            }
                            return this.dryRunOk('archive_bulk_delete', {
                                filter,
                                status: args.status,
                                before_date: args.before_date,
                                affected_count: affected,
                                consequence: 'Les entrées d\'archive correspondantes seraient définitivement supprimées.',
                            });
                        }
                        const result = await this.archiveService.bulkDeleteArchives({
                            confirm: true,
                            filter: filter as 'all' | 'by_status' | 'orphaned' | 'before_date',
                            status: args.status ? String(args.status) : undefined,
                            before_date: args.before_date ? String(args.before_date) : undefined,
                        });
                        this.messageService.info(`Archives supprimées : ${result.deleted}.`);
                        return ok(result);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
        ];
    }

    // ─── Carte ────────────────────────────────────────────────────────────────

    private buildMapTools(): ToolRequest[] {
        const openMap = async (): Promise<void> => {
            await this.commandService.executeCommand('geoapp.map.toggle');
        };
        return [
            {
                id: 'aide_map_show_geocache',
                name: 'aide_map_show_geocache',
                description: 'Ouvre la carte et la centre sur une géocache (la sélectionne sur la carte).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    geocache_id: { type: 'number', description: 'ID de la géocache (ou utiliser gc_code).', required: false },
                    gc_code: { type: 'string', description: 'Code GC, alternatif à geocache_id.', required: false },
                    zoom: { type: 'number', description: 'Niveau de zoom (optionnel).', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const geocacheId = await this.resolveGeocacheId(args);
                        const raw = await this.geocachesService.get<Record<string, unknown>>(geocacheId);
                        const latitude = Number(raw['latitude']);
                        const longitude = Number(raw['longitude']);
                        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
                            return err('Coordonnées de la géocache indisponibles.');
                        }
                        const selected: SelectedGeocache = {
                            id: geocacheId,
                            gc_code: String(raw['gc_code'] ?? ''),
                            name: String(raw['name'] ?? ''),
                            latitude,
                            longitude,
                            cache_type: String(raw['cache_type'] ?? raw['type'] ?? ''),
                        };
                        await openMap();
                        this.mapService.centerOnGeocache(selected, args.zoom ? Number(args.zoom) : undefined);
                        return ok(`Carte centrée sur ${selected.gc_code || geocacheId}.`);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_map_center',
                name: 'aide_map_center',
                description: 'Ouvre la carte et la centre sur des coordonnées décimales (sans sélectionner de géocache).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    latitude: { type: 'number', description: 'Latitude décimale.', required: true },
                    longitude: { type: 'number', description: 'Longitude décimale.', required: true },
                    zoom: { type: 'number', description: 'Niveau de zoom (défaut : zoom courant ou 15).', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const latitude = Number(args.latitude);
                        const longitude = Number(args.longitude);
                        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
                            || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
                            return err('Coordonnées invalides.');
                        }
                        await openMap();
                        this.mapService.centerOnCoordinates(latitude, longitude, args.zoom ? Number(args.zoom) : undefined);
                        return ok(`Carte centrée sur ${latitude}, ${longitude}.`);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_map_show_zone',
                name: 'aide_map_show_zone',
                description: 'Ouvre la carte et affiche toutes les géocaches d\'une zone (centrage sur l\'étendue).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    zone_id: { type: 'number', description: 'ID de la zone.', required: true },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const geocaches = await this.zonesService.listGeocachesTree<Array<Record<string, unknown>>>(Number(args.zone_id));
                        const selected = (geocaches ?? [])
                            .filter(g => Number.isFinite(Number(g['latitude'])) && Number.isFinite(Number(g['longitude'])))
                            .map(g => ({
                                id: Number(g['id']),
                                gc_code: String(g['gc_code'] ?? ''),
                                name: String(g['name'] ?? ''),
                                latitude: Number(g['latitude']),
                                longitude: Number(g['longitude']),
                                cache_type: String(g['cache_type'] ?? g['type'] ?? ''),
                            } as SelectedGeocache));
                        if (!selected.length) {
                            return err('Aucune géocache avec coordonnées dans cette zone.');
                        }
                        await openMap();
                        this.mapService.centerOnGeocaches(selected);
                        return ok(`Carte centrée sur ${selected.length} géocache(s) de la zone ${args.zone_id}.`);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
        ];
    }

    // ─── Checklist de sortie ──────────────────────────────────────────────────

    private buildOutingTools(): ToolRequest[] {
        return [
            {
                id: 'aide_list_outing_plans',
                name: 'aide_list_outing_plans',
                description: 'Liste les checklists de sortie enregistrées (id, titre, date, nombre de caches).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    limit: { type: 'number', description: 'Nombre max de plans (défaut 20).', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const plans = await this.outingPlanService.listPlans({ limit: Number(args.limit) || 20 });
                        return ok(plans.map(plan => ({
                            id: plan.id,
                            zone_name: plan.zone_name,
                            outing_date: plan.outing_date,
                            geocache_count: plan.gc_codes?.length ?? 0,
                            checked_count: plan.checked?.length ?? 0,
                            source: plan.source,
                            updated_at: plan.updated_at,
                        })));
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_get_outing_plan',
                name: 'aide_get_outing_plan',
                description: 'Retourne le détail d\'une checklist de sortie (géocaches, état coché, rapport).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    plan_id: { type: 'number', description: 'ID du plan.', required: true },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        return ok(await this.outingPlanService.getPlan(Number(args.plan_id)));
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_set_outing_plan_checked',
                name: 'aide_set_outing_plan_checked',
                description: 'Met à jour les cases cochées d\'une checklist de sortie ' +
                    '(liste complète des codes GC cochés — remplace l\'état courant).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    plan_id: { type: 'number', description: 'ID du plan.', required: true },
                    checked_gc_codes: { type: 'array', description: 'Codes GC des caches marquées comme faites.', required: true },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const checked = (args.checked_gc_codes as unknown[]).map(String);
                        const plan = await this.outingPlanService.setChecked(Number(args.plan_id), checked);
                        return ok({ id: plan.id, checked_count: checked.length });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_delete_outing_plan',
                name: 'aide_delete_outing_plan',
                description: 'Supprime définitivement une checklist de sortie. Irréversible.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    plan_id: { type: 'number', description: 'ID du plan.', required: true },
                    dry_run: DRY_RUN_PARAM,
                }),
                confirmAlwaysAllow: 'Supprimer cette checklist de sortie ? Cette action est irréversible.',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        if (args.dry_run) {
                            let plan: { zone_name?: string; outing_date?: string; gc_codes?: string[] } | undefined;
                            try { plan = await this.outingPlanService.getPlan(Number(args.plan_id)); } catch { /* best-effort */ }
                            return this.dryRunOk('delete_outing_plan', {
                                plan_id: args.plan_id,
                                plan: plan && {
                                    zone_name: plan.zone_name,
                                    outing_date: plan.outing_date,
                                    geocache_count: plan.gc_codes?.length,
                                },
                                consequence: 'La checklist de sortie serait définitivement supprimée.',
                            });
                        }
                        await this.outingPlanService.deletePlan(Number(args.plan_id));
                        return ok(`Checklist ${args.plan_id} supprimée.`);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_open_outing_plan',
                name: 'aide_open_outing_plan',
                description: 'Ouvre le panneau des checklists de sortie.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({}),
                handler: async () => {
                    try {
                        await this.commandService.executeCommand('geoapp.outing.plan.open');
                        return ok('Panneau des checklists de sortie ouvert.');
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
        ];
    }

    // ─── Trackables ─────────────────────────────────────────────────────────

    /** Résout un code GC depuis gc_code (prioritaire) ou geocache_id. */
    protected async resolveGcCode(args: Record<string, any>): Promise<string> {
        const direct = typeof args.gc_code === 'string' ? args.gc_code.trim() : '';
        if (direct) {
            return direct;
        }
        const id = Number(args.geocache_id);
        if (Number.isFinite(id) && id > 0) {
            const geocache = await this.apiClient.requestJson<{ gc_code?: string }>(
                `/api/geocaches/${id}`, {}, 'Géocache introuvable'
            );
            if (typeof geocache?.gc_code === 'string' && geocache.gc_code) {
                return geocache.gc_code;
            }
            throw new Error(`Aucune géocache trouvée pour geocache_id ${id}.`);
        }
        throw new Error('Fournissez gc_code ou geocache_id.');
    }

    private buildTrackableTools(): ToolRequest[] {
        return [
            {
                id: 'aide_open_trackables',
                name: 'aide_open_trackables',
                description: 'Ouvre le widget Trackables (onglets Inventaire, Loguer / Découvrir, Fiche). ' +
                    'trackable_code préremplit l\'onglet demandé ; action + geocache_code préremplissent ' +
                    'un log « retirer » ou « découvrir » depuis une cache.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    tab: {
                        type: 'string', required: false,
                        description: 'Onglet à afficher : inventory (inventaire), log (loguer/découvrir), detail (fiche).',
                        enum: ['inventory', 'log', 'detail'],
                    },
                    trackable_code: { type: 'string', description: 'Code du trackable (TB… ou code de suivi) à préremplir.', required: false },
                    action: { type: 'string', required: false, enum: ['retrieve', 'discover', 'log'], description: 'Action de l\'onglet log.' },
                    geocache_code: { type: 'string', description: 'Cache d\'origine de l\'action (ex. « retirer de GC… »).', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const context: Record<string, unknown> = {};
                        if (args.tab) { context.tab = args.tab; }
                        if (args.trackable_code) { context.trackableCode = args.trackable_code; }
                        if (args.action) { context.action = args.action; }
                        if (args.geocache_code) { context.geocacheCode = args.geocache_code; }
                        await this.commandService.executeCommand(
                            'geoapp.trackables.open',
                            Object.keys(context).length ? context : undefined
                        );
                        return ok('Widget Trackables ouvert.');
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_list_trackable_inventory',
                name: 'aide_list_trackable_inventory',
                description: 'Liste mon inventaire de trackables (travel bugs, geocoins détenus). ' +
                    'refresh=true force une relecture sur Geocaching.com.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    refresh: { type: 'boolean', description: 'Relire le site plutôt que la copie locale.', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        return ok(await this.trackablesService.getInventory({ refresh: Boolean(args.refresh) }));
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_list_geocache_trackables',
                name: 'aide_list_geocache_trackables',
                description: 'Liste les trackables déclarés dans une géocache (gc_code ou geocache_id). ' +
                    'refresh=true force une relecture sur Geocaching.com.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    gc_code: { type: 'string', description: 'Code GC (ex: "GC8ABCD").', required: false },
                    geocache_id: { type: 'number', description: 'ID de la géocache, alternatif à gc_code.', required: false },
                    refresh: { type: 'boolean', description: 'Relire le site plutôt que la copie locale.', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const gcCode = await this.resolveGcCode(args);
                        return ok(await this.trackablesService.getGeocacheInventory(gcCode, { refresh: Boolean(args.refresh) }));
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_lookup_trackable',
                name: 'aide_lookup_trackable',
                description: 'Retrouve un trackable par code public (TB…) ou code de suivi. ' +
                    'tracking_code_matched=true si le code saisi était le code de suivi ' +
                    '(il est alors connu pour loguer, jamais renvoyé).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    code: { type: 'string', description: 'Code public ou code de suivi du trackable.', required: true },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        return ok(await this.trackablesService.lookup(String(args.code)));
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_get_trackable',
                name: 'aide_get_trackable',
                description: 'Fiche détaillée d\'un trackable : résumé, objectif, propriétaire, ' +
                    'localisation, historique des logs. code = code public (TB…).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    code: { type: 'string', description: 'Code public du trackable (TB…).', required: true },
                    refresh: { type: 'boolean', description: 'Relire le site plutôt que le cache de 5 min.', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const result = await this.trackablesService.getTrackable(String(args.code), Boolean(args.refresh));
                        const details = { ...result.details } as Record<string, unknown>;
                        const logs = Array.isArray(details.logs) ? details.logs : [];
                        if (logs.length > 10) {
                            details.logs = logs.slice(0, 10);
                            details.logs_total = logs.length;
                            details.logs_truncated = true;
                        }
                        return ok({ trackable: result.trackable, details });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_get_trackable_log_info',
                name: 'aide_get_trackable_log_info',
                description: 'Types de log autorisés à l\'instant T pour un trackable, sa cache courante ' +
                    'et si son code de suivi est connu. Préflight obligatoire avant aide_log_trackable.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    code: { type: 'string', description: 'Code public du trackable (TB…).', required: true },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        return ok(await this.trackablesService.getLogInfo(String(args.code)));
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_log_trackable',
                name: 'aide_log_trackable',
                description: 'Publie un log sur Geocaching.com pour un trackable — ACTION PUBLIQUE IRRÉVERSIBLE. ' +
                    'log_type : 4 Note, 5 Archivé, 13 Retiré de la cache, 14 Déposé, 15 Transféré, ' +
                    '16 Marqué manquant, 19 Pris ailleurs, 48 Découvert, 69 Vers la collection, ' +
                    '70 Vers l\'inventaire, 75 Visité. Appeler aide_get_trackable_log_info avant : ' +
                    'seuls les types alors autorisés passent. tracking_code requis pour ' +
                    'découvrir/retirer/prendre sauf si has_tracking_code.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    code: { type: 'string', description: 'Code public du trackable (TB…).', required: true },
                    log_type: {
                        type: 'number', required: true,
                        description: 'Type de log : 4, 5, 13, 14, 15, 16, 19, 48, 69, 70 ou 75.',
                        enum: [4, 5, 13, 14, 15, 16, 19, 48, 69, 70, 75],
                    },
                    text: { type: 'string', description: 'Texte du log.', required: true },
                    date: { type: 'string', description: 'Date du log au format YYYY-MM-DD.', required: true },
                    tracking_code: {
                        type: 'string', required: false,
                        description: 'Code de suivi, requis pour découvrir/retirer/prendre si non connu.',
                    },
                    geocache_code: {
                        type: 'string', required: false,
                        description: 'Cache d\'origine pour « Retiré de la cache » (13) ; à défaut, la cache courante du TB.',
                    },
                    location_conflict_confirmed: {
                        type: 'boolean', required: false,
                        description: 'Confirme explicitement une geocache_code différente de la localisation déclarée du TB.',
                    },
                    dry_run: DRY_RUN_PARAM,
                }),
                confirmAlwaysAllow: 'Publier ce log de trackable sur Geocaching.com ? ' +
                    'Action publique et irréversible.',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const code = String(args.code).trim();
                        if (args.dry_run) {
                            const info = await this.trackablesService.getLogInfo(code);
                            const allowed = info.allowed_log_type_ids.includes(Number(args.log_type));
                            return this.dryRunOk('log_trackable', {
                                code,
                                log_type: args.log_type,
                                log_type_allowed: allowed,
                                allowed_log_types: info.allowed_log_types,
                                current_geocache_code: info.current_geocache_code,
                                current_geocache_name: info.current_geocache_name,
                                has_tracking_code: info.has_tracking_code,
                                consequence: allowed
                                    ? 'Le log serait publié publiquement sur Geocaching.com.'
                                    : 'Ce type de log n\'est pas autorisé pour ce trackable actuellement.',
                            });
                        }
                        const submission: TrackableLogSubmission = {
                            logType: Number(args.log_type),
                            text: String(args.text),
                            date: String(args.date),
                            operationId: `aide-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
                        };
                        if (args.tracking_code) { submission.trackingCode = String(args.tracking_code); }
                        if (args.geocache_code) { submission.geocacheCode = String(args.geocache_code); }
                        if (args.location_conflict_confirmed) { submission.locationConflictConfirmed = true; }
                        return ok(await this.trackablesService.postLog(code, submission));
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
        ];
    }

    // ─── Visites GPS ──────────────────────────────────────────────────────────

    private buildGpsVisitsTools(): ToolRequest[] {
        const visitIdsParam = {
            visit_ids: {
                type: 'array', required: true,
                description: 'IDs des visites (champ visit_ids des entrées de aide_list_gps_visits).',
            },
        };
        return [
            {
                id: 'aide_open_gps_visits',
                name: 'aide_open_gps_visits',
                description: 'Ouvre le widget Visites GPS (import Garmin, rattachement des visites sans code, ' +
                    'vérification des trouvailles, préparation de sortie).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({}),
                handler: async () => {
                    try {
                        await this.commandService.executeCommand('geoapp.gpsVisits.open');
                        return ok('Widget Visites GPS ouvert.');
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_gps_visits_detect',
                name: 'aide_gps_visits_detect',
                description: 'Détecte les GPS Garmin branchés : racine, fichiers de visites ' +
                    '(geocache_visits.txt / geocache_logs.xml), traces et GPX des caches.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({}),
                handler: async () => {
                    try {
                        return ok(await this.gpsVisitsService.detect());
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_gps_visits_import',
                name: 'aide_gps_visits_import',
                description: 'Importe les visites du GPS : device_root (racine renvoyée par ' +
                    'aide_gps_visits_detect), path (fichier ou dossier du disque, ex. geocache_visits.txt) ' +
                    'ou file_paths (fichiers lus et envoyés : visites, traces, GPX de caches). ' +
                    'Renvoie le bilan : nouvelles visites, illisibles, positionnement sur les traces.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    device_root: { type: 'string', description: 'Racine d\'un GPS détecté (device.root).', required: false },
                    path: { type: 'string', description: 'Fichier ou dossier local à importer.', required: false },
                    file_paths: {
                        type: 'array', required: false,
                        description: 'Liste de chemins de fichiers à envoyer (visites, traces .fit/.gpx, GPX de caches).',
                    },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        if (args.device_root) {
                            return ok(await this.gpsVisitsService.importDevice(String(args.device_root)));
                        }
                        if (args.path) {
                            return ok(await this.gpsVisitsService.importPath(String(args.path)));
                        }
                        const paths = Array.isArray(args.file_paths) ? args.file_paths : [];
                        if (paths.length) {
                            if (!this.fileService) {
                                return err('Lecture de fichiers indisponible : utilisez path ou device_root.');
                            }
                            const files: File[] = [];
                            for (const filePath of paths) {
                                const uri = URI.fromFilePath(String(filePath));
                                const content = await this.fileService.readFile(uri);
                                files.push(new File([new Uint8Array(content.value.buffer)], uri.path.base || 'file'));
                            }
                            return ok(await this.gpsVisitsService.importFiles(files));
                        }
                        return err('Fournissez device_root, path ou file_paths.');
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_gps_visits_position',
                name: 'aide_gps_visits_position',
                description: 'Positionne les visites à loguer sur les traces du GPS branché ' +
                    '(toutes par défaut, ou celles des jours donnés). Préalable aux recherches ' +
                    'de candidats par la trace.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    days: { type: 'array', description: 'Jours AAAA-MM-JJ à positionner ; absent = toutes.', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const days = Array.isArray(args.days) ? args.days.map(String) : undefined;
                        return ok(await this.gpsVisitsService.position(days));
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_gps_visits_list',
                name: 'aide_gps_visits_list',
                description: 'Liste les visites GPS groupées par jour : code GC (ou sans code), ' +
                    'heure, résultat, état, caches connues, position. states : pending (à loguer, ' +
                    'défaut), logged, ignored, history.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    states: {
                        type: 'array', required: false,
                        description: 'États à inclure parmi pending, logged, ignored, history (défaut [pending]).',
                    },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const allowed: GpsVisitState[] = ['pending', 'logged', 'ignored', 'history'];
                        const states: GpsVisitState[] = Array.isArray(args.states)
                            ? (args.states.map(String) as GpsVisitState[]).filter(s => allowed.includes(s))
                            : ['pending'];
                        if (!states.length) {
                            return err(`states invalide : attendu parmi ${allowed.join(', ')}.`);
                        }
                        return ok(await this.gpsVisitsService.list(states));
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_gps_visits_set_state',
                name: 'aide_gps_visits_set_state',
                description: 'Change l\'état de visites : pending (à loguer), logged (marqué logué), ' +
                    'ignored (ignoré). Renvoie l\'état d\'avant (previous) à rejouer avec ' +
                    'aide_gps_visits_restore pour annuler.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    ...visitIdsParam,
                    state: {
                        type: 'string', required: true,
                        description: 'Nouvel état.',
                        enum: ['pending', 'logged', 'ignored'],
                    },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const ids = (args.visit_ids as unknown[]).map(Number).filter(Number.isFinite);
                        if (!ids.length) {
                            return err('visit_ids requis (liste non vide).');
                        }
                        return ok(await this.gpsVisitsService.setState(ids, args.state));
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_gps_visits_restore',
                name: 'aide_gps_visits_restore',
                description: 'Annule une action précédente : items = snapshots « previous » renvoyés par ' +
                    'set_state/resolve/resolve-batch ; cutoff / clear_cutoff = point de départ d\'avant.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    items: {
                        type: 'array', required: false,
                        description: 'Snapshots [{id, state, resolved_gc_code, resolution_source}] tels que renvoyés.',
                    },
                    cutoff: { type: 'string', description: 'Point de départ AAAA-MM-JJ à restaurer.', required: false },
                    clear_cutoff: { type: 'boolean', description: 'Supprime le point de départ.', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const undo: GpsUndo = {};
                        if (Array.isArray(args.items) && args.items.length) {
                            undo.items = args.items;
                        }
                        if (args.cutoff !== undefined) {
                            undo.cutoff = args.cutoff === null ? null : String(args.cutoff);
                        } else if (args.clear_cutoff) {
                            undo.cutoff = null;
                        }
                        if (!undo.items && undo.cutoff === undefined) {
                            return err('Fournissez items (snapshots d\'une action précédente) ou cutoff/clear_cutoff.');
                        }
                        await this.gpsVisitsService.restore(undo);
                        return ok('Action annulée.');
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_gps_visits_set_cutoff',
                name: 'aide_gps_visits_set_cutoff',
                description: 'Définit le point de départ des visites (AAAA-MM-JJ) : avant = history, ' +
                    'après = à loguer. Renvoie previous_cutoff pour annuler avec aide_gps_visits_restore.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    since: { type: 'string', description: 'Point de départ au format AAAA-MM-JJ.', required: true },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        return ok(await this.gpsVisitsService.setCutoff(String(args.since)));
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_gps_visits_check_found',
                name: 'aide_gps_visits_check_found',
                description: 'Vérifie sur Geocaching.com ma date de trouvaille des caches de ces visites ' +
                    '(requêtes réseau, authentification requise). Détecte celles déjà loguées.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({ ...visitIdsParam }),
                confirmAlwaysAllow: 'Vérifier ces caches sur Geocaching.com ? Des requêtes réseau seront effectuées.',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const ids = (args.visit_ids as unknown[]).map(Number).filter(Number.isFinite);
                        if (!ids.length) {
                            return err('visit_ids requis (liste non vide).');
                        }
                        return ok(await this.gpsVisitsService.checkFound(ids));
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_gps_visits_candidates',
                name: 'aide_gps_visits_candidates',
                description: 'Caches candidates pour une visite sans code : voisines du jour et, avec ' +
                    'deep=true, déduction de l\'ordre de mes trouvailles (~1 min, réseau). ' +
                    'Rattacher ensuite avec aide_gps_visits_resolve.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    visit_id: { type: 'number', description: 'ID de la visite sans code.', required: true },
                    deep: { type: 'boolean', description: 'Aussi l\'ordre de mes trouvailles (réseau, ~1 min).', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        return ok(await this.gpsVisitsService.candidates(Number(args.visit_id), Boolean(args.deep)));
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_gps_visits_resolve',
                name: 'aide_gps_visits_resolve',
                description: 'Rattache une visite sans code à une géocache (gc_code ; absent = détacher), ' +
                    'ou plusieurs d\'un coup avec items [{visit_id, gc_code, source?}]. ' +
                    'Renvoie l\'état d\'avant (previous) pour aide_gps_visits_restore.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    visit_id: { type: 'number', description: 'ID de la visite (rattachement unitaire).', required: false },
                    gc_code: { type: 'string', description: 'Code GC à rattacher ; absent = détacher la visite.', required: false },
                    source: {
                        type: 'string', required: false,
                        enum: ['neighbours', 'my_finds', 'track', 'manual'],
                        description: 'Origine du rattachement (défaut manual).',
                    },
                    items: {
                        type: 'array', required: false,
                        description: 'Rattachement groupé : [{visit_id, gc_code, source?}] — source : track ou manual.',
                    },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        if (Array.isArray(args.items) && args.items.length) {
                            const items = (args.items as Array<Record<string, unknown>>).map(item => ({
                                visit_id: Number(item.visit_id),
                                gc_code: String(item.gc_code),
                                source: (item.source === 'track' ? 'track' : 'manual') as 'track' | 'manual',
                            })).filter(item => Number.isFinite(item.visit_id) && item.gc_code);
                            if (!items.length) {
                                return err('items invalide : attendu [{visit_id, gc_code, source?}].');
                            }
                            return ok(await this.gpsVisitsService.resolveBatch(items));
                        }
                        const visitId = Number(args.visit_id);
                        if (!Number.isFinite(visitId)) {
                            return err('Fournissez visit_id ou items.');
                        }
                        const gcCode = args.gc_code === undefined || args.gc_code === null ? null : String(args.gc_code);
                        const previous = await this.gpsVisitsService.resolve(
                            visitId, gcCode,
                            (args.source as 'neighbours' | 'my_finds' | 'track' | 'manual') || 'manual'
                        );
                        return ok({ visit_id: visitId, resolved_gc_code: gcCode, previous });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_gps_visits_day_resolution',
                name: 'aide_gps_visits_day_resolution',
                description: 'Propose une cache pour chaque visite sans code d\'un jour, d\'après la ' +
                    'trace du GPS (jusqu\'à une minute). Rattacher avec aide_gps_visits_resolve.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    day: { type: 'string', description: 'Jour au format AAAA-MM-JJ.', required: true },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        return ok(await this.gpsVisitsService.dayResolution(String(args.day)));
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_gps_visits_prepare',
                name: 'aide_gps_visits_prepare',
                description: 'Récapitulatif « Préparer la sortie » pour ces visites : caches déjà dans la ' +
                    'zone, à copier, à créer depuis le GPS ou à télécharger, et visites laissées de côté. ' +
                    'Lecture seule ; lancer ensuite aide_gps_visits_add_to_zone.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    ...visitIdsParam,
                    zone_id: { type: 'number', description: 'Zone de la sortie pour le récapitulatif.', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const ids = (args.visit_ids as unknown[]).map(Number).filter(Number.isFinite);
                        if (!ids.length) {
                            return err('visit_ids requis (liste non vide).');
                        }
                        const zoneId = args.zone_id !== undefined ? Number(args.zone_id) : undefined;
                        return ok(await this.gpsVisitsService.prepare(ids, zoneId));
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_gps_visits_add_to_zone',
                name: 'aide_gps_visits_add_to_zone',
                description: 'Ajoute les caches de ces visites à la zone de la sortie : copie les caches ' +
                    'connues ailleurs et télécharge celles absentes (réseau, annulable avec ' +
                    'aide_gps_visits_zone_operation cancel). Destination : zone_id ou new_zone_name.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    ...visitIdsParam,
                    zone_id: { type: 'number', description: 'ID de la zone de destination existante.', required: false },
                    new_zone_name: { type: 'string', description: 'Nom de la nouvelle zone à créer si pas de zone_id.', required: false },
                }),
                confirmAlwaysAllow: 'Ajouter les caches de ces visites à la zone ? ' +
                    'Des requêtes Geocaching.com seront effectuées pour les caches absentes.',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const ids = (args.visit_ids as unknown[]).map(Number).filter(Number.isFinite);
                        if (!ids.length) {
                            return err('visit_ids requis (liste non vide).');
                        }
                        const zoneId = args.zone_id !== undefined ? Number(args.zone_id) : undefined;
                        const newZoneName = args.new_zone_name ? String(args.new_zone_name).trim() : undefined;
                        if (zoneId === undefined && !newZoneName) {
                            return err('Fournissez zone_id ou new_zone_name.');
                        }
                        if (zoneId !== undefined && !Number.isFinite(zoneId)) {
                            return err('zone_id invalide.');
                        }
                        const operationId = `aide-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
                        const response = await this.gpsVisitsService.startZoneOperation(
                            operationId,
                            zoneId !== undefined ? { zoneId } : { newZoneName: newZoneName! },
                            ids
                        );
                        const { lastMessage, hadError } = await consumeImportStream(response);
                        this.widgetEventsService.requestZonesRefresh();
                        if (hadError) {
                            return err(lastMessage ?? 'Erreur lors de l\'ajout à la zone.');
                        }
                        return ok({ operation_id: operationId, summary: lastMessage });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_gps_visits_zone_operation',
                name: 'aide_gps_visits_zone_operation',
                description: 'État d\'un ajout de visites à une zone (operation_id renvoyé par ' +
                    'aide_gps_visits_add_to_zone), ou cancel=true pour l\'annuler : arrêt entre deux ' +
                    'caches si en cours, retrait des caches ajoutées sinon.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    operation_id: { type: 'string', description: 'ID de l\'opération.', required: true },
                    cancel: { type: 'boolean', description: 'true = annuler l\'ajout.', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const operationId = String(args.operation_id);
                        if (args.cancel) {
                            return ok(await this.gpsVisitsService.cancelZoneOperation(operationId));
                        }
                        return ok(await this.gpsVisitsService.getZoneOperation(operationId));
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
        ];
    }

    // ─── Editeur de logs ────────────────────────────────────────────────────

    /** Résout geocache_ids | gc_codes (ou le couple unitaire) en liste ordonnée d'ids. */
    protected async resolveGeocacheIds(args: Record<string, any>): Promise<number[] | string> {
        const ids: number[] = [];
        if (Array.isArray(args.geocache_ids)) {
            for (const value of args.geocache_ids) {
                const id = Number(value);
                if (Number.isFinite(id) && id > 0) { ids.push(id); }
            }
        }
        if (Array.isArray(args.gc_codes)) {
            for (const rawCode of args.gc_codes) {
                const code = String(rawCode).trim();
                const found = await this.geocachesService.getByCode<Record<string, unknown>>(code);
                const id = Number(found?.['id']);
                if (!Number.isFinite(id) || id <= 0) {
                    return `Aucune géocache trouvée pour le code "${code}".`;
                }
                ids.push(id);
            }
        }
        if (ids.length === 0) {
            try {
                ids.push(await this.resolveGeocacheId(args));
            } catch {
                return 'Fournissez geocache_ids, gc_codes, ou le couple geocache_id / gc_code.';
            }
        }
        return [...new Set(ids)];
    }

    /** ID d'une référence `{geocache_id|gc_code}` (éléments per_cache des logs). */
    protected async resolveGeocacheRefId(ref: Record<string, unknown>): Promise<number | undefined> {
        const direct = Number(ref.geocache_id);
        if (Number.isFinite(direct) && direct > 0) {
            return direct;
        }
        const code = typeof ref.gc_code === 'string' ? ref.gc_code.trim() : '';
        if (!code) {
            return undefined;
        }
        const found = await this.geocachesService.getByCode<Record<string, unknown>>(code);
        const id = Number(found?.['id']);
        return Number.isFinite(id) && id > 0 ? id : undefined;
    }

    /**
     * Contexte de résolution des @patterns : géocaches chargées, types de log
     * assainis, trouvailles du profil (base de @cache_count), patterns perso.
     * Les stats du profil peuvent manquer hors ligne : le compteur démarre alors à 1.
     */
    protected async loadPatternContext(geocacheIds: number[], logType: LogTypeValue, logDate: string): Promise<PatternResolutionContext> {
        const { geocaches, perCacheLogType } = await fetchGeocachesBatch(
            this.apiClient.getBaseUrl(), geocacheIds, {}, logType
        );
        let userFindsCount = 0;
        try {
            userFindsCount = (await fetchUserStats(this.apiClient.getBaseUrl())).findsCount;
        } catch { /* profil indisponible : @cache_count démarre à 1 */ }
        const customPatterns = await loadCustomPatterns(this.storageService, 'geoApp.logs.patterns.v1');
        return { geocaches, perCacheLogType, logType, userFindsCount, logDate, customPatterns };
    }

    /** Lexique géocaching effectif, même règle que l'éditeur (préférences lues à chaque appel). */
    protected getLogLexicon(): LexiconEntry[] {
        if (this.preferenceService.get<boolean>('geoApp.ai.lexicon.enabled', true) === false) {
            return [];
        }
        const entries = this.preferenceService.get<LexiconEntry[]>('geoApp.ai.lexicon.entries', []);
        return resolveLexicon(Array.isArray(entries) ? entries : []);
    }

    /** Langue de traduction par défaut, comme l'éditeur : préférence, sinon première de la liste. */
    protected getDefaultTranslationLanguage(): string {
        const raw = this.preferenceService.get<unknown>('geoApp.logs.translation.languages', undefined);
        const languages = (Array.isArray(raw) ? raw : [])
            .filter((entry): entry is string => typeof entry === 'string')
            .map(entry => entry.trim())
            .filter(entry => entry !== '');
        if (languages.length === 0) {
            return '';
        }
        const preferred = (this.preferenceService.get<string>('geoApp.logs.translation.defaultLanguage', '') || '').trim();
        const match = languages.find(entry => entry.toLowerCase() === preferred.toLowerCase());
        return match ?? languages[0];
    }

    /** Parse le paramètre `trackables` : [{code, action}] → entrées du payload ou message d'erreur. */
    protected parseTrackablesArg(raw: unknown): TrackablePayloadEntry[] | string {
        if (!Array.isArray(raw)) {
            return [];
        }
        const out: TrackablePayloadEntry[] = [];
        for (const item of raw as Array<Record<string, unknown>>) {
            const code = typeof item?.code === 'string' ? item.code.trim() : '';
            const action = item?.action;
            if (!code || (action !== 'none' && action !== 'visit' && action !== 'drop')) {
                return 'trackables invalide : attendu [{code, action: "none"|"visit"|"drop"}].';
            }
            out.push({ code, action });
        }
        return out;
    }

    private buildLogEditorTools(): ToolRequest[] {
        return [
            {
                id: 'aide_open_log_editor',
                name: 'aide_open_log_editor',
                description: 'Ouvre un onglet de l\'éditeur de logs pour ces géocaches (rédaction, ' +
                    'envoi vers Geocaching.com). Un brouillon existant pour le même ensemble est restauré.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    geocache_ids: { type: 'array', description: 'IDs des géocaches, dans l\'ordre des logs.', required: false },
                    gc_codes: { type: 'array', description: 'Codes GC, alternatif à geocache_ids.', required: false },
                    title: { type: 'string', description: 'Titre de l\'onglet.', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const ids = await this.resolveGeocacheIds(args);
                        if (typeof ids === 'string') { return err(ids); }
                        await this.logEditorTabsManager.openLogEditor({
                            geocacheIds: ids,
                            title: args.title ? String(args.title) : undefined,
                        });
                        return ok({ geocache_ids: ids, editor_opened: true });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_draft_log',
                name: 'aide_draft_log',
                description: 'Prépare un brouillon de log puis ouvre l\'éditeur pour relecture et envoi ' +
                    'par l\'utilisateur — jamais d\'envoi direct. text = texte commun ; per_cache pour ' +
                    'des textes/types différents. Les @patterns sont résolus à l\'envoi par l\'éditeur.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    geocache_ids: { type: 'array', description: 'IDs des géocaches, dans l\'ordre des logs.', required: false },
                    gc_codes: { type: 'array', description: 'Codes GC, alternatif à geocache_ids.', required: false },
                    text: {
                        type: 'string', required: true,
                        description: 'Texte commun du log (Markdown ; @patterns autorisés : @date, @cache_count, @gc_code…).',
                    },
                    log_type: {
                        type: 'string', required: false,
                        enum: ['found', 'dnf', 'note', 'skip'],
                        description: 'Type de log par défaut du lot (défaut found).',
                    },
                    date: { type: 'string', description: 'Date de visite YYYY-MM-DD (défaut aujourd\'hui).', required: false },
                    favorite: { type: 'boolean', description: 'Point favori sur les logs « found ».', required: false },
                    per_cache: {
                        type: 'array', required: false,
                        description: 'Par cache : [{geocache_id|gc_code, text?, log_type?, favorite?}].',
                    },
                    trackables: {
                        type: 'array', required: false,
                        description: 'Actions sur les TBs de l\'inventaire : [{code, action: "none"|"visit"|"drop", drop_geocache_id?}].',
                    },
                    title: { type: 'string', description: 'Titre de l\'onglet ouvert.', required: false },
                    open: { type: 'boolean', description: 'Ouvrir l\'éditeur après écriture (défaut true).', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const ids = await this.resolveGeocacheIds(args);
                        if (typeof ids === 'string') { return err(ids); }
                        const { geocaches, missingIds } = await fetchGeocachesBatch(
                            this.apiClient.getBaseUrl(), ids, {}, 'found'
                        );
                        if (geocaches.length === 0) {
                            return err('Aucune géocache trouvée.');
                        }
                        const draftKey = getDraftKey(geocaches.map(gc => gc.id));
                        if (!draftKey) { return err('Aucune géocache.'); }

                        const perCacheText: Record<number, string> = {};
                        const perCacheLogType: Record<number, LogTypeValue> = {};
                        const perCacheFavorite: Record<number, boolean> = {};
                        if (Array.isArray(args.per_cache)) {
                            for (const item of args.per_cache as Array<Record<string, unknown>>) {
                                const refId = await this.resolveGeocacheRefId(item);
                                if (refId === undefined || !geocaches.some(gc => gc.id === refId)) { continue; }
                                if (typeof item.text === 'string') { perCacheText[refId] = item.text; }
                                if (item.log_type === 'found' || item.log_type === 'dnf' || item.log_type === 'note' || item.log_type === 'skip') {
                                    perCacheLogType[refId] = item.log_type;
                                }
                                if (item.favorite === true) { perCacheFavorite[refId] = true; }
                            }
                        }
                        if (args.favorite === true) {
                            for (const gc of geocaches) { perCacheFavorite[gc.id] = true; }
                        }

                        let trackables: LogDraft['trackables'];
                        if (Array.isArray(args.trackables) && args.trackables.length) {
                            const actions: Record<string, 'none' | 'visit' | 'drop'> = {};
                            const dropTargets: Record<string, number> = {};
                            for (const item of args.trackables as Array<Record<string, unknown>>) {
                                const code = typeof item?.code === 'string' ? item.code.trim() : '';
                                const action = item?.action;
                                if (!code || (action !== 'none' && action !== 'visit' && action !== 'drop')) {
                                    return err('trackables invalide : attendu [{code, action: "none"|"visit"|"drop"}].');
                                }
                                actions[code] = action;
                                if (action === 'drop' && item.drop_geocache_id !== undefined) {
                                    dropTargets[code] = Number(item.drop_geocache_id);
                                }
                            }
                            trackables = { actions, dropTargets };
                        }

                        const draft: LogDraft = {
                            version: LOG_DRAFT_VERSION,
                            savedAt: new Date().toISOString(),
                            geocacheIds: geocaches.map(gc => gc.id),
                            logDate: /^\d{4}-\d{2}-\d{2}$/.test(String(args.date ?? '')) ? String(args.date) : todayIsoDate(),
                            logType: (args.log_type as LogTypeValue) || 'found',
                            useSameTextForAll: !Array.isArray(args.per_cache) || args.per_cache.length === 0,
                            globalText: String(args.text),
                            perCacheText,
                            perCacheLogType,
                            perCacheFavorite,
                            perCacheSubmitStatus: {},
                            perCacheSubmitReference: {},
                            trackables,
                        };
                        await persistDraftToStorage(
                            this.storageService, LOG_DRAFTS_STORAGE_KEY, draftKey, draft,
                            90 * 24 * 60 * 60 * 1000, 30
                        );
                        if (args.open !== false) {
                            await this.logEditorTabsManager.resumeLogEditor({
                                geocacheIds: geocaches.map(gc => gc.id),
                                title: args.title ? String(args.title) : undefined,
                            });
                        }
                        return ok({
                            draft_key: draftKey,
                            geocache_ids: geocaches.map(gc => gc.id),
                            missing_ids: missingIds,
                            editor_opened: args.open !== false,
                        });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_submit_log',
                name: 'aide_submit_log',
                description: 'Publie un log sur Geocaching.com pour UNE géocache — ACTION PUBLIQUE ' +
                    'IRRÉVERSIBLE. Les @patterns du texte sont résolus avant envoi ; image_guids vient ' +
                    'de aide_upload_log_image ; trackables = actions sur les TBs de l\'inventaire. ' +
                    'Pour un lot de caches, préférer aide_draft_log (l\'éditeur orchestre l\'envoi).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    geocache_id: { type: 'number', description: 'ID de la géocache (ou gc_code).', required: false },
                    gc_code: { type: 'string', description: 'Code GC, alternatif à geocache_id.', required: false },
                    text: {
                        type: 'string', required: true,
                        description: 'Texte du log (Markdown ; @patterns résolus avant envoi).',
                    },
                    log_type: {
                        type: 'string', required: false,
                        enum: ['found', 'dnf', 'note'],
                        description: 'Type de log (défaut found).',
                    },
                    date: { type: 'string', description: 'Date de visite YYYY-MM-DD (défaut aujourd\'hui).', required: false },
                    favorite: { type: 'boolean', description: 'Point favori (logs « found » seulement).', required: false },
                    image_guids: {
                        type: 'array', required: false,
                        description: 'GUIDs de photos envoyées via aide_upload_log_image.',
                    },
                    trackables: {
                        type: 'array', required: false,
                        description: 'Actions TB : [{code, action: "none"|"visit"|"drop"}] — drop exige un log « found ».',
                    },
                    dry_run: DRY_RUN_PARAM,
                }),
                confirmAlwaysAllow: 'Publier ce log sur Geocaching.com ? Action publique et irréversible.',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const geocacheId = await this.resolveGeocacheId(args);
                        const logType = (args.log_type as LogTypeValue) || 'found';
                        const logDate = /^\d{4}-\d{2}-\d{2}$/.test(String(args.date ?? '')) ? String(args.date) : todayIsoDate();
                        const ctx = await this.loadPatternContext([geocacheId], logType, logDate);
                        const gc = ctx.geocaches[0];
                        if (!gc) { return err('Géocache introuvable.'); }
                        const effectiveType = ctx.perCacheLogType[gc.id] ?? sanitizeLogTypeForGeocache(logType, gc);
                        if (effectiveType === 'skip') {
                            return err(`${gc.gc_code} est déjà trouvée : un nouveau log « found » serait refusé. ` +
                                'Utilisez log_type note ou dnf.');
                        }
                        const trackables = this.parseTrackablesArg(args.trackables);
                        if (typeof trackables === 'string') { return err(trackables); }
                        const imageGuids = Array.isArray(args.image_guids)
                            ? (args.image_guids as unknown[]).map(String).filter(Boolean)
                            : [];
                        const resolvedText = resolveAllPatterns(String(args.text), gc.id, ctx);
                        if (!resolvedText.trim()) { return err('Le texte du log est vide.'); }
                        if (resolvedText.length > GC_LOG_MAX_LENGTH) {
                            return err(`Texte final trop long : ${resolvedText.length} caractères (limite ${GC_LOG_MAX_LENGTH}).`);
                        }
                        const payload: SubmitLogPayload = {
                            text: resolvedText,
                            date: logDate,
                            logType: effectiveType,
                            favorite: effectiveType === 'found' && args.favorite === true,
                        };
                        if (imageGuids.length) { payload.images = imageGuids; }
                        if (trackables.length) { payload.trackables = trackables; }
                        if (args.dry_run) {
                            return this.dryRunOk('submit_log', {
                                geocache_id: gc.id,
                                gc_code: gc.gc_code,
                                resolved_text: resolvedText,
                                payload,
                                consequence: 'Le log serait publié publiquement sur Geocaching.com.',
                            });
                        }
                        const result = await submitOneLog(this.apiClient.getBaseUrl(), gc.id, payload);
                        if (result.ok) {
                            if (typeof window !== 'undefined') {
                                window.dispatchEvent(new CustomEvent('geoapp-geocache-log-submitted', {
                                    detail: {
                                        geocacheId: gc.id,
                                        gcCode: gc.gc_code,
                                        logType: effectiveType,
                                        logDate,
                                        found: effectiveType === 'found',
                                        logReferenceCode: result.logReferenceCode,
                                    },
                                }));
                            }
                            this.widgetEventsService.notifyGeocacheChanged({
                                geocacheId: gc.id, reason: 'log-submitted', source: 'chat',
                            });
                            return ok({
                                submitted: true,
                                geocache_id: gc.id,
                                gc_code: gc.gc_code,
                                log_reference_code: result.logReferenceCode,
                            });
                        }
                        if (result.alreadyLogged) {
                            return err(`Déjà loguée sur Geocaching.com` +
                                `${result.foundDate ? ` (trouvaille du ${result.foundDate})` : ''}.`);
                        }
                        if (result.ambiguous) {
                            return err(`${result.error ?? 'Résultat distant incertain : le log a peut-être été créé.'} ` +
                                'Ne réessayez pas à l\'aveugle : vérifiez la fiche de la cache.');
                        }
                        return err(result.error ?? 'Échec de l\'envoi du log.');
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_upload_log_image',
                name: 'aide_upload_log_image',
                description: 'Envoie une photo sur Geocaching.com pour le log d\'une géocache ' +
                    '(compression côté client). Renvoie image_guid à passer à aide_submit_log : ' +
                    'une photo seule n\'apparaît pas sans log.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    geocache_id: { type: 'number', description: 'ID de la géocache (ou gc_code).', required: false },
                    gc_code: { type: 'string', description: 'Code GC, alternatif à geocache_id.', required: false },
                    file_path: { type: 'string', description: 'Chemin complet du fichier image.', required: true },
                }),
                confirmAlwaysAllow: 'Envoyer cette photo sur Geocaching.com ?',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const geocacheId = await this.resolveGeocacheId(args);
                        if (!this.fileService) {
                            return err('Lecture de fichiers indisponible.');
                        }
                        const uri = URI.fromFilePath(String(args.file_path));
                        const content = await this.fileService.readFile(uri);
                        const file = new File(
                            [new Uint8Array(content.value.buffer)],
                            uri.path.base || 'photo.jpg'
                        );
                        const image: SelectedLogImage = { id: 'aide-1', file, status: 'pending' };
                        const uploaded = await uploadOneLogImage(this.apiClient.getBaseUrl(), geocacheId, image);
                        if (uploaded.status === 'ok' && uploaded.imageGuid) {
                            return ok({ image_guid: uploaded.imageGuid, geocache_id: geocacheId });
                        }
                        return err(uploaded.error ?? 'Échec de l\'envoi de la photo.');
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_report_problem',
                name: 'aide_report_problem',
                description: 'Publie un signalement sur Geocaching.com — ACTION PUBLIQUE, le propriétaire ' +
                    'est prévenu : needsMaintenance, logFull, logWet, damaged, missing, other (tous ' +
                    'Needs Maintenance) ou archive (Needs Archived). text à défaut du texte de la catégorie.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    geocache_id: { type: 'number', description: 'ID de la géocache (ou gc_code).', required: false },
                    gc_code: { type: 'string', description: 'Code GC, alternatif à geocache_id.', required: false },
                    category: {
                        type: 'string', required: true,
                        enum: PROBLEM_CATEGORIES.map(c => c.code),
                        description: 'Catégorie du problème.',
                    },
                    text: {
                        type: 'string', required: false,
                        description: 'Texte du signalement (défaut : texte de la catégorie / préférences).',
                    },
                    date: { type: 'string', description: 'Date du signalement YYYY-MM-DD (défaut aujourd\'hui).', required: false },
                    main_log_type: {
                        type: 'string', required: false,
                        enum: ['found', 'dnf', 'note', 'skip'],
                        description: 'Type du log principal associé (défaut found) — sert aux incompatibilités.',
                    },
                    dry_run: DRY_RUN_PARAM,
                }),
                confirmAlwaysAllow: 'Publier ce signalement sur Geocaching.com ? ' +
                    'Public : le propriétaire de la cache est prévenu.',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const geocacheId = await this.resolveGeocacheId(args);
                        const category = args.category as ProblemCategory;
                        const info = PROBLEM_CATEGORIES.find(c => c.code === category);
                        if (!info) {
                            return err(`Catégorie invalide : ${String(args.category)} ` +
                                `(${PROBLEM_CATEGORIES.map(c => c.code).join(', ')}).`);
                        }
                        const overrides = this.preferenceService.get<Record<string, unknown>>(PROBLEM_TEXTS_PREF, {});
                        const text = args.text ? String(args.text) : defaultProblemText(category, overrides);
                        const logDate = /^\d{4}-\d{2}-\d{2}$/.test(String(args.date ?? '')) ? String(args.date) : todayIsoDate();
                        if (args.dry_run) {
                            return this.dryRunOk('report_problem', {
                                geocache_id: geocacheId,
                                category,
                                log_type: info.logTypeLabel,
                                text,
                                consequence: `Un log « ${info.logTypeLabel} » serait publié ; le propriétaire est prévenu.`,
                            });
                        }
                        const result = await submitProblemReport(this.apiClient.getBaseUrl(), geocacheId, {
                            category,
                            text,
                            date: logDate,
                            mainLogType: (args.main_log_type as LogTypeValue) || 'found',
                        });
                        if (result.status === 'ok') {
                            return ok({
                                submitted: true,
                                geocache_id: geocacheId,
                                log_type: info.logTypeLabel,
                                log_reference_code: result.logReferenceCode,
                            });
                        }
                        if (result.status === 'uncertain') {
                            return err(`${result.error ?? 'Résultat incertain : le signalement a peut-être été créé.'} ` +
                                'Ne réessayez pas à l\'aveugle : vérifiez la fiche de la cache.');
                        }
                        return err(result.error ?? 'Échec de l\'envoi du signalement.');
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_improve_log_text',
                name: 'aide_improve_log_text',
                description: 'Améliore un texte de log par IA : proofread (corrige les fautes, ne ' +
                    'reformule pas) ou rewrite (transforme des notes en texte suivi). Ne rajoute ' +
                    'rien : seules les idées du texte sont reprises ; @patterns et lexique préservés.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    text: { type: 'string', description: 'Texte à améliorer.', required: true },
                    mode: {
                        type: 'string', required: false,
                        enum: ['proofread', 'rewrite'],
                        description: 'proofread (défaut) = correction ; rewrite = rédaction à partir des notes.',
                    },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        if (!this.aiExecutionService) {
                            return err('Service d\'exécution IA indisponible.');
                        }
                        const customPatterns = await loadCustomPatterns(this.storageService, 'geoApp.logs.patterns.v1');
                        const names = buildPatternsIndex(customPatterns).names;
                        const result = await improveLogWithAi(
                            this.aiExecutionService,
                            String(args.text),
                            (args.mode as 'proofread' | 'rewrite') || 'proofread',
                            names,
                            this.getLogLexicon()
                        );
                        if (!result) {
                            return err('L\'IA n\'a renvoyé aucun texte.');
                        }
                        return ok({ text: result.text, lost_patterns: result.lostPatterns });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_translate_log_text',
                name: 'aide_translate_log_text',
                description: 'Traduit un texte de log par IA vers target_language (ou la langue de ' +
                    'traduction configurée : préférences geoApp.logs.translation). mode replace ' +
                    '(défaut) ou bilingual (original + traduction). @patterns et lexique préservés.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    text: { type: 'string', description: 'Texte à traduire.', required: true },
                    target_language: {
                        type: 'string', required: false,
                        description: 'Langue cible (défaut : langue de traduction configurée).',
                    },
                    mode: {
                        type: 'string', required: false,
                        enum: ['replace', 'bilingual'],
                        description: 'replace (défaut) ou bilingual (original conservé avant la traduction).',
                    },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        if (!this.aiExecutionService) {
                            return err('Service d\'exécution IA indisponible.');
                        }
                        const language = args.target_language
                            ? String(args.target_language).trim()
                            : this.getDefaultTranslationLanguage();
                        if (!language) {
                            return err('Aucune langue configurée : target_language ou Préférences → Logs → Traduction.');
                        }
                        const customPatterns = await loadCustomPatterns(this.storageService, 'geoApp.logs.patterns.v1');
                        const names = buildPatternsIndex(customPatterns).names;
                        const mode: LogTranslationMode = args.mode === 'replace' || args.mode === 'bilingual'
                            ? args.mode
                            : this.preferenceService.get<string>('geoApp.logs.translation.mode', 'replace') === 'bilingual'
                                ? 'bilingual'
                                : 'replace';
                        const separator = this.preferenceService.get<string>('geoApp.logs.translation.bilingualSeparator', '---') ?? '---';
                        const addNotice = this.preferenceService.get<boolean>('geoApp.logs.translation.addNotice', true) !== false;
                        const noticeText = this.preferenceService.get<string>(
                            'geoApp.logs.translation.noticeText', DEFAULT_TRANSLATION_NOTICE) ?? DEFAULT_TRANSLATION_NOTICE;
                        const result = await translateLogWithAi(
                            this.aiExecutionService,
                            String(args.text),
                            language,
                            names,
                            mode,
                            separator,
                            addNotice,
                            noticeText,
                            this.getLogLexicon()
                        );
                        if (!result) {
                            return err('L\'IA n\'a renvoyé aucune traduction.');
                        }
                        return ok({
                            text: result.text,
                            target_language: language,
                            lost_patterns: result.lostPatterns,
                            lexicon_deviations: result.lexiconDeviations,
                        });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_resolve_log_text',
                name: 'aide_resolve_log_text',
                description: 'Résout les @patterns d\'un texte de log : aperçu du texte final. ' +
                    '@cache_count est numéroté d\'après le nombre de trouvailles du profil et l\'ordre ' +
                    'des caches du lot (geocache_ids/gc_codes dans l\'ordre, for_geocache_id la cache visée).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    text: { type: 'string', description: 'Texte avec @patterns à résoudre.', required: true },
                    geocache_ids: { type: 'array', description: 'Lot ordonné de caches (numérotation @cache_count).', required: false },
                    gc_codes: { type: 'array', description: 'Codes GC du lot, alternatif.', required: false },
                    for_geocache_id: { type: 'number', description: 'Cache pour laquelle résoudre (défaut : texte global).', required: false },
                    date: { type: 'string', description: 'Date du lot YYYY-MM-DD pour @date (défaut aujourd\'hui).', required: false },
                    log_type: {
                        type: 'string', required: false,
                        enum: ['found', 'dnf', 'note', 'skip'],
                        description: 'Type de log par défaut du lot (défaut found).',
                    },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const ids = await this.resolveGeocacheIds(args);
                        if (typeof ids === 'string') { return err(ids); }
                        const logDate = /^\d{4}-\d{2}-\d{2}$/.test(String(args.date ?? '')) ? String(args.date) : todayIsoDate();
                        const ctx = await this.loadPatternContext(
                            ids, (args.log_type as LogTypeValue) || 'found', logDate
                        );
                        const forId = args.for_geocache_id !== undefined && ctx.geocaches.some(gc => gc.id === Number(args.for_geocache_id))
                            ? Number(args.for_geocache_id)
                            : null;
                        return ok({
                            resolved_text: resolveAllPatterns(String(args.text), forId, ctx),
                            user_finds_count: ctx.userFindsCount,
                            geocache_ids: ctx.geocaches.map(gc => gc.id),
                        });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_list_log_patterns',
                name: 'aide_list_log_patterns',
                description: 'Liste les @patterns utilisables dans les textes de log : intégrés ' +
                    '(@date, @cache_count, @cache_name, @cache_owner, @gc_code, @visit_time) et ' +
                    'personnalisés (nom + contenu).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({}),
                handler: async () => {
                    try {
                        const customPatterns = await loadCustomPatterns(this.storageService, 'geoApp.logs.patterns.v1');
                        const index = buildPatternsIndex(customPatterns);
                        return ok({
                            builtin: index.all.filter(p => p.isBuiltin).map(p => `@${p.name}`),
                            custom: customPatterns.map(p => ({ name: `@${p.name}`, content: p.content })),
                        });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_list_log_drafts',
                name: 'aide_list_log_drafts',
                description: 'Liste les brouillons de l\'éditeur de logs : ensemble de géocaches, ' +
                    'date, type, extrait du texte. Reprendre avec aide_open_log_editor sur les mêmes geocache_ids.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({}),
                handler: async () => {
                    try {
                        const drafts = await readDrafts(this.storageService, LOG_DRAFTS_STORAGE_KEY);
                        return ok(Object.entries(drafts).map(([key, draft]) => ({
                            key,
                            geocache_ids: draft.geocacheIds,
                            saved_at: draft.savedAt,
                            log_date: draft.logDate,
                            log_type: draft.logType,
                            text_excerpt: (draft.globalText || Object.values(draft.perCacheText ?? {})[0] || '').slice(0, 120),
                        })));
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_delete_log_draft',
                name: 'aide_delete_log_draft',
                description: 'Supprime le brouillon de logs associé à cet ensemble de géocaches ' +
                    '(la clé du brouillon est l\'ensemble trié de leurs ids).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    geocache_ids: { type: 'array', description: 'IDs des géocaches du brouillon.', required: false },
                    gc_codes: { type: 'array', description: 'Codes GC, alternatif.', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const ids = await this.resolveGeocacheIds(args);
                        if (typeof ids === 'string') { return err(ids); }
                        const key = getDraftKey(ids);
                        if (!key) { return err('Aucune géocache.'); }
                        const drafts = await readDrafts(this.storageService, LOG_DRAFTS_STORAGE_KEY);
                        if (!(key in drafts)) {
                            return err(`Aucun brouillon pour cet ensemble (${key}).`);
                        }
                        await deleteDraftFromStorage(this.storageService, LOG_DRAFTS_STORAGE_KEY, key);
                        return ok({ deleted: key });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_log_history',
                name: 'aide_log_history',
                description: 'Historique des envois de logs : date, géocaches, type, extrait du texte ' +
                    'et statut par cache (ok/failed/skipped).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    limit: { type: 'number', description: 'Nombre max d\'entrées (défaut 10).', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const history = await loadLogHistory(
                            this.storageService,
                            'geoApp.logs.history.v2',
                            'geoApp.logs.history.v1',
                            () => `aide-${Date.now()}`
                        );
                        const limit = Math.max(1, Math.min(Number(args.limit) || 10, 50));
                        return ok(history.slice(0, limit).map(entry => ({
                            created_at: entry.createdAt,
                            log_date: entry.logDate,
                            log_type: entry.logType,
                            geocache_count: Object.keys(entry.perCacheLogType ?? {}).length
                                || Object.keys(entry.perCacheText ?? {}).length,
                            per_cache_status: entry.perCacheSubmitStatus,
                            text_excerpt: (entry.globalText || '').slice(0, 120),
                        })));
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
        ];
    }

    // ─── Systeme, auth, images et import ──────────────────────────────────────

    private buildSystemAndImportTools(): ToolRequest[] {
        return [
            {
                id: 'aide_get_auth_status',
                name: 'aide_get_auth_status',
                description: 'Retourne l\'état de connexion Geocaching.com (connecté, compte, statistiques).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({}),
                handler: async () => {
                    try {
                        return ok(await this.apiClient.requestJson('/api/auth/status'));
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_open_auth',
                name: 'aide_open_auth',
                description: 'Ouvre le panneau de connexion Geocaching.com.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({}),
                handler: async () => {
                    try {
                        await this.commandService.executeCommand('geoapp.auth.open');
                        return ok('Panneau de connexion ouvert.');
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_open_server_logs',
                name: 'aide_open_server_logs',
                description: 'Ouvre le terminal des logs du serveur backend GeoApp.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({}),
                handler: async () => {
                    try {
                        await this.commandService.executeCommand('geoapp.serverLogs.open');
                        return ok('Terminal des logs serveur ouvert.');
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_open_chat_policy',
                name: 'aide_open_chat_policy',
                description: 'Ouvre la vue « Policy Chat IA » : profils comportementaux, matrice des tools, ' +
                    'skills, modèles et diagnostics. À proposer quand un tool est indisponible ou bloqué.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({}),
                handler: async () => {
                    try {
                        await this.commandService.executeCommand('geoapp.chat.policy.open');
                        return ok('Vue Policy Chat IA ouverte.');
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_list_chat_presets',
                name: 'aide_list_chat_presets',
                description: 'Liste les presets du Chat IA (Découverte, Autonome, Prudent, Hors-ligne) ' +
                    'qui règlent en une fois comportement, prompt pack et skill pack ; Hors-ligne impose aussi le profil modèle local.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({}),
                handler: async () => ok(GEOAPP_CHAT_PRESET_OPTIONS.map(p => ({
                    id: p.id, label: p.label, description: p.description,
                    model_profile: p.modelProfile, behavior: p.behavior, prompt_pack: p.promptPack, skill_pack: p.skillPack,
                }))),
            },
            {
                id: 'aide_apply_chat_preset',
                name: 'aide_apply_chat_preset',
                description: 'Applique un preset du Chat IA (voir aide_list_chat_presets) : règle les préférences ' +
                    'geoApp.chat.behaviorProfile.default, promptPack et skillPack ; Hors-ligne règle aussi geoApp.chat.defaultProfile sur local.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    preset: {
                        type: 'string', required: true,
                        description: 'ID du preset.',
                        enum: GEOAPP_CHAT_PRESET_OPTIONS.map(p => p.id),
                    },
                }),
                confirmAlwaysAllow: 'Appliquer ce preset Chat IA ? Il remplace les réglages comportement/prompt/skills actuels et, pour Hors-ligne, impose aussi le profil modèle local.',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const preset = GEOAPP_CHAT_PRESET_OPTIONS.find(p => p.id === args.preset);
                        if (!preset) { return err(`Preset inconnu : ${args.preset}.`); }
                        const updates = [
                            this.preferenceService.set(GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF, preset.behavior, PreferenceScope.User),
                            this.preferenceService.set(GEOAPP_CHAT_PROMPT_PACK_PREF, preset.promptPack, PreferenceScope.User),
                            this.preferenceService.set(GEOAPP_CHAT_SKILL_PACK_PREF, preset.skillPack, PreferenceScope.User),
                        ];
                        if (preset.modelProfile) {
                            updates.push(this.preferenceService.set(GEOAPP_CHAT_DEFAULT_PROFILE_PREF, preset.modelProfile, PreferenceScope.User));
                        }
                        await Promise.all(updates);
                        return ok(`Preset « ${preset.label} » appliqué (${preset.modelProfile ? `${preset.modelProfile} / ` : ''}${preset.behavior} / ${preset.promptPack} / ${preset.skillPack}).`);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_list_geocache_images',
                name: 'aide_list_geocache_images',
                description: 'Liste les images d\'une géocache (id, url, légende) stockées ou liées à la fiche.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    geocache_id: { type: 'number', description: 'ID de la géocache (ou utiliser gc_code).', required: false },
                    gc_code: { type: 'string', description: 'Code GC, alternatif à geocache_id.', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const geocacheId = await this.resolveGeocacheId(args);
                        const images = await this.apiClient.requestJson<Array<Record<string, unknown>>>(
                            `/api/geocaches/${geocacheId}/images`
                        );
                        return ok({
                            geocache_id: geocacheId,
                            count: images.length,
                            images: images.slice(0, 50).map(img => ({
                                id: img['id'],
                                url: img['url'] ?? img['source_url'],
                                caption: img['caption'] ?? img['name'],
                            })),
                        });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_import_around',
                name: 'aide_import_around',
                description: 'Importe dans GeoApp les géocaches situées autour d\'un point ou d\'une cache ' +
                    '(accès réseau Geocaching.com). Destination : zone existante (zone_id) ou nouvelle zone (new_zone_name).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    gc_code: { type: 'string', description: 'Code GC servant de centre (ex: "GC8ABCD").', required: false },
                    geocache_id: { type: 'number', description: 'ID de la géocache servant de centre.', required: false },
                    latitude: { type: 'number', description: 'Latitude du centre (avec longitude).', required: false },
                    longitude: { type: 'number', description: 'Longitude du centre (avec latitude).', required: false },
                    zone_id: { type: 'number', description: 'ID de la zone de destination existante.', required: false },
                    new_zone_name: { type: 'string', description: 'Nom de la nouvelle zone à créer si pas de zone_id.', required: false },
                    radius_km: { type: 'number', description: 'Rayon de recherche en km (défaut : réglage de l\'app).', required: false },
                    limit: { type: 'number', description: 'Nombre max de caches à importer (défaut 50).', required: false },
                }),
                confirmAlwaysAllow: 'Lancer un import de géocaches depuis Geocaching.com ?',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        let center;
                        if (args.gc_code) {
                            center = { type: 'gc_code' as const, gc_code: String(args.gc_code) };
                        } else if (args.geocache_id) {
                            center = { type: 'geocache_id' as const, geocache_id: Number(args.geocache_id) };
                        } else if (args.latitude !== undefined && args.longitude !== undefined) {
                            center = { type: 'point' as const, lat: Number(args.latitude), lon: Number(args.longitude) };
                        } else {
                            return err('Fournissez un centre : gc_code, geocache_id ou latitude+longitude.');
                        }

                        const zone_id = args.zone_id !== undefined ? Number(args.zone_id) : undefined;
                        const new_zone_name = args.new_zone_name ? String(args.new_zone_name) : undefined;
                        if (zone_id === undefined && !new_zone_name) {
                            return err('Fournissez zone_id ou new_zone_name pour la destination.');
                        }

                        const target = await this.importAroundService.resolveTargetZone(
                            zone_id !== undefined
                                ? { type: 'existing_zone', zone_id }
                                : { type: 'new_zone', name: new_zone_name! }
                        );
                        const summary = await this.importAroundService.run(target.zoneId, {
                            center,
                            target: zone_id !== undefined
                                ? { type: 'existing_zone', zone_id }
                                : { type: 'new_zone', name: new_zone_name! },
                            limit: Math.min(Math.max(Number(args.limit) || 50, 1), 500),
                            radius_km: args.radius_km !== undefined ? Number(args.radius_km) : undefined,
                        });
                        this.widgetEventsService.requestZonesRefresh();
                        this.messageService.info(summary ?? 'Import terminé.');
                        return ok({
                            zone_id: target.zoneId,
                            zone_created: target.created,
                            summary: summary ?? 'Import terminé.',
                        });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
        ];
    }

    // ─── Imports de geocaches (GPX, Bookmark List, Pocket Query) ────────────

    /**
     * Destination commune des imports : zone existante (zone_id) ou nouvelle
     * zone (new_zone_name), resolue — et creee le cas echeant — par le service
     * partage de l'import « autour de… ». Un dossier n'est pas une destination
     * valide : il faut l'id d'une de ses zones membres.
     */
    protected async resolveImportZone(args: Record<string, any>): Promise<ResolvedImportAroundZone | string> {
        const zoneId = args.zone_id !== undefined ? Number(args.zone_id) : undefined;
        const newZoneName = args.new_zone_name ? String(args.new_zone_name).trim() : undefined;
        if (zoneId === undefined && !newZoneName) {
            return 'Fournissez zone_id ou new_zone_name pour la destination.';
        }
        if (zoneId !== undefined) {
            const zone = await this.zonesService.get(zoneId);
            if (zone?.is_folder) {
                const members = (zone.zone_ids ?? []).join(', ');
                return `La zone ${zoneId} est un dossier : un import vise une zone membre` +
                    (members ? ` (ids : ${members}).` : ' (dossier vide — aucune zone membre).');
            }
            return this.importAroundService.resolveTargetZone({ type: 'existing_zone', zone_id: zoneId });
        }
        return this.importAroundService.resolveTargetZone({ type: 'new_zone', name: newZoneName! });
    }

    /** Consomme le flux NDJSON d'un import puis applique les effets communs. */
    protected async finishGeocacheImport(target: ResolvedImportAroundZone, response: Response): Promise<string> {
        const { lastMessage, hadError } = await consumeImportStream(response);
        this.widgetEventsService.requestZonesRefresh();
        if (hadError) {
            return err(lastMessage ?? 'Erreur lors de l\'import.');
        }
        const summary = lastMessage ?? 'Import terminé.';
        this.messageService.info(summary);
        return ok({ zone_id: target.zoneId, zone_created: target.created, summary });
    }

    private buildImportTools(): ToolRequest[] {
        const zoneParams = {
            zone_id: { type: 'number', description: 'ID de la zone de destination existante.', required: false },
            new_zone_name: { type: 'string', description: 'Nom de la nouvelle zone à créer si pas de zone_id.', required: false },
            update_existing: {
                type: 'boolean',
                description: 'true = rafraîchit les géocaches déjà présentes dans la zone ' +
                    '(coordonnées résolues et notes personnelles préservées).',
                required: false,
            },
        };
        return [
            {
                id: 'aide_list_bookmark_lists',
                name: 'aide_list_bookmark_lists',
                description: 'Liste les Bookmark Lists du compte Geocaching.com (code, nom, nombre de caches). ' +
                    'Le code sert d\'argument à aide_import_bookmark_list. Accès réseau Geocaching.com.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({}),
                handler: async () => {
                    try {
                        return ok(await this.geocachesService.listUserBookmarkLists());
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_list_pocket_queries',
                name: 'aide_list_pocket_queries',
                description: 'Liste les Pocket Queries du compte Geocaching.com (guid, nom, nombre de caches). ' +
                    'Le guid sert de pq_code à aide_import_pocket_query. Accès réseau Geocaching.com.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({}),
                handler: async () => {
                    try {
                        return ok(await this.geocachesService.listUserPocketQueries());
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_import_bookmark_list',
                name: 'aide_import_bookmark_list',
                description: 'Importe dans une zone les géocaches d\'une Bookmark List Geocaching.com ' +
                    '(accès réseau). bookmark_code via aide_list_bookmark_lists. ' +
                    'Destination : zone_id ou new_zone_name.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    bookmark_code: { type: 'string', description: 'Code de la Bookmark List, via aide_list_bookmark_lists.', required: true },
                    ...zoneParams,
                }),
                confirmAlwaysAllow: 'Importer les géocaches de cette Bookmark List depuis Geocaching.com ?',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const target = await this.resolveImportZone(args);
                        if (typeof target === 'string') { return err(target); }
                        const response = await this.geocachesService.importBookmarkList(
                            String(args.bookmark_code), target.zoneId, Boolean(args.update_existing));
                        return await this.finishGeocacheImport(target, response);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_import_pocket_query',
                name: 'aide_import_pocket_query',
                description: 'Importe dans une zone les géocaches d\'une Pocket Query Geocaching.com ' +
                    '(accès réseau). pq_code = guid via aide_list_pocket_queries. ' +
                    'Destination : zone_id ou new_zone_name.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    pq_code: { type: 'string', description: 'GUID de la Pocket Query, via aide_list_pocket_queries.', required: true },
                    ...zoneParams,
                }),
                confirmAlwaysAllow: 'Importer les géocaches de cette Pocket Query depuis Geocaching.com ?',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const target = await this.resolveImportZone(args);
                        if (typeof target === 'string') { return err(target); }
                        const response = await this.geocachesService.importPocketQuery(
                            String(args.pq_code), target.zoneId, Boolean(args.update_existing));
                        return await this.finishGeocacheImport(target, response);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_import_gpx',
                name: 'aide_import_gpx',
                description: 'Importe des géocaches depuis un fichier GPX ou ZIP local (Pocket Query téléchargée). ' +
                    'file_path = chemin complet du fichier ; sans file_path, ouvre le dialogue d\'import ' +
                    'de la zone cible pour un choix manuel. Destination : zone_id ou new_zone_name.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    file_path: {
                        type: 'string',
                        description: 'Chemin complet du fichier .gpx ou .zip. Absent = ouvre le dialogue d\'import de la zone.',
                        required: false,
                    },
                    ...zoneParams,
                }),
                confirmAlwaysAllow: 'Importer les géocaches de ce fichier GPX ?',
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const target = await this.resolveImportZone(args);
                        if (typeof target === 'string') { return err(target); }
                        const filePath = args.file_path ? String(args.file_path).trim() : '';
                        if (!filePath) {
                            await this.zoneTabsManager.openZone({ zoneId: target.zoneId, zoneName: target.name });
                            this.widgetEventsService.requestOpenImportDialog({ kind: 'gpx', zoneId: target.zoneId });
                            return ok({ zone_id: target.zoneId, zone_created: target.created, dialog_opened: 'gpx' });
                        }
                        if (!/\.(gpx|zip)$/i.test(filePath)) {
                            return err('Le fichier doit être un .gpx ou un .zip.');
                        }
                        if (!this.fileService) {
                            return err('Lecture de fichiers indisponible : relancez sans file_path pour ouvrir le dialogue.');
                        }
                        const uri = URI.fromFilePath(filePath);
                        const content = await this.fileService.readFile(uri);
                        const file = new File([new Uint8Array(content.value.buffer)], uri.path.base || 'import.gpx');
                        const response = await this.geocachesService.importGpx(file, target.zoneId, Boolean(args.update_existing));
                        return await this.finishGeocacheImport(target, response);
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
        ];
    }

    // ─── Modeles IA par agent ─────────────────────────────────────────────────

    /**
     * Resout un agent par id ou par nom (« EarthCoach », « @EarthCoach »), sans
     * tenir compte de la casse ; une correspondance partielle n'est retenue que
     * si elle est unique.
     */
    protected resolveAgent(query: string): Agent | string {
        const needle = String(query ?? '').trim().replace(/^@/, '').toLowerCase();
        if (!needle) { return 'Parametre "agent" vide.'; }
        const agents = this.agentService.getAllAgents();
        const label = (agent: Agent) => (agent.name || '').replace(/^@/, '').toLowerCase();
        const exact = agents.find(agent => agent.id.toLowerCase() === needle || label(agent) === needle);
        if (exact) { return exact; }
        const partial = agents.filter(agent => agent.id.toLowerCase().includes(needle) || label(agent).includes(needle));
        if (partial.length === 1) { return partial[0]; }
        if (partial.length > 1) {
            return `Agent ambigu « ${query} » : ${partial.map(agent => `${agent.name} (${agent.id})`).join(', ')}.`;
        }
        return `Agent introuvable : « ${query} ». Utilisez aide_get_agent_models sans parametre pour la liste.`;
    }

    protected getLocalModelPreferences(): GeoAppLocalModelPreferences {
        return {
            ollamaHost: this.preferenceService.get<string>('ai-features.ollama.ollamaHost', 'http://localhost:11434'),
            lmstudioBaseUrl: this.preferenceService.get<string>('geoApp.ocr.lmstudio.baseUrl', 'http://localhost:1234'),
            openAiCustomModels: this.preferenceService.get('ai-features.openAiCustom.customOpenAiModels', []),
            vercelCustomModels: this.preferenceService.get('ai-features.vercelAi.customModels', []),
            localModelIds: this.preferenceService.get(GEOAPP_LOCAL_MODEL_IDS_PREF, []),
        };
    }

    /** Modele OpenRouter reel derriere un slot GeoApp (openrouter/strong -> anthropic/...). */
    protected describeOpenRouterSlot(modelId: string | undefined): { underlying_model?: string; underlying_model_preference?: string } {
        const preferenceKey = modelId ? OPENROUTER_SLOT_PREFS[modelId] : undefined;
        if (!preferenceKey) { return {}; }
        const value = this.preferenceService.get<string>(preferenceKey, '');
        return { underlying_model: value ? String(value) : undefined, underlying_model_preference: preferenceKey };
    }

    protected async describeAgentModels(agent: Agent): Promise<Record<string, unknown>> {
        const userRequirements = (await this.aiSettingsService.getAgentSettings(agent.id))?.languageModelRequirements ?? [];
        const requirements = await Promise.all(agent.languageModelRequirements.map(async requirement => {
            const override = userRequirements.find(entry => entry.purpose === requirement.purpose);
            let resolved: string | undefined;
            let localCheck: ReturnType<typeof checkGeoAppLocalModel> | undefined;
            try {
                const model = await this.languageModelRegistry.selectLanguageModel({ agent: agent.id, ...requirement });
                resolved = model?.id;
                if (model && isGeoAppStrictLocalAgent(agent.id)) {
                    localCheck = checkGeoAppLocalModel(model, this.getLocalModelPreferences());
                }
            } catch {
                resolved = undefined;
            }
            return {
                purpose: requirement.purpose,
                default_identifier: requirement.identifier,
                user_identifier: override?.identifier,
                effective_identifier: override?.identifier ?? requirement.identifier,
                resolved_model_id: resolved,
                ...(localCheck ? {
                    local_status: localCheck.status,
                    local_reason: localCheck.reason,
                } : {}),
                ...this.describeOpenRouterSlot(resolved),
            };
        }));
        const description: Record<string, unknown> = { id: agent.id, name: agent.name, requirements };
        const taskResolutions = await this.aiModelResolutionService?.resolveForAgent(agent.id) ?? [];
        if (taskResolutions.length) {
            description.task_resolutions = taskResolutions;
            const taskIds = new Set(taskResolutions.map(resolution => resolution.taskId));
            const recentExecutions = [
                ...this.aiExecutionService?.getRunningExecutions() ?? [],
                ...this.aiExecutionService?.getRecentExecutions() ?? [],
            ]
                .filter(execution => taskIds.has(execution.taskId))
                .slice(0, 5);
            if (recentExecutions.length) {
                description.recent_executions = recentExecutions;
            }
        }
        if (agent.id === 'geoapp-ocr') {
            const pluginProvider = this.preferenceService.get<string>('geoApp.ocr.visionProvider', 'lmstudio') === 'openrouter'
                ? 'openrouter'
                : 'lmstudio';
            description.execution = {
                path: 'Theia LanguageModelService',
                controlled_by: 'agent geoapp-ocr / purpose vision-ocr',
                related_plugin_execution: {
                    path: 'POST /api/plugins/vision_ocr/execute',
                    provider_model: formatGeocacheVisionPluginModel(
                        pluginProvider,
                        this.preferenceService.get<string>('geoApp.ocr.lmstudio.model', ''),
                        this.preferenceService.get<string>('geoApp.ocr.openRouter.model', 'openai/gpt-4o-mini')
                    ),
                    note: 'Le plugin vision_ocr et les workflows backend utilisent geoApp.ocr.*; ils ne sont pas pilotés par cette affectation Theia.',
                },
            };
        }
        if (agent.id === GEOAPP_AI_SCORER_AGENT_ID && this.aiScorerModelResolver) {
            try {
                const runtime = await this.aiScorerModelResolver.resolveForRequest({});
                description.execution = {
                    path: 'POST /api/plugins/ai-score',
                    provider: runtime.provider,
                    base_url: runtime.base_url,
                    model: runtime.model,
                    source: runtime.source,
                    source_label: runtime.sourceLabel,
                    theia_model_id: runtime.theiaModelId,
                    assigned_identifier: runtime.assignedIdentifier,
                };
            } catch (error) {
                description.execution = {
                    path: 'POST /api/plugins/ai-score',
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        }
        return description;
    }

    private buildAiModelTools(): ToolRequest[] {
        return [
            {
                id: 'aide_list_ai_models',
                name: 'aide_list_ai_models',
                description: 'Liste les modeles de langage enregistres (id, fournisseur, statut ready/unavailable) et les alias ' +
                    '(ex. default/universal). Pour les slots OpenRouter GeoApp (openrouter/fast, strong, web, vision), ' +
                    'indique le modele OpenRouter reel et la preference qui le definit.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({}),
                handler: async () => {
                    try {
                        const models = await this.languageModelRegistry.getLanguageModels();
                        await this.languageModelAliasRegistry.ready;
                        return ok({
                            models: models.map(model => ({
                                id: model.id,
                                name: model.name,
                                vendor: model.vendor,
                                status: model.status?.status,
                                ...this.describeOpenRouterSlot(model.id),
                            })),
                            aliases: this.languageModelAliasRegistry.getAliases().map(alias => ({
                                id: alias.id,
                                description: alias.description,
                                resolves_to: this.languageModelAliasRegistry.resolveAlias(alias.id) ?? [],
                            })),
                        });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_get_agent_models',
                name: 'aide_get_agent_models',
                description: 'Indique quel modele utilise chaque agent IA (EarthCoach, GeoApp, Aide, OCR, traduction...) : ' +
                    'valeur par defaut, choix de l\'utilisateur et modele effectivement resolu. Pour les agents strictement locaux, ajoute local_status/local_reason. Sans "agent", liste tous les agents.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    agent: { type: 'string', description: 'Id ou nom de l\'agent (ex: "earthcoach", "@EarthCoach"). Optionnel.', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        if (args.agent) {
                            const agent = this.resolveAgent(args.agent);
                            if (typeof agent === 'string') { return err(agent); }
                            return ok(await this.describeAgentModels(agent));
                        }
                        const agents = this.agentService.getAllAgents().filter(agent => agent.languageModelRequirements.length > 0);
                        return ok(await Promise.all(agents.map(agent => this.describeAgentModels(agent))));
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_set_agent_model',
                name: 'aide_set_agent_model',
                description: 'Attribue un modele de langage a un agent IA (meme reglage que la vue Configuration IA > Agents). ' +
                    'model_id = id d\'un modele ou d\'un alias (voir aide_list_ai_models). reset=true rend a l\'agent son modele par defaut.',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({
                    agent: { type: 'string', description: 'Id ou nom de l\'agent (ex: "earthcoach", "@EarthCoach").', required: true },
                    model_id: { type: 'string', description: 'Id du modele ou de l\'alias (ex: "openrouter/strong").', required: false },
                    purpose: { type: 'string', description: 'Usage du modele pour l\'agent (defaut : son unique usage, sinon "chat").', required: false },
                    reset: { type: 'boolean', description: 'Supprime le choix utilisateur et revient au modele par defaut de l\'agent.', required: false },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    try {
                        const agent = this.resolveAgent(args.agent);
                        if (typeof agent === 'string') { return err(agent); }

                        const purposes = agent.languageModelRequirements.map(requirement => requirement.purpose);
                        if (!purposes.length) { return err(`L'agent ${agent.name} n'utilise pas de modele de langage.`); }
                        const purpose = args.purpose
                            ? String(args.purpose)
                            : purposes.length === 1 ? purposes[0] : purposes.includes('chat') ? 'chat' : undefined;
                        if (!purpose || !purposes.includes(purpose)) {
                            return err(`Usage a preciser pour ${agent.name} : ${purposes.join(', ')}.`);
                        }

                        const reset = args.reset === true;
                        const modelId = String(args.model_id ?? '').trim();
                        if (!reset && !modelId) { return err('Fournissez model_id, ou reset=true.'); }
                        if (!reset) {
                            const models = await this.languageModelRegistry.getLanguageModels();
                            await this.languageModelAliasRegistry.ready;
                            const known = models.some(model => model.id === modelId)
                                || this.languageModelAliasRegistry.getAliases().some(alias => alias.id === modelId);
                            if (!known) {
                                return err(`Modele ou alias inconnu : « ${modelId} ». Utilisez aide_list_ai_models pour les ids valides.`);
                            }
                        }

                        const current = (await this.aiSettingsService.getAgentSettings(agent.id))?.languageModelRequirements ?? [];
                        const previous = current.find(entry => entry.purpose === purpose)?.identifier;
                        const next: LanguageModelRequirement[] = current.filter(entry => entry.purpose !== purpose);
                        if (!reset) { next.push({ purpose, identifier: modelId }); }
                        await this.aiSettingsService.updateAgentSettings(agent.id, {
                            languageModelRequirements: next.length ? next : undefined,
                        });

                        const description = await this.describeAgentModels(agent);
                        const requirement = (description.requirements as Array<Record<string, unknown>>)
                            .find(entry => entry.purpose === purpose);
                        const resolved = requirement?.resolved_model_id as string | undefined;
                        const execution = description.execution as Record<string, unknown> | undefined;
                        const executionError = typeof execution?.error === 'string' ? execution.error : undefined;
                        if (agent.id === GEOAPP_AI_SCORER_AGENT_ID) {
                            if (executionError) {
                                this.messageService.warn(`${agent.name} : ${executionError}`);
                            } else if (execution?.provider && execution?.model) {
                                this.messageService.info(`${agent.name} utilisera ${execution.provider}/${execution.model} pour le scoring.`);
                            } else {
                                this.messageService.info(`${agent.name} utilisera la configuration GeoApp AI Scorer.`);
                            }
                        } else {
                            this.messageService.info(reset
                                ? `${agent.name} : modele par defaut retabli.`
                                : `${agent.name} utilise maintenant ${modelId}.`);
                        }
                        return ok({
                            agent: agent.id,
                            purpose,
                            previous_identifier: previous,
                            identifier: reset ? undefined : modelId,
                            resolved_model_id: resolved,
                            ...this.describeOpenRouterSlot(resolved),
                            execution,
                            warning: resolved || agent.id === GEOAPP_AI_SCORER_AGENT_ID
                                ? executionError
                                : 'Aucun modele pret pour ce choix (cle API absente ou fournisseur indisponible).',
                        });
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
            {
                id: 'aide_open_ai_configuration',
                name: 'aide_open_ai_configuration',
                description: 'Ouvre la vue Configuration IA de Theia (agents, modeles, alias, prompts).',
                providerName: DocActionToolsManager.PROVIDER_NAME,
                parameters: buildParams({}),
                handler: async () => {
                    try {
                        await this.commandService.executeCommand('aiConfiguration:open');
                        return ok('Vue Configuration IA ouverte.');
                    } catch (e: any) { return err(e?.message ?? String(e)); }
                },
            },
        ];
    }
}
