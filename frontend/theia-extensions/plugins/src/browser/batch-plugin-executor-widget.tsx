/**
 * Widget pour l'exécution groupée de plugins sur plusieurs géocaches.
 * 
 * Ce widget permet d'appliquer un même plugin à plusieurs géocaches sélectionnées
 * depuis le GeocachesTable, avec un suivi de progression et une intégration carte.
 * 
 * MODE BATCH :
 * - Plusieurs géocaches sélectionnées (non modifiable)
 * - Sélecteur de plugin unique pour toute la sélection
 * - Exécution séquentielle ou parallèle
 * - Suivi de progression individuel et global
 * - Intégration carte pour visualiser les résultats
 */

import * as React from '@theia/core/shared/react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core/lib/common/message-service';
import { ApplicationShell, WidgetManager, ConfirmDialog } from '@theia/core/lib/browser';
import { Plugin, PluginDetails, PluginResult } from '../common/plugin-protocol';
import { PluginsServiceImpl } from './services/plugins-service';

/**
 * Fonctions utilitaires pour la gestion des cartes batch
 */

async function loadBatchMap(
    geocaches: BatchGeocacheContext[],
    shell: ApplicationShell,
    widgetManager: WidgetManager,
    messageService: MessageService
): Promise<void> {
    try {
        console.log('[Batch Map] Loading batch map with', geocaches.length, 'geocaches');
        
        // Convertir les géocaches au format MapGeocache
        const mapGeocaches = geocaches.map(gc => ({
            id: gc.id,
            gc_code: gc.gc_code,
            name: gc.name,
            latitude: gc.coordinates?.latitude || 0,
            longitude: gc.coordinates?.longitude || 0,
            cache_type: 'unknown',
            difficulty: gc.difficulty || 1,
            terrain: gc.terrain || 1,
            description: gc.description || '',
            hint: gc.hint || '',
            waypoints: gc.waypoints || []
        }));

        // Chercher une carte existante ou en créer une nouvelle
        const mapId = 'geoapp-map-batch';
        let existingMap = shell.getWidgets('bottom').find(w => w.id === mapId);
        
        if (!existingMap) {
            // Créer une nouvelle carte via le WidgetManager
            const mapWidget = await widgetManager.getOrCreateWidget('geoapp-map');
            if (mapWidget) {
                existingMap = mapWidget;
                existingMap.id = mapId;
                existingMap.title.label = `Carte Batch (${mapGeocaches.length} géocaches)`;
                existingMap.title.caption = `Carte pour l'exécution batch de plugins`;
                existingMap.title.iconClass = 'fa fa-layer-group';
                
                // Ouvrir la carte dans le panneau du bas
                await shell.addWidget(existingMap, { area: 'bottom' });
                await shell.activateWidget(existingMap.id);
                
                console.log('[Batch Map] Created and opened new map widget');
            }
        }

        // Charger les géocaches sur la carte
        if (existingMap && 'loadGeocaches' in existingMap) {
            console.log('[Batch Map] Loading geocaches onto map');
            (existingMap as any).loadGeocaches(mapGeocaches);
            messageService.info(`Carte batch ouverte avec ${mapGeocaches.length} géocaches`);
        } else {
            console.warn('[Batch Map] Map widget does not support loadGeocaches');
            messageService.info('Carte batch créée mais chargement des géocaches non supporté');
        }
        
    } catch (error) {
        console.error('[Batch Map] Error loading batch map:', error);
        messageService.error('Erreur lors de l\'ouverture de la carte batch');
    }
}

/**
 * Dispatche un événement pour afficher une coordonnée détectée sur la carte.
 * Utilise le même système d'événements que le plugin-executor-widget.
 */
function dispatchCoordinateToMap(
    gcCode: string,
    geocacheId: number,
    geocacheName: string,
    coordinates: { latitude: number; longitude: number; formatted: string },
    pluginName: string,
    sourceResultText?: string
): void {
    console.log('[Batch Map] Dispatching coordinate to map for', gcCode, coordinates);
    
    window.dispatchEvent(new CustomEvent('geoapp-map-highlight-coordinate', {
        detail: {
            gcCode: gcCode,
            geocacheId: geocacheId,
            pluginName: pluginName,
            coordinates: {
                latitude: coordinates.latitude,
                longitude: coordinates.longitude,
                formatted: coordinates.formatted
            },
            autoSaved: false,
            replaceExisting: false,
            // Utiliser le nom de la géocache pour l'affichage dans la popup de carte
            waypointTitle: geocacheName,
            waypointNote: sourceResultText || `Coordonnées détectées par ${pluginName}`,
            sourceResultText: sourceResultText
        }
    }));
    
    console.log('[Batch Map] Coordinate event dispatched for', gcCode);
}

/**
 * Contexte de géocache pour l'exécution groupée
 */
export interface BatchGeocacheContext {
    id: number;
    gc_code: string;
    name: string;
    original_latitude?: number;
    original_longitude?: number;
    original_coordinates_raw?: string;
    coordinates?: {
        latitude: number;
        longitude: number;
        coordinates_raw?: string;
    };
    description?: string;
    hint?: string;
    difficulty?: number;
    terrain?: number;
    waypoints?: any[];
}

/**
 * Configuration initiale du widget batch
 */
export interface BatchPluginExecutorConfig {
    geocaches: BatchGeocacheContext[];
    zoneId: number;
    zoneName?: string;
}

/**
 * Statut d'exécution individuel
 */
export type GeocacheExecutionStatus = 'pending' | 'executing' | 'completed' | 'error' | 'skipped';

/**
 * Résultat d'exécution pour une géocache
 */
export interface BatchGeocacheResult {
    geocacheId: number;
    gcCode: string;
    name: string;
    status: GeocacheExecutionStatus;
    result?: PluginResult;
    error?: string;
    coordinates?: {
        latitude: number;
        longitude: number;
        formatted: string;
    };
    executionTime?: number;
    startedAt?: Date;
    completedAt?: Date;
}

/**
 * État global de l'exécution batch
 */
export interface BatchExecutionState {
    plugin: string | null;
    pluginDetails: PluginDetails | null;
    formInputs: Record<string, any>;
    results: BatchGeocacheResult[];
    globalProgress: number; // 0-100
    isExecuting: boolean;
    isPaused: boolean;
    currentGeocacheIndex: number;
    executionMode: 'sequential' | 'parallel';
    maxConcurrency: number;
    startTime?: Date;
    endTime?: Date;
}

@injectable()
export class BatchPluginExecutorWidget extends ReactWidget {
    static readonly ID = 'batch-plugin-executor-widget';
    static readonly LABEL = 'Batch Plugin Executor';

    @inject(PluginsServiceImpl)
    protected readonly pluginsService!: PluginsServiceImpl;

    @inject(MessageService)
    protected readonly messageService!: MessageService;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    @inject(WidgetManager)
    protected readonly widgetManager!: WidgetManager;

    private config: BatchPluginExecutorConfig | null = null;

    @postConstruct()
    protected init(): void {
        this.id = BatchPluginExecutorWidget.ID;
        this.title.label = BatchPluginExecutorWidget.LABEL;
        this.title.caption = BatchPluginExecutorWidget.LABEL;
        this.title.closable = true;
        this.title.iconClass = 'fa fa-layer-group';
        this.update();

        // Écouter l'événement d'initialisation personnalisé
        this.setupEventListeners();
    }

    /**
     * Configure les écouteurs d'événements pour l'initialisation
     */
    private setupEventListeners(): void {
        window.addEventListener('batch-executor-initialize', (event: any) => {
            const detail = event.detail;
            if (detail && detail.geocaches) {
                console.log('[Batch Plugin Executor] Received initialization event', detail);
                this.initialize(detail);
            }
        });
    }

    /**
     * Initialise le widget avec la configuration batch
     */
    public initialize(config: BatchPluginExecutorConfig): void {
        this.config = config;
        this.title.label = `Batch: ${config.geocaches.length} géocaches`;
        console.log(`[Batch Plugin Executor] Initialized with ${config.geocaches.length} geocaches`);
        this.update();
    }

    protected render(): React.ReactNode {
        if (!this.config) {
            return (
                <div className='batch-plugin-executor-container' style={{ padding: '20px', textAlign: 'center' }}>
                    <div>⏳ Initialisation...</div>
                    <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '10px' }}>
                        En attente de configuration
                    </div>
                </div>
            );
        }

        return <BatchPluginExecutorComponent
            config={this.config}
            pluginsService={this.pluginsService}
            messageService={this.messageService}
            shell={this.shell}
            widgetManager={this.widgetManager}
        />;
    }
}

/**
 * Composant React pour l'interface d'exécution batch
 */
const BatchPluginExecutorComponent: React.FC<{
    config: BatchPluginExecutorConfig;
    pluginsService: PluginsServiceImpl;
    messageService: MessageService;
    shell: ApplicationShell;
    widgetManager: WidgetManager;
}> = ({ config, pluginsService, messageService, shell, widgetManager }) => {
    
    // État initial
    const [state, setState] = React.useState<BatchExecutionState>(() => ({
        plugin: null,
        pluginDetails: null,
        formInputs: {},
        results: config.geocaches.map(g => ({
            geocacheId: g.id,
            gcCode: g.gc_code,
            name: g.name,
            status: 'pending'
        })),
        globalProgress: 0,
        isExecuting: false,
        isPaused: false,
        currentGeocacheIndex: 0,
        executionMode: 'sequential',
        maxConcurrency: 3
    }));

    const originalGeocacheById = React.useMemo(() => {
        const map = new Map<number, BatchGeocacheContext>();
        config.geocaches.forEach(g => {
            map.set(g.id, g);
        });
        return map;
    }, [config.geocaches]);

    // Charger les géocaches sur la carte via WidgetManager
    React.useEffect(() => {
        if (config.geocaches.length > 0) {
            loadBatchMap(config.geocaches, shell, widgetManager, messageService);
        }
    }, [config.geocaches, shell, widgetManager, messageService]);

    // Référence pour suivre les coordonnées déjà dispatchées (évite les doublons)
    const dispatchedCoordinatesRef = React.useRef<Set<string>>(new Set());

    // Mettre à jour les coordonnées détectées sur la carte au fur et à mesure
    React.useEffect(() => {
        console.log('[Batch useEffect] Vérification des résultats pour dispatch carte:', 
            state.results.map(r => ({ gcCode: r.gcCode, status: r.status, hasCoords: !!r.coordinates })));
        
        state.results.forEach(result => {
            if (result.coordinates && result.status === 'completed') {
                // Créer une clé unique pour cette coordonnée
                const coordKey = `${result.gcCode}-${result.coordinates.latitude}-${result.coordinates.longitude}`;
                
                // Ne dispatcher que si pas déjà fait
                if (!dispatchedCoordinatesRef.current.has(coordKey)) {
                    dispatchedCoordinatesRef.current.add(coordKey);
                    
                    // Récupérer le texte source si disponible
                    const sourceText = result.result?.results?.[0]?.text_output;
                    
                    dispatchCoordinateToMap(
                        result.gcCode,
                        result.geocacheId,
                        result.name,
                        result.coordinates,
                        state.plugin || 'Batch Plugin',
                        sourceText
                    );
                    
                    console.log('[Batch] Coordonnées dispatchées pour', result.gcCode, result.coordinates.formatted);
                }
            }
        });
    }, [state.results, state.plugin]);

    const [plugins, setPlugins] = React.useState<Plugin[]>([]);
    const [isLoadingPlugins, setIsLoadingPlugins] = React.useState(false);

    // Charger les plugins disponibles
    React.useEffect(() => {
        const loadPlugins = async () => {
            setIsLoadingPlugins(true);
            try {
                const availablePlugins = await pluginsService.listPlugins({ enabled: true });
                setPlugins(availablePlugins);
            } catch (error) {
                messageService.error(`Erreur lors du chargement des plugins: ${error}`);
            } finally {
                setIsLoadingPlugins(false);
            }
        };
        loadPlugins();
    }, [pluginsService, messageService]);

    // Charger les détails du plugin sélectionné
    const loadPluginDetails = async (pluginName: string) => {
        try {
            const details = await pluginsService.getPlugin(pluginName);
            const initialInputs = generateInitialInputs(details, config.geocaches);
            
            setState(prev => ({
                ...prev,
                pluginDetails: details,
                formInputs: initialInputs,
                results: prev.results.map(r => ({ ...r, status: 'pending' as const }))
            }));
        } catch (error) {
            messageService.error(`Erreur lors du chargement du plugin: ${error}`);
        }
    };

    // Générer les inputs initiaux basés sur le contexte
    const generateInitialInputs = (details: PluginDetails, geocaches: BatchGeocacheContext[]): Record<string, any> => {
        const inputs: Record<string, any> = {};
        
        if (!details.input_schema?.properties) {
            return inputs;
        }

        // Pour le mode batch, on utilise des valeurs génériques
        for (const [key, schema] of Object.entries(details.input_schema.properties)) {
            const prop = schema as any;
            const metadataInputType = details.metadata?.input_types?.[key];
            const defaultValueSource = prop.default_value_source || metadataInputType?.default_value_source;

            if (defaultValueSource === 'geocache_description' && geocaches.length === 1) {
                // Si une seule géocache, on peut pré-remplir
                inputs[key] = geocaches[0].description || '';
            } else if (prop.default !== undefined) {
                inputs[key] = prop.default;
            } else if (prop.type === 'string') {
                inputs[key] = '';
            } else if (prop.type === 'number' || prop.type === 'integer') {
                inputs[key] = 0;
            } else if (prop.type === 'boolean') {
                inputs[key] = false;
            }
        }

        return inputs;
    };

    // Gérer le changement de plugin
    const handlePluginChange = (pluginName: string) => {
        setState(prev => ({ ...prev, plugin: pluginName }));
        if (pluginName) {
            loadPluginDetails(pluginName);
        }
    };

    // Gérer le changement des inputs
    const handleInputChange = (key: string, value: any) => {
        setState(prev => ({
            ...prev,
            formInputs: { ...prev.formInputs, [key]: value }
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

    // Démarrer l'exécution batch
    const handleStartExecution = async () => {
        if (!state.plugin || !state.pluginDetails) {
            messageService.error('Veuillez sélectionner un plugin');
            return;
        }

        // Réinitialiser le tracking des coordonnées pour cette nouvelle exécution
        dispatchedCoordinatesRef.current.clear();
        
        setState(prev => ({ ...prev, isExecuting: true, startTime: new Date() }));

        try {
            messageService.info(`Démarrage de l'exécution batch sur ${config.geocaches.length} géocaches`);

            // Préparer la requête batch
            const kinds = state.pluginDetails.metadata?.kinds as string[] | undefined;
            const includeImages = Array.isArray(kinds) && kinds.includes('image');
            let inputsToSend = { ...state.formInputs };

            try {
                const normalization = normalizeInputsForPlugin(inputsToSend, state.pluginDetails);
                inputsToSend = normalization.normalizedInputs;
                for (const warning of normalization.warnings) {
                    messageService.warn(warning);
                }
            } catch (error: any) {
                const errorMsg = error?.message || String(error);
                messageService.error(errorMsg);
                setState(prev => ({ ...prev, isExecuting: false }));
                return;
            }
            const batchRequest = {
                plugin_name: state.plugin,
                geocache_ids: config.geocaches.map(g => g.id),
                inputs: inputsToSend,
                options: {
                    execution_mode: state.executionMode,
                    max_concurrency: state.maxConcurrency,
                    detect_coordinates: true,
                    include_images: includeImages
                }
            };

            // Démarrer la tâche batch
            const response = await fetch('http://127.0.0.1:8000/api/plugins/batch-execute', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify(batchRequest)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            const batchResponse = await response.json();
            const taskId = batchResponse.task_id;

            messageService.info(`Tâche batch démarrée: ${taskId}`);

            // Démarrer le polling du statut
            await pollBatchStatus(taskId);

        } catch (error) {
            console.error('Erreur lors de l\'exécution batch:', error);
            messageService.error(`Erreur: ${error}`);
            setState(prev => ({ ...prev, isExecuting: false }));
        }
    };

    // Polling du statut de la tâche batch
    const pollBatchStatus = async (taskId: string) => {
        const pollInterval = setInterval(async () => {
            try {
                const response = await fetch(`http://127.0.0.1:8000/api/plugins/batch-status/${taskId}`, {
                    credentials: 'include'
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const status = await response.json();
                
                // DEBUG: Logger les résultats du backend
                console.log('[Batch Polling] Status reçu:', status.status, 'Progress:', status.progress);
                console.log('[Batch Polling] Résultats backend:', status.results?.map((r: any) => ({
                    gc_code: r.gc_code,
                    status: r.status,
                    hasCoordinates: !!r.coordinates,
                    coordinates: r.coordinates
                })));

                // Mettre à jour l'état avec les résultats du batch
                setState(prev => {
                    const updatedResults = config.geocaches.map(geocache => {
                        const backendResult = status.results.find((r: any) => r.geocache_id === geocache.id);
                        return {
                            geocacheId: geocache.id,
                            gcCode: geocache.gc_code,
                            name: geocache.name,
                            status: backendResult?.status || 'pending',
                            result: backendResult?.result,
                            error: backendResult?.error,
                            coordinates: backendResult?.coordinates,
                            executionTime: backendResult?.execution_time,
                            startedAt: backendResult?.started_at ? new Date(backendResult.started_at) : undefined,
                            completedAt: backendResult?.completed_at ? new Date(backendResult.completed_at) : undefined
                        };
                    });

                    return {
                        ...prev,
                        results: updatedResults,
                        globalProgress: status.progress?.percentage || 0,
                        currentGeocacheIndex: status.progress?.completed || 0,
                        isExecuting: status.status === 'running',
                        isPaused: status.status === 'cancelled',
                        endTime: status.status === 'completed' ? new Date() : undefined
                    };
                });

                // Arrêter le polling si la tâche est terminée
                if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
                    clearInterval(pollInterval);
                    messageService.info(`Exécution batch terminée: ${status.status}`);
                }

            } catch (error) {
                console.error('Erreur lors du polling du statut:', error);
                clearInterval(pollInterval);
                setState(prev => ({ ...prev, isExecuting: false }));
                messageService.error('Erreur lors du suivi de l\'exécution batch');
            }
        }, 1000); // Polling toutes les secondes

        // Nettoyer le polling si le composant est démonté
        return () => clearInterval(pollInterval);
    };

    // Mettre en pause/reprendre
    const handlePauseResume = () => {
        setState(prev => ({ ...prev, isPaused: !prev.isPaused }));
        messageService.info(state.isPaused ? 'Reprise de l\'exécution' : 'Exécution mise en pause');
    };

    // Arrêter l'exécution
    const handleStop = () => {
        setState(prev => ({
            ...prev,
            isExecuting: false,
            isPaused: false,
            endTime: new Date()
        }));
        messageService.info('Exécution arrêtée');
    };

    // Réinitialiser
    const handleReset = () => {
        // Réinitialiser le tracking des coordonnées dispatchées
        dispatchedCoordinatesRef.current.clear();
        
        setState(prev => ({
            ...prev,
            results: config.geocaches.map(g => ({
                geocacheId: g.id,
                gcCode: g.gc_code,
                name: g.name,
                status: 'pending' as const
            })),
            globalProgress: 0,
            isExecuting: false,
            isPaused: false,
            currentGeocacheIndex: 0,
            startTime: undefined,
            endTime: undefined
        }));
    };

    // Calculer les statistiques
    const stats = React.useMemo(() => {
        const completed = state.results.filter(r => r.status === 'completed').length;
        const errors = state.results.filter(r => r.status === 'error').length;
        const pending = state.results.filter(r => r.status === 'pending').length;
        const executing = state.results.filter(r => r.status === 'executing').length;
        const rateLimited = state.results.filter(r => !!(r as any)?.result?.metadata?.site_rate_limited).length;
        
        return { completed, errors, pending, executing, rateLimited };
    }, [state.results]);

    const formatGeocachingCoordinates = (lat: number, lon: number): string => {
        const latDir = lat >= 0 ? 'N' : 'S';
        const lonDir = lon >= 0 ? 'E' : 'W';

        const absLat = Math.abs(lat);
        const absLon = Math.abs(lon);

        const latDeg = Math.floor(absLat);
        const lonDeg = Math.floor(absLon);

        const latMin = (absLat - latDeg) * 60;
        const lonMin = (absLon - lonDeg) * 60;

        return `${latDir} ${latDeg}° ${latMin.toFixed(3)} ${lonDir} ${String(lonDeg).padStart(3, '0')}° ${lonMin.toFixed(3)}`;
    };

    const ensureGeocacheDetailsWidget = async (geocacheId: number, name?: string): Promise<void> => {
        try {
            const widget: any = await widgetManager.getOrCreateWidget('geocache.details.widget');

            if (widget && typeof widget.setGeocache === 'function') {
                widget.setGeocache({ geocacheId, name });
            }

            if (!widget.isAttached) {
                await shell.addWidget(widget, { area: 'main' });
            }

            await shell.activateWidget(widget.id);
        } catch (error) {
            console.error('[BatchPluginExecutor] Impossible d\'ouvrir les détails de la géocache pour le waypoint:', error);
            messageService.error('Impossible d\'ouvrir la géocache pour créer le waypoint');
        }
    };

    const createWaypointFromBatchResult = async (result: BatchGeocacheResult, autoSave: boolean): Promise<void> => {
        if (!result.coordinates) {
            messageService.error('Ce résultat ne contient pas de coordonnées valides');
            return;
        }

        try {
            // S'assurer que le widget de détails de la géocache est ouvert et chargé
            await ensureGeocacheDetailsWidget(result.geocacheId, result.name);

            const coords = result.coordinates;
            const gcCoords = formatGeocachingCoordinates(coords.latitude, coords.longitude);

            const sourceText = result.result?.results?.[0]?.text_output || coords.formatted;
            const note = `Coordonnées détectées par ${state.plugin || 'Batch Plugin'}\n\n${sourceText || ''}`;
            const title = result.name || `Résultat pour ${result.gcCode}`;

            const dispatchEvent = () => {
                window.dispatchEvent(new CustomEvent('geoapp-plugin-add-waypoint', {
                    detail: {
                        gcCoords,
                        pluginName: state.plugin || 'Batch Plugin',
                        geocache: result.gcCode ? { gcCode: result.gcCode, name: result.name } : undefined,
                        waypointTitle: title,
                        waypointNote: note,
                        sourceResultText: sourceText,
                        decimalLatitude: coords.latitude,
                        decimalLongitude: coords.longitude,
                        autoSave
                    }
                }));
            };

            if (autoSave) {
                // Pour l'autoSave, la géocacheId est suffisante, on peut déclencher immédiatement
                dispatchEvent();
            } else {
                // Pour le formulaire éditable, laisser un court délai pour que le formulaire se monte
                setTimeout(() => {
                    dispatchEvent();
                }, 300);
            }

            if (autoSave) {
                messageService.info(`${title} validé automatiquement en waypoint`);
            } else {
                messageService.info(`${title}: formulaire de waypoint ouvert`);
            }

        } catch (error) {
            console.error('[BatchPluginExecutor] Erreur lors de la création du waypoint depuis le batch:', error);
            messageService.error('Erreur lors de la création du waypoint');
        }
    };

    const openGeocachePage = (geocacheId: number) => {
        try {
            window.dispatchEvent(new CustomEvent('geoapp-open-geocache-details', {
                detail: { geocacheId }
            }));
        } catch (error) {
            console.error('[BatchPluginExecutor] Failed to dispatch geoapp-open-geocache-details event', error);
        }
    };

    const applyDetectedCoordinatesAsCorrected = async (geocacheId: number, coordinatesRaw: string): Promise<boolean> => {
        try {
            const sanitized = coordinatesRaw.replace(/'/g, '').replace(/\s+/g, ' ').trim();
            const response = await fetch(`http://127.0.0.1:8000/api/geocaches/${geocacheId}/coordinates`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ coordinates_raw: sanitized })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            messageService.info('Coordonnées corrigées mises à jour pour cette géocache');
            return true;
        } catch (error) {
            console.error('[BatchPluginExecutor] Erreur lors de la mise à jour des coordonnées corrigées:', error);
            messageService.error(`Erreur lors de la mise à jour des coordonnées: ${error}`);
            return false;
        }
    };

    const handleApplyAllDetectedCoordinates = async () => {
        const targets = state.results.filter(r => r.coordinates);

        if (targets.length === 0) {
            messageService.info('Aucune coordonnée trouvée à appliquer');
            return;
        }

        const dialog = new ConfirmDialog({
            title: 'Appliquer les coordonnées trouvées',
            msg: `Voulez-vous appliquer les coordonnées trouvées à ${targets.length} géocache(s) ?`,
            ok: 'Confirmer',
            cancel: 'Annuler'
        });

        const confirmed = await dialog.open();
        if (!confirmed) {
            return;
        }

        let successCount = 0;
        let errorCount = 0;

        for (const result of targets) {
            const coords = result.coordinates!;
            const normalizedGcCoords = formatGeocachingCoordinates(coords.latitude, coords.longitude);
            const ok = await applyDetectedCoordinatesAsCorrected(result.geocacheId, normalizedGcCoords);
            if (ok) {
                successCount++;
            } else {
                errorCount++;
            }
        }

        if (successCount > 0) {
            messageService.info(`Coordonnées appliquées pour ${successCount} géocache(s)`);
        }
        if (errorCount > 0) {
            messageService.warn(`Échec de l'application des coordonnées pour ${errorCount} géocache(s)`);
        }
    };

    const handleCreateAllWaypointsFromDetectedCoordinates = async () => {
        const targets = state.results.filter(r => r.coordinates);

        if (targets.length === 0) {
            messageService.info('Aucune coordonnée trouvée pour créer des waypoints');
            return;
        }

        const dialog = new ConfirmDialog({
            title: 'Créer les waypoints détectés',
            msg: `Créer automatiquement un waypoint pour ${targets.length} géocache(s) avec les coordonnées trouvées ?`,
            ok: 'Créer',
            cancel: 'Annuler'
        });

        const confirmed = await dialog.open();
        if (!confirmed) {
            return;
        }

        let successCount = 0;
        let errorCount = 0;

        for (const result of targets) {
            if (!result.coordinates) {
                continue;
            }

            try {
                const coords = result.coordinates;
                const gcCoords = formatGeocachingCoordinates(coords.latitude, coords.longitude);
                const sourceText = result.result?.results?.[0]?.text_output || coords.formatted;

                const payload = {
                    name: result.name || `Waypoint détecté - ${result.gcCode}`,
                    gc_coords: gcCoords,
                    note: `Coordonnées détectées par ${state.plugin || 'Batch Plugin'}\n\n${coords.formatted}${sourceText ? `\n\n${sourceText}` : ''}`
                };

                const response = await fetch(`http://127.0.0.1:8000/api/geocaches/${result.geocacheId}/waypoints`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include',
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                successCount++;
            } catch (error) {
                console.error('[BatchPluginExecutor] Erreur lors de la création automatique du waypoint:', error);
                errorCount++;
            }
        }

        if (successCount > 0) {
            messageService.info(`Waypoints créés automatiquement pour ${successCount} géocache(s)`);
        }
        if (errorCount > 0) {
            messageService.warn(`Échec de la création des waypoints pour ${errorCount} géocache(s)`);
        }
    };

    return (
        <div className='batch-plugin-executor-container' style={{ padding: '16px', height: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            
            {/* En-tête */}
            <div className='batch-executor-header' style={{ borderBottom: '1px solid var(--theia-panel-border)', paddingBottom: '12px' }}>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>🔧</span> Exécution Groupée de Plugins !!!
                </h3>
                <div style={{ fontSize: '14px', opacity: 0.8, marginTop: '4px' }}>
                    {config.zoneName && `Zone: ${config.zoneName} • `}
                    {config.geocaches.length} géocache(s) sélectionnée(s)
                </div>
            </div>

            {/* Configuration du plugin */}
            <div className='batch-plugin-config' style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '250px' }}>
                    <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>Plugin à exécuter</label>
                    <select
                        value={state.plugin || ''}
                        onChange={(e) => handlePluginChange(e.target.value)}
                        disabled={state.isExecuting || isLoadingPlugins}
                        className='theia-select'
                        style={{ width: '100%' }}
                    >
                        <option value="">-- Sélectionner un plugin --</option>
                        {plugins.map(plugin => (
                            <option key={plugin.name} value={plugin.name}>
                                {plugin.name} - {plugin.description}
                            </option>
                        ))}
                    </select>
                </div>

                <div style={{ flex: 1, minWidth: '200px' }}>
                    <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>Mode d'exécution</label>
                    <select
                        value={state.executionMode}
                        onChange={(e) => setState(prev => ({ ...prev, executionMode: e.target.value as 'sequential' | 'parallel' }))}
                        disabled={state.isExecuting}
                        className='theia-select'
                        style={{ width: '100%' }}
                    >
                        <option value="sequential">Séquentiel (recommandé)</option>
                        <option value="parallel">Parallèle (expérimental)</option>
                    </select>
                </div>
            </div>

            {/* Paramètres du plugin */}
            {state.pluginDetails && (
                <div className='batch-plugin-params' style={{ background: 'var(--theia-editor-background)', padding: '12px', borderRadius: '4px' }}>
                    <h4 style={{ margin: '0 0 8px 0' }}>📦 Paramètres du plugin: {state.pluginDetails.name}</h4>
                    <p style={{ margin: '0 0 12px 0', fontSize: '13px', opacity: 0.8 }}>{state.pluginDetails.description}</p>
                    
                    {/* Formulaire des paramètres */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {state.pluginDetails.input_schema && Object.entries(state.pluginDetails.input_schema.properties || {}).map(([key, schema]) => {
                            const prop = schema as any;
                            const value = state.formInputs[key] || '';
                            
                            return (
                                <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <label style={{ fontSize: '13px', fontWeight: 500 }}>{prop.title || key}</label>
                                    {prop.type === 'boolean' ? (
                                        <input
                                            type="checkbox"
                                            checked={value}
                                            onChange={(e) => handleInputChange(key, e.target.checked)}
                                            disabled={state.isExecuting}
                                        />
                                    ) : (
                                        <input
                                            type={prop.type === 'number' ? 'number' : 'text'}
                                            value={value}
                                            onChange={(e) => handleInputChange(key, prop.type === 'number' ? Number(e.target.value) : e.target.value)}
                                            disabled={state.isExecuting}
                                            placeholder={prop.description || ''}
                                            style={{ padding: '4px 8px', border: '1px solid var(--theia-input-border)', borderRadius: '3px' }}
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Contrôles d'exécution */}
            <div className='batch-execution-controls' style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {!state.isExecuting ? (
                    <button
                        onClick={handleStartExecution}
                        disabled={!state.plugin || !state.pluginDetails}
                        className='theia-button primary'
                    >
                        ▶️ Démarrer l'exécution
                    </button>
                ) : (
                    <>
                        <button
                            onClick={handlePauseResume}
                            className='theia-button secondary'
                        >
                            {state.isPaused ? '▶️ Reprendre' : '⏸️ Pause'}
                        </button>
                        <button
                            onClick={handleStop}
                            className='theia-button secondary'
                            style={{ color: 'var(--theia-errorForeground)' }}
                        >
                            ⏹️ Arrêter
                        </button>
                    </>
                )}
                
                <button
                    onClick={handleReset}
                    disabled={state.isExecuting}
                    className='theia-button secondary'
                >
                    🔄 Réinitialiser
                </button>

                <div style={{ marginLeft: 'auto', fontSize: '13px', opacity: 0.8 }}>
                    {stats.completed} ✅ • {stats.errors} ❌ • {stats.pending} ⏳
                    {stats.rateLimited > 0 ? ` • ${stats.rateLimited} ⚠️ limitée(s)` : ''}
                </div>
            </div>

            {stats.rateLimited > 0 && (
                <div style={{
                    fontSize: '12px',
                    padding: '8px 10px',
                    borderRadius: '4px',
                    border: '1px solid rgba(241, 196, 15, 0.35)',
                    background: 'rgba(241, 196, 15, 0.08)'
                }}>
                    ⚠️ <strong>solvedjigidi.com semble saturé</strong> pour {stats.rateLimited} géocache(s). Essaie plus tard ou relance en mode séquentiel.
                </div>
            )}

            {/* Barre de progression */}
            {state.isExecuting && (
                <div className='batch-progress-bar' style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                        <span>Progression globale</span>
                        <span>{state.globalProgress}%</span>
                    </div>
                    <div style={{ 
                        height: '8px', 
                        background: 'var(--theia-panel-background)', 
                        borderRadius: '4px', 
                        overflow: 'hidden',
                        border: '1px solid var(--theia-panel-border)'
                    }}>
                        <div 
                            style={{ 
                                height: '100%', 
                                width: `${state.globalProgress}%`, 
                                background: 'var(--theia-activityBar-background)',
                                transition: 'width 0.3s ease'
                            }}
                        />
                    </div>
                </div>
            )}

            {/* Carte OpenLayers - Gérée par le MapService partagé */}
            <div className='batch-map-container' style={{ 
                height: '120px', 
                border: '1px solid var(--theia-panel-border)', 
                borderRadius: '4px',
                background: 'var(--theia-editor-background)',
                overflow: 'hidden'
            }}>
                <div style={{ 
                    padding: '12px', 
                    background: 'var(--theia-editor-background)',
                    fontSize: '13px',
                    fontWeight: 500,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                }}>
                    <span>🗺️ Carte des géocaches</span>
                    <span style={{ fontSize: '11px', opacity: 0.7 }}>
                        {config.geocaches.length} géocache(s) • {state.results.filter(r => r.coordinates).length} coordonnée(s) détectée(s)
                    </span>
                </div>
                <div style={{ 
                    padding: '16px',
                    textAlign: 'center',
                    fontSize: '12px',
                    opacity: 0.8,
                    background: 'linear-gradient(135deg, var(--theia-layout-background) 0%, var(--theia-editor-background) 100%)'
                }}>
                    <div style={{ marginBottom: '8px' }}>
                        📍 <strong>Carte gérée par le Gestionnaire de Carte</strong>
                    </div>
                    <div style={{ fontSize: '11px', lineHeight: '1.4' }}>
                        Les géocaches sélectionnées sont affichées dans la carte principale.<br/>
                        Les coordonnées découvertes apparaissent en temps réel sur la carte.
                    </div>
                    <div style={{ marginTop: '8px', fontSize: '10px', opacity: 0.6 }}>
                        Ouvre la carte via <code>View {'>'} GeoApp Map</code> ou <code>Ctrl+M</code>
                    </div>
                </div>
            </div>

            {/* Liste des géocaches et résultats - TOUJOURS VISIBLE */}
            <div className='batch-geocaches-list' style={{ 
                flex: 1, 
                overflow: 'auto', 
                border: '1px solid var(--theia-panel-border)', 
                borderRadius: '4px',
                minHeight: '300px',
                display: 'flex',
                flexDirection: 'column'
            }}>
                <div style={{ padding: '12px', borderBottom: '1px solid var(--theia-panel-border)', background: 'var(--theia-editor-background)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                    <h4 style={{ margin: 0 }}>📋 Géocaches ({config.geocaches.length})</h4>
                    {state.results.some(r => r.coordinates) && (
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <button
                                className='theia-button secondary'
                                onClick={handleApplyAllDetectedCoordinates}
                                style={{ fontSize: '0.85em', padding: '4px 8px' }}
                            >
                                ✅ Utiliser toutes les coordonnées trouvées
                            </button>
                            <button
                                className='theia-button secondary'
                                onClick={handleCreateAllWaypointsFromDetectedCoordinates}
                                style={{ fontSize: '0.85em', padding: '4px 8px' }}
                            >
                                🧭 Créer tous les waypoints
                            </button>
                        </div>
                    )}
                </div>
                <div style={{ flex: 1, overflow: 'auto' }}>
                    {state.results.map((result, index) => {
                        const originalGeocache = originalGeocacheById.get(result.geocacheId);
                        const originalCoordsRaw = originalGeocache?.original_coordinates_raw
                            || originalGeocache?.coordinates?.coordinates_raw;
                        const pluginSummary = (result as any)?.result?.summary as string | undefined;
                        const siteRateLimited = !!(result as any)?.result?.metadata?.site_rate_limited;
                        const siteRetryAfterSeconds = (result as any)?.result?.metadata?.site_retry_after_seconds as number | undefined;

                        return (
                            <div 
                                key={result.geocacheId}
                                style={{ 
                                    padding: '8px 12px', 
                                    borderBottom: '1px solid var(--theia-panel-border)',
                                    background: result.status === 'executing' ? 'var(--theia-list-activeSelectionBackground)' : 
                                              result.status === 'completed' ? 'rgba(46, 204, 113, 0.1)' :
                                              result.status === 'error' ? 'rgba(231, 76, 60, 0.1)' : 'transparent'
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                            <button
                                                onClick={() => openGeocachePage(result.geocacheId)}
                                                className='theia-button secondary'
                                                title={`Ouvrir la géocache ${result.gcCode} dans l'application`}
                                                style={{ padding: '2px 6px', fontSize: '0.85em' }}
                                            >
                                                📖
                                            </button>
                                            <strong>{result.gcCode}</strong> - {result.name}
                                            <div style={{ fontSize: '16px' }}>
                                                {result.status === 'pending' && '⏳'}
                                                {result.status === 'executing' && '🔄'}
                                                {result.status === 'completed' && '✅'}
                                                {result.status === 'error' && '❌'}
                                            </div>
                                        </div>

                                        {originalCoordsRaw && (
                                            <div style={{ fontSize: '12px', opacity: 0.8, marginTop: '4px', padding: '4px 8px', background: 'rgba(52, 152, 219, 0.06)', borderRadius: '3px', border: '1px solid rgba(52, 152, 219, 0.3)' }}>
                                                📌 <strong>Coordonnées d'origine:</strong> {originalCoordsRaw}
                                            </div>
                                        )}

                                        {siteRateLimited && (
                                            <div style={{
                                                fontSize: '12px',
                                                marginTop: '6px',
                                                padding: '6px 8px',
                                                background: 'rgba(241, 196, 15, 0.08)',
                                                borderRadius: '3px',
                                                border: '1px solid rgba(241, 196, 15, 0.35)'
                                            }}>
                                                ⚠️ <strong>Site saturé</strong> — réessayer plus tard
                                                {typeof siteRetryAfterSeconds === 'number' && siteRetryAfterSeconds > 0 ? ` (~${siteRetryAfterSeconds}s)` : ''}.
                                            </div>
                                        )}

                                        {!siteRateLimited && pluginSummary && (
                                            <div style={{ fontSize: '11px', opacity: 0.7, marginTop: '6px' }}>
                                                {pluginSummary}
                                            </div>
                                        )}

                                        {result.coordinates && (
                                            <div style={{ fontSize: '12px', opacity: 0.8, marginTop: '4px', padding: '4px 8px', background: 'rgba(46, 204, 113, 0.1)', borderRadius: '3px', border: '1px solid rgba(46, 204, 113, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                                                <span>
                                                    📍 <strong>Coordonnées trouvées:</strong> {result.coordinates.formatted}
                                                </span>
                                                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                                    <button
                                                        className='theia-button secondary'
                                                        onClick={() => createWaypointFromBatchResult(result, false)}
                                                        style={{ padding: '2px 6px', fontSize: '0.8em' }}
                                                        title="Ouvrir le formulaire de waypoint prérempli pour ces coordonnées"
                                                    >
                                                        ➕ Waypoint
                                                    </button>
                                                    <button
                                                        className='theia-button secondary'
                                                        onClick={() => createWaypointFromBatchResult(result, true)}
                                                        style={{ padding: '2px 6px', fontSize: '0.8em' }}
                                                        title="Créer et valider immédiatement un waypoint avec ces coordonnées"
                                                    >
                                                        ✅ Ajouter & valider
                                                    </button>
                                                    <button
                                                        className='theia-button secondary'
                                                        onClick={() => applyDetectedCoordinatesAsCorrected(result.geocacheId, result.coordinates!.formatted)}
                                                        style={{ padding: '2px 6px', fontSize: '0.8em' }}
                                                        title="Utiliser ces coordonnées comme coordonnées corrigées de la géocache"
                                                    >
                                                        💾 Corriger
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        {result.result && result.result.results && result.result.results.length > 0 && (
                                            <div style={{ marginTop: '8px' }}>
                                                <div style={{ fontSize: '12px', fontWeight: 500, marginBottom: '4px' }}>📋 Résultats:</div>
                                                {result.result.results.map((item: any, idx: number) => (
                                                    <div key={idx} style={{ fontSize: '11px', opacity: 0.7, marginBottom: '2px', paddingLeft: '8px' }}>
                                                        • {item.text_output ? item.text_output.substring(0, 100) + (item.text_output.length > 100 ? '...' : '') : 'Pas de texte'}
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {result.error && (
                                            <div style={{ fontSize: '12px', color: 'var(--theia-errorForeground)', marginTop: '4px', padding: '4px 8px', background: 'rgba(231, 76, 60, 0.1)', borderRadius: '3px' }}>
                                                ❌ <strong>Erreur:</strong> {result.error}
                                            </div>
                                        )}

                                        {result.executionTime && (
                                            <div style={{ fontSize: '11px', opacity: 0.6, marginTop: '4px' }}>
                                                ⏱️ Temps d'exécution: {result.executionTime.toFixed(0)}ms
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

        </div>
    );
};
