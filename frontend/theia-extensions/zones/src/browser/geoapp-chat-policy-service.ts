import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { MutableChatRequestModel } from '@theia/ai-chat/lib/common/chat-model';
import { AIVariableContext, ToolRequest } from '@theia/ai-core';
import { PromptService } from '@theia/ai-core/lib/common/prompt-service';

import {
    GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_CHECKER_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_FORMULA_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_HIDDEN_CONTENT_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_IMAGE_PUZZLE_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_SECRET_CODE_PROFILE_PREF,
    GEOAPP_CHAT_PROMPT_PACK_PREF,
    GEOAPP_CHAT_SKILL_PACK_PREF,
    GEOAPP_CHAT_SKILL_POLICY_OVERRIDES_PREF,
    GEOAPP_CHAT_TOOL_POLICY_OVERRIDES_PREF,
    GeoAppChatBehaviorProfile,
    GeoAppChatSkillPack,
    GeoAppChatSessionKind,
    GeoAppChatWorkflowKind,
    normalizeGeoAppChatBehaviorProfile,
    resolveGeoAppChatBehaviorProfileForWorkflow,
} from './geoapp-chat-shared';
import { GeoAppAiToolCatalog, GeoAppAiToolCatalogEntry, getStaticGeoAppToolMetadata } from './geoapp-chat-tool-catalog';
import {
    GeoAppChatSkillMetadata,
    GeoAppChatSkillName,
    GeoAppChatSkills,
    getRecommendedGeoAppChatSkillNames,
    normalizeGeoAppChatSkillPack,
} from './geoapp-chat-skills';
import {
    GEOAPP_CHAT_SYSTEM_PROMPT_ID,
    GeoAppChatPromptVariantByPack,
} from './geoapp-chat-system-prompts';

export type GeoAppChatToolOverride = 'default' | 'enabled' | 'disabled' | 'confirm';
export type GeoAppChatSkillOverride = 'default' | 'enabled' | 'disabled';
export type GeoAppChatPolicyDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface GeoAppChatPolicyDiagnostic {
    severity: GeoAppChatPolicyDiagnosticSeverity;
    title: string;
    message: string;
    details?: string[];
}

export interface GeoAppChatPolicy {
    behaviorProfile: GeoAppChatBehaviorProfile;
    promptPack: GeoAppChatBehaviorProfile;
    workflowKind?: GeoAppChatWorkflowKind;
    sessionKind?: GeoAppChatSessionKind;
    enabledToolIds: Set<string>;
    confirmToolIds: Set<string>;
    disabledToolIds: Set<string>;
    entries: GeoAppAiToolCatalogEntry[];
    skillPack: GeoAppChatSkillPack;
    skillEntries: GeoAppChatSkillMetadata[];
    recommendedSkillNames: GeoAppChatSkillName[];
    disabledSkillNames: Set<GeoAppChatSkillName>;
}

export interface GeoAppChatSystemPromptPreview {
    promptVariantId: string;
    isPromptVariantCustomized: boolean;
    resolvedPromptText: string;
    policyPromptText: string;
    finalPromptText: string;
    functionToolNames: string[];
    diagnostics: GeoAppChatPolicyDiagnostic[];
}

export interface GeoAppChatRuntimeDiagnosticOptions {
    skillServiceAvailable?: boolean;
    discoveredSkillNames?: string[];
}

interface GeoAppChatSessionCommonSettings {
    geoapp?: {
        workflowKind?: GeoAppChatWorkflowKind;
        sessionKind?: GeoAppChatSessionKind;
        preferredBehaviorProfile?: GeoAppChatBehaviorProfile | 'default';
    };
}

@injectable()
export class GeoAppChatPolicyService {

    @inject(GeoAppAiToolCatalog)
    protected readonly catalog!: GeoAppAiToolCatalog;

    @inject(PreferenceService)
    protected readonly preferenceService!: PreferenceService;

    @inject(PromptService) @optional()
    protected readonly promptService: PromptService | undefined;

    resolvePolicy(request?: MutableChatRequestModel): GeoAppChatPolicy {
        const metadata = this.readGeoAppSessionMetadata(request);
        const workflowKind = metadata.workflowKind;
        const behaviorProfile = resolveGeoAppChatBehaviorProfileForWorkflow(
            workflowKind,
            metadata.preferredBehaviorProfile,
            this.readBehaviorPreferences()
        );
        const promptPack = normalizeGeoAppChatBehaviorProfile(
            this.preferenceService.get(GEOAPP_CHAT_PROMPT_PACK_PREF, behaviorProfile)
        ) || behaviorProfile;
        const skillPack = normalizeGeoAppChatSkillPack(
            this.preferenceService.get(GEOAPP_CHAT_SKILL_PACK_PREF, 'workflow')
        ) || 'workflow';
        const overrides = this.readToolOverrides();
        const skillOverrides = this.readSkillOverrides();
        const entries = this.catalog.getEntries();
        const enabledToolIds = new Set<string>();
        const confirmToolIds = new Set<string>();
        const disabledToolIds = new Set<string>();
        const baseSkillNames = getRecommendedGeoAppChatSkillNames(workflowKind, skillPack);
        const baseSkillNameSet = new Set(baseSkillNames);
        const recommendedSkillNames: GeoAppChatSkillName[] = [];
        const disabledSkillNames = new Set<GeoAppChatSkillName>();

        for (const entry of entries) {
            const profileDecision = this.getProfileDecision(entry, behaviorProfile);
            const override = overrides[entry.registryId] || overrides[entry.publicName];
            const decision = this.applyOverride(profileDecision, override);

            if (decision.enabled) {
                enabledToolIds.add(entry.registryId);
            } else {
                disabledToolIds.add(entry.registryId);
            }

            if (decision.confirm) {
                confirmToolIds.add(entry.registryId);
            }
        }

        const orderedSkillNames = [
            ...baseSkillNames,
            ...GeoAppChatSkills
                .map(skill => skill.name)
                .filter(name => !baseSkillNameSet.has(name) && skillOverrides[name] === 'enabled'),
        ];
        for (const skillName of orderedSkillNames) {
            if (skillOverrides[skillName] !== 'disabled') {
                recommendedSkillNames.push(skillName);
            }
        }
        const recommendedSkillNameSet = new Set(recommendedSkillNames);
        for (const skill of GeoAppChatSkills) {
            if (!recommendedSkillNameSet.has(skill.name)) {
                disabledSkillNames.add(skill.name);
            }
        }

        return {
            behaviorProfile,
            promptPack,
            workflowKind,
            sessionKind: metadata.sessionKind,
            enabledToolIds,
            confirmToolIds,
            disabledToolIds,
            entries,
            skillPack,
            skillEntries: GeoAppChatSkills,
            recommendedSkillNames,
            disabledSkillNames,
        };
    }

    getManagedToolRequests(policy: GeoAppChatPolicy): ToolRequest[] {
        return policy.entries
            .filter(entry => policy.enabledToolIds.has(entry.registryId))
            .map(entry => this.toPolicyToolRequest(entry, policy));
    }

    filterNonManagedToolRequests(toolRequests: ToolRequest[]): ToolRequest[] {
        return toolRequests.filter(tool => !this.catalog.isGeoAppManagedTool(tool));
    }

    describePolicyForPrompt(policy: GeoAppChatPolicy): string {
        const enabled = policy.entries.filter(entry => policy.enabledToolIds.has(entry.registryId));
        const byCategory = new Map<string, string[]>();
        for (const entry of enabled) {
            const current = byCategory.get(entry.category) || [];
            current.push(`~${entry.publicName}`);
            byCategory.set(entry.category, current);
        }

        const lines = [
            'Politique GeoApp active :',
            `- Profil comportemental : ${policy.behaviorProfile}`,
            `- Prompt pack : ${policy.promptPack}`,
            `- Skill pack : ${policy.skillPack}`,
            policy.workflowKind ? `- Workflow : ${policy.workflowKind}` : undefined,
            policy.sessionKind ? `- Session : ${policy.sessionKind}` : undefined,
            '',
            policy.recommendedSkillNames.length
                ? `Skills GeoApp actifs : ${policy.recommendedSkillNames.join(', ')}`
                : undefined,
            policy.recommendedSkillNames.length
                ? 'Charge les skills actifs avec getSkillFileContent avant d appliquer leurs strategies detaillees, si le tool est disponible.'
                : undefined,
            '',
            'Tools exposes au modele :',
            ...Array.from(byCategory.entries()).map(([category, names]) => `- ${category}: ${names.sort().join(', ')}`),
        ].filter((line): line is string => Boolean(line));

        if (policy.confirmToolIds.size > 0) {
            const names = policy.entries
                .filter(entry => policy.confirmToolIds.has(entry.registryId))
                .map(entry => `~${entry.publicName}`)
                .sort();
            lines.push('', `Tools sensibles avec confirmation Theia : ${names.join(', ')}`);
        }

        return lines.join('\n');
    }

    async resolveSystemPromptPreview(
        policy: GeoAppChatPolicy,
        context?: AIVariableContext,
        diagnosticOptions?: GeoAppChatRuntimeDiagnosticOptions
    ): Promise<GeoAppChatSystemPromptPreview> {
        const promptVariantId = GeoAppChatPromptVariantByPack[policy.promptPack] || GeoAppChatPromptVariantByPack.guided;
        const policyPromptText = this.describePolicyForPrompt(policy);
        const diagnostics = this.getRuntimeDiagnostics(policy, diagnosticOptions);
        const emptyPreview: GeoAppChatSystemPromptPreview = {
            promptVariantId,
            isPromptVariantCustomized: false,
            resolvedPromptText: '',
            policyPromptText,
            finalPromptText: policyPromptText,
            functionToolNames: [],
            diagnostics,
        };

        if (!this.promptService) {
            diagnostics.push({
                severity: 'error',
                title: 'PromptService indisponible',
                message: "GeoApp ne peut pas résoudre le prompt système final car le service de prompts Theia n'est pas disponible.",
            });
            return emptyPreview;
        }

        const resolvedPrompt = await this.promptService.getResolvedPromptFragment(promptVariantId, undefined, context);
        const variantInfo = this.promptService.getPromptVariantInfo(GEOAPP_CHAT_SYSTEM_PROMPT_ID, promptVariantId);
        if (!resolvedPrompt) {
            diagnostics.push({
                severity: 'error',
                title: 'Prompt pack introuvable',
                message: `Le prompt pack ${promptVariantId} n'a pas pu être résolu par Theia.`,
            });
            return {
                ...emptyPreview,
                isPromptVariantCustomized: variantInfo?.isCustomized ?? false,
            };
        }

        const functionToolNames = Array.from(resolvedPrompt.functionDescriptions?.values() || [])
            .map(tool => tool.name || tool.id)
            .sort();
        return {
            promptVariantId: variantInfo?.variantId || promptVariantId,
            isPromptVariantCustomized: variantInfo?.isCustomized ?? false,
            resolvedPromptText: resolvedPrompt.text,
            policyPromptText,
            finalPromptText: [resolvedPrompt.text, '', policyPromptText].join('\n'),
            functionToolNames,
            diagnostics,
        };
    }

    getRuntimeDiagnostics(policy: GeoAppChatPolicy, options?: GeoAppChatRuntimeDiagnosticOptions): GeoAppChatPolicyDiagnostic[] {
        const diagnostics: GeoAppChatPolicyDiagnostic[] = [];
        const registeredEntries = new Set(policy.entries.map(entry => entry.registryId));
        const missingStaticTools = getStaticGeoAppToolMetadata()
            .filter(metadata => !registeredEntries.has(metadata.registryId))
            .map(metadata => metadata.registryId)
            .sort();

        if (missingStaticTools.length) {
            diagnostics.push({
                severity: 'warning',
                title: 'Tools GeoApp attendus non enregistrés',
                message: "Certains tools connus de GeoApp ne sont pas actuellement enregistrés dans Theia. L'IA ne pourra pas les utiliser.",
                details: missingStaticTools,
            });
        }

        if (!this.catalog.hasRegisteredTool('getSkillFileContent')) {
            diagnostics.push({
                severity: 'warning',
                title: 'Tool getSkillFileContent absent',
                message: "Le prompt demande de charger les skills avec getSkillFileContent, mais ce tool n'est pas enregistré dans Theia.",
            });
        }

        const discoveredSkillNames = options?.discoveredSkillNames;
        const discoveredSkills = new Set(discoveredSkillNames || []);
        if (options?.skillServiceAvailable === false) {
            diagnostics.push({
                severity: 'warning',
                title: 'SkillService indisponible',
                message: "GeoApp ne peut pas vérifier si les skills ont été découvertes par Theia.",
            });
        } else if (discoveredSkillNames) {
            const missingSkills = policy.recommendedSkillNames
                .filter(skillName => !discoveredSkills.has(skillName))
                .sort();
            if (missingSkills.length) {
                diagnostics.push({
                    severity: 'warning',
                    title: 'Skills GeoApp actives non découvertes',
                    message: "Ces skills sont recommandées par la policy, mais Theia ne les expose pas encore au chat.",
                    details: missingSkills,
                });
            }
        }

        const activeSkills = policy.skillEntries.filter(skill => policy.recommendedSkillNames.includes(skill.name));
        const missingRecommendedTools = new Set<string>();
        const blockedRecommendedTools = new Set<string>();
        for (const skill of activeSkills) {
            for (const toolId of skill.toolRegistryIds) {
                if (!this.catalog.hasRegisteredTool(toolId)) {
                    missingRecommendedTools.add(`${skill.name}: ${toolId}`);
                } else if (!policy.enabledToolIds.has(toolId)) {
                    blockedRecommendedTools.add(`${skill.name}: ${toolId}`);
                }
            }
        }

        if (missingRecommendedTools.size) {
            diagnostics.push({
                severity: 'warning',
                title: 'Tools recommandés par skill absents',
                message: "Une ou plusieurs skills actives recommandent des tools qui ne sont pas enregistrés dans Theia.",
                details: Array.from(missingRecommendedTools).sort(),
            });
        }

        if (blockedRecommendedTools.size) {
            diagnostics.push({
                severity: 'info',
                title: 'Tools recommandés par skill bloqués',
                message: "Une ou plusieurs skills actives recommandent des tools bloqués par la policy actuelle.",
                details: Array.from(blockedRecommendedTools).sort(),
            });
        }

        return diagnostics;
    }

    protected toPolicyToolRequest(entry: GeoAppAiToolCatalogEntry, policy: GeoAppChatPolicy): ToolRequest {
        const confirm = policy.confirmToolIds.has(entry.registryId);
        const warning = this.getConfirmationWarning(entry);
        return {
            ...entry.tool,
            id: entry.publicName,
            confirmAlwaysAllow: confirm ? warning : entry.tool.confirmAlwaysAllow,
        };
    }

    protected getConfirmationWarning(entry: GeoAppAiToolCatalogEntry): string {
        if (entry.writesLocal) {
            return `Le tool ${entry.publicName} peut modifier des donnees locales GeoApp. Activez l'autorisation permanente seulement si vous faites confiance a ce workflow.`;
        }
        if (entry.requiresAuth) {
            return `Le tool ${entry.publicName} peut utiliser une session authentifiee. Activez l'autorisation permanente seulement si vous acceptez ce niveau d'automatisation.`;
        }
        if (entry.network) {
            return `Le tool ${entry.publicName} peut utiliser le reseau ou un service externe. Activez l'autorisation permanente seulement si ce comportement est voulu.`;
        }
        return `Le tool ${entry.publicName} est marque sensible par GeoApp.`;
    }

    protected getProfileDecision(
        entry: GeoAppAiToolCatalogEntry,
        profile: GeoAppChatBehaviorProfile
    ): { enabled: boolean; confirm: boolean } {
        if (profile === 'debug') {
            return { enabled: true, confirm: entry.risk !== 'read_only' };
        }

        if (profile === 'automation') {
            return { enabled: entry.defaultEnabled, confirm: false };
        }

        if (profile === 'offline') {
            const enabled = entry.defaultEnabled && !entry.network && !entry.requiresAuth && entry.risk !== 'network' && entry.risk !== 'auth' && entry.risk !== 'high';
            return { enabled, confirm: false };
        }

        if (profile === 'safe') {
            const enabled = entry.defaultEnabled && !entry.requiresAuth && entry.risk !== 'high' && entry.risk !== 'network';
            return { enabled, confirm: entry.writesLocal === true };
        }

        return {
            enabled: entry.defaultEnabled,
            confirm: entry.risk !== 'read_only' || entry.network === true || entry.writesLocal === true || entry.requiresAuth === true,
        };
    }

    protected applyOverride(
        decision: { enabled: boolean; confirm: boolean },
        override: unknown
    ): { enabled: boolean; confirm: boolean } {
        if (override === true || override === 'enabled') {
            return { enabled: true, confirm: decision.confirm };
        }
        if (override === false || override === 'disabled') {
            return { enabled: false, confirm: false };
        }
        if (override === 'confirm') {
            return { enabled: true, confirm: true };
        }
        return decision;
    }

    protected readBehaviorPreferences(): Record<string, unknown> {
        return {
            [GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF]: this.preferenceService.get(GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF, 'guided'),
            [GEOAPP_CHAT_BEHAVIOR_SECRET_CODE_PROFILE_PREF]: this.preferenceService.get(GEOAPP_CHAT_BEHAVIOR_SECRET_CODE_PROFILE_PREF, 'default'),
            [GEOAPP_CHAT_BEHAVIOR_FORMULA_PROFILE_PREF]: this.preferenceService.get(GEOAPP_CHAT_BEHAVIOR_FORMULA_PROFILE_PREF, 'default'),
            [GEOAPP_CHAT_BEHAVIOR_CHECKER_PROFILE_PREF]: this.preferenceService.get(GEOAPP_CHAT_BEHAVIOR_CHECKER_PROFILE_PREF, 'default'),
            [GEOAPP_CHAT_BEHAVIOR_HIDDEN_CONTENT_PROFILE_PREF]: this.preferenceService.get(GEOAPP_CHAT_BEHAVIOR_HIDDEN_CONTENT_PROFILE_PREF, 'default'),
            [GEOAPP_CHAT_BEHAVIOR_IMAGE_PUZZLE_PROFILE_PREF]: this.preferenceService.get(GEOAPP_CHAT_BEHAVIOR_IMAGE_PUZZLE_PROFILE_PREF, 'default'),
        };
    }

    protected readToolOverrides(): Record<string, GeoAppChatToolOverride | boolean> {
        const raw = this.preferenceService.get(GEOAPP_CHAT_TOOL_POLICY_OVERRIDES_PREF, {});
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            return raw as Record<string, GeoAppChatToolOverride | boolean>;
        }
        if (typeof raw === 'string' && raw.trim()) {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    return parsed as Record<string, GeoAppChatToolOverride | boolean>;
                }
            } catch {
                return {};
            }
        }
        return {};
    }

    protected readSkillOverrides(): Record<string, GeoAppChatSkillOverride | boolean> {
        const raw = this.preferenceService.get(GEOAPP_CHAT_SKILL_POLICY_OVERRIDES_PREF, {});
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            return raw as Record<string, GeoAppChatSkillOverride | boolean>;
        }
        if (typeof raw === 'string' && raw.trim()) {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    return parsed as Record<string, GeoAppChatSkillOverride | boolean>;
                }
            } catch {
                return {};
            }
        }
        return {};
    }

    protected readGeoAppSessionMetadata(request?: MutableChatRequestModel): {
        workflowKind?: GeoAppChatWorkflowKind;
        sessionKind?: GeoAppChatSessionKind;
        preferredBehaviorProfile?: GeoAppChatBehaviorProfile | 'default';
    } {
        const commonSettings = request?.session?.settings?.commonSettings as GeoAppChatSessionCommonSettings | undefined;
        return commonSettings?.geoapp || {};
    }
}
