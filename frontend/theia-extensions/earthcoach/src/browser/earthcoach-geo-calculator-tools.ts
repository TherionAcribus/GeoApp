import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import {
    ToolInvocationRegistry,
    ToolRequest,
    ToolRequestParameters,
} from '@theia/ai-core';
import { GEO_CALCULATION_OPERATIONS, runEarthCoachCalculation } from './earthcoach-geo-calculator';

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

@injectable()
export class EarthCoachGeoCalculatorTools implements FrontendApplicationContribution {

    static readonly CALCULATE_TOOL_ID = 'earthcoach.calculate';

    @inject(ToolInvocationRegistry)
    protected readonly toolRegistry!: ToolInvocationRegistry;

    async onStart(): Promise<void> {
        try {
            await this.toolRegistry.registerTool(this.createCalculateTool());
        } catch (error) {
            console.warn('[EarthCoach] Could not register geo calculator tool', error);
        }
    }

    buildAllTools(): ToolRequest[] {
        return [this.createCalculateTool()];
    }

    protected createCalculateTool(): ToolRequest {
        const numberParam = (description: string) => ({ type: 'number', description });
        const stringParam = (description: string) => ({ type: 'string', description });
        const parameters: ToolRequestParameters = {
            type: 'object',
            additionalProperties: false,
            required: ['operation'],
            properties: {
                operation: {
                    type: 'string',
                    enum: [...GEO_CALCULATION_OPERATIONS],
                    description: [
                        'Calcul a effectuer:',
                        '- height_from_shadow: hauteur d un objet via une ombre de reference (reference_height, reference_shadow, object_shadow).',
                        '- scale_from_reference: taille reelle via un objet de reference et une echelle (reference_real, reference_measured, target_measured).',
                        '- slope_angle: angle de pente en degres (rise = denivele, run = distance horizontale).',
                        '- distance_between_coordinates: distance Haversine en metres (lat1, lon1, lat2, lon2).',
                        '- age_from_rate: duree = quantite / taux (amount, rate; amount_unit, time_unit optionnels).',
                        '- flow_rate: debit = volume / temps (volume, time; volume_unit, time_unit optionnels).',
                        '- circumference_to_diameter: diametre et rayon depuis une circonference (circumference).',
                        '- average: moyenne, min, max, somme d une liste (values).',
                    ].join(' '),
                },
                reference_height: numberParam('height_from_shadow: hauteur connue de l objet de reference.'),
                reference_shadow: numberParam('height_from_shadow: longueur d ombre de l objet de reference.'),
                object_shadow: numberParam('height_from_shadow: longueur d ombre de l objet a mesurer.'),
                reference_real: numberParam('scale_from_reference: taille reelle connue de la reference.'),
                reference_measured: numberParam('scale_from_reference: taille mesuree (image/echelle) de la reference.'),
                target_measured: numberParam('scale_from_reference: taille mesuree de la cible.'),
                rise: numberParam('slope_angle: denivele vertical.'),
                run: numberParam('slope_angle: distance horizontale.'),
                lat1: numberParam('distance_between_coordinates: latitude du point 1 (degres decimaux).'),
                lon1: numberParam('distance_between_coordinates: longitude du point 1 (degres decimaux).'),
                lat2: numberParam('distance_between_coordinates: latitude du point 2 (degres decimaux).'),
                lon2: numberParam('distance_between_coordinates: longitude du point 2 (degres decimaux).'),
                amount: numberParam('age_from_rate: quantite accumulee ou erodee (ex: epaisseur).'),
                rate: numberParam('age_from_rate: taux par unite de temps.'),
                volume: numberParam('flow_rate: volume ecoule.'),
                time: numberParam('flow_rate / age_from_rate: duree mesuree.'),
                circumference: numberParam('circumference_to_diameter: circonference mesuree.'),
                values: {
                    type: 'array',
                    items: { type: 'number' },
                    description: 'average: liste des mesures a moyenner.',
                },
                unit: stringParam('Unite de longueur affichee (defaut m).'),
                amount_unit: stringParam('age_from_rate: unite de la quantite (defaut mm).'),
                time_unit: stringParam('age_from_rate / flow_rate: unite de temps (defaut an / s).'),
                volume_unit: stringParam('flow_rate: unite de volume (defaut L).'),
            },
        } as ToolRequestParameters;

        return {
            id: EarthCoachGeoCalculatorTools.CALCULATE_TOOL_ID,
            name: 'earthcoach_calculate',
            description: [
                'Effectue un calcul geologique deterministe a partir de mesures fournies par l utilisateur',
                '(hauteur par ombre, echelle, pente, distance entre coordonnees, age par taux, debit, diametre, moyenne).',
                'Utilise ce tool des qu une question EarthCache demande une valeur quantitative, au lieu de calculer toi-meme.',
                'N invente jamais les mesures d entree: si une mesure terrain manque, demande-la ou laisse-la a completer.',
            ].join(' '),
            providerName: PROVIDER_NAME,
            parameters,
            handler: async (argString: string) => {
                const args = parseArgs(argString);
                const operation = String(args.operation || '').trim();
                if (!operation) {
                    return err('operation is required');
                }
                try {
                    return ok(runEarthCoachCalculation(operation, args));
                } catch (error: any) {
                    return err(error?.message || String(error));
                }
            },
        };
    }
}
