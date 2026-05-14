import { inject, injectable } from '@theia/core/shared/inversify';
import { nls } from '@theia/core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import {
    Agent,
    AgentService,
    AIVariableContext,
    LanguageModel,
    LanguageModelMessage,
    LanguageModelRequirement,
    LanguageModelResponse,
    ToolRequest
} from '@theia/ai-core';
import { AbstractStreamParsingChatAgent, ChatSessionContext, SystemMessageDescription } from '@theia/ai-chat/lib/common/chat-agents';
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
    GeoAppChatBehaviorProfile,
    GeoAppChatWorkflowBehaviorProfile,
    GeoAppChatSessionKind,
    GeoAppChatSkillPack,
    GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_SECRET_CODE_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_FORMULA_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_CHECKER_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_HIDDEN_CONTENT_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_IMAGE_PUZZLE_PROFILE_PREF,
    GEOAPP_CHAT_PROMPT_PACK_PREF,
    GEOAPP_CHAT_TOOL_POLICY_OVERRIDES_PREF,
    GEOAPP_CHAT_SKILL_PACK_PREF,
    GEOAPP_CHAT_SKILL_POLICY_OVERRIDES_PREF,
    GeoAppChatAgentIdsByProfile,
} from './geoapp-chat-shared';
import {
    GEOAPP_CHAT_SYSTEM_PROMPT_ID,
    GeoAppChatPromptVariantByPack,
    GeoAppChatSystemPromptVariants,
} from './geoapp-chat-system-prompts';
import { GeoAppChatPolicyService } from './geoapp-chat-policy-service';

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
        prompts: [GeoAppChatSystemPromptVariants],
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

    protected override systemPromptId = GEOAPP_CHAT_SYSTEM_PROMPT_ID;

    @inject(GeoAppChatPolicyService)
    protected readonly chatPolicyService!: GeoAppChatPolicyService;

    /**
     * Theia's chat confirmation layer matches streamed tool calls by ToolRequest.id,
     * while OpenAI-compatible models stream the public function name. GeoApp keeps
     * stable registry ids such as "geoapp.plugins.workflow.resolve", so normalize
     * the request only for this chat turn to keep the UI/tool-call handshake intact.
     */
    protected override async sendLlmRequest(
        request: MutableChatRequestModel,
        messages: LanguageModelMessage[],
        toolRequests: ToolRequest[],
        languageModel: LanguageModel,
        promptVariantId?: string,
        isPromptVariantCustomized?: boolean
    ): Promise<LanguageModelResponse> {
        const policy = this.chatPolicyService.resolvePolicy(request);
        const nonManagedToolRequests = this.chatPolicyService.filterNonManagedToolRequests(toolRequests);
        const geoAppToolRequests = this.chatPolicyService.getManagedToolRequests(policy);

        return super.sendLlmRequest(
            request,
            messages,
            [...nonManagedToolRequests, ...geoAppToolRequests],
            languageModel,
            promptVariantId,
            isPromptVariantCustomized
        );
    }

    protected override async getSystemMessageDescription(context: AIVariableContext): Promise<SystemMessageDescription | undefined> {
        const request = ChatSessionContext.is(context) ? context.request : undefined;
        const policy = this.chatPolicyService.resolvePolicy(request as MutableChatRequestModel | undefined);
        const promptVariantId = GeoAppChatPromptVariantByPack[policy.promptPack] || GeoAppChatPromptVariantByPack.guided;
        const resolvedPrompt = await this.promptService.getResolvedPromptFragment(promptVariantId, undefined, context);
        if (!resolvedPrompt) {
            return super.getSystemMessageDescription(context);
        }

        const variantInfo = this.promptService.getPromptVariantInfo(GEOAPP_CHAT_SYSTEM_PROMPT_ID, promptVariantId);
        return {
            text: [
                resolvedPrompt.text,
                '',
                this.chatPolicyService.describePolicyForPrompt(policy)
            ].join('\n'),
            functionDescriptions: resolvedPrompt.functionDescriptions,
            promptVariantId: variantInfo?.variantId || promptVariantId,
            isPromptVariantCustomized: variantInfo?.isCustomized ?? false,
        };
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
