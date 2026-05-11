import { injectable, inject } from '@theia/core/shared/inversify';
import { MessageService } from '@theia/core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import {
    ToolInvocationRegistry,
    ToolRequest,
    ToolRequestParameters,
    ToolRequestParametersProperties,
    ToolRequestParameterProperty,
    ToolCallResult
} from '@theia/ai-core';
import {
    PluginsService,
    Plugin,
    PluginDetails,
    PluginSchema,
    PluginResult,
    MetasolverRecommendationResponse,
    ListingClassificationResponse,
    ResolutionWorkflowResponse,
    ResolutionWorkflowStepRunResponse
} from '../common/plugin-protocol';

/**
 * Enregistre dynamiquement chaque plugin MysterAI comme Tool IA.
 */
@injectable()
export class PluginToolsManager implements FrontendApplicationContribution {

    static readonly PROVIDER_NAME = 'geoapp.plugins';

    @inject(PluginsService)
    protected readonly pluginsService!: PluginsService;

    @inject(ToolInvocationRegistry)
    protected readonly toolRegistry!: ToolInvocationRegistry;

    @inject(MessageService)
    protected readonly messages!: MessageService;

    protected isRefreshing = false;

    async onStart(): Promise<void> {
        console.log('[PluginTools] Initialisation du gestionnaire de tools IA...');
        await this.refreshTools({ silent: true });
        console.log('[PluginTools] Gestionnaire de tools IA initialisé');
    }

    /**
     * Rafraîchit l'ensemble des tools exposés à l'IA.
     */
    async refreshTools(options?: { silent?: boolean }): Promise<void> {
        if (this.isRefreshing) {
            return;
        }
        this.isRefreshing = true;
        try {
            this.toolRegistry.unregisterAllTools(PluginToolsManager.PROVIDER_NAME);

            const plugins = await this.pluginsService.listPlugins({ enabled: true });
            const toolRequests = await Promise.all(
                plugins
                    .filter((plugin: Plugin) => plugin.enabled !== false)
                    .map((plugin: Plugin) => this.toToolRequest(plugin))
            );
            toolRequests.unshift(this.createWorkflowStepRunnerTool());
            toolRequests.unshift(this.createWorkflowResolutionTool());
            toolRequests.unshift(this.createListingClassificationTool());
            toolRequests.unshift(this.createMetasolverRecommendationTool());

            const registeredTools = [];
            for (const tool of toolRequests) {
                if (tool) {
                    this.toolRegistry.registerTool(tool);
                    registeredTools.push(tool.name);
                    console.log(`[PluginTools] Tool enregistré: ${tool.name} (${tool.id})`);
                }
            }

            const totalTools = registeredTools.length;
            console.log(`[PluginTools] ${totalTools} tools IA synchronisés:`, registeredTools);

            if (!options?.silent) {
                this.messages.info(`Tools IA synchronisés (${totalTools})`);
            }
        } catch (error) {
            console.error('[PluginTools] Impossible de synchroniser les tools IA', error);
            if (!options?.silent) {
                this.messages.error('Impossible de synchroniser les tools IA (voir console)');
            }
        } finally {
            this.isRefreshing = false;
        }
    }

    /**
     * Transforme un plugin en ToolRequest utilisable par le Chat.
     */
    protected async toToolRequest(plugin: Plugin): Promise<ToolRequest | undefined> {
        try {
            const details = await this.resolvePluginDetails(plugin);
            const parameters = this.buildParameters(details.input_schema);

            return {
                id: `plugin.${details.name}`,
                name: details.name,
                description: this.buildDescription(details),
                providerName: PluginToolsManager.PROVIDER_NAME,
                parameters,
                handler: async (argString: string) => this.executePlugin(details.name, argString)
            };
        } catch (error) {
            console.error(`[PluginTools] Tool non enregistré pour ${plugin.name}`, error);
            return undefined;
        }
    }

    protected async resolvePluginDetails(plugin: Plugin): Promise<PluginDetails> {
        if (this.hasUsableSchema(plugin.input_schema)) {
            return plugin as PluginDetails;
        }
        return this.pluginsService.getPlugin(plugin.name);
    }

    protected buildDescription(plugin: Plugin): string {
        const parts = [
            plugin.description?.trim(),
            plugin.category ? `Catégorie: ${plugin.category}` : undefined,
            plugin.heavy_cpu ? '⚠️ Consommation CPU élevée' : undefined,
            plugin.needs_network ? '⚠️ Nécessite un accès réseau' : undefined
        ].filter(Boolean);
        return parts.join(' • ') || `Plugin ${plugin.name}`;
    }

    protected buildParameters(schema?: PluginSchema): ToolRequestParameters {
        if (this.hasUsableSchema(schema)) {
            return {
                type: 'object',
                properties: this.normalizeProperties(schema!.properties!),
                required: Array.isArray(schema!.required) ? schema!.required!.slice() : [],
                additionalProperties: false,
            } as ToolRequestParameters;
        }
        return this.defaultParameters();
    }

    protected normalizeProperties(properties: Record<string, any>): ToolRequestParametersProperties {
        const normalized: ToolRequestParametersProperties = {};
        Object.entries(properties).forEach(([key, value]) => {
            normalized[key] = this.normalizeProperty(value);
        });
        return normalized;
    }

    protected normalizeProperty(value: any): ToolRequestParameterProperty {
        if (!value || typeof value !== 'object') {
            return { type: 'string' };
        }

        const clone: ToolRequestParameterProperty = { ...value };
        const allowedTypes = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);

        if (clone.anyOf && Array.isArray(clone.anyOf)) {
            clone.anyOf = clone.anyOf.map(entry => this.normalizeProperty(entry));
        }

        if (clone.properties && typeof clone.properties === 'object') {
            clone.properties = this.normalizeProperties(clone.properties as Record<string, any>);
        }

        if (clone.items && typeof clone.items === 'object') {
            clone.items = this.normalizeProperty(clone.items);
        }

        if (clone.type) {
            clone.type = allowedTypes.has(clone.type) ? clone.type : 'string';
        } else if (!clone.anyOf) {
            clone.type = 'string';
        }

        if (clone.type === 'object' && clone.additionalProperties === undefined) {
            clone.additionalProperties = false;
        }

        return clone;
    }

    protected hasUsableSchema(schema?: PluginSchema): schema is PluginSchema {
        return !!(schema && schema.properties && Object.keys(schema.properties).length > 0);
    }

    protected defaultParameters(): ToolRequestParameters {
        return {
            type: 'object',
            properties: {
                text: {
                    type: 'string',
                    description: 'Texte ou donnees a transmettre au plugin.'
                }
            },
            additionalProperties: false,
        } as ToolRequestParameters;
    }

    protected workflowControlParameterSchema(): ToolRequestParameterProperty {
        return {
            type: 'object',
            additionalProperties: false,
            properties: {
                budget: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        max_automated_steps: { type: 'number' },
                        max_metasolver_runs: { type: 'number' },
                        max_search_questions: { type: 'number' },
                        max_checker_runs: { type: 'number' },
                        max_coordinate_calculations: { type: 'number' },
                        max_vision_ocr_runs: { type: 'number' },
                        stop_on_checker_success: { type: 'boolean' },
                    }
                },
                usage: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        automated_steps: { type: 'number' },
                        metasolver_runs: { type: 'number' },
                        search_questions: { type: 'number' },
                        checker_runs: { type: 'number' },
                        coordinate_calculations: { type: 'number' },
                        vision_ocr_runs: { type: 'number' },
                    }
                }
            }
        };
    }

    protected createMetasolverRecommendationTool(): ToolRequest {
        return {
            id: 'geoapp.plugins.metasolver.recommend',
            name: 'recommend_metasolver_plugins',
            description: 'Analyse un texte de type code secret et recommande une sous-liste de plugins metasolver avec signature d’entrée, scores et plugin_list prête à l’emploi.',
            providerName: PluginToolsManager.PROVIDER_NAME,
            parameters: {
                type: 'object',
                properties: {
                    text: {
                        type: 'string',
                        description: 'Texte à analyser pour recommander les plugins metasolver.'
                    },
                    preset: {
                        type: 'string',
                        description: 'Preset metasolver optionnel (ex: "all", "letters_only", "digits_only").'
                    },
                    mode: {
                        type: 'string',
                        description: 'Mode metasolver: "decode" ou "detect".'
                    },
                    max_plugins: {
                        type: 'number',
                        description: 'Nombre maximum de plugins à recommander.'
                    }
                },
                required: ['text'],
                additionalProperties: false
            } as ToolRequestParameters,
            handler: async (argString: string) => this.recommendMetasolverPlugins(argString)
        };
    }

    protected createListingClassificationTool(): ToolRequest {
        return {
            id: 'geoapp.plugins.listing.classify',
            name: 'classify_geocache_listing',
            description: 'Classifie un listing de geocache en plusieurs familles d enigmes, extrait les fragments de code probables et suggere les prochaines actions.',
            providerName: PluginToolsManager.PROVIDER_NAME,
            parameters: {
                type: 'object',
                properties: {
                    geocache_id: {
                        type: 'number',
                        description: 'ID de la geocache a classifier. Si fourni, le backend recharge le listing, le hint, les images, waypoints et checkers.'
                    },
                    title: {
                        type: 'string',
                        description: 'Titre du listing si geocache_id n est pas fourni.'
                    },
                    description: {
                        type: 'string',
                        description: 'Description textuelle du listing.'
                    },
                    description_html: {
                        type: 'string',
                        description: 'HTML brut du listing pour detecter du contenu cache.'
                    },
                    hint: {
                        type: 'string',
                        description: 'Hint ou indice du listing.'
                    },
                    images: {
                        ...this.imageInputArrayParameterSchema(),
                        description: 'Liste optionnelle d images explicites a analyser si geocache_id n est pas fourni.'
                    },
                    max_secret_fragments: {
                        type: 'number',
                        description: 'Nombre maximum de fragments de code a retourner.'
                    }
                },
                additionalProperties: false
            } as ToolRequestParameters,
            handler: async (argString: string) => this.classifyListing(argString)
        };
    }

    protected createWorkflowResolutionTool(): ToolRequest {
        return {
            id: 'geoapp.plugins.workflow.resolve',
            name: 'resolve_geocache_workflow',
            description: 'Orchestre l analyse initiale d une geocache: classification, choix du workflow principal, plan d execution et pre-analyse deterministic du workflow secret_code ou formula, avec plugin direct si un decodeur tres specifique ressort nettement.',
            providerName: PluginToolsManager.PROVIDER_NAME,
            parameters: {
                type: 'object',
                properties: {
                    geocache_id: {
                        type: 'number',
                        description: 'ID de la geocache a analyser. Recommande quand disponible.'
                    },
                    title: {
                        type: 'string',
                        description: 'Titre du listing si geocache_id n est pas fourni.'
                    },
                    description: {
                        type: 'string',
                        description: 'Description textuelle du listing.'
                    },
                    description_html: {
                        type: 'string',
                        description: 'HTML brut du listing pour le contenu cache.'
                    },
                    hint: {
                        type: 'string',
                        description: 'Hint ou indice du listing.'
                    },
                    images: {
                        ...this.imageInputArrayParameterSchema(),
                        description: 'Liste optionnelle d images explicites a analyser si geocache_id n est pas fourni.'
                    },
                    preferred_workflow: {
                        type: 'string',
                        description: 'Workflow force optionnel: general, secret_code, formula, checker, hidden_content, image_puzzle, coord_transform.'
                    },
                    auto_execute: {
                        type: 'boolean',
                        description: 'Execute d abord le plugin direct s il est suffisamment fiable pour secret_code, sinon le metasolver.'
                    },
                    max_secret_fragments: {
                        type: 'number',
                        description: 'Nombre maximum de fragments secrets a extraire.'
                    },
                    max_plugins: {
                        type: 'number',
                        description: 'Nombre maximum de plugins metasolver recommandes.'
                    },
                    workflow_control: {
                        ...this.workflowControlParameterSchema(),
                        description: 'Etat de controle precedent du workflow pour conserver les budgets et compteurs entre plusieurs appels.'
                    }
                },
                additionalProperties: false
            } as ToolRequestParameters,
            handler: async (argString: string) => this.resolveWorkflow(argString)
        };
    }

    protected createWorkflowStepRunnerTool(): ToolRequest {
        return {
            id: 'geoapp.plugins.workflow.run-step',
            name: 'run_geocache_workflow_step',
            description: 'Execute la prochaine etape automatisable du workflow GeoApp, ou une etape ciblee comme inspect-hidden-html, inspect-images, execute-direct-plugin, execute-metasolver, search-answers, calculate-final-coordinates ou validate-with-checker.',
            providerName: PluginToolsManager.PROVIDER_NAME,
            parameters: {
                type: 'object',
                properties: {
                    geocache_id: {
                        type: 'number',
                        description: 'ID de la geocache a analyser. Recommande quand disponible.'
                    },
                    title: {
                        type: 'string',
                        description: 'Titre du listing si geocache_id n est pas fourni.'
                    },
                    description: {
                        type: 'string',
                        description: 'Description textuelle du listing.'
                    },
                    description_html: {
                        type: 'string',
                        description: 'HTML brut du listing pour le contenu cache.'
                    },
                    hint: {
                        type: 'string',
                        description: 'Hint ou indice du listing.'
                    },
                    images: {
                        ...this.imageInputArrayParameterSchema(),
                        description: 'Liste optionnelle d images explicites a analyser si geocache_id n est pas fourni.'
                    },
                    target_step_id: {
                        type: 'string',
                        description: 'Etape cible optionnelle: inspect-hidden-html, inspect-images, execute-direct-plugin, execute-metasolver, search-answers, calculate-final-coordinates, validate-with-checker.'
                    },
                    preferred_workflow: {
                        type: 'string',
                        description: 'Workflow force optionnel: general, secret_code, formula, checker, hidden_content, image_puzzle, coord_transform.'
                    },
                    formula_index: {
                        type: 'number',
                        description: 'Index de formule a utiliser pour calculate-final-coordinates.'
                    },
                    formula_values: {
                        type: 'array',
                        description: 'Liste de paires variable/valeur numerique, ex: [{\"name\": \"A\", \"value\": 3}, {\"name\": \"B\", \"value\": 5}].',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                name: {
                                    type: 'string',
                                    description: 'Nom de la variable, ex: A.'
                                },
                                value: {
                                    type: 'number',
                                    description: 'Valeur numerique de la variable.'
                                }
                            },
                            required: ['name', 'value']
                        }
                    },
                    formula_answers: {
                        type: 'array',
                        description: 'Liste de paires variable/reponse brute, ex: [{\"name\": \"A\", \"answer\": \"42\"}].',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                name: {
                                    type: 'string',
                                    description: 'Nom de la variable, ex: A.'
                                },
                                answer: {
                                    type: 'string',
                                    description: 'Reponse textuelle brute.'
                                }
                            },
                            required: ['name', 'answer']
                        }
                    },
                    formula_value_types: {
                        type: 'array',
                        description: 'Liste de paires variable/type de conversion, ex: [{\"name\": \"A\", \"value_type\": \"checksum\"}].',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                name: {
                                    type: 'string',
                                    description: 'Nom de la variable, ex: A.'
                                },
                                value_type: {
                                    type: 'string',
                                    description: 'Type de conversion: value, checksum, reduced_checksum, length.'
                                }
                            },
                            required: ['name', 'value_type']
                        }
                    },
                    search_context: {
                        type: 'string',
                        description: 'Contexte supplementaire pour la recherche web des reponses.'
                    },
                    max_search_results: {
                        type: 'number',
                        description: 'Nombre maximum de resultats web a conserver par question.'
                    },
                    checker_candidate: {
                        type: 'string',
                        description: 'Candidat a tester au checker. Si omis, GeoApp essaie de le deduire du workflow.'
                    },
                    checker_url: {
                        type: 'string',
                        description: 'URL explicite du checker si elle ne vient pas du listing.'
                    },
                    checker_name: {
                        type: 'string',
                        description: 'Nom du checker cible pour le contexte.'
                    },
                    checker_id: {
                        type: 'number',
                        description: 'ID du checker cible s il est connu.'
                    },
                    wp: {
                        type: 'string',
                        description: 'Code GC / waypoint utilise pour normaliser certains checkers.'
                    },
                    checker_auto_login: {
                        type: 'boolean',
                        description: 'Pour Geocaching.com, tente un login interactif si la session manque.'
                    },
                    checker_login_timeout_sec: {
                        type: 'number',
                        description: 'Temps maximum pour le login interactif Geocaching.'
                    },
                    checker_timeout_sec: {
                        type: 'number',
                        description: 'Temps maximum d attente du checker interactif.'
                    },
                    max_secret_fragments: {
                        type: 'number',
                        description: 'Nombre maximum de fragments secrets a extraire.'
                    },
                    max_plugins: {
                        type: 'number',
                        description: 'Nombre maximum de plugins metasolver recommandes.'
                    },
                    workflow_control: {
                        ...this.workflowControlParameterSchema(),
                        description: 'Etat de controle precedent du workflow pour conserver les budgets et compteurs entre plusieurs appels.'
                    }
                },
                additionalProperties: false,
            } as ToolRequestParameters,
            handler: async (argString: string) => this.runWorkflowStep(argString)
        };
    }

    protected async executePlugin(name: string, argString: string): Promise<ToolCallResult> {
        console.log(`[PluginTools] Exécution du plugin '${name}' avec arguments:`, argString);
        try {
            const inputs = this.parseArguments(argString);
            console.log(`[PluginTools] Arguments parsés pour '${name}':`, inputs);

            const result = await this.pluginsService.executePlugin(name, inputs);
            const formatted = this.formatResult(result);

            console.log(`[PluginTools] Résultat du plugin '${name}':`, formatted);
            return formatted;
        } catch (error) {
            console.error(`[PluginTools] Erreur lors de l'exécution du plugin '${name}':`, error);
            throw error;
        }
    }

    protected async recommendMetasolverPlugins(argString: string): Promise<ToolCallResult> {
        const args = this.parseArguments(argString);
        const text = typeof args.text === 'string' ? args.text : '';
        if (!text.trim()) {
            return { error: 'Le champ text est requis pour recommander les plugins metasolver.' };
        }

        const request = {
            text,
            preset: typeof args.preset === 'string' ? args.preset : undefined,
            mode: args.mode === 'detect' ? 'detect' as const : 'decode' as const,
            max_plugins: typeof args.max_plugins === 'number' ? args.max_plugins : undefined
        };

        const response = await this.pluginsService.recommendMetasolverPlugins(request);
        return this.formatMetasolverRecommendation(response);
    }

    protected async classifyListing(argString: string): Promise<ToolCallResult> {
        const args = this.parseArguments(argString);
        const geocacheId = typeof args.geocache_id === 'number'
            ? args.geocache_id
            : (typeof args.geocache_id === 'string' && args.geocache_id.trim() ? Number(args.geocache_id) : undefined);
        const images = this.toImageInputs(args.images);

        if (geocacheId === undefined || Number.isNaN(geocacheId)) {
            const hasDirectInput = ['title', 'description', 'description_html', 'hint'].some(key => {
                const value = args[key];
                return typeof value === 'string' && value.trim().length > 0;
            }) || Boolean(images?.length);
            if (!hasDirectInput) {
                return { error: 'Fournissez geocache_id ou au moins un champ parmi title, description, description_html, hint, images.' };
            }
        }

        const response = await this.pluginsService.classifyListing({
            geocache_id: geocacheId !== undefined && !Number.isNaN(geocacheId) ? geocacheId : undefined,
            title: typeof args.title === 'string' ? args.title : undefined,
            description: typeof args.description === 'string' ? args.description : undefined,
            description_html: typeof args.description_html === 'string' ? args.description_html : undefined,
            hint: typeof args.hint === 'string' ? args.hint : undefined,
            images,
            max_secret_fragments: typeof args.max_secret_fragments === 'number' ? args.max_secret_fragments : undefined
        });
        return this.formatListingClassification(response);
    }

    protected async resolveWorkflow(argString: string): Promise<ToolCallResult> {
        const args = this.parseArguments(argString);
        const geocacheId = typeof args.geocache_id === 'number'
            ? args.geocache_id
            : (typeof args.geocache_id === 'string' && args.geocache_id.trim() ? Number(args.geocache_id) : undefined);
        const images = this.toImageInputs(args.images);

        if (geocacheId === undefined || Number.isNaN(geocacheId)) {
            const hasDirectInput = ['title', 'description', 'description_html', 'hint'].some(key => {
                const value = args[key];
                return typeof value === 'string' && value.trim().length > 0;
            }) || Boolean(images?.length);
            if (!hasDirectInput) {
                return { error: 'Fournissez geocache_id ou au moins un champ parmi title, description, description_html, hint, images.' };
            }
        }

        const response = await this.pluginsService.resolveWorkflow({
            geocache_id: geocacheId !== undefined && !Number.isNaN(geocacheId) ? geocacheId : undefined,
            title: typeof args.title === 'string' ? args.title : undefined,
            description: typeof args.description === 'string' ? args.description : undefined,
            description_html: typeof args.description_html === 'string' ? args.description_html : undefined,
            hint: typeof args.hint === 'string' ? args.hint : undefined,
            images,
            preferred_workflow: typeof args.preferred_workflow === 'string' ? args.preferred_workflow as any : undefined,
            auto_execute: typeof args.auto_execute === 'boolean' ? args.auto_execute : undefined,
            max_secret_fragments: typeof args.max_secret_fragments === 'number' ? args.max_secret_fragments : undefined,
            max_plugins: typeof args.max_plugins === 'number' ? args.max_plugins : undefined,
            workflow_control: typeof args.workflow_control === 'object' && args.workflow_control ? args.workflow_control as Record<string, unknown> : undefined,
        });
        return this.formatWorkflowResolution(response);
    }

    protected async runWorkflowStep(argString: string): Promise<ToolCallResult> {
        const args = this.parseArguments(argString);
        const geocacheId = typeof args.geocache_id === 'number'
            ? args.geocache_id
            : (typeof args.geocache_id === 'string' && args.geocache_id.trim() ? Number(args.geocache_id) : undefined);
        const images = this.toImageInputs(args.images);

        if (geocacheId === undefined || Number.isNaN(geocacheId)) {
            const hasDirectInput = ['title', 'description', 'description_html', 'hint'].some(key => {
                const value = args[key];
                return typeof value === 'string' && value.trim().length > 0;
            }) || Boolean(images?.length);
            if (!hasDirectInput) {
                return { error: 'Fournissez geocache_id ou au moins un champ parmi title, description, description_html, hint, images.' };
            }
        }

        const response = await this.pluginsService.runWorkflowStep({
            geocache_id: geocacheId !== undefined && !Number.isNaN(geocacheId) ? geocacheId : undefined,
            title: typeof args.title === 'string' ? args.title : undefined,
            description: typeof args.description === 'string' ? args.description : undefined,
            description_html: typeof args.description_html === 'string' ? args.description_html : undefined,
            hint: typeof args.hint === 'string' ? args.hint : undefined,
            images,
            preferred_workflow: typeof args.preferred_workflow === 'string' ? args.preferred_workflow as any : undefined,
            target_step_id: typeof args.target_step_id === 'string' ? args.target_step_id : undefined,
            formula_index: typeof args.formula_index === 'number' ? args.formula_index : undefined,
            formula_values: this.toNamedNumberRecord(args.formula_values),
            formula_answers: this.toNamedStringRecord(args.formula_answers, 'answer'),
            formula_value_types: this.toNamedStringRecord(args.formula_value_types, 'value_type'),
            search_context: typeof args.search_context === 'string' ? args.search_context : undefined,
            max_search_results: typeof args.max_search_results === 'number' ? args.max_search_results : undefined,
            checker_candidate: typeof args.checker_candidate === 'string' ? args.checker_candidate : undefined,
            checker_url: typeof args.checker_url === 'string' ? args.checker_url : undefined,
            checker_name: typeof args.checker_name === 'string' ? args.checker_name : undefined,
            checker_id: typeof args.checker_id === 'number' ? args.checker_id : undefined,
            wp: typeof args.wp === 'string' ? args.wp : undefined,
            checker_auto_login: typeof args.checker_auto_login === 'boolean' ? args.checker_auto_login : undefined,
            checker_login_timeout_sec: typeof args.checker_login_timeout_sec === 'number' ? args.checker_login_timeout_sec : undefined,
            checker_timeout_sec: typeof args.checker_timeout_sec === 'number' ? args.checker_timeout_sec : undefined,
            max_secret_fragments: typeof args.max_secret_fragments === 'number' ? args.max_secret_fragments : undefined,
            max_plugins: typeof args.max_plugins === 'number' ? args.max_plugins : undefined,
            workflow_control: typeof args.workflow_control === 'object' && args.workflow_control ? args.workflow_control as Record<string, unknown> : undefined,
        });
        return this.formatWorkflowStepRun(response);
    }

    protected toNamedNumberRecord(value: unknown): Record<string, number> | undefined {
        if (!value || typeof value !== 'object') {
            return undefined;
        }
        if (Array.isArray(value)) {
            const entries = value
                .map(item => {
                    if (!item || typeof item !== 'object') {
                        return undefined;
                    }
                    const record = item as Record<string, unknown>;
                    const name = typeof record.name === 'string' ? record.name.trim() : '';
                    const rawValue = record.value;
                    const numericValue = typeof rawValue === 'number'
                        ? rawValue
                        : (typeof rawValue === 'string' && rawValue.trim() ? Number(rawValue) : NaN);
                    if (!name || Number.isNaN(numericValue)) {
                        return undefined;
                    }
                    return [name, numericValue] as const;
                })
                .filter((entry): entry is readonly [string, number] => Boolean(entry));
            return entries.length > 0 ? Object.fromEntries(entries) : undefined;
        }
        const entries = Object.entries(value as Record<string, unknown>)
            .map(([key, rawValue]) => {
                const numericValue = typeof rawValue === 'number'
                    ? rawValue
                    : (typeof rawValue === 'string' && rawValue.trim() ? Number(rawValue) : NaN);
                if (!key.trim() || Number.isNaN(numericValue)) {
                    return undefined;
                }
                return [key, numericValue] as const;
            })
            .filter((entry): entry is readonly [string, number] => Boolean(entry));
        return entries.length > 0 ? Object.fromEntries(entries) : undefined;
    }

    protected imageInputArrayParameterSchema(): ToolRequestParameters {
        return {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    url: {
                        type: 'string',
                        description: 'URL absolue de l image.'
                    },
                    alt: {
                        type: 'string',
                        description: 'Texte alt eventuel.'
                    },
                    title: {
                        type: 'string',
                        description: 'Titre eventuel.'
                    }
                },
                required: ['url']
            }
        } as unknown as ToolRequestParameters;
    }

    protected toImageInputs(value: unknown): Array<Record<string, string>> | undefined {
        if (!Array.isArray(value)) {
            return undefined;
        }
        const images = value
            .map(item => {
                if (!item || typeof item !== 'object') {
                    return undefined;
                }
                const record = item as Record<string, unknown>;
                const url = typeof record.url === 'string' ? record.url.trim() : '';
                if (!url) {
                    return undefined;
                }
                const normalized: Record<string, string> = { url };
                if (typeof record.alt === 'string' && record.alt.trim()) {
                    normalized.alt = record.alt.trim();
                }
                if (typeof record.title === 'string' && record.title.trim()) {
                    normalized.title = record.title.trim();
                }
                return normalized;
            })
            .filter((item): item is Record<string, string> => Boolean(item));
        return images.length > 0 ? images : undefined;
    }
    protected toNamedStringRecord(value: unknown, valueKey: string): Record<string, string> | undefined {
        if (!value || typeof value !== 'object') {
            return undefined;
        }
        if (Array.isArray(value)) {
            const entries = value
                .map(item => {
                    if (!item || typeof item !== 'object') {
                        return undefined;
                    }
                    const record = item as Record<string, unknown>;
                    const name = typeof record.name === 'string' ? record.name.trim() : '';
                    const rawValue = record[valueKey];
                    const normalizedValue = typeof rawValue === 'string' ? rawValue.trim() : '';
                    if (!name || !normalizedValue) {
                        return undefined;
                    }
                    return [name, normalizedValue] as const;
                })
                .filter((entry): entry is readonly [string, string] => Boolean(entry));
            return entries.length > 0 ? Object.fromEntries(entries) : undefined;
        }
        const entries = Object.entries(value as Record<string, unknown>)
            .map(([key, rawValue]) => {
                const normalizedValue = typeof rawValue === 'string' ? rawValue.trim() : '';
                if (!key.trim() || !normalizedValue) {
                    return undefined;
                }
                return [key, normalizedValue] as const;
            })
            .filter((entry): entry is readonly [string, string] => Boolean(entry));
        return entries.length > 0 ? Object.fromEntries(entries) : undefined;
    }
    protected parseArguments(argString: string): Record<string, unknown> {
        if (!argString || !argString.trim()) {
            return {};
        }
        try {
            return JSON.parse(argString);
        } catch (error) {
            throw new Error(`Arguments JSON invalides pour le plugin: ${error}`);
        }
    }

    protected formatResult(result: PluginResult): ToolCallResult {
        if (result.text_output) {
            return JSON.stringify(result.text_output);
        }

        return JSON.stringify(
            {
                status: result.status,
                summary: result.summary ?? result.error ?? 'Résultat du plugin',
                results: result.results,
                coordinates: result.coordinates,
                metadata: result.metadata ?? result.plugin_info
            },
            null,
            2
        );
    }

    protected formatMetasolverRecommendation(result: MetasolverRecommendationResponse): ToolCallResult {
        return JSON.stringify(
            {
                effective_preset: result.effective_preset,
                signature: result.signature,
                selected_plugins: result.selected_plugins,
                plugin_list: result.plugin_list,
                recommendations: result.recommendations.map(item => ({
                    name: item.name,
                    score: item.score,
                    confidence: item.confidence,
                    reasons: item.reasons
                })),
                explanation: result.explanation
            },
            null,
            2
        );
    }

    protected formatListingClassification(result: ListingClassificationResponse): ToolCallResult {
        return JSON.stringify(
            {
                source: result.source,
                geocache: result.geocache,
                title: result.title,
                labels: result.labels,
                candidate_secret_fragments: result.candidate_secret_fragments,
                hidden_signals: result.hidden_signals,
                formula_signals: result.formula_signals,
                recommended_actions: result.recommended_actions,
                signal_summary: result.signal_summary
            },
            null,
            2
        );
    }

    protected formatWorkflowResolution(result: ResolutionWorkflowResponse): ToolCallResult {
        return JSON.stringify(
            {
                source: result.source,
                geocache: result.geocache,
                title: result.title,
                workflow: result.workflow,
                workflow_candidates: result.workflow_candidates,
                plan: result.plan,
                control: result.control,
                next_actions: result.next_actions,
                explanation: result.explanation,
                classification: {
                    labels: result.classification.labels,
                    candidate_secret_fragments: result.classification.candidate_secret_fragments,
                    hidden_signals: result.classification.hidden_signals,
                    formula_signals: result.classification.formula_signals,
                },
                execution: result.execution,
            },
            null,
            2
        );
    }

    protected formatWorkflowStepRun(result: ResolutionWorkflowStepRunResponse): ToolCallResult {
        return JSON.stringify(
            {
                status: result.status,
                executed_step: result.executed_step,
                message: result.message,
                step: result.step,
                result: result.result,
                workflow_resolution: {
                    workflow: result.workflow_resolution.workflow,
                    plan: result.workflow_resolution.plan,
                    control: result.workflow_resolution.control,
                    next_actions: result.workflow_resolution.next_actions,
                    explanation: result.workflow_resolution.explanation,
                    execution: result.workflow_resolution.execution,
                }
            },
            null,
            2
        );
    }

    /**
     * Vérifie le statut des tools IA enregistrés.
     */
    getToolsStatus(): { total: number; names: string[] } {
        const allTools = this.toolRegistry.getAllFunctions();
        const pluginTools = allTools.filter(tool => tool.providerName === PluginToolsManager.PROVIDER_NAME);

        return {
            total: pluginTools.length,
            names: pluginTools.map(tool => tool.name)
        };
    }

    /**
     * Affiche le statut des tools dans la console (pour debug).
     */
    logToolsStatus(): void {
        const status = this.getToolsStatus();
        console.log(`[PluginTools] Statut actuel: ${status.total} tools enregistrés`, status.names);

        if (status.total === 0) {
            console.warn('[PluginTools] Aucun tool IA enregistré - vérifiez que les plugins sont actifs');
        }
    }
}

