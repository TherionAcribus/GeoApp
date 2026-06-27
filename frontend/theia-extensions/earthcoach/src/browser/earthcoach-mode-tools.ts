import { injectable, inject, optional } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import {
    ToolInvocationRegistry,
    ToolRequest,
    ToolRequestParameters,
} from '@theia/ai-core';
import { ChatService } from '@theia/ai-chat';
import { EarthCoachMode } from './earthcoach-types';
import {
    applyEarthCoachModeToSettings,
    EARTHCOACH_MODE_LABELS,
    normalizeEarthCoachMode,
} from './earthcoach-mode';

const PROVIDER_NAME = 'geoapp.earthcoach';

function ok(data: unknown): string {
    return JSON.stringify({ success: true, data });
}

function err(message: string): string {
    return JSON.stringify({ success: false, error: message });
}

function parseArgs(argString: string): Record<string, unknown> {
    try {
        return JSON.parse(argString || '{}') as Record<string, unknown>;
    } catch {
        return {};
    }
}

interface SessionModelWithSettings {
    settings?: { [key: string]: unknown };
    setSettings?: (settings: { [key: string]: unknown }) => void;
}

@injectable()
export class EarthCoachModeTools implements FrontendApplicationContribution {

    static readonly SET_MODE_TOOL_ID = 'earthcoach.set_mode';

    @inject(ToolInvocationRegistry)
    protected readonly toolRegistry!: ToolInvocationRegistry;

    @inject(ChatService) @optional()
    protected readonly chatService?: ChatService;

    async onStart(): Promise<void> {
        try {
            await this.toolRegistry.registerTool(this.createSetModeTool());
        } catch (error) {
            console.warn('[EarthCoach] Could not register mode tool', error);
        }
    }

    buildAllTools(): ToolRequest[] {
        return [this.createSetModeTool()];
    }

    protected createSetModeTool(): ToolRequest {
        const parameters: ToolRequestParameters = {
            type: 'object',
            additionalProperties: false,
            required: ['mode'],
            properties: {
                mode: {
                    type: 'string',
                    enum: ['coach', 'resolver'],
                    description: 'Mode cible: "coach" (guide, sans reponse finale) ou "resolver" (synthese fondee sur les donnees fournies).',
                },
            },
        } as ToolRequestParameters;

        return {
            id: EarthCoachModeTools.SET_MODE_TOOL_ID,
            name: 'earthcoach_set_mode',
            description: [
                'Change le mode EarthCoach de la session de chat active (coach <-> resolver) quand l utilisateur le demande.',
                'Le nouveau mode s applique a partir du prochain message.',
                'N appelle ce tool que sur demande explicite de changement de mode.',
            ].join(' '),
            providerName: PROVIDER_NAME,
            parameters,
            handler: async (argString: string) => {
                const args = parseArgs(argString);
                const mode = normalizeEarthCoachMode(args.mode);
                if (!mode) {
                    return err('mode must be "coach" or "resolver"');
                }
                try {
                    this.applyMode(mode);
                    return ok({
                        mode,
                        label: EARTHCOACH_MODE_LABELS[mode],
                        applies: 'next_message',
                    });
                } catch (error: any) {
                    return err(error?.message || String(error));
                }
            },
        };
    }

    protected applyMode(mode: EarthCoachMode): void {
        if (!this.chatService) {
            throw new Error('Service de chat indisponible pour changer de mode.');
        }
        const session = this.chatService.getActiveSession();
        const model = session?.model as SessionModelWithSettings | undefined;
        if (!model || typeof model.setSettings !== 'function') {
            throw new Error('Aucune session de chat active a mettre a jour.');
        }
        model.setSettings(applyEarthCoachModeToSettings(model.settings || {}, mode));
    }
}
