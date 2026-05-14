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
    | 'debug';

export type GeoAppAiToolRisk = 'read_only' | 'local_write' | 'network' | 'auth' | 'high';

export interface GeoAppAiToolMetadata {
    registryId: string;
    publicName: string;
    category: GeoAppAiToolCategory;
    risk: GeoAppAiToolRisk;
    provider?: string;
    workflowKinds?: GeoAppChatWorkflowKind[];
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
        risk: 'network',
        workflowKinds: ['formula'],
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
};

@injectable()
export class GeoAppAiToolCatalog {

    @inject(ToolInvocationRegistry)
    protected readonly toolRegistry!: ToolInvocationRegistry;

    getEntries(): GeoAppAiToolCatalogEntry[] {
        return this.toolRegistry.getAllFunctions()
            .map(tool => this.toCatalogEntry(tool))
            .filter((entry): entry is GeoAppAiToolCatalogEntry => entry !== undefined)
            .sort((a, b) => a.category.localeCompare(b.category) || a.publicName.localeCompare(b.publicName));
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
