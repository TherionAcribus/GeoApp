/**
 * Agent IA dédié à l'analyse des logs de géocache pour extraire des informations utiles.
 * Cet agent analyse les logs des utilisateurs et les hints pour identifier des indices,
 * des avertissements, ou des informations pertinentes pour le géocacheur.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { Agent, AgentService, LanguageModelRequirement } from '@theia/ai-core';

export const GeoAppLogsAnalyzerAgentId = 'geoapp-logs-analyzer';

const languageModelRequirements: LanguageModelRequirement[] = [
    {
        purpose: 'chat',
        identifier: 'default/universal',
    },
];

const geoAppLogsAnalyzerAgent: Agent = {
    id: GeoAppLogsAnalyzerAgentId,
    name: 'GeoApp Analyse de Logs',
    description: 'Agent interne utilisé par GeoApp pour analyser les logs de géocache et extraire des informations utiles pour le géocacheur (indices, avertissements, conseils).',
    languageModelRequirements,
    prompts: [],
    variables: [],
    agentSpecificVariables: [],
    functions: [],
    tags: ['GeoApp', 'Logs', 'Analysis'],
};

@injectable()
export class GeoAppLogsAnalyzerAgentContribution implements FrontendApplicationContribution {

    @inject(AgentService)
    protected readonly agentService!: AgentService;

    async onStart(): Promise<void> {
        try {
            this.agentService.unregisterAgent(GeoAppLogsAnalyzerAgentId);
        } catch {
            // ignore
        }

        this.agentService.registerAgent(geoAppLogsAnalyzerAgent);
    }
}
