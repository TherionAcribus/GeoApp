import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import {
    ToolInvocationRegistry,
    ToolRequest,
    ToolRequestParameters,
} from '@theia/ai-core';
import {
    dispatchEarthCoachDataUpdated,
    EARTHCOACH_LOGGING_TASKS_UPDATED_EVENT,
} from './earthcoach-events';
import { EarthCoachLoggingTaskService } from './earthcoach-logging-task-service';
import { normalizeExtractionTasks } from './earthcoach-logging-tasks';

const PROVIDER_NAME = 'geoapp.earthcoach';

function ok(data: unknown): string {
    return JSON.stringify({ success: true, data });
}

function err(message: string): string {
    return JSON.stringify({ success: false, error: message });
}

function buildParams(
    props: Record<string, { type: string; description: string; required?: boolean; items?: unknown }>
): ToolRequestParameters {
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

function parseArgs(argString: string): Record<string, unknown> {
    try {
        return JSON.parse(argString || '{}') as Record<string, unknown>;
    } catch {
        return {};
    }
}

@injectable()
export class EarthCoachLoggingTaskTools implements FrontendApplicationContribution {

    static readonly EXTRACT_TOOL_ID = 'earthcoach.extract_logging_tasks';

    @inject(ToolInvocationRegistry)
    protected readonly toolRegistry!: ToolInvocationRegistry;

    @inject(EarthCoachLoggingTaskService)
    protected readonly loggingTaskService!: EarthCoachLoggingTaskService;

    async onStart(): Promise<void> {
        try {
            await this.toolRegistry.registerTool(this.createExtractTool());
        } catch (error) {
            console.warn('[EarthCoach] Could not register logging task tool', error);
        }
    }

    buildAllTools(): ToolRequest[] {
        return [this.createExtractTool()];
    }

    protected createExtractTool(): ToolRequest {
        return {
            id: EarthCoachLoggingTaskTools.EXTRACT_TOOL_ID,
            name: 'earthcoach_extract_logging_tasks',
            description: [
                'Enregistre les questions imposees par le proprietaire (logging tasks) d une EarthCache,',
                'a partir du listing fourni dans le contexte EarthCoach.',
                'Cette operation REMPLACE toutes les questions deja enregistrees pour la cache:',
                'ne l utilise que si l utilisateur demande explicitement d extraire ou de rafraichir les questions.',
                'Liste les questions dans l ordre du listing; n invente aucune question et ne fabrique aucune reponse.',
            ].join(' '),
            providerName: PROVIDER_NAME,
            parameters: buildParams({
                geocache_id: {
                    type: 'number',
                    description: 'ID GeoApp de la geocache cible. Utiliser l ID fourni dans le contexte EarthCoach.',
                    required: true,
                },
                tasks: {
                    type: 'array',
                    description: 'Liste ordonnee des questions du proprietaire.',
                    required: true,
                    items: {
                        type: 'object',
                        properties: {
                            question: {
                                type: 'string',
                                description: 'Texte de la question telle que demandee par le proprietaire.',
                            },
                            guidance: {
                                type: 'string',
                                description: 'Ce qu il faut observer ou mesurer sur place pour repondre. Optionnel.',
                            },
                            requires_photo: {
                                type: 'boolean',
                                description: 'true si la question exige une photo. Optionnel.',
                            },
                        },
                        required: ['question'],
                        additionalProperties: false,
                    },
                },
            }),
            handler: async (argString: string) => {
                const args = parseArgs(argString);
                try {
                    const geocacheId = this.toPositiveInteger(args.geocache_id);
                    if (!geocacheId) {
                        return err('geocache_id is required');
                    }
                    const tasks = normalizeExtractionTasks(args.tasks);
                    if (!tasks.length) {
                        return err('tasks must contain at least one question');
                    }
                    const response = await this.loggingTaskService.replaceLoggingTasks(geocacheId, tasks);
                    this.notifyUpdated(geocacheId);
                    return ok({
                        geocache_id: geocacheId,
                        saved: response.logging_tasks.length,
                        logging_tasks: response.logging_tasks.map(task => ({
                            position: task.position,
                            question: task.question,
                            requires_photo: task.requires_photo,
                        })),
                    });
                } catch (error: any) {
                    return err(error?.message || String(error));
                }
            },
        };
    }

    protected notifyUpdated(geocacheId: number): void {
        dispatchEarthCoachDataUpdated(EARTHCOACH_LOGGING_TASKS_UPDATED_EVENT, geocacheId);
    }

    protected toPositiveInteger(value: unknown): number | undefined {
        const parsed = typeof value === 'number' ? value : Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0) {
            return undefined;
        }
        return parsed;
    }
}
