import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import {
    ToolInvocationRegistry,
    ToolRequest,
    ToolRequestParameters,
} from '@theia/ai-core';
import { EarthCoachElevationService, ElevationQueryPoint } from './earthcoach-elevation-service';
import { formatElevationSummary } from './earthcoach-elevation';

const PROVIDER_NAME = 'geoapp.earthcoach';
const MAX_POINTS = 10;

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

/** Accepte soit `{lat, lon}`, soit `{points: [{lat, lon}, ...]}` pour un denivele. */
export function readElevationPoints(args: Record<string, unknown>): ElevationQueryPoint[] | undefined {
    const raw = Array.isArray(args.points) ? args.points : [args];
    const points: ElevationQueryPoint[] = [];
    for (const entry of raw) {
        const candidate = entry as Record<string, unknown> | undefined;
        const lat = toCoord(candidate?.lat);
        const lon = toCoord(candidate?.lon);
        if (lat === undefined || lon === undefined) {
            return undefined;
        }
        points.push({ lat, lon });
    }
    return points.length && points.length <= MAX_POINTS ? points : undefined;
}

@injectable()
export class EarthCoachElevationTools implements FrontendApplicationContribution {

    static readonly ELEVATION_TOOL_ID = 'earthcoach.elevation_at_point';

    @inject(ToolInvocationRegistry)
    protected readonly toolRegistry!: ToolInvocationRegistry;

    @inject(EarthCoachElevationService)
    protected readonly elevationService!: EarthCoachElevationService;

    async onStart(): Promise<void> {
        try {
            await this.toolRegistry.registerTool(this.createElevationTool());
        } catch (error) {
            console.warn('[EarthCoach] Could not register elevation tool', error);
        }
    }

    buildAllTools(): ToolRequest[] {
        return [this.createElevationTool()];
    }

    protected createElevationTool(): ToolRequest {
        const point = {
            type: 'object',
            additionalProperties: false,
            required: ['lat', 'lon'],
            properties: {
                lat: { type: 'number', description: 'Latitude en degres decimaux.' },
                lon: { type: 'number', description: 'Longitude en degres decimaux.' },
            },
        };
        const parameters: ToolRequestParameters = {
            type: 'object',
            additionalProperties: false,
            properties: {
                lat: { type: 'number', description: 'Latitude du point unique, si tu n utilises pas points.' },
                lon: { type: 'number', description: 'Longitude du point unique, si tu n utilises pas points.' },
                points: {
                    type: 'array',
                    description: `Liste de ${MAX_POINTS} points au maximum pour obtenir un denivele (ex: bas et haut d une cascade).`,
                    items: point,
                },
            },
        } as ToolRequestParameters;

        return {
            id: EarthCoachElevationTools.ELEVATION_TOOL_ID,
            name: 'earthcoach_elevation_at_point',
            description: [
                'Donne l altitude d un ou plusieurs points (IGN RGE ALTI en France, Copernicus DEM ailleurs), et le denivele entre eux.',
                'Utilise ce tool des qu une question EarthCache porte sur une altitude, un denivele, une hauteur de chute ou une position dans un profil topographique.',
                'C est un modele numerique de terrain, pas une mesure de terrain: annonce la source et sa precision, et invite a confirmer au GPS ou a l altimetre.',
            ].join(' '),
            providerName: PROVIDER_NAME,
            parameters,
            handler: async (argString: string) => {
                const points = readElevationPoints(parseArgs(argString));
                if (!points) {
                    return err(`provide lat and lon (decimal degrees), or points: [{lat, lon}] with at most ${MAX_POINTS} entries`);
                }
                try {
                    const result = await this.elevationService.elevationAtPoints(points);
                    return ok({ ...result, summary: formatElevationSummary(result) });
                } catch (error: any) {
                    return err(error?.message || String(error));
                }
            },
        };
    }
}
