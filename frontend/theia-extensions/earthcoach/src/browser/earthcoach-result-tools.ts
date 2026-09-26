import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ToolInvocationRegistry, ToolRequest, ToolRequestParameters } from '@theia/ai-core';
import { inject, injectable } from '@theia/core/shared/inversify';
import { EarthCoachCapturePayload, EarthCoachResultCaptureService } from './earthcoach-result-capture';
import { EarthCoachResultProposal } from './earthcoach-workspace-types';

@injectable()
export class EarthCoachResultTools implements FrontendApplicationContribution {
    static readonly TOOL_ID = 'earthcoach.capture_result';

    @inject(ToolInvocationRegistry)
    protected readonly registry!: ToolInvocationRegistry;

    @inject(EarthCoachResultCaptureService)
    protected readonly capture!: EarthCoachResultCaptureService;

    async onStart(): Promise<void> {
        try {
            await this.registry.registerTool(this.createTool());
        } catch (error) {
            console.warn('[EarthCoach] Could not register result capture tool', error);
        }
    }

    buildAllTools(): ToolRequest[] {
        return [this.createTool()];
    }

    protected createTool(): ToolRequest {
        return {
            id: EarthCoachResultTools.TOOL_ID,
            name: 'earthcoach_capture_result',
            description: 'Enregistre les propositions structurées de l analyse ou de la résolution EarthCoach. Appeler une fois à la fin avec le request_id exact fourni dans le dossier.',
            providerName: 'geoapp.earthcoach',
            parameters: {
                type: 'object',
                properties: {
                    request_id: { type: 'string', description: 'Identifiant immuable fourni dans le dossier terrain.' },
                    geocache_id: { type: 'number', description: 'ID GeoApp fourni dans le dossier.' },
                    action: { type: 'string', enum: ['analyze', 'resolve'], description: 'Type de résultat.' },
                    proposals: {
                        type: 'array',
                        description: 'Propositions par question; vide pour une analyse sans proposition de réponse.',
                        items: {
                            type: 'object',
                            properties: {
                                task_id: { type: 'number' },
                                question: { type: 'string' },
                                status: { type: 'string', enum: ['ready', 'partial', 'missing'] },
                                answer: { type: 'string' },
                                evidence_ids: { type: 'array', items: { type: 'string' } },
                                confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                                missing: { type: 'string' },
                            },
                            required: ['question', 'status'],
                            additionalProperties: false,
                        },
                    },
                },
                required: ['request_id', 'geocache_id', 'action', 'proposals'],
                additionalProperties: false,
            } as ToolRequestParameters,
            handler: async (argString: string) => {
                try {
                    const args = JSON.parse(argString || '{}') as EarthCoachCapturePayload;
                    const payload: EarthCoachCapturePayload = {
                        request_id: String(args.request_id || ''),
                        geocache_id: Number(args.geocache_id),
                        action: args.action,
                        proposals: Array.isArray(args.proposals) ? args.proposals as EarthCoachResultProposal[] : [],
                    };
                    const result = await this.capture.capture(payload);
                    return JSON.stringify({ success: true, result_id: result.id });
                } catch (error) {
                    return JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) });
                }
            },
        };
    }
}
