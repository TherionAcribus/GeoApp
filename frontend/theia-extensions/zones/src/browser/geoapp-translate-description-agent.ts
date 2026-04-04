import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { Agent, AgentService, LanguageModelRequirement } from '@theia/ai-core';

export const GeoAppTranslateDescriptionAgentId = 'geoapp-translate-description';

const languageModelRequirements: LanguageModelRequirement[] = [
    {
        purpose: 'chat',
        identifier: 'default/universal',
    },
];

const geoAppTranslateDescriptionAgent: Agent = {
    id: GeoAppTranslateDescriptionAgentId,
    name: 'GeoApp Traduction',
    description: 'Agent interne utilisé par GeoApp pour traduire des descriptions de géocaches en français en conservant le HTML.',
    languageModelRequirements,
    prompts: [],
    variables: [],
    agentSpecificVariables: [],
    functions: [],
    tags: ['GeoApp', 'Translation'],
};

@injectable()
export class GeoAppTranslateDescriptionAgentContribution implements FrontendApplicationContribution {

    @inject(AgentService)
    protected readonly agentService!: AgentService;

    async onStart(): Promise<void> {
        try {
            this.agentService.unregisterAgent(GeoAppTranslateDescriptionAgentId);
        } catch {
        }

        this.agentService.registerAgent(geoAppTranslateDescriptionAgent);
    }
}
