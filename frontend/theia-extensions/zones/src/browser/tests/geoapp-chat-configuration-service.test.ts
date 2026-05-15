import * as assert from 'assert/strict';

import {
    GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF,
    GEOAPP_CHAT_PROMPT_PACK_PREF,
    GEOAPP_CHAT_SKILL_POLICY_OVERRIDES_PREF,
    GEOAPP_CHAT_TOOL_POLICY_OVERRIDES_PREF,
} from '../geoapp-chat-shared';
import { GeoAppChatSkillNames } from '../geoapp-chat-skills';
import { GeoAppChatPromptVariantByPack } from '../geoapp-chat-system-prompts';

declare const require: any;
declare const global: any;

require.extensions['.css'] = () => undefined;

const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
global.window = dom.window;
global.document = dom.window.document;
(global.document as any).queryCommandSupported = () => false;
global.Element = dom.window.Element;
global.HTMLElement = dom.window.HTMLElement;
global.DragEvent = dom.window.DragEvent || class {};
global.MouseEvent = dom.window.MouseEvent;
Object.defineProperty(global, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
});

const { FrontendApplicationConfigProvider } = require('@theia/core/lib/browser/frontend-application-config-provider');
FrontendApplicationConfigProvider.set({ applicationName: 'GeoApp Tests' });

const { GeoAppChatConfigurationService } = require('../geoapp-chat-configuration-service');

type PreferenceValues = Record<string, unknown>;

class FakePreferenceService {
    readonly values: PreferenceValues;
    readonly updates: PreferenceValues = {};

    constructor(values: PreferenceValues = {}) {
        this.values = { ...values };
    }

    get<T>(key: string, defaultValue?: T): T {
        return (Object.prototype.hasOwnProperty.call(this.values, key) ? this.values[key] : defaultValue) as T;
    }

    async set(key: string, value: unknown): Promise<void> {
        this.values[key] = value;
        this.updates[key] = value;
    }
}

class FakePromptService {
    constructor(readonly fragments: Record<string, Record<string, unknown>> = {}) {}

    getPromptFragment(variantId: string): Record<string, unknown> | undefined {
        return this.fragments[variantId];
    }
}

class FakePromptCustomizationService {
    readonly removed: string[] = [];
    readonly created: Array<{ variantId: string; template: string }> = [];

    async removeAllPromptFragmentCustomizations(variantId: string): Promise<void> {
        this.removed.push(variantId);
    }

    async createBuiltInPromptFragmentCustomization(variantId: string, template: string): Promise<void> {
        this.created.push({ variantId, template });
    }
}

class FakeSkillStateService {
    readonly imported: Array<{ name: string; content: string }> = [];

    async getSkillExports(): Promise<unknown[]> {
        return [
            {
                name: GeoAppChatSkillNames.coordinates,
                label: 'Coordonnees',
                status: 'customized',
                configLocation: 'skills/geoapp-coordinates/SKILL.md',
                isCustomized: true,
                content: '# Custom coordinates skill',
            },
            {
                name: GeoAppChatSkillNames.formula,
                label: 'Formules',
                status: 'geoapp_default',
                configLocation: 'skills/geoapp-formula/SKILL.md',
                isCustomized: false,
            },
        ];
    }

    async getSkillStates(): Promise<Map<string, any>> {
        return new Map([
            [
                GeoAppChatSkillNames.coordinates,
                {
                    name: GeoAppChatSkillNames.coordinates,
                    status: 'geoapp_default',
                    configLocation: 'skills/geoapp-coordinates/SKILL.md',
                    discovered: true,
                    managedContent: true,
                    message: 'Version GeoApp active.',
                },
            ],
        ]);
    }

    async importCustomSkillContent(name: string, content: string): Promise<unknown> {
        this.imported.push({ name, content });
        return {
            name,
            status: 'customized',
            configLocation: `skills/${name}/SKILL.md`,
            discovered: true,
            managedContent: false,
            message: 'Skill personnalisée importée.',
        };
    }
}

function createService(preferences: PreferenceValues = {}): {
    service: any;
    preferenceService: FakePreferenceService;
    promptCustomizationService: FakePromptCustomizationService;
    skillStateService: FakeSkillStateService;
} {
    const guidedVariant = GeoAppChatPromptVariantByPack.guided;
    const service = new GeoAppChatConfigurationService();
    const preferenceService = new FakePreferenceService(preferences);
    const promptCustomizationService = new FakePromptCustomizationService();
    const skillStateService = new FakeSkillStateService();

    (service as any).preferenceService = preferenceService;
    (service as any).promptCustomizationService = promptCustomizationService;
    (service as any).skillStateService = skillStateService;
    (service as any).promptService = new FakePromptService({
        [guidedVariant]: {
            id: guidedVariant,
            name: 'Guided custom',
            description: 'Prompt guided personnalise',
            template: 'CUSTOM GUIDED PROMPT',
            customizationId: 'custom-guided',
            priority: 100,
        },
    });

    return { service, preferenceService, promptCustomizationService, skillStateService };
}

async function testFullExportIncludesPolicyPromptsAndCustomSkills(): Promise<void> {
    const { service } = createService({
        [GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF]: 'automation',
        [GEOAPP_CHAT_PROMPT_PACK_PREF]: 'guided',
        [GEOAPP_CHAT_TOOL_POLICY_OVERRIDES_PREF]: {
            'geoapp.coordinates.save-found': 'confirm',
        },
        [GEOAPP_CHAT_SKILL_POLICY_OVERRIDES_PREF]: {
            [GeoAppChatSkillNames.checkers]: 'enabled',
        },
    });

    const exported = await service.getFullConfigurationExport();

    assert.equal(exported.type, 'geoapp-chat-configuration');
    assert.equal(exported.version, 3);
    assert.equal(exported.policy[GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF], 'automation');
    assert.deepEqual(exported.policy[GEOAPP_CHAT_TOOL_POLICY_OVERRIDES_PREF], {
        'geoapp.coordinates.save-found': 'confirm',
    });

    const guided = exported.promptPacks.find(promptPack => promptPack.variantId === GeoAppChatPromptVariantByPack.guided);
    assert.ok(guided);
    assert.equal(guided?.isCustomized, true);
    assert.equal(guided?.template, 'CUSTOM GUIDED PROMPT');

    const coordinates = exported.skills.find(skill => skill.name === GeoAppChatSkillNames.coordinates);
    const formula = exported.skills.find(skill => skill.name === GeoAppChatSkillNames.formula);
    assert.equal(coordinates?.isCustomized, true);
    assert.equal(coordinates?.content, '# Custom coordinates skill');
    assert.equal(formula?.isCustomized, false);
    assert.equal(formula?.content, undefined);
}

async function testFullImportAppliesPolicyCustomPromptsAndCustomSkills(): Promise<void> {
    const { service, preferenceService, promptCustomizationService, skillStateService } = createService();
    const safeVariant = GeoAppChatPromptVariantByPack.safe;
    const serialized = JSON.stringify({
        type: 'geoapp-chat-configuration',
        version: 3,
        policy: {
            [GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF]: 'safe',
            [GEOAPP_CHAT_PROMPT_PACK_PREF]: 'safe',
            [GEOAPP_CHAT_TOOL_POLICY_OVERRIDES_PREF]: {
                'formula-solver.search-answer': 'disabled',
            },
        },
        promptPacks: [
            {
                pack: 'safe',
                variantId: safeVariant,
                name: 'Safe custom',
                template: 'CUSTOM SAFE PROMPT',
                isCustomized: true,
            },
            {
                pack: 'guided',
                variantId: GeoAppChatPromptVariantByPack.guided,
                name: 'Guided built-in',
                template: 'BUILTIN GUIDED PROMPT',
                isCustomized: false,
            },
        ],
        skills: [
            {
                name: GeoAppChatSkillNames.coordinates,
                label: 'Coordonnees',
                isCustomized: true,
                content: '# Imported coordinates skill',
            },
            {
                name: GeoAppChatSkillNames.formula,
                label: 'Formules',
                isCustomized: false,
                content: '# Should not be imported',
            },
        ],
    });

    const result = await service.importConfiguration(serialized, {
        confirmPromptPacks: () => true,
        confirmSkills: () => true,
        confirmOverwriteSkill: () => true,
    });

    assert.equal(result.importedPolicyCount, 3);
    assert.equal(result.importedPromptCount, 1);
    assert.equal(result.importedSkillCount, 1);
    assert.equal(preferenceService.updates[GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF], 'safe');
    assert.equal(preferenceService.updates[GEOAPP_CHAT_PROMPT_PACK_PREF], 'safe');
    assert.deepEqual(preferenceService.updates[GEOAPP_CHAT_TOOL_POLICY_OVERRIDES_PREF], {
        'formula-solver.search-answer': 'disabled',
    });

    assert.deepEqual(promptCustomizationService.removed, [safeVariant]);
    assert.deepEqual(promptCustomizationService.created, [
        { variantId: safeVariant, template: 'CUSTOM SAFE PROMPT' },
    ]);
    assert.deepEqual(skillStateService.imported, [
        { name: GeoAppChatSkillNames.coordinates, content: '# Imported coordinates skill' },
    ]);
}

function testPreviewSummarizesFullConfiguration(): void {
    const { service } = createService();
    const serialized = JSON.stringify({
        type: 'geoapp-chat-configuration',
        version: 3,
        exportedAt: '2026-05-15T10:00:00.000Z',
        policy: {
            [GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF]: 'safe',
            [GEOAPP_CHAT_PROMPT_PACK_PREF]: 'safe',
        },
        promptPacks: [
            {
                pack: 'safe',
                variantId: GeoAppChatPromptVariantByPack.safe,
                name: 'Safe custom',
                template: 'CUSTOM SAFE PROMPT',
                isCustomized: true,
            },
        ],
        skills: [
            {
                name: GeoAppChatSkillNames.coordinates,
                isCustomized: true,
                content: '# Imported coordinates skill',
            },
        ],
    });

    const preview = service.previewConfiguration(serialized);

    assert.equal(preview.format, 'full');
    assert.equal(preview.version, 3);
    assert.equal(preview.exportedAt, '2026-05-15T10:00:00.000Z');
    assert.equal(preview.policyCount, 2);
    assert.deepEqual(preview.policyKeys, [
        GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF,
        GEOAPP_CHAT_PROMPT_PACK_PREF,
    ]);
    assert.equal(preview.customizedPromptCount, 1);
    assert.deepEqual(preview.customizedPromptNames, ['safe']);
    assert.equal(preview.customizedSkillCount, 1);
    assert.deepEqual(preview.customizedSkillNames, [GeoAppChatSkillNames.coordinates]);
}

async function testLegacyPolicyImportStillWorks(): Promise<void> {
    const { service, preferenceService, promptCustomizationService, skillStateService } = createService();

    const result = await service.importConfiguration(JSON.stringify({
        [GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF]: 'debug',
        [GEOAPP_CHAT_PROMPT_PACK_PREF]: 'debug',
    }));

    assert.equal(result.importedPolicyCount, 2);
    assert.equal(result.importedPromptCount, 0);
    assert.equal(result.importedSkillCount, 0);
    assert.equal(preferenceService.updates[GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF], 'debug');
    assert.equal(preferenceService.updates[GEOAPP_CHAT_PROMPT_PACK_PREF], 'debug');
    assert.deepEqual(promptCustomizationService.created, []);
    assert.deepEqual(skillStateService.imported, []);

    const preview = service.previewConfiguration(JSON.stringify({
        [GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF]: 'debug',
        [GEOAPP_CHAT_PROMPT_PACK_PREF]: 'debug',
    }));
    assert.equal(preview.format, 'legacy');
    assert.equal(preview.policyCount, 2);
    assert.deepEqual(preview.policyKeys, [
        GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF,
        GEOAPP_CHAT_PROMPT_PACK_PREF,
    ]);
    assert.equal(preview.customizedPromptCount, 0);
    assert.equal(preview.customizedSkillCount, 0);
}

async function run(): Promise<void> {
    await testFullExportIncludesPolicyPromptsAndCustomSkills();
    await testFullImportAppliesPolicyCustomPromptsAndCustomSkills();
    testPreviewSummarizesFullConfiguration();
    await testLegacyPolicyImportStillWorks();
    // eslint-disable-next-line no-console
    console.log('geoapp-chat-configuration-service tests passed');
}

void run();
