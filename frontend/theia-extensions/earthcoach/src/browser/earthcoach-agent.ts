import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import {
    AgentService,
    AIVariableContext,
    LanguageModel,
    LanguageModelRequirement,
    LanguageModelResponse,
    ToolRequest,
} from '@theia/ai-core';
import {
    AbstractStreamParsingChatAgent,
    ChatSessionContext,
    SystemMessageDescription,
} from '@theia/ai-chat/lib/common/chat-agents';
import { MutableChatRequestModel } from '@theia/ai-chat/lib/common/chat-model';
import { LanguageModelMessage } from '@theia/ai-core/lib/common/language-model';
import { EarthCoachAgentId, EarthCoachMode } from './earthcoach-types';
import { buildEarthCoachSystemPrompt } from './earthcoach-prompts';
import { EarthCoachNoteTools } from './earthcoach-note-tools';
import { EarthCoachReferenceTools } from './earthcoach-reference-tools';

export const EarthCoachLanguageModelRequirements: LanguageModelRequirement[] = [{
    purpose: 'chat',
    identifier: 'default/universal',
}];

@injectable()
export class EarthCoachAgent extends AbstractStreamParsingChatAgent {

    readonly id = EarthCoachAgentId;
    readonly name = '@EarthCoach';
    readonly description = 'Assistant EarthCache pour comprendre, preparer le terrain et exploiter les observations sans les inventer.';

    languageModelRequirements: LanguageModelRequirement[] = EarthCoachLanguageModelRequirements;
    readonly prompts = [];
    readonly variables = [];
    readonly agentSpecificVariables = [];
    readonly functions = [];
    readonly tags = ['GeoApp', 'EarthCache', 'Geology'];

    protected defaultLanguageModelPurpose = 'chat';

    @inject(EarthCoachReferenceTools)
    protected readonly referenceTools!: EarthCoachReferenceTools;

    @inject(EarthCoachNoteTools)
    protected readonly noteTools!: EarthCoachNoteTools;

    protected override async sendLlmRequest(
        request: MutableChatRequestModel,
        messages: LanguageModelMessage[],
        toolRequests: ToolRequest[],
        languageModel: LanguageModel,
        promptVariantId?: string,
        isPromptVariantCustomized?: boolean
    ): Promise<LanguageModelResponse> {
        const earthCoachTools = [
            ...this.referenceTools.buildAllTools(),
            ...this.noteTools.buildAllTools(),
        ];
        const earthCoachToolIds = new Set(earthCoachTools.map(tool => tool.id));
        const nonEarthCoachTools = toolRequests.filter(tool => !earthCoachToolIds.has(tool.id));
        return super.sendLlmRequest(
            request,
            messages,
            [...nonEarthCoachTools, ...earthCoachTools],
            languageModel,
            promptVariantId,
            isPromptVariantCustomized
        );
    }

    protected override async getSystemMessageDescription(context: AIVariableContext): Promise<SystemMessageDescription | undefined> {
        return { text: buildEarthCoachSystemPrompt(this.readMode(context)) };
    }

    protected readMode(context: AIVariableContext): EarthCoachMode {
        const request = ChatSessionContext.is(context) ? context.request : undefined;
        const commonSettings = request?.session?.settings?.commonSettings as { geoapp?: { earthcoachMode?: unknown } } | undefined;
        return commonSettings?.geoapp?.earthcoachMode === 'resolver' ? 'resolver' : 'coach';
    }
}

@injectable()
export class EarthCoachAgentContribution implements FrontendApplicationContribution {

    @inject(AgentService)
    protected readonly agentService!: AgentService;

    @inject(EarthCoachAgent)
    protected readonly earthCoachAgent!: EarthCoachAgent;

    async onStart(): Promise<void> {
        try {
            this.agentService.unregisterAgent(EarthCoachAgentId);
        } catch {
            // ignore
        }
        this.agentService.registerAgent(this.earthCoachAgent);
    }
}
