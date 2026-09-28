import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { nls } from '@theia/core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
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
    GeoAppChatImageOrigin,
    GeoAppChatImageContext,
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
import { GeoAppChatToolScope } from './geoapp-chat-tool-catalog';
import {
    checkGeoAppLocalModel,
    GeoAppLocalModelPreferences,
    GEOAPP_LOCAL_MODEL_IDS_PREF,
    isGeoAppStrictLocalAgent,
} from './geoapp-local-model-guard';

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
        description: 'Agent GeoApp principal pour la résolution de géocaches avec accès permanent aux tools GeoApp.',
        tags: ['GeoApp', 'Chat', 'Geocaching', 'Default'],
    }),
    buildChatAgentConfiguration({
        id: GeoAppChatLocalAgentId,
        name: 'GeoApp Chat (Local)',
        description: 'Agent GeoApp réservé à un modèle vérifiable comme local. Refuse tout repli cloud quand il est demandé explicitement.',
        tags: ['GeoApp', 'Chat', 'Geocaching', 'Local'],
    }),
    buildChatAgentConfiguration({
        id: GeoAppChatFastAgentId,
        name: 'GeoApp Chat (Fast)',
        description: 'Agent GeoApp pour des interactions rapides avec un petit modèle cloud ou hybride.',
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
        description: 'Agent GeoApp pour les cas complexes pouvant nécessiter un modèle plus puissant ou connecté.',
        tags: ['GeoApp', 'Chat', 'Geocaching', 'Web'],
    }),
];

@injectable()
export abstract class BaseGeoAppChatAgent extends AbstractStreamParsingChatAgent {

    readonly abstract id: string;
    readonly abstract name: string;

    languageModelRequirements: LanguageModelRequirement[] = GeoAppChatLanguageModelRequirements;

    protected defaultLanguageModelPurpose: string = 'chat';

    protected override systemPromptId = GEOAPP_CHAT_SYSTEM_PROMPT_ID;

    @inject(GeoAppChatPolicyService)
    protected readonly chatPolicyService!: GeoAppChatPolicyService;

    /**
     * Sous-ensemble du catalogue expose a cet agent : 'chat' pour les agents de
     * resolution, 'outing' pour l'analyse de sortie, 'aide' pour @Aide.
     */
    protected readonly toolScope: GeoAppChatToolScope = 'chat';

    @inject(PreferenceService) @optional()
    protected readonly preferenceService: PreferenceService | undefined;

    /**
     * Theia 1.76 allows each session to override the agent model through
     * commonSettings.modelId. Keep validating the model resolved for the actual
     * request, not only the model assigned when the session was opened.
     */
    protected override async getLanguageModelForRequest(
        request: MutableChatRequestModel,
        languageModelPurpose: string
    ): Promise<LanguageModel> {
        if (!this.requiresLocalModel(request)) {
            return super.getLanguageModelForRequest(request, languageModelPurpose);
        }

        const overrideId = request.session.settings?.commonSettings?.modelId;
        if (overrideId) {
            const overrideModel = await this.resolveModelById(overrideId);
            this.assertLocalModel(overrideModel ?? { id: overrideId });
        }

        const languageModel = await super.getLanguageModelForRequest(request, languageModelPurpose);
        this.assertLocalModel(languageModel);
        return languageModel;
    }

    protected requiresLocalModel(request: MutableChatRequestModel): boolean {
        const commonSettings = request.session.settings?.commonSettings as Record<string, unknown> | undefined;
        const geoapp = commonSettings?.geoapp as Record<string, unknown> | undefined;
        return isGeoAppStrictLocalAgent(this.id)
            || geoapp?.preferredBehaviorProfile === 'offline'
            || geoapp?.preferredModelProfile === 'local'
            || geoapp?.preferredAgentId === GeoAppChatLocalAgentId;
    }

    protected assertLocalModel(model: LanguageModel | { id: string }): void {
        const localCheck = checkGeoAppLocalModel(model, this.getLocalModelPreferences());
        if (localCheck.status !== 'local') {
            throw new Error(`Le mode local/offline ne peut pas utiliser le modèle résolu : ${localCheck.reason}. Aucun repli cloud n'a été appliqué.`);
        }
    }

    protected getLocalModelPreferences(): GeoAppLocalModelPreferences {
        const get = <T>(key: string, fallback: T): T => this.preferenceService?.get(key, fallback) ?? fallback;
        return {
            ollamaHost: get('ai-features.ollama.ollamaHost', 'http://localhost:11434'),
            lmstudioBaseUrl: get('geoApp.ocr.lmstudio.baseUrl', 'http://localhost:1234'),
            openAiCustomModels: get('ai-features.openAiCustom.customOpenAiModels', []),
            vercelCustomModels: get('ai-features.vercelAi.customModels', []),
            localModelIds: get(GEOAPP_LOCAL_MODEL_IDS_PREF, []),
        };
    }

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
        deferredToolIds: string[] | undefined,
        languageModel: LanguageModel,
        promptVariantId?: string,
        isPromptVariantCustomized?: boolean
    ): Promise<LanguageModelResponse> {
        const policy = this.chatPolicyService.resolvePolicy(request);
        const nonManagedToolRequests = this.chatPolicyService.filterNonManagedToolRequests(toolRequests);
        const geoAppToolRequests = this.chatPolicyService.getManagedToolRequests(policy, this.toolScope);

        return super.sendLlmRequest(
            request,
            messages,
            [...nonManagedToolRequests, ...geoAppToolRequests],
            deferredToolIds,
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
                this.chatPolicyService.describePolicyForPrompt(policy, this.toolScope)
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
        'Agent GeoApp pour la résolution de géocaches avec accès permanent aux tools GeoApp (checkers, etc.).'
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

    override description = 'Agent GeoApp pour les cas complexes avec un modèle potentiellement connecté.';
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
