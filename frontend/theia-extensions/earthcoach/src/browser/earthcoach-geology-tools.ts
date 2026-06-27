import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import {
    ToolInvocationRegistry,
    ToolRequest,
    ToolRequestParameters,
} from '@theia/ai-core';
import { EarthCoachGeologyService } from './earthcoach-geology-service';
import { formatGeologySummary } from './earthcoach-geology';

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

function toCoord(value: unknown): number | undefined {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
    return Number.isFinite(parsed) ? parsed : undefined;
}

@injectable()
export class EarthCoachGeologyTools implements FrontendApplicationContribution {

    static readonly GEOLOGY_TOOL_ID = 'earthcoach.geology_at_point';

    @inject(ToolInvocationRegistry)
    protected readonly toolRegistry!: ToolInvocationRegistry;

    @inject(EarthCoachGeologyService)
    protected readonly geologyService!: EarthCoachGeologyService;

    async onStart(): Promise<void> {
        try {
            await this.toolRegistry.registerTool(this.createGeologyTool());
        } catch (error) {
            console.warn('[EarthCoach] Could not register geology tool', error);
        }
    }

    buildAllTools(): ToolRequest[] {
        return [this.createGeologyTool()];
    }

    protected createGeologyTool(): ToolRequest {
        const parameters: ToolRequestParameters = {
            type: 'object',
            additionalProperties: false,
            required: ['lat', 'lon'],
            properties: {
                lat: { type: 'number', description: 'Latitude en degres decimaux (ex: 45.78). Utilise les coordonnees de la cache fournies dans le contexte.' },
                lon: { type: 'number', description: 'Longitude en degres decimaux (ex: 4.87).' },
            },
        } as ToolRequestParameters;

        return {
            id: EarthCoachGeologyTools.GEOLOGY_TOOL_ID,
            name: 'earthcoach_geology_at_point',
            description: [
                'Recupere le contexte geologique cartographie a une coordonnee (lithologie, age, formation) via Macrostrat.',
                'Utilise ce tool pour situer la geologie d une EarthCache a partir de ses coordonnees decimales.',
                'C est une donnee cartographique generale, pas une observation de terrain: ne la presente jamais comme une observation utilisateur,',
                'et rappelle qu elle doit etre confirmee sur place.',
            ].join(' '),
            providerName: PROVIDER_NAME,
            parameters,
            handler: async (argString: string) => {
                const args = parseArgs(argString);
                const lat = toCoord(args.lat);
                const lon = toCoord(args.lon);
                if (lat === undefined || lon === undefined) {
                    return err('lat and lon (decimal degrees) are required');
                }
                try {
                    const result = await this.geologyService.geologyAtPoint(lat, lon);
                    return ok({
                        lat: result.lat,
                        lon: result.lon,
                        source: result.source,
                        attribution: result.attribution,
                        from_cache: result.from_cache,
                        units: result.units,
                        summary: formatGeologySummary(result),
                    });
                } catch (error: any) {
                    return err(error?.message || String(error));
                }
            },
        };
    }
}
