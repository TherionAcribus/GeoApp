/**
 * Agent IA dédié à la génération de logs de géocache.
 * Cet agent génère des logs personnalisés basés sur des mots-clés,
 * des instructions utilisateur et des exemples de style.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { Agent, AgentService, LanguageModelRequirement } from '@theia/ai-core';

export const GeoAppLogWriterAgentId = 'geoapp-log-writer';

const languageModelRequirements: LanguageModelRequirement[] = [
    {
        purpose: 'chat',
        identifier: 'default/universal',
    },
];

const geoAppLogWriterAgent: Agent = {
    id: GeoAppLogWriterAgentId,
    name: 'GeoApp Rédacteur de Logs',
    description: 'Agent interne utilisé par GeoApp pour générer des logs de géocache personnalisés à partir de mots-clés, d\'instructions et d\'exemples de style.',
    languageModelRequirements,
    prompts: [],
    variables: [],
    agentSpecificVariables: [],
    functions: [],
    tags: ['GeoApp', 'Logs', 'Writer', 'Generation'],
};

@injectable()
export class GeoAppLogWriterAgentContribution implements FrontendApplicationContribution {

    @inject(AgentService)
    protected readonly agentService!: AgentService;

    async onStart(): Promise<void> {
        try {
            this.agentService.unregisterAgent(GeoAppLogWriterAgentId);
        } catch {
            // ignore
        }

        this.agentService.registerAgent(geoAppLogWriterAgent);
    }
}
