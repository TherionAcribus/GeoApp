/**
 * Table des préférences GeoApp exposées à @Aide via `aide_list_app_preferences`
 * et `aide_set_app_preferences`.
 *
 * Fichier volontairement pur (aucun import) : chargé par `doc-action-tools`
 * et par les tests ts-node.
 *
 * - `sensitive` : jamais écrivable par l'agent, valeur masquée à la lecture.
 * - `managed_by` : clé pilotée par un tool dédié ou par l'UI ; la lecture reste
 *   autorisée mais l'écriture est refusée avec un pointeur.
 * - `null` passé à `aide_set_app_preferences` réinitialise la clé à son défaut.
 */

export interface AppPreferenceSpec {
    type: 'boolean' | 'number' | 'string' | 'enum' | 'string[]' | 'object';
    description: string;
    enum?: string[];
    min?: number;
    max?: number;
    /** Sous-propriétés validées pour type 'object'. */
    props?: Record<string, { enum: string[] }>;
    sensitive?: boolean;
    managed_by?: string;
}

export const APP_PREFERENCE_SPECS: Record<string, AppPreferenceSpec> = {
    // --- Fiche géocache / affichage ---
    'geoApp.geocache.hints.displayDecoded': {
        type: 'boolean',
        description: 'Afficher les indices (hints) décodés en clair sur la fiche géocache.',
    },
    'geoApp.geocache.description.defaultVariant': {
        type: 'enum',
        enum: ['auto', 'original', 'modified'],
        description: 'Variante de description affichée par défaut (auto = modifiée si présente).',
    },
    'geoApp.geocache.externalLinks.openMode': {
        type: 'enum',
        enum: ['same-group', 'new-group', 'external-window'],
        description: 'Ouverture des liens externes de la fiche : onglet dans le groupe courant, nouveau groupe, fenêtre externe.',
    },
    'geoApp.geocache.details.collapsedSections': {
        type: 'string[]',
        description: 'Sections repliées de la fiche détail (details, description, hints, images, waypoints, checkers).',
    },
    'geoApp.checkers.enabled': {
        type: 'boolean',
        description: 'Afficher les liens checkers (Certitude, etc.) sur la fiche géocache.',
    },
    'geoApp.checkers.linkOpenMode': {
        type: 'enum',
        enum: ['same-group', 'new-group', 'external-window'],
        description: 'Ouverture des liens checkers.',
    },
    'geoApp.friends.zone.visible': {
        type: 'boolean',
        description: 'Afficher les données amis (trouvailles) dans la table de zone.',
    },
    'geoApp.zones.sort': {
        type: 'object',
        props: {
            key: { enum: ['name', 'created_at', 'geocaches_count', 'latest_geocache_created_at', 'latest_resolution_updated_at'] },
            direction: { enum: ['asc', 'desc'] },
        },
        description: 'Tri de la liste des zones : {key, direction}.',
    },

    // --- Éditeur de logs ---
    'geoApp.logs.autoFetchTrigger': {
        type: 'enum',
        enum: ['logs-panel', 'geocache-open', 'off'],
        description: 'Chargement automatique des logs : à l\'ouverture du panneau, à l\'ouverture de la cache, jamais.',
    },
    'geoApp.logs.closeEditorAfterSubmit': {
        type: 'boolean',
        description: 'Fermer l\'onglet éditeur après un envoi réussi.',
    },
    'geoApp.logs.downloadImages': {
        type: 'boolean',
        description: 'Télécharger les images des logs lors du chargement.',
    },
    'geoApp.logs.initialFetchCount': {
        type: 'number',
        min: 10,
        max: 500,
        description: 'Nombre de logs chargés initialement dans le panneau.',
    },
    'geoApp.logs.panelSyncMode': {
        type: 'enum',
        enum: ['on-demand', 'follow-active'],
        description: 'Le panneau de logs suit la géocache active ou reste à la demande.',
    },
    'geoApp.logs.trackableAutoVisit': {
        type: 'boolean',
        description: 'Marquer automatiquement « visit » les trackables de l\'inventaire à l\'envoi d\'un log.',
    },
    'geoApp.logs.translation.mode': {
        type: 'enum',
        enum: ['replace', 'bilingual'],
        description: 'Traduction des logs : remplacer le texte ou bilingue original+traduction.',
    },
    'geoApp.logs.translation.addNotice': {
        type: 'boolean',
        description: 'Ajouter une mention « traduit automatiquement » aux logs traduits.',
    },
    'geoApp.logs.translation.bilingualSeparator': {
        type: 'string',
        description: 'Séparateur entre texte traduit et original en mode bilingue.',
    },
    'geoApp.logs.translation.noticeText': {
        type: 'string',
        description: 'Texte de la mention de traduction automatique.',
    },
    'geoApp.logs.translation.defaultLanguage': {
        type: 'string',
        description: 'Langue cible par défaut des traductions de logs (code BCP-47, ex : en, de, nl).',
    },
    'geoApp.logs.translation.languages': {
        type: 'string[]',
        description: 'Langues proposées dans le sélecteur de traduction.',
    },
    'geoApp.translation.targetLanguage': {
        type: 'string',
        description: 'Langue cible globale des traductions IA (fiches, descriptions).',
    },

    // --- IA / fournisseurs de modèles (hors secrets) ---
    'geoApp.ai.enabled': {
        type: 'boolean',
        description: 'Activer les fonctionnalités IA de l\'application.',
    },
    'geoApp.ai.codex.enabled': {
        type: 'boolean',
        description: 'Activer le fournisseur Codex/OpenAI.',
    },
    'geoApp.ai.codex.model': {
        type: 'string',
        description: 'Modèle Codex/OpenAI utilisé.',
    },
    'geoApp.ai.codex.enableStreaming': {
        type: 'boolean',
        description: 'Streaming des réponses Codex.',
    },
    'geoApp.ai.codex.useResponseApi': {
        type: 'boolean',
        description: 'Utiliser l\'API Responses (plutôt que Chat Completions) pour Codex.',
    },
    'geoApp.ai.openRouter.enabled': {
        type: 'boolean',
        description: 'Activer le fournisseur OpenRouter.',
    },
    'geoApp.ai.openRouter.baseUrl': {
        type: 'string',
        description: 'URL de base de l\'API OpenRouter.',
    },
    'geoApp.ai.openRouter.model.fast': {
        type: 'string',
        description: 'Modèle OpenRouter profil « fast ».',
    },
    'geoApp.ai.openRouter.model.strong': {
        type: 'string',
        description: 'Modèle OpenRouter profil « strong ».',
    },
    'geoApp.ai.openRouter.model.web': {
        type: 'string',
        description: 'Modèle OpenRouter profil « web ».',
    },
    'geoApp.ai.openRouter.enableStreaming': {
        type: 'boolean',
        description: 'Streaming des réponses OpenRouter.',
    },
    'geoApp.ai.localModelIds': {
        type: 'string[]',
        description: 'IDs de modèles locaux (LM Studio) disponibles.',
    },
    'geoApp.ai.executionHistory.enabled': {
        type: 'boolean',
        description: 'Conserver l\'historique des exécutions IA.',
    },
    'geoApp.ai.executionHistory.maxEntries': {
        type: 'number',
        min: 10,
        max: 2000,
        description: 'Nombre maximal d\'entrées d\'historique des exécutions IA.',
    },
    'geoApp.ai.lexicon.enabled': {
        type: 'boolean',
        description: 'Appliquer le lexique personnel dans les améliorations/traductions IA.',
    },
    'geoApp.aiScorer.provider': {
        type: 'enum',
        enum: ['lmstudio', 'openrouter'],
        description: 'Fournisseur du modèle de scoring IA.',
    },
    'geoApp.aiScorer.lmstudio.model': {
        type: 'string',
        description: 'Modèle LM Studio utilisé pour le scoring.',
    },
    'geoApp.aiScorer.openRouter.model': {
        type: 'string',
        description: 'Modèle OpenRouter utilisé pour le scoring.',
    },
    'geoApp.chat.images.recommendedLimit': {
        type: 'number',
        min: 1,
        max: 50,
        description: 'Nombre d\'images recommandé maximum envoyé au chat IA.',
    },
    'geoApp.chat.foundCoordinates.autoSave': {
        type: 'boolean',
        description: 'Enregistrer automatiquement les coordonnées trouvées par le chat IA.',
    },
    'geoApp.chat.foundCoordinates.confidenceThreshold': {
        type: 'number',
        min: 0,
        max: 1,
        description: 'Seuil de confiance pour enregistrer une coordonnée trouvée (0-1).',
    },
    'geoApp.chat.foundCoordinates.defaultTarget': {
        type: 'enum',
        enum: ['default', 'corrected_coordinates', 'waypoint', 'note'],
        description: 'Cible par défaut des coordonnées trouvées (coordonnées corrigées, waypoint, note).',
    },

    // --- OCR ---
    'geoApp.ocr.defaultEngine': {
        type: 'enum',
        enum: ['easyocr', 'vision', 'theia'],
        description: 'Moteur OCR par défaut (backend easyocr, modèle vision, IA de l\'app).',
    },
    'geoApp.ocr.defaultLanguage': {
        type: 'string',
        description: 'Langue OCR par défaut (ex : fra, eng).',
    },
    'geoApp.ocr.visionProvider': {
        type: 'enum',
        enum: ['lmstudio', 'openrouter'],
        description: 'Fournisseur du modèle de vision pour l\'OCR.',
    },
    'geoApp.ocr.lmstudio.baseUrl': {
        type: 'string',
        description: 'URL de base LM Studio pour l\'OCR vision.',
    },
    'geoApp.ocr.lmstudio.model': {
        type: 'string',
        description: 'Modèle LM Studio pour l\'OCR vision.',
    },
    'geoApp.ocr.openRouter.model': {
        type: 'string',
        description: 'Modèle OpenRouter pour l\'OCR vision.',
    },

    // --- Images ---
    'geoApp.images.gallery.hiddenDomains': {
        type: 'string[]',
        description: 'Domaines masqués dans la galerie d\'images.',
    },
    'geoApp.images.gallery.thumbnailSize': {
        type: 'enum',
        enum: ['small', 'medium', 'large'],
        description: 'Taille des vignettes de la galerie d\'images.',
    },
    'geoApp.images.storage.defaultMode': {
        type: 'enum',
        enum: ['never', 'prompt', 'always'],
        description: 'Téléchargement local des images : jamais, demander, toujours.',
    },

    // --- EarthCoach ---
    'geoApp.earthCoach.analysis.maxImages': {
        type: 'number',
        min: 1,
        max: 30,
        description: 'Nombre maximal d\'images envoyées à l\'analyse EarthCoach.',
    },
    'geoApp.earthCoach.listing.language': {
        type: 'string',
        description: 'Langue d\'analyse du listing EarthCache.',
    },
    'geoApp.earthCoach.response.language': {
        type: 'string',
        description: 'Langue des réponses EarthCoach.',
    },
    'geoApp.earthCoach.response.verbosity': {
        type: 'enum',
        enum: ['compact', 'normal', 'detailed'],
        description: 'Verbosité des réponses EarthCoach.',
    },
    'geoApp.earthCoach.references.web.enabled': {
        type: 'boolean',
        description: 'Autoriser la recherche web pour les références EarthCoach.',
    },
    'geoApp.earthCoach.references.language': {
        type: 'enum',
        enum: ['fr', 'en'],
        description: 'Langue des articles de référence EarthCoach.',
    },
    'geoApp.earthCoach.references.maxArticles': {
        type: 'number',
        min: 1,
        max: 20,
        description: 'Nombre maximal d\'articles de référence chargés.',
    },
    'geoApp.earthCoach.references.maxImages': {
        type: 'number',
        min: 1,
        max: 20,
        description: 'Nombre maximal d\'images de référence chargées.',
    },
    'geoApp.earthCoach.references.allowedSources': {
        type: 'string[]',
        description: 'Sources autorisées pour les références EarthCoach.',
    },

    // --- Analyse de sortie ---
    'geoApp.outing.analysis.adaptiveBudget': {
        type: 'boolean',
        description: 'Budget de tokens adaptatif pour l\'analyse de sortie.',
    },
    'geoApp.outing.analysis.detailLevel': {
        type: 'enum',
        enum: ['light', 'standard', 'full'],
        description: 'Niveau de détail de l\'analyse IA de sortie.',
    },
    'geoApp.outing.analysis.gearLogsCount': {
        type: 'number',
        min: 1,
        max: 100,
        description: 'Logs récents inspectés pour détecter le matériel requis.',
    },
    'geoApp.outing.analysis.maxPromptTokens': {
        type: 'number',
        min: 1000,
        max: 200000,
        description: 'Budget maximal de tokens du prompt d\'analyse de sortie.',
    },
    'geoApp.outing.analysis.recentLogsCount': {
        type: 'number',
        min: 1,
        max: 100,
        description: 'Logs récents inclus dans l\'analyse de sortie.',
    },
    'geoApp.outing.analysis.refreshLogsCount': {
        type: 'number',
        min: 5,
        max: 100,
        description: 'Logs récupérés par géocache lors du rafraîchissement proposé avant analyse.',
    },
    'geoApp.outing.analysis.warnAboveCount': {
        type: 'number',
        min: 5,
        max: 500,
        description: 'Seuil d\'avertissement sur le nombre de géocaches d\'une analyse.',
    },

    // --- Plugins ---
    'geoApp.plugins.executor.allowLongRunning': {
        type: 'boolean',
        description: 'Autoriser les plugins longs (au-delà du timeout standard).',
    },
    'geoApp.plugins.executor.timeoutSec': {
        type: 'number',
        min: 5,
        max: 600,
        description: 'Timeout d\'exécution des plugins (secondes).',
    },

    // --- Géocodage carte ---
    'geoApp.map.geocoding.provider': {
        type: 'enum',
        enum: ['photon', 'geoapify'],
        description: 'Fournisseur de géocodage pour la recherche carte.',
    },
    'geoApp.map.geocoding.autoFallback': {
        type: 'boolean',
        description: 'Basculer automatiquement sur l\'autre fournisseur en cas d\'échec.',
    },

    // --- Notes GC personnelles ---
    'geoApp.notes.gcPersonalNote.autoSyncMode': {
        type: 'enum',
        enum: ['manual', 'onNotesOpen', 'onDetailsOpen'],
        description: 'Synchronisation automatique de la note personnelle GC.com.',
    },

    // --- Onglets ---
    'geoApp.ui.tabs.categories.alphabet': {
        type: 'enum',
        enum: ['smart-replace', 'always-new-tab', 'always-replace'],
        description: 'Comportement des onglets alphabets (remplacement intelligent, toujours nouvel onglet, toujours remplacer).',
    },
    'geoApp.ui.tabs.categories.geocache': {
        type: 'enum',
        enum: ['smart-replace', 'always-new-tab', 'always-replace'],
        description: 'Comportement des onglets géocache.',
    },
    'geoApp.ui.tabs.categories.plugin': {
        type: 'enum',
        enum: ['smart-replace', 'always-new-tab', 'always-replace'],
        description: 'Comportement des onglets plugins.',
    },
    'geoApp.ui.tabs.categories.zone': {
        type: 'enum',
        enum: ['smart-replace', 'always-new-tab', 'always-replace'],
        description: 'Comportement des onglets zone.',
    },
    'geoApp.ui.tabs.smartReplace.interaction.clickInContent': {
        type: 'boolean',
        description: 'Un clic dans le contenu épingle l\'onglet en mode smart-replace.',
    },
    'geoApp.ui.tabs.smartReplace.interaction.scroll': {
        type: 'boolean',
        description: 'Un défilement épingle l\'onglet en mode smart-replace.',
    },
    'geoApp.ui.tabs.smartReplace.interaction.minOpenTimeEnabled': {
        type: 'boolean',
        description: 'Une durée d\'ouverture minimale épingle l\'onglet en mode smart-replace.',
    },

    // --- Connexion ---
    'geoApp.backend.apiBaseUrl': {
        type: 'string',
        description: 'URL de base du backend GeoApp. Attention : une valeur invalide coupe l\'accès aux données.',
    },

    // --- Sensibles (lecture masquée, écriture refusée) ---
    'geoApp.api.key': {
        type: 'string',
        sensitive: true,
        description: 'Clé API du compte geocaching.com.',
    },
    'geoApp.ai.codex.apiKey': {
        type: 'string',
        sensitive: true,
        description: 'Clé API OpenAI/Codex.',
    },
    'geoApp.ai.openRouter.apiKey': {
        type: 'string',
        sensitive: true,
        description: 'Clé API OpenRouter.',
    },
    'geoApp.map.geocoding.geoapifyApiKey': {
        type: 'string',
        sensitive: true,
        description: 'Clé API Geoapify.',
    },

    // --- Gérées par des tools dédiés ---
    'geoApp.chat.promptPack': { type: 'string', managed_by: 'aide_set_chat_packs', description: 'Pack de prompts actif.' },
    'geoApp.chat.skillPack': { type: 'string', managed_by: 'aide_set_chat_packs', description: 'Pack de skills actif.' },
    'geoApp.chat.defaultProfile': { type: 'string', managed_by: 'aide_set_chat_behavior_profile', description: 'Profil comportemental par défaut.' },
    'geoApp.chat.toolPolicy.overrides': { type: 'string', managed_by: 'aide_set_chat_tool_override', description: 'Overrides de policy par tool.' },
    'geoApp.chat.skillPolicy.overrides': { type: 'string', managed_by: 'aide_set_chat_skill_override', description: 'Overrides de policy par skill.' },
    'geoApp.geocaches.table.visibleColumns': { type: 'string[]', managed_by: 'aide_table_set_columns', description: 'Colonnes visibles de la table de géocaches.' },
    'geoApp.map.defaultProvider': { type: 'string', managed_by: 'aide_map_set_tile_provider', description: 'Fond de carte par défaut.' },
    'geoApp.map.showNearbyGeocaches': { type: 'boolean', managed_by: 'aide_map_set_options', description: 'Géocaches proches sur la carte.' },
    'geoApp.map.showExclusionZones': { type: 'boolean', managed_by: 'aide_map_set_options', description: 'Zones d\'exclusion 161m.' },
    'geoApp.map.foundGeocacheDisplayMode': { type: 'string', managed_by: 'aide_map_set_options', description: 'Affichage des caches trouvées.' },
    'geoApp.map.clusteringMode': { type: 'string', managed_by: 'aide_map_set_options', description: 'Mode de clustering.' },
    'geoApp.map.geocacheIconScale': { type: 'number', managed_by: 'aide_map_set_options', description: 'Échelle des icônes.' },
    'geoApp.map.defaultZoom': { type: 'number', managed_by: 'aide_map_set_options', description: 'Zoom par défaut.' },
};

/**
 * Valide une valeur pour une spec. Retourne un message d'erreur ou undefined.
 */
export function validatePreferenceValue(key: string, value: unknown): string | undefined {
    const spec = APP_PREFERENCE_SPECS[key];
    if (!spec) {
        return `clé inconnue (utilisez aide_list_app_preferences pour la liste).`;
    }
    if (value === null) {
        return undefined; // reset to default
    }
    switch (spec.type) {
        case 'boolean':
            return typeof value === 'boolean' ? undefined : 'valeur booléenne attendue (true/false).';
        case 'number': {
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                return 'valeur numérique attendue.';
            }
            if (spec.min !== undefined && value < spec.min) {
                return `valeur minimale ${spec.min}.`;
            }
            if (spec.max !== undefined && value > spec.max) {
                return `valeur maximale ${spec.max}.`;
            }
            return undefined;
        }
        case 'string':
            return typeof value === 'string' ? undefined : 'chaîne attendue.';
        case 'enum':
            return typeof value === 'string' && spec.enum?.includes(value)
                ? undefined
                : `valeur parmi ${spec.enum?.join(' | ')}.`;
        case 'string[]':
            return Array.isArray(value) && value.every(v => typeof v === 'string')
                ? undefined
                : 'tableau de chaînes attendu.';
        case 'object': {
            if (typeof value !== 'object' || value === null || Array.isArray(value)) {
                return 'objet attendu.';
            }
            for (const [prop, propSpec] of Object.entries(spec.props ?? {})) {
                const propValue = (value as Record<string, unknown>)[prop];
                if (propValue === undefined) {
                    return `propriété "${prop}" manquante (${propSpec.enum.join(' | ')}).`;
                }
                if (typeof propValue !== 'string' || !propSpec.enum.includes(propValue)) {
                    return `propriété "${prop}" parmi ${propSpec.enum.join(' | ')}.`;
                }
            }
            return undefined;
        }
    }
}
