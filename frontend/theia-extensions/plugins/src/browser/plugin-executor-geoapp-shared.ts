export interface PluginExecutorChatContext {
    geocacheId?: number;
    gcCode?: string;
    name?: string;
}

export interface PluginExecutorGeoAppOpenChatDetail {
    geocacheId?: number;
    gcCode?: string;
    geocacheName?: string;
    sessionTitle?: string;
    prompt?: string;
    focus: boolean;
    workflowKind?: string;
    preferredProfile?: string;
    resumeState?: Record<string, unknown>;
    sessionKind: 'auto';
}

function buildBaseSessionTitle(gcCode?: string, geocacheName?: string): string {
    if (gcCode?.trim()) {
        return `CHAT IA - ${gcCode.trim().toUpperCase()}`;
    }
    if (geocacheName?.trim()) {
        return `CHAT IA - ${geocacheName.trim()}`;
    }
    return 'CHAT IA - GeoApp';
}

function buildResumePrompt(basePrompt: string, resumeState?: Record<string, unknown>): string {
    if (!resumeState || Object.keys(resumeState).length === 0) {
        return basePrompt;
    }
    return [
        basePrompt.trim(),
        '',
        'RESUME_STATE_JSON',
        '```json',
        JSON.stringify(resumeState, null, 2),
        '```',
        '',
        'Utilise ce resume_state comme etat de reprise prioritaire du workflow courant.',
    ].filter(part => part !== '').join('\n');
}

export function buildPluginExecutorGeoAppOpenChatDetail(
    prompt: string,
    workflowKind?: string,
    preferredProfile?: string,
    resumeState?: Record<string, unknown>,
    context?: PluginExecutorChatContext
): PluginExecutorGeoAppOpenChatDetail {
    return {
        geocacheId: context?.geocacheId,
        gcCode: context?.gcCode,
        geocacheName: context?.name,
        sessionTitle: buildBaseSessionTitle(context?.gcCode, context?.name),
        prompt: buildResumePrompt(prompt, resumeState),
        focus: true,
        workflowKind,
        preferredProfile,
        resumeState,
        sessionKind: 'auto',
    };
}
