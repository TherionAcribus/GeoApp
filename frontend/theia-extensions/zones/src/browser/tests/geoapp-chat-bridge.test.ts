import * as assert from 'assert/strict';
import { ChatAgentLocation } from '@theia/ai-chat';
import { DEFAULT_CHAT_AGENT_PREF } from '@theia/ai-chat/lib/common/ai-chat-preferences';
import { GEOAPP_OPEN_CHAT_REQUEST_EVENT, GeoAppChatBridge } from '../geoapp-chat-bridge';
import {
    GeoAppChatFastAgentId,
    GeoAppChatStrongAgentId,
    GeoAppChatWebAgentId,
} from '../geoapp-chat-agent';
import { buildGeoAppOpenChatRequestDetail } from '../geoapp-chat-shared';
import { buildPluginExecutorGeoAppOpenChatDetail } from '../../../../plugins/src/browser/plugin-executor-geoapp-shared';

type FakeAgent = { id: string; name?: string };

type FakeSession = {
    id: string;
    title: string;
    pinnedAgent?: FakeAgent;
    model: {
        settings: { [key: string]: unknown };
        setSettings: (settings: { [key: string]: unknown }) => void;
    };
};

class FakeChatService {
    readonly sessions: FakeSession[] = [];
    readonly createCalls: Array<{ location: ChatAgentLocation; options: { focus: boolean }; pinnedAgent?: FakeAgent }> = [];
    readonly activeCalls: Array<{ id: string; options: { focus: boolean } }> = [];
    readonly sentRequests: Array<{ id: string; text: string }> = [];
    readonly sessionListeners: Array<(event: unknown) => void> = [];
    protected nextSessionIndex = 1;

    getSessions(): FakeSession[] {
        return this.sessions;
    }

    onSessionEvent(listener: (event: unknown) => void): void {
        this.sessionListeners.push(listener);
    }

    createSession(location: ChatAgentLocation, options: { focus: boolean }, pinnedAgent?: FakeAgent): FakeSession {
        const session = this.createFakeSession(`session-${this.nextSessionIndex++}`, pinnedAgent);
        this.sessions.push(session);
        this.createCalls.push({ location, options, pinnedAgent });
        return session;
    }

    setActiveSession(id: string, options: { focus: boolean }): void {
        this.activeCalls.push({ id, options });
    }

    async sendRequest(id: string, request: { text: string }): Promise<void> {
        this.sentRequests.push({ id, text: request.text });
    }

    protected createFakeSession(id: string, pinnedAgent?: FakeAgent): FakeSession {
        return {
            id,
            title: '',
            pinnedAgent,
            model: {
                settings: {
                    temperature: 0.2,
                    geoappWorkflowKind: 'formula',
                    geoappResumeState: { stale: true },
                },
                setSettings(settings: { [key: string]: unknown }) {
                    this.settings = settings;
                },
            },
        };
    }
}

class FakeChatAgentService {
    constructor(readonly agents: FakeAgent[]) {}

    getAgents(): FakeAgent[] {
        return this.agents;
    }

    getAgent(id: string): FakeAgent | undefined {
        return this.agents.find(agent => agent.id === id);
    }
}

class FakePreferenceService {
    constructor(readonly values: Record<string, unknown>) {}

    get<T>(key: string, defaultValue?: T): T {
        return (this.values[key] as T | undefined) ?? (defaultValue as T);
    }
}

class FakeLanguageModelRegistry {
    readonly calls: Array<{ agent: string; purpose: string; identifier: string }> = [];

    constructor(readonly readyAgentIds: Set<string>) {}

    async selectLanguageModel(request: { agent: string; purpose: string; identifier: string }): Promise<{ id: string }> {
        this.calls.push(request);
        if (this.readyAgentIds.has(request.agent)) {
            return { id: request.agent };
        }
        throw new Error(`Agent not ready: ${request.agent}`);
    }
}

class FakeMessageService {
    readonly errors: string[] = [];

    error(message: string): void {
        this.errors.push(message);
    }
}

class FakeWindowEventTarget {
    protected readonly listeners = new Map<string, EventListener[]>();

    addEventListener(type: string, listener: EventListener): void {
        const current = this.listeners.get(type) || [];
        current.push(listener);
        this.listeners.set(type, current);
    }

    removeEventListener(type: string, listener: EventListener): void {
        const current = this.listeners.get(type) || [];
        this.listeners.set(type, current.filter(item => item !== listener));
    }

    async emit(type: string, detail?: unknown): Promise<void> {
        const current = [...(this.listeners.get(type) || [])];
        for (const listener of current) {
            await listener({ type, detail } as unknown as Event);
        }
    }

    listenerCount(type: string): number {
        return (this.listeners.get(type) || []).length;
    }
}

async function triggerOpenChat(
    bridge: GeoAppChatBridge,
    detail: unknown
): Promise<void> {
    await (bridge as any).handleOpenChatRequest({ detail });
}

function createBridge(options?: {
    agents?: FakeAgent[];
    preferences?: Record<string, unknown>;
    readyAgentIds?: string[];
}) {
    const agents = options?.agents || [
        { id: GeoAppChatFastAgentId, name: 'GeoApp Chat (Fast)' },
        { id: GeoAppChatStrongAgentId, name: 'GeoApp Chat (Strong)' },
        { id: GeoAppChatWebAgentId, name: 'GeoApp Chat (Web)' },
    ];
    const preferences = options?.preferences || {};
    const chatService = new FakeChatService();
    const chatAgentService = new FakeChatAgentService(agents);
    const preferenceService = new FakePreferenceService(preferences);
    const languageModelRegistry = new FakeLanguageModelRegistry(new Set(options?.readyAgentIds || []));
    const messages = new FakeMessageService();

    const bridge = new GeoAppChatBridge(
        chatService as any,
        chatAgentService as any,
        preferenceService as any,
        languageModelRegistry as any,
        messages as any
    );

    return { bridge, chatService, chatAgentService, preferenceService, languageModelRegistry, messages };
}

async function withFakeWindow<T>(callback: (fakeWindow: FakeWindowEventTarget) => Promise<T>): Promise<T> {
    const previousWindow = (globalThis as any).window;
    const fakeWindow = new FakeWindowEventTarget();
    (globalThis as any).window = fakeWindow;
    try {
        return await callback(fakeWindow);
    } finally {
        (globalThis as any).window = previousWindow;
    }
}

async function testCreatesSessionWithWorkflowProfileAndPrompt(): Promise<void> {
    const { bridge, chatService, languageModelRegistry, messages } = createBridge({
        preferences: {
            'geoApp.chat.defaultProfile': 'fast',
            'geoApp.chat.workflowProfile.formula': 'strong',
        },
        readyAgentIds: [GeoAppChatStrongAgentId],
    });

    await triggerOpenChat(bridge, {
        gcCode: 'GC12345',
        prompt: 'Analyse la geocache.',
        workflowKind: 'formula',
        resumeState: { workflow: { kind: 'formula' } },
    });

    assert.equal(chatService.createCalls.length, 1);
    assert.equal(chatService.createCalls[0].location, ChatAgentLocation.Panel);
    assert.equal(chatService.sessions.length, 1);
    assert.equal(chatService.sessions[0].pinnedAgent?.id, GeoAppChatStrongAgentId);
    assert.equal(chatService.sessions[0].title, 'CHAT IA - GC12345 [Strong]');
    assert.deepEqual(chatService.sessions[0].model.settings, { temperature: 0.2 });
    assert.equal(chatService.sentRequests.length, 1);
    assert.match(chatService.sentRequests[0].text, /RESUME_STATE_JSON/);
    assert.equal(languageModelRegistry.calls[0].agent, GeoAppChatStrongAgentId);
    assert.deepEqual(messages.errors, []);
}

async function testReusesExistingSessionByGcCode(): Promise<void> {
    const { bridge, chatService } = createBridge({
        preferences: {
            'geoApp.chat.defaultProfile': 'fast',
            'geoApp.chat.workflowProfile.secretCode': 'fast',
        },
        readyAgentIds: [GeoAppChatFastAgentId],
    });

    await triggerOpenChat(bridge, {
        gcCode: 'GC54321',
        prompt: 'Premier envoi.',
        workflowKind: 'formula',
    });

    const session = chatService.sessions[0];
    session.model.settings = {
        keepMe: true,
        geoappGcCode: 'GC54321',
        geoappWorkflowKind: 'secret_code',
    };

    await triggerOpenChat(bridge, {
        gcCode: 'GC54321',
        prompt: 'Second envoi.',
        workflowKind: 'secret_code',
        focus: false,
    });

    assert.equal(chatService.createCalls.length, 1);
    assert.equal(chatService.activeCalls.length, 1);
    assert.deepEqual(chatService.activeCalls[0], {
        id: session.id,
        options: { focus: false },
    });
    assert.equal(chatService.sentRequests.length, 2);
    assert.equal(chatService.sessions[0].title, 'CHAT IA - GC54321 [Fast]');
    assert.deepEqual(chatService.sessions[0].model.settings, { keepMe: true });
}

async function testFallsBackToConfiguredReadyAgent(): Promise<void> {
    const universalAgent = { id: 'universal-chat', name: 'Universal Agent' };
    const { bridge, chatService, languageModelRegistry } = createBridge({
        agents: [
            { id: GeoAppChatStrongAgentId, name: 'GeoApp Chat (Strong)' },
            universalAgent,
        ],
        preferences: {
            'geoApp.chat.defaultProfile': 'fast',
            'geoApp.chat.workflowProfile.hiddenContent': 'strong',
            [DEFAULT_CHAT_AGENT_PREF]: 'universal-chat',
        },
        readyAgentIds: ['universal-chat'],
    });

    await triggerOpenChat(bridge, {
        geocacheName: 'Fallback test',
        workflowKind: 'hidden_content',
    });

    assert.equal(chatService.sessions.length, 1);
    assert.equal(chatService.sessions[0].pinnedAgent?.id, 'universal-chat');
    assert.equal(chatService.sessions[0].title, 'CHAT IA - Fallback test [Universal Agent]');
    assert.deepEqual(
        languageModelRegistry.calls.map(call => call.agent),
        [GeoAppChatStrongAgentId, 'universal-chat']
    );
}

async function testBridgeLifecycleHandlesWindowEventsAndStop(): Promise<void> {
    await withFakeWindow(async fakeWindow => {
        const { bridge, chatService } = createBridge({
            preferences: {
                'geoApp.chat.defaultProfile': 'fast',
                'geoApp.chat.workflowProfile.formula': 'strong',
            },
            readyAgentIds: [GeoAppChatStrongAgentId],
        });

        const existingSession = chatService.createSession(ChatAgentLocation.Panel, { focus: true }, {
            id: GeoAppChatFastAgentId,
            name: 'GeoApp Chat (Fast)',
        });
        existingSession.model.settings = {
            keepMe: true,
            geoappWorkflowKind: 'formula',
            geoappResumeState: { stale: true },
        };
        chatService.createCalls.length = 0;

        bridge.onStart();
        assert.equal(fakeWindow.listenerCount(GEOAPP_OPEN_CHAT_REQUEST_EVENT), 1);
        assert.deepEqual(existingSession.model.settings, { keepMe: true });

        await fakeWindow.emit(GEOAPP_OPEN_CHAT_REQUEST_EVENT, {
            gcCode: 'GC88888',
            prompt: 'Prompt from DOM event',
            workflowKind: 'formula',
        });

        assert.equal(chatService.createCalls.length, 1);
        assert.equal(chatService.sentRequests.length, 1);
        assert.match(chatService.sentRequests[0].text, /Prompt from DOM event/);

        bridge.onStop();
        assert.equal(fakeWindow.listenerCount(GEOAPP_OPEN_CHAT_REQUEST_EVENT), 0);

        await fakeWindow.emit(GEOAPP_OPEN_CHAT_REQUEST_EVENT, {
            gcCode: 'GC99999',
            prompt: 'Should not be handled',
            workflowKind: 'formula',
        });

        assert.equal(chatService.createCalls.length, 1);
        assert.equal(chatService.sentRequests.length, 1);
    });
}

async function testBridgeRemovesSessionMetadataOnDeletedEvent(): Promise<void> {
    await withFakeWindow(async fakeWindow => {
        const { bridge, chatService } = createBridge({
            preferences: {
                'geoApp.chat.defaultProfile': 'fast',
            },
            readyAgentIds: [GeoAppChatFastAgentId],
        });

        bridge.onStart();
        await fakeWindow.emit(GEOAPP_OPEN_CHAT_REQUEST_EVENT, {
            gcCode: 'GC10101',
            prompt: 'Track metadata',
            workflowKind: 'secret_code',
        });

        assert.equal((bridge as any).sessionMetadata.size, 1);
        assert.equal(chatService.sessionListeners.length, 1);

        chatService.sessionListeners[0]({
            type: 'deleted',
            sessionId: chatService.sessions[0].id,
        });

        assert.equal((bridge as any).sessionMetadata.size, 0);
    });
}

async function testBridgeAcceptsGeocacheDetailsPayloadBuilder(): Promise<void> {
    const { bridge, chatService } = createBridge({
        preferences: {
            'geoApp.chat.defaultProfile': 'fast',
            'geoApp.chat.workflowProfile.formula': 'strong',
        },
        readyAgentIds: [GeoAppChatStrongAgentId],
    });

    await triggerOpenChat(bridge, buildGeoAppOpenChatRequestDetail({
        geocacheId: 51,
        gcCode: 'GC51000',
        geocacheName: 'Details cache',
        prompt: 'Diagnostic depuis la fiche.',
        workflowKind: 'formula',
        preferredProfile: 'strong',
    }));

    assert.equal(chatService.sessions.length, 1);
    assert.equal(chatService.sessions[0].title, 'CHAT IA - GC51000 [Strong]');
    assert.equal(chatService.sentRequests[0].text, 'Diagnostic depuis la fiche.');
}

async function testBridgeReusesSessionAcrossGeoappEntryPoints(): Promise<void> {
    const { bridge, chatService } = createBridge({
        preferences: {
            'geoApp.chat.defaultProfile': 'fast',
            'geoApp.chat.workflowProfile.secretCode': 'fast',
        },
        readyAgentIds: [GeoAppChatFastAgentId],
    });

    await triggerOpenChat(bridge, buildGeoAppOpenChatRequestDetail({
        geocacheId: 77,
        gcCode: 'GC77000',
        geocacheName: 'Cross entry cache',
        prompt: 'Ouverture depuis la fiche.',
        workflowKind: 'secret_code',
    }));

    await triggerOpenChat(bridge, buildPluginExecutorGeoAppOpenChatDetail(
        'Diagnostic depuis le plugin executor',
        'secret_code',
        'fast',
        { currentText: '8 5 12 12 15' },
        {
            geocacheId: 77,
            gcCode: 'GC77000',
            name: 'Cross entry cache',
        }
    ));

    assert.equal(chatService.createCalls.length, 1);
    assert.equal(chatService.activeCalls.length, 1);
    assert.equal(chatService.sentRequests.length, 2);
    assert.match(chatService.sentRequests[1].text, /RESUME_STATE_JSON/);
    assert.equal(chatService.sessions[0].title, 'CHAT IA - GC77000 [Fast]');
}

async function run(): Promise<void> {
    await testCreatesSessionWithWorkflowProfileAndPrompt();
    await testReusesExistingSessionByGcCode();
    await testFallsBackToConfiguredReadyAgent();
    await testBridgeLifecycleHandlesWindowEventsAndStop();
    await testBridgeRemovesSessionMetadataOnDeletedEvent();
    await testBridgeAcceptsGeocacheDetailsPayloadBuilder();
    await testBridgeReusesSessionAcrossGeoappEntryPoints();
    // eslint-disable-next-line no-console
    console.log('geoapp-chat-bridge tests passed');
}

void run();
