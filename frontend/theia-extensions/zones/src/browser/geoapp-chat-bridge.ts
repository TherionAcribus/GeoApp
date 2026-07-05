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
    GeoAppChatSessionKind,
    GeoAppChatWorkflowBehaviorProfile,
    GeoAppChatProfile,
    GeoAppChatWorkflowKind,
    GeoAppChatWorkflowProfile
} from './geoapp-chat-agent';
import {
    buildGeoAppChatDisplaySessionTitle,
    buildGeoAppChatPrompt,
    GEOAPP_OPEN_CHAT_REQUEST_EVENT,
    GeoAppChatImageContext,
    normalizeGeoAppChatWorkflowBehaviorProfile,
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
    imageContexts?: GeoAppChatImageContext[];
    focus?: boolean;
    workflowKind?: GeoAppChatWorkflowKind | string;
    preferredProfile?: GeoAppChatWorkflowProfile | string;
    preferredBehaviorProfile?: GeoAppChatWorkflowBehaviorProfile | string;
    preferredAgentId?: string;
    earthcoachMode?: string;
    earthcoachVerbosity?: string;
    resumeState?: Record<string, unknown>;
    sessionKind?: GeoAppChatSessionKind;
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
    sessionKind?: GeoAppChatSessionKind;
    behaviorProfile?: GeoAppChatWorkflowBehaviorProfile;
    preferredAgentId?: string;
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
            const imageVariables = await this.fetchImagesAsVariables(this.getImageContexts(detail));

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
        const requestedSessionKind = detail.sessionKind ?? 'auto';
        return this.chatService.getSessions().find(session => {
            const metadata = this.sessionMetadata.get(session.id);
            const sessionKind = metadata?.sessionKind ?? 'auto';
            if (sessionKind !== requestedSessionKind) {
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
            sessionKind: detail.sessionKind ?? 'auto',
            behaviorProfile: normalizeGeoAppChatWorkflowBehaviorProfile(detail.preferredBehaviorProfile),
            preferredAgentId: detail.preferredAgentId,
        });
        this.setSessionCommonGeoAppSettings(session, detail);
    }

    protected setSessionCommonGeoAppSettings(session: ChatSession, detail: GeoAppOpenChatRequestDetail): void {
        const modelWithSettings = session.model as typeof session.model & {
            setSettings?: (settings: { [key: string]: unknown }) => void;
        };

        if (typeof modelWithSettings.setSettings !== 'function') {
            return;
        }

        const currentSettings = session.model.settings || {};
        const commonSettings = this.isRecord(currentSettings.commonSettings)
            ? currentSettings.commonSettings
            : {};
        const geoapp = this.isRecord(commonSettings.geoapp)
            ? commonSettings.geoapp
            : {};
        const workflowKind = normalizeGeoAppChatWorkflowKind(detail.workflowKind);
        const preferredBehaviorProfile = normalizeGeoAppChatWorkflowBehaviorProfile(detail.preferredBehaviorProfile);
        const nextGeoapp = { ...geoapp };
        this.setDefined(nextGeoapp, 'geocacheId', detail.geocacheId);
        this.setDefined(nextGeoapp, 'gcCode', detail.gcCode);
        this.setDefined(nextGeoapp, 'workflowKind', workflowKind);
        this.setDefined(nextGeoapp, 'preferredModelProfile', detail.preferredProfile);
        this.setDefined(nextGeoapp, 'preferredBehaviorProfile', preferredBehaviorProfile);
        this.setDefined(nextGeoapp, 'preferredAgentId', detail.preferredAgentId);
        this.setDefined(nextGeoapp, 'earthcoachMode', detail.earthcoachMode);
        this.setDefined(nextGeoapp, 'earthcoachVerbosity', detail.earthcoachVerbosity);
        this.setDefined(nextGeoapp, 'sessionKind', detail.sessionKind ?? 'auto');

        modelWithSettings.setSettings(sanitizeGeoAppSessionSettings({
            ...currentSettings,
            commonSettings: {
                ...commonSettings,
                geoapp: nextGeoapp,
            },
        }));
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

    protected isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    protected setDefined(record: Record<string, unknown>, key: string, value: unknown): void {
        if (value !== undefined) {
            record[key] = value;
        }
    }

    protected getImageContexts(detail: GeoAppOpenChatRequestDetail): GeoAppChatImageContext[] {
        if (detail.imageContexts?.length) {
            return detail.imageContexts;
        }
        return (detail.imageUrls || []).map(url => ({
            url,
            origin: 'cache_listing',
        }));
    }

    /** Long cote cible pour les images envoyees au modele : optimum tokens/qualite pour la vision. */
    protected static readonly MAX_IMAGE_DIMENSION = 1568;

    protected async fetchImagesAsVariables(imageContexts: GeoAppChatImageContext[]): Promise<AIVariableResolutionRequest[]> {
        // Traitement en parallele : les images sont independantes, inutile de serialiser
        // les telechargements. Promise.all preserve l'ordre d'origine.
        const variables = await Promise.all(imageContexts.map(context => this.fetchImageAsVariable(context)));
        return variables.filter((variable): variable is AIVariableResolutionRequest => variable !== undefined);
    }

    protected async fetchImageAsVariable(imageContext: GeoAppChatImageContext): Promise<AIVariableResolutionRequest | undefined> {
        let url = imageContext.url;
        try {
            let response = await this.fetchImageForChat(url);
            if (!response && imageContext.id) {
                const storedUrl = await this.storeImageForChat(imageContext.id);
                if (storedUrl) {
                    url = storedUrl;
                    response = await this.fetchImageForChat(storedUrl);
                }
            }
            if (!response) { return undefined; }
            const blob = await response.blob();
            const { data, mimeType } = await this.downscaleImage(blob, GeoAppChatBridge.MAX_IMAGE_DIMENSION);
            const fallbackName = url.split('/').pop()?.split('?')[0] || 'image';
            const name = [
                imageContext.origin,
                imageContext.label || imageContext.id || fallbackName,
            ].filter(Boolean).join(' - ');
            return ImageContextVariable.createRequest({ data, mimeType, name });
        } catch {
            // CORS or network error — skip silently
            return undefined;
        }
    }

    /**
     * Redimensionne l'image si son plus grand cote depasse maxDimension, puis renvoie
     * le base64 (sans prefixe data:). Reduit la latence d'ouverture et le cout tokens
     * vision a chaque tour. Retombe sur l'image d'origine si le canvas echoue.
     */
    protected async downscaleImage(blob: Blob, maxDimension: number): Promise<{ data: string; mimeType: string }> {
        const original = async (): Promise<{ data: string; mimeType: string }> => {
            const dataUrl = await this.readBlobAsDataUrl(blob);
            return { data: dataUrl.substring(dataUrl.indexOf(',') + 1), mimeType: blob.type || 'image/jpeg' };
        };
        try {
            const image = await this.loadImageSource(blob);
            const largestSide = Math.max(image.width, image.height);
            if (!largestSide || largestSide <= maxDimension) {
                return original();
            }
            const scale = maxDimension / largestSide;
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(image.width * scale));
            canvas.height = Math.max(1, Math.round(image.height * scale));
            const context = canvas.getContext('2d');
            if (!context) {
                return original();
            }
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
            return { data: dataUrl.substring(dataUrl.indexOf(',') + 1), mimeType: 'image/jpeg' };
        } catch {
            return original();
        }
    }

    protected async loadImageSource(blob: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
        if (typeof createImageBitmap === 'function') {
            return await createImageBitmap(blob);
        }
        const objectUrl = URL.createObjectURL(blob);
        try {
            return await new Promise<HTMLImageElement>((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve(image);
                image.onerror = () => reject(new Error('Failed to load image'));
                image.src = objectUrl;
            });
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }

    protected async fetchImageForChat(url: string): Promise<Response | undefined> {
        try {
            const response = await fetch(url, { credentials: 'include' });
            return response.ok ? response : undefined;
        } catch {
            return undefined;
        }
    }

    protected async storeImageForChat(imageId: string): Promise<string | undefined> {
        const id = Number.parseInt(imageId, 10);
        if (!Number.isFinite(id)) {
            return undefined;
        }
        try {
            const response = await fetch(`${this.getBackendBaseUrl()}/api/geocache-images/${id}/store`, {
                method: 'POST',
                credentials: 'include',
            });
            if (!response.ok) {
                return undefined;
            }
            const image = await response.json() as { url?: string };
            return image.url ? this.resolveBackendUrl(image.url) : undefined;
        } catch {
            return undefined;
        }
    }

    protected getBackendBaseUrl(): string {
        const value = String(this.preferenceService.get('geoApp.backend.apiBaseUrl', 'http://localhost:8000') || 'http://localhost:8000');
        return value.replace(/\/+$/, '');
    }

    protected resolveBackendUrl(url: string): string {
        return url.startsWith('/') ? `${this.getBackendBaseUrl()}${url}` : url;
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

        const preferredAgentId = (detail?.preferredAgentId || '').trim();
        if (preferredAgentId) {
            const preferredAgent = this.chatAgentService.getAgent(preferredAgentId);
            if (preferredAgent) {
                candidates.push(preferredAgent);
            }
        }

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
