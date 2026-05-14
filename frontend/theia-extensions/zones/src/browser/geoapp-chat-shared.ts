export const GeoAppChatAgentId = 'GeoApp';
export const GeoAppChatLocalAgentId = 'geoapp-chat-local';
export const GeoAppChatFastAgentId = 'geoapp-chat-fast';
export const GeoAppChatStrongAgentId = 'geoapp-chat-strong';
export const GeoAppChatWebAgentId = 'geoapp-chat-web';

export const GEOAPP_CHAT_DEFAULT_PROFILE_PREF = 'geoApp.chat.defaultProfile';
export const GEOAPP_CHAT_SECRET_CODE_PROFILE_PREF = 'geoApp.chat.workflowProfile.secretCode';
export const GEOAPP_CHAT_FORMULA_PROFILE_PREF = 'geoApp.chat.workflowProfile.formula';
export const GEOAPP_CHAT_CHECKER_PROFILE_PREF = 'geoApp.chat.workflowProfile.checker';
export const GEOAPP_CHAT_HIDDEN_CONTENT_PROFILE_PREF = 'geoApp.chat.workflowProfile.hiddenContent';
export const GEOAPP_CHAT_IMAGE_PUZZLE_PROFILE_PREF = 'geoApp.chat.workflowProfile.imagePuzzle';
export const GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF = 'geoApp.chat.behaviorProfile.default';
export const GEOAPP_CHAT_BEHAVIOR_SECRET_CODE_PROFILE_PREF = 'geoApp.chat.behaviorProfile.workflow.secretCode';
export const GEOAPP_CHAT_BEHAVIOR_FORMULA_PROFILE_PREF = 'geoApp.chat.behaviorProfile.workflow.formula';
export const GEOAPP_CHAT_BEHAVIOR_CHECKER_PROFILE_PREF = 'geoApp.chat.behaviorProfile.workflow.checker';
export const GEOAPP_CHAT_BEHAVIOR_HIDDEN_CONTENT_PROFILE_PREF = 'geoApp.chat.behaviorProfile.workflow.hiddenContent';
export const GEOAPP_CHAT_BEHAVIOR_IMAGE_PUZZLE_PROFILE_PREF = 'geoApp.chat.behaviorProfile.workflow.imagePuzzle';
export const GEOAPP_CHAT_PROMPT_PACK_PREF = 'geoApp.chat.promptPack';
export const GEOAPP_CHAT_TOOL_POLICY_OVERRIDES_PREF = 'geoApp.chat.toolPolicy.overrides';

export type GeoAppChatProfile = 'local' | 'fast' | 'strong' | 'web';
export type GeoAppChatWorkflowProfile = 'default' | GeoAppChatProfile;
export type GeoAppChatWorkflowKind = 'general' | 'secret_code' | 'formula' | 'checker' | 'hidden_content' | 'image_puzzle';
export type GeoAppChatBehaviorProfile = 'guided' | 'safe' | 'offline' | 'automation' | 'debug';
export type GeoAppChatWorkflowBehaviorProfile = 'default' | GeoAppChatBehaviorProfile;
export type GeoAppChatSessionKind = 'auto' | 'libre';

export const GeoAppChatAgentIdsByProfile: Record<GeoAppChatProfile, string> = {
    local: GeoAppChatLocalAgentId,
    fast: GeoAppChatFastAgentId,
    strong: GeoAppChatStrongAgentId,
    web: GeoAppChatWebAgentId,
};

export interface GeoAppChatPreferenceValues {
    [GEOAPP_CHAT_DEFAULT_PROFILE_PREF]?: unknown;
    [GEOAPP_CHAT_SECRET_CODE_PROFILE_PREF]?: unknown;
    [GEOAPP_CHAT_FORMULA_PROFILE_PREF]?: unknown;
    [GEOAPP_CHAT_CHECKER_PROFILE_PREF]?: unknown;
    [GEOAPP_CHAT_HIDDEN_CONTENT_PROFILE_PREF]?: unknown;
    [GEOAPP_CHAT_IMAGE_PUZZLE_PROFILE_PREF]?: unknown;
}

export interface GeoAppChatBehaviorPreferenceValues {
    [GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF]?: unknown;
    [GEOAPP_CHAT_BEHAVIOR_SECRET_CODE_PROFILE_PREF]?: unknown;
    [GEOAPP_CHAT_BEHAVIOR_FORMULA_PROFILE_PREF]?: unknown;
    [GEOAPP_CHAT_BEHAVIOR_CHECKER_PROFILE_PREF]?: unknown;
    [GEOAPP_CHAT_BEHAVIOR_HIDDEN_CONTENT_PROFILE_PREF]?: unknown;
    [GEOAPP_CHAT_BEHAVIOR_IMAGE_PUZZLE_PROFILE_PREF]?: unknown;
}

export interface GeoAppAgentLike {
    id?: string;
    name?: string;
}

export interface GeoAppListingClassificationPreview {
    labels?: Array<{ name: string; confidence?: number }>;
}

export interface GeoAppWorkflowResolutionPreview {
    workflow?: { kind?: string };
    classification?: GeoAppListingClassificationPreview;
}

export interface GeoAppOpenChatRequestDetailPayload {
    geocacheId?: number;
    gcCode?: string;
    geocacheName?: string;
    sessionTitle?: string;
    prompt?: string;
    imageUrls?: string[];
    focus?: boolean;
    workflowKind?: GeoAppChatWorkflowKind | string;
    preferredProfile?: GeoAppChatWorkflowProfile | string;
    preferredBehaviorProfile?: GeoAppChatWorkflowBehaviorProfile | string;
    resumeState?: Record<string, unknown>;
    sessionKind?: GeoAppChatSessionKind;
}

export const GEOAPP_OPEN_CHAT_REQUEST_EVENT = 'geoapp-open-chat-request';

export interface GeoAppOpenChatEventTarget {
    dispatchEvent(event: unknown): boolean | void;
}

export type GeoAppCustomEventConstructor = new <T>(type: string, init: { detail: T }) => {
    type: string;
    detail: T;
};

const GEOAPP_SESSION_SETTING_KEYS = new Set([
    'geoappWorkflowKind',
    'geoappPreferredProfile',
    'geoappResumeState',
    'geoappGcCode',
    'geoappGeocacheId',
    'geoappSessionKind',
    'geoappBehaviorProfile',
]);

export function normalizeGeoAppChatWorkflowKind(value?: string): GeoAppChatWorkflowKind | undefined {
    if (
        value === 'general' ||
        value === 'secret_code' ||
        value === 'formula' ||
        value === 'checker' ||
        value === 'hidden_content' ||
        value === 'image_puzzle'
    ) {
        return value;
    }
    return undefined;
}

export function normalizeGeoAppChatProfile(value?: unknown): GeoAppChatProfile | undefined {
    if (value === 'local' || value === 'fast' || value === 'strong' || value === 'web') {
        return value;
    }
    return undefined;
}

export function normalizeGeoAppChatWorkflowProfile(value?: unknown): GeoAppChatWorkflowProfile | undefined {
    if (value === 'default' || value === 'local' || value === 'fast' || value === 'strong' || value === 'web') {
        return value;
    }
    return undefined;
}

export function normalizeGeoAppChatBehaviorProfile(value?: unknown): GeoAppChatBehaviorProfile | undefined {
    if (value === 'guided' || value === 'safe' || value === 'offline' || value === 'automation' || value === 'debug') {
        return value;
    }
    return undefined;
}

export function normalizeGeoAppChatWorkflowBehaviorProfile(value?: unknown): GeoAppChatWorkflowBehaviorProfile | undefined {
    if (value === 'default' || value === 'guided' || value === 'safe' || value === 'offline' || value === 'automation' || value === 'debug') {
        return value;
    }
    return undefined;
}

export function resolveGeoAppChatProfileForWorkflow(
    workflowKind: string | undefined,
    preferredProfile: string | undefined,
    preferences: GeoAppChatPreferenceValues = {}
): GeoAppChatProfile {
    const explicit = normalizeGeoAppChatWorkflowProfile(preferredProfile);
    if (explicit && explicit !== 'default') {
        return explicit;
    }

    const defaultProfile = normalizeGeoAppChatProfile(preferences[GEOAPP_CHAT_DEFAULT_PROFILE_PREF]) || 'fast';
    const normalizedWorkflowKind = normalizeGeoAppChatWorkflowKind(workflowKind);
    if (!normalizedWorkflowKind || normalizedWorkflowKind === 'general') {
        return defaultProfile;
    }

    const workflowPreferenceKey = normalizedWorkflowKind === 'secret_code'
        ? GEOAPP_CHAT_SECRET_CODE_PROFILE_PREF
        : normalizedWorkflowKind === 'formula'
            ? GEOAPP_CHAT_FORMULA_PROFILE_PREF
            : normalizedWorkflowKind === 'checker'
                ? GEOAPP_CHAT_CHECKER_PROFILE_PREF
                : normalizedWorkflowKind === 'hidden_content'
                    ? GEOAPP_CHAT_HIDDEN_CONTENT_PROFILE_PREF
                    : GEOAPP_CHAT_IMAGE_PUZZLE_PROFILE_PREF;

    const workflowProfile = normalizeGeoAppChatWorkflowProfile(preferences[workflowPreferenceKey]);
    if (!workflowProfile || workflowProfile === 'default') {
        return defaultProfile;
    }

    return workflowProfile;
}

export function resolveGeoAppChatBehaviorProfileForWorkflow(
    workflowKind: string | undefined,
    preferredProfile: string | undefined,
    preferences: GeoAppChatBehaviorPreferenceValues = {}
): GeoAppChatBehaviorProfile {
    const explicit = normalizeGeoAppChatWorkflowBehaviorProfile(preferredProfile);
    if (explicit && explicit !== 'default') {
        return explicit;
    }

    const defaultProfile = normalizeGeoAppChatBehaviorProfile(preferences[GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF]) || 'guided';
    const normalizedWorkflowKind = normalizeGeoAppChatWorkflowKind(workflowKind);
    if (!normalizedWorkflowKind || normalizedWorkflowKind === 'general') {
        return defaultProfile;
    }

    const workflowPreferenceKey = normalizedWorkflowKind === 'secret_code'
        ? GEOAPP_CHAT_BEHAVIOR_SECRET_CODE_PROFILE_PREF
        : normalizedWorkflowKind === 'formula'
            ? GEOAPP_CHAT_BEHAVIOR_FORMULA_PROFILE_PREF
            : normalizedWorkflowKind === 'checker'
                ? GEOAPP_CHAT_BEHAVIOR_CHECKER_PROFILE_PREF
                : normalizedWorkflowKind === 'hidden_content'
                    ? GEOAPP_CHAT_BEHAVIOR_HIDDEN_CONTENT_PROFILE_PREF
                    : GEOAPP_CHAT_BEHAVIOR_IMAGE_PUZZLE_PROFILE_PREF;

    const workflowProfile = normalizeGeoAppChatWorkflowBehaviorProfile(preferences[workflowPreferenceKey]);
    if (!workflowProfile || workflowProfile === 'default') {
        return defaultProfile;
    }

    return workflowProfile;
}

export function getGeoAppAgentSessionLabel(agent?: GeoAppAgentLike): string | undefined {
    const id = (agent?.id || '').toLowerCase();
    if (!id) {
        return undefined;
    }
    if (id === GeoAppChatLocalAgentId) {
        return 'Local';
    }
    if (id === GeoAppChatFastAgentId) {
        return 'Fast';
    }
    if (id === GeoAppChatStrongAgentId) {
        return 'Strong';
    }
    if (id === GeoAppChatWebAgentId) {
        return 'Web';
    }
    if (id === GeoAppChatAgentId.toLowerCase()) {
        return 'GeoApp';
    }
    return agent?.name || agent?.id;
}

export function buildGeoAppChatDisplaySessionTitle(baseSessionTitle: string, agent?: GeoAppAgentLike): string {
    const agentLabel = getGeoAppAgentSessionLabel(agent);
    return agentLabel ? `${baseSessionTitle} [${agentLabel}]` : baseSessionTitle;
}

export function buildGeoAppBaseSessionTitle(gcCode?: string, geocacheName?: string, explicitTitle?: string): string {
    const normalizedExplicitTitle = (explicitTitle || '').trim();
    if (normalizedExplicitTitle) {
        return normalizedExplicitTitle;
    }
    return `CHAT IA - ${gcCode || geocacheName || 'GeoApp'}`;
}

export function buildGeoAppResumeStateBlock(resumeState?: Record<string, unknown>): string | undefined {
    if (!resumeState || typeof resumeState !== 'object' || Object.keys(resumeState).length === 0) {
        return undefined;
    }

    try {
        return `\`\`\`json\n${JSON.stringify(resumeState, null, 2)}\n\`\`\``;
    } catch {
        return undefined;
    }
}

export function buildGeoAppChatPrompt(basePrompt?: string, resumeState?: Record<string, unknown>): string {
    const normalizedPrompt = (basePrompt || '').trim();
    const resumeStateBlock = buildGeoAppResumeStateBlock(resumeState);
    if (!resumeStateBlock) {
        return normalizedPrompt;
    }

    const parts: string[] = [];
    if (normalizedPrompt) {
        parts.push(normalizedPrompt, '');
    }
    parts.push(
        'RESUME_STATE_JSON',
        resumeStateBlock,
        '',
        'Utilise ce resume_state comme etat de reprise prioritaire du workflow courant. Si son contenu contredit un resume textuel plus haut, privilegie ce JSON structure.'
    );
    return parts.join('\n');
}

export function resolveGeoAppChatWorkflowKindFromClassification(
    classification?: GeoAppListingClassificationPreview
): GeoAppChatWorkflowKind {
    const labelNames = new Set((classification?.labels || []).map(label => label.name));
    if (labelNames.has('formula')) {
        return 'formula';
    }
    if (labelNames.has('image_puzzle')) {
        return 'image_puzzle';
    }
    if (labelNames.has('hidden_content') && !labelNames.has('secret_code')) {
        return 'hidden_content';
    }
    if (labelNames.has('checker_available') && !labelNames.has('secret_code')) {
        return 'checker';
    }
    if (labelNames.has('secret_code')) {
        return 'secret_code';
    }
    return 'general';
}

export function resolveGeoAppChatWorkflowKindFromOrchestrator(
    preview?: GeoAppWorkflowResolutionPreview
): GeoAppChatWorkflowKind {
    const workflowKind = preview?.workflow?.kind;
    if (workflowKind === 'formula') {
        return 'formula';
    }
    if (workflowKind === 'secret_code') {
        return 'secret_code';
    }
    if (workflowKind === 'checker') {
        return 'checker';
    }
    if (workflowKind === 'hidden_content') {
        return 'hidden_content';
    }
    if (workflowKind === 'image_puzzle') {
        return 'image_puzzle';
    }
    if (workflowKind === 'coord_transform') {
        return 'formula';
    }
    return resolveGeoAppChatWorkflowKindFromClassification(preview?.classification);
}

export function buildGeoAppOpenChatRequestDetail(
    detail: GeoAppOpenChatRequestDetailPayload
): GeoAppOpenChatRequestDetailPayload {
    return {
        geocacheId: detail.geocacheId,
        gcCode: detail.gcCode,
        geocacheName: detail.geocacheName,
        sessionTitle: buildGeoAppBaseSessionTitle(detail.gcCode, detail.geocacheName, detail.sessionTitle),
        prompt: detail.prompt,
        imageUrls: detail.imageUrls?.length ? detail.imageUrls : undefined,
        focus: detail.focus !== false,
        workflowKind: detail.workflowKind,
        preferredProfile: detail.preferredProfile,
        preferredBehaviorProfile: detail.preferredBehaviorProfile,
        resumeState: detail.resumeState,
        sessionKind: detail.sessionKind,
    };
}

export function dispatchGeoAppOpenChatRequest(
    eventTarget: GeoAppOpenChatEventTarget,
    customEventConstructor: GeoAppCustomEventConstructor,
    detail: GeoAppOpenChatRequestDetailPayload
): void {
    eventTarget.dispatchEvent(new customEventConstructor(
        GEOAPP_OPEN_CHAT_REQUEST_EVENT,
        { detail: buildGeoAppOpenChatRequestDetail(detail) }
    ));
}

export function sanitizeGeoAppSessionSettings(
    settings?: { [key: string]: unknown }
): { [key: string]: unknown } {
    const safeSettings: { [key: string]: unknown } = {};
    for (const [key, value] of Object.entries(settings || {})) {
        if (!GEOAPP_SESSION_SETTING_KEYS.has(key)) {
            safeSettings[key] = value;
        }
    }
    return safeSettings;
}
