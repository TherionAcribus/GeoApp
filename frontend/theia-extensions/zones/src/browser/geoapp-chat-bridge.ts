import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core/lib/common/message-service';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { LanguageModelRegistry } from '@theia/ai-core';
import { DEFAULT_CHAT_AGENT_PREF } from '@theia/ai-chat/lib/common/ai-chat-preferences';
import { ChatAgent, ChatAgentLocation, ChatAgentService, ChatService, ChatSession, isSessionDeletedEvent } from '@theia/ai-chat';
import { ImageContextVariable } from '@theia/ai-chat/lib/common/image-context-variable';
import { AIVariableResolutionRequest } from '@theia/ai-core';
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
    imageUrls?: string[];
    focus?: boolean;
    workflowKind?: GeoAppChatWorkflowKind | string;
    preferredProfile?: GeoAppChatWorkflowProfile | string;
    resumeState?: Record<string, unknown>;
    sessionKind?: 'auto' | 'libre';
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
    sessionKind?: 'auto' | 'libre';
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
            const imageVariables = await this.fetchImagesAsVariables(detail.imageUrls || []);

            const existingSession = this.findExistingSession(detail, baseSessionTitle);
            if (existingSession) {
                const pinnedAgent = await this.resolveDefaultChatAgent(detail);
                existingSession.pinnedAgent = pinnedAgent;
                existingSession.title = this.buildDisplaySessionTitle(baseSessionTitle, pinnedAgent);
                this.setSessionMetadata(existingSession, detail, baseSessionTitle, pinnedAgent);
                this.sanitizeSessionSettings(existingSession);
                this.chatService.setActiveSession(existingSession.id, { focus: detail.focus !== false });
                if (prompt) {
                    await this.chatService.sendRequest(existingSession.id, {
                        text: prompt,
                        ...(imageVariables.length > 0 ? { variables: imageVariables } : {}),
                    });
                }
                return;
            }

            const pinnedAgent = await this.resolveDefaultChatAgent(detail);
            const session = this.chatService.createSession(ChatAgentLocation.Panel, { focus: detail.focus !== false }, pinnedAgent);
            session.title = this.buildDisplaySessionTitle(baseSessionTitle, pinnedAgent);
            this.setSessionMetadata(session, detail, baseSessionTitle, pinnedAgent);
            this.sanitizeSessionSettings(session);

            if (prompt) {
                await this.chatService.sendRequest(session.id, {
                    text: prompt,
                    ...(imageVariables.length > 0 ? { variables: imageVariables } : {}),
                });
            }
        } catch (error) {
            console.error('[GeoAppChatBridge] Failed to open GeoApp chat', error);
            this.messages.error('Impossible d\'ouvrir le chat GeoApp.');
        }
    };

    protected findExistingSession(detail: GeoAppOpenChatRequestDetail, sessionTitle: string): ChatSession | undefined {
        return this.chatService.getSessions().find(session => {
            const metadata = this.sessionMetadata.get(session.id);
            if (detail.sessionKind && metadata?.sessionKind !== detail.sessionKind) {
                return false;
            }
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
            sessionKind: detail.sessionKind,
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

    protected async fetchImagesAsVariables(imageUrls: string[]): Promise<AIVariableResolutionRequest[]> {
        const variables: AIVariableResolutionRequest[] = [];
        for (const url of imageUrls.slice(0, 5)) {
            try {
                const response = await fetch(url);
                if (!response.ok) { continue; }
                const blob = await response.blob();
                const dataUrl = await this.readBlobAsDataUrl(blob);
                const base64data = dataUrl.substring(dataUrl.indexOf(',') + 1);
                const mimeType = blob.type || 'image/jpeg';
                const name = url.split('/').pop()?.split('?')[0] || 'image';
                variables.push(ImageContextVariable.createRequest({ data: base64data, mimeType, name }));
            } catch {
                // CORS or network error — skip silently
            }
        }
        return variables;
    }

    protected readBlobAsDataUrl(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => {
                const result = (e.target as FileReader | null)?.result;
                if (typeof result === 'string') { resolve(result); }
                else { reject(new Error('Failed to read blob as data URL')); }
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
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
