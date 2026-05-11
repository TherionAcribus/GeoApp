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

const FORMULA_SOLVER_SOLVE_FROM_GEOCACHE_COMMAND = 'formula-solver:solve-from-geocache';
const GEOAPP_CHAT_DEFAULT_PROFILE_PREF = 'geoApp.chat.defaultProfile';
const GEOAPP_CHAT_SECRET_CODE_PROFILE_PREF = 'geoApp.chat.workflowProfile.secretCode';
const GEOAPP_CHAT_FORMULA_PROFILE_PREF = 'geoApp.chat.workflowProfile.formula';
const GEOAPP_CHAT_CHECKER_PROFILE_PREF = 'geoApp.chat.workflowProfile.checker';
const GEOAPP_CHAT_HIDDEN_CONTENT_PROFILE_PREF = 'geoApp.chat.workflowProfile.hiddenContent';
const GEOAPP_CHAT_IMAGE_PUZZLE_PROFILE_PREF = 'geoApp.chat.workflowProfile.imagePuzzle';

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

interface AddWaypointEventDetail {
    gcCoords: string;
    pluginName?: string;
    geocache?: {
        gcCode: string;
        name?: string;
    };
    sourceResultText?: string;
    waypointTitle?: string;
    waypointNote?: string;
    autoSave?: boolean;
    decimalLatitude?: number;
    decimalLongitude?: number;
}

const parseDdMCoordinate = (value?: string): number | null => {
    if (!value) {
        return null;
    }
    const normalized = value.trim().replace(/[,']/g, '.');
    const match = normalized.match(/^([NSEW])\s*(\d+)[°\s]+([\d.]+)/i);
    if (!match) {
        return null;
    }
    const direction = match[1].toUpperCase();
    const degrees = Number(match[2]);
    const minutes = Number(match[3]);
    if (Number.isNaN(degrees) || Number.isNaN(minutes)) {
        return null;
    }
    let decimal = degrees + minutes / 60;
    if (direction === 'S' || direction === 'W') {
        decimal = -decimal;
    }
    return decimal;
};

const convertDdMPairToDecimal = (latStr?: string, lonStr?: string): { latitude: number; longitude: number } | null => {
    const lat = parseDdMCoordinate(latStr);
    const lon = parseDdMCoordinate(lonStr);

    if (lat === null || lon === null) {
        return null;
    }

    return { latitude: lat, longitude: lon };
};

const convertCombinedCoordsToDecimal = (formatted?: string): { latitude: number; longitude: number } | null => {
    if (!formatted) {
        return null;
    }
    const trimmed = formatted.trim();

    // Format décimal simple "48.8566, 2.3522" ou "48.8566 2.3522"
    const decimalMatch = trimmed.match(/(-?\d+\.?\d*)[\s,]+(-?\d+\.?\d*)/);
    if (decimalMatch && !/[NSEW]/i.test(trimmed)) {
        const lat = Number(decimalMatch[1]);
        const lon = Number(decimalMatch[2]);
        if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
            return { latitude: lat, longitude: lon };
        }
    }

    // Format DDM combiné "N 48° 51.396 E 002° 21.132"
    const ddmMatch = trimmed.match(/([NS][^EW]*?\d[^EW]*)(?:\s+|,)([EW].+)/i);
    if (ddmMatch) {
        return convertDdMPairToDecimal(ddmMatch[1], ddmMatch[2]);
    }

    // Si déjà séparé par une virgule, tenter une conversion directe
    const parts = trimmed.split(',');
    if (parts.length === 2) {
        return convertDdMPairToDecimal(parts[0], parts[1]);
    }

    return null;
};

const extractDecimalCoordinates = (
    coordinates: any,
    fallbackFormatted?: string
): { latitude: number; longitude: number } | null => {
    if (!coordinates) {
        return convertCombinedCoordsToDecimal(fallbackFormatted);
    }

    if (typeof coordinates.latitude === 'number' && typeof coordinates.longitude === 'number') {
        return {
            latitude: coordinates.latitude,
            longitude: coordinates.longitude
        };
    }

    const backendDecimalLat = Number(
        coordinates.decimalLatitude ??
        coordinates.decimal_latitude ??
        coordinates.latitude_decimal ??
        coordinates.lat_decimal
    );
    const backendDecimalLon = Number(
        coordinates.decimalLongitude ??
        coordinates.decimal_longitude ??
        coordinates.longitude_decimal ??
        coordinates.lon_decimal
    );
    if (!Number.isNaN(backendDecimalLat) && !Number.isNaN(backendDecimalLon)) {
        return {
            latitude: backendDecimalLat,
            longitude: backendDecimalLon
        };
    }

    const fromStrings = convertDdMPairToDecimal(coordinates.latitude, coordinates.longitude);
    if (fromStrings) {
        return fromStrings;
    }

    return convertCombinedCoordsToDecimal(fallbackFormatted);
};

const deriveCoordinatesFromItem = (item: any): any | undefined => {
    if (!item) {
        return undefined;
    }

    if (item.coordinates) {
        return {
            ...item.coordinates,
            decimal_latitude: item.coordinates.decimal_latitude ?? item.decimal_latitude ?? item.decimalLatitude,
            decimal_longitude: item.coordinates.decimal_longitude ?? item.decimal_longitude ?? item.decimalLongitude
        };
    }

    const metadata = item.metadata as any;
    const gpsCoordinates = metadata?.gps_coordinates;
    if (gpsCoordinates && gpsCoordinates.exist) {
        return {
            latitude: gpsCoordinates.ddm_lat || '',
            longitude: gpsCoordinates.ddm_lon || '',
            formatted: gpsCoordinates.ddm || '',
            decimal_latitude: gpsCoordinates.decimal_latitude,
            decimal_longitude: gpsCoordinates.decimal_longitude
        };
    }

    if (typeof item.decimal_latitude === 'number' && typeof item.decimal_longitude === 'number') {
        return {
            latitude: item.decimal_latitude,
            longitude: item.decimal_longitude,
            formatted: item.coordinates?.formatted,
            decimal_latitude: item.decimal_latitude,
            decimal_longitude: item.decimal_longitude
        };
    }

    return undefined;
};

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
interface StreamingEvent {
    event: 'init' | 'plugin_start' | 'plugin_done' | 'plugin_error' | 'progress' | 'result' | 'error';
    data: any;
    timestamp: number;
}

interface StreamingProgress {
    completed: number;
    total: number;
    percentage: number;
    results_so_far: number;
    failures_so_far: number;
    elapsed_ms: number;
}

interface CoordsDetectionProgress {
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
        this.config = {
            mode: 'geocache',
            geocacheContext: context,
            pluginName,
            allowPluginChaining: true,  // Permet d'enchaîner les plugins
            autoExecute: autoExecute === true
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
        if (config.autoExecute && state.pluginDetails && state.selectedPlugin && !state.isExecuting && !state.result) {
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

    const handleInputChange = (key: string, value: any) => {
        setState(prev => ({
            ...prev,
            formInputs: { ...prev.formInputs, [key]: value }
        }));
    };
    
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
                    <h4>📝 Texte à traiter</h4>
                    <div className='form-field'>
                        <label>
                            {state.formInputs.mode === 'encode' ? 'Texte à encoder' : 
                             context.gcCode ? 'Description / Énigme' : 'Texte à décoder'}
                            <span style={{ fontSize: '12px', opacity: 0.7, marginLeft: '8px' }}>
                                (Modifiez le texte avant d'exécuter le plugin)
                            </span>
                        </label>
                        <textarea
                            value={state.formInputs.text || ''}
                            onChange={(e) => handleInputChange('text', e.target.value)}
                            rows={8}
                            placeholder={state.formInputs.mode === 'encode' ? 
                                'Entrez le texte à encoder...' : 
                                'Collez ici le texte à analyser...'}
                            disabled={state.isExecuting}
                            style={{ width: '100%', fontFamily: 'monospace', fontSize: '13px' }}
                        />
                    </div>
                </div>
            )}

            {/* Formulaire dynamique */}
            {state.pluginDetails && (
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

            {/* Metasolver: panneau de prévisualisation des plugins éligibles */}
            {state.pluginDetails && state.selectedPlugin === 'metasolver' && (
                <MetasolverPresetPanel
                    preset={state.formInputs.preset || 'all'}
                    pluginList={state.formInputs.plugin_list || ''}
                    text={String(state.formInputs.text || '')}
                    maxPlugins={typeof state.formInputs.max_plugins === 'number' ? state.formInputs.max_plugins : undefined}
                    geocacheContext={config?.geocacheContext}
                    pluginsService={pluginsService}
                    preferenceService={preferenceService}
                    commandService={commandService}
                    backendBaseUrl={backendBaseUrl}
                    onTextChange={(newText) => handleInputChange('text', newText)}
                    onPluginListChange={(newList) => handleInputChange('plugin_list', newList)}
                    onExecuteRequest={handleExecute}
                    disabled={state.isExecuting}
                />
            )}
            
            {/* Options avancées : Brute-force et Scoring */}
            {state.pluginDetails && (state.pluginDetails.metadata?.brute_force || state.pluginDetails.metadata?.enable_scoring) && (
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
            {state.pluginDetails && (
                <div className='execution-controls'>
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

                    {/* Sélecteur de verbosité pour metasolver */}
                    {state.selectedPlugin === 'metasolver' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                            <span style={{ opacity: 0.7 }}>Détail :</span>
                            {(['minimal', 'normal', 'detailed'] as const).map(level => (
                                <label key={level} style={{ cursor: 'pointer' }}>
                                    <input
                                        type='radio'
                                        value={level}
                                        checked={state.streamingVerbosity === level}
                                        onChange={() => setState(prev => ({ ...prev, streamingVerbosity: level }))}
                                        disabled={state.isExecuting}
                                        style={{ marginRight: '2px' }}
                                    />
                                    {level === 'minimal' ? 'Min' : level === 'normal' ? 'Normal' : 'Détaillé'}
                                </label>
                            ))}
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

/**
 * Panneau de progression streaming pour le metasolver.
 * Affiche en temps réel l'avancement de l'exécution des sous-plugins.
 */
const MetasolverStreamingPanel: React.FC<{
    events: StreamingEvent[];
    progress: StreamingProgress | null;
    verbosity: 'minimal' | 'normal' | 'detailed';
    coordsDetectionProgress?: CoordsDetectionProgress | null;
}> = ({ events, progress, verbosity, coordsDetectionProgress }) => {
    const scrollRef = React.useRef<HTMLDivElement>(null);

    // Auto-scroll vers le bas quand de nouveaux événements arrivent
    React.useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [events.length]);

    const initEvent = events.find(e => e.event === 'init');
    const totalPlugins = initEvent?.data?.total_plugins || progress?.total || 0;
    const pluginNames: string[] = initEvent?.data?.plugins || [];

    // Construire le statut de chaque plugin
    const pluginStatuses = React.useMemo(() => {
        const statuses: Record<string, { status: 'pending' | 'running' | 'done' | 'error'; time_ms?: number; result_count?: number; reason?: string; results?: any[] }> = {};
        for (const name of pluginNames) {
            statuses[name] = { status: 'pending' };
        }
        for (const evt of events) {
            const name = evt.data?.plugin;
            if (!name) continue;
            if (evt.event === 'plugin_start') {
                statuses[name] = { status: 'running' };
            } else if (evt.event === 'plugin_done') {
                statuses[name] = {
                    status: 'done',
                    time_ms: evt.data.execution_time_ms,
                    result_count: evt.data.result_count,
                    results: evt.data.results,
                };
            } else if (evt.event === 'plugin_error') {
                statuses[name] = {
                    status: 'error',
                    time_ms: evt.data.execution_time_ms,
                    reason: evt.data.reason,
                };
            }
        }
        return statuses;
    }, [events, pluginNames]);

    const pct = progress?.percentage ?? 0;
    const elapsed = progress?.elapsed_ms ? (progress.elapsed_ms / 1000).toFixed(1) : '0';
    const phase1Done = pct >= 100;

    const statusIcon = (s: string) => {
        switch (s) {
            case 'running': return '⏳';
            case 'done': return '✅';
            case 'error': return '❌';
            default: return '⬜';
        }
    };

    // Phase 2 progress
    const cdp = coordsDetectionProgress;
    const coordsPct = cdp && cdp.total > 0 ? Math.round((cdp.current / cdp.total) * 100) : 0;

    return (
        <div className='plugin-form' style={{ padding: '10px' }}>
            <h4 style={{ margin: '0 0 8px 0' }}>📡 Progression en direct</h4>

            {/* Phase 1: Exécution des plugins */}
            <div style={{ fontSize: '11px', fontWeight: 'bold', opacity: 0.6, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {phase1Done ? '✅' : '⏳'} Phase 1 — Exécution des plugins
            </div>

            {/* Barre de progression Phase 1 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <div style={{
                    flex: 1,
                    height: '6px',
                    background: 'var(--theia-editor-background)',
                    borderRadius: '3px',
                    overflow: 'hidden',
                }}>
                    <div style={{
                        width: `${pct}%`,
                        height: '100%',
                        background: phase1Done
                            ? 'var(--theia-successBackground, #4caf50)'
                            : 'var(--theia-progressBar-background, #0078d4)',
                        borderRadius: '3px',
                        transition: 'width 0.3s ease',
                    }} />
                </div>
                <span style={{ fontSize: '11px', fontWeight: 'bold', minWidth: '36px', textAlign: 'right' }}>
                    {pct.toFixed(0)}%
                </span>
            </div>

            {/* Résumé Phase 1 */}
            <div style={{ fontSize: '11px', opacity: 0.7, marginBottom: '8px', display: 'flex', gap: '10px' }}>
                <span>{progress?.completed ?? 0}/{totalPlugins} plugins</span>
                <span>{progress?.results_so_far ?? 0} rés.</span>
                {(progress?.failures_so_far ?? 0) > 0 && (
                    <span style={{ color: 'var(--theia-errorForeground)' }}>
                        {progress!.failures_so_far} err.
                    </span>
                )}
                <span style={{ opacity: 0.6 }}>{elapsed}s</span>
            </div>

            {/* Phase 2: Détection de coordonnées */}
            {cdp && (
                <>
                    <div style={{
                        fontSize: '11px', fontWeight: 'bold', opacity: 0.6, marginBottom: '4px',
                        textTransform: 'uppercase', letterSpacing: '0.5px',
                        borderTop: '1px solid var(--theia-panel-border)',
                        paddingTop: '8px',
                    }}>
                        {cdp.phase === 'done' ? '✅' : '⏳'} Phase 2 — Détection de coordonnées
                    </div>

                    {/* Barre de progression Phase 2 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <div style={{
                            flex: 1,
                            height: '6px',
                            background: 'var(--theia-editor-background)',
                            borderRadius: '3px',
                            overflow: 'hidden',
                        }}>
                            <div style={{
                                width: `${coordsPct}%`,
                                height: '100%',
                                background: cdp.phase === 'done'
                                    ? 'var(--theia-successBackground, #4caf50)'
                                    : '#e6a817',
                                borderRadius: '3px',
                                transition: 'width 0.2s ease',
                            }} />
                        </div>
                        <span style={{ fontSize: '11px', fontWeight: 'bold', minWidth: '36px', textAlign: 'right' }}>
                            {coordsPct}%
                        </span>
                    </div>

                    {/* Résumé Phase 2 */}
                    <div style={{ fontSize: '11px', opacity: 0.7, marginBottom: '4px', display: 'flex', gap: '10px' }}>
                        <span>{cdp.current}/{cdp.total} textes analysés</span>
                        <span>📍 {cdp.found} coordonnée(s)</span>
                    </div>

                    {/* Texte en cours d'analyse (verbosity normal ou detailed) */}
                    {verbosity !== 'minimal' && cdp.phase === 'running' && cdp.currentText && (
                        <div style={{
                            fontSize: '11px',
                            opacity: 0.5,
                            fontStyle: 'italic',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            marginBottom: '4px',
                        }}>
                            🔍 {cdp.currentText}
                        </div>
                    )}
                </>
            )}

            {/* Liste des plugins (verbosity normal ou detailed) */}
            {verbosity !== 'minimal' && pluginNames.length > 0 && (
                <div
                    ref={scrollRef}
                    style={{
                        maxHeight: verbosity === 'detailed' ? '400px' : '200px',
                        overflowY: 'auto',
                        fontSize: '12px',
                        borderTop: '1px solid var(--theia-panel-border)',
                        paddingTop: '6px',
                    }}
                >
                    {pluginNames.map(name => {
                        const s = pluginStatuses[name] || { status: 'pending' };
                        return (
                            <div key={name} style={{ marginBottom: verbosity === 'detailed' ? '6px' : '2px' }}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    opacity: s.status === 'pending' ? 0.4 : 1,
                                }}>
                                    <span>{statusIcon(s.status)}</span>
                                    <span style={{
                                        fontWeight: s.status === 'running' ? 'bold' : 'normal',
                                        minWidth: '130px',
                                    }}>
                                        {name}
                                    </span>
                                    {s.status === 'done' && (
                                        <span style={{ opacity: 0.6 }}>
                                            {s.result_count} rés. · {s.time_ms}ms
                                        </span>
                                    )}
                                    {s.status === 'error' && (
                                        <span style={{ color: 'var(--theia-errorForeground)', opacity: 0.8 }}>
                                            {s.reason ? (s.reason.length > 60 ? s.reason.slice(0, 60) + '…' : s.reason) : 'Erreur'}
                                            {s.time_ms ? ` · ${s.time_ms}ms` : ''}
                                        </span>
                                    )}
                                    {s.status === 'running' && (
                                        <span style={{ opacity: 0.6, fontStyle: 'italic' }}>en cours…</span>
                                    )}
                                </div>

                                {/* Résultats inline (verbosity detailed) */}
                                {verbosity === 'detailed' && s.status === 'done' && s.results && s.results.length > 0 && (
                                    <div style={{
                                        marginLeft: '24px',
                                        marginTop: '2px',
                                        padding: '4px 8px',
                                        background: 'var(--theia-editor-background)',
                                        borderRadius: '3px',
                                        fontSize: '11px',
                                        maxHeight: '80px',
                                        overflowY: 'auto',
                                    }}>
                                        {s.results.slice(0, 3).map((r: any, i: number) => (
                                            <div key={i} style={{ marginBottom: '2px' }}>
                                                <span style={{ opacity: 0.6 }}>#{i + 1}</span>{' '}
                                                {r.text_output
                                                    ? (r.text_output.length > 120
                                                        ? r.text_output.slice(0, 120) + '…'
                                                        : r.text_output)
                                                    : '(pas de texte)'}
                                                {r.confidence !== undefined && (
                                                    <span style={{ marginLeft: '6px', opacity: 0.5 }}>
                                                        [{(r.confidence * 100).toFixed(0)}%]
                                                    </span>
                                                )}
                                            </div>
                                        ))}
                                        {s.results.length > 3 && (
                                            <div style={{ opacity: 0.5 }}>+{s.results.length - 3} autres résultats</div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

type MetasolverSelectionMode = 'recommended' | 'preset' | 'manual';

const METASOLVER_CHARSET_ICONS: Record<string, string> = {
    letters: 'ABC',
    digits: '123',
    symbols: '#!@',
    words: 'Mot',
    mixed: 'Mix',
};

const parsePluginListValue = (value: string): string[] =>
    value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);

const buildSignatureBadges = (signature: MetasolverSignature): string[] => {
    const badges: string[] = [
        `Type ${signature.dominant_input_kind}`,
        `${signature.non_space_length} chars`,
        `${signature.group_count} groupe(s)`
    ];

    if (signature.looks_like_morse) {
        badges.push('Morse probable');
    }
    if (signature.looks_like_binary) {
        badges.push('Binaire probable');
    }
    if (signature.looks_like_hex) {
        badges.push('Hex probable');
    }
    if (signature.looks_like_phone_keypad) {
        badges.push('T9 probable');
    }
    if (signature.looks_like_multitap) {
        badges.push('Multitap probable');
    }
    if (signature.looks_like_chemical_symbols) {
        badges.push('Elements chimiques probables');
    }
    if (signature.looks_like_houdini_words) {
        badges.push('Houdini probable');
    }
    if (signature.looks_like_nak_nak) {
        badges.push('Nak Nak probable');
    }
    if (signature.looks_like_shadok) {
        badges.push('Shadok probable');
    }
    if (signature.looks_like_tom_tom) {
        badges.push('Tom Tom probable');
    }
    if (signature.looks_like_gold_bug) {
        badges.push('Gold-Bug probable');
    }
    if (signature.looks_like_postnet) {
        badges.push('POSTNET probable');
    }
    if (signature.looks_like_prime_sequence) {
        badges.push('Nombres premiers probables');
    }
    if (signature.looks_like_roman_numerals) {
        badges.push('Romain probable');
    }
    if (signature.looks_like_polybius) {
        badges.push('Polybe probable');
    }
    if (signature.looks_like_tap_code) {
        badges.push('Tap code probable');
    }
    if (signature.looks_like_bacon) {
        badges.push('Bacon probable');
    }
    if (signature.looks_like_coordinate_fragment) {
        badges.push('Coordonnées possibles');
    }

    return badges;
};

const LISTING_LABEL_TITLES: Record<string, string> = {
    secret_code: 'Code secret',
    hidden_content: 'Contenu cache',
    formula: 'Formule',
    word_game: 'Jeu',
    image_puzzle: 'Image',
    coord_transform: 'Coordonnees',
    checker_available: 'Checker',
};

const WORKFLOW_TITLES: Record<ResolutionWorkflowKind | 'general', string> = {
    general: 'General',
    secret_code: 'Code secret',
    formula: 'Formule',
    checker: 'Checker',
    hidden_content: 'Contenu cache',
    image_puzzle: 'Image',
    coord_transform: 'Coordonnees',
};

const PLAN_STATUS_LABELS: Record<ResolutionPlanStep['status'], string> = {
    planned: 'Planifie',
    completed: 'Pret',
    blocked: 'Bloque',
    skipped: 'Ignore',
};

const WORKFLOW_CONTROL_STATUS_LABELS: Record<ResolutionWorkflowResponse['control']['status'], string> = {
    ready: 'Pret',
    awaiting_input: 'Attente saisie',
    budget_exhausted: 'Budget epuise',
    stopped: 'Arrete',
    completed: 'Termine',
};

const GEO_PLAUSIBILITY_LABELS: Record<GeographicPlausibilityAssessment['status'], string> = {
    very_plausible: 'Tres plausible',
    plausible: 'Plausible',
    uncertain: 'A verifier',
    unlikely: 'Peu plausible',
    unknown: 'Indetermine',
};

const getPlanStatusBackground = (status: ResolutionPlanStep['status']): string => {
    if (status === 'completed') {
        return 'var(--theia-successBackground, var(--theia-list-activeSelectionBackground))';
    }
    if (status === 'blocked') {
        return 'var(--theia-errorBackground, var(--theia-inputValidation-errorBackground))';
    }
    if (status === 'skipped') {
        return 'var(--theia-editor-background)';
    }
    return 'var(--theia-input-background)';
};

const getGeoPlausibilityAccent = (status: GeographicPlausibilityAssessment['status']): string => {
    if (status === 'very_plausible' || status === 'plausible') {
        return 'var(--theia-successBackground, var(--theia-list-activeSelectionBackground))';
    }
    if (status === 'unlikely') {
        return 'var(--theia-errorBackground, var(--theia-inputValidation-errorBackground))';
    }
    return 'var(--theia-input-background)';
};

const formatCheckerCandidateFromCoordinates = (coordinates: any): string => {
    if (!coordinates || typeof coordinates !== 'object') {
        return '';
    }
    if (typeof coordinates.ddm === 'string' && coordinates.ddm.trim()) {
        return coordinates.ddm.trim();
    }
    if (typeof coordinates.formatted === 'string' && coordinates.formatted.trim()) {
        return coordinates.formatted.trim();
    }
    if (typeof coordinates.decimal === 'string' && coordinates.decimal.trim()) {
        return coordinates.decimal.trim();
    }
    if (coordinates.latitude !== undefined && coordinates.longitude !== undefined) {
        return `${coordinates.latitude}, ${coordinates.longitude}`;
    }
    return '';
};

type MetasolverWorkflowLogEntry = {
    id: string;
    category: 'archive' | 'chat' | 'classify' | 'formula' | 'secret' | 'recommend' | 'execute';
    message: string;
    detail?: string;
    timestamp: string;
};

export interface PluginExecutorResumeSnapshot {
    updatedAt?: string;
    currentText: string;
    recommendationSourceText: string;
    classification: ListingClassificationResponse | null;
    recommendation: MetasolverRecommendationResponse | null;
    workflowResolution: ResolutionWorkflowResponse | null;
    workflowEntries: MetasolverWorkflowLogEntry[];
}

type ArchivedMetasolverResumeState = PluginExecutorResumeSnapshot;

const MAX_ARCHIVED_WORKFLOW_ENTRIES = 12;

const truncateDiagnosticText = (value?: string | null, maxLength: number = 240): string => {
    const normalized = (value || '').replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return '';
    }
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
};

const formatDistanceKm = (value?: number | null): string => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return '';
    }
    return `${value.toFixed(value < 10 ? 2 : 1)} km`;
};

const createWorkflowEntry = (
    category: MetasolverWorkflowLogEntry['category'],
    message: string,
    detail?: string,
): MetasolverWorkflowLogEntry => ({
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    category,
    message,
    detail,
    timestamp: new Date().toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }),
});

const prependWorkflowEntries = (
    entries: MetasolverWorkflowLogEntry[],
    category: MetasolverWorkflowLogEntry['category'],
    message: string,
    detail?: string,
): MetasolverWorkflowLogEntry[] => [
    createWorkflowEntry(category, message, detail),
    ...entries,
].slice(0, MAX_ARCHIVED_WORKFLOW_ENTRIES);

const cloneListingClassification = (classification: ListingClassificationResponse | null): ListingClassificationResponse | null => {
    if (!classification) {
        return null;
    }

    return {
        source: classification.source,
        geocache: classification.geocache ? { ...classification.geocache } : null,
        title: classification.title ?? null,
        max_secret_fragments: classification.max_secret_fragments,
        labels: classification.labels.slice(0, 8).map(label => ({
            ...label,
            evidence: (label.evidence || []).slice(0, 3),
        })),
        recommended_actions: classification.recommended_actions.slice(0, 6),
        candidate_secret_fragments: classification.candidate_secret_fragments.slice(0, 5).map(fragment => ({
            ...fragment,
            text: truncateDiagnosticText(fragment.text, 320),
            evidence: (fragment.evidence || []).slice(0, 3),
        })),
        hidden_signals: classification.hidden_signals.slice(0, 6),
        formula_signals: classification.formula_signals.slice(0, 6),
        signal_summary: {
            has_title: Boolean(classification.signal_summary?.has_title),
            has_hint: Boolean(classification.signal_summary?.has_hint),
            has_description_html: Boolean(classification.signal_summary?.has_description_html),
            image_count: Number(classification.signal_summary?.image_count || 0),
            image_hint_count: Number(classification.signal_summary?.image_hint_count || 0),
            image_hint_sources: Array.isArray(classification.signal_summary?.image_hint_sources) ? classification.signal_summary.image_hint_sources.slice(0, 6) : [],
            checker_count: Number(classification.signal_summary?.checker_count || 0),
            waypoint_count: Number(classification.signal_summary?.waypoint_count || 0),
            formula_signal_count: Number(classification.signal_summary?.formula_signal_count || 0),
            variable_assignment_count: Number(classification.signal_summary?.variable_assignment_count || 0),
            has_formula_coordinate_placeholders: Boolean(classification.signal_summary?.has_formula_coordinate_placeholders),
            projection_keyword_count: Number(classification.signal_summary?.projection_keyword_count || 0),
            visual_image_signal_count: Number(classification.signal_summary?.visual_image_signal_count || 0),
            direct_structured_fragment_count: Number(classification.signal_summary?.direct_structured_fragment_count || 0),
            hidden_structured_fragment_count: Number(classification.signal_summary?.hidden_structured_fragment_count || 0),
            image_structured_fragment_count: Number(classification.signal_summary?.image_structured_fragment_count || 0),
            direct_domain_score: Number(classification.signal_summary?.direct_domain_score || 0),
            hidden_domain_score: Number(classification.signal_summary?.hidden_domain_score || 0),
            image_domain_score: Number(classification.signal_summary?.image_domain_score || 0),
            dominant_evidence_domain: classification.signal_summary?.dominant_evidence_domain ?? null,
            evidence_domain_gap: Number(classification.signal_summary?.evidence_domain_gap || 0),
            hybrid_domain_count: Number(classification.signal_summary?.hybrid_domain_count || 0),
            is_hybrid_listing: Boolean(classification.signal_summary?.is_hybrid_listing),
            ambiguous_domains: Array.isArray(classification.signal_summary?.ambiguous_domains) ? classification.signal_summary.ambiguous_domains.slice(0, 3) : [],
            is_ambiguous_hybrid: Boolean(classification.signal_summary?.is_ambiguous_hybrid),
            has_visual_only_image_clue: Boolean(classification.signal_summary?.has_visual_only_image_clue),
            hidden_signal_count: Number(classification.signal_summary?.hidden_signal_count || 0),
            hidden_comment_count: Number(classification.signal_summary?.hidden_comment_count || 0),
            hidden_text_count: Number(classification.signal_summary?.hidden_text_count || 0),
            secret_fragment_count: Number(classification.signal_summary?.secret_fragment_count || 0),
            best_secret_fragment_source: classification.signal_summary?.best_secret_fragment_source ?? null,
            best_secret_fragment_confidence: Number(classification.signal_summary?.best_secret_fragment_confidence || 0),
        },
    };
};

const cloneMetasolverRecommendation = (recommendation: MetasolverRecommendationResponse | null): MetasolverRecommendationResponse | null => {
    if (!recommendation) {
        return null;
    }

    return {
        ...recommendation,
        recommendations: recommendation.recommendations.slice(0, 8).map(item => ({
            ...item,
            reasons: (item.reasons || []).slice(0, 4),
        })),
        selected_plugins: recommendation.selected_plugins.slice(0, 8),
        explanation: recommendation.explanation?.slice(0, 6) || [],
    };
};

const cloneWorkflowResolution = (
    workflowResolution: ResolutionWorkflowResponse | null,
    classificationSnapshot?: ListingClassificationResponse | null,
): ResolutionWorkflowResponse | null => {
    if (!workflowResolution) {
        return null;
    }

    const secretExecution = workflowResolution.execution.secret_code;
    const formulaExecution = workflowResolution.execution.formula;
    const hiddenExecution = workflowResolution.execution.hidden_content;
    const imageExecution = workflowResolution.execution.image_puzzle;
    const checkerExecution = workflowResolution.execution.checker;

    return {
        source: workflowResolution.source,
        geocache: workflowResolution.geocache ? { ...workflowResolution.geocache } : null,
        title: workflowResolution.title ?? null,
        workflow: {
            ...workflowResolution.workflow,
            supporting_labels: (workflowResolution.workflow.supporting_labels || []).slice(0, 6),
        },
        workflow_candidates: workflowResolution.workflow_candidates.slice(0, 6).map(candidate => ({
            ...candidate,
            supporting_labels: (candidate.supporting_labels || []).slice(0, 6),
        })),
        classification: classificationSnapshot || cloneListingClassification(workflowResolution.classification) || {
            source: workflowResolution.source,
            geocache: workflowResolution.geocache ? { ...workflowResolution.geocache } : null,
            title: workflowResolution.title ?? null,
            max_secret_fragments: 0,
            labels: [],
            recommended_actions: [],
            candidate_secret_fragments: [],
            hidden_signals: [],
            formula_signals: [],
            signal_summary: {
                has_title: false,
                has_hint: false,
                has_description_html: false,
                image_count: 0,
                image_hint_count: 0,
                image_hint_sources: [],
                checker_count: 0,
                waypoint_count: 0,
                formula_signal_count: 0,
                variable_assignment_count: 0,
                has_formula_coordinate_placeholders: false,
                projection_keyword_count: 0,
                visual_image_signal_count: 0,
                direct_structured_fragment_count: 0,
                hidden_structured_fragment_count: 0,
                image_structured_fragment_count: 0,
                direct_domain_score: 0,
                hidden_domain_score: 0,
                image_domain_score: 0,
                dominant_evidence_domain: null,
                evidence_domain_gap: 0,
                hybrid_domain_count: 0,
                is_hybrid_listing: false,
                ambiguous_domains: [],
                is_ambiguous_hybrid: false,
                has_visual_only_image_clue: false,
                hidden_signal_count: 0,
                hidden_comment_count: 0,
                hidden_text_count: 0,
                secret_fragment_count: 0,
                best_secret_fragment_source: null,
                best_secret_fragment_confidence: 0,
            },
        },
        plan: workflowResolution.plan.slice(0, 10).map(step => ({ ...step })),
        execution: {
            secret_code: secretExecution ? {
                selected_fragment: secretExecution.selected_fragment ? {
                    ...secretExecution.selected_fragment,
                    text: truncateDiagnosticText(secretExecution.selected_fragment.text, 320),
                    evidence: (secretExecution.selected_fragment.evidence || []).slice(0, 3),
                } : null,
                direct_plugin_candidate: secretExecution.direct_plugin_candidate ? {
                    ...secretExecution.direct_plugin_candidate,
                    source_text: truncateDiagnosticText(secretExecution.direct_plugin_candidate.source_text || '', 320) || null,
                    axes: (secretExecution.direct_plugin_candidate.axes || []).slice(0, 4),
                    fallback_plugin_list: (secretExecution.direct_plugin_candidate.fallback_plugin_list || []).slice(0, 8),
                    plugin_inputs: secretExecution.direct_plugin_candidate.plugin_inputs ? { ...secretExecution.direct_plugin_candidate.plugin_inputs } : null,
                } : null,
                direct_plugin_result: secretExecution.direct_plugin_result ? {
                    ...secretExecution.direct_plugin_result,
                    top_results: (secretExecution.direct_plugin_result.top_results || []).slice(0, 5).map(result => ({ ...result })),
                } : null,
                recommendation: cloneMetasolverRecommendation(secretExecution.recommendation || null),
                metasolver_result: secretExecution.metasolver_result ? {
                    ...secretExecution.metasolver_result,
                    top_results: (secretExecution.metasolver_result.top_results || []).slice(0, 5).map(result => ({ ...result })),
                    failed_plugins: (secretExecution.metasolver_result.failed_plugins || []).slice(0, 6).map(plugin => ({ ...plugin })),
                } : null,
            } : null,
            formula: formulaExecution ? {
                formula_count: formulaExecution.formula_count,
                formulas: (formulaExecution.formulas || []).slice(0, 6).map(formula => ({ ...formula })),
                variables: (formulaExecution.variables || []).slice(0, 20),
                questions: { ...(formulaExecution.questions || {}) },
                found_question_count: formulaExecution.found_question_count,
                answer_search: formulaExecution.answer_search ? {
                    answers: Object.fromEntries(
                        Object.entries(formulaExecution.answer_search.answers || {}).slice(0, 20).map(([key, value]) => [
                            key,
                            {
                                question: value.question,
                                best_answer: value.best_answer,
                                recommended_value_type: value.recommended_value_type,
                                results: (value.results || []).slice(0, 6).map(result => ({ ...result })),
                                suggested_values: (value.suggested_values || []).slice(0, 8).map(item => ({ ...item })),
                            }
                        ])
                    ),
                    found_count: formulaExecution.answer_search.found_count,
                    missing: (formulaExecution.answer_search.missing || []).slice(0, 12),
                    search_context: formulaExecution.answer_search.search_context,
                } : null,
                calculated_coordinates: formulaExecution.calculated_coordinates
                    ? { ...formulaExecution.calculated_coordinates }
                    : null,
            } : null,
            hidden_content: hiddenExecution ? {
                inspected: Boolean(hiddenExecution.inspected),
                hidden_signals: (hiddenExecution.hidden_signals || []).slice(0, 8),
                comments: (hiddenExecution.comments || []).slice(0, 6),
                hidden_texts: (hiddenExecution.hidden_texts || []).slice(0, 6),
                items: (hiddenExecution.items || []).slice(0, 8).map(item => ({ ...item })),
                candidate_secret_fragments: (hiddenExecution.candidate_secret_fragments || []).slice(0, 6).map(fragment => ({
                    ...fragment,
                    text: truncateDiagnosticText(fragment.text, 320),
                    evidence: (fragment.evidence || []).slice(0, 3),
                })),
                selected_fragment: hiddenExecution.selected_fragment ? {
                    ...hiddenExecution.selected_fragment,
                    text: truncateDiagnosticText(hiddenExecution.selected_fragment.text, 320),
                    evidence: (hiddenExecution.selected_fragment.evidence || []).slice(0, 3),
                } : null,
                recommendation: cloneMetasolverRecommendation(hiddenExecution.recommendation || null),
                summary: hiddenExecution.summary,
            } : null,
            image_puzzle: imageExecution ? {
                inspected: Boolean(imageExecution.inspected),
                image_count: Number(imageExecution.image_count || 0),
                image_urls: (imageExecution.image_urls || []).slice(0, 8),
                items: (imageExecution.items || []).slice(0, 10).map(item => ({ ...item })),
                candidate_secret_fragments: (imageExecution.candidate_secret_fragments || []).slice(0, 6).map(fragment => ({
                    ...fragment,
                    text: truncateDiagnosticText(fragment.text, 320),
                    evidence: (fragment.evidence || []).slice(0, 3),
                })),
                selected_fragment: imageExecution.selected_fragment ? {
                    ...imageExecution.selected_fragment,
                    text: truncateDiagnosticText(imageExecution.selected_fragment.text, 320),
                    evidence: (imageExecution.selected_fragment.evidence || []).slice(0, 3),
                } : null,
                recommendation: cloneMetasolverRecommendation(imageExecution.recommendation || null),
                plugin_summaries: (imageExecution.plugin_summaries || []).slice(0, 6),
                coordinates_candidate: imageExecution.coordinates_candidate
                    ? (typeof imageExecution.coordinates_candidate === 'string'
                        ? imageExecution.coordinates_candidate
                        : { ...imageExecution.coordinates_candidate })
                    : null,
                geographic_plausibility: imageExecution.geographic_plausibility
                    ? { ...imageExecution.geographic_plausibility }
                    : null,
                summary: imageExecution.summary,
            } : null,
            checker: checkerExecution ? {
                ...checkerExecution,
                result: checkerExecution.result ? { ...checkerExecution.result } : null,
            } : null,
        },
        control: workflowResolution.control ? {
            ...workflowResolution.control,
            budget: { ...workflowResolution.control.budget },
            usage: { ...workflowResolution.control.usage },
            remaining: { ...workflowResolution.control.remaining },
            stop_reasons: (workflowResolution.control.stop_reasons || []).slice(0, 6),
        } : {
            status: 'completed',
            budget: {
                max_automated_steps: 0,
                max_metasolver_runs: 0,
                max_search_questions: 0,
                max_checker_runs: 0,
                max_coordinate_calculations: 0,
                max_vision_ocr_runs: 0,
                stop_on_checker_success: true,
            },
            usage: {
                automated_steps: 0,
                metasolver_runs: 0,
                search_questions: 0,
                checker_runs: 0,
                coordinate_calculations: 0,
                vision_ocr_runs: 0,
            },
            remaining: {
                automated_steps: 0,
                metasolver_runs: 0,
                search_questions: 0,
                checker_runs: 0,
                coordinate_calculations: 0,
                vision_ocr_runs: 0,
            },
            stop_reasons: [],
            can_run_next_step: false,
            requires_user_input: false,
            final_confidence: 0,
            summary: 'Aucun controle disponible.',
        },
        next_actions: workflowResolution.next_actions.slice(0, 8),
        explanation: workflowResolution.explanation.slice(0, 8),
    };
};

const buildArchiveResumeState = (
    text: string,
    workflowResolution: ResolutionWorkflowResponse | null,
    classification: ListingClassificationResponse | null,
    recommendation: MetasolverRecommendationResponse | null,
    recommendationSourceText: string,
    workflowEntries: MetasolverWorkflowLogEntry[],
): ArchivedMetasolverResumeState => {
    const classificationSnapshot = cloneListingClassification(classification);

    return {
        updatedAt: new Date().toISOString(),
        currentText: truncateDiagnosticText(text, 4000),
        recommendationSourceText: truncateDiagnosticText(recommendationSourceText, 1200),
        classification: classificationSnapshot,
        recommendation: cloneMetasolverRecommendation(recommendation),
        workflowResolution: cloneWorkflowResolution(workflowResolution, classificationSnapshot),
        workflowEntries: workflowEntries.slice(0, MAX_ARCHIVED_WORKFLOW_ENTRIES).map(entry => ({
            id: entry.id,
            category: entry.category,
            message: entry.message,
            detail: entry.detail,
            timestamp: entry.timestamp,
        })),
    };
};

const restoreArchiveResumeState = (rawValue: unknown): ArchivedMetasolverResumeState | null => {
    if (!rawValue || typeof rawValue !== 'object') {
        return null;
    }

    const summary = rawValue as {
        source?: string;
        updated_at?: string;
        current_text?: string;
        history_state?: Array<{
            recorded_at?: string;
            resume_state?: {
                updatedAt?: string;
                currentText?: string;
                recommendationSourceText?: string;
                classification?: ListingClassificationResponse | null;
                recommendation?: MetasolverRecommendationResponse | null;
                workflowResolution?: ResolutionWorkflowResponse | null;
                workflowEntries?: MetasolverWorkflowLogEntry[];
            } | null;
        }> | null;
        resume_state?: {
            updatedAt?: string;
            currentText?: string;
            recommendationSourceText?: string;
            classification?: ListingClassificationResponse | null;
            recommendation?: MetasolverRecommendationResponse | null;
            workflowResolution?: ResolutionWorkflowResponse | null;
            workflowEntries?: MetasolverWorkflowLogEntry[];
        } | null;
    };

    const selectedResumeState = summary.resume_state
        || (Array.isArray(summary.history_state)
            ? summary.history_state.find(entry => entry?.resume_state)?.resume_state
            : null);

    if (summary.source !== 'plugin_executor_metasolver' || !selectedResumeState) {
        return null;
    }

    const classification = cloneListingClassification(selectedResumeState.classification || null);
    const workflowResolution = cloneWorkflowResolution(selectedResumeState.workflowResolution || null, classification);
    const recommendation = cloneMetasolverRecommendation(selectedResumeState.recommendation || null);
    const workflowEntries = Array.isArray(selectedResumeState.workflowEntries)
        ? selectedResumeState.workflowEntries.slice(0, MAX_ARCHIVED_WORKFLOW_ENTRIES).map(entry => ({
            id: typeof entry.id === 'string' ? entry.id : `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            category: entry.category,
            message: entry.message,
            detail: entry.detail,
            timestamp: entry.timestamp,
        }))
        : [];

    return {
        updatedAt: selectedResumeState.updatedAt || summary.updated_at,
        currentText: typeof selectedResumeState.currentText === 'string'
            ? selectedResumeState.currentText
            : (typeof summary.current_text === 'string' ? summary.current_text : ''),
        recommendationSourceText: typeof selectedResumeState.recommendationSourceText === 'string'
            ? selectedResumeState.recommendationSourceText
            : '',
        classification,
        recommendation,
        workflowResolution,
        workflowEntries,
    };
};

const buildArchiveDiagnosticSummary = (
    geocacheContext: GeocacheContext | undefined,
    text: string,
    workflowResolution: ResolutionWorkflowResponse | null,
    classification: ListingClassificationResponse | null,
    recommendation: MetasolverRecommendationResponse | null,
    recommendationSourceText: string,
    workflowEntries: MetasolverWorkflowLogEntry[],
): Record<string, unknown> => {
    const classificationSnapshot = cloneListingClassification(classification);
    const recommendationSnapshot = cloneMetasolverRecommendation(recommendation);
    const workflowResolutionSnapshot = cloneWorkflowResolution(workflowResolution, classificationSnapshot);
    const resumeState = buildArchiveResumeState(
        text || geocacheContext?.description || '',
        workflowResolution,
        classification,
        recommendation,
        recommendationSourceText,
        workflowEntries,
    );

    return {
        source: 'plugin_executor_metasolver',
        schema_version: 2,
        updated_at: new Date().toISOString(),
        geocache: geocacheContext ? {
            geocache_id: geocacheContext.geocacheId,
            gc_code: geocacheContext.gcCode,
            name: geocacheContext.name,
        } : null,
        current_text: truncateDiagnosticText(text || geocacheContext?.description || '', 1200),
        workflow_resolution: workflowResolutionSnapshot ? {
            primary: {
                kind: workflowResolutionSnapshot.workflow.kind,
                confidence: workflowResolutionSnapshot.workflow.confidence,
                score: workflowResolutionSnapshot.workflow.score,
                reason: workflowResolutionSnapshot.workflow.reason,
                forced: workflowResolutionSnapshot.workflow.forced || false,
            },
            candidates: workflowResolutionSnapshot.workflow_candidates.slice(0, 4).map(candidate => ({
                kind: candidate.kind,
                confidence: candidate.confidence,
                score: candidate.score,
                reason: candidate.reason,
                supporting_labels: candidate.supporting_labels,
            })),
            explanation: workflowResolutionSnapshot.explanation.slice(0, 4),
            next_actions: workflowResolutionSnapshot.next_actions.slice(0, 6),
            plan: workflowResolutionSnapshot.plan.slice(0, 6).map(step => ({
                id: step.id,
                title: step.title,
                status: step.status,
                automated: step.automated,
                tool: step.tool,
                detail: step.detail,
            })),
            execution: workflowResolutionSnapshot.execution,
        } : null,
        classification: classificationSnapshot,
        labels: classificationSnapshot?.labels.map(label => ({
            name: label.name,
            confidence: label.confidence,
            evidence: label.evidence.slice(0, 3),
        })) || [],
        recommended_actions: classificationSnapshot?.recommended_actions.slice(0, 4) || [],
        formula_signals: classificationSnapshot?.formula_signals.slice(0, 4) || [],
        hidden_signals: classificationSnapshot?.hidden_signals.slice(0, 4) || [],
        secret_fragments: classificationSnapshot?.candidate_secret_fragments.slice(0, 3).map(fragment => ({
            text: truncateDiagnosticText(fragment.text, 160),
            source: fragment.source,
            confidence: fragment.confidence,
            evidence: fragment.evidence.slice(0, 2),
        })) || [],
        metasolver: recommendationSnapshot ? {
            requested_preset: recommendationSnapshot.requested_preset || null,
            preset: recommendationSnapshot.effective_preset,
            preset_label: recommendationSnapshot.effective_preset_label,
            mode: recommendationSnapshot.mode,
            max_plugins: recommendationSnapshot.max_plugins,
            signature: recommendationSnapshot.signature,
            selected_plugins: recommendationSnapshot.selected_plugins.slice(0, 8),
            plugin_list: recommendationSnapshot.plugin_list,
            explanation: recommendationSnapshot.explanation?.slice(0, 4) || [],
            top_recommendations: recommendationSnapshot.recommendations.slice(0, 5).map(item => ({
                name: item.name,
                confidence: item.confidence,
                score: item.score,
                reasons: item.reasons.slice(0, 3),
            })),
            recommendation_source_text: truncateDiagnosticText(recommendationSourceText, 800),
        } : null,
        workflow: workflowEntries.slice(0, 8).map(entry => ({
            category: entry.category,
            message: entry.message,
            detail: entry.detail,
            timestamp: entry.timestamp,
        })),
        resume_state: {
            updatedAt: resumeState.updatedAt,
            currentText: resumeState.currentText,
            recommendationSourceText: resumeState.recommendationSourceText,
            classification: resumeState.classification,
            recommendation: resumeState.recommendation,
            workflowResolution: resumeState.workflowResolution,
            workflowEntries: resumeState.workflowEntries,
        },
    };
};

const MetasolverPresetPanel: React.FC<{
    preset: string;
    pluginList: string;
    text: string;
    maxPlugins?: number;
    geocacheContext?: GeocacheContext;
    pluginsService: PluginsService;
    preferenceService: PreferenceService;
    commandService: CommandService;
    backendBaseUrl: string;
    onTextChange: (newText: string) => void;
    onPluginListChange: (newList: string) => void;
    onExecuteRequest: () => void;
    disabled: boolean;
}> = ({ preset, pluginList, text, maxPlugins, geocacheContext, pluginsService, preferenceService, commandService, backendBaseUrl, onTextChange, onPluginListChange, onExecuteRequest, disabled }) => {
    const [eligiblePlugins, setEligiblePlugins] = React.useState<MetasolverEligiblePlugin[]>([]);
    const [workflowResolution, setWorkflowResolution] = React.useState<ResolutionWorkflowResponse | null>(null);
    const [classification, setClassification] = React.useState<ListingClassificationResponse | null>(null);
    const [recommendation, setRecommendation] = React.useState<MetasolverRecommendationResponse | null>(null);
    const [recommendationSourceText, setRecommendationSourceText] = React.useState<string>('');
    const [loadingClassification, setLoadingClassification] = React.useState(false);
    const [loadingEligible, setLoadingEligible] = React.useState(false);
    const [loadingRecommendation, setLoadingRecommendation] = React.useState(false);
    const [runningWorkflowStepId, setRunningWorkflowStepId] = React.useState<string | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [pendingAutoExecutionText, setPendingAutoExecutionText] = React.useState<string | null>(null);
    const [workflowEntries, setWorkflowEntries] = React.useState<MetasolverWorkflowLogEntry[]>([]);
    const [archivedResumeState, setArchivedResumeState] = React.useState<ArchivedMetasolverResumeState | null>(null);
    const [expanded, setExpanded] = React.useState(false);
    const [selectionMode, setSelectionMode] = React.useState<MetasolverSelectionMode>(
        pluginList.trim() ? 'manual' : 'recommended'
    );
    const [manualSelectedPlugins, setManualSelectedPlugins] = React.useState<Set<string>>(new Set(parsePluginListValue(pluginList)));
    const autoApplyKeyRef = React.useRef<string | null>(null);
    const lastWorkflowLogKeyRef = React.useRef<string>('');
    const lastRecommendationLogKeyRef = React.useRef<string>('');
    const autoRestoredArchiveGcCodeRef = React.useRef<string>('');
    const skipNextWorkflowRefreshRef = React.useRef(false);
    const skipNextRecommendationRefreshRef = React.useRef(false);
    const geoAppWorkflowKind = React.useMemo(() => {
        return resolvePluginExecutorGeoAppWorkflowKind(workflowResolution, classification);
    }, [workflowResolution, classification]);
    const geoAppChatProfile = React.useMemo(() => {
        const normalizeWorkflowProfile = (value: unknown): 'default' | 'local' | 'fast' | 'strong' | 'web' | undefined => {
            return value === 'default' || value === 'local' || value === 'fast' || value === 'strong' || value === 'web'
                ? value
                : undefined;
        };
        const normalizeProfile = (value: unknown): 'local' | 'fast' | 'strong' | 'web' => {
            return value === 'local' || value === 'fast' || value === 'strong' || value === 'web' ? value : 'fast';
        };

        const defaultProfile = normalizeProfile(preferenceService.get(GEOAPP_CHAT_DEFAULT_PROFILE_PREF, 'fast'));
        const workflowPreferenceKey = geoAppWorkflowKind === 'secret_code'
            ? GEOAPP_CHAT_SECRET_CODE_PROFILE_PREF
            : geoAppWorkflowKind === 'formula'
                ? GEOAPP_CHAT_FORMULA_PROFILE_PREF
                : geoAppWorkflowKind === 'checker'
                    ? GEOAPP_CHAT_CHECKER_PROFILE_PREF
                    : geoAppWorkflowKind === 'hidden_content'
                        ? GEOAPP_CHAT_HIDDEN_CONTENT_PROFILE_PREF
                        : geoAppWorkflowKind === 'image_puzzle'
                            ? GEOAPP_CHAT_IMAGE_PUZZLE_PROFILE_PREF
                            : undefined;

        if (!workflowPreferenceKey) {
            return defaultProfile;
        }

        const workflowProfile = normalizeWorkflowProfile(preferenceService.get(workflowPreferenceKey, 'default'));
        if (!workflowProfile || workflowProfile === 'default') {
            return defaultProfile;
        }
        return workflowProfile;
    }, [geoAppWorkflowKind, preferenceService]);

    React.useEffect(() => {
        setSelectionMode(prev => pluginList.trim() ? 'manual' : (prev === 'preset' ? 'preset' : 'recommended'));
        setManualSelectedPlugins(new Set(parsePluginListValue(pluginList)));
    }, [pluginList]);

    React.useEffect(() => {
        setSelectionMode(prev => pluginList.trim() ? 'manual' : (prev === 'preset' ? 'preset' : 'recommended'));
        setManualSelectedPlugins(new Set(parsePluginListValue(pluginList)));
        autoApplyKeyRef.current = null;
    }, [preset]);

    const appendWorkflowEntry = React.useCallback((
        category: MetasolverWorkflowLogEntry['category'],
        message: string,
        detail?: string,
    ) => {
        setWorkflowEntries(prev => prependWorkflowEntries(prev, category, message, detail));
    }, []);

    const applyArchivedResumeSnapshot = React.useCallback((
        snapshot: ArchivedMetasolverResumeState,
        mode: 'auto' | 'manual',
    ) => {
        const gcCode = (geocacheContext?.gcCode || '').trim();
        const archiveLabel = gcCode || snapshot.updatedAt || 'archive';
        const workflowLog = prependWorkflowEntries(
            snapshot.workflowEntries || [],
            'archive',
            mode === 'auto' ? 'Etat restaure automatiquement depuis l archive' : 'Etat restaure depuis l archive',
            archiveLabel
        );

        setWorkflowResolution(snapshot.workflowResolution);
        setClassification(snapshot.classification);
        setRecommendation(snapshot.recommendation);
        setRecommendationSourceText(snapshot.recommendationSourceText || '');
        setWorkflowEntries(workflowLog);
        setError(null);
        setExpanded(true);
        setPendingAutoExecutionText(null);
        skipNextWorkflowRefreshRef.current = true;
        skipNextRecommendationRefreshRef.current = true;

        if (snapshot.currentText && (mode === 'manual' || !(text || '').trim())) {
            onTextChange(snapshot.currentText);
        }

        if (snapshot.recommendation?.plugin_list && (mode === 'manual' || !pluginList.trim())) {
            onPluginListChange(snapshot.recommendation.plugin_list);
            setSelectionMode('recommended');
            setManualSelectedPlugins(new Set(snapshot.recommendation.selected_plugins || []));
        }
    }, [geocacheContext?.gcCode, onPluginListChange, onTextChange, pluginList, text]);

    React.useEffect(() => {
        const contextSnapshot = geocacheContext?.resumeSnapshot || null;
        if (contextSnapshot) {
            const gcCode = (geocacheContext?.gcCode || '').trim().toUpperCase();
            if (gcCode) {
                autoRestoredArchiveGcCodeRef.current = gcCode;
            }
            setArchivedResumeState(contextSnapshot);
            applyArchivedResumeSnapshot(contextSnapshot, 'manual');
            return;
        }

        let cancelled = false;
        const gcCode = (geocacheContext?.gcCode || '').trim().toUpperCase();
        autoRestoredArchiveGcCodeRef.current = gcCode === autoRestoredArchiveGcCodeRef.current
            ? autoRestoredArchiveGcCodeRef.current
            : '';

        if (!gcCode) {
            setArchivedResumeState(null);
            return () => { cancelled = true; };
        }

        const fetchArchivedResumeState = async () => {
            try {
                const response = await fetch(`${backendBaseUrl}/api/archive/${encodeURIComponent(gcCode)}`, {
                    credentials: 'include',
                });
                if (response.status === 404) {
                    if (!cancelled) {
                        setArchivedResumeState(null);
                    }
                    return;
                }
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const archive = await response.json();
                const restored = restoreArchiveResumeState(archive?.resolution_diagnostics);
                if (!cancelled) {
                    setArchivedResumeState(restored);
                }
            } catch (archiveError) {
                if (!cancelled) {
                    console.warn('[MetasolverPresetPanel] Archive resume load failed', archiveError);
                    setArchivedResumeState(null);
                }
            }
        };

        void fetchArchivedResumeState();
        return () => { cancelled = true; };
    }, [applyArchivedResumeSnapshot, backendBaseUrl, geocacheContext?.gcCode, geocacheContext?.resumeSnapshot]);

    React.useEffect(() => {
        const gcCode = (geocacheContext?.gcCode || '').trim().toUpperCase();
        if (!gcCode || !archivedResumeState) {
            return;
        }
        if (autoRestoredArchiveGcCodeRef.current === gcCode) {
            return;
        }

        const shouldAutoRestore = !(text || '').trim()
            && !pluginList.trim()
            && !workflowResolution
            && !classification
            && !recommendation
            && workflowEntries.length === 0;
        if (!shouldAutoRestore) {
            return;
        }

        autoRestoredArchiveGcCodeRef.current = gcCode;
        applyArchivedResumeSnapshot(archivedResumeState, 'auto');
    }, [
        applyArchivedResumeSnapshot,
        archivedResumeState,
        classification,
        geocacheContext?.gcCode,
        pluginList,
        recommendation,
        text,
        workflowEntries.length,
        workflowResolution,
    ]);

    React.useEffect(() => {
        let cancelled = false;

        const fetchEligible = async () => {
            setLoadingEligible(true);
            setError(null);
            try {
                const data = await pluginsService.getMetasolverEligiblePlugins(preset);
                if (!cancelled) {
                    setEligiblePlugins(data.plugins || []);
                }
            } catch (err: any) {
                if (!cancelled) {
                    setError(err?.message || 'Erreur de chargement');
                    setEligiblePlugins([]);
                }
            } finally {
                if (!cancelled) {
                    setLoadingEligible(false);
                }
            }
        };

        void fetchEligible();
        return () => { cancelled = true; };
    }, [preset, pluginsService]);

    React.useEffect(() => {
        let cancelled = false;

        const timeoutId = window.setTimeout(() => {
            const fetchWorkflowResolution = async () => {
                if (skipNextWorkflowRefreshRef.current) {
                    skipNextWorkflowRefreshRef.current = false;
                    setLoadingClassification(false);
                    return;
                }

                const trimmedText = (text || '').trim();
                const geocacheId = typeof geocacheContext?.geocacheId === 'number' ? geocacheContext.geocacheId : undefined;
                const hasDirectInput = Boolean(trimmedText || geocacheContext?.hint || geocacheContext?.name);

                if (!geocacheId && !hasDirectInput) {
                    setWorkflowResolution(null);
                    setClassification(null);
                    setLoadingClassification(false);
                    return;
                }

                setLoadingClassification(true);
                setError(null);
                try {
                    const data = await pluginsService.resolveWorkflow({
                        geocache_id: geocacheId,
                        title: geocacheContext?.name || undefined,
                        description: trimmedText || geocacheContext?.description || undefined,
                        hint: geocacheContext?.hint || undefined,
                        waypoints: geocacheContext?.waypoints,
                        checkers: geocacheContext?.checkers,
                        images: geocacheContext?.images,
                        max_secret_fragments: 5,
                        metasolver_preset: preset,
                        metasolver_mode: 'decode',
                        max_plugins: maxPlugins,
                    });
                    if (!cancelled) {
                        setWorkflowResolution(data);
                        setClassification(data.classification || null);
                    }
                } catch (err: any) {
                    if (!cancelled) {
                        setError(err?.message || 'Erreur de resolution du workflow');
                        setWorkflowResolution(null);
                        setClassification(null);
                    }
                } finally {
                    if (!cancelled) {
                        setLoadingClassification(false);
                    }
                }
            };

            void fetchWorkflowResolution();
        }, 300);

        return () => {
            cancelled = true;
            window.clearTimeout(timeoutId);
        };
    }, [text, geocacheContext, maxPlugins, pluginsService, preset]);

    React.useEffect(() => {
        let cancelled = false;
        if (skipNextRecommendationRefreshRef.current) {
            skipNextRecommendationRefreshRef.current = false;
            return undefined;
        }

        const trimmedText = (text || '').trim();
        const orchestratorFragmentText = (workflowResolution?.execution.secret_code?.selected_fragment?.text || '').trim();
        const orchestratorRecommendation = workflowResolution?.execution.secret_code?.recommendation || null;

        if (!trimmedText && orchestratorRecommendation && orchestratorFragmentText) {
            setRecommendation(orchestratorRecommendation);
            setRecommendationSourceText(orchestratorFragmentText);
            setLoadingRecommendation(false);
            return undefined;
        }

        if (!trimmedText) {
            setRecommendation(null);
            setRecommendationSourceText('');
            setLoadingRecommendation(false);
            return undefined;
        }

        if (orchestratorRecommendation && orchestratorFragmentText === trimmedText) {
            setRecommendation(orchestratorRecommendation);
            setRecommendationSourceText(trimmedText);
            setLoadingRecommendation(false);
            return undefined;
        }

        const timeoutId = window.setTimeout(() => {
            const fetchRecommendation = async () => {
                setLoadingRecommendation(true);
                setError(null);
                try {
                    const data = await pluginsService.recommendMetasolverPlugins({
                        text: trimmedText,
                        preset,
                        mode: 'decode',
                        max_plugins: maxPlugins
                    });
                    if (!cancelled) {
                        setRecommendation(data);
                        setRecommendationSourceText(trimmedText);
                    }
                } catch (err: any) {
                    if (!cancelled) {
                        setError(err?.message || 'Erreur de recommandation');
                        setRecommendation(null);
                        setRecommendationSourceText('');
                    }
                } finally {
                    if (!cancelled) {
                        setLoadingRecommendation(false);
                    }
                }
            };

            void fetchRecommendation();
        }, 350);

        return () => {
            cancelled = true;
            window.clearTimeout(timeoutId);
        };
    }, [text, preset, maxPlugins, pluginsService, workflowResolution]);

    React.useEffect(() => {
        if (!recommendation || selectionMode !== 'recommended') {
            return;
        }
        if (pluginList.trim()) {
            return;
        }
        if (!recommendationSourceText || recommendationSourceText !== (text || '').trim()) {
            return;
        }

        const key = `${preset}::${text}::${maxPlugins ?? ''}`;
        if (autoApplyKeyRef.current === key) {
            return;
        }

        autoApplyKeyRef.current = key;
        const recommendedNames = recommendation.selected_plugins || [];
        setManualSelectedPlugins(new Set(recommendedNames));
        onPluginListChange(recommendation.plugin_list || '');
    }, [recommendation, selectionMode, pluginList, preset, text, maxPlugins, onPluginListChange]);

    React.useEffect(() => {
        if (!workflowResolution || !classification) {
            return;
        }

        const key = JSON.stringify({
            workflow: workflowResolution.workflow.kind,
            workflow_confidence: workflowResolution.workflow.confidence,
            labels: classification.labels.map(label => [label.name, label.confidence]),
            topFragment: classification.candidate_secret_fragments?.[0]?.text || '',
        });
        if (lastWorkflowLogKeyRef.current === key) {
            return;
        }
        lastWorkflowLogKeyRef.current = key;

        const workflowTitle = WORKFLOW_TITLES[workflowResolution.workflow.kind] || workflowResolution.workflow.kind;
        const detail = workflowResolution.explanation?.[1]
            || (classification.candidate_secret_fragments?.[0]?.text
                ? `Meilleur fragment: ${classification.candidate_secret_fragments[0].text.slice(0, 60)}`
                : classification.formula_signals?.[0]);
        appendWorkflowEntry(
            'classify',
            `Workflow principal: ${workflowTitle} ${(workflowResolution.workflow.confidence * 100).toFixed(0)}%`,
            detail
        );
    }, [workflowResolution, classification, appendWorkflowEntry]);

    React.useEffect(() => {
        if (!recommendation || !recommendationSourceText) {
            return;
        }

        const key = `${recommendationSourceText}::${recommendation.plugin_list}`;
        if (lastRecommendationLogKeyRef.current === key) {
            return;
        }
        lastRecommendationLogKeyRef.current = key;

        const selected = recommendation.selected_plugins.slice(0, 4).join(', ') || 'aucun plugin';
        appendWorkflowEntry(
            'recommend',
            `Recommendation metasolver: ${selected}`,
            `Texte source: ${recommendationSourceText.slice(0, 60)}`
        );
    }, [recommendation, recommendationSourceText, appendWorkflowEntry]);

    React.useEffect(() => {
        if (!pendingAutoExecutionText) {
            return;
        }

        const currentText = (text || '').trim();
        if (currentText !== pendingAutoExecutionText) {
            return;
        }
        if (loadingClassification || loadingRecommendation || disabled) {
            return;
        }
        if (!recommendation) {
            return;
        }
        if (recommendationSourceText !== pendingAutoExecutionText) {
            return;
        }

        const expectedPluginList = (recommendation.plugin_list || '').trim();
        const currentPluginList = (pluginList || '').trim();
        if (currentPluginList !== expectedPluginList) {
            return;
        }

        appendWorkflowEntry(
            'execute',
            'Execution automatique du metasolver',
            `Texte: ${pendingAutoExecutionText.slice(0, 60)}`
        );
        setPendingAutoExecutionText(null);
        onExecuteRequest();
    }, [
        pendingAutoExecutionText,
        text,
        recommendation,
        recommendationSourceText,
        pluginList,
        loadingClassification,
        loadingRecommendation,
        disabled,
        appendWorkflowEntry,
        onExecuteRequest,
    ]);

    const currentSelectedPlugins = React.useMemo(() => {
        if (selectionMode === 'preset' && !pluginList.trim()) {
            return new Set(eligiblePlugins.map(plugin => plugin.name));
        }
        if (manualSelectedPlugins.size > 0) {
            return manualSelectedPlugins;
        }
        if (recommendation?.selected_plugins?.length) {
            return new Set(recommendation.selected_plugins);
        }
        return new Set(eligiblePlugins.map(plugin => plugin.name));
    }, [eligiblePlugins, manualSelectedPlugins, pluginList, recommendation, selectionMode]);

    const applyRecommendation = React.useCallback(() => {
        if (!recommendation) {
            return;
        }
        const names = new Set(recommendation.selected_plugins || []);
        if (!(text || '').trim() && recommendationSourceText) {
            onTextChange(recommendationSourceText);
        }
        setSelectionMode('recommended');
        setManualSelectedPlugins(names);
        onPluginListChange(recommendation.plugin_list || '');
        appendWorkflowEntry('recommend', 'Recommendation appliquee', recommendation.selected_plugins.slice(0, 4).join(', '));
    }, [recommendation, text, recommendationSourceText, onTextChange, onPluginListChange, appendWorkflowEntry]);

    const useFullPreset = React.useCallback(() => {
        setSelectionMode('preset');
        setManualSelectedPlugins(new Set(eligiblePlugins.map(plugin => plugin.name)));
        onPluginListChange('');
        appendWorkflowEntry('recommend', `Preset complet applique (${eligiblePlugins.length} plugins)`);
    }, [eligiblePlugins, onPluginListChange, appendWorkflowEntry]);

    const handleTogglePlugin = React.useCallback((pluginName: string, checked: boolean) => {
        setManualSelectedPlugins(prev => {
            const next = new Set(prev.size > 0 ? prev : Array.from(currentSelectedPlugins));
            if (checked) {
                next.add(pluginName);
            } else {
                next.delete(pluginName);
            }

            if (next.size === 0) {
                setSelectionMode('preset');
                onPluginListChange('');
                return new Set(eligiblePlugins.map(plugin => plugin.name));
            }

            setSelectionMode('manual');
            onPluginListChange(Array.from(next).join(', '));
            return next;
        });
    }, [currentSelectedPlugins, eligiblePlugins, onPluginListChange]);

    const includedCount = currentSelectedPlugins.size;
    const signatureBadges = recommendation?.signature ? buildSignatureBadges(recommendation.signature) : [];
    const primaryWorkflow = workflowResolution?.workflow || null;
    const hasSecretCodeLabel = primaryWorkflow?.kind === 'secret_code' || Boolean(classification?.labels.some(label => label.name === 'secret_code'));
    const bestSecretFragment = workflowResolution?.execution.secret_code?.selected_fragment || classification?.candidate_secret_fragments?.[0] || null;
    const formulaAnswerSearch = workflowResolution?.execution.formula?.answer_search || null;
    const formulaCalculatedCoordinates = workflowResolution?.execution.formula?.calculated_coordinates || null;
    const hiddenExecution = workflowResolution?.execution.hidden_content || null;
    const hiddenSelectedFragment = hiddenExecution?.selected_fragment || hiddenExecution?.candidate_secret_fragments?.[0] || null;
    const imageExecution = workflowResolution?.execution.image_puzzle || null;
    const imageSelectedFragment = imageExecution?.selected_fragment || imageExecution?.candidate_secret_fragments?.[0] || null;
    const formulaGeoPlausibility = formulaCalculatedCoordinates?.geographic_plausibility || null;
    const secretGeoPlausibility = workflowResolution?.execution.secret_code?.metasolver_result?.geographic_plausibility || null;
    const imageGeoPlausibility = imageExecution?.geographic_plausibility || null;
    const checkerExecution = workflowResolution?.execution.checker || null;
    const derivedCheckerCandidate = React.useMemo(() => {
        const explicitCheckerCandidate = (checkerExecution?.candidate || '').trim();
        if (explicitCheckerCandidate) {
            return explicitCheckerCandidate;
        }
        const calculatedCandidate = formatCheckerCandidateFromCoordinates(formulaCalculatedCoordinates?.coordinates);
        if (calculatedCandidate) {
            return calculatedCandidate;
        }
        const metasolverCandidate = formatCheckerCandidateFromCoordinates(workflowResolution?.execution.secret_code?.metasolver_result?.coordinates);
        if (metasolverCandidate) {
            return metasolverCandidate;
        }
        const topResult = workflowResolution?.execution.secret_code?.metasolver_result?.top_results?.[0];
        const topResultCandidate = formatCheckerCandidateFromCoordinates(topResult?.coordinates);
        if (topResultCandidate) {
            return topResultCandidate;
        }
        if (typeof topResult?.text_output === 'string' && topResult.text_output.trim()) {
            return topResult.text_output.trim();
        }
        return '';
    }, [checkerExecution?.candidate, formulaCalculatedCoordinates?.coordinates, workflowResolution]);
    const formulaGeocacheId = typeof geocacheContext?.geocacheId === 'number' ? geocacheContext.geocacheId : undefined;
    const canSendToGeoAppChat = Boolean((text || '').trim() || workflowResolution || classification || recommendation);

    const applySecretFragment = React.useCallback((fragmentText: string) => {
        setPendingAutoExecutionText(null);
        onTextChange(fragmentText);
        onPluginListChange('');
        setSelectionMode('recommended');
        setManualSelectedPlugins(new Set());
        appendWorkflowEntry('secret', 'Fragment selectionne manuellement', fragmentText.slice(0, 60));
    }, [onTextChange, onPluginListChange, appendWorkflowEntry]);

    const executeSecretFragment = React.useCallback((fragmentText: string) => {
        const normalizedText = fragmentText.trim();
        if (!normalizedText) {
            return;
        }
        setPendingAutoExecutionText(normalizedText);
        onTextChange(normalizedText);
        onPluginListChange('');
        setSelectionMode('recommended');
        setManualSelectedPlugins(new Set());
        appendWorkflowEntry('secret', 'Preparation de l execution automatique', normalizedText.slice(0, 60));
    }, [onTextChange, onPluginListChange, appendWorkflowEntry]);

    const executeBestSecretFragment = React.useCallback(() => {
        if (!bestSecretFragment) {
            return;
        }
        executeSecretFragment(bestSecretFragment.text);
    }, [bestSecretFragment, executeSecretFragment]);

    const openFormulaSolver = React.useCallback(async () => {
        if (!formulaGeocacheId) {
            return;
        }

        try {
            await commandService.executeCommand(FORMULA_SOLVER_SOLVE_FROM_GEOCACHE_COMMAND, formulaGeocacheId);
            appendWorkflowEntry('formula', 'Formula Solver ouvert', `Geocache #${formulaGeocacheId}`);
        } catch (error: any) {
            setError(error?.message || "Impossible d'ouvrir le Formula Solver");
        }
    }, [commandService, formulaGeocacheId, appendWorkflowEntry]);

    const persistDiagnosticSummary = React.useCallback(async (summary: Record<string, unknown>) => {
        const gcCode = (geocacheContext?.gcCode || '').trim();
        if (!gcCode) {
            return;
        }

        try {
            const response = await fetch(`${backendBaseUrl}/api/archive/${encodeURIComponent(gcCode)}/resolution-diagnostics`, {
                method: 'PUT',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(summary),
            });

            if (!response.ok) {
                const payload = await response.json().catch(() => undefined);
                throw new Error(payload?.error || `HTTP ${response.status}`);
            }

            appendWorkflowEntry('archive', 'Diagnostic archive mis a jour', gcCode);
        } catch (error: any) {
            console.warn('[MetasolverPresetPanel] Archive diagnostic update failed', error);
            appendWorkflowEntry('archive', 'Archive du diagnostic ignoree', error?.message || 'Erreur archive');
        }
    }, [appendWorkflowEntry, backendBaseUrl, geocacheContext?.gcCode]);

    const persistCurrentDiagnosticSummary = React.useCallback(async (overrides?: {
        text?: string;
        workflowResolution?: ResolutionWorkflowResponse | null;
        classification?: ListingClassificationResponse | null;
        recommendation?: MetasolverRecommendationResponse | null;
        recommendationSourceText?: string;
        workflowEntries?: MetasolverWorkflowLogEntry[];
    }) => {
        await persistDiagnosticSummary(
            buildArchiveDiagnosticSummary(
                geocacheContext,
                overrides?.text ?? text,
                overrides?.workflowResolution ?? workflowResolution,
                overrides?.classification ?? classification,
                overrides?.recommendation ?? recommendation,
                overrides?.recommendationSourceText ?? recommendationSourceText,
                overrides?.workflowEntries ?? workflowEntries,
            )
        );
    }, [
        classification,
        geocacheContext,
        persistDiagnosticSummary,
        recommendation,
        recommendationSourceText,
        text,
        workflowEntries,
        workflowResolution,
    ]);

    const sendDiagnosticToGeoAppChat = React.useCallback(() => {
        const prompt = buildGeoAppDiagnosticPrompt(geocacheContext, text, workflowResolution, classification, recommendation, workflowEntries);
        const archiveSummary = buildArchiveDiagnosticSummary(
            geocacheContext,
            text,
            workflowResolution,
            classification,
            recommendation,
            recommendationSourceText,
            workflowEntries,
        );
        const resumeState = (archiveSummary as { resume_state?: Record<string, unknown> }).resume_state;

        dispatchPluginExecutorGeoAppOpenChatRequest(
            window,
            CustomEvent,
            buildPluginExecutorGeoAppOpenChatDetail(
                prompt,
                geoAppWorkflowKind,
                geoAppChatProfile,
                resumeState,
                geocacheContext
            )
        );

        appendWorkflowEntry(
            'chat',
            'Diagnostic envoye au chat GeoApp',
            truncateDiagnosticText(text || bestSecretFragment?.text || geocacheContext?.gcCode || 'Plugin Executor', 90)
        );
        void persistDiagnosticSummary(archiveSummary);
    }, [
        appendWorkflowEntry,
        bestSecretFragment?.text,
        classification,
        geocacheContext,
        geoAppChatProfile,
        geoAppWorkflowKind,
        persistDiagnosticSummary,
        recommendation,
        recommendationSourceText,
        text,
        workflowResolution,
        workflowEntries,
    ]);

    const runWorkflowStep = React.useCallback(async (targetStepId?: string) => {
        const trimmedText = (text || '').trim();
        const geocacheId = typeof geocacheContext?.geocacheId === 'number' ? geocacheContext.geocacheId : undefined;
        const answerSearch = workflowResolution?.execution.formula?.answer_search;
        const formulaAnswers = answerSearch
            ? Object.fromEntries(
                Object.entries(answerSearch.answers || {})
                    .filter(([, value]) => typeof value?.best_answer === 'string' && value.best_answer.trim().length > 0)
                    .map(([key, value]) => [key, value.best_answer!.trim()])
            )
            : undefined;
        const formulaValueTypes = answerSearch
            ? Object.fromEntries(
                Object.entries(answerSearch.answers || {})
                    .filter(([, value]) => typeof value?.recommended_value_type === 'string' && value.recommended_value_type.trim().length > 0)
                    .map(([key, value]) => [key, value.recommended_value_type!.trim()])
            )
            : undefined;

        setRunningWorkflowStepId(targetStepId || 'next');
        setError(null);
        try {
            const response = await pluginsService.runWorkflowStep({
                geocache_id: geocacheId,
                title: geocacheContext?.name || undefined,
                description: trimmedText || geocacheContext?.description || undefined,
                hint: geocacheContext?.hint || undefined,
                waypoints: geocacheContext?.waypoints,
                checkers: geocacheContext?.checkers,
                images: geocacheContext?.images,
                preferred_workflow: primaryWorkflow?.kind,
                target_step_id: targetStepId,
                formula_answers: formulaAnswers && Object.keys(formulaAnswers).length ? formulaAnswers : undefined,
                formula_value_types: formulaValueTypes && Object.keys(formulaValueTypes).length ? formulaValueTypes : undefined,
                checker_candidate: derivedCheckerCandidate || undefined,
                max_secret_fragments: 5,
                metasolver_preset: preset,
                metasolver_mode: 'decode',
                max_plugins: maxPlugins,
                workflow_control: workflowResolution?.control || undefined,
            });

            setWorkflowResolution(response.workflow_resolution);
            setClassification(response.workflow_resolution.classification || null);

            const secretExecution = response.workflow_resolution.execution.secret_code;
            const hiddenExecution = response.workflow_resolution.execution.hidden_content;
            const imageExecution = response.workflow_resolution.execution.image_puzzle;
            if (secretExecution?.recommendation) {
                setRecommendation(secretExecution.recommendation);
                setRecommendationSourceText((secretExecution.selected_fragment?.text || '').trim());
            } else if (hiddenExecution?.recommendation) {
                setRecommendation(hiddenExecution.recommendation);
                setRecommendationSourceText((hiddenExecution.selected_fragment?.text || '').trim());
            } else if (imageExecution?.recommendation) {
                setRecommendation(imageExecution.recommendation);
                setRecommendationSourceText((imageExecution.selected_fragment?.text || '').trim());
            }

            let nextWorkflowEntries = workflowEntries;
            let nextLogCategory: MetasolverWorkflowLogEntry['category'] = 'execute';
            let nextLogMessage = '';
            let nextLogDetail: string | undefined;

            if (response.status !== 'success') {
                nextLogMessage = `Etape backend non executee: ${targetStepId || response.step?.id || 'workflow'}`;
                nextLogDetail = response.message;
                nextWorkflowEntries = prependWorkflowEntries(nextWorkflowEntries, nextLogCategory, nextLogMessage, nextLogDetail);
                setWorkflowEntries(nextWorkflowEntries);
                void persistCurrentDiagnosticSummary({
                    workflowResolution: response.workflow_resolution,
                    classification: response.workflow_resolution.classification || null,
                    recommendation: secretExecution?.recommendation || hiddenExecution?.recommendation || imageExecution?.recommendation || recommendation,
                    recommendationSourceText: (
                        secretExecution?.selected_fragment?.text
                        || hiddenExecution?.selected_fragment?.text
                        || imageExecution?.selected_fragment?.text
                        || recommendationSourceText
                    ).trim(),
                    workflowEntries: nextWorkflowEntries,
                });
                return;
            }

            if (response.executed_step === 'search-answers') {
                nextLogCategory = 'formula';
                nextLogMessage = 'Recherche web executee';
                nextLogDetail = response.message;
            } else if (response.executed_step === 'inspect-hidden-html') {
                nextLogCategory = hiddenExecution?.recommendation ? 'recommend' : 'classify';
                nextLogMessage = 'HTML cache inspecte';
                nextLogDetail = truncateDiagnosticText(
                    String(
                        hiddenExecution?.selected_fragment?.text
                        || hiddenExecution?.summary
                        || response.message
                    ),
                    140
                );
            } else if (response.executed_step === 'inspect-images') {
                nextLogCategory = imageExecution?.recommendation ? 'recommend' : 'classify';
                nextLogMessage = 'Images inspectees';
                nextLogDetail = truncateDiagnosticText(
                    String(
                        imageExecution?.selected_fragment?.text
                        || imageExecution?.summary
                        || response.message
                    ),
                    140
                );
            } else if (response.executed_step === 'calculate-final-coordinates') {
                nextLogCategory = 'formula';
                nextLogMessage = 'Coordonnees calculees';
                nextLogDetail = truncateDiagnosticText(
                    String(
                        response.result?.coordinates?.ddm
                        || response.result?.coordinates?.decimal
                        || response.message
                    ),
                    140
                );
            } else if (response.executed_step === 'validate-with-checker') {
                nextLogMessage = 'Validation checker executee';
                nextLogDetail = truncateDiagnosticText(
                    String(
                        response.result?.result?.message
                        || response.result?.message
                        || response.message
                    ),
                    140
                );
            } else {
                nextLogMessage = `Etape backend executee: ${response.executed_step || targetStepId || 'workflow'}`;
                nextLogDetail = response.message;
            }

            nextWorkflowEntries = prependWorkflowEntries(nextWorkflowEntries, nextLogCategory, nextLogMessage, nextLogDetail);
            setWorkflowEntries(nextWorkflowEntries);
            void persistCurrentDiagnosticSummary({
                workflowResolution: response.workflow_resolution,
                classification: response.workflow_resolution.classification || null,
                recommendation: secretExecution?.recommendation || hiddenExecution?.recommendation || imageExecution?.recommendation || recommendation,
                recommendationSourceText: (
                    secretExecution?.selected_fragment?.text
                    || hiddenExecution?.selected_fragment?.text
                    || imageExecution?.selected_fragment?.text
                    || recommendationSourceText
                ).trim(),
                workflowEntries: nextWorkflowEntries,
            });
        } catch (workflowError: any) {
            setError(workflowError?.message || "Impossible d'executer l'etape du workflow");
        } finally {
            setRunningWorkflowStepId(null);
        }
    }, [
        appendWorkflowEntry,
        geocacheContext,
        maxPlugins,
        pluginsService,
        preset,
        primaryWorkflow?.kind,
        text,
        derivedCheckerCandidate,
        persistCurrentDiagnosticSummary,
        recommendation,
        recommendationSourceText,
        workflowResolution,
        workflowEntries,
    ]);

    const suggestedShortcuts = React.useMemo(() => {
        const actions: Array<{
            id: string;
            label: string;
            onClick: () => void;
            disabled: boolean;
            title: string;
        }> = [];
        const plannedStepIds = new Set(
            (workflowResolution?.plan || [])
                .filter(step => step.status === 'planned' || step.status === 'completed')
                .map(step => step.id)
        );
        const addAction = (
            id: string,
            label: string,
            onClick: () => void,
            actionDisabled: boolean,
            title: string,
        ) => {
            if (actions.some(action => action.id === id)) {
                return;
            }
            actions.push({ id, label, onClick, disabled: actionDisabled, title });
        };

        if (plannedStepIds.has('extract-secret-fragment') && bestSecretFragment) {
            addAction(
                'use-best-fragment',
                'Utiliser le meilleur fragment',
                () => applySecretFragment(bestSecretFragment.text),
                disabled,
                'Injecter le fragment principal dans le texte courant'
            );
        }
        if (plannedStepIds.has('recommend-metasolver-plugins') && recommendation) {
            addAction(
                'apply-recommendation',
                'Appliquer la recommandation',
                () => void applyRecommendation(),
                disabled || loadingRecommendation || !recommendation,
                'Appliquer la sous-liste de plugins metasolver recommandee'
            );
        }
        if (plannedStepIds.has('execute-metasolver') && bestSecretFragment) {
            addAction(
                'execute-best-fragment',
                'Executer le meilleur fragment',
                () => executeBestSecretFragment(),
                disabled,
                'Utiliser le meilleur fragment puis executer metasolver'
            );
        }
        if (plannedStepIds.has('inspect-hidden-html')) {
            addAction(
                'inspect-hidden-html',
                'Inspecter le HTML cache',
                () => { void runWorkflowStep('inspect-hidden-html'); },
                disabled || runningWorkflowStepId !== null,
                'Extraire les commentaires HTML et les textes invisibles avant tout decodage'
            );
        }
        if (plannedStepIds.has('inspect-images')) {
            addAction(
                'inspect-images',
                'Inspecter les images',
                () => { void runWorkflowStep('inspect-images'); },
                disabled || runningWorkflowStepId !== null,
                'Extraire les textes alt/title et lancer OCR/QR sur les images si possible'
            );
        }
        if (plannedStepIds.has('search-answers')) {
            addAction(
                'search-formula-answers',
                'Rechercher les reponses web',
                () => { void runWorkflowStep('search-answers'); },
                disabled || runningWorkflowStepId !== null,
                'Lancer la recherche web backend pour les questions de formule'
            );
        }
        if (plannedStepIds.has('calculate-final-coordinates')) {
            addAction(
                'calculate-formula-coordinates',
                'Calculer les coordonnees',
                () => { void runWorkflowStep('calculate-final-coordinates'); },
                disabled || runningWorkflowStepId !== null,
                'Calculer les coordonnees finales avec les valeurs disponibles'
            );
        }
        if (plannedStepIds.has('validate-with-checker')) {
            addAction(
                'validate-with-checker',
                'Valider avec checker',
                () => { void runWorkflowStep('validate-with-checker'); },
                disabled || runningWorkflowStepId !== null || !derivedCheckerCandidate,
                derivedCheckerCandidate
                    ? 'Executer le checker avec le meilleur candidat courant'
                    : 'Aucun candidat exploitable pour le checker'
            );
        }
        if (
            (plannedStepIds.has('detect-formulas')
                || plannedStepIds.has('extract-questions')
                || plannedStepIds.has('search-answers')
                || plannedStepIds.has('calculate-final-coordinates'))
            && formulaGeocacheId
        ) {
            addAction(
                'open-formula-solver',
                'Ouvrir Formula Solver',
                () => { void openFormulaSolver(); },
                disabled || !formulaGeocacheId,
                'Basculer vers le workflow Formula Solver pour cette geocache'
            );
        }
        if (plannedStepIds.has('inspect-hidden-html') || plannedStepIds.has('inspect-images') || plannedStepIds.has('validate-with-checker')) {
            addAction(
                'send-chat-contextual',
                'Envoyer au chat GeoApp',
                () => sendDiagnosticToGeoAppChat(),
                disabled || loadingClassification || loadingRecommendation || !canSendToGeoAppChat,
                'Ouvrir ou reutiliser un chat GeoApp avec le diagnostic courant'
            );
        }
        if (actions.length === 0 && canSendToGeoAppChat) {
            addAction(
                'send-chat-fallback',
                'Envoyer au chat GeoApp',
                () => sendDiagnosticToGeoAppChat(),
                disabled || loadingClassification || loadingRecommendation || !canSendToGeoAppChat,
                'Continuer l analyse dans le chat GeoApp'
            );
        }

        return actions;
    }, [
        workflowResolution?.plan,
        bestSecretFragment,
        recommendation,
        formulaGeocacheId,
        derivedCheckerCandidate,
        canSendToGeoAppChat,
        disabled,
        loadingClassification,
        loadingRecommendation,
        runningWorkflowStepId,
        applySecretFragment,
        applyRecommendation,
        executeBestSecretFragment,
        openFormulaSolver,
        runWorkflowStep,
        sendDiagnosticToGeoAppChat,
    ]);

    return (
        <div className='plugin-form'>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                <h4 style={{ margin: 0 }}>🔎 Sélection assistée metasolver</h4>
                <div style={{ fontSize: '11px', opacity: 0.7 }}>
                    {selectionMode === 'recommended' ? 'Mode recommandé' : selectionMode === 'preset' ? 'Mode preset complet' : 'Mode manuel'}
                </div>
            </div>

            {archivedResumeState && (
                <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                        className='theia-button secondary'
                        type='button'
                        onClick={() => applyArchivedResumeSnapshot(archivedResumeState, 'manual')}
                        disabled={disabled}
                        title={archivedResumeState.updatedAt
                            ? `Restaurer le snapshot archive du ${new Date(archivedResumeState.updatedAt).toLocaleString('fr-FR')}`
                            : "Restaurer le dernier snapshot archive"}
                        style={{ fontSize: '11px', padding: '2px 8px' }}
                    >
                        Restaurer l&apos;archive
                    </button>
                </div>
            )}

            {error && (
                <div style={{ color: 'var(--theia-errorForeground)', fontSize: '12px', marginTop: '6px' }}>
                    Erreur : {error}
                </div>
            )}

            {(loadingClassification || workflowResolution || classification) && (
                <div style={{
                    marginTop: '10px',
                    padding: '10px',
                    border: '1px solid var(--theia-panel-border)',
                    borderRadius: '4px',
                    background: 'var(--theia-editor-background)'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                        <div style={{ fontSize: '12px', fontWeight: 600 }}>
                            Diagnostic du listing
                        </div>
                        <div style={{ fontSize: '11px', opacity: 0.7 }}>
                            {loadingClassification ? 'Analyse...' : ((workflowResolution?.source || classification?.source) === 'geocache' ? 'Source geocache' : 'Source texte')}
                        </div>
                    </div>

                    {primaryWorkflow && (
                        <div style={{ marginTop: '8px' }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                                <span style={{
                                    fontSize: '11px',
                                    padding: '2px 8px',
                                    borderRadius: '999px',
                                    background: 'var(--theia-list-activeSelectionBackground)',
                                    border: '1px solid var(--theia-panel-border)',
                                    fontWeight: 600,
                                }}>
                                    Workflow principal: {WORKFLOW_TITLES[primaryWorkflow.kind] || primaryWorkflow.kind} {(primaryWorkflow.confidence * 100).toFixed(0)}%
                                </span>
                                {primaryWorkflow.forced ? (
                                    <span style={{
                                        fontSize: '10px',
                                        padding: '1px 6px',
                                        borderRadius: '999px',
                                        background: 'var(--theia-input-background)',
                                        border: '1px solid var(--theia-panel-border)',
                                    }}>
                                        force
                                    </span>
                                ) : null}
                            </div>
                            {workflowResolution?.explanation?.length ? (
                                <div style={{ marginTop: '6px', fontSize: '11px', opacity: 0.78 }}>
                                    {workflowResolution.explanation.slice(0, 3).join(' - ')}
                                </div>
                            ) : null}
                            {workflowResolution?.workflow_candidates?.length ? (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                                    {workflowResolution.workflow_candidates.slice(0, 3).map(candidate => (
                                        <span
                                            key={`${candidate.kind}-${candidate.score}`}
                                            title={candidate.reason}
                                            style={{
                                                fontSize: '10px',
                                                padding: '1px 6px',
                                                borderRadius: '999px',
                                                background: 'var(--theia-input-background)',
                                                border: '1px solid var(--theia-panel-border)',
                                            }}
                                        >
                                            {WORKFLOW_TITLES[candidate.kind] || candidate.kind} {(candidate.confidence * 100).toFixed(0)}%
                                        </span>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    )}

                    {classification?.labels && classification.labels.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                            {classification.labels.map(label => (
                                <span
                                    key={label.name}
                                    title={label.evidence.join(' - ')}
                                    style={{
                                        fontSize: '11px',
                                        padding: '2px 8px',
                                        borderRadius: '999px',
                                        background: label.name === 'secret_code'
                                            ? 'var(--theia-list-activeSelectionBackground)'
                                            : 'var(--theia-input-background)',
                                        border: '1px solid var(--theia-panel-border)'
                                    }}
                                >
                                    {LISTING_LABEL_TITLES[label.name] || label.name} {(label.confidence * 100).toFixed(0)}%
                                </span>
                            ))}
                        </div>
                    )}

                    {classification?.recommended_actions?.length ? (
                        <div style={{ marginTop: '8px', fontSize: '11px', opacity: 0.8 }}>
                            {classification.recommended_actions.slice(0, 2).join(' ')}
                        </div>
                    ) : null}

                    {workflowResolution?.plan?.length ? (
                        <div style={{ marginTop: '10px' }}>
                            <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                                Plan d action
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {workflowResolution.plan.slice(0, 5).map(step => (
                                    <div
                                        key={step.id}
                                        style={{
                                            padding: '6px 8px',
                                            border: '1px solid var(--theia-panel-border)',
                                            borderRadius: '4px',
                                            background: getPlanStatusBackground(step.status),
                                            fontSize: '11px',
                                        }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                                            <span style={{
                                                fontSize: '10px',
                                                padding: '1px 6px',
                                                borderRadius: '999px',
                                                background: 'var(--theia-editor-background)',
                                                border: '1px solid var(--theia-panel-border)',
                                            }}>
                                                {PLAN_STATUS_LABELS[step.status] || step.status}
                                            </span>
                                            <span style={{ opacity: 0.7 }}>
                                                {step.automated ? 'auto' : 'manuel'}{step.tool ? ` - ${step.tool}` : ''}
                                            </span>
                                        </div>
                                        <div style={{ marginTop: '4px' }}>{step.title}</div>
                                        {step.detail ? (
                                            <div style={{ marginTop: '2px', opacity: 0.75 }}>{step.detail}</div>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    {workflowResolution?.next_actions?.length ? (
                        <div style={{ marginTop: '8px', fontSize: '11px', opacity: 0.78 }}>
                            Prochaines actions : {workflowResolution.next_actions.slice(0, 4).join(' - ')}
                        </div>
                    ) : null}

                    {workflowResolution?.control ? (
                        <div style={{ marginTop: '8px', fontSize: '11px', opacity: 0.82 }}>
                            <div>
                                Controle : <strong>{WORKFLOW_CONTROL_STATUS_LABELS[workflowResolution.control.status] || workflowResolution.control.status}</strong>
                                {' - '}
                                {workflowResolution.control.summary}
                            </div>
                            <div style={{ marginTop: '2px', opacity: 0.78 }}>
                                Budget auto {workflowResolution.control.usage.automated_steps}/{workflowResolution.control.budget.max_automated_steps}
                                {' - '}
                                metasolver {workflowResolution.control.usage.metasolver_runs}/{workflowResolution.control.budget.max_metasolver_runs}
                                {' - '}
                                vision OCR budget {workflowResolution.control.usage.vision_ocr_runs}/{workflowResolution.control.budget.max_vision_ocr_runs}
                                {' - '}
                                checker {workflowResolution.control.usage.checker_runs}/{workflowResolution.control.budget.max_checker_runs}
                                {' - '}
                                confiance finale {(workflowResolution.control.final_confidence * 100).toFixed(0)}%
                            </div>
                            {workflowResolution.control.stop_reasons.length ? (
                                <div style={{ marginTop: '2px', color: 'var(--theia-descriptionForeground)' }}>
                                    Arret : {workflowResolution.control.stop_reasons.slice(0, 2).join(' - ')}
                                </div>
                            ) : null}
                        </div>
                    ) : null}

                    {canSendToGeoAppChat && (
                        <div style={{ marginTop: '8px', fontSize: '11px', opacity: 0.75 }}>
                            Profil chat GeoApp prevu : <strong>{geoAppChatProfile}</strong>
                            {' - '}
                            workflow <strong>{geoAppWorkflowKind}</strong>
                        </div>
                    )}

                    {suggestedShortcuts.length > 0 && (
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
                            {suggestedShortcuts.map(action => (
                                <button
                                    key={action.id}
                                    type='button'
                                    className='theia-button secondary'
                                    onClick={action.onClick}
                                    disabled={action.disabled}
                                    title={action.title}
                                >
                                    {action.label}
                                </button>
                            ))}
                        </div>
                    )}

                    {classification?.formula_signals?.length ? (
                        <div style={{ marginTop: '8px', fontSize: '11px', opacity: 0.75 }}>
                            Signaux formule : {classification.formula_signals.slice(0, 3).join(' - ')}
                        </div>
                    ) : null}

                    {hiddenExecution && (
                        <div style={{ marginTop: '10px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center', marginBottom: '6px' }}>
                                <div style={{ fontSize: '12px', fontWeight: 600 }}>
                                    Contenu cache
                                </div>
                                {hiddenSelectedFragment ? (
                                    <button
                                        type='button'
                                        className='theia-button secondary'
                                        onClick={() => applySecretFragment(hiddenSelectedFragment.text)}
                                        disabled={disabled}
                                        title='Injecter le fragment cache principal dans le texte courant'
                                    >
                                        Utiliser le fragment cache
                                    </button>
                                ) : null}
                            </div>
                            <div style={{
                                padding: '8px 10px',
                                border: '1px solid var(--theia-panel-border)',
                                borderRadius: '4px',
                                background: 'var(--theia-input-background)',
                                fontSize: '11px',
                                display: 'grid',
                                gap: '6px',
                            }}>
                                {hiddenExecution.summary ? (
                                    <div>{truncateDiagnosticText(hiddenExecution.summary, 180)}</div>
                                ) : null}
                                {hiddenExecution.hidden_signals?.length ? (
                                    <div style={{ opacity: 0.8 }}>
                                        Signaux : {hiddenExecution.hidden_signals.slice(0, 4).join(' - ')}
                                    </div>
                                ) : null}
                                {hiddenExecution.items?.length ? (
                                    <div style={{ display: 'grid', gap: '4px' }}>
                                        {hiddenExecution.items.slice(0, 4).map((item, index) => (
                                            <div key={`${item.source}-${index}`} style={{ opacity: 0.84 }}>
                                                <strong>{item.reason}:</strong> {truncateDiagnosticText(item.text, 180)}
                                            </div>
                                        ))}
                                    </div>
                                ) : null}
                                {hiddenExecution.recommendation?.selected_plugins?.length ? (
                                    <div style={{ opacity: 0.8 }}>
                                        Recommandation metasolver : {hiddenExecution.recommendation.selected_plugins.slice(0, 5).join(', ')}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    )}

                    {imageExecution && (
                        <div style={{ marginTop: '10px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center', marginBottom: '6px' }}>
                                <div style={{ fontSize: '12px', fontWeight: 600 }}>
                                    Images / OCR
                                </div>
                                {imageSelectedFragment ? (
                                    <button
                                        type='button'
                                        className='theia-button secondary'
                                        onClick={() => applySecretFragment(imageSelectedFragment.text)}
                                        disabled={disabled}
                                        title='Injecter le fragment principal extrait des images dans le texte courant'
                                    >
                                        Utiliser le fragment image
                                    </button>
                                ) : null}
                            </div>
                            <div style={{
                                padding: '8px 10px',
                                border: '1px solid var(--theia-panel-border)',
                                borderRadius: '4px',
                                background: 'var(--theia-input-background)',
                                fontSize: '11px',
                                display: 'grid',
                                gap: '6px',
                            }}>
                                {imageExecution.summary ? (
                                    <div>{truncateDiagnosticText(imageExecution.summary, 180)}</div>
                                ) : null}
                                <div style={{ opacity: 0.8 }}>
                                    {imageExecution.image_count || 0} image(s) detectee(s)
                                </div>
                                {imageExecution.items?.length ? (
                                    <div style={{ display: 'grid', gap: '4px' }}>
                                        {imageExecution.items.slice(0, 4).map((item, index) => (
                                            <div key={`${item.source}-${index}`} style={{ opacity: 0.84 }}>
                                                <strong>{item.reason}:</strong> {truncateDiagnosticText(item.text, 180)}
                                            </div>
                                        ))}
                                    </div>
                                ) : null}
                                {imageExecution.plugin_summaries?.length ? (
                                    <div style={{ opacity: 0.78 }}>
                                        Plugins image : {imageExecution.plugin_summaries.slice(0, 3).join(' - ')}
                                    </div>
                                ) : null}
                                {imageExecution.recommendation?.selected_plugins?.length ? (
                                    <div style={{ opacity: 0.8 }}>
                                        Recommandation metasolver : {imageExecution.recommendation.selected_plugins.slice(0, 5).join(', ')}
                                    </div>
                                ) : null}
                                {imageExecution.coordinates_candidate ? (
                                    <div style={{ opacity: 0.8 }}>
                                        Coordonnees candidates : {formatCheckerCandidateFromCoordinates(imageExecution.coordinates_candidate)}
                                    </div>
                                ) : null}
                                {imageGeoPlausibility ? (
                                    <div
                                        style={{
                                            marginTop: '4px',
                                            padding: '6px 8px',
                                            borderRadius: '4px',
                                            background: getGeoPlausibilityAccent(imageGeoPlausibility.status),
                                            border: '1px solid var(--theia-panel-border)',
                                        }}
                                    >
                                        <div>
                                            <strong>{GEO_PLAUSIBILITY_LABELS[imageGeoPlausibility.status] || imageGeoPlausibility.status}</strong>
                                            {' - '}
                                            confiance {(imageGeoPlausibility.score * 100).toFixed(0)}%
                                        </div>
                                        <div style={{ marginTop: '2px', opacity: 0.82 }}>
                                            {imageGeoPlausibility.summary}
                                        </div>
                                        {imageGeoPlausibility.nearest_reference ? (
                                            <div style={{ marginTop: '2px', opacity: 0.75 }}>
                                                Reference la plus proche : {imageGeoPlausibility.nearest_reference.label}
                                                {' - '}
                                                {formatDistanceKm(imageGeoPlausibility.nearest_reference.distance_km)}
                                            </div>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    )}

                    {formulaAnswerSearch?.answers && Object.keys(formulaAnswerSearch.answers).length > 0 ? (
                        <div style={{ marginTop: '10px' }}>
                            <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                                Reponses formule
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {Object.entries(formulaAnswerSearch.answers).slice(0, 4).map(([variable, answer]) => (
                                    <div
                                        key={variable}
                                        style={{
                                            padding: '6px 8px',
                                            border: '1px solid var(--theia-panel-border)',
                                            borderRadius: '4px',
                                            background: 'var(--theia-input-background)',
                                            fontSize: '11px',
                                        }}
                                    >
                                        <div style={{ fontWeight: 600 }}>{variable} - {answer.question}</div>
                                        <div style={{ marginTop: '4px' }}>
                                            {answer.best_answer ? truncateDiagnosticText(answer.best_answer, 160) : 'Aucune reponse trouvee'}
                                        </div>
                                        {answer.recommended_value_type ? (
                                            <div style={{ marginTop: '2px', opacity: 0.75 }}>
                                                Conversion suggeree : {answer.recommended_value_type}
                                            </div>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    {formulaCalculatedCoordinates?.coordinates ? (
                        <div style={{ marginTop: '10px' }}>
                            <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                                Coordonnees calculees
                            </div>
                            <div style={{
                                padding: '8px 10px',
                                border: '1px solid var(--theia-panel-border)',
                                borderRadius: '4px',
                                background: 'var(--theia-input-background)',
                                fontSize: '11px',
                            }}>
                                <div style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                                    {formulaCalculatedCoordinates.coordinates.ddm || formulaCalculatedCoordinates.coordinates.decimal}
                                </div>
                                {formulaCalculatedCoordinates.distance?.km ? (
                                    <div style={{ marginTop: '4px', opacity: 0.75 }}>
                                        Distance depuis l origine : {formulaCalculatedCoordinates.distance.km} km
                                    </div>
                                ) : null}
                                {formulaGeoPlausibility ? (
                                    <div
                                        style={{
                                            marginTop: '8px',
                                            padding: '6px 8px',
                                            borderRadius: '4px',
                                            background: getGeoPlausibilityAccent(formulaGeoPlausibility.status),
                                            border: '1px solid var(--theia-panel-border)',
                                        }}
                                    >
                                        <div>
                                            <strong>{GEO_PLAUSIBILITY_LABELS[formulaGeoPlausibility.status] || formulaGeoPlausibility.status}</strong>
                                            {' - '}
                                            confiance {(formulaGeoPlausibility.score * 100).toFixed(0)}%
                                        </div>
                                        <div style={{ marginTop: '2px', opacity: 0.82 }}>
                                            {formulaGeoPlausibility.summary}
                                        </div>
                                        {formulaGeoPlausibility.nearest_reference ? (
                                            <div style={{ marginTop: '2px', opacity: 0.75 }}>
                                                Reference la plus proche : {formulaGeoPlausibility.nearest_reference.label}
                                                {' - '}
                                                {formatDistanceKm(formulaGeoPlausibility.nearest_reference.distance_km)}
                                            </div>
                                        ) : null}
                                        {formulaGeoPlausibility.reasons?.length ? (
                                            <div style={{ marginTop: '2px', opacity: 0.75 }}>
                                                {formulaGeoPlausibility.reasons.slice(0, 3).join(' - ')}
                                            </div>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    ) : null}

                    {!formulaCalculatedCoordinates?.coordinates && secretGeoPlausibility ? (
                        <div style={{ marginTop: '10px' }}>
                            <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                                Plausibilite metasolver
                            </div>
                            <div style={{
                                padding: '8px 10px',
                                border: '1px solid var(--theia-panel-border)',
                                borderRadius: '4px',
                                background: getGeoPlausibilityAccent(secretGeoPlausibility.status),
                                fontSize: '11px',
                            }}>
                                <div>
                                    <strong>{GEO_PLAUSIBILITY_LABELS[secretGeoPlausibility.status] || secretGeoPlausibility.status}</strong>
                                    {' - '}
                                    confiance {(secretGeoPlausibility.score * 100).toFixed(0)}%
                                </div>
                                <div style={{ marginTop: '4px', opacity: 0.82 }}>
                                    {secretGeoPlausibility.summary}
                                </div>
                                {secretGeoPlausibility.nearest_reference ? (
                                    <div style={{ marginTop: '4px', opacity: 0.75 }}>
                                        Reference la plus proche : {secretGeoPlausibility.nearest_reference.label}
                                        {' - '}
                                        {formatDistanceKm(secretGeoPlausibility.nearest_reference.distance_km)}
                                    </div>
                                ) : null}
                                {secretGeoPlausibility.reasons?.length ? (
                                    <div style={{ marginTop: '4px', opacity: 0.75 }}>
                                        {secretGeoPlausibility.reasons.slice(0, 3).join(' - ')}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    ) : null}

                    {checkerExecution?.result ? (
                        <div style={{ marginTop: '10px' }}>
                            <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                                Resultat checker
                            </div>
                            <div style={{
                                padding: '8px 10px',
                                border: '1px solid var(--theia-panel-border)',
                                borderRadius: '4px',
                                background: 'var(--theia-input-background)',
                                fontSize: '11px',
                            }}>
                                <div>
                                    <strong>{checkerExecution.checker_name || checkerExecution.provider || 'Checker'}</strong>
                                    {' - '}
                                    statut <strong>{checkerExecution.result.status || checkerExecution.status || 'unknown'}</strong>
                                </div>
                                {checkerExecution.candidate ? (
                                    <div style={{ marginTop: '4px', fontFamily: 'monospace' }}>
                                        Candidat : {truncateDiagnosticText(checkerExecution.candidate, 160)}
                                    </div>
                                ) : null}
                                {(checkerExecution.result.message || checkerExecution.message) ? (
                                    <div style={{ marginTop: '4px' }}>
                                        {truncateDiagnosticText(String(checkerExecution.result.message || checkerExecution.message), 220)}
                                    </div>
                                ) : null}
                                {checkerExecution.result.evidence ? (
                                    <div style={{ marginTop: '4px', opacity: 0.78 }}>
                                        {truncateDiagnosticText(String(checkerExecution.result.evidence), 220)}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    ) : null}

                    {classification?.candidate_secret_fragments?.length ? (
                        <div style={{ marginTop: '10px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center', marginBottom: '6px' }}>
                                <div style={{ fontSize: '12px', fontWeight: 600 }}>
                                    Fragments de code probables
                                </div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {classification.candidate_secret_fragments.slice(0, 3).map(fragment => {
                                    const fragmentBadges = buildSignatureBadges(fragment.signature).slice(0, 4);
                                    const isCurrentText = (text || '').trim() === fragment.text.trim();
                                    return (
                                        <div
                                            key={`${fragment.source}-${fragment.text}`}
                                            style={{
                                                padding: '8px 10px',
                                                border: '1px solid var(--theia-panel-border)',
                                                borderRadius: '4px',
                                                background: isCurrentText
                                                    ? 'var(--theia-list-activeSelectionBackground)'
                                                    : 'var(--theia-editor-background)'
                                            }}
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
                                                <div style={{ fontSize: '11px', opacity: 0.7 }}>
                                                    {fragment.source_kind === 'hidden_html' ? 'HTML cache' : fragment.source}
                                                    {' - '}
                                                    conf {(fragment.confidence * 100).toFixed(0)}%
                                                </div>
                                                <button
                                                    type='button'
                                                    className='theia-button secondary'
                                                    onClick={() => applySecretFragment(fragment.text)}
                                                    disabled={disabled}
                                                >
                                                    {isCurrentText ? 'Fragment actif' : 'Utiliser ce fragment'}
                                                </button>
                                            </div>
                                            <div style={{
                                                marginTop: '6px',
                                                fontFamily: 'monospace',
                                                fontSize: '12px',
                                                overflowX: 'auto',
                                                whiteSpace: 'pre-wrap',
                                                wordBreak: 'break-word'
                                            }}>
                                                {fragment.text}
                                            </div>
                                            {fragmentBadges.length > 0 && (
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                                                    {fragmentBadges.map(badge => (
                                                        <span
                                                            key={`${fragment.text}-${badge}`}
                                                            style={{
                                                                fontSize: '10px',
                                                                padding: '1px 6px',
                                                                borderRadius: '999px',
                                                                background: 'var(--theia-input-background)',
                                                                border: '1px solid var(--theia-panel-border)'
                                                            }}
                                                        >
                                                            {badge}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                            {fragment.evidence.length > 0 && (
                                                <div style={{ marginTop: '6px', fontSize: '11px', opacity: 0.75 }}>
                                                    {fragment.evidence.slice(0, 2).join(' - ')}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ) : classification && hasSecretCodeLabel ? (
                        <div style={{ marginTop: '8px', fontSize: '11px', opacity: 0.8 }}>
                            La classification detecte un code secret, mais aucun fragment compact n&apos;a ete extrait automatiquement.
                        </div>
                    ) : null}

                    {classification?.hidden_signals?.length ? (
                        <div style={{ marginTop: '8px', fontSize: '11px', opacity: 0.75 }}>
                            HTML suspect : {classification.hidden_signals.slice(0, 3).join(' - ')}
                        </div>
                    ) : null}

                    {workflowEntries.length > 0 && (
                        <div style={{ marginTop: '10px' }}>
                            <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                                Journal local
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {workflowEntries.slice(0, 6).map(entry => (
                                    <div
                                        key={entry.id}
                                        style={{
                                            padding: '6px 8px',
                                            border: '1px solid var(--theia-panel-border)',
                                            borderRadius: '4px',
                                            background: 'var(--theia-input-background)',
                                            fontSize: '11px',
                                        }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                                            <span style={{
                                                fontSize: '10px',
                                                padding: '1px 6px',
                                                borderRadius: '999px',
                                                background: 'var(--theia-editor-background)',
                                                border: '1px solid var(--theia-panel-border)'
                                            }}>
                                                {entry.category}
                                            </span>
                                            <span style={{ opacity: 0.7 }}>{entry.timestamp}</span>
                                        </div>
                                        <div style={{ marginTop: '4px' }}>{entry.message}</div>
                                        {entry.detail ? (
                                            <div style={{ marginTop: '2px', opacity: 0.75 }}>{entry.detail}</div>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {!text.trim() && !workflowResolution && (
                <div style={{ marginTop: '8px', fontSize: '12px', opacity: 0.7 }}>
                    Renseignez le texte à analyser pour obtenir une sélection dynamique.
                </div>
            )}

            {recommendation?.signature && (
                <div style={{
                    marginTop: '10px',
                    padding: '10px',
                    border: '1px solid var(--theia-panel-border)',
                    borderRadius: '4px',
                    background: 'var(--theia-editor-background)'
                }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                        Signature détectée
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {signatureBadges.map(badge => (
                            <span
                                key={badge}
                                style={{
                                    fontSize: '11px',
                                    padding: '2px 6px',
                                    borderRadius: '999px',
                                    background: 'var(--theia-input-background)',
                                    border: '1px solid var(--theia-panel-border)'
                                }}
                            >
                                {badge}
                            </span>
                        ))}
                    </div>
                    <div style={{ fontSize: '11px', opacity: 0.75, marginTop: '8px' }}>
                        Preset suggéré : <strong>{recommendation.effective_preset_label || recommendation.effective_preset}</strong>
                    </div>
                </div>
            )}

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
                <button
                    type='button'
                    className='theia-button secondary'
                    onClick={() => void applyRecommendation()}
                    disabled={disabled || !recommendation || loadingRecommendation}
                >
                    {loadingRecommendation ? 'Analyse…' : 'Appliquer la recommandation'}
                </button>
                <button
                    type='button'
                    className='theia-button secondary'
                    onClick={() => void useFullPreset()}
                    disabled={disabled || loadingEligible}
                >
                    Utiliser tout le preset
                </button>
                <div style={{ fontSize: '11px', opacity: 0.7, alignSelf: 'center' }}>
                    {includedCount}/{eligiblePlugins.length} plugin(s) sélectionné(s)
                </div>
            </div>

            {recommendation && recommendation.recommendations.length > 0 && (
                <div style={{ marginTop: '10px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                        Plugins recommandés
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {recommendation.recommendations.slice(0, 6).map(plugin => (
                            <div
                                key={plugin.name}
                                style={{
                                    padding: '8px 10px',
                                    border: '1px solid var(--theia-panel-border)',
                                    borderRadius: '4px',
                                    background: currentSelectedPlugins.has(plugin.name)
                                        ? 'var(--theia-list-activeSelectionBackground)'
                                        : 'var(--theia-editor-background)'
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{
                                        display: 'inline-block',
                                        width: '28px',
                                        textAlign: 'center',
                                        fontSize: '10px',
                                        background: 'var(--theia-input-background)',
                                        borderRadius: '3px',
                                        padding: '1px 2px',
                                        fontWeight: 'bold',
                                        flexShrink: 0,
                                    }}>
                                        {METASOLVER_CHARSET_ICONS[plugin.input_charset] || '?'}
                                    </span>
                                    <strong>{plugin.name}</strong>
                                    <span style={{ fontSize: '11px', opacity: 0.7 }}>
                                        score {plugin.score.toFixed(0)} • conf {(plugin.confidence * 100).toFixed(0)}%
                                    </span>
                                </div>
                                {plugin.reasons.length > 0 && (
                                    <div style={{ marginTop: '4px', fontSize: '11px', opacity: 0.75 }}>
                                        {plugin.reasons.slice(0, 2).join(' • ')}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div
                style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none', marginTop: '12px' }}
                onClick={() => setExpanded(!expanded)}
            >
                <h4 style={{ margin: 0, flex: 1 }}>
                    🔌 Liste complète ({loadingEligible ? '...' : `${includedCount}/${eligiblePlugins.length}`})
                </h4>
                <span style={{ fontSize: '12px', opacity: 0.7 }}>
                    {expanded ? '▲ Réduire' : '▼ Détails'}
                </span>
            </div>

            {!expanded && !loadingEligible && eligiblePlugins.length > 0 && (
                <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '4px' }}>
                    {Array.from(currentSelectedPlugins).slice(0, 8).join(', ')}
                    {currentSelectedPlugins.size > 8 && ` +${currentSelectedPlugins.size - 8} autres`}
                </div>
            )}

            {expanded && !loadingEligible && (
                <div style={{ marginTop: '8px', maxHeight: '320px', overflowY: 'auto' }}>
                    {eligiblePlugins.length === 0 && (
                        <div style={{ fontSize: '13px', opacity: 0.7 }}>Aucun plugin éligible pour ce preset</div>
                    )}
                    {eligiblePlugins.map(plugin => {
                        const isSelected = currentSelectedPlugins.has(plugin.name);
                        return (
                            <div
                                key={plugin.name}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    padding: '4px 6px',
                                    borderBottom: '1px solid var(--theia-panel-border)',
                                    opacity: isSelected ? 1 : 0.55,
                                    fontSize: '12px',
                                    gap: '6px',
                                }}
                            >
                                <input
                                    type='checkbox'
                                    checked={isSelected}
                                    onChange={(e) => handleTogglePlugin(plugin.name, e.target.checked)}
                                    disabled={disabled}
                                    style={{ margin: 0 }}
                                />
                                <span style={{
                                    display: 'inline-block',
                                    width: '28px',
                                    textAlign: 'center',
                                    fontSize: '10px',
                                    background: 'var(--theia-editor-background)',
                                    borderRadius: '3px',
                                    padding: '1px 2px',
                                    fontWeight: 'bold',
                                    flexShrink: 0,
                                }}>
                                    {METASOLVER_CHARSET_ICONS[plugin.input_charset] || '?'}
                                </span>
                                <span style={{ fontWeight: 500, minWidth: '120px' }}>{plugin.name}</span>
                                <span style={{ opacity: 0.7, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {plugin.description}
                                </span>
                                <span style={{
                                    fontSize: '10px',
                                    background: 'var(--theia-editor-background)',
                                    borderRadius: '3px',
                                    padding: '1px 4px',
                                    flexShrink: 0,
                                }}>
                                    P{plugin.priority}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

/**
 * Génère le formulaire dynamique basé sur le schéma JSON
 * Filtre les champs techniques déjà gérés ailleurs (mode, text, input_text)
 */
function renderDynamicForm(
    schema: any,
    values: Record<string, any>,
    onChange: (key: string, value: any) => void,
    disabled: boolean,
    metadata?: any
): React.ReactNode {
    if (!schema?.properties) {
        return <div>Aucun paramètre requis</div>;
    }

    // Filtrer les champs techniques déjà gérés ailleurs
    const technicalFields = ['mode', 'text', 'input_text'];
    const filteredEntries = Object.entries(schema.properties).filter(
        ([key]) => !technicalFields.includes(key)
    );
    
    if (filteredEntries.length === 0) {
        return <div style={{ fontSize: '13px', opacity: 0.7 }}>Aucun paramètre supplémentaire requis</div>;
    }

    // Construire un map de labels pour les options de type select
    const inputTypes = metadata?.input_types || {};

    return filteredEntries.map(([key, propSchema]) => {
        const prop = propSchema as any;
        const value = values[key];
        const isRequired = schema.required?.includes(key);
        const metaField = inputTypes[key];

        return (
            <div key={key} className='form-field'>
                <label>
                    {prop.title || key}
                    {isRequired && <span className='required'>*</span>}
                </label>
                {prop.description && <div className='field-description'>{prop.description}</div>}
                {renderInputField(key, prop, value, onChange, disabled, metaField)}
            </div>
        );
    });
}

/**
 * Génère le champ d'entrée approprié selon le type
 */
function renderInputField(
    key: string,
    schema: any,
    value: any,
    onChange: (key: string, value: any) => void,
    disabled: boolean,
    metaField?: any
): React.ReactNode {
    // Enum -> Select (with optional labels from metadata)
    if (schema.enum) {
        // Build a value->label map from metadata options if available
        const labelMap: Record<string, string> = {};
        const metaOptions = metaField?.options;
        if (Array.isArray(metaOptions)) {
            for (const opt of metaOptions) {
                if (typeof opt === 'object' && opt.value !== undefined) {
                    labelMap[String(opt.value)] = opt.label || String(opt.value);
                }
            }
        }

        return (
            <select
                value={value || ''}
                onChange={(e) => onChange(key, e.target.value)}
                disabled={disabled}
            >
                {schema.enum.map((option: string) => (
                    <option key={option} value={option}>{labelMap[option] || option}</option>
                ))}
            </select>
        );
    }

    // Boolean -> Checkbox
    if (schema.type === 'boolean') {
        return (
            <input
                type='checkbox'
                checked={!!value}
                onChange={(e) => onChange(key, e.target.checked)}
                disabled={disabled}
            />
        );
    }

    // Number/Integer -> Number input
    if (schema.type === 'number' || schema.type === 'integer') {
        return (
            <input
                type='number'
                value={value || 0}
                min={schema.minimum}
                max={schema.maximum}
                step={schema.type === 'integer' ? 1 : 'any'}
                onChange={(e) => onChange(key, parseFloat(e.target.value))}
                disabled={disabled}
            />
        );
    }

    // String avec format multiline -> Textarea
    if (schema.type === 'string' && schema.format === 'multiline') {
        return (
            <textarea
                value={value || ''}
                onChange={(e) => onChange(key, e.target.value)}
                disabled={disabled}
                rows={5}
            />
        );
    }

    // String -> Text input par défaut
    return (
        <input
            type='text'
            value={value || ''}
            onChange={(e) => onChange(key, e.target.value)}
            disabled={disabled}
        />
    );
}

/**
 * Composant d'affichage des résultats
 */
const PluginResultDisplay: React.FC<{
    result: PluginResult;
    configMode: PluginExecutorMode;
    geocacheContext?: GeocacheContext;
    pluginName?: string | null;
    pluginsService: PluginsService;
    onRequestAddWaypoint?: (detail: AddWaypointEventDetail) => void;
    onVerifyCoordinates?: (coords?: { formatted?: string; latitude?: string; longitude?: string }) => Promise<{ status?: 'success' | 'failure' | 'unknown'; message?: string }>;
    onSetAsCorrectedCoords?: (gcCoords: string) => Promise<void>;
    messageService: MessageService;
}> = ({ result, configMode, geocacheContext, pluginName, pluginsService, onRequestAddWaypoint, onVerifyCoordinates, onSetAsCorrectedCoords, messageService }) => {
    console.log('=== PluginResultDisplay RENDER ===');
    console.log('Received result:', result);
    console.log('result.results:', result.results);
    console.log('result.summary:', result.summary);

    const [verifiedCoordinates, setVerifiedCoordinates] = React.useState<Record<string, { status?: string; message?: string }>>({});
    const [verifyingCoordinates, setVerifyingCoordinates] = React.useState<Record<string, boolean>>({});
    const [detectingCoordinates, setDetectingCoordinates] = React.useState<Record<string, boolean>>({});
    const [manualDetectedCoordinates, setManualDetectedCoordinates] = React.useState<Record<string, { latitude?: string; longitude?: string; formatted?: string }>>({});
    const dispatchedCoordinatesRef = React.useRef<Set<string>>(new Set());

    // Vérifications de sécurité
    if (!result) {
        console.error('PluginResultDisplay: result is null/undefined');
        return <div>Erreur: Aucun résultat à afficher</div>;
    }

    // Fonction pour copier du texte dans le presse-papier
    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    const toPercent = (value: any): number => {
        const v = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(v)) {
            return 0;
        }
        return Math.max(0, Math.min(100, Math.round(v * 100)));
    };

    const getScoreColor = (score: any): string => {
        const v = typeof score === 'number' ? score : Number(score);
        if (!Number.isFinite(v)) {
            return 'var(--theia-editor-background)';
        }
        if (v >= 0.8) {
            return 'var(--theia-button-background)';
        }
        if (v >= 0.5) {
            return 'var(--theia-list-hoverBackground)';
        }
        return 'var(--theia-editor-background)';
    };
    
    // Trier les résultats par confiance (décroissante) si disponible
    let sortedResults: any[] = [];
    try {
        sortedResults = result.results ? [...result.results].sort((a, b) => {
            const confA = a.confidence ?? 0;
            const confB = b.confidence ?? 0;
            return confB - confA;
        }) : [];
        console.log('sortedResults:', sortedResults);
    } catch (error) {
        console.error('Erreur lors du tri des résultats:', error);
        sortedResults = result.results || [];
    }

    const isBruteForce = sortedResults.length > 5; // Considérer comme brute-force si plus de 5 résultats
    const canRequestWaypoint = configMode === 'geocache' && !!geocacheContext && !!onRequestAddWaypoint;
    const canVerifyCoordinates = configMode === 'geocache' && !!geocacheContext?.checkers?.length && !!onVerifyCoordinates;
    const canSetAsCorrectedCoords = configMode === 'geocache' && !!geocacheContext?.geocacheId && !!onSetAsCorrectedCoords;

    const getCoordsKey = (coords?: { formatted?: string; latitude?: string; longitude?: string }): string => {
        if (!coords) {
            return '';
        }
        const formatted = (coords.formatted || '').toString().trim();
        if (formatted) {
            return formatted;
        }
        const lat = (coords.latitude || '').toString().trim();
        const lon = (coords.longitude || '').toString().trim();
        return `${lat} ${lon}`.trim();
    };

    const getItemKey = (item: any, index: number): string => {
        const id = (item && (item.id || item._id)) ? String(item.id || item._id) : '';
        if (id) {
            return id;
        }
        const text = (item && item.text_output) ? String(item.text_output).slice(0, 40) : '';
        return `${pluginName || 'result'}_${index}_${text}`;
    };

    const buildOriginCoords = (): { ddm_lat: string; ddm_lon: string } | undefined => {
        if (!geocacheContext?.coordinates?.latitude || !geocacheContext?.coordinates?.longitude) {
            return undefined;
        }
        return {
            ddm_lat: `N ${geocacheContext.coordinates.latitude}`,
            ddm_lon: `E ${geocacheContext.coordinates.longitude}`
        };
    };

    const buildGcCoords = (coords?: {
        latitude?: number | string;
        longitude?: number | string;
        formatted?: string;
    }): string | null => {
        if (!coords) {
            return null;
        }
        if (coords.latitude && coords.longitude) {
            return `${coords.latitude}, ${coords.longitude}`;
        }
        if (coords.formatted) {
            // Assurer un séparateur virgule pour WaypointsEditor
            const formatted = coords.formatted.trim();
            if (formatted.includes(',')) {
                return formatted;
            }
            const compact = formatted.replace(/\s+/g, ' ').trim();
            const tokens = compact.split(' ');
            if (tokens.length >= 4) {
                const latPart = tokens.slice(0, 2).join(' ');
                const lonPart = tokens.slice(2).join(' ');
                return `${latPart}, ${lonPart}`;
            }
            return formatted;
        }
        return null;
    };

    React.useEffect(() => {
        dispatchedCoordinatesRef.current.clear();
    }, [result, geocacheContext?.gcCode, geocacheContext?.geocacheId]);

    React.useEffect(() => {
        if (typeof window === 'undefined' || !geocacheContext) {
            return;
        }

        sortedResults.forEach((item, index) => {
            const itemKey = getItemKey(item, index);
            const manualCoords = manualDetectedCoordinates[itemKey];
            const resolvedCoordinates = manualCoords || deriveCoordinatesFromItem(item);
            if (!resolvedCoordinates) {
                return;
            }

            const gcCoords = buildGcCoords(resolvedCoordinates) || resolvedCoordinates.formatted;
            const decimalCoords = extractDecimalCoordinates(resolvedCoordinates, gcCoords || undefined);
            if (!decimalCoords) {
                return;
            }

            const dispatchKey = `${itemKey}-${decimalCoords.latitude}-${decimalCoords.longitude}`;
            if (dispatchedCoordinatesRef.current.has(dispatchKey)) {
                return;
            }

            dispatchedCoordinatesRef.current.add(dispatchKey);

            window.dispatchEvent(new CustomEvent('geoapp-map-highlight-coordinate', {
                detail: {
                    gcCode: geocacheContext.gcCode,
                    geocacheId: geocacheContext.geocacheId,
                    pluginName: result.plugin_info?.name || pluginName || 'Coordonnées détectées',
                    coordinates: {
                        latitude: decimalCoords.latitude,
                        longitude: decimalCoords.longitude,
                        formatted: resolvedCoordinates.formatted || gcCoords || `${decimalCoords.latitude}, ${decimalCoords.longitude}`
                    },
                    autoSaved: false,
                    replaceExisting: false,
                    waypointTitle: geocacheContext.name || pluginName || 'Coordonnée détectée',
                    waypointNote: item.text_output,
                    sourceResultText: item.text_output
                }
            }));
        });
    }, [sortedResults, manualDetectedCoordinates, geocacheContext, pluginName, result.plugin_info?.name]);

    console.log('PluginResultDisplay final render');
    console.log('result.status:', result.status);
    console.log('result.summary:', result.summary);
    console.log('sortedResults.length:', sortedResults.length);

    return (
        <div className='result-display'>
            <div className='result-status'>
                <strong>Statut:</strong> {result.status === 'ok' ? '✓ OK' : '⚠ ' + (result.status || 'Erreur')}
            </div>

            {/* Afficher le summary si disponible */}
            {result.summary && (
                <div style={{ marginBottom: '10px', opacity: 0.8 }}>
                    {typeof result.summary === 'string' ? result.summary :
                     typeof result.summary === 'object' && (result.summary as any).message ?
                         (result.summary as any).message :
                         JSON.stringify(result.summary, null, 2)}
                </div>
            )}

            {/* Debug info */}
            <div style={{ background: 'yellow', padding: '5px', margin: '10px 0', fontSize: '12px' }}>
                DEBUG: {sortedResults.length} résultat(s) à afficher
            </div>
            
            {/* Indicateur de mode brute-force */}
            {isBruteForce && (
                <div style={{ 
                    padding: '8px 12px', 
                    background: 'var(--theia-editor-background)', 
                    borderLeft: '3px solid var(--theia-focusBorder)',
                    marginBottom: '15px',
                    fontSize: '13px'
                }}>
                    💥 <strong>Mode force brute activé</strong> - {sortedResults.length} résultats trouvés (triés par pertinence)
                </div>
            )}

            {/* Afficher tous les résultats du tableau */}
            {sortedResults.length > 0 && (
                <div>
                    {sortedResults.map((item, index) => {
                        console.log(`Rendering result ${index}:`, item);
                        try {
                            const itemKey = getItemKey(item, index);
                            const manualCoords = manualDetectedCoordinates[itemKey];
                            const resolvedCoordinates = manualCoords || deriveCoordinatesFromItem(item);
                            return (
                                <div 
                                    key={item.id || index} 
                                    style={{ 
                                        marginBottom: '15px',
                                        padding: '12px',
                                        background: index === 0 && isBruteForce ? 'var(--theia-list-hoverBackground)' : 'transparent',
                                        border: '1px solid var(--theia-panel-border)',
                                        borderRadius: '4px',
                                        position: 'relative'
                                    }}
                                >
                                    {/* Badge de confiance en haut à droite */}
                                    {(item.confidence !== undefined || (item.metadata as any)?.plugin_confidence !== undefined) && (
                                        <div style={{
                                            position: 'absolute',
                                            top: '8px',
                                            right: '8px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '4px',
                                            alignItems: 'flex-end'
                                        }}>
                                            {item.confidence !== undefined && (
                                                <div style={{
                                                    padding: '4px 8px',
                                                    background: getScoreColor(item.confidence),
                                                    borderRadius: '3px',
                                                    fontSize: '11px',
                                                    fontWeight: 'bold'
                                                }}>
                                                    🎯 Score {toPercent(item.confidence)}%
                                                </div>
                                            )}
                                            {(item.metadata as any)?.plugin_confidence !== undefined && (
                                                <div style={{
                                                    padding: '3px 8px',
                                                    background: 'var(--theia-editor-background)',
                                                    border: '1px solid var(--theia-panel-border)',
                                                    borderRadius: '3px',
                                                    fontSize: '10px',
                                                    opacity: 0.9
                                                }}>
                                                    🔎 Plugin {toPercent((item.metadata as any).plugin_confidence)}%
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    
                                    {/* Always show text output if exists */}
                                    {item.text_output ? (
                                        <div className='result-text'>
                                            <strong>
                                                {isBruteForce ? `#${index + 1}` : 'Résultat'}
                                                {item.parameters?.shift !== undefined && item.parameters.shift !== null && ` (décalage: ${item.parameters.shift})`}
                                                {index === 0 && isBruteForce && ' 🏆'}
                                            </strong>
                                            <div className='output-content' style={{ position: 'relative', marginTop: '8px' }}>
                                                <pre style={{
                                                    whiteSpace: 'pre-wrap',
                                                    margin: 0,
                                                    paddingRight: '40px',
                                                    fontFamily: 'monospace',
                                                    fontSize: '13px'
                                                }}>{item.text_output}</pre>
                                                <button
                                                    className='theia-button secondary'
                                                    onClick={async () => {
                                                        const text = item.text_output ? String(item.text_output) : '';
                                                        if (!text.trim()) {
                                                            return;
                                                        }

                                                        setDetectingCoordinates(prev => ({ ...prev, [itemKey]: true }));
                                                        try {
                                                            const coords = await pluginsService.detectCoordinates(text, {
                                                                includeNumericOnly: false,
                                                                includeWritten: true,
                                                                writtenLanguages: ['fr', 'en'],
                                                                writtenMaxCandidates: 50,
                                                                writtenIncludeDeconcat: true,
                                                                originCoords: buildOriginCoords(),
                                                            });

                                                            if (coords && coords.exist) {
                                                                setManualDetectedCoordinates(prev => ({
                                                                    ...prev,
                                                                    [itemKey]: {
                                                                        latitude: coords.ddm_lat || '',
                                                                        longitude: coords.ddm_lon || '',
                                                                        formatted: coords.ddm || '',
                                                                    }
                                                                }));
                                                                messageService.info('Coordonnées détectées et ajoutées au résultat.');
                                                            } else {
                                                                messageService.info('Aucune coordonnée détectée sur ce résultat.');
                                                            }
                                                        } catch (e) {
                                                            messageService.error(`Erreur détection coordonnées: ${String(e)}`);
                                                        } finally {
                                                            setDetectingCoordinates(prev => ({ ...prev, [itemKey]: false }));
                                                        }
                                                    }}
                                                    title='Détecter coordonnées (texte, toutes langues)'
                                                    disabled={!!detectingCoordinates[itemKey]}
                                                    style={{ position: 'absolute', top: '5px', right: '45px', padding: '4px 8px' }}
                                                >
                                                    {detectingCoordinates[itemKey] ? '⏳' : '📍'}
                                                </button>
                                                <button
                                                    className='theia-button secondary'
                                                    onClick={() => copyToClipboard(item.text_output!)}
                                                    title='Copier'
                                                    style={{ position: 'absolute', top: '5px', right: '5px', padding: '4px 8px' }}
                                                >
                                                    📋
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div style={{ color: 'orange' }}>No text_output for result {index}</div>
                                    )}

                                    {resolvedCoordinates && (
                                        <div className='result-coordinates' style={{ 
                                            marginTop: '8px',
                                            padding: '10px',
                                            background: 'var(--theia-editor-background)',
                                            border: '1px solid var(--theia-focusBorder)',
                                            borderRadius: '4px'
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                                                <strong>📍 Coordonnées détectéees :</strong>
                                                <button
                                                    className='theia-button secondary'
                                                    onClick={() => copyToClipboard(resolvedCoordinates?.formatted ||
                                                        (resolvedCoordinates?.latitude && resolvedCoordinates?.longitude
                                                         ? `${resolvedCoordinates.latitude} ${resolvedCoordinates.longitude}`
                                                         : 'Coordonnées invalides'))}
                                                    title='Copier les coordonnées'
                                                    style={{ padding: '4px 8px', fontSize: '11px' }}
                                                >
                                                    📋 Copier
                                                </button>
                                                {canVerifyCoordinates && (
                                                    <button
                                                        className='theia-button'
                                                        onClick={async () => {
                                                            const key = resolvedCoordinates ? getCoordsKey(resolvedCoordinates) : undefined;
                                                            if (!key || !onVerifyCoordinates || !resolvedCoordinates) {
                                                                return;
                                                            }
                                                            setVerifyingCoordinates(prev => ({ ...prev, [key]: true }));
                                                            try {
                                                                const result = await onVerifyCoordinates(resolvedCoordinates);
                                                                const status = result?.status || 'unknown';
                                                                setVerifiedCoordinates(prev => ({
                                                                    ...prev,
                                                                    [key]: { status, message: result?.message }
                                                                }));

                                                                if (status === 'success') {
                                                                    messageService.info('Checker: coordonnées validées.');
                                                                } else if (status === 'failure') {
                                                                    messageService.warn('Checker: coordonnées refusées.');
                                                                } else {
                                                                    messageService.warn(result?.message || 'Checker: résultat indéterminé.');
                                                                }
                                                            } catch (error: any) {
                                                                messageService.error(error?.message || 'Erreur lors de la vérification via checker.');
                                                            } finally {
                                                                setVerifyingCoordinates(prev => ({ ...prev, [key]: false }));
                                                            }
                                                        }}
                                                        title='Envoyer ces coordonnées au checker de la géocache'
                                                        style={{ padding: '4px 8px', fontSize: '11px' }}
                                                        disabled={resolvedCoordinates ? verifyingCoordinates[getCoordsKey(resolvedCoordinates)] === true : false}
                                                    >
                                                        {resolvedCoordinates && verifyingCoordinates[getCoordsKey(resolvedCoordinates)] === true
                                                            ? '⏳ Vérification...'
                                                            : '🔎 Vérifier via Checkeur'}
                                                    </button>
                                                )}
                                                {canRequestWaypoint && resolvedCoordinates && buildGcCoords(resolvedCoordinates) && (
                                                    <>
                                                        {['manual', 'auto'].map(mode => (
                                                            <button
                                                                key={mode}
                                                                className='theia-button'
                                                                onClick={() => {
                                                                    const gcCoords = buildGcCoords(resolvedCoordinates);
                                                                    if (!gcCoords) {
                                                                        return;
                                                                    }
                                                                    const decimalCoords = extractDecimalCoordinates(resolvedCoordinates, gcCoords);
                                                                    if (!decimalCoords) {
                                                                        console.warn('[Plugin Executor] Impossible de convertir les coordonnées pour la carte', {
                                                                            coordinates: resolvedCoordinates,
                                                                            fallback: gcCoords
                                                                        });
                                                                    }
                                                                    onRequestAddWaypoint?.({
                                                                        gcCoords,
                                                                        pluginName: pluginName || result.plugin_info?.name,
                                                                        geocache: geocacheContext ? {
                                                                            gcCode: geocacheContext.gcCode,
                                                                            name: geocacheContext.name
                                                                        } : undefined,
                                                                        sourceResultText: item.text_output,
                                                                        waypointTitle: `${result.plugin_info?.name || pluginName || 'Coordonnées détectées'}`,
                                                                        waypointNote: item.text_output,
                                                                        autoSave: mode === 'auto',
                                                                        decimalLatitude: decimalCoords?.latitude,
                                                                        decimalLongitude: decimalCoords?.longitude
                                                                    });
                                                                }}
                                                                title={mode === 'auto'
                                                                    ? 'Créer immédiatement un waypoint validé'
                                                                    : 'Ajouter ces coordonnées comme nouveau waypoint'}
                                                                style={{ padding: '4px 8px', fontSize: '11px' }}
                                                            >
                                                                {mode === 'auto' ? '✅ Ajouter et valider' : '➕ Ajouter comme waypoint'}
                                                            </button>
                                                        ))}
                                                    </>
                                                )}
                                                {canSetAsCorrectedCoords && resolvedCoordinates && buildGcCoords(resolvedCoordinates) && (
                                                    <button
                                                        className='theia-button secondary'
                                                        onClick={() => {
                                                            const gcCoords = buildGcCoords(resolvedCoordinates);
                                                            if (gcCoords) {
                                                                onSetAsCorrectedCoords?.(gcCoords);
                                                            }
                                                        }}
                                                        title='Définir ces coordonnées comme coordonnées corrigées de la géocache'
                                                        style={{ padding: '4px 8px', fontSize: '11px' }}
                                                    >
                                                        📍 Corriger la cache
                                                    </button>
                                                )}
                                            </div>
                                            <div style={{ marginTop: '8px', fontFamily: 'monospace', fontSize: '14px', fontWeight: 'bold' }}>
                                                {(() => {
                                                    // Priorité 1: formatted ou ddm
                                                    if (resolvedCoordinates.formatted) {
                                                        return resolvedCoordinates.formatted;
                                                    }
                                                    if ((resolvedCoordinates as any).ddm) {
                                                        return (resolvedCoordinates as any).ddm;
                                                    }
                                                    // Priorité 2: ddm_lat + ddm_lon
                                                    if ((resolvedCoordinates as any).ddm_lat && (resolvedCoordinates as any).ddm_lon) {
                                                        return `${(resolvedCoordinates as any).ddm_lat} ${(resolvedCoordinates as any).ddm_lon}`;
                                                    }
                                                    // Priorité 3: decimal_latitude + decimal_longitude
                                                    if ((resolvedCoordinates as any).decimal_latitude !== undefined && (resolvedCoordinates as any).decimal_longitude !== undefined) {
                                                        return `${(resolvedCoordinates as any).decimal_latitude}, ${(resolvedCoordinates as any).decimal_longitude}`;
                                                    }
                                                    // Priorité 4: latitude + longitude (legacy)
                                                    if (resolvedCoordinates.latitude && resolvedCoordinates.longitude) {
                                                        return `${resolvedCoordinates.latitude} ${resolvedCoordinates.longitude}`;
                                                    }
                                                    return 'Coordonnées invalides';
                                                })()}
                                            </div>
                                            {(() => {
                                                const key = getCoordsKey(resolvedCoordinates);
                                                const record = key ? verifiedCoordinates[key] : undefined;
                                                if (!record) {
                                                    return null;
                                                }
                                                if (record.status === 'failure') {
                                                    return (
                                                        <div style={{ marginTop: '6px', fontSize: '12px', opacity: 0.85 }}>
                                                            ❌ Coordonnées refusées
                                                        </div>
                                                    );
                                                }
                                                if (record.status !== 'success') {
                                                    return null;
                                                }
                                                return (
                                                    <div style={{ marginTop: '6px', fontSize: '12px', opacity: 0.85 }}>
                                                        ✅ Coordonnées vérifiées
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    )}

                                    {(() => {
                                        const scoring = (item.metadata as any)?.scoring;
                                        if (!scoring || typeof scoring !== 'object') {
                                            return null;
                                        }

                                        const features = scoring.features || {};
                                        return (
                                            <div style={{ marginTop: '10px' }}>
                                                <details>
                                                    <summary style={{ cursor: 'pointer', fontSize: '12px', opacity: 0.85 }}>
                                                        🧠 Détails scoring
                                                    </summary>
                                                    <div style={{
                                                        marginTop: '8px',
                                                        padding: '10px',
                                                        background: 'var(--theia-editor-background)',
                                                        border: '1px solid var(--theia-panel-border)',
                                                        borderRadius: '4px',
                                                        fontSize: '12px'
                                                    }}>
                                                        {scoring.explanation && (
                                                            <div style={{ marginBottom: '6px', opacity: 0.9 }}>
                                                                <strong>Explication:</strong> {String(scoring.explanation)}
                                                            </div>
                                                        )}
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', opacity: 0.85 }}>
                                                            {scoring.language_detected && (
                                                                <div>
                                                                    <strong>Langue:</strong> {String(scoring.language_detected)}
                                                                    {scoring.language_confidence !== undefined && (
                                                                        <> ({toPercent(scoring.language_confidence)}%)</>
                                                                    )}
                                                                </div>
                                                            )}
                                                            {scoring.early_exit && (
                                                                <div>
                                                                    <strong>Early-exit:</strong> {String(scoring.early_exit)}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div style={{ marginTop: '8px', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px 12px' }}>
                                                            {features.gps_confidence !== undefined && (
                                                                <div><strong>GPS</strong>: {toPercent(features.gps_confidence)}%</div>
                                                            )}
                                                            {features.coord_words !== undefined && (
                                                                <div><strong>Mots coords</strong>: {toPercent(features.coord_words)}%</div>
                                                            )}
                                                            {features.lexical_coverage !== undefined && (
                                                                <div><strong>Lexical</strong>: {toPercent(features.lexical_coverage)}%</div>
                                                            )}
                                                            {features.ngram_fitness !== undefined && (
                                                                <div><strong>N-grams</strong>: {toPercent(features.ngram_fitness)}%</div>
                                                            )}
                                                            {features.quadgram_fitness !== undefined && (
                                                                <div><strong>Quadgrams</strong>: {toPercent(features.quadgram_fitness)}%</div>
                                                            )}
                                                            {features.repetition_quality !== undefined && (
                                                                <div><strong>Répétitions</strong>: {toPercent(features.repetition_quality)}%</div>
                                                            )}
                                                            {features.ic !== undefined && (
                                                                <div><strong>IC</strong>: {Number(features.ic).toFixed ? Number(features.ic).toFixed(3) : String(features.ic)}</div>
                                                            )}
                                                            {features.entropy !== undefined && (
                                                                <div><strong>Entropie</strong>: {Number(features.entropy).toFixed ? Number(features.entropy).toFixed(2) : String(features.entropy)}</div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </details>
                                            </div>
                                        );
                                    })()}

                                    {item.metadata && Object.keys(item.metadata).length > 0 && (
                                        <div className='result-metadata'>
                                            <strong>Métadonnées:</strong>
                                            <ul>
                                                {Object.entries(item.metadata)
                                                    .filter(([k]) => k !== 'scoring')
                                                    .map(([k, v]) => (
                                                    <li key={k}>
                                                        <strong>{k}:</strong>{' '}
                                                        {v !== null && typeof v === 'object'
                                                            ? JSON.stringify(v)
                                                            : String(v)}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    {item.parameters && Object.keys(item.parameters).length > 0 && (
                                        <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '8px' }}>
                                            <strong>Paramètres utilisés:</strong> {JSON.stringify(item.parameters, null, 2)}
                                        </div>
                                    )}
                                </div>
                            );
                        } catch (error) {
                            console.error(`Erreur lors du rendu du résultat ${index}:`, error, item);
                            return (
                                <div key={`error-${index}`} style={{
                                    marginBottom: '15px',
                                    padding: '12px',
                                    background: 'var(--theia-error-foreground)',
                                    color: 'white',
                                    borderRadius: '4px'
                                }}>
                                    Erreur lors de l'affichage du résultat #{index + 1}
                                </div>
                            );
                        }
                    })}
                </div>
            )}

            {/* Afficher les infos du plugin */}
            {result.plugin_info && (
                <div style={{ fontSize: '12px', opacity: 0.6, marginTop: '10px', borderTop: '1px solid var(--theia-panel-border)', paddingTop: '8px' }}>
                    Plugin: {result.plugin_info.name} v{result.plugin_info.version}
                    {result.plugin_info.execution_time_ms !== undefined && ` • Temps: ${result.plugin_info.execution_time_ms}ms`}
                </div>
            )}

            {/* Compatibilité : affichage des propriétés à la racine (ancien format) */}
            {!result.results && result.text_output && (
                <div className='result-text'>
                    <strong>Résultat texte:</strong>
                    <div className='output-content'>
                        {result.text_output}
                        <button
                            className='theia-button secondary'
                            onClick={() => copyToClipboard(result.text_output!)}
                            title='Copier'
                        >
                            📋
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
