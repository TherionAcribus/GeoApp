export interface PluginInfo {
    name: string;
    display_name?: string;
    description?: string;
    category?: string;
    enabled?: boolean;
    source?: string;
    version?: string;
}

export interface PluginListResponse {
    plugins?: PluginInfo[];
    total?: number;
}

export interface ResolutionWorkflowPlanStep {
    id: string;
    title?: string;
    status?: string;
    automated?: boolean;
    tool?: string;
    detail?: string;
}

export interface ResolutionWorkflowStepRunResponse {
    status: string;
    message: string;
    executed_step?: string;
    step?: ResolutionWorkflowPlanStep;
    result?: Record<string, any>;
    workflow_resolution: {
        workflow: {
            kind: string;
            confidence?: number;
            score?: number;
            reason?: string;
            forced?: boolean;
        };
        workflow_candidates: Array<{
            kind: string;
            confidence?: number;
            score?: number;
            reason?: string;
            supporting_labels?: string[];
        }>;
        classification?: Record<string, any>;
        explanation: string[];
        next_actions: string[];
        plan: ResolutionWorkflowPlanStep[];
        execution: {
            formula?: Record<string, any>;
            checker?: Record<string, any>;
            secret_code?: {
                recommendation?: Record<string, any>;
                selected_fragment?: { text?: string };
                metasolver_result?: Record<string, any>;
                [key: string]: any;
            };
            [key: string]: any;
        };
        control?: Record<string, any>;
    };
}
