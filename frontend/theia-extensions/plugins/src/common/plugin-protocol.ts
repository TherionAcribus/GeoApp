/**
 * Interfaces pour la gestion des plugins MysterAI.
 * 
 * Ces interfaces correspondent aux structures de données retournées
 * par l'API backend Flask.
 */

/**
 * Représente un plugin MysterAI.
 */
export interface Plugin {
    /** ID unique du plugin en base de données */
    id?: number;
    
    /** Nom unique du plugin */
    name: string;
    
    /** Version du plugin */
    version: string;
    
    /** Version de l'API plugin supportée */
    plugin_api_version?: string;
    
    /** Description du plugin */
    description?: string;
    
    /** Auteur du plugin */
    author?: string;
    
    /** Type de plugin (python, binary, javascript) */
    plugin_type: 'python' | 'binary' | 'javascript';
    
    /** Source du plugin (official, custom) */
    source: 'official' | 'custom';
    
    /** Chemin vers le répertoire du plugin */
    path: string;
    
    /** Point d'entrée (fichier principal) */
    entry_point?: string;
    
    /** Catégories du plugin */
    categories?: string[];
    
    /** Catégorie principale (première catégorie de la liste) */
    category?: string;
    
    /** Schéma JSON d'entrée du plugin */
    input_schema?: PluginSchema;
    
    /** Schéma JSON de sortie du plugin */
    output_schema?: PluginSchema;
    
    /** Types d'entrée supportés */
    input_types?: Record<string, PluginInputType>;
    
    /** Indique si le plugin est gourmand en CPU */
    heavy_cpu?: boolean;
    
    /** Indique si le plugin nécessite une connexion réseau */
    needs_network?: boolean;
    
    /** Indique si le plugin nécessite l'accès au système de fichiers */
    needs_filesystem?: boolean;
    
    /** Indique si le plugin est activé */
    enabled?: boolean;
    
    /** Métadonnées additionnelles (JSON) */
    metadata_json?: string;
    
    /** Date de création */
    created_at?: string;
    
    /** Date de dernière mise à jour */
    updated_at?: string;
}

/**
 * Schéma JSON pour les entrées/sorties d'un plugin.
 */
export interface PluginSchema {
    /** Type du schéma */
    type?: string;
    
    /** Propriétés du schéma */
    properties?: Record<string, any>;
    
    /** Champs obligatoires */
    required?: string[];
    
    /** Autres propriétés JSON Schema */
    [key: string]: any;
}

/**
 * Détails complets d'un plugin (inclut les schémas).
 */
export interface PluginDetails extends Plugin {
    /** Schéma d'entrée (obligatoire pour les détails) */
    input_schema: PluginSchema;
    
    /** Schéma de sortie */
    output_schema?: PluginSchema;
    
    /** Métadonnées complètes du plugin (contient input_types, output_types, etc.) */
    metadata?: Record<string, any>;
    
    /** Types de sortie */
    output_types?: Record<string, any>;
}

/**
 * Définition d'un type d'entrée pour un plugin.
 */
export interface PluginInputType {
    /** Type de données (string, number, boolean, coordinates, etc.) */
    type: string;
    
    /** Label à afficher dans l'interface */
    label?: string;
    
    /** Description de l'entrée */
    description?: string;
    
    /** Valeur par défaut */
    default?: any;
    
    /** Indique si l'entrée est obligatoire */
    required?: boolean;
    
    /** Valeurs possibles (pour les énumérations) */
    enum?: any[];
    
    /** Validation (regex, min, max, etc.) */
    validation?: Record<string, any>;
}

/**
 * Filtres pour la liste des plugins.
 */
export interface PluginFilters {
    /** Filtrer par source */
    source?: 'official' | 'custom';
    
    /** Filtrer par catégorie */
    category?: string;
    
    /** Filtrer par statut enabled */
    enabled?: boolean;
}

export interface MetasolverPresetInfo {
    label: string;
    description: string;
}

export interface MetasolverEligiblePlugin {
    name: string;
    description: string;
    input_charset: string;
    tags: string[];
    priority: number;
}

export interface MetasolverEligiblePluginsResponse {
    preset: string;
    preset_label?: string;
    preset_filter?: Record<string, any> | null;
    plugins: MetasolverEligiblePlugin[];
    total: number;
    available_presets?: Record<string, MetasolverPresetInfo>;
}

export interface MetasolverSignature {
    raw_length: number;
    trimmed_length: number;
    non_space_length: number;
    letter_count: number;
    digit_count: number;
    symbol_count: number;
    whitespace_count: number;
    word_count: number;
    group_count: number;
    average_group_length: number;
    charsets_present: string[];
    dominant_input_kind: string;
    separators: string[];
    looks_like_morse: boolean;
    looks_like_binary: boolean;
    looks_like_hex: boolean;
    looks_like_phone_keypad: boolean;
    looks_like_roman_numerals: boolean;
    looks_like_decimal_sequence: boolean;
    looks_like_a1z26: boolean;
    looks_like_tap_code: boolean;
    looks_like_polybius: boolean;
    looks_like_multitap: boolean;
    looks_like_chemical_symbols: boolean;
    looks_like_houdini_words: boolean;
    looks_like_nak_nak: boolean;
    looks_like_shadok: boolean;
    looks_like_tom_tom: boolean;
    looks_like_gold_bug: boolean;
    looks_like_postnet: boolean;
    looks_like_prime_sequence: boolean;
    looks_like_bacon: boolean;
    looks_like_coordinate_fragment: boolean;
    suggested_preset: string;
}

export interface MetasolverRecommendation {
    name: string;
    description: string;
    input_charset: string;
    tags: string[];
    priority: number;
    score: number;
    confidence: number;
    reasons: string[];
}

export interface MetasolverRecommendationRequest {
    text: string;
    preset?: string;
    mode?: 'decode' | 'detect';
    max_plugins?: number;
}

export interface MetasolverRecommendationResponse {
    requested_preset?: string | null;
    effective_preset: string;
    effective_preset_label?: string;
    preset_filter?: Record<string, any> | null;
    mode: string;
    max_plugins: number;
    signature: MetasolverSignature;
    recommendations: MetasolverRecommendation[];
    selected_plugins: string[];
    plugin_list: string;
    eligible_total: number;
    available_presets?: Record<string, MetasolverPresetInfo>;
    explanation?: string[];
}

export interface ListingClassificationLabel {
    name: string;
    confidence: number;
    evidence: string[];
    suggested_next_step?: string;
}

export interface ListingSecretFragment {
    source: string;
    source_kind: string;
    text: string;
    score: number;
    confidence: number;
    signature: MetasolverSignature;
    evidence: string[];
}

export interface ListingClassificationRequest {
    geocache_id?: number;
    title?: string;
    description?: string;
    description_html?: string;
    hint?: string;
    waypoints?: Array<Record<string, any>>;
    checkers?: Array<Record<string, any>>;
    images?: Array<Record<string, any>>;
    max_secret_fragments?: number;
}

export interface ListingClassificationResponse {
    source: 'direct_input' | 'geocache';
    geocache?: {
        id: number;
        gc_code: string;
        name?: string;
    } | null;
    title?: string | null;
    max_secret_fragments: number;
    labels: ListingClassificationLabel[];
    recommended_actions: string[];
    candidate_secret_fragments: ListingSecretFragment[];
    hidden_signals: string[];
    formula_signals: string[];
    signal_summary: {
        has_title: boolean;
        has_hint: boolean;
        has_description_html: boolean;
        image_count: number;
        image_hint_count: number;
        image_hint_sources: string[];
        checker_count: number;
        waypoint_count: number;
        formula_signal_count: number;
        variable_assignment_count: number;
        has_formula_coordinate_placeholders: boolean;
        projection_keyword_count: number;
        visual_image_signal_count: number;
        direct_structured_fragment_count: number;
        hidden_structured_fragment_count: number;
        image_structured_fragment_count: number;
        direct_domain_score: number;
        hidden_domain_score: number;
        image_domain_score: number;
        dominant_evidence_domain?: 'direct' | 'hidden' | 'image' | null;
        evidence_domain_gap: number;
        hybrid_domain_count: number;
        is_hybrid_listing: boolean;
        ambiguous_domains: Array<'direct' | 'hidden' | 'image'>;
        is_ambiguous_hybrid: boolean;
        has_visual_only_image_clue: boolean;
        hidden_signal_count: number;
        hidden_comment_count: number;
        hidden_text_count: number;
        secret_fragment_count: number;
        best_secret_fragment_source?: string | null;
        best_secret_fragment_confidence: number;
    };
}

export type ResolutionWorkflowKind =
    | 'general'
    | 'secret_code'
    | 'formula'
    | 'checker'
    | 'hidden_content'
    | 'image_puzzle'
    | 'coord_transform';

export interface ResolutionWorkflowCandidate {
    kind: ResolutionWorkflowKind;
    confidence: number;
    score: number;
    reason: string;
    supporting_labels: string[];
    forced?: boolean;
}

export interface ResolutionPlanStep {
    id: string;
    title: string;
    status: 'planned' | 'completed' | 'blocked' | 'skipped';
    automated: boolean;
    tool?: string;
    detail?: string;
}

export interface GeographicPlausibilityReference {
    type: string;
    label: string;
    distance_km: number;
}

export interface GeographicPlausibilityAssessment {
    status: 'very_plausible' | 'plausible' | 'uncertain' | 'unlikely' | 'unknown';
    score: number;
    summary: string;
    reasons: string[];
    reference_count: number;
    published_distance_km?: number | null;
    original_distance_km?: number | null;
    nearest_waypoint_distance_km?: number | null;
    nearest_reference?: GeographicPlausibilityReference | null;
    reference_distances?: GeographicPlausibilityReference[];
}

export interface ResolutionDirectPluginCandidate {
    plugin_name: string;
    confidence: number;
    reason: string;
    source_kind?: string | null;
    source_text?: string | null;
    should_run_directly?: boolean;
    plugin_inputs?: Record<string, any> | null;
    axes?: string[];
    position_count?: number;
    fallback_plugin_list?: string[];
}

export interface ResolutionDirectPluginResult {
    plugin_name: string;
    status?: string;
    summary?: string;
    results_count: number;
    top_results: PluginResultItem[];
    coordinates?: Record<string, any> | null;
    geographic_plausibility?: GeographicPlausibilityAssessment | null;
}

export interface ResolutionSecretExecution {
    selected_fragment?: ListingSecretFragment | null;
    direct_plugin_candidate?: ResolutionDirectPluginCandidate | null;
    direct_plugin_result?: ResolutionDirectPluginResult | null;
    recommendation?: MetasolverRecommendationResponse | null;
    metasolver_result?: {
        status?: string;
        summary?: string;
        results_count: number;
        top_results: PluginResultItem[];
        coordinates?: Record<string, any> | null;
        geographic_plausibility?: GeographicPlausibilityAssessment | null;
        failed_plugins?: Array<Record<string, any>>;
    } | null;
}

export interface ResolutionFormulaExecution {
    formula_count: number;
    formulas: Array<Record<string, any>>;
    variables: string[];
    questions: Record<string, string>;
    found_question_count: number;
    answer_search?: {
        answers: Record<string, {
            question: string;
            best_answer?: string;
            results?: Array<Record<string, any>>;
            suggested_values?: Array<Record<string, any>>;
            recommended_value_type?: string;
        }>;
        found_count: number;
        missing: string[];
        search_context?: string;
    } | null;
    calculated_coordinates?: {
        [key: string]: any;
        geographic_plausibility?: GeographicPlausibilityAssessment | null;
    } | null;
}

export interface ResolutionCheckerExecution {
    checker_name?: string;
    checker_url?: string;
    provider?: string;
    interactive?: boolean;
    candidate?: string;
    wp?: string;
    status?: string;
    message?: string;
    result?: Record<string, any> | null;
}

export interface ResolutionHiddenContentItem {
    source: string;
    reason: string;
    text: string;
}

export interface ResolutionHiddenContentExecution {
    inspected?: boolean;
    hidden_signals: string[];
    comments: string[];
    hidden_texts: string[];
    items: ResolutionHiddenContentItem[];
    candidate_secret_fragments: ListingSecretFragment[];
    selected_fragment?: ListingSecretFragment | null;
    recommendation?: MetasolverRecommendationResponse | null;
    summary?: string;
}

export interface ResolutionImagePuzzleItem {
    source: string;
    reason: string;
    text: string;
    image_url?: string | null;
    confidence?: number | null;
}

export interface ResolutionImagePuzzleExecution {
    inspected?: boolean;
    image_count: number;
    image_urls: string[];
    items: ResolutionImagePuzzleItem[];
    candidate_secret_fragments: ListingSecretFragment[];
    selected_fragment?: ListingSecretFragment | null;
    recommendation?: MetasolverRecommendationResponse | null;
    plugin_summaries: string[];
    vision_ocr_images_analyzed?: number;
    vision_ocr_budget_cost?: number;
    coordinates_candidate?: Record<string, any> | string | null;
    geographic_plausibility?: GeographicPlausibilityAssessment | null;
    summary?: string;
}

export interface ResolutionWorkflowBudget {
    max_automated_steps: number;
    max_metasolver_runs: number;
    max_search_questions: number;
    max_checker_runs: number;
    max_coordinate_calculations: number;
    max_vision_ocr_runs: number;
    stop_on_checker_success: boolean;
}

export interface ResolutionWorkflowUsage {
    automated_steps: number;
    metasolver_runs: number;
    search_questions: number;
    checker_runs: number;
    coordinate_calculations: number;
    vision_ocr_runs: number;
}

export interface ResolutionWorkflowControl {
    status: 'ready' | 'awaiting_input' | 'budget_exhausted' | 'stopped' | 'completed';
    budget: ResolutionWorkflowBudget;
    usage: ResolutionWorkflowUsage;
    remaining: ResolutionWorkflowUsage;
    stop_reasons: string[];
    can_run_next_step: boolean;
    requires_user_input: boolean;
    final_confidence: number;
    summary: string;
}

export interface ResolutionWorkflowRequest extends ListingClassificationRequest {
    preferred_workflow?: ResolutionWorkflowKind;
    auto_execute?: boolean;
    metasolver_preset?: string;
    metasolver_mode?: 'decode' | 'detect';
    max_plugins?: number;
    workflow_control?: Partial<ResolutionWorkflowControl> | null;
}

export interface ResolutionWorkflowResponse {
    source: 'direct_input' | 'geocache';
    geocache?: {
        id: number;
        gc_code: string;
        name?: string;
    } | null;
    title?: string | null;
    workflow: ResolutionWorkflowCandidate;
    workflow_candidates: ResolutionWorkflowCandidate[];
    classification: ListingClassificationResponse;
    plan: ResolutionPlanStep[];
    execution: {
        secret_code?: ResolutionSecretExecution | null;
        formula?: ResolutionFormulaExecution | null;
        hidden_content?: ResolutionHiddenContentExecution | null;
        image_puzzle?: ResolutionImagePuzzleExecution | null;
        checker?: ResolutionCheckerExecution | null;
    };
    control: ResolutionWorkflowControl;
    next_actions: string[];
    explanation: string[];
}

export interface ResolutionWorkflowStepRunRequest extends ResolutionWorkflowRequest {
    target_step_id?: string;
    formula_index?: number;
    formula_values?: Record<string, number>;
    formula_answers?: Record<string, string>;
    formula_value_types?: Record<string, string>;
    search_context?: string;
    max_search_results?: number;
    checker_candidate?: string;
    checker_url?: string;
    checker_name?: string;
    checker_id?: number;
    wp?: string;
    checker_auto_login?: boolean;
    checker_login_timeout_sec?: number;
    checker_timeout_sec?: number;
}

export interface ResolutionWorkflowStepRunResponse {
    status: 'success' | 'blocked' | 'error';
    executed_step?: string | null;
    message: string;
    step?: ResolutionPlanStep | null;
    result?: Record<string, any> | null;
    workflow_resolution: ResolutionWorkflowResponse;
}

/**
 * Résultat de l'exécution d'un plugin.
 */
export interface PluginResult {
    /** Statut de l'exécution */
    status: 'ok' | 'error' | 'partial';
    
    /** Message d'erreur (si status = error) */
    error?: string;
    
    /** Résumé du résultat */
    summary?: string;
    
    /** Résultats de l'exécution */
    results?: PluginResultItem[];
    
    /** Sortie texte principale (compatibilité) */
    text_output?: string;
    
    /** Coordonnées principales (compatibilité) */
    coordinates?: {
        latitude: number;
        longitude: number;
    };
    
    /** Temps d'exécution en ms (compatibilité) */
    execution_time_ms?: number;
    
    /** Informations sur le plugin exécuté */
    plugin_info?: {
        /** Nom du plugin */
        name: string;
        
        /** Version du plugin */
        version: string;
        
        /** Temps d'exécution en ms */
        execution_time_ms?: number;
        
        /** Autres métadonnées */
        [key: string]: any;
    };
    
    /** Métadonnées de l'exécution */
    metadata?: {
        /** Temps d'exécution en ms */
        execution_time_ms?: number;
        
        /** Plugin utilisé */
        plugin_name?: string;
        
        /** Version du plugin */
        plugin_version?: string;
        
        /** Autres métadonnées */
        [key: string]: any;
    };
}

/**
 * Un résultat individuel d'un plugin.
 */
export interface PluginResultItem {
    /** Texte résultat */
    text_output?: string;
    
    /** Coordonnées résultats */
    coordinates?: {
        latitude: number | string;
        longitude: number | string;
        formatted?: string;
    };
    
    /** Score de confiance (0-1) */
    confidence?: number;
    
    /** Méthode utilisée */
    method?: string;
    
    /** Métadonnées additionnelles */
    [key: string]: any;
}

/**
 * Entrées à fournir lors de l'exécution d'un plugin.
 */
export interface PluginInputs {
    [key: string]: any;
}

/**
 * Statut des plugins (retourné par /api/plugins/status).
 */
export interface PluginsStatus {
    /** Nombre total de plugins */
    total: number;
    
    /** Nombre de plugins chargés */
    loaded: number;
    
    /** Nombre de plugins activés */
    enabled: number;
    
    /** Statut détaillé de chaque plugin */
    plugins: Record<string, {
        enabled: boolean;
        loaded: boolean;
        error?: string;
    }>;
}

/**
 * Le symbole utilisé pour injecter le service des plugins.
 */
export const PluginsService = Symbol('PluginsService');

/**
 * Interface du service de gestion des plugins.
 */
export interface PluginsService {
    /**
     * Récupère la liste des plugins.
     */
    listPlugins(filters?: PluginFilters): Promise<Plugin[]>;
    
    /**
     * Récupère les détails d'un plugin.
     */
    getPlugin(name: string): Promise<PluginDetails>;
    
    /**
     * Exécute un plugin de manière synchrone.
     */
    executePlugin(name: string, inputs: PluginInputs, signal?: AbortSignal): Promise<PluginResult>;
    
    /**
     * Récupère le statut de tous les plugins.
     */
    getPluginsStatus(): Promise<PluginsStatus>;
    
    /**
     * Demande au backend de redécouvrir les plugins.
     */
    discoverPlugins(): Promise<void>;
    
    /**
     * Recharge un plugin spécifique.
     */
    reloadPlugin(name: string): Promise<void>;

    /**
     * Retourne la liste des plugins éligibles au metasolver pour un preset donné.
     */
    getMetasolverEligiblePlugins(preset?: string): Promise<MetasolverEligiblePluginsResponse>;

    /**
     * Recommande une sous-liste de plugins metasolver en fonction de la signature d'un texte.
     */
    recommendMetasolverPlugins(request: MetasolverRecommendationRequest): Promise<MetasolverRecommendationResponse>;

    /**
     * Classe un listing de geocache en plusieurs familles d'enigmes.
     */
    classifyListing(request: ListingClassificationRequest): Promise<ListingClassificationResponse>;

    /**
     * Orchestre l'analyse initiale d'un listing et choisit le workflow principal.
     */
    resolveWorkflow(request: ResolutionWorkflowRequest): Promise<ResolutionWorkflowResponse>;
    runWorkflowStep(request: ResolutionWorkflowStepRunRequest): Promise<ResolutionWorkflowStepRunResponse>;
    
    /**
     * Détecte les coordonnées GPS dans un texte.
     */
    detectCoordinates(text: string, options?: {
        includeNumericOnly?: boolean;
        includeWritten?: boolean;
        writtenLanguages?: string[];
        writtenMaxCandidates?: number;
        writtenIncludeDeconcat?: boolean;
        originCoords?: { ddm_lat: string; ddm_lon: string };
    }): Promise<{
        exist: boolean;
        ddm_lat?: string;
        ddm_lon?: string;
        ddm?: string;
        decimal_latitude?: number;
        decimal_longitude?: number;
        written?: any;
    }>;
}
