import { injectable, inject, optional } from '@theia/core/shared/inversify';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';
import {
    PromptFragment,
    PromptFragmentCustomizationService,
    PromptService,
    isCustomizedPromptFragment
} from '@theia/ai-core/lib/common/prompt-service';

import {
    GEOAPP_CHAT_BEHAVIOR_CHECKER_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_FORMULA_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_HIDDEN_CONTENT_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_IMAGE_PUZZLE_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_SECRET_CODE_PROFILE_PREF,
    GEOAPP_CHAT_PROMPT_PACK_PREF,
    GEOAPP_CHAT_SKILL_PACK_PREF,
    GEOAPP_CHAT_SKILL_POLICY_OVERRIDES_PREF,
    GEOAPP_CHAT_TOOL_POLICY_OVERRIDES_PREF,
} from './geoapp-chat-shared';
import { GeoAppChatSkillExport, GeoAppChatSkillStateService } from './geoapp-chat-skill-state-service';
import { GeoAppChatSkills } from './geoapp-chat-skills';
import { GeoAppChatPromptVariantByPack, GeoAppChatSystemPromptVariants } from './geoapp-chat-system-prompts';

export const GEOAPP_CHAT_POLICY_DEFAULTS: Record<string, unknown> = {
    [GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF]: 'guided',
    [GEOAPP_CHAT_BEHAVIOR_SECRET_CODE_PROFILE_PREF]: 'default',
    [GEOAPP_CHAT_BEHAVIOR_FORMULA_PROFILE_PREF]: 'default',
    [GEOAPP_CHAT_BEHAVIOR_CHECKER_PROFILE_PREF]: 'default',
    [GEOAPP_CHAT_BEHAVIOR_HIDDEN_CONTENT_PROFILE_PREF]: 'default',
    [GEOAPP_CHAT_BEHAVIOR_IMAGE_PUZZLE_PROFILE_PREF]: 'default',
    [GEOAPP_CHAT_PROMPT_PACK_PREF]: 'guided',
    [GEOAPP_CHAT_SKILL_PACK_PREF]: 'workflow',
    [GEOAPP_CHAT_SKILL_POLICY_OVERRIDES_PREF]: {},
    [GEOAPP_CHAT_TOOL_POLICY_OVERRIDES_PREF]: {},
};

export interface GeoAppChatPromptPackExport {
    pack: string;
    variantId: string;
    name: string;
    description?: string;
    template: string;
    isCustomized: boolean;
}

export interface GeoAppChatConfigurationExport {
    type: 'geoapp-chat-configuration';
    version: 3;
    exportedAt: string;
    policy: Record<string, unknown>;
    promptPacks: GeoAppChatPromptPackExport[];
    skills: GeoAppChatSkillExport[];
}

export interface GeoAppChatConfigurationImportOptions {
    confirmPromptPacks?: (count: number) => boolean;
    confirmSkills?: (count: number) => boolean;
    confirmOverwriteSkill?: (skillName: string) => boolean;
}

export interface GeoAppChatConfigurationImportResult {
    importedPolicyCount: number;
    importedPromptCount: number;
    importedSkillCount: number;
    promptCustomizationUnavailable: boolean;
}

@injectable()
export class GeoAppChatConfigurationService {

    @inject(PreferenceService)
    protected readonly preferenceService!: PreferenceService;

    @inject(GeoAppChatSkillStateService)
    protected readonly skillStateService!: GeoAppChatSkillStateService;

    @inject(PromptService) @optional()
    protected readonly promptService: PromptService | undefined;

    @inject(PromptFragmentCustomizationService) @optional()
    protected readonly promptCustomizationService: PromptFragmentCustomizationService | undefined;

    async getFullConfigurationExport(): Promise<GeoAppChatConfigurationExport> {
        return {
            type: 'geoapp-chat-configuration',
            version: 3,
            exportedAt: new Date().toISOString(),
            policy: this.getPolicyConfiguration(),
            promptPacks: this.getPromptPackExports(),
            skills: await this.skillStateService.getSkillExports(),
        };
    }

    async importConfiguration(serialized: string, options: GeoAppChatConfigurationImportOptions = {}): Promise<GeoAppChatConfigurationImportResult> {
        const parsed = JSON.parse(serialized);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Invalid configuration shape');
        }

        const record = parsed as Record<string, unknown>;
        const policyRecord = this.getPolicyImportRecord(record);
        const importedPolicyCount = await this.importPolicyPreferences(policyRecord);
        const promptResult = await this.importPromptPackCustomizationsFromConfiguration(record, options);
        const importedSkillCount = await this.importCustomSkillsFromConfiguration(record, options);
        return {
            importedPolicyCount,
            importedPromptCount: promptResult.importedCount,
            importedSkillCount,
            promptCustomizationUnavailable: promptResult.unavailable,
        };
    }

    getPolicyConfiguration(): Record<string, unknown> {
        const config: Record<string, unknown> = {};
        for (const [key, defaultValue] of Object.entries(GEOAPP_CHAT_POLICY_DEFAULTS)) {
            config[key] = this.preferenceService.get(key, defaultValue);
        }
        return config;
    }

    protected getPromptPackExports(): GeoAppChatPromptPackExport[] {
        return Object.entries(GeoAppChatPromptVariantByPack).map(([pack, variantId]) => {
            const fragment = this.promptService?.getPromptFragment(variantId);
            const builtIn = this.getBuiltInPromptVariant(variantId);
            return {
                pack,
                variantId,
                name: fragment?.name || builtIn?.name || variantId,
                description: fragment?.description || builtIn?.description,
                template: fragment?.template || builtIn?.template || '',
                isCustomized: Boolean(fragment && isCustomizedPromptFragment(fragment)),
            };
        });
    }

    protected getBuiltInPromptVariant(variantId: string): PromptFragment | undefined {
        if (GeoAppChatSystemPromptVariants.defaultVariant.id === variantId) {
            return GeoAppChatSystemPromptVariants.defaultVariant;
        }
        return GeoAppChatSystemPromptVariants.variants?.find(variant => variant.id === variantId);
    }

    protected getPolicyImportRecord(record: Record<string, unknown>): Record<string, unknown> {
        if (
            record.type === 'geoapp-chat-configuration' &&
            record.policy &&
            typeof record.policy === 'object' &&
            !Array.isArray(record.policy)
        ) {
            return record.policy as Record<string, unknown>;
        }
        return record;
    }

    protected async importPolicyPreferences(record: Record<string, unknown>): Promise<number> {
        const updates: Array<Promise<void>> = [];
        for (const key of Object.keys(GEOAPP_CHAT_POLICY_DEFAULTS)) {
            if (Object.prototype.hasOwnProperty.call(record, key)) {
                updates.push(this.preferenceService.set(key, record[key], PreferenceScope.User));
            }
        }
        await Promise.all(updates);
        return updates.length;
    }

    protected async importPromptPackCustomizationsFromConfiguration(
        record: Record<string, unknown>,
        options: GeoAppChatConfigurationImportOptions
    ): Promise<{ importedCount: number; unavailable: boolean }> {
        if (record.type !== 'geoapp-chat-configuration' || !Array.isArray(record.promptPacks)) {
            return { importedCount: 0, unavailable: false };
        }
        const promptPacks = this.getPromptPackImports(record.promptPacks);
        const customizedPromptPacks = promptPacks.filter(promptPack => promptPack.isCustomized);
        if (!customizedPromptPacks.length) {
            return { importedCount: 0, unavailable: false };
        }
        if (!this.promptCustomizationService) {
            return { importedCount: 0, unavailable: true };
        }
        if (options.confirmPromptPacks && !options.confirmPromptPacks(customizedPromptPacks.length)) {
            return { importedCount: 0, unavailable: false };
        }

        let importedCount = 0;
        const knownVariantIds = new Set<string>(Object.values(GeoAppChatPromptVariantByPack));
        for (const promptPack of customizedPromptPacks) {
            if (!knownVariantIds.has(promptPack.variantId) || !promptPack.template.trim()) {
                continue;
            }
            await this.promptCustomizationService.removeAllPromptFragmentCustomizations(promptPack.variantId);
            await this.promptCustomizationService.createBuiltInPromptFragmentCustomization(promptPack.variantId, promptPack.template);
            importedCount++;
        }
        return { importedCount, unavailable: false };
    }

    protected getPromptPackImports(value: unknown[]): GeoAppChatPromptPackExport[] {
        const imports: GeoAppChatPromptPackExport[] = [];
        for (const item of value) {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                continue;
            }
            const record = item as Record<string, unknown>;
            if (typeof record.variantId !== 'string' || typeof record.template !== 'string') {
                continue;
            }
            imports.push({
                pack: typeof record.pack === 'string' ? record.pack : record.variantId,
                variantId: record.variantId,
                name: typeof record.name === 'string' ? record.name : record.variantId,
                description: typeof record.description === 'string' ? record.description : undefined,
                template: record.template,
                isCustomized: record.isCustomized === true,
            });
        }
        return imports;
    }

    protected async importCustomSkillsFromConfiguration(
        record: Record<string, unknown>,
        options: GeoAppChatConfigurationImportOptions
    ): Promise<number> {
        if (record.type !== 'geoapp-chat-configuration' || !Array.isArray(record.skills)) {
            return 0;
        }
        const skills = this.getCustomSkillImports(record.skills);
        if (!skills.length) {
            return 0;
        }
        if (options.confirmSkills && !options.confirmSkills(skills.length)) {
            return 0;
        }

        let importedCount = 0;
        const currentStates = await this.skillStateService.getSkillStates();
        for (const skill of skills) {
            const currentState = currentStates.get(skill.name);
            if (
                currentState?.status === 'customized' &&
                options.confirmOverwriteSkill &&
                !options.confirmOverwriteSkill(skill.name)
            ) {
                continue;
            }
            const imported = await this.skillStateService.importCustomSkillContent(skill.name, skill.content);
            if (imported) {
                importedCount++;
            }
        }
        return importedCount;
    }

    protected getCustomSkillImports(value: unknown[]): Array<{ name: string; content: string }> {
        const knownSkillNames = new Set<string>(GeoAppChatSkills.map(skill => skill.name));
        const imports: Array<{ name: string; content: string }> = [];
        for (const item of value) {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                continue;
            }
            const record = item as Record<string, unknown>;
            if (
                record.isCustomized === true &&
                typeof record.name === 'string' &&
                knownSkillNames.has(record.name) &&
                typeof record.content === 'string' &&
                record.content.trim()
            ) {
                imports.push({ name: record.name, content: record.content });
            }
        }
        return imports;
    }
}
