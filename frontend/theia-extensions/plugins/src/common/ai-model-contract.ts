export type GeoAppAiTaskKind = 'chat' | 'internal' | 'backend';
export type GeoAppAiExecutionPath = 'theia-language-model' | 'backend-plugin';
export type GeoAppAiModelSource = 'operation' | 'session' | 'agent' | 'task-preference' | 'default' | 'unresolved';
export type GeoAppAiModelLocality = 'local' | 'remote' | 'unknown';
export type GeoAppAiModelStatus = 'ready' | 'unavailable' | 'incompatible' | 'unsupported' | 'unconfigured';
export type GeoAppAiModelTransport = 'theia-managed' | 'chat-completions' | 'responses-api' | 'unknown';

export interface GeoAppAiTaskDescriptor {
    id: string;
    label: string;
    agentId?: string;
    purpose?: string;
    kind: GeoAppAiTaskKind;
    executionPath: GeoAppAiExecutionPath;
    requiresLocalModel?: boolean;
}

export interface GeoAppAiModelResolution {
    taskId: string;
    taskLabel: string;
    kind: GeoAppAiTaskKind;
    executionPath: GeoAppAiExecutionPath;
    agentId?: string;
    purpose?: string;
    requestedIdentifier?: string;
    resolvedModelId?: string;
    displayModel?: string;
    provider?: string;
    vendor?: string;
    transport?: GeoAppAiModelTransport;
    backingModel?: string;
    backingPreference?: string;
    source: GeoAppAiModelSource;
    sourceLabel: string;
    locality: GeoAppAiModelLocality;
    status: GeoAppAiModelStatus;
    diagnostics: string[];
    requiresLocalModel?: boolean;
}
