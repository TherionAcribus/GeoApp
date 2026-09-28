import * as assert from 'assert/strict';
import {
    buildGeoAppBaseSessionTitle,
    buildGeoAppOpenChatRequestDetail,
    buildGeoAppChatDisplaySessionTitle,
    buildGeoAppChatPrompt,
    buildGeoAppResumeStateBlock,
    dispatchGeoAppOpenChatRequest,
    GEOAPP_OPEN_CHAT_REQUEST_EVENT,
    getGeoAppAgentSessionLabel,
    GEOAPP_CHAT_BEHAVIOR_CHECKER_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_FORMULA_PROFILE_PREF,
    GEOAPP_CHAT_CHECKER_PROFILE_PREF,
    GEOAPP_CHAT_DEFAULT_PROFILE_PREF,
    GEOAPP_CHAT_FORMULA_PROFILE_PREF,
    GEOAPP_CHAT_HIDDEN_CONTENT_PROFILE_PREF,
    GEOAPP_CHAT_IMAGE_PUZZLE_PROFILE_PREF,
    GEOAPP_CHAT_SECRET_CODE_PROFILE_PREF,
    resolveGeoAppChatBehaviorProfileForWorkflow,
    resolveGeoAppChatProfileForWorkflow,
    resolveGeoAppChatWorkflowKindFromClassification,
    resolveGeoAppChatWorkflowKindFromOrchestrator,
    sanitizeGeoAppSessionSettings,
    clearPreparedGeoAppChatImages,
    GEOAPP_CHAT_IMAGE_MAX_DIMENSION,
    geoAppChatJpegQuality,
    rememberPreparedGeoAppChatImage,
    takePreparedGeoAppChatImage,
} from '../geoapp-chat-shared';

function testResolveGeoAppChatProfileForWorkflow(): void {
    assert.equal(
        resolveGeoAppChatProfileForWorkflow(undefined, undefined, {}),
        'fast'
    );

    assert.equal(
        resolveGeoAppChatProfileForWorkflow('formula', undefined, {
            [GEOAPP_CHAT_DEFAULT_PROFILE_PREF]: 'fast',
            [GEOAPP_CHAT_FORMULA_PROFILE_PREF]: 'strong',
        }),
        'strong'
    );

    assert.equal(
        resolveGeoAppChatProfileForWorkflow('checker', undefined, {
            [GEOAPP_CHAT_DEFAULT_PROFILE_PREF]: 'local',
            [GEOAPP_CHAT_CHECKER_PROFILE_PREF]: 'web',
        }),
        'web'
    );

    assert.equal(
        resolveGeoAppChatProfileForWorkflow('hidden_content', 'web', {
            [GEOAPP_CHAT_DEFAULT_PROFILE_PREF]: 'fast',
            [GEOAPP_CHAT_HIDDEN_CONTENT_PROFILE_PREF]: 'strong',
        }),
        'web'
    );

    assert.equal(
        resolveGeoAppChatProfileForWorkflow('image_puzzle', 'invalid', {
            [GEOAPP_CHAT_DEFAULT_PROFILE_PREF]: 'local',
            [GEOAPP_CHAT_IMAGE_PUZZLE_PROFILE_PREF]: 'strong',
        }),
        'strong'
    );

    assert.equal(
        resolveGeoAppChatProfileForWorkflow('secret_code', undefined, {
            [GEOAPP_CHAT_DEFAULT_PROFILE_PREF]: 'web',
            [GEOAPP_CHAT_SECRET_CODE_PROFILE_PREF]: 'default',
        }),
        'web'
    );
}

function testResolveGeoAppChatBehaviorProfileForWorkflow(): void {
    assert.equal(
        resolveGeoAppChatBehaviorProfileForWorkflow(undefined, undefined, {}),
        'guided'
    );

    assert.equal(
        resolveGeoAppChatBehaviorProfileForWorkflow('formula', undefined, {
            [GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF]: 'guided',
            [GEOAPP_CHAT_BEHAVIOR_FORMULA_PROFILE_PREF]: 'automation',
        }),
        'automation'
    );

    assert.equal(
        resolveGeoAppChatBehaviorProfileForWorkflow('checker', undefined, {
            [GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF]: 'offline',
            [GEOAPP_CHAT_BEHAVIOR_CHECKER_PROFILE_PREF]: 'safe',
        }),
        'safe'
    );

    assert.equal(
        resolveGeoAppChatBehaviorProfileForWorkflow('checker', 'debug', {
            [GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF]: 'safe',
            [GEOAPP_CHAT_BEHAVIOR_CHECKER_PROFILE_PREF]: 'offline',
        }),
        'debug'
    );
}

function testBuildGeoAppChatPrompt(): void {
    const resumeState = { workflow: { kind: 'formula' }, currentText: 'A=1' };
    const block = buildGeoAppResumeStateBlock(resumeState);
    assert.ok(block);
    assert.match(block || '', /RESUME_STATE_JSON|```json/);
    assert.match(block || '', /"formula"/);

    const prompt = buildGeoAppChatPrompt('Resume the current attempt.', resumeState);
    assert.match(prompt, /^Resume the current attempt\./);
    assert.match(prompt, /RESUME_STATE_JSON/);
    assert.match(prompt, /privilégie ce JSON structuré/);

    const promptWithoutText = buildGeoAppChatPrompt(undefined, resumeState);
    assert.match(promptWithoutText, /^RESUME_STATE_JSON/);

    assert.equal(buildGeoAppChatPrompt('Only text', undefined), 'Only text');
}

function testSessionTitleHelpers(): void {
    assert.equal(getGeoAppAgentSessionLabel({ id: 'geoapp-chat-fast' }), 'Fast');
    assert.equal(getGeoAppAgentSessionLabel({ id: 'GeoApp' }), 'GeoApp');
    assert.equal(getGeoAppAgentSessionLabel({ id: 'custom-agent', name: 'Custom Agent' }), 'Custom Agent');
    assert.equal(buildGeoAppChatDisplaySessionTitle('CHAT IA - GC12345', { id: 'geoapp-chat-strong' }), 'CHAT IA - GC12345 [Strong]');
    assert.equal(buildGeoAppChatDisplaySessionTitle('CHAT IA - GC12345'), 'CHAT IA - GC12345');
    assert.equal(buildGeoAppBaseSessionTitle('GC99999', 'Mystery name'), 'CHAT IA - GC99999');
    assert.equal(buildGeoAppBaseSessionTitle(undefined, 'Mystery name'), 'CHAT IA - Mystery name');
}

function testSanitizeGeoAppSessionSettings(): void {
    const sanitized = sanitizeGeoAppSessionSettings({
        temperature: 0.2,
        geoappWorkflowKind: 'formula',
        geoappPreferredProfile: 'strong',
        geoappResumeState: { step: 'x' },
        geoappGcCode: 'GC12345',
        geoappGeocacheId: 42,
        geoappSessionKind: 'auto',
        geoappBehaviorProfile: 'debug',
        commonSettings: {
            geoapp: {
                workflowKind: 'formula',
                sessionKind: 'auto',
            },
        },
        keepMe: true,
    });

    assert.deepEqual(sanitized, {
        temperature: 0.2,
        commonSettings: {
            geoapp: {
                workflowKind: 'formula',
                sessionKind: 'auto',
            },
        },
        keepMe: true,
    });
}

function testWorkflowPreferenceCoverage(): void {
    assert.equal(
        resolveGeoAppChatProfileForWorkflow('formula', undefined, {
            [GEOAPP_CHAT_DEFAULT_PROFILE_PREF]: 'fast',
            [GEOAPP_CHAT_FORMULA_PROFILE_PREF]: 'strong',
            [GEOAPP_CHAT_SECRET_CODE_PROFILE_PREF]: 'local',
            [GEOAPP_CHAT_HIDDEN_CONTENT_PROFILE_PREF]: 'web',
        }),
        'strong'
    );
}

function testWorkflowKindRoutingHelpers(): void {
    assert.equal(
        resolveGeoAppChatWorkflowKindFromClassification({
            labels: [{ name: 'formula' }, { name: 'secret_code' }],
        }),
        'formula'
    );

    assert.equal(
        resolveGeoAppChatWorkflowKindFromClassification({
            labels: [{ name: 'hidden_content' }, { name: 'secret_code' }],
        }),
        'secret_code'
    );

    assert.equal(
        resolveGeoAppChatWorkflowKindFromOrchestrator({
            workflow: { kind: 'coord_transform' },
            classification: { labels: [{ name: 'checker_available' }] },
        }),
        'formula'
    );

    assert.equal(
        resolveGeoAppChatWorkflowKindFromOrchestrator({
            workflow: { kind: 'unknown' },
            classification: { labels: [{ name: 'image_puzzle' }] },
        }),
        'image_puzzle'
    );
}

function testOpenChatDetailBuilder(): void {
    const detail = buildGeoAppOpenChatRequestDetail({
        geocacheId: 12,
        gcCode: 'GC4242',
        geocacheName: 'Bridge cache',
        prompt: 'Analyse',
        workflowKind: 'formula',
        preferredProfile: 'strong',
    });

    assert.deepEqual(detail, {
        geocacheId: 12,
        gcCode: 'GC4242',
        geocacheName: 'Bridge cache',
        sessionTitle: 'CHAT IA - GC4242',
        prompt: 'Analyse',
        imageContexts: undefined,
        imageUrls: undefined,
        focus: true,
        workflowKind: 'formula',
        preferredProfile: 'strong',
        preferredBehaviorProfile: undefined,
        preferredAgentId: undefined,
        earthcoachMode: undefined,
        earthcoachVerbosity: undefined,
        earthcoachResponseLanguage: undefined,
        earthcoachRequestId: undefined,
        imageQuality: undefined,
        resumeState: undefined,
        sessionKind: undefined,
    });

    const localized = buildGeoAppOpenChatRequestDetail({
        geocacheId: 13,
        gcCode: 'GC1313',
        geocacheName: 'Localized cache',
        prompt: 'Resoudre',
        earthcoachMode: 'resolver',
        earthcoachResponseLanguage: 'en',
    });
    assert.equal(localized.earthcoachMode, 'resolver');
    assert.equal(localized.earthcoachResponseLanguage, 'en');

    const highQuality = buildGeoAppOpenChatRequestDetail({ prompt: 'Photos', imageQuality: 'high' });
    assert.equal(highQuality.imageQuality, 'high');
}

function testChatImageQuality(): void {
    assert.equal(geoAppChatJpegQuality('high'), 0.95);
    assert.equal(geoAppChatJpegQuality('standard'), 0.85);
    assert.equal(geoAppChatJpegQuality(undefined), 0.85);
    assert.equal(GEOAPP_CHAT_IMAGE_MAX_DIMENSION, 1568);
}

function testPreparedChatImageCache(): void {
    clearPreparedGeoAppChatImages();
    const image = { data: 'abc', mimeType: 'image/jpeg' };
    rememberPreparedGeoAppChatImage('http://x/1.jpg', 'high', image, 1000);
    // La qualite fait partie de la cle : une preparation standard ne sert pas une demande haute qualite.
    assert.equal(takePreparedGeoAppChatImage('http://x/1.jpg', 'standard', 1000), undefined);
    assert.deepEqual(takePreparedGeoAppChatImage('http://x/1.jpg', 'high', 1000), image);
    // Lecture consommante.
    assert.equal(takePreparedGeoAppChatImage('http://x/1.jpg', 'high', 1000), undefined);
    // Expiration.
    rememberPreparedGeoAppChatImage('http://x/2.jpg', undefined, image, 0);
    assert.equal(takePreparedGeoAppChatImage('http://x/2.jpg', 'standard', 5 * 60 * 1000 + 1), undefined);
    // Plafond : les plus anciennes entrees sortent.
    for (let index = 0; index < 45; index++) {
        rememberPreparedGeoAppChatImage(`http://x/n${index}.jpg`, 'high', image, 0);
    }
    assert.equal(takePreparedGeoAppChatImage('http://x/n0.jpg', 'high', 1), undefined);
    assert.deepEqual(takePreparedGeoAppChatImage('http://x/n44.jpg', 'high', 1), image);
    clearPreparedGeoAppChatImages();
}

function testDispatchGeoAppOpenChatRequest(): void {
    const dispatched: Array<{ type: string; detail: unknown }> = [];
    class FakeCustomEvent<T> {
        readonly type: string;
        readonly detail: T;
        constructor(type: string, init: { detail: T }) {
            this.type = type;
            this.detail = init.detail;
        }
    }

    dispatchGeoAppOpenChatRequest(
        {
            dispatchEvent(event: unknown) {
                const typed = event as { type: string; detail: unknown };
                dispatched.push(typed);
                return true;
            }
        },
        FakeCustomEvent,
        {
            geocacheId: 9,
            gcCode: 'GC9000',
            geocacheName: 'Dispatch cache',
            prompt: 'Tester le bridge',
            workflowKind: 'hidden_content',
            preferredProfile: 'web',
        }
    );

    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].type, GEOAPP_OPEN_CHAT_REQUEST_EVENT);
    assert.deepEqual(dispatched[0].detail, {
        geocacheId: 9,
        gcCode: 'GC9000',
        geocacheName: 'Dispatch cache',
        sessionTitle: 'CHAT IA - GC9000',
        prompt: 'Tester le bridge',
        imageContexts: undefined,
        imageUrls: undefined,
        focus: true,
        workflowKind: 'hidden_content',
        preferredProfile: 'web',
        preferredBehaviorProfile: undefined,
        preferredAgentId: undefined,
        earthcoachMode: undefined,
        earthcoachVerbosity: undefined,
        earthcoachResponseLanguage: undefined,
        earthcoachRequestId: undefined,
        imageQuality: undefined,
        resumeState: undefined,
        sessionKind: undefined,
    });
}

function run(): void {
    testResolveGeoAppChatProfileForWorkflow();
    testResolveGeoAppChatBehaviorProfileForWorkflow();
    testBuildGeoAppChatPrompt();
    testSessionTitleHelpers();
    testSanitizeGeoAppSessionSettings();
    testWorkflowPreferenceCoverage();
    testWorkflowKindRoutingHelpers();
    testOpenChatDetailBuilder();
    testChatImageQuality();
    testPreparedChatImageCache();
    testDispatchGeoAppOpenChatRequest();
    // eslint-disable-next-line no-console
    console.log('geoapp-chat-shared tests passed');
}

run();
