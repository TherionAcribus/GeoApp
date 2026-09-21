/**
 * Agent IA dédié à la traduction de logs de géocache.
 * Distinct de `geoapp-translate-description` : traduire un log court en Markdown est une tâche
 * bien plus légère que traduire un listing HTML, et mérite de pouvoir recevoir son propre modèle.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { Agent, AgentService, LanguageModelRequirement } from '@theia/ai-core';

export const GeoAppLogTranslatorAgentId = 'geoapp-log-translator';

const languageModelRequirements: LanguageModelRequirement[] = [
    {
        purpose: 'chat',
        identifier: 'default/universal',
    },
];

const geoAppLogTranslatorAgent: Agent = {
    id: GeoAppLogTranslatorAgentId,
    name: 'GeoApp Traduction de Logs',
    description: 'Agent interne utilisé par GeoApp pour traduire le texte d\'un log de géocache dans une autre langue, en conservant le Markdown et les @patterns.',
    languageModelRequirements,
    prompts: [],
    variables: [],
    agentSpecificVariables: [],
    functions: [],
    tags: ['GeoApp', 'Logs', 'Translation'],
};

@injectable()
export class GeoAppLogTranslatorAgentContribution implements FrontendApplicationContribution {

    @inject(AgentService)
    protected readonly agentService!: AgentService;

    async onStart(): Promise<void> {
        try {
            this.agentService.unregisterAgent(GeoAppLogTranslatorAgentId);
        } catch {
            // ignore
        }

        this.agentService.registerAgent(geoAppLogTranslatorAgent);
    }
}
