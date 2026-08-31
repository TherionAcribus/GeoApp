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
import { EarthCoachAgentId, EarthCoachMode, EarthCoachVerbosity } from './earthcoach-types';
import { buildEarthCoachSystemPrompt } from './earthcoach-prompts';
import { EarthCoachNoteTools } from './earthcoach-note-tools';
import { EarthCoachReferenceTools } from './earthcoach-reference-tools';
import { EarthCoachLoggingTaskTools } from './earthcoach-logging-task-tools';
import { EarthCoachGeoCalculatorTools } from './earthcoach-geo-calculator-tools';
import { EarthCoachGeologyTools } from './earthcoach-geology-tools';
import { EarthCoachElevationTools } from './earthcoach-elevation-tools';
import { EarthCoachModeTools } from './earthcoach-mode-tools';
import { readEarthCoachModeFromSettings } from './earthcoach-mode';

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

    @inject(EarthCoachLoggingTaskTools)
    protected readonly loggingTaskTools!: EarthCoachLoggingTaskTools;

    @inject(EarthCoachGeoCalculatorTools)
    protected readonly geoCalculatorTools!: EarthCoachGeoCalculatorTools;

    @inject(EarthCoachGeologyTools)
    protected readonly geologyTools!: EarthCoachGeologyTools;

    @inject(EarthCoachElevationTools)
    protected readonly elevationTools!: EarthCoachElevationTools;

    @inject(EarthCoachModeTools)
    protected readonly modeTools!: EarthCoachModeTools;

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
            ...this.loggingTaskTools.buildAllTools(),
            ...this.geoCalculatorTools.buildAllTools(),
            ...this.geologyTools.buildAllTools(),
            ...this.elevationTools.buildAllTools(),
            ...this.modeTools.buildAllTools(),
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
        return { text: buildEarthCoachSystemPrompt(this.readMode(context), this.readVerbosity(context)) };
    }

    protected readMode(context: AIVariableContext): EarthCoachMode {
        const request = ChatSessionContext.is(context) ? context.request : undefined;
        return readEarthCoachModeFromSettings(request?.session?.settings);
    }

    protected readVerbosity(context: AIVariableContext): EarthCoachVerbosity {
        const request = ChatSessionContext.is(context) ? context.request : undefined;
        const commonSettings = request?.session?.settings?.commonSettings as { geoapp?: { earthcoachVerbosity?: unknown } } | undefined;
        const value = commonSettings?.geoapp?.earthcoachVerbosity;
        return value === 'normal' || value === 'detailed' ? value : 'compact';
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
