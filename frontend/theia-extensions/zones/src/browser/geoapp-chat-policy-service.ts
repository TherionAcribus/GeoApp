import { inject, injectable } from '@theia/core/shared/inversify';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { MutableChatRequestModel } from '@theia/ai-chat/lib/common/chat-model';
import { ToolRequest } from '@theia/ai-core';

import {
    GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_CHECKER_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_FORMULA_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_HIDDEN_CONTENT_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_IMAGE_PUZZLE_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_SECRET_CODE_PROFILE_PREF,
    GEOAPP_CHAT_PROMPT_PACK_PREF,
    GEOAPP_CHAT_TOOL_POLICY_OVERRIDES_PREF,
    GeoAppChatBehaviorProfile,
    GeoAppChatSessionKind,
    GeoAppChatWorkflowKind,
    normalizeGeoAppChatBehaviorProfile,
    resolveGeoAppChatBehaviorProfileForWorkflow,
} from './geoapp-chat-shared';
import { GeoAppAiToolCatalog, GeoAppAiToolCatalogEntry } from './geoapp-chat-tool-catalog';
import { GeoAppChatSkillName, getRecommendedGeoAppChatSkillNames } from './geoapp-chat-skills';

export type GeoAppChatToolOverride = 'default' | 'enabled' | 'disabled' | 'confirm';

export interface GeoAppChatPolicy {
    behaviorProfile: GeoAppChatBehaviorProfile;
    promptPack: GeoAppChatBehaviorProfile;
    workflowKind?: GeoAppChatWorkflowKind;
    sessionKind?: GeoAppChatSessionKind;
    enabledToolIds: Set<string>;
    confirmToolIds: Set<string>;
    disabledToolIds: Set<string>;
    entries: GeoAppAiToolCatalogEntry[];
    recommendedSkillNames: GeoAppChatSkillName[];
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
        const overrides = this.readToolOverrides();
        const entries = this.catalog.getEntries();
        const enabledToolIds = new Set<string>();
        const confirmToolIds = new Set<string>();
        const disabledToolIds = new Set<string>();

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

        return {
            behaviorProfile,
            promptPack,
            workflowKind,
            sessionKind: metadata.sessionKind,
            enabledToolIds,
            confirmToolIds,
            disabledToolIds,
            entries,
            recommendedSkillNames: getRecommendedGeoAppChatSkillNames(workflowKind),
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
            policy.workflowKind ? `- Workflow : ${policy.workflowKind}` : undefined,
            policy.sessionKind ? `- Session : ${policy.sessionKind}` : undefined,
            '',
            policy.recommendedSkillNames.length
                ? `Skills GeoApp recommandes : ${policy.recommendedSkillNames.join(', ')}`
                : undefined,
            policy.recommendedSkillNames.length
                ? 'Charge les skills recommandes avec getSkillFileContent avant d appliquer leurs strategies detaillees, si le tool est disponible.'
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

    protected readGeoAppSessionMetadata(request?: MutableChatRequestModel): {
        workflowKind?: GeoAppChatWorkflowKind;
        sessionKind?: GeoAppChatSessionKind;
        preferredBehaviorProfile?: GeoAppChatBehaviorProfile | 'default';
    } {
        const commonSettings = request?.session?.settings?.commonSettings as GeoAppChatSessionCommonSettings | undefined;
        return commonSettings?.geoapp || {};
    }
}
