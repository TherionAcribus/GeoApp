import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import {
    AgentService,
    AIVariableContext,
    LanguageModelRequirement,
} from '@theia/ai-core';
import {
    AbstractStreamParsingChatAgent,
    ChatSessionContext,
    SystemMessageDescription,
} from '@theia/ai-chat/lib/common/chat-agents';
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
import { EarthCoachResultTools } from './earthcoach-result-tools';

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

    @inject(EarthCoachResultTools)
    protected readonly resultTools!: EarthCoachResultTools;

    // Les tools sont pousses dans additionalToolRequests: Theia les garantit a
    // chaque requete et les enveloppe via ChatToolRequestService, ce qui donne
    // a leurs handlers le contexte chat (session + annulation). L'injection
    // dans sendLlmRequest contournait ce contexte.
    @postConstruct()
    override init(): void {
        super.init();
        this.additionalToolRequests.push(
            ...this.referenceTools.buildAllTools(),
            ...this.noteTools.buildAllTools(),
            ...this.loggingTaskTools.buildAllTools(),
            ...this.geoCalculatorTools.buildAllTools(),
            ...this.geologyTools.buildAllTools(),
            ...this.elevationTools.buildAllTools(),
            ...this.modeTools.buildAllTools(),
            ...this.resultTools.buildAllTools()
        );
    }

    protected override async getSystemMessageDescription(context: AIVariableContext): Promise<SystemMessageDescription | undefined> {
        return {
            text: buildEarthCoachSystemPrompt(
                this.readMode(context),
                this.readVerbosity(context),
                this.readResponseLanguage(context)
            ),
        };
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

    /** Langue de reponse choisie dans le dossier terrain, propagee via les settings de session. */
    protected readResponseLanguage(context: AIVariableContext): string {
        const request = ChatSessionContext.is(context) ? context.request : undefined;
        const commonSettings = request?.session?.settings?.commonSettings as { geoapp?: { earthcoachResponseLanguage?: unknown } } | undefined;
        const value = commonSettings?.geoapp?.earthcoachResponseLanguage;
        return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : 'fr';
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
