import { injectable, inject, multiInject, optional } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core/lib/common/message-service';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { LanguageModel, LanguageModelRegistry } from '@theia/ai-core';
import { DEFAULT_CHAT_AGENT_PREF } from '@theia/ai-chat/lib/common/ai-chat-preferences';
import { ChatAgent, ChatAgentLocation, ChatAgentService, ChatRequestInvocation, ChatService, ChatSession, isSessionDeletedEvent } from '@theia/ai-chat';
import { ImageContextVariable } from '@theia/ai-chat/lib/common/image-context-variable';
import { AIVariableResolutionRequest } from '@theia/ai-core';
import {
    GeoAppChatAgentId,
    GeoAppChatLocalAgentId,
    GeoAppChatAgentIdsByProfile,
    GeoAppChatSessionKind,
    GeoAppChatWorkflowBehaviorProfile,
    GeoAppChatProfile,
    GeoAppChatWorkflowKind,
    GeoAppChatWorkflowProfile
} from './geoapp-chat-agent';
import {
    GeoAppChatResponseObserver,
    buildGeoAppChatDisplaySessionTitle,
    buildGeoAppChatPrompt,
    encodeGeoAppChatImage,
    GEOAPP_CHAT_IMAGE_MAX_DIMENSION,
    GEOAPP_CHAT_IMAGES_TRANSMITTED_EVENT,
    GEOAPP_OPEN_CHAT_REQUEST_EVENT,
    GeoAppChatImageContext,
    GeoAppChatImageQuality,
    takePreparedGeoAppChatImage,
    normalizeGeoAppChatWorkflowBehaviorProfile,
    normalizeGeoAppChatWorkflowKind,
    resolveGeoAppChatBehaviorProfileForWorkflow,
    resolveGeoAppChatProfileForWorkflow,
    sanitizeGeoAppSessionSettings,
    GEOAPP_CHAT_LOCAL_MODEL_IDS_PREF,
} from './geoapp-chat-shared';
import { checkGeoAppLocalModel, GeoAppLocalModelPreferences } from './geoapp-local-model-guard';
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
    earthcoachResponseLanguage?: string;
    earthcoachRequestId?: string;
    imageQuality?: GeoAppChatImageQuality;
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
        @multiInject(GeoAppChatResponseObserver) @optional()
        protected readonly responseObservers: GeoAppChatResponseObserver[] = [],
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
        let prompt = this.buildPrompt(detail);

        try {
            const imageContexts = this.getImageContexts(detail);
            const imagePreparation = await this.fetchImagesAsVariables(imageContexts, detail.imageQuality);
            const imageVariables = imagePreparation.variables;
            // Le dossier terrain corrige son instantane sur cette annonce: une
            // image declaree prete au moment du "envoyer" peut encore echouer
            // ici au decodage/reencodage, elle n'a alors jamais atteint le modele.
            if (imageContexts.length) {
                window.dispatchEvent(new CustomEvent(GEOAPP_CHAT_IMAGES_TRANSMITTED_EVENT, {
                    detail: {
                        requestId: detail.earthcoachRequestId,
                        transmittedIds: imagePreparation.transmitted
                            .map(context => context.id)
                            .filter((id): id is string => Boolean(id)),
                        failedIds: imagePreparation.failures
                            .map(context => context.id)
                            .filter((id): id is string => Boolean(id)),
                        failedLabels: imagePreparation.failures.map(context => context.label || context.id || context.url),
                    },
                }));
            }
            if (imagePreparation.failures.length) {
                const failedLabels = imagePreparation.failures.map(context => context.label || context.id || context.url).join(', ');
                prompt = `${prompt}\n\nIMPORTANT: ces images n ont pas pu etre transmises et ne doivent jamais etre presentees comme examinees: ${failedLabels}.`;
                this.messages.warn(`${imagePreparation.failures.length} image(s) n'ont pas pu être transmise(s) au modèle.`);
            }

            const existingSession = this.findExistingSession(detail, baseSessionTitle);
            if (existingSession) {
                const pinnedAgent = await this.resolveDefaultChatAgent(detail);
                existingSession.pinnedAgent = pinnedAgent;
                existingSession.title = this.buildDisplaySessionTitle(baseSessionTitle, pinnedAgent);
                this.setSessionMetadata(existingSession, detail, baseSessionTitle, pinnedAgent);
                this.sanitizeSessionSettings(existingSession);
                this.chatService.setActiveSession(existingSession.id, { focus: detail.focus !== false });
                if (prompt) {
                    const invocation = await this.chatService.sendRequest(existingSession.id, {
                        text: prompt,
                        ...(imageVariables.length > 0 ? { variables: imageVariables } : {}),
                    });
                    this.observeResponse(invocation, existingSession.id, baseSessionTitle, pinnedAgent?.id, detail.earthcoachRequestId);
                }
                return;
            }

            const pinnedAgent = await this.resolveDefaultChatAgent(detail);
            const session = this.chatService.createSession(ChatAgentLocation.Panel, { focus: detail.focus !== false }, pinnedAgent);
            session.title = this.buildDisplaySessionTitle(baseSessionTitle, pinnedAgent);
            this.setSessionMetadata(session, detail, baseSessionTitle, pinnedAgent);
            this.sanitizeSessionSettings(session);

            if (prompt) {
                const invocation = await this.chatService.sendRequest(session.id, {
                    text: prompt,
                    ...(imageVariables.length > 0 ? { variables: imageVariables } : {}),
                });
                this.observeResponse(invocation, session.id, baseSessionTitle, pinnedAgent?.id, detail.earthcoachRequestId);
            }
        } catch (error) {
            console.error('[GeoAppChatBridge] Failed to open GeoApp chat', error);
            const reason = error instanceof Error ? error.message : String(error);
            this.messages.error(`Impossible d'ouvrir le chat GeoApp. ${reason}`);
        }
    };

    /**
     * Prévient les observateurs quand la réponse est complète.
     *
     * Volontairement non attendu par l'appelant : l'ouverture de session ne doit pas
     * rester en suspens le temps d'une génération, qui dure des dizaines de secondes.
     * Chaque observateur est isolé — l'un qui lève ne prive pas les autres de l'événement,
     * et surtout ne fait pas remonter une erreur dans un chat qui, lui, a réussi.
     */
    protected observeResponse(
        invocation: ChatRequestInvocation | undefined,
        sessionId: string,
        sessionTitle: string,
        agentId?: string,
        requestId?: string
    ): void {
        if (!invocation || this.responseObservers.length === 0) {
            return;
        }

        invocation.responseCompleted.then(response => {
            const text = response?.response?.asDisplayString?.() ?? '';
            for (const observer of this.responseObservers) {
                try {
                    const outcome = observer.handleChatResponse({ sessionId, sessionTitle, agentId, requestId, text });
                    Promise.resolve(outcome).catch(error =>
                        console.error('[GeoAppChatBridge] Observateur de réponse en échec', error)
                    );
                } catch (error) {
                    console.error('[GeoAppChatBridge] Observateur de réponse en échec', error);
                }
            }
        }).catch(error => {
            // Réponse annulée ou en erreur : rien à observer, et le chat l'a déjà signalé.
            console.debug('[GeoAppChatBridge] Réponse non aboutie, observateurs non appelés', error);
        });
    }

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
        this.setDefined(nextGeoapp, 'earthcoachResponseLanguage', detail.earthcoachResponseLanguage);
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

    protected async fetchImagesAsVariables(
        imageContexts: GeoAppChatImageContext[],
        quality?: GeoAppChatImageQuality
    ): Promise<{
        variables: AIVariableResolutionRequest[];
        transmitted: GeoAppChatImageContext[];
        failures: GeoAppChatImageContext[];
    }> {
        // Traitement en parallele : les images sont independantes, inutile de serialiser
        // les telechargements. Promise.all preserve l'ordre d'origine.
        const prepared = await Promise.all(imageContexts.map(async context => ({
            context,
            variable: await this.fetchImageAsVariable(context, quality),
        })));
        return {
            variables: prepared.map(item => item.variable).filter((variable): variable is AIVariableResolutionRequest => variable !== undefined),
            transmitted: prepared.filter(item => item.variable !== undefined).map(item => item.context),
            failures: prepared.filter(item => item.variable === undefined).map(item => item.context),
        };
    }

    protected async fetchImageAsVariable(
        imageContext: GeoAppChatImageContext,
        quality?: GeoAppChatImageQuality
    ): Promise<AIVariableResolutionRequest | undefined> {
        let url = imageContext.url;
        try {
            // Image deja telechargee et encodee par l'appelant (dossier terrain
            // EarthCoach) : on evite un second telechargement et un second decodage.
            let encoded = takePreparedGeoAppChatImage(url, quality);
            if (!encoded) {
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
                encoded = await encodeGeoAppChatImage(blob, { maxDimension: GEOAPP_CHAT_IMAGE_MAX_DIMENSION, quality });
            }
            const { data, mimeType } = encoded;
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
        const preferredAgentId = (detail?.preferredAgentId || '').trim();
        const preferredProfile = this.resolveRequestedProfile(detail);
        const behaviorProfile = this.resolveRequestedBehaviorProfile(detail);
        const requiresLocalModel =
            preferredProfile === 'local'
            || behaviorProfile === 'offline'
            || preferredAgentId.toLowerCase() === GeoAppChatLocalAgentId;

        if (requiresLocalModel) {
            const localAgent = preferredAgentId
                ? this.chatAgentService.getAgent(preferredAgentId)
                : this.chatAgentService.getAgent(GeoAppChatLocalAgentId);
            const requestLabel = preferredAgentId
                ? `l'agent « ${preferredAgentId} »`
                : `l'agent local « ${GeoAppChatLocalAgentId} »`;

            if (!localAgent) {
                throw new Error(`Le mode local/offline demande ${requestLabel}, mais cet agent n'est pas disponible. Aucun repli cloud n'a été appliqué.`);
            }
            if (behaviorProfile === 'offline' && !preferredAgentId && preferredProfile !== 'local') {
                this.messages.warn(`Le comportement offline impose l'agent local : le profil modèle « ${preferredProfile} » n'est pas utilisé pour cette session.`);
            }

            const model = await this.selectAgentLanguageModel(localAgent);
            if (!model) {
                throw new Error(`Le mode local/offline demande ${requestLabel}, mais aucun modèle prêt ne lui est assigné. Aucun repli cloud n'a été appliqué.`);
            }

            const localCheck = checkGeoAppLocalModel(model, this.getLocalModelPreferences());
            if (localCheck.status !== 'local') {
                throw new Error(`Le mode local/offline ne peut pas utiliser ${requestLabel} : ${localCheck.reason}. Aucun repli cloud n'a été appliqué.`);
            }
            return localAgent;
        }

        const candidates: ChatAgent[] = [];
        if (preferredAgentId) {
            const preferredAgent = this.chatAgentService.getAgent(preferredAgentId);
            if (preferredAgent) {
                candidates.push(preferredAgent);
            }
        }

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

        // Repli limite aux agents GeoApp : un agent tiers (Coder, ...) serait
        // epingle sans les tools ni le prompt GeoApp attendus par la session.
        for (const agent of available) {
            if (!candidates.includes(agent) && this.isGeoAppAgent(agent)) {
                candidates.push(agent);
            }
        }

        const requestedCandidate = candidates[0];
        const requestedLabel = preferredAgentId
            ? `l'agent « ${preferredAgentId} »`
            : `le profil « ${preferredProfile || 'default'} »`;
        const rejectedLocalAgents = new Set<string>();

        for (const agent of candidates) {
            const model = await this.selectAgentLanguageModel(agent);
            if (!model) {
                continue;
            }
            if ((agent.id || '').toLowerCase() === GeoAppChatLocalAgentId.toLowerCase()) {
                const localCheck = checkGeoAppLocalModel(model, this.getLocalModelPreferences());
                if (localCheck.status !== 'local') {
                    rejectedLocalAgents.add(agent.id || GeoAppChatLocalAgentId);
                    this.messages.warn(`GeoApp Chat : l'agent local a été ignoré car ${localCheck.reason}.`);
                    continue;
                }
            }
            if (requestedCandidate && agent !== requestedCandidate) {
                this.messages.warn(`GeoApp Chat : ${requestedLabel} n'est pas prêt. Repli sur « ${this.describeAgent(agent)} ».`);
            }
            return agent;
        }

        // Aucun candidat pret (aucun modele assigne) : preferer l'agent GeoApp
        // principal plutot qu'un agent tiers sans contexte GeoApp. Un agent local
        // deja rejete pour modele cloud ne doit pas revenir comme placeholder.
        const fallback = geoApp ?? candidates.find(candidate =>
            this.isGeoAppAgent(candidate) && !rejectedLocalAgents.has(candidate.id || '')
        );
        if (!fallback) {
            throw new Error('Aucun agent GeoApp utilisable n\'a été trouvé. Aucun repli vers un agent tiers n\'a été appliqué.');
        }
        this.messages.warn(`GeoApp Chat : aucun modèle prêt n'a été trouvé. Session ouverte avec « ${this.describeAgent(fallback)} », sans repli vers un agent tiers.`);
        return fallback;
    }

    protected describeAgent(agent: ChatAgent): string {
        return agent.name || agent.id || 'agent inconnu';
    }

    protected isGeoAppAgent(agent: ChatAgent): boolean {
        const id = (agent.id || '').toLowerCase();
        return id === GeoAppChatAgentId.toLowerCase()
            || Object.values(GeoAppChatAgentIdsByProfile).some(agentId => agentId.toLowerCase() === id);
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

    protected resolveRequestedBehaviorProfile(detail?: GeoAppOpenChatRequestDetail): GeoAppChatWorkflowBehaviorProfile {
        return resolveGeoAppChatBehaviorProfileForWorkflow(detail?.workflowKind, detail?.preferredBehaviorProfile, {
            'geoApp.chat.behaviorProfile.default': this.preferenceService.get('geoApp.chat.behaviorProfile.default', 'guided'),
            'geoApp.chat.behaviorProfile.workflow.secretCode': this.preferenceService.get('geoApp.chat.behaviorProfile.workflow.secretCode', 'default'),
            'geoApp.chat.behaviorProfile.workflow.formula': this.preferenceService.get('geoApp.chat.behaviorProfile.workflow.formula', 'default'),
            'geoApp.chat.behaviorProfile.workflow.checker': this.preferenceService.get('geoApp.chat.behaviorProfile.workflow.checker', 'default'),
            'geoApp.chat.behaviorProfile.workflow.hiddenContent': this.preferenceService.get('geoApp.chat.behaviorProfile.workflow.hiddenContent', 'default'),
            'geoApp.chat.behaviorProfile.workflow.imagePuzzle': this.preferenceService.get('geoApp.chat.behaviorProfile.workflow.imagePuzzle', 'default'),
        });
    }

    protected getLocalModelPreferences(): GeoAppLocalModelPreferences {
        return {
            ollamaHost: this.preferenceService.get('ai-features.ollama.ollamaHost', 'http://localhost:11434'),
            lmstudioBaseUrl: this.preferenceService.get('geoApp.ocr.lmstudio.baseUrl', 'http://localhost:1234'),
            openAiCustomModels: this.preferenceService.get('ai-features.openAiCustom.customOpenAiModels', []),
            vercelCustomModels: this.preferenceService.get('ai-features.vercelAi.customModels', []),
            localModelIds: this.preferenceService.get(GEOAPP_CHAT_LOCAL_MODEL_IDS_PREF, []),
        };
    }

    protected async selectAgentLanguageModel(agent: ChatAgent | undefined): Promise<LanguageModel | undefined> {
        if (!agent?.id) {
            return undefined;
        }
        try {
            return await this.languageModelRegistry.selectLanguageModel({
                agent: agent.id,
                purpose: 'chat',
                identifier: 'default/universal'
            });
        } catch {
            return undefined;
        }
    }

    protected async isAgentReady(agent: ChatAgent | undefined): Promise<boolean> {
        return !!(await this.selectAgentLanguageModel(agent));
    }
}
