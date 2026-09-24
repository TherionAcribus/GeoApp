import { injectable, inject } from '@theia/core/shared/inversify';
import { ToolInvocationRegistry, ToolRequest } from '@theia/ai-core';

import { GeoAppChatWorkflowKind } from './geoapp-chat-shared';

export type GeoAppAiToolCategory =
    'workflow'
    | 'metasolver'
    | 'formula'
    | 'coordinates'
    | 'checkers'
    | 'image'
    | 'web'
    | 'plugins'
    | 'navigation'
    | 'app'
    | 'utility'
    | 'debug';

export type GeoAppAiToolRisk = 'read_only' | 'local_write' | 'network' | 'auth' | 'high';

/**
 * Agent auquel un tool est expose quand la policy l'active :
 * - 'chat'   : agents de resolution GeoApp (fiche geocache, sessions workflow) ;
 * - 'aide'   : @Aide, pilotage applicatif (zones, preferences, navigation) ;
 * - 'outing' : agent d'analyse de sortie.
 * Absent = expose a tous les agents qui appliquent la policy.
 */
export type GeoAppChatToolScope = 'chat' | 'aide' | 'outing';

export interface GeoAppAiToolMetadata {
    registryId: string;
    publicName: string;
    category: GeoAppAiToolCategory;
    risk: GeoAppAiToolRisk;
    provider?: string;
    workflowKinds?: GeoAppChatWorkflowKind[];
    scopes?: GeoAppChatToolScope[];
    network?: boolean;
    writesLocal?: boolean;
    requiresAuth?: boolean;
    defaultEnabled: boolean;
    description?: string;
    dynamic?: boolean;
}

export interface GeoAppAiToolCatalogEntry extends GeoAppAiToolMetadata {
    tool: ToolRequest;
}

const STATIC_TOOL_METADATA: Record<string, Omit<GeoAppAiToolMetadata, 'publicName' | 'provider' | 'description'>> = {
    'geoapp.checkers.run': {
        registryId: 'geoapp.checkers.run',
        category: 'checkers',
        risk: 'network',
        workflowKinds: ['checker', 'formula', 'secret_code'],
        network: true,
        defaultEnabled: true,
    },
    'geoapp.checkers.session.ensure': {
        registryId: 'geoapp.checkers.session.ensure',
        category: 'checkers',
        risk: 'auth',
        workflowKinds: ['checker'],
        network: true,
        requiresAuth: true,
        defaultEnabled: true,
    },
    'geoapp.checkers.session.login': {
        registryId: 'geoapp.checkers.session.login',
        category: 'checkers',
        risk: 'auth',
        workflowKinds: ['checker'],
        network: true,
        requiresAuth: true,
        defaultEnabled: true,
    },
    'geoapp.checkers.session.reset': {
        registryId: 'geoapp.checkers.session.reset',
        category: 'checkers',
        risk: 'auth',
        workflowKinds: ['checker'],
        network: true,
        requiresAuth: true,
        defaultEnabled: true,
    },
    'geoapp.geocache.get-listing': {
        registryId: 'geoapp.geocache.get-listing',
        category: 'workflow',
        risk: 'read_only',
        workflowKinds: ['general', 'secret_code', 'formula', 'checker', 'hidden_content', 'image_puzzle'],
        defaultEnabled: true,
    },
    // Ecrit en base : c'est le seul tool GeoApp qui range durablement une sortie du
    // modele. Declare comme tel, il passe par une confirmation sous le profil guided.
    'geoapp.outing.save-plan': {
        registryId: 'geoapp.outing.save-plan',
        category: 'utility',
        risk: 'local_write',
        workflowKinds: ['general'],
        scopes: ['outing'],
        writesLocal: true,
        defaultEnabled: true,
    },
    'geoapp.plugins.workflow.resolve': {
        registryId: 'geoapp.plugins.workflow.resolve',
        category: 'workflow',
        risk: 'read_only',
        workflowKinds: ['general', 'secret_code', 'formula', 'checker', 'hidden_content', 'image_puzzle'],
        defaultEnabled: true,
    },
    'geoapp.plugins.workflow.run-step': {
        registryId: 'geoapp.plugins.workflow.run-step',
        category: 'workflow',
        risk: 'high',
        workflowKinds: ['general', 'secret_code', 'formula', 'checker', 'hidden_content', 'image_puzzle'],
        network: true,
        writesLocal: true,
        defaultEnabled: true,
    },
    'geoapp.plugins.listing.classify': {
        registryId: 'geoapp.plugins.listing.classify',
        category: 'workflow',
        risk: 'read_only',
        workflowKinds: ['general', 'secret_code', 'formula', 'checker', 'hidden_content', 'image_puzzle'],
        defaultEnabled: true,
    },
    'geoapp.plugins.metasolver.recommend': {
        registryId: 'geoapp.plugins.metasolver.recommend',
        category: 'metasolver',
        risk: 'read_only',
        workflowKinds: ['secret_code', 'hidden_content', 'image_puzzle'],
        defaultEnabled: true,
    },
    'plugin.metasolver': {
        registryId: 'plugin.metasolver',
        category: 'metasolver',
        risk: 'read_only',
        workflowKinds: ['secret_code', 'hidden_content', 'image_puzzle'],
        defaultEnabled: true,
    },
    'plugin.coordinate_projection': {
        registryId: 'plugin.coordinate_projection',
        category: 'coordinates',
        risk: 'read_only',
        workflowKinds: ['formula', 'general'],
        defaultEnabled: true,
    },
    'plugin.coordinate_intersection': {
        registryId: 'plugin.coordinate_intersection',
        category: 'coordinates',
        risk: 'read_only',
        workflowKinds: ['formula', 'general'],
        defaultEnabled: true,
    },
    'geoapp.coordinates.save-found': {
        registryId: 'geoapp.coordinates.save-found',
        category: 'coordinates',
        risk: 'local_write',
        workflowKinds: ['formula', 'general', 'checker'],
        writesLocal: true,
        defaultEnabled: true,
    },
    'geoapp.coordinates.highlight-found': {
        registryId: 'geoapp.coordinates.highlight-found',
        category: 'coordinates',
        risk: 'local_write',
        workflowKinds: ['formula', 'general', 'checker'],
        writesLocal: true,
        defaultEnabled: true,
    },
    'formula-solver.detect-formula': {
        registryId: 'formula-solver.detect-formula',
        category: 'formula',
        risk: 'read_only',
        workflowKinds: ['formula'],
        defaultEnabled: true,
    },
    'formula-solver.find-questions': {
        registryId: 'formula-solver.find-questions',
        category: 'formula',
        risk: 'read_only',
        workflowKinds: ['formula'],
        defaultEnabled: true,
    },
    'formula-solver.search-answer': {
        registryId: 'formula-solver.search-answer',
        category: 'web',
        risk: 'read_only',
        workflowKinds: ['general', 'secret_code', 'formula', 'checker', 'hidden_content', 'image_puzzle'],
        network: true,
        defaultEnabled: true,
    },
    'formula-solver.fetch-url': {
        registryId: 'formula-solver.fetch-url',
        category: 'web',
        risk: 'read_only',
        workflowKinds: ['general', 'secret_code', 'formula', 'checker', 'hidden_content', 'image_puzzle'],
        network: true,
        defaultEnabled: true,
    },
    'formula-solver.calculate-value': {
        registryId: 'formula-solver.calculate-value',
        category: 'formula',
        risk: 'read_only',
        workflowKinds: ['formula'],
        defaultEnabled: true,
    },
    'formula-solver.calculate-coordinates': {
        registryId: 'formula-solver.calculate-coordinates',
        category: 'formula',
        risk: 'read_only',
        workflowKinds: ['formula'],
        defaultEnabled: true,
    },
    'aide_calculate': {
        registryId: 'aide_calculate',
        category: 'utility',
        risk: 'read_only',
        workflowKinds: ['general', 'secret_code', 'formula', 'checker', 'hidden_content', 'image_puzzle'],
        defaultEnabled: true,
    },
    'aide_calculate_batch': {
        registryId: 'aide_calculate_batch',
        category: 'utility',
        risk: 'read_only',
        workflowKinds: ['general', 'secret_code', 'formula', 'checker', 'hidden_content', 'image_puzzle'],
        defaultEnabled: true,
    },
    // Enregistre par l'extension calculatrice (pas par DocActionToolsManager).
    'aide_open_calculator': {
        registryId: 'aide_open_calculator',
        category: 'navigation',
        risk: 'read_only',
        workflowKinds: ['general', 'secret_code', 'formula', 'checker', 'hidden_content', 'image_puzzle'],
        defaultEnabled: true,
    },
    'geoapp.plugins.ai.score': {
        registryId: 'geoapp.plugins.ai.score',
        category: 'plugins',
        risk: 'network',
        workflowKinds: ['general', 'secret_code', 'formula', 'hidden_content'],
        network: true,
        defaultEnabled: false,
    },

    /* --- Pilotage applicatif (@Aide, extension documentation) --- */
    /* scopes : 'aide' seul pour l'administration (zones, preferences) ; 'aide'+'chat'
     * pour ce qui sert aussi la resolution (lecture de fiche, waypoints, notes).
     * 'outing' n'y figure jamais : l'analyse de sortie n'a pas a piloter l'app. */

    // Navigation — ouvertures de vues, lecture seule
    'aide_open_documentation': { registryId: 'aide_open_documentation', category: 'navigation', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_open_zones_list': { registryId: 'aide_open_zones_list', category: 'navigation', risk: 'read_only', scopes: ['aide'], defaultEnabled: true },
    'aide_open_zone_tab': { registryId: 'aide_open_zone_tab', category: 'navigation', risk: 'read_only', scopes: ['aide'], defaultEnabled: true },
    'aide_set_table_filter': { registryId: 'aide_set_table_filter', category: 'navigation', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_open_preferences': { registryId: 'aide_open_preferences', category: 'navigation', risk: 'read_only', scopes: ['aide'], defaultEnabled: true },
    'aide_open_global_search': { registryId: 'aide_open_global_search', category: 'navigation', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_open_geocache': { registryId: 'aide_open_geocache', category: 'navigation', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_open_map': { registryId: 'aide_open_map', category: 'navigation', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_open_archive_manager': { registryId: 'aide_open_archive_manager', category: 'navigation', risk: 'read_only', scopes: ['aide'], defaultEnabled: true },
    'aide_open_plugins_panel': { registryId: 'aide_open_plugins_panel', category: 'navigation', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_open_alphabet_tab': { registryId: 'aide_open_alphabet_tab', category: 'navigation', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_open_alphabets_panel': { registryId: 'aide_open_alphabets_panel', category: 'navigation', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_open_plugin_tab': { registryId: 'aide_open_plugin_tab', category: 'navigation', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },

    // Lecture applicative
    'aide_find_geocache': { registryId: 'aide_find_geocache', category: 'app', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_list_zones': { registryId: 'aide_list_zones', category: 'app', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_list_geocaches_in_zone': { registryId: 'aide_list_geocaches_in_zone', category: 'app', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_get_geocache_details': { registryId: 'aide_get_geocache_details', category: 'app', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_get_nearby_geocaches': { registryId: 'aide_get_nearby_geocaches', category: 'app', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_list_notes': { registryId: 'aide_list_notes', category: 'app', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_list_plugins': { registryId: 'aide_list_plugins', category: 'app', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_get_plugin_info': { registryId: 'aide_get_plugin_info', category: 'app', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_run_plugin': { registryId: 'aide_run_plugin', category: 'app', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_list_alphabets': { registryId: 'aide_list_alphabets', category: 'app', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_get_alphabet_info': { registryId: 'aide_get_alphabet_info', category: 'app', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_search_docs': { registryId: 'aide_search_docs', category: 'app', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_search': { registryId: 'aide_search', category: 'app', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_list_preferences': { registryId: 'aide_list_preferences', category: 'app', risk: 'read_only', scopes: ['aide'], defaultEnabled: true },
    'aide_get_preference': { registryId: 'aide_get_preference', category: 'app', risk: 'read_only', scopes: ['aide'], defaultEnabled: true },
    'aide_list_preference_categories': { registryId: 'aide_list_preference_categories', category: 'app', risk: 'read_only', scopes: ['aide'], defaultEnabled: true },
    'aide_list_preference_guides': { registryId: 'aide_list_preference_guides', category: 'app', risk: 'read_only', scopes: ['aide'], defaultEnabled: true },
    'aide_search_preferences': { registryId: 'aide_search_preferences', category: 'app', risk: 'read_only', scopes: ['aide'], defaultEnabled: true },

    // Ecritures applicatives
    'aide_create_zone': { registryId: 'aide_create_zone', category: 'app', risk: 'local_write', writesLocal: true, scopes: ['aide'], defaultEnabled: true },
    'aide_rename_zone': { registryId: 'aide_rename_zone', category: 'app', risk: 'local_write', writesLocal: true, scopes: ['aide'], defaultEnabled: true },
    'aide_duplicate_zone': { registryId: 'aide_duplicate_zone', category: 'app', risk: 'local_write', writesLocal: true, scopes: ['aide'], defaultEnabled: true },
    'aide_merge_zone': { registryId: 'aide_merge_zone', category: 'app', risk: 'high', writesLocal: true, scopes: ['aide'], defaultEnabled: true },
    'aide_delete_zone': { registryId: 'aide_delete_zone', category: 'app', risk: 'high', writesLocal: true, scopes: ['aide'], defaultEnabled: true },
    'aide_set_active_zone': { registryId: 'aide_set_active_zone', category: 'app', risk: 'local_write', writesLocal: true, scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_set_preference': { registryId: 'aide_set_preference', category: 'app', risk: 'local_write', writesLocal: true, scopes: ['aide'], defaultEnabled: true },
    'aide_reset_preference': { registryId: 'aide_reset_preference', category: 'app', risk: 'local_write', writesLocal: true, scopes: ['aide'], defaultEnabled: true },
    'aide_create_note': { registryId: 'aide_create_note', category: 'app', risk: 'local_write', writesLocal: true, scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_update_note': { registryId: 'aide_update_note', category: 'app', risk: 'local_write', writesLocal: true, scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_delete_note': { registryId: 'aide_delete_note', category: 'app', risk: 'high', writesLocal: true, scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_copy_geocache_to_zone': { registryId: 'aide_copy_geocache_to_zone', category: 'app', risk: 'local_write', writesLocal: true, scopes: ['aide'], defaultEnabled: true },
    'aide_move_geocache': { registryId: 'aide_move_geocache', category: 'app', risk: 'local_write', writesLocal: true, scopes: ['aide'], defaultEnabled: true },
    'aide_delete_geocache': { registryId: 'aide_delete_geocache', category: 'app', risk: 'high', writesLocal: true, scopes: ['aide'], defaultEnabled: true },
    'aide_export_gpx': { registryId: 'aide_export_gpx', category: 'app', risk: 'local_write', writesLocal: true, scopes: ['aide'], defaultEnabled: true },

    // Ecritures coordonnees / waypoints (utiles aussi en resolution)
    'aide_update_coordinates': { registryId: 'aide_update_coordinates', category: 'coordinates', risk: 'local_write', writesLocal: true, scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_create_waypoint': { registryId: 'aide_create_waypoint', category: 'coordinates', risk: 'local_write', writesLocal: true, scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_set_waypoint_as_corrected': { registryId: 'aide_set_waypoint_as_corrected', category: 'coordinates', risk: 'local_write', writesLocal: true, scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_delete_waypoint': { registryId: 'aide_delete_waypoint', category: 'coordinates', risk: 'high', writesLocal: true, scopes: ['aide', 'chat'], defaultEnabled: true },

    // Reseau / compte Geocaching.com
    'aide_add_geocache_by_code': { registryId: 'aide_add_geocache_by_code', category: 'app', risk: 'network', network: true, requiresAuth: true, scopes: ['aide'], defaultEnabled: true },
    'aide_refresh_geocache': { registryId: 'aide_refresh_geocache', category: 'app', risk: 'network', network: true, requiresAuth: true, scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_sync_notes_from_geocaching': { registryId: 'aide_sync_notes_from_geocaching', category: 'app', risk: 'network', network: true, requiresAuth: true, scopes: ['aide'], defaultEnabled: true },
    'aide_push_corrected_coordinates': { registryId: 'aide_push_corrected_coordinates', category: 'coordinates', risk: 'network', network: true, requiresAuth: true, scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_push_waypoint_coordinates': { registryId: 'aide_push_waypoint_coordinates', category: 'coordinates', risk: 'network', network: true, requiresAuth: true, scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_refresh_logs': { registryId: 'aide_refresh_logs', category: 'app', risk: 'network', network: true, requiresAuth: true, scopes: ['aide', 'chat'], defaultEnabled: true },

    // Statut / coordonnees / lots
    'aide_set_solved_status': { registryId: 'aide_set_solved_status', category: 'app', risk: 'local_write', writesLocal: true, scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_reset_coordinates': { registryId: 'aide_reset_coordinates', category: 'coordinates', risk: 'high', writesLocal: true, scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_update_waypoint': { registryId: 'aide_update_waypoint', category: 'coordinates', risk: 'local_write', writesLocal: true, scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_move_geocaches': { registryId: 'aide_move_geocaches', category: 'app', risk: 'high', writesLocal: true, scopes: ['aide'], defaultEnabled: true },
    'aide_copy_geocaches': { registryId: 'aide_copy_geocaches', category: 'app', risk: 'high', writesLocal: true, scopes: ['aide'], defaultEnabled: true },
    'aide_delete_geocaches': { registryId: 'aide_delete_geocaches', category: 'app', risk: 'high', writesLocal: true, scopes: ['aide'], defaultEnabled: true },

    // Logs / amis / archive (lectures)
    'aide_get_geocache_logs': { registryId: 'aide_get_geocache_logs', category: 'app', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_get_logs_summary': { registryId: 'aide_get_logs_summary', category: 'app', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_list_friend_events': { registryId: 'aide_list_friend_events', category: 'app', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_get_friend_stats': { registryId: 'aide_get_friend_stats', category: 'app', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_get_friend_finds_for_zone': { registryId: 'aide_get_friend_finds_for_zone', category: 'app', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_get_friend_finds_for_geocache': { registryId: 'aide_get_friend_finds_for_geocache', category: 'app', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_list_archive': { registryId: 'aide_list_archive', category: 'app', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_archive_status': { registryId: 'aide_archive_status', category: 'app', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_open_friends': { registryId: 'aide_open_friends', category: 'navigation', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_open_friend_activity': { registryId: 'aide_open_friend_activity', category: 'navigation', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },

    // Carte / sortie / systeme
    'aide_map_show_geocache': { registryId: 'aide_map_show_geocache', category: 'navigation', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_map_center': { registryId: 'aide_map_center', category: 'navigation', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_map_show_zone': { registryId: 'aide_map_show_zone', category: 'navigation', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_list_outing_plans': { registryId: 'aide_list_outing_plans', category: 'app', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_get_outing_plan': { registryId: 'aide_get_outing_plan', category: 'app', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_set_outing_plan_checked': { registryId: 'aide_set_outing_plan_checked', category: 'app', risk: 'local_write', writesLocal: true, scopes: ['aide'], defaultEnabled: true },
    'aide_delete_outing_plan': { registryId: 'aide_delete_outing_plan', category: 'app', risk: 'high', writesLocal: true, scopes: ['aide'], defaultEnabled: true },
    'aide_open_outing_plan': { registryId: 'aide_open_outing_plan', category: 'navigation', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_get_auth_status': { registryId: 'aide_get_auth_status', category: 'app', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_open_auth': { registryId: 'aide_open_auth', category: 'navigation', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_open_server_logs': { registryId: 'aide_open_server_logs', category: 'navigation', risk: 'read_only', scopes: ['aide'], defaultEnabled: true },
    'aide_open_chat_policy': { registryId: 'aide_open_chat_policy', category: 'navigation', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_list_geocache_images': { registryId: 'aide_list_geocache_images', category: 'app', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_import_around': { registryId: 'aide_import_around', category: 'app', risk: 'network', network: true, requiresAuth: true, scopes: ['aide'], defaultEnabled: true },
    'aide_list_chat_presets': { registryId: 'aide_list_chat_presets', category: 'app', risk: 'read_only', scopes: ['aide', 'chat'], defaultEnabled: true },
    'aide_apply_chat_preset': { registryId: 'aide_apply_chat_preset', category: 'app', risk: 'local_write', writesLocal: true, scopes: ['aide'], defaultEnabled: true },
};

@injectable()
export class GeoAppAiToolCatalog {

    @inject(ToolInvocationRegistry)
    protected readonly toolRegistry!: ToolInvocationRegistry;

    getEntries(): GeoAppAiToolCatalogEntry[] {
        return this.getAllToolRequests()
            .map(tool => this.toCatalogEntry(tool))
            .filter((entry): entry is GeoAppAiToolCatalogEntry => entry !== undefined)
            .sort((a, b) => a.category.localeCompare(b.category) || a.publicName.localeCompare(b.publicName));
    }

    getAllToolRequests(): ToolRequest[] {
        return this.toolRegistry.getAllFunctions();
    }

    hasRegisteredTool(idOrName: string): boolean {
        return this.getAllToolRequests().some(tool => tool.id === idOrName || tool.name === idOrName);
    }

    getEntry(registryIdOrPublicName: string): GeoAppAiToolCatalogEntry | undefined {
        return this.getEntries().find(entry =>
            entry.registryId === registryIdOrPublicName || entry.publicName === registryIdOrPublicName
        );
    }

    isGeoAppManagedTool(tool: ToolRequest): boolean {
        return this.toCatalogEntry(tool) !== undefined;
    }

    protected toCatalogEntry(tool: ToolRequest): GeoAppAiToolCatalogEntry | undefined {
        const staticMetadata = STATIC_TOOL_METADATA[tool.id];
        if (staticMetadata) {
            return {
                ...staticMetadata,
                publicName: tool.name,
                provider: tool.providerName,
                description: tool.description,
                tool,
            };
        }

        if (tool.id.startsWith('plugin.')) {
            const description = (tool.description || '').toLowerCase();
            const hasNetworkSignal = description.includes('reseau') || description.includes('réseau') || description.includes('network');
            return {
                registryId: tool.id,
                publicName: tool.name,
                category: this.inferPluginCategory(tool),
                risk: hasNetworkSignal ? 'network' : 'read_only',
                provider: tool.providerName,
                network: hasNetworkSignal,
                defaultEnabled: false,
                description: tool.description,
                dynamic: true,
                tool,
            };
        }

        return undefined;
    }

    protected inferPluginCategory(tool: ToolRequest): GeoAppAiToolCategory {
        const id = tool.id.toLowerCase();
        const name = tool.name.toLowerCase();
        if (id.includes('ocr') || name.includes('ocr') || id.includes('qr') || name.includes('qr')) {
            return 'image';
        }
        if (id.includes('coord') || name.includes('coord')) {
            return 'coordinates';
        }
        if (id.includes('metasolver') || name.includes('metasolver')) {
            return 'metasolver';
        }
        return 'plugins';
    }
}

export function getStaticGeoAppToolMetadata(): GeoAppAiToolMetadata[] {
    return Object.values(STATIC_TOOL_METADATA).map(metadata => ({
        ...metadata,
        publicName: metadata.registryId,
    }));
}
