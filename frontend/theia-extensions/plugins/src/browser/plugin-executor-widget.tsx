/**
 * Widget pour exécuter des plugins.
 * 
 * Deux modes d'utilisation :
 * 
 * MODE PLUGIN (depuis Panel Plugins) :
 * - Plugin pré-sélectionné, non modifiable
 * - Options Encoder/Décoder disponibles
 * - Association géocache optionnelle
 * - Focus sur l'exécution d'UN plugin spécifique
 * 
 * MODE GEOCACHE (depuis Geocache Details) :
 * - Géocache associée, non modifiable
 * - Sélecteur de plugin visible
 * - Décoder uniquement (pas d'option encoder)
 * - Peut enchaîner les plugins
 * - Focus sur l'analyse de la géocache
 */

import * as React from '@theia/core/shared/react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { StatefulWidget } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core/lib/common/message-service';
import { CommandService } from '@theia/core';
import {
    PluginsService,
    Plugin,
    PluginDetails,
    PluginResult,
    ListingClassificationResponse,
    MetasolverEligiblePlugin,
    MetasolverRecommendationResponse,
    MetasolverSignature,
    GeographicPlausibilityAssessment,
    ResolutionPlanStep,
    ResolutionWorkflowKind,
    ResolutionWorkflowResponse
} from '../common/plugin-protocol';
import { TasksService, Task } from '../common/task-protocol';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import {
    dispatchPluginExecutorGeoAppOpenChatRequest,
    buildPluginExecutorGeoAppOpenChatDetail,
    resolvePluginExecutorGeoAppWorkflowKind,
} from './plugin-executor-geoapp-shared';
import { buildPluginExecutorGeoAppDiagnosticPrompt as buildGeoAppDiagnosticPrompt } from './plugin-executor-diagnostic-shared';
import { extractDecimalCoordinates, deriveCoordinatesFromItem } from './plugin-executor-coords-utils';
import { PluginResultDisplay, AddWaypointEventDetail } from './plugin-result-display';
import { AnalysisWebPagePanel, renderDynamicForm, renderInputField } from './plugin-executor-form';
import { MetasolverStreamingPanel } from './metasolver-streaming-panel';
import { MetasolverPresetPanel } from './metasolver-preset-panel';
import type { PluginExecutorResumeSnapshot } from './metasolver-preset-panel';

export const FORMULA_SOLVER_SOLVE_FROM_GEOCACHE_COMMAND = 'formula-solver:solve-from-geocache';
export const GEOAPP_CHAT_DEFAULT_PROFILE_PREF = 'geoApp.chat.defaultProfile';
export const GEOAPP_CHAT_SECRET_CODE_PROFILE_PREF = 'geoApp.chat.workflowProfile.secretCode';
export const GEOAPP_CHAT_FORMULA_PROFILE_PREF = 'geoApp.chat.workflowProfile.formula';
export const GEOAPP_CHAT_CHECKER_PROFILE_PREF = 'geoApp.chat.workflowProfile.checker';
export const GEOAPP_CHAT_HIDDEN_CONTENT_PROFILE_PREF = 'geoApp.chat.workflowProfile.hiddenContent';
export const GEOAPP_CHAT_IMAGE_PUZZLE_PROFILE_PREF = 'geoApp.chat.workflowProfile.imagePuzzle';

/**
 * Mode d'exécution du Plugin Executor
 */
export type PluginExecutorMode = 'plugin' | 'geocache';

/**
 * Contexte de géocache passé au widget
 */
export interface GeocacheContext {
    geocacheId?: number;
    gcCode: string;
    name: string;
    coordinates?: {
        latitude: number;
        longitude: number;
        coordinatesRaw?: string;
    };
    description?: string;
    hint?: string;
    difficulty?: number;
    terrain?: number;
    waypoints?: any[]; // Ajout des waypoints
    images?: { url: string }[];
    checkers?: Array<{ id?: number; name?: string; url?: string }>;
    resumeSnapshot?: PluginExecutorResumeSnapshot | null;
}

interface SerializedPluginExecutorState {
    mode: PluginExecutorMode;
    pluginName?: string;
    gcCode?: string;
    autoExecute?: boolean;
    lastAccessTimestamp?: number;
}

/**
 * Configuration initiale du widget
 */
export interface PluginExecutorConfig {
    mode: PluginExecutorMode;
    
    // Mode PLUGIN
    pluginName?: string;           // Plugin pré-sélectionné
    allowModeSelection?: boolean;  // Permettre encode/decode
    
    // Mode GEOCACHE
    geocacheContext?: GeocacheContext;  // Contexte géocache
    allowPluginChaining?: boolean;      // Permettre l'enchaînement
    autoExecute?: boolean;              // Exécution automatique au chargement
}

/**
 * Événement SSE streaming du metasolver
 */
export interface StreamingEvent {
    event: 'init' | 'plugin_start' | 'plugin_done' | 'plugin_error' | 'progress' | 'result' | 'error';
    data: any;
    timestamp: number;
}

export interface StreamingProgress {
    completed: number;
    total: number;
    percentage: number;
    results_so_far: number;
    failures_so_far: number;
    elapsed_ms: number;
}

export interface CoordsDetectionProgress {
    current: number;
    total: number;
    found: number;
    currentText: string;
    phase: 'running' | 'done';
}

/**
 * État du composant d'exécution
 */
interface ExecutorState {
    plugins: Plugin[];
    selectedPlugin: string | null;
    pluginDetails: PluginDetails | null;
    formInputs: Record<string, any>;
    isExecuting: boolean;
    result: PluginResult | null;
    error: string | null;
    executionMode: 'sync' | 'async';
    task: Task | null;
    
    // État lié au mode
    mode: PluginExecutorMode;
    canSelectPlugin: boolean;      // Peut changer de plugin
    canChangeMode: boolean;        // Peut choisir encode/decode
    
    // Historique pour l'enchaînement (mode geocache)
    resultsHistory: PluginResult[];

    // Streaming metasolver
    streamingEvents: StreamingEvent[];
    streamingProgress: StreamingProgress | null;
    streamingVerbosity: 'minimal' | 'normal' | 'detailed';
    isStreaming: boolean;

    // Détection de coordonnées post-exécution
    coordsDetectionProgress: CoordsDetectionProgress | null;
}

@injectable()
export class PluginExecutorWidget extends ReactWidget implements StatefulWidget {
    static readonly ID = 'plugin-executor-widget';
    static readonly LABEL = 'Plugin Executor';

    @inject(PluginsService)
    protected readonly pluginsService!: PluginsService;

    @inject(TasksService)
    protected readonly tasksService!: TasksService;

    @inject(MessageService)
    protected readonly messageService!: MessageService;

    @inject(CommandService)
    protected readonly commandService!: CommandService;

    @inject(PreferenceService)
    protected readonly preferenceService!: PreferenceService;

    private config: PluginExecutorConfig | null = null;
    protected interactionTimerId: number | undefined;
    private lastAccessTimestamp: number = Date.now();

    private readonly handleContentClick = (): void => {
        this.emitInteraction('click');
    };

    private readonly handleContentScroll = (): void => {
        this.emitInteraction('scroll');
    };

    @postConstruct()
    protected init(): void {
        this.id = PluginExecutorWidget.ID;
        this.title.label = PluginExecutorWidget.LABEL;
        this.title.caption = PluginExecutorWidget.LABEL;
        this.title.closable = true;
        this.title.iconClass = 'fa fa-play-circle';
        this.node.tabIndex = 0;
        this.update();
    }

    protected onActivateRequest(msg: any): void {
        super.onActivateRequest(msg);
        this.node.focus();
    }

    private getBackendBaseUrl(): string {
        const value = this.preferenceService.get('geoApp.backend.apiBaseUrl', 'http://localhost:8000') as string;
        return (value || 'http://localhost:8000').replace(/\/$/, '');
    }

    protected onAfterAttach(msg: any): void {
        this.scrollOptions = undefined;
        super.onAfterAttach(msg);
        this.node.style.overflowY = 'auto';
        this.node.style.height = '100%';
        this.addInteractionListeners();
    }

    protected onBeforeDetach(msg: any): void {
        this.removeInteractionListeners();
        super.onBeforeDetach(msg);
    }

    private addInteractionListeners(): void {
        if (typeof window === 'undefined') {
            return;
        }
        this.node.addEventListener('click', this.handleContentClick, true);
        this.node.addEventListener('scroll', this.handleContentScroll, true);
    }

    private removeInteractionListeners(): void {
        if (typeof window === 'undefined') {
            return;
        }
        this.node.removeEventListener('click', this.handleContentClick, true);
        this.node.removeEventListener('scroll', this.handleContentScroll, true);
        this.clearMinOpenTimeTimer();
    }

    private emitInteraction(type: 'click' | 'scroll' | 'min-open-time'): void {
        if (typeof window === 'undefined') {
            return;
        }
        window.dispatchEvent(new CustomEvent('geoapp-plugin-tab-interaction', {
            detail: {
                widgetId: this.id,
                type
            }
        }));
    }

    private setupMinOpenTimeTimer(): void {
        this.clearMinOpenTimeTimer();

        if (typeof window === 'undefined') {
            return;
        }

        const enabled = this.preferenceService.get('geoApp.ui.tabs.smartReplace.interaction.minOpenTimeEnabled', true) as boolean;
        if (!enabled) {
            return;
        }

        const timeoutSeconds = this.preferenceService.get('geoApp.ui.tabs.smartReplaceTimeout', 30) as number;
        if (!timeoutSeconds || timeoutSeconds <= 0) {
            return;
        }

        this.interactionTimerId = window.setTimeout(() => {
            this.emitInteraction('min-open-time');
        }, timeoutSeconds * 1000);
    }

    private clearMinOpenTimeTimer(): void {
        if (typeof window === 'undefined') {
            return;
        }
        if (this.interactionTimerId !== undefined) {
            window.clearTimeout(this.interactionTimerId);
            this.interactionTimerId = undefined;
        }
    }

    storeState(): object | undefined {
        if (!this.config) {
            return undefined;
        }

        this.lastAccessTimestamp = Date.now();

        if (this.config.mode === 'plugin') {
            const state: SerializedPluginExecutorState = {
                mode: 'plugin',
                pluginName: this.config.pluginName,
                lastAccessTimestamp: this.lastAccessTimestamp
            };
            return state;
        }

        if (this.config.mode === 'geocache' && this.config.geocacheContext) {
            const state: SerializedPluginExecutorState = {
                mode: 'geocache',
                gcCode: this.config.geocacheContext.gcCode,
                pluginName: this.config.pluginName,
                autoExecute: this.config.autoExecute === true,
                lastAccessTimestamp: this.lastAccessTimestamp
            };
            return state;
        }

        return undefined;
    }

    restoreState(oldState: object): void {
        const state = oldState as Partial<SerializedPluginExecutorState> | undefined;
        if (!state || typeof state !== 'object' || !state.mode) {
            return;
        }

        if (state.lastAccessTimestamp && typeof state.lastAccessTimestamp === 'number') {
            this.lastAccessTimestamp = state.lastAccessTimestamp;
        }

        if (state.mode === 'plugin' && typeof state.pluginName === 'string') {
            this.initializePluginMode(state.pluginName);
            return;
        }

        if (state.mode === 'geocache' && typeof state.gcCode === 'string') {
            const context: GeocacheContext = {
                gcCode: state.gcCode,
                name: state.gcCode
            };

            const pluginName = typeof state.pluginName === 'string' ? state.pluginName : undefined;
            this.initializeGeocacheMode(context, pluginName, false);
        }
    }

    /**
     * Initialise le widget en MODE PLUGIN
     * Utilisé quand l'utilisateur clique sur un plugin dans le panel
     */
    public initializePluginMode(pluginName: string): void {
        this.lastAccessTimestamp = Date.now();
        this.config = {
            mode: 'plugin',
            pluginName,
            allowModeSelection: true  // Permet encode/decode
        };
        this.title.label = `Plugin: ${pluginName}`;
        this.title.iconClass = 'fa fa-puzzle-piece';
        console.log(`[Plugin Executor] Initialized in PLUGIN mode:`, pluginName);
        this.setupMinOpenTimeTimer();
        this.update();
    }

    /**
     * Initialise le widget en MODE GEOCACHE
     * Utilisé quand l'utilisateur clique "Analyser" depuis une géocache
     */
    public initializeGeocacheMode(context: GeocacheContext, pluginName?: string, autoExecute?: boolean): void {
        this.lastAccessTimestamp = Date.now();
        const shouldAutoExecute = autoExecute === true && pluginName !== 'metasolver';
        this.config = {
            mode: 'geocache',
            geocacheContext: context,
            pluginName,
            allowPluginChaining: true,  // Permet d'enchaîner les plugins
            autoExecute: shouldAutoExecute
        };
        this.title.label = `Analyse: ${context.gcCode}`;
        this.title.iconClass = 'fa fa-search';
        console.log(`[PluginExecutor] Initialized in GEOCACHE mode: ${context.gcCode}`);
        this.setupMinOpenTimeTimer();
        this.update();
    }

    protected render(): React.ReactNode {
        if (!this.config) {
            return (
                <div className='plugin-executor-container' style={{ padding: '20px', textAlign: 'center' }}>
                    <div>⏳ Initialisation...</div>
                    <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '10px' }}>
                        En attente de configuration
                    </div>
                </div>
            );
        }

        return <PluginExecutorComponent
            config={this.config}
            pluginsService={this.pluginsService}
            tasksService={this.tasksService}
            messageService={this.messageService}
            commandService={this.commandService}
            preferenceService={this.preferenceService}
            backendBaseUrl={this.getBackendBaseUrl()}
        />;
    }
}
/**
 * Composant React pour l'interface d'exécution
 */
const PluginExecutorComponent: React.FC<{
    config: PluginExecutorConfig;
    pluginsService: PluginsService;
    tasksService: TasksService;
    messageService: MessageService;
    commandService: CommandService;
    preferenceService: PreferenceService;
    backendBaseUrl: string;
}> = ({ config, pluginsService, tasksService, messageService, commandService, preferenceService, backendBaseUrl }) => {
    // Initialisation de l'état basée sur le mode
    const [state, setState] = React.useState<ExecutorState>(() => {
        // En mode plugin ou geocache, on peut avoir un plugin pré-sélectionné
        const initialPlugin = config.pluginName || null;
        const canSelectPlugin = config.mode === 'geocache';
        const canChangeMode = config.mode === 'plugin' && config.allowModeSelection !== false;
        
        console.log(`[Plugin Executor Component] Initializing in ${config.mode} mode. Initial plugin: ${initialPlugin}`);
        
        return {
            plugins: [],
            selectedPlugin: initialPlugin,
            pluginDetails: null,
            formInputs: {},
            isExecuting: false,
            result: null,
            error: null,
            executionMode: 'sync',
            task: null,
            mode: config.mode,
            canSelectPlugin,
            canChangeMode,
            resultsHistory: [],
            streamingEvents: [],
            streamingProgress: null,
            streamingVerbosity: 'normal',
            isStreaming: false,
            coordsDetectionProgress: null
        };
    });
    
    // Contrôle d'exécution : arrêt et pause
    const abortControllerRef = React.useRef<AbortController | null>(null);
    const pauseResolverRef = React.useRef<(() => void) | null>(null);
    const isPausedRef = React.useRef(false);
    const [isPaused, setIsPaused] = React.useState(false);

    // État pour savoir si on charge le plugin initial (mode PLUGIN uniquement)
    const [isLoadingInitial, setIsLoadingInitial] = React.useState<boolean>(
        config.mode === 'plugin' && !!config.pluginName
    );

    // Récupérer le contexte géocache (si disponible)
    const context = config.geocacheContext || {
        gcCode: '',
        name: 'Aucune géocache'
    };
    
    // Réinitialiser l'état quand la config change (changement de plugin ou de mode)
    React.useEffect(() => {
        console.log('[Plugin Executor] Config changed, reinitializing state');
        const initialPlugin = config.pluginName || null;
        const canSelectPlugin = config.mode === 'geocache';
        const canChangeMode = config.mode === 'plugin' && config.allowModeSelection !== false;
        
        setState(prev => ({
            plugins: prev.plugins, // Garder la liste des plugins déjà chargée
            selectedPlugin: initialPlugin,
            pluginDetails: null,
            formInputs: {},
            isExecuting: false,
            result: null,
            error: null,
            executionMode: 'sync',
            task: null,
            mode: config.mode,
            canSelectPlugin,
            canChangeMode,
            resultsHistory: [],
            streamingEvents: [],
            streamingProgress: null,
            streamingVerbosity: prev.streamingVerbosity,
            isStreaming: false,
            coordsDetectionProgress: null
        }));
        
        setIsLoadingInitial(config.mode === 'plugin' && !!config.pluginName);
    }, [config.mode, config.pluginName, config.geocacheContext?.gcCode]);

    const loadPlugins = async () => {
        try {
            const plugins = await pluginsService.listPlugins({ enabled: true });
            setState(prev => ({ ...prev, plugins }));
        } catch (error) {
            messageService.error(`Erreur lors du chargement des plugins: ${error}`);
        }
    };

    // Chargement initial des plugins
    React.useEffect(() => {
        console.log('[Plugin Executor] Chargement de la liste des plugins');
        loadPlugins();
    }, []);

    // Charger le plugin initial (mode PLUGIN ou GEOCACHE si pluginName fourni)
    React.useEffect(() => {
        if (config.pluginName) {
            setIsLoadingInitial(true);
            console.log('[Plugin Executor] Chargement du plugin initial:', config.pluginName);
            loadPluginDetails(config.pluginName).finally(() => {
                setIsLoadingInitial(false);
            });
        }
    }, [config.mode, config.pluginName]);

    // Charger les détails du plugin sélectionné (mode GEOCACHE uniquement)
    React.useEffect(() => {
        if (config.mode === 'geocache' && state.selectedPlugin) {
            console.log('[Plugin Executor] Sélection du plugin (mode geocache):', state.selectedPlugin);
            loadPluginDetails(state.selectedPlugin);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.selectedPlugin, config.mode]);

    // Debug: Logger quand le résultat change
    React.useEffect(() => {
        if (state.result) {
            console.log('=== STATE.RESULT UPDATED ===');
            console.log('Result object:', state.result);
            console.log('Has results array:', !!state.result.results);
            console.log('Results length:', state.result.results?.length);
            console.log('First result:', state.result.results?.[0]);
        }
    }, [state.result]);

    // Exécuter automatiquement si configuré
    React.useEffect(() => {
        if (
            config.autoExecute
            && state.pluginDetails
            && state.selectedPlugin
            && state.selectedPlugin !== 'metasolver'
            && !state.isExecuting
            && !state.result
        ) {
            console.log('[Plugin Executor] Exécution automatique déclenchée');
            // Petit délai pour laisser le rendu se faire
            setTimeout(() => {
                handleExecute();
            }, 500);
        }
    }, [config.autoExecute, state.pluginDetails, state.selectedPlugin]);

    const loadPluginDetails = async (pluginName: string): Promise<void> => {
        try {
            console.log('[Plugin Executor] Chargement du plugin:', pluginName);
            const details = await pluginsService.getPlugin(pluginName);
            console.log('[Plugin Executor] Détails reçus:', details);
            console.log('[Plugin Executor] input_schema:', details.input_schema);
            console.log('[Plugin Executor] metadata:', details.metadata);
            
            const initialInputs = generateInitialInputs(details);
            console.log('[Plugin Executor] Inputs initiaux générés:', initialInputs);

            // Correction de robustesse : pour analysis_web_page, si le champ 'text' est vide
            // alors que le contexte contient une description, on force l'utilisation de cette description.
            const patchedInputs = { ...initialInputs };
            if (
                details.name === 'analysis_web_page' &&
                (!patchedInputs.text || String(patchedInputs.text).trim() === '') &&
                context.description
            ) {
                console.log("[Plugin Executor] Forcing geocache description into 'text' for analysis_web_page");
                patchedInputs.text = context.description;
            }
            
            setState(prev => {
                // Si patchedInputs.text est défini (via description ou autre), on l'utilise en priorité.
                // Sinon, on garde la valeur précédente si elle existe.
                const newText = patchedInputs.text || prev.formInputs.text || '';
                
                return {
                    ...prev,
                    pluginDetails: details,
                    // Fusionner les inputs
                    formInputs: { ...patchedInputs, text: newText },
                    result: null,
                    error: null
                };
            });
            console.log('[Plugin Executor] État mis à jour avec pluginDetails');
        } catch (error) {
            console.error('[Plugin Executor] Erreur lors du chargement:', error);
            messageService.error(`Erreur lors du chargement du plugin: ${error}`);
            throw error;
        }
    };

    const stripHtml = (html: string): string => {
        if (typeof document !== 'undefined') {
            const temp = document.createElement('div');
            temp.innerHTML = html;
            return (temp.textContent || temp.innerText || '').trim();
        }
        return html.replace(/<[^>]+>/g, ' ').trim();
    };

    /**
     * Génère les valeurs initiales du formulaire basées sur le schéma et le contexte
     */
    const generateInitialInputs = (details: PluginDetails): Record<string, any> => {
        const inputs: Record<string, any> = {};
        
        console.log('!!! [Plugin Executor] GENERATING INPUTS V2 !!! for', details.name);
        console.log('[Plugin Executor] Context available:', context);
        console.log('[Plugin Executor] Context description present?', !!context.description);
        console.log('[Plugin Executor] Context description length:', context.description?.length);
        
        if (!details.input_schema?.properties) {
            return inputs;
        }

        // Pré-remplir avec les données de la géocache si pertinent
        for (const [key, schema] of Object.entries(details.input_schema.properties)) {
            // ATTENTION: Le schéma reçu du backend peut avoir les propriétés 'default_value_source' 
            // directement dans `details.metadata.input_types[key]` plutôt que dans `schema`.
            // Le `input_schema` est généré automatiquement par le backend et peut perdre ces métadonnées custom.
            
            const prop = schema as any;
            const metadataInputType = details.metadata?.input_types?.[key];
            const defaultValueSource = prop.default_value_source || metadataInputType?.default_value_source;

            console.log(`[Plugin Executor] Processing field '${key}'`, { propSchema: prop, metadataInputType, defaultValueSource });
            
            // 1. Priorité aux sources explicites définies dans le plugin.json
            if (defaultValueSource) {
                console.log(`[Plugin Executor] Champ '${key}' utilise source: ${defaultValueSource}`);
                if (defaultValueSource === 'geocache_id' && context.gcCode) {
                    inputs[key] = context.gcCode;
                } else if (defaultValueSource === 'geocache_description' && context.description) {
                    console.log(`[Plugin Executor] Injecting description into '${key}'`);
                    inputs[key] = context.description;
                } else {
                     console.log(`[Plugin Executor] Source '${defaultValueSource}' not found in context or empty`);
                }
            }
            // 2. Fallback sur les comportements legacy hardcodés
            // Pour le champ 'text', on préfère la description (sans HTML pour les plugins standards) si elle existe, sinon les coordonnées
            else if (key === 'text') {
                if (context.description) {
                    console.log(`[Plugin Executor] Fallback for 'text': using STRIPPED geocache description`);
                    inputs[key] = stripHtml(context.description);
                } else if (context.coordinates?.coordinatesRaw) {
                    console.log(`[Plugin Executor] Fallback for 'text': using coordinates`);
                    inputs[key] = context.coordinates.coordinatesRaw;
                }
            }
            // Pour les plugins qui attendent explicitement une coordonnée d'origine (ex: coordinate_projection)
            else if (key === 'origin_coords') {
                if (context.coordinates?.coordinatesRaw) {
                    console.log(`[Plugin Executor] Fallback for 'origin_coords': using geocache coordinatesRaw`);
                    inputs[key] = context.coordinates.coordinatesRaw;
                }
            }
            else if (key === 'hint' && context.hint) {
                inputs[key] = context.hint;
            }
            // 3. Valeurs par défaut du schéma
            else if (prop.default !== undefined) {
                inputs[key] = prop.default;
            }
            // 4. Valeurs vides par défaut selon le type
            else if (prop.type === 'string') {
                inputs[key] = '';
            } else if (prop.type === 'number' || prop.type === 'integer') {
                inputs[key] = 0;
            } else if (prop.type === 'boolean') {
                inputs[key] = false;
            }
        }

        return inputs;
    };

    const handleInputChange = React.useCallback((key: string, value: any) => {
        setState(prev => ({
            ...prev,
            formInputs: { ...prev.formInputs, [key]: value }
        }));
    }, []);

    // Callbacks stables pour éviter les re-renders infinis dans MetasolverPresetPanel
    const handleTextChange = React.useCallback((newText: string) => handleInputChange('text', newText), [handleInputChange]);
    const handlePluginListChange = React.useCallback((newList: string) => handleInputChange('plugin_list', newList), [handleInputChange]);

    /**
     * Détecte les coordonnées GPS dans les résultats d'un plugin
     */
    const detectCoordinatesInResults = async (result: PluginResult, signal?: AbortSignal) => {
        if (!result.results || result.results.length === 0) {
            return;
        }
        
        const totalResults = result.results.length;
        let foundCount = 0;
        console.log('[Coordinates Detection] Analyse de', totalResults, 'résultat(s)');

        // Signaler le début de la phase de détection de coordonnées
        setState(prev => ({
            ...prev,
            coordsDetectionProgress: {
                current: 0,
                total: totalResults,
                found: 0,
                currentText: 'Initialisation…',
                phase: 'running',
            },
        }));
        
        // Récupérer les coordonnées d'origine si en mode GEOCACHE
        const originCoords = config.mode === 'geocache' && config.geocacheContext?.coordinates 
            ? {
                ddm_lat: `N ${config.geocacheContext.coordinates.latitude}`,
                ddm_lon: `E ${config.geocacheContext.coordinates.longitude}`
              }
            : undefined;
        
        // Parcourir chaque résultat et détecter les coordonnées
        for (let itemIdx = 0; itemIdx < result.results.length; itemIdx++) {
            // Vérifier l'annulation
            if (signal?.aborted) {
                console.log('[Coordinates Detection] Annulé à', itemIdx, '/', totalResults);
                break;
            }

            // Attendre si en pause
            if (isPausedRef.current) {
                setState(prev => ({
                    ...prev,
                    coordsDetectionProgress: prev.coordsDetectionProgress
                        ? { ...prev.coordsDetectionProgress, currentText: '⏸ En pause…' }
                        : prev.coordsDetectionProgress,
                }));
                await new Promise<void>(resolve => {
                    pauseResolverRef.current = resolve;
                });
                if (signal?.aborted) break;
            }

            const item = result.results[itemIdx];
            if (item.text_output) {
                try {
                    const textSnippet = item.text_output.length > 50
                        ? item.text_output.substring(0, 50) + '…'
                        : item.text_output;
                    console.log('[Coordinates Detection] Analyse du texte:', textSnippet);

                    // Mise à jour du progrès
                    setState(prev => ({
                        ...prev,
                        coordsDetectionProgress: {
                            current: itemIdx,
                            total: totalResults,
                            found: foundCount,
                            currentText: textSnippet,
                            phase: 'running',
                        },
                    }));

                    const writtenMode = state.formInputs.detect_written_coordinates === true;
                    const writtenLangMode = String(state.formInputs.written_coordinates_language || 'auto');
                    const writtenLanguages =
                        writtenLangMode === 'fr,en' ? ['fr', 'en'] :
                        writtenLangMode === 'fr' ? ['fr'] :
                        writtenLangMode === 'en' ? ['en'] :
                        ['auto'];

                    const coords = await pluginsService.detectCoordinates(item.text_output, {
                        includeNumericOnly: false,
                        includeWritten: writtenMode,
                        writtenLanguages,
                        writtenMaxCandidates: 20,
                        writtenIncludeDeconcat: true,
                        originCoords
                    });
                    
                    if (coords.exist) {
                        foundCount++;
                        console.log('[Coordinates Detection] Coordonnées détectées!', coords);
                        item.coordinates = {
                            latitude: coords.ddm_lat || '',
                            longitude: coords.ddm_lon || '',
                            formatted: coords.ddm || ''
                        };

                        const pluginLabel = result.plugin_info?.name || state.selectedPlugin || 'Coordonnée détectée';
                        const decimalCoordinates = extractDecimalCoordinates({
                            latitude: (coords as any).decimal_latitude ?? item.coordinates.latitude,
                            longitude: (coords as any).decimal_longitude ?? item.coordinates.longitude,
                            decimalLatitude: (coords as any).decimal_latitude,
                            decimalLongitude: (coords as any).decimal_longitude
                        }, coords.ddm);
                        if (decimalCoordinates) {
                            console.log('[Coordinates Detection] Dispatch map highlight', {
                                gcCode: context.gcCode,
                                pluginName: pluginLabel,
                                latitude: decimalCoordinates.latitude,
                                longitude: decimalCoordinates.longitude,
                                formatted: coords.ddm || item.coordinates.formatted
                            });
                            window.dispatchEvent(new CustomEvent('geoapp-map-highlight-coordinate', {
                                detail: {
                                    gcCode: context.gcCode,
                                    pluginName: pluginLabel,
                                    coordinates: {
                                        latitude: decimalCoordinates.latitude,
                                        longitude: decimalCoordinates.longitude,
                                        formatted: coords.ddm || item.coordinates.formatted
                                    },
                                    autoSaved: false,
                                    replaceExisting: false,
                                    // Utiliser le nom de la cache si disponible pour l'affichage dans la popup
                                    waypointTitle: context.name,
                                    waypointNote: item.text_output,
                                    sourceResultText: item.text_output
                                }
                            }));
                        } else {
                            console.warn('[Coordinates Detection] Impossible de convertir les coordonnées détectées en décimal', {
                                coords,
                                itemCoordinates: item.coordinates
                            });
                        }
                    }
                } catch (error) {
                    console.error('[Coordinates Detection] Erreur:', error);
                }
            }
        }

        // Signaler la fin de la phase de détection de coordonnées
        setState(prev => ({
            ...prev,
            coordsDetectionProgress: {
                current: totalResults,
                total: totalResults,
                found: foundCount,
                currentText: foundCount > 0 ? `${foundCount} coordonnée(s) trouvée(s)` : 'Aucune coordonnée trouvée',
                phase: 'done',
            },
        }));
    };

    const normalizeInputsForPlugin = (inputs: Record<string, any>, details: PluginDetails): { normalizedInputs: Record<string, any>; warnings: string[] } => {
        const textHandling = (details.metadata as any)?.text_handling;
        if (!textHandling) {
            return { normalizedInputs: inputs, warnings: [] };
        }

        const modeValue = typeof inputs.mode === 'string' ? inputs.mode.toLowerCase() : undefined;
        const shouldNormalizeTextField = modeValue === undefined || modeValue === 'encode';

        const fields: string[] = Array.isArray(textHandling.fields) && textHandling.fields.length
            ? textHandling.fields
            : ['text'];

        const fieldsToNormalize = shouldNormalizeTextField ? [...fields] : fields.filter(f => f !== 'text');
        if (
            typeof inputs.key === 'string' &&
            !fieldsToNormalize.includes('key') &&
            (((details.metadata as any)?.input_types?.key?.type === 'string') || (details.input_schema as any)?.properties?.key?.type === 'string')
        ) {
            fieldsToNormalize.push('key');
        }
        if (fieldsToNormalize.length === 0) {
            return { normalizedInputs: inputs, warnings: [] };
        }

        const allowedCharacters = typeof textHandling.allowed_characters === 'string' ? textHandling.allowed_characters : '';
        const allowedCharactersSet = new Set<string>([...allowedCharacters]);

        const allowedRanges: Array<{ start: number; end: number }> = [];
        if (Array.isArray(textHandling.allowed_ranges)) {
            for (const range of textHandling.allowed_ranges) {
                if (typeof range !== 'string') {
                    continue;
                }
                const parts = range.split('-');
                if (parts.length !== 2) {
                    continue;
                }
                const start = parseInt(parts[0], 16);
                const end = parseInt(parts[1], 16);
                if (Number.isFinite(start) && Number.isFinite(end)) {
                    allowedRanges.push({ start, end });
                }
            }
        }

        const unknownPolicy = typeof textHandling.unknown_char_policy === 'string' ? textHandling.unknown_char_policy : 'warn_keep';
        const normalizeConfig = (textHandling.normalize && typeof textHandling.normalize === 'object') ? textHandling.normalize : {};
        const removeDiacritics = !!normalizeConfig.remove_diacritics;
        const caseMode = typeof normalizeConfig.case === 'string' ? normalizeConfig.case : 'preserve';
        const mapCharacters = (normalizeConfig.map_characters && typeof normalizeConfig.map_characters === 'object') ? normalizeConfig.map_characters : {};

        const isCharAllowed = (ch: string): boolean => {
            if (allowedCharactersSet.has(ch)) {
                return true;
            }
            if (allowedRanges.length === 0) {
                return true;
            }
            const code = ch.codePointAt(0);
            if (code === undefined) {
                return false;
            }
            return allowedRanges.some(r => code >= r.start && code <= r.end);
        };

        const normalizeText = (value: string): { text: string; warnings: string[] } => {
            const localWarnings: string[] = [];

            let mapped = '';
            for (const ch of value) {
                const replacement = (mapCharacters as any)[ch];
                mapped += typeof replacement === 'string' ? replacement : ch;
            }

            let normalized = mapped;
            if (removeDiacritics) {
                const before = normalized;
                normalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                if (before !== normalized) {
                    localWarnings.push('Certains caractères accentués ont été normalisés (ex: é → e).');
                }
            }

            if (caseMode === 'upper') {
                normalized = normalized.toUpperCase();
            } else if (caseMode === 'lower') {
                normalized = normalized.toLowerCase();
            }

            const unsupported = new Set<string>();
            let output = '';
            for (const ch of normalized) {
                if (isCharAllowed(ch)) {
                    output += ch;
                    continue;
                }

                unsupported.add(ch);
                if (unknownPolicy === 'strip') {
                    continue;
                }
                output += ch;
            }

            const unsupportedList = [...unsupported].sort();
            if (unsupportedList.length > 0) {
                if (unknownPolicy === 'error') {
                    throw new Error(`Caractères non supportés par le plugin: ${unsupportedList.join('')}`);
                }
                if (unknownPolicy === 'warn_keep' || unknownPolicy === 'strip') {
                    localWarnings.push(`Caractères non supportés par le plugin: ${unsupportedList.join('')}`);
                }
            }

            return { text: output, warnings: localWarnings };
        };

        const warnings: string[] = [];
        const out: Record<string, any> = { ...inputs };

        for (const field of fieldsToNormalize) {
            const value = out[field];
            if (typeof value !== 'string') {
                continue;
            }
            const result = normalizeText(value);
            out[field] = result.text;
            warnings.push(...result.warnings.map(w => `[${field}] ${w}`));
        }

        return { normalizedInputs: out, warnings };
    };

    const handleExecute = async () => {
        if (!state.selectedPlugin || !state.pluginDetails) {
            messageService.warn('Veuillez sélectionner un plugin');
            return;
        }

        // Préparer les inputs pour l'envoi
        let inputsToSend = { ...state.formInputs };

        // En mode geocache, injecter les coordonnées de la cache si le plugin attend origin_coords
        if (
            config.mode === 'geocache' &&
            config.geocacheContext?.coordinates?.coordinatesRaw &&
            (inputsToSend.origin_coords === undefined || String(inputsToSend.origin_coords || '').trim() === '')
        ) {
            inputsToSend = {
                ...inputsToSend,
                origin_coords: config.geocacheContext.coordinates.coordinatesRaw
            };
        }
        
        // Si on est en mode geocache, ajouter les waypoints au contexte envoyé
        if (config.mode === 'geocache' && config.geocacheContext?.waypoints) {
            console.log('[Plugin Executor] Ajout des waypoints aux inputs:', config.geocacheContext.waypoints.length);
            inputsToSend = {
                ...inputsToSend,
                waypoints: config.geocacheContext.waypoints
            };
        }

        // Si le plugin est orienté image et que le contexte géocache contient des images,
        // les ajouter explicitement aux inputs sans affecter les autres plugins.
        const kinds = state.pluginDetails.metadata?.kinds as string[] | undefined;
        if (
            config.mode === 'geocache' &&
            Array.isArray(kinds) &&
            kinds.includes('image') &&
            config.geocacheContext?.images &&
            config.geocacheContext.images.length > 0
        ) {
            inputsToSend = {
                ...inputsToSend,
                images: config.geocacheContext.images.map(image => ({ url: image.url }))
            };
        }

        try {
            const normalization = normalizeInputsForPlugin(inputsToSend, state.pluginDetails);
            inputsToSend = normalization.normalizedInputs;
            for (const warning of normalization.warnings) {
                messageService.warn(warning);
            }
        } catch (error: any) {
            const errorMsg = error?.message || String(error);
            messageService.error(errorMsg);
            return;
        }

        console.log('=== DEBUG Plugin Executor ===');
        console.log('Plugin sélectionné:', state.selectedPlugin);
        console.log('Plugin details name:', state.pluginDetails.name);
        console.log('Inputs du formulaire:', state.formInputs);
        console.log('Inputs envoyés au backend:', inputsToSend);
        console.log('Schéma du plugin:', state.pluginDetails.input_schema);
        
        // Vérification de cohérence
        if (state.selectedPlugin !== state.pluginDetails.name) {
            console.error('INCOHÉRENCE: selectedPlugin !== pluginDetails.name');
            messageService.error('Erreur: incohérence du plugin sélectionné. Veuillez réessayer.');
            return;
        }

        // Créer un nouveau AbortController pour cette exécution
        const abortController = new AbortController();
        abortControllerRef.current = abortController;
        setIsPaused(false);

        setState(prev => ({
            ...prev,
            isExecuting: true,
            error: null,
            result: null,
            streamingEvents: [],
            streamingProgress: null,
            isStreaming: false,
            coordsDetectionProgress: null,
        }));

        try {
            // Metasolver en mode sync → streaming SSE
            const isMetasolver = state.selectedPlugin === 'metasolver';
            if (state.executionMode === 'sync' && isMetasolver) {
                console.log('[Metasolver Streaming] Démarrage SSE avec inputs:', inputsToSend);
                setState(prev => ({ ...prev, isStreaming: true }));

                const response = await fetch(
                    `${backendBaseUrl}/api/plugins/metasolver/execute-stream`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ inputs: inputsToSend }),
                        signal: abortController.signal,
                    }
                );

                if (!response.ok || !response.body) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                let finalResult: PluginResult | null = null;

                try {
                    while (true) {
                        if (abortController.signal.aborted) break;
                        const { done, value } = await reader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });

                        // Parse SSE events from buffer
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || ''; // keep incomplete line in buffer

                        let currentEventType = '';
                        let currentData = '';

                        for (const line of lines) {
                            if (line.startsWith('event: ')) {
                                currentEventType = line.slice(7).trim();
                            } else if (line.startsWith('data: ')) {
                                currentData = line.slice(6);
                            } else if (line === '' && currentEventType && currentData) {
                                // End of SSE message
                                try {
                                    const parsed = JSON.parse(currentData);
                                    const sseEvent: StreamingEvent = {
                                        event: currentEventType as StreamingEvent['event'],
                                        data: parsed,
                                        timestamp: Date.now(),
                                    };

                                    console.log(`[Metasolver SSE] ${currentEventType}:`, parsed);

                                    if (currentEventType === 'progress') {
                                        setState(prev => ({
                                            ...prev,
                                            streamingProgress: parsed,
                                            streamingEvents: [...prev.streamingEvents, sseEvent],
                                        }));
                                    } else if (currentEventType === 'result') {
                                        finalResult = parsed;
                                        setState(prev => ({
                                            ...prev,
                                            streamingEvents: [...prev.streamingEvents, sseEvent],
                                        }));
                                    } else {
                                        setState(prev => ({
                                            ...prev,
                                            streamingEvents: [...prev.streamingEvents, sseEvent],
                                        }));
                                    }
                                } catch (parseErr) {
                                    console.warn('[Metasolver SSE] Parse error:', parseErr);
                                }
                                currentEventType = '';
                                currentData = '';
                            }
                        }
                    }
                } finally {
                    reader.releaseLock();
                }

                if (abortController.signal.aborted) {
                    console.log('[Metasolver Streaming] Exécution annulée par l\'utilisateur');
                    setState(prev => ({
                        ...prev,
                        isExecuting: false,
                        isStreaming: false,
                        error: 'Exécution annulée',
                    }));
                    messageService.warn('Exécution annulée');
                    return;
                }

                if (finalResult) {
                    // Détecter les coordonnées si l'option est activée
                    if (state.formInputs.detect_coordinates && finalResult.results) {
                        await detectCoordinatesInResults(finalResult, abortController.signal);
                    }
                    if (abortController.signal.aborted) {
                        setState(prev => ({
                            ...prev,
                            result: finalResult,
                            isExecuting: false,
                            isStreaming: false,
                            error: 'Exécution interrompue (résultats partiels)',
                        }));
                        messageService.warn('Détection de coordonnées interrompue — résultats partiels affichés');
                        return;
                    }
                    setState(prev => ({
                        ...prev,
                        result: finalResult,
                        isExecuting: false,
                        isStreaming: false,
                    }));
                    messageService.info('Metasolver terminé avec succès');
                } else {
                    setState(prev => ({
                        ...prev,
                        isExecuting: false,
                        isStreaming: false,
                        error: 'Aucun résultat final reçu du streaming',
                    }));
                }

            } else if (state.executionMode === 'sync') {
                console.log('Exécution synchrone avec inputs:', inputsToSend);
                const result = await pluginsService.executePlugin(
                    state.selectedPlugin, inputsToSend, abortController.signal
                );
                console.log('Résultat reçu:', result);
                
                // Détecter les coordonnées si l'option est activée
                if (state.formInputs.detect_coordinates && result.results) {
                    console.log('[Coordinates Detection] Détection activée, analyse des résultats...');
                    await detectCoordinatesInResults(result, abortController.signal);
                }
                
                if (abortController.signal.aborted) {
                    setState(prev => ({ ...prev, result, isExecuting: false, error: 'Exécution interrompue (résultats partiels)' }));
                    messageService.warn('Détection de coordonnées interrompue — résultats partiels affichés');
                    return;
                }
                setState(prev => ({ ...prev, result, isExecuting: false }));
                messageService.info('Plugin exécuté avec succès');
            } else {
                console.log('Création de tâche asynchrone avec inputs:', state.formInputs);
                const task = await tasksService.createTask(state.selectedPlugin, inputsToSend);
                console.log('Tâche créée:', task);
                setState(prev => ({ ...prev, task, isExecuting: false }));
                messageService.info(`Tâche créée: ${task.task_id}`);
                // TODO: Ouvrir le Tasks Monitor ou afficher le suivi ici
            }
        } catch (error: any) {
            if (error.name === 'AbortError' || abortController.signal.aborted) {
                console.log('[Plugin Executor] Exécution annulée par l\'utilisateur');
                setState(prev => ({ ...prev, error: 'Exécution annulée', isExecuting: false, isStreaming: false }));
                messageService.warn('Exécution annulée');
                return;
            }
            console.error('Erreur lors de l\'exécution:', error);
            const errorMsg = error.message || String(error);
            setState(prev => ({ ...prev, error: errorMsg, isExecuting: false, isStreaming: false }));
            messageService.error(`Erreur lors de l'exécution: ${errorMsg}`);
        } finally {
            abortControllerRef.current = null;
            isPausedRef.current = false;
            setIsPaused(false);
        }
    };

    /**
     * Arrête l'exécution en cours (tous les plugins)
     */
    const handleStop = () => {
        if (abortControllerRef.current) {
            console.log('[Plugin Executor] Arrêt demandé par l\'utilisateur');
            abortControllerRef.current.abort();
            // Résoudre aussi la pause si en pause pour débloquer la boucle
            isPausedRef.current = false;
            if (pauseResolverRef.current) {
                pauseResolverRef.current();
                pauseResolverRef.current = null;
            }
            setIsPaused(false);
        }
    };

    /**
     * Met en pause / reprend l'exécution (détection de coordonnées et streaming)
     */
    const handlePauseToggle = () => {
        if (isPausedRef.current) {
            // Reprendre
            isPausedRef.current = false;
            setIsPaused(false);
            if (pauseResolverRef.current) {
                pauseResolverRef.current();
                pauseResolverRef.current = null;
            }
            console.log('[Plugin Executor] Reprise de l\'exécution');
        } else {
            // Mettre en pause — la boucle s'arrêtera à la prochaine itération
            isPausedRef.current = true;
            setIsPaused(true);
            console.log('[Plugin Executor] Pause demandée');
        }
    };

    /**
     * Enchaîne avec un autre plugin (mode GEOCACHE uniquement)
     * Utilise le résultat précédent comme texte d'entrée
     */
    const handleChainPlugin = () => {
        if (!state.result) return;
        
        // Extraire le texte du résultat
        let resultText = '';
        if (state.result.results && state.result.results.length > 0) {
            // Prendre le premier résultat
            resultText = state.result.results[0].text_output || '';
        } else if (state.result.text_output) {
            // Format ancien
            resultText = state.result.text_output;
        }
        
        if (!resultText) {
            messageService.warn('Aucun texte trouvé dans le résultat pour enchaîner');
            return;
        }
        
        console.log('[Plugin Executor] Enchaînement avec texte:', resultText);
        
        // Archiver le résultat actuel dans l'historique
        setState(prev => ({
            ...prev,
            resultsHistory: [...prev.resultsHistory, prev.result!],
            selectedPlugin: null,
            pluginDetails: null,
            formInputs: {
                text: resultText,
                ...(config.mode === 'geocache' && config.geocacheContext?.coordinates?.coordinatesRaw
                    ? { origin_coords: config.geocacheContext.coordinates.coordinatesRaw }
                    : {})
            },
            result: null,
            error: null
        }));
        
        messageService.info('Résultat utilisé comme entrée. Sélectionnez un nouveau plugin.');
    };

    const handleRequestAddWaypoint = React.useCallback((detail: AddWaypointEventDetail) => {
        if (config.mode !== 'geocache' || !config.geocacheContext) {
            return;
        }

        const event = new CustomEvent<AddWaypointEventDetail>('geoapp-plugin-add-waypoint', {
            detail
        });
        window.dispatchEvent(event);
        messageService.info('Coordonnées envoyées au widget Waypoints');
    }, [config.mode, config.geocacheContext, messageService]);

    interface CheckerRunResult {
        status?: 'success' | 'failure' | 'unknown';
        message?: string;
        evidence?: string | null;
        extracted?: Record<string, any>;
    }

    const getCandidateTextFromCoords = React.useCallback((coords?: { formatted?: string; latitude?: string; longitude?: string }): string => {
        if (!coords) {
            return '';
        }
        if (coords.formatted && String(coords.formatted).trim()) {
            return String(coords.formatted).trim();
        }
        const lat = (coords.latitude || '').toString().trim();
        const lon = (coords.longitude || '').toString().trim();
        return `${lat} ${lon}`.trim();
    }, []);

    const pickCheckerUrl = React.useCallback((checkers?: Array<{ name?: string; url?: string }>): string | null => {
        if (!checkers || checkers.length === 0) {
            return null;
        }
        const withUrl = checkers.filter(c => typeof c.url === 'string' && c.url.trim());
        if (withUrl.length === 0) {
            return null;
        }
        const pick = (...predicates: Array<(c: { name?: string; url?: string }) => boolean>) => {
            for (const pred of predicates) {
                const found = withUrl.find(pred);
                if (found && found.url) {
                    return found.url.trim();
                }
            }
            return withUrl[0].url!.trim();
        };

        return pick(
            c => (c.url || '').toLowerCase().includes('geocaching.com'),
            c => (c.name || '').toLowerCase().includes('geocaching'),
            c => (c.url || '').toLowerCase().includes('certitudes.org'),
            c => (c.name || '').toLowerCase().includes('certitude'),
            () => true
        );
    }, []);

    const isCertitudesUrl = React.useCallback((url: string): boolean => {
        const raw = (url || '').toLowerCase();
        return raw.includes('certitudes.org') || raw.includes('www.certitudes.org');
    }, []);

    const isGeocachingUrl = React.useCallback((url: string): boolean => {
        const raw = (url || '').toLowerCase();
        if (!raw.includes('geocaching.com')) {
            return false;
        }
        return raw.includes('/geocache/') || raw.includes('cache_details.aspx');
    }, []);

    const hasHttpScheme = React.useCallback((url: string): boolean => {
        return /^https?:\/\//i.test((url || '').trim());
    }, []);

    const normalizeKnownDomainUrl = React.useCallback((url: string): string => {
        const raw = (url || '').trim();
        if (!raw || hasHttpScheme(raw)) {
            return raw;
        }

        const lower = raw.toLowerCase();
        if (lower.includes('certitudes.org') || lower.includes('geocaching.com')) {
            return `https://${raw.replace(/^https?:\/\//i, '')}`;
        }

        return raw;
    }, [hasHttpScheme]);

    const normalizeGeocachingUrl = React.useCallback((url: string, wp?: string): { url: string } | { error: string } => {
        const raw = (url || '').trim();
        if (!raw) {
            return { error: 'Missing checker url' };
        }

        if (raw.startsWith('#') || raw === 'solution-checker' || raw === '#solution-checker') {
            if (!wp) {
                return { error: 'Invalid checker url (#solution-checker). Provide a GC code to build a valid Geocaching URL.' };
            }
            return { url: `https://www.geocaching.com/geocache/${encodeURIComponent(wp)}` };
        }

        if (raw.toLowerCase().includes('/geocache/#solution-checker') || raw.toLowerCase().includes('/geocache/#')) {
            if (!wp) {
                return { error: 'Geocaching checker url is missing the GC code. Provide a GC code to build a valid Geocaching URL.' };
            }
            return { url: `https://www.geocaching.com/geocache/${encodeURIComponent(wp)}` };
        }

        if (raw.startsWith('/')) {
            return { url: `https://www.geocaching.com${raw}` };
        }

        try {
            // eslint-disable-next-line no-new
            new URL(raw);
            return { url: raw };
        } catch {
            if (raw.toLowerCase().includes('geocaching.com')) {
                return { url: `https://${raw.replace(/^https?:\/\//i, '')}` };
            }
        }

        return { url: raw };
    }, []);

    const ensureCheckerSession = React.useCallback(async (params: {
        provider: string;
        wp?: string;
    }): Promise<{ provider: string; logged_in: boolean } | { error: string }> => {
        try {
            const res = await fetch(`${backendBaseUrl}/api/checkers/session/ensure`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ provider: params.provider, wp: params.wp })
            });

            const data = await res.json();
            if (!res.ok || data.status === 'error') {
                return { error: data.error || `HTTP ${res.status}` };
            }

            return { provider: data.provider, logged_in: Boolean(data.logged_in) };
        } catch (error: any) {
            return { error: error?.message || 'Unable to ensure checker session' };
        }
    }, [backendBaseUrl]);

    const loginCheckerSession = React.useCallback(async (params: {
        provider: string;
        wp?: string;
        timeoutSec: number;
    }): Promise<{ provider: string; logged_in: boolean } | { error: string }> => {
        try {
            const res = await fetch(`${backendBaseUrl}/api/checkers/session/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ provider: params.provider, wp: params.wp, timeout_sec: params.timeoutSec })
            });

            const data = await res.json();
            if (!res.ok || data.status === 'error') {
                return { error: data.error || `HTTP ${res.status}` };
            }

            return { provider: data.provider, logged_in: Boolean(data.logged_in) };
        } catch (error: any) {
            return { error: error?.message || 'Unable to login checker session' };
        }
    }, [backendBaseUrl]);

    const handleVerifyCoordinates = React.useCallback(async (coords?: { formatted?: string; latitude?: string; longitude?: string }): Promise<CheckerRunResult> => {
        if (config.mode !== 'geocache' || !config.geocacheContext) {
            return { status: 'unknown', message: 'Aucune géocache associée.' };
        }

        const candidate = getCandidateTextFromCoords(coords);
        if (!candidate) {
            return { status: 'unknown', message: 'Coordonnées invalides.' };
        }

        const checkerUrl = pickCheckerUrl(config.geocacheContext.checkers);
        if (!checkerUrl) {
            return { status: 'unknown', message: 'Aucun checker disponible pour cette géocache.' };
        }

        const wp = (config.geocacheContext.gcCode || '').trim();
        let url = checkerUrl;

        url = normalizeKnownDomainUrl(url);

        const rawLower = (url || '').trim().toLowerCase();
        const shouldNormalizeGeocaching =
            rawLower.startsWith('#') ||
            rawLower.includes('solution-checker') ||
            rawLower.includes('geocaching.com') ||
            rawLower.startsWith('/');

        if (shouldNormalizeGeocaching) {
            const normalized = normalizeGeocachingUrl(url, wp);
            if ('error' in normalized) {
                return { status: 'unknown', message: normalized.error };
            }
            url = normalized.url;
        }

        url = normalizeKnownDomainUrl(url);

        if (isGeocachingUrl(url)) {
            let ensureResult = await ensureCheckerSession({ provider: 'geocaching', wp });
            if ('error' in ensureResult) {
                return { status: 'unknown', message: ensureResult.error };
            }

            if (!ensureResult.logged_in) {
                messageService.info(
                    'Geocaching.com: session non connectée. Une fenêtre Chromium va s\'ouvrir pour le login. Connectez-vous puis revenez ici.'
                );
                const loginResult = await loginCheckerSession({ provider: 'geocaching', wp, timeoutSec: 180 });
                if ('error' in loginResult) {
                    return { status: 'unknown', message: loginResult.error };
                }

                ensureResult = await ensureCheckerSession({ provider: 'geocaching', wp });
                if ('error' in ensureResult) {
                    return { status: 'unknown', message: ensureResult.error };
                }

                if (!ensureResult.logged_in) {
                    return {
                        status: 'unknown',
                        message: 'Geocaching.com: session toujours non connectée après tentative de login.'
                    };
                }
            }
        }

        const interactive = isCertitudesUrl(url) || isGeocachingUrl(url);
        const endpoint = interactive ? '/api/checkers/run-interactive' : '/api/checkers/run';
        const body: any = {
            url,
            input: { candidate }
        };
        if (interactive) {
            body.timeout_sec = 300;
        }

        if (isCertitudesUrl(url)) {
            messageService.info('Certitude nécessite une validation manuelle. Une fenêtre Chromium va s\'ouvrir : cliquez sur “Certifier”, puis revenez ici.');
        }

        if (isGeocachingUrl(url)) {
            messageService.info('Geocaching.com: le “Solution Checker” peut nécessiter une session + un reCAPTCHA. Une fenêtre Chromium peut s\'ouvrir : résolvez le captcha puis cliquez sur “Check Solution”.');
        }

        const fetchTimeoutMs = (interactive ? 300 : 60) * 1000 + 10000;
        const controller = new AbortController();
        const timeoutHandle = window.setTimeout(() => controller.abort(), fetchTimeoutMs);

        try {
            const res = await fetch(`${backendBaseUrl}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(body),
                signal: controller.signal
            });

            const data = await res.json();
            if (!res.ok || data.status === 'error') {
                return { status: 'unknown', message: data.error || `HTTP ${res.status}` };
            }

            return data.result as CheckerRunResult;
        } catch (error: any) {
            return { status: 'unknown', message: error?.message || 'Erreur lors de l\'appel au checker.' };
        } finally {
            window.clearTimeout(timeoutHandle);
        }
    }, [config.mode, config.geocacheContext, getCandidateTextFromCoords, pickCheckerUrl, isGeocachingUrl, normalizeGeocachingUrl, ensureCheckerSession, loginCheckerSession, isCertitudesUrl, backendBaseUrl, messageService]);

    const handleSetAsCorrectedCoords = React.useCallback(async (gcCoords: string): Promise<void> => {
        if (config.mode !== 'geocache' || !config.geocacheContext?.geocacheId) {
            messageService.error('Aucune géocache associée.');
            return;
        }

        const geocacheId = config.geocacheContext.geocacheId;
        // Nettoyer le format pour correspondre à "N 48° 31.914 E 003° 24.304"
        const sanitizedCoords = gcCoords
            .replace(/[''ʼ′']/g, '')  // Retirer toutes les variantes d'apostrophes
            .replace(/,/g, '')        // Retirer les virgules
            .replace(/\s+/g, ' ')     // Normaliser les espaces multiples
            .trim();

        console.log('[Plugin Executor] Correcting coordinates:', { original: gcCoords, sanitized: sanitizedCoords });

        try {
            const response = await fetch(`${backendBaseUrl}/api/geocaches/${geocacheId}/coordinates`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ coordinates_raw: sanitizedCoords })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            messageService.info('Coordonnées corrigées mises à jour');

            // Émettre un événement pour rafraîchir le widget de détails si ouvert
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('geoapp-geocache-coordinates-updated', {
                    detail: { geocacheId, gcCode: config.geocacheContext.gcCode }
                }));
            }
        } catch (error) {
            console.error('[Plugin Executor] Erreur lors de la correction des coordonnées:', error);
            messageService.error('Erreur lors de la mise à jour des coordonnées');
        }
    }, [config.mode, config.geocacheContext, backendBaseUrl, messageService]);

    return (
        <div className='plugin-executor-container'>
            {/* En-tête MODE GEOCACHE */}
            {config.mode === 'geocache' && (
                <div className='plugin-executor-header'>
                    <h3>🎯 Analyse de géocache</h3>
                    <div className='geocache-context'>
                        <strong>{context.gcCode}</strong> - {context.name}
                        {context.coordinates && (
                            <div className='geocache-coords'>
                                📍 {context.coordinates.coordinatesRaw || 
                                    `${context.coordinates.latitude}, ${context.coordinates.longitude}`}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* En-tête MODE PLUGIN */}
            {config.mode === 'plugin' && (
                <div className='plugin-executor-header'>
                    <h3>🧩 Exécution de plugin</h3>
                    {context.gcCode && (
                        <div className='geocache-context' style={{ fontSize: '13px', opacity: 0.8 }}>
                            Associé à : <strong>{context.gcCode}</strong> - {context.name}
                        </div>
                    )}
                </div>
            )}

            {/* Sélecteur de plugin (MODE GEOCACHE uniquement) */}
            {config.mode === 'geocache' && (
                <div className='plugin-form'>
                    <h4>🔌 Choix du plugin</h4>
                    <select
                        value={state.selectedPlugin || ''}
                        onChange={(e) => setState(prev => ({ ...prev, selectedPlugin: e.target.value || null }))}
                        disabled={state.isExecuting}
                        className='theia-select'
                    >
                        <option value="">-- Sélectionner un plugin --</option>
                        {state.plugins.map(plugin => (
                            <option key={plugin.name} value={plugin.name}>
                                {plugin.name} - {plugin.description}
                            </option>
                        ))}
                    </select>
                </div>
            )}
            
            {/* Indicateur de chargement (MODE PLUGIN) */}
            {config.mode === 'plugin' && isLoadingInitial && (
                <div className='plugin-form' style={{ padding: '20px', textAlign: 'center' }}>
                    <div style={{ marginBottom: '10px' }}>⏳ Chargement du plugin...</div>
                    <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '10px' }}>
                        En attente de configuration
                    </div>
                </div>
            )}
            
            {/* Info du plugin (MODE PLUGIN) */}
            {config.mode === 'plugin' && state.pluginDetails && !isLoadingInitial && (
                <div className='plugin-form'>
                    <h4>📦 Plugin: {state.pluginDetails.name}</h4>
                    <p style={{ margin: '5px 0', fontSize: '13px', opacity: 0.8 }}>{state.pluginDetails.description}</p>
                </div>
            )}

            {/* Sélecteur de mode encode/decode (MODE PLUGIN uniquement) */}
            {config.mode === 'plugin' && state.canChangeMode && state.pluginDetails && (
                <div className='plugin-form'>
                    <h4>🎯 Mode d'exécution</h4>
                    <div className='form-field'>
                        <label>Action</label>
                        <select
                            value={state.formInputs.mode || 'decode'}
                            onChange={(e) => handleInputChange('mode', e.target.value)}
                            disabled={state.isExecuting}
                            className='theia-select'
                        >
                            <option value='decode'>🔓 Décoder (par défaut)</option>
                            <option value='encode'>🔐 Encoder</option>
                            {state.pluginDetails.metadata?.input_types?.mode?.options?.includes('detect') && (
                                <option value='detect'>🔍 Détecter</option>
                            )}
                        </select>
                    </div>
                </div>
            )}

            {/* Zone de texte - Toujours affichée si plugin chargé */}
            {state.pluginDetails && (
                <div className='plugin-form'>
                    <h4>{state.selectedPlugin === 'metasolver' ? '📝 Texte à décoder' : '📝 Texte à traiter'}</h4>
                    <div className='form-field'>
                        <label>
                            {state.selectedPlugin === 'metasolver'
                                ? 'Texte à décoder'
                                : state.formInputs.mode === 'encode' ? 'Texte à encoder' :
                                    context.gcCode ? 'Description / Énigme' : 'Texte à décoder'}
                            <span style={{ fontSize: '12px', opacity: 0.7, marginLeft: '8px' }}>
                                {state.selectedPlugin === 'metasolver'
                                    ? '(Collez un code, ou un texte contenant un code à extraire)'
                                    : "(Modifiez le texte avant d'exécuter le plugin)"}
                            </span>
                        </label>
                        <textarea
                            value={state.formInputs.text || ''}
                            onChange={(e) => handleInputChange('text', e.target.value)}
                            rows={8}
                            placeholder={state.formInputs.mode === 'encode' ? 
                                'Entrez le texte à encoder...' : 
                                state.selectedPlugin === 'metasolver'
                                    ? 'Collez ici le code à décoder...'
                                    : 'Collez ici le texte à analyser...'}
                            disabled={state.isExecuting}
                            style={{ width: '100%', fontFamily: 'monospace', fontSize: '13px' }}
                        />
                    </div>
                </div>
            )}

            {/* Formulaire dynamique */}
            {state.pluginDetails && state.selectedPlugin !== 'metasolver' && (
                <div className='plugin-form'>
                    <h4>⚙️ Paramètres</h4>
                    {renderDynamicForm(
                        state.pluginDetails.input_schema,
                        state.formInputs,
                        handleInputChange,
                        state.isExecuting,
                        state.pluginDetails.metadata
                    )}
                </div>
            )}

            {state.pluginDetails && state.selectedPlugin === 'analysis_web_page' && (
                <AnalysisWebPagePanel
                    pipeline={state.pluginDetails.metadata?.pipeline}
                    geocacheContext={config.geocacheContext}
                    autoExecute={config.autoExecute === true}
                    isExecuting={state.isExecuting}
                />
            )}

            {/* Metasolver: panneau de prévisualisation des plugins éligibles */}
            {state.pluginDetails && state.selectedPlugin === 'metasolver' && (
                <MetasolverPresetPanel
                    preset={state.formInputs.preset || 'all'}
                    pluginList={state.formInputs.plugin_list || ''}
                    text={String(state.formInputs.text || '')}
                    maxPlugins={typeof state.formInputs.max_plugins === 'number' ? state.formInputs.max_plugins : undefined}
                    detectCoordinates={state.formInputs.detect_coordinates !== false}
                    detectWrittenCoordinates={state.formInputs.detect_written_coordinates === true}
                    writtenCoordinatesLanguage={String(state.formInputs.written_coordinates_language || 'auto')}
                    enableBruteforce={state.formInputs.enable_bruteforce !== false}
                    streamingVerbosity={state.streamingVerbosity}
                    geocacheContext={config?.geocacheContext}
                    pluginsService={pluginsService}
                    preferenceService={preferenceService}
                    commandService={commandService}
                    backendBaseUrl={backendBaseUrl}
                    onTextChange={handleTextChange}
                    onPluginListChange={handlePluginListChange}
                    onSettingChange={handleInputChange}
                    onStreamingVerbosityChange={level => setState(prev => ({ ...prev, streamingVerbosity: level }))}
                    onExecuteRequest={handleExecute}
                    disabled={state.isExecuting}
                />
            )}
            
            {/* Options avancées : Brute-force et Scoring */}
            {state.pluginDetails && state.selectedPlugin !== 'metasolver' && (state.pluginDetails.metadata?.brute_force || state.pluginDetails.metadata?.enable_scoring) && (
                <div className='plugin-form'>
                    <h4>🔧 Options avancées</h4>
                    
                    {/* Option Brute-force */}
                    {state.pluginDetails.metadata?.brute_force && (
                        <div className='form-field' style={{ marginBottom: '10px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                                <input
                                    type='checkbox'
                                    checked={state.formInputs.brute_force || false}
                                    onChange={(e) => handleInputChange('brute_force', e.target.checked)}
                                    disabled={state.isExecuting}
                                    style={{ marginRight: '8px' }}
                                />
                                <span>💥 Utiliser le mode force brute</span>
                            </label>
                            <div className='field-description' style={{ marginLeft: '24px', fontSize: '12px', opacity: 0.7 }}>
                                Teste toutes les possibilités et retourne tous les résultats
                            </div>
                        </div>
                    )}
                    
                    {/* Option Scoring */}
                    {state.pluginDetails.metadata?.enable_scoring && (
                        <div className='form-field'>
                            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                                <input
                                    type='checkbox'
                                    checked={state.formInputs.enable_scoring !== false}
                                    onChange={(e) => handleInputChange('enable_scoring', e.target.checked)}
                                    disabled={state.isExecuting}
                                    style={{ marginRight: '8px' }}
                                />
                                <span>🎯 Activer le scoring automatique</span>
                            </label>
                            <div className='field-description' style={{ marginLeft: '24px', fontSize: '12px', opacity: 0.7 }}>
                                Évalue et classe les résultats par pertinence
                            </div>
                        </div>
                    )}
                    
                    {/* Option Détection de coordonnées */}
                    <div className='form-field' style={{ marginTop: '10px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                            <input
                                type='checkbox'
                                checked={state.formInputs.detect_coordinates || false}
                                onChange={(e) => handleInputChange('detect_coordinates', e.target.checked)}
                                disabled={state.isExecuting}
                                style={{ marginRight: '8px' }}
                            />
                            <span>📍 Détecter les coordonnées GPS</span>
                        </label>
                        <div className='field-description' style={{ marginLeft: '24px', fontSize: '12px', opacity: 0.7 }}>
                            Recherche automatique de coordonnées dans les résultats (peut ralentir l'affichage)
                        </div>

                        {state.formInputs.detect_coordinates && (
                            <div style={{ marginLeft: '24px', marginTop: '8px' }}>
                                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                                    <input
                                        type='checkbox'
                                        checked={state.formInputs.detect_written_coordinates || false}
                                        onChange={(e) => handleInputChange('detect_written_coordinates', e.target.checked)}
                                        disabled={state.isExecuting}
                                        style={{ marginRight: '8px' }}
                                    />
                                    <span>📝 Inclure coordonnées écrites (mots)</span>
                                </label>

                                {state.formInputs.detect_written_coordinates && (
                                    <div style={{ marginTop: '6px' }}>
                                        <label style={{ fontSize: '12px', opacity: 0.8, display: 'block', marginBottom: '4px' }}>
                                            Langue (simple)
                                        </label>
                                        <select
                                            value={String(state.formInputs.written_coordinates_language || 'auto')}
                                            onChange={(e) => handleInputChange('written_coordinates_language', e.target.value)}
                                            disabled={state.isExecuting}
                                            style={{ width: '220px' }}
                                        >
                                            <option value='auto'>Auto</option>
                                            <option value='fr'>FR</option>
                                            <option value='en'>EN</option>
                                            <option value='fr,en'>FR + EN</option>
                                        </select>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Boutons d'exécution */}
            {state.pluginDetails && (state.selectedPlugin !== 'metasolver' || state.isExecuting) && (
                <div className='execution-controls'>
                    {state.selectedPlugin !== 'metasolver' && (
                    <div className='execution-mode'>
                        <label>
                            <input
                                type='radio'
                                value='sync'
                                checked={state.executionMode === 'sync'}
                                onChange={(e) => setState(prev => ({ ...prev, executionMode: 'sync' }))}
                                disabled={state.isExecuting}
                            />
                            Synchrone
                        </label>
                        <label>
                            <input
                                type='radio'
                                value='async'
                                checked={state.executionMode === 'async'}
                                onChange={(e) => setState(prev => ({ ...prev, executionMode: 'async' }))}
                                disabled={state.isExecuting}
                            />
                            Asynchrone
                        </label>
                    </div>
                    )}

                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        {!state.isExecuting ? (
                            <button
                                className='theia-button main'
                                onClick={handleExecute}
                            >
                                Exécuter
                            </button>
                        ) : (
                            <>
                                <button
                                    className='theia-button main'
                                    disabled
                                    style={{ opacity: 0.7 }}
                                >
                                    Exécution…
                                </button>
                                <button
                                    className='theia-button secondary'
                                    onClick={handlePauseToggle}
                                    title={isPaused ? 'Reprendre' : 'Mettre en pause'}
                                    style={{
                                        minWidth: '32px',
                                        padding: '4px 8px',
                                        background: isPaused
                                            ? 'var(--theia-successBackground, #4caf50)'
                                            : 'var(--theia-warningBackground, #e6a817)',
                                        color: '#fff',
                                        border: 'none',
                                        borderRadius: '3px',
                                        cursor: 'pointer',
                                        fontSize: '13px',
                                    }}
                                >
                                    {isPaused ? '▶' : '⏸'}
                                </button>
                                <button
                                    className='theia-button secondary'
                                    onClick={handleStop}
                                    title={"Arrêter l'exécution"}
                                    style={{
                                        minWidth: '32px',
                                        padding: '4px 8px',
                                        background: 'var(--theia-errorBackground, #d32f2f)',
                                        color: '#fff',
                                        border: 'none',
                                        borderRadius: '3px',
                                        cursor: 'pointer',
                                        fontSize: '13px',
                                    }}
                                >
                                    ⏹
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Panneau de progression streaming metasolver (Phase 1: plugins + Phase 2: coords) */}
            {(state.isStreaming || state.coordsDetectionProgress !== null) && state.streamingEvents.length > 0 && (
                <MetasolverStreamingPanel
                    events={state.streamingEvents}
                    progress={state.streamingProgress}
                    verbosity={state.streamingVerbosity}
                    coordsDetectionProgress={state.coordsDetectionProgress}
                />
            )}

            {/* Affichage des résultats */}
            {state.result && (
                <div className='plugin-results'>
                    <h4>✅ Résultats</h4>
                    <PluginResultDisplay
                        result={state.result}
                        configMode={config.mode}
                        geocacheContext={config.geocacheContext}
                        pluginName={state.pluginDetails?.name || state.selectedPlugin}
                        pluginsService={pluginsService}
                        onRequestAddWaypoint={handleRequestAddWaypoint}
                        onVerifyCoordinates={handleVerifyCoordinates}
                        onSetAsCorrectedCoords={handleSetAsCorrectedCoords}
                        messageService={messageService}
                    />
                    
                    {/* Bouton d'enchaînement (MODE GEOCACHE uniquement) */}
                    {config.mode === 'geocache' && config.allowPluginChaining && (
                        <div style={{ marginTop: '15px', borderTop: '1px solid var(--theia-panel-border)', paddingTop: '15px' }}>
                            <button
                                className='theia-button secondary'
                                onClick={handleChainPlugin}
                                title='Utiliser ce résultat comme entrée pour un autre plugin'
                                style={{ width: '100%' }}
                            >
                                ↪ Enchaîner avec un autre plugin
                            </button>
                        </div>
                    )}
                </div>
            )}
            
            {/* Historique des enchaînements (MODE GEOCACHE) */}
            {config.mode === 'geocache' && state.resultsHistory.length > 0 && (
                <div className='plugin-history' style={{ marginTop: '10px', padding: '10px', background: 'var(--theia-editor-background)', borderRadius: '4px' }}>
                    <h5 style={{ margin: '0 0 8px 0', fontSize: '13px', opacity: 0.8 }}>📜 Historique des enchaînements</h5>
                    <div style={{ fontSize: '12px', opacity: 0.7 }}>
                        {state.resultsHistory.length} plugin(s) exécuté(s) précédemment
                    </div>
                </div>
            )}

            {/* Affichage des erreurs */}
            {state.error && (
                <div className='plugin-error'>
                    <h4>❌ Erreur</h4>
                    <pre>{state.error}</pre>
                </div>
            )}

            {/* Tâche créée */}
            {state.task && (
                <div className='plugin-task'>
                    <h4>⏱ Tâche créée</h4>
                    <div>ID: {state.task.task_id}</div>
                    <div>Statut: {state.task.status}</div>
                </div>
            )}
        </div>
    );
};

