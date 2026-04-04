import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core/lib/common/message-service';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { LanguageModelRegistry } from '@theia/ai-core';
import { DEFAULT_CHAT_AGENT_PREF } from '@theia/ai-chat/lib/common/ai-chat-preferences';
import { ChatAgent, ChatAgentLocation, ChatAgentService, ChatService, ChatSession, isSessionDeletedEvent } from '@theia/ai-chat';
import {
    GeoAppChatAgentId,
    GeoAppChatAgentIdsByProfile,
    GeoAppChatProfile,
    GeoAppChatWorkflowKind,
    GeoAppChatWorkflowProfile
} from './geoapp-chat-agent';
import {
    buildGeoAppChatDisplaySessionTitle,
    buildGeoAppChatPrompt,
    GEOAPP_OPEN_CHAT_REQUEST_EVENT,
    normalizeGeoAppChatWorkflowKind,
    resolveGeoAppChatProfileForWorkflow,
    sanitizeGeoAppSessionSettings,
} from './geoapp-chat-shared';
export { GEOAPP_OPEN_CHAT_REQUEST_EVENT } from './geoapp-chat-shared';

interface GeoAppOpenChatRequestDetail {
    geocacheId?: number;
    gcCode?: string;
    geocacheName?: string;
    sessionTitle?: string;
    prompt?: string;
    focus?: boolean;
    workflowKind?: GeoAppChatWorkflowKind | string;
    preferredProfile?: GeoAppChatWorkflowProfile | string;
    resumeState?: Record<string, unknown>;
}

interface GeoAppChatSessionMetadata {
    geocacheId?: number;
    gcCode?: string;
    geocacheName?: string;
    baseSessionTitle?: string;
    workflowKind?: GeoAppChatWorkflowKind;
    agentId?: string;
    agentName?: string;
    resumeState?: Record<string, unknown>;
}

@injectable()
export class GeoAppChatBridge implements FrontendApplicationContribution {

    protected readonly sessionMetadata = new Map<string, GeoAppChatSessionMetadata>();

    constructor(
        @inject(ChatService) protected readonly chatService: ChatService,
        @inject(ChatAgentService) protected readonly chatAgentService: ChatAgentService,
        @inject(PreferenceService) protected readonly preferenceService: PreferenceService,
        @inject(LanguageModelRegistry) protected readonly languageModelRegistry: LanguageModelRegistry,
        @inject(MessageService) protected readonly messages: MessageService,
    ) {}

    onStart(): void {
        for (const session of this.chatService.getSessions()) {
            this.sanitizeSessionSettings(session);
        }

        this.chatService.onSessionEvent(event => {
            if (isSessionDeletedEvent(event)) {
                this.sessionMetadata.delete(event.sessionId);
            }
        });

        window.addEventListener(GEOAPP_OPEN_CHAT_REQUEST_EVENT, this.handleOpenChatRequest as EventListener);
    }

    onStop(): void {
        window.removeEventListener(GEOAPP_OPEN_CHAT_REQUEST_EVENT, this.handleOpenChatRequest as EventListener);
    }

    protected readonly handleOpenChatRequest = async (rawEvent: Event): Promise<void> => {
        const event = rawEvent as CustomEvent<GeoAppOpenChatRequestDetail>;
        const detail = event.detail || {};
        const baseSessionTitle = this.buildSessionTitle(detail);
        const prompt = this.buildPrompt(detail);

        try {
            const existingSession = this.findExistingSession(detail, baseSessionTitle);
            if (existingSession) {
                const pinnedAgent = await this.resolveDefaultChatAgent(detail);
                existingSession.pinnedAgent = pinnedAgent;
                existingSession.title = this.buildDisplaySessionTitle(baseSessionTitle, pinnedAgent);
                this.setSessionMetadata(existingSession, detail, baseSessionTitle, pinnedAgent);
                this.sanitizeSessionSettings(existingSession);
                this.chatService.setActiveSession(existingSession.id, { focus: detail.focus !== false });
                if (prompt) {
                    await this.chatService.sendRequest(existingSession.id, { text: prompt });
                }
                return;
            }

            const pinnedAgent = await this.resolveDefaultChatAgent(detail);
            const session = this.chatService.createSession(ChatAgentLocation.Panel, { focus: detail.focus !== false }, pinnedAgent);
            session.title = this.buildDisplaySessionTitle(baseSessionTitle, pinnedAgent);
            this.setSessionMetadata(session, detail, baseSessionTitle, pinnedAgent);
            this.sanitizeSessionSettings(session);

            if (prompt) {
                await this.chatService.sendRequest(session.id, { text: prompt });
            }
        } catch (error) {
            console.error('[GeoAppChatBridge] Failed to open GeoApp chat', error);
            this.messages.error('Impossible d\'ouvrir le chat GeoApp.');
        }
    };

    protected findExistingSession(detail: GeoAppOpenChatRequestDetail, sessionTitle: string): ChatSession | undefined {
        return this.chatService.getSessions().find(session => {
            const metadata = this.sessionMetadata.get(session.id);
            if (typeof detail.geocacheId === 'number' && metadata?.geocacheId === detail.geocacheId) {
                return true;
            }
            if (detail.gcCode && metadata?.gcCode === detail.gcCode) {
                return true;
            }
            if (metadata?.baseSessionTitle === sessionTitle) {
                return true;
            }
            return session.title === sessionTitle;
        });
    }

    protected setSessionMetadata(
        session: ChatSession,
        detail: GeoAppOpenChatRequestDetail,
        baseSessionTitle: string,
        agent?: ChatAgent
    ): void {
        this.sessionMetadata.set(session.id, {
            geocacheId: detail.geocacheId,
            gcCode: detail.gcCode,
            geocacheName: detail.geocacheName,
            baseSessionTitle,
            workflowKind: normalizeGeoAppChatWorkflowKind(detail.workflowKind),
            agentId: agent?.id,
            agentName: agent?.name,
            resumeState: detail.resumeState,
        });
    }

    protected sanitizeSessionSettings(session: ChatSession): void {
        const modelWithSettings = session.model as typeof session.model & {
            setSettings?: (settings: { [key: string]: unknown }) => void;
        };

        if (typeof modelWithSettings.setSettings !== 'function') {
            return;
        }

        modelWithSettings.setSettings(sanitizeGeoAppSessionSettings(session.model.settings || {}));
    }

    protected buildPrompt(detail: GeoAppOpenChatRequestDetail): string {
        return buildGeoAppChatPrompt(detail.prompt, detail.resumeState);
    }

    protected buildSessionTitle(detail: GeoAppOpenChatRequestDetail): string {
        const explicitTitle = (detail.sessionTitle || '').trim();
        if (explicitTitle) {
            return explicitTitle;
        }
        return `CHAT IA - ${detail.gcCode || detail.geocacheName || 'GeoApp'}`;
    }

    protected buildDisplaySessionTitle(baseSessionTitle: string, agent?: ChatAgent): string {
        return buildGeoAppChatDisplaySessionTitle(baseSessionTitle, agent);
    }

    protected async resolveDefaultChatAgent(detail?: GeoAppOpenChatRequestDetail): Promise<ChatAgent | undefined> {
        const available = this.chatAgentService.getAgents();
        const candidates: ChatAgent[] = [];

        const preferredProfile = this.resolveRequestedProfile(detail);
        if (preferredProfile) {
            const preferredGeoAppAgent = this.chatAgentService.getAgent(GeoAppChatAgentIdsByProfile[preferredProfile]);
            if (preferredGeoAppAgent) {
                candidates.push(preferredGeoAppAgent);
            }
        }

        const configuredId = this.preferenceService.get(DEFAULT_CHAT_AGENT_PREF, undefined) as string | undefined;
        const configured = configuredId ? this.chatAgentService.getAgent(configuredId) : undefined;
        if (configured) {
            candidates.push(configured);
        }

        const geoApp = available.find(agent => (agent.id || '').toLowerCase() === GeoAppChatAgentId.toLowerCase());
        if (geoApp) {
            candidates.push(geoApp);
        }

        const universal = available.find(agent =>
            (agent.id || '').toLowerCase().includes('universal') || (agent.name || '').toLowerCase().includes('universal')
        );
        if (universal) {
            candidates.push(universal);
        }

        for (const agent of available) {
            if (!candidates.includes(agent)) {
                candidates.push(agent);
            }
        }

        for (const agent of candidates) {
            if (await this.isAgentReady(agent)) {
                return agent;
            }
        }

        return candidates[0];
    }

    protected resolveRequestedProfile(detail?: GeoAppOpenChatRequestDetail): GeoAppChatProfile | undefined {
        return resolveGeoAppChatProfileForWorkflow(detail?.workflowKind, detail?.preferredProfile, {
            'geoApp.chat.defaultProfile': this.preferenceService.get('geoApp.chat.defaultProfile', 'fast'),
            'geoApp.chat.workflowProfile.secretCode': this.preferenceService.get('geoApp.chat.workflowProfile.secretCode', 'default'),
            'geoApp.chat.workflowProfile.formula': this.preferenceService.get('geoApp.chat.workflowProfile.formula', 'default'),
            'geoApp.chat.workflowProfile.checker': this.preferenceService.get('geoApp.chat.workflowProfile.checker', 'default'),
            'geoApp.chat.workflowProfile.hiddenContent': this.preferenceService.get('geoApp.chat.workflowProfile.hiddenContent', 'default'),
            'geoApp.chat.workflowProfile.imagePuzzle': this.preferenceService.get('geoApp.chat.workflowProfile.imagePuzzle', 'default'),
        });
    }

    protected async isAgentReady(agent: ChatAgent | undefined): Promise<boolean> {
        if (!agent?.id) {
            return false;
        }
        try {
            const model = await this.languageModelRegistry.selectLanguageModel({
                agent: agent.id,
                purpose: 'chat',
                identifier: 'default/universal'
            });
            return !!model;
        } catch {
            return false;
        }
    }
}
