import { ToolRequestParameters } from '@theia/ai-core';

// Helpers partages par les tools EarthCoach: meme format de reponse JSON
// ({success, data|error}), meme tolerance aux arguments mal formes.

export function ok(data: unknown): string {
    return JSON.stringify({ success: true, data });
}

export function err(message: string): string {
    return JSON.stringify({ success: false, error: message });
}

export interface EarthCoachToolParamSpec {
    type: string;
    description: string;
    required?: boolean;
    enum?: string[];
    items?: unknown;
}

export function buildParams(props: Record<string, EarthCoachToolParamSpec>): ToolRequestParameters {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(props)) {
        const { required: isRequired, ...rest } = value;
        properties[key] = rest;
        if (isRequired) {
            required.push(key);
        }
    }
    return { type: 'object', properties, required, additionalProperties: false } as ToolRequestParameters;
}

export function parseArgs(argString: string): Record<string, unknown> {
    try {
        return JSON.parse(argString || '{}') as Record<string, unknown>;
    } catch {
        return {};
    }
}

export function toPositiveInteger(value: unknown): number | undefined {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        return undefined;
    }
    return parsed;
}
