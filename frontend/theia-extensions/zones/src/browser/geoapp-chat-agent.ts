import { inject, injectable } from '@theia/core/shared/inversify';
import { nls } from '@theia/core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { Agent, AgentService, ToolInvocationRegistry, ToolRequest, LanguageModelRequirement } from '@theia/ai-core';
import { AbstractStreamParsingChatAgent } from '@theia/ai-chat/lib/common/chat-agents';
import { MutableChatRequestModel } from '@theia/ai-chat/lib/common/chat-model';
import {
    GeoAppChatAgentId,
    GeoAppChatLocalAgentId,
    GeoAppChatFastAgentId,
    GeoAppChatStrongAgentId,
    GeoAppChatWebAgentId,
} from './geoapp-chat-shared';

export {
    GeoAppChatAgentId,
    GeoAppChatLocalAgentId,
    GeoAppChatFastAgentId,
    GeoAppChatStrongAgentId,
    GeoAppChatWebAgentId,
    GEOAPP_CHAT_DEFAULT_PROFILE_PREF,
    GEOAPP_CHAT_SECRET_CODE_PROFILE_PREF,
    GEOAPP_CHAT_FORMULA_PROFILE_PREF,
    GEOAPP_CHAT_CHECKER_PROFILE_PREF,
    GEOAPP_CHAT_HIDDEN_CONTENT_PROFILE_PREF,
    GEOAPP_CHAT_IMAGE_PUZZLE_PROFILE_PREF,
    GeoAppChatProfile,
    GeoAppChatWorkflowProfile,
    GeoAppChatWorkflowKind,
    GeoAppChatAgentIdsByProfile,
} from './geoapp-chat-shared';

export const GeoAppChatLanguageModelRequirements: LanguageModelRequirement[] = [{
    purpose: 'chat',
    identifier: 'default/universal',
}];

function buildChatAgentConfiguration(options: { id: string; name: string; description: string; tags: string[] }): Agent {
    return {
        id: options.id,
        name: options.name,
        description: options.description,
        languageModelRequirements: GeoAppChatLanguageModelRequirements,
        prompts: [],
        variables: [],
        agentSpecificVariables: [],
        functions: [],
        tags: options.tags,
    };
}

const geoAppChatAgentConfigurations: Agent[] = [
    buildChatAgentConfiguration({
        id: GeoAppChatAgentId,
        name: 'GeoApp',
        description: 'Agent GeoApp principal pour la resolution de geocaches avec acces permanent aux tools GeoApp.',
        tags: ['GeoApp', 'Chat', 'Geocaching', 'Default'],
    }),
    buildChatAgentConfiguration({
        id: GeoAppChatLocalAgentId,
        name: 'GeoApp Chat (Local)',
        description: 'Agent GeoApp pour un modele local ou economique. Adapte aux essais rapides et peu couteux.',
        tags: ['GeoApp', 'Chat', 'Geocaching', 'Local'],
    }),
    buildChatAgentConfiguration({
        id: GeoAppChatFastAgentId,
        name: 'GeoApp Chat (Fast)',
        description: 'Agent GeoApp pour des interactions rapides avec un petit modele cloud ou hybride.',
        tags: ['GeoApp', 'Chat', 'Geocaching', 'Fast'],
    }),
    buildChatAgentConfiguration({
        id: GeoAppChatStrongAgentId,
        name: 'GeoApp Chat (Strong)',
        description: 'Agent GeoApp pour une meilleure qualite de raisonnement sans dependre d acces Web.',
        tags: ['GeoApp', 'Chat', 'Geocaching', 'Strong'],
    }),
    buildChatAgentConfiguration({
        id: GeoAppChatWebAgentId,
        name: 'GeoApp Chat (Web)',
        description: 'Agent GeoApp pour les cas complexes pouvant necessiter un modele plus puissant ou connecte.',
        tags: ['GeoApp', 'Chat', 'Geocaching', 'Web'],
    }),
];

@injectable()
abstract class BaseGeoAppChatAgent extends AbstractStreamParsingChatAgent {

    readonly abstract id: string;
    readonly abstract name: string;

    languageModelRequirements: LanguageModelRequirement[] = GeoAppChatLanguageModelRequirements;

    protected defaultLanguageModelPurpose: string = 'chat';

    @inject(ToolInvocationRegistry)
    protected readonly toolRegistry!: ToolInvocationRegistry;

    override async invoke(request: MutableChatRequestModel): Promise<void> {
        this.additionalToolRequests = this.getGeoAppTools();
        return super.invoke(request);
    }

    protected getGeoAppTools(): ToolRequest[] {
        const ids = [
            'geoapp.checkers.run',
            'geoapp.checkers.session.ensure',
            'geoapp.checkers.session.login',
            'geoapp.checkers.session.reset',
            'geoapp.plugins.workflow.resolve',
            'geoapp.plugins.workflow.run-step',
            'geoapp.plugins.listing.classify',
            'geoapp.plugins.metasolver.recommend',
            'plugin.metasolver',
            'formula-solver.detect-formula',
            'formula-solver.find-questions',
            'formula-solver.search-answer',
            'formula-solver.calculate-value',
            'formula-solver.calculate-coordinates',
        ];

        const tools: ToolRequest[] = [];
        for (const id of ids) {
            const tool = this.toolRegistry.getFunction(id);
            if (tool) {
                tools.push(tool);
            }
        }
        return tools;
    }
}

@injectable()
export class GeoAppChatAgent extends BaseGeoAppChatAgent {

    id: string = GeoAppChatAgentId;
    name: string = GeoAppChatAgentId;

    override description = nls.localize(
        'geoapp/ai/chat/geoapp/description',
        'Agent GeoApp pour la resolution de geocaches avec acces permanent aux tools GeoApp (checkers, etc.).'
    );
}

@injectable()
export class GeoAppChatLocalAgent extends BaseGeoAppChatAgent {

    id: string = GeoAppChatLocalAgentId;
    name: string = 'GeoApp Chat (Local)';

    override description = 'Agent GeoApp pour un profil local ou economique.';
}

@injectable()
export class GeoAppChatFastAgent extends BaseGeoAppChatAgent {

    id: string = GeoAppChatFastAgentId;
    name: string = 'GeoApp Chat (Fast)';

    override description = 'Agent GeoApp pour des reponses rapides et peu couteuses.';
}

@injectable()
export class GeoAppChatStrongAgent extends BaseGeoAppChatAgent {

    id: string = GeoAppChatStrongAgentId;
    name: string = 'GeoApp Chat (Strong)';

    override description = 'Agent GeoApp pour une meilleure qualite de raisonnement.';
}

@injectable()
export class GeoAppChatWebAgent extends BaseGeoAppChatAgent {

    id: string = GeoAppChatWebAgentId;
    name: string = 'GeoApp Chat (Web)';

    override description = 'Agent GeoApp pour les cas complexes avec un modele potentiellement connecte.';
}

@injectable()
export class GeoAppChatAgentContribution implements FrontendApplicationContribution {

    @inject(AgentService)
    protected readonly agentService!: AgentService;

    async onStart(): Promise<void> {
        for (const agent of geoAppChatAgentConfigurations) {
            try {
                this.agentService.unregisterAgent(agent.id);
            } catch {
                // ignore
            }

            this.agentService.registerAgent(agent);
        }
    }
}
