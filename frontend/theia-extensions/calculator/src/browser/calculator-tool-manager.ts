import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import {
    ToolInvocationRegistry,
    ToolRequest,
    ToolRequestParameters,
} from '@theia/ai-core';
import { CalculatorService } from './calculator-service';

const ok = (data: unknown): string => JSON.stringify({ success: true, data });
const err = (message: string): string => JSON.stringify({ success: false, error: message });

function buildParams(
    props: Record<string, { type: string; description: string; required?: boolean; enum?: string[] }>
): ToolRequestParameters {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(props)) {
        const { required: isRequired, ...rest } = value;
        properties[key] = rest;
        if (isRequired) { required.push(key); }
    }
    return { type: 'object', properties, ...(required.length ? { required } : {}) } as ToolRequestParameters;
}

function parseArgs(argString: string): Record<string, any> {
    try { return JSON.parse(argString || '{}'); } catch { return {}; }
}

@injectable()
export class CalculatorToolManager implements FrontendApplicationContribution {

    static readonly PROVIDER_NAME = 'geoapp.calculator';

    @inject(ToolInvocationRegistry)
    protected readonly toolRegistry!: ToolInvocationRegistry;

    @inject(CalculatorService)
    protected readonly calculatorService!: CalculatorService;

    async onStart(): Promise<void> {
        const tools = this.buildTools();
        for (const tool of tools) {
            try {
                await this.toolRegistry.registerTool(tool);
            } catch (e) {
                console.warn(`[CALCULATOR-TOOLS] Could not register tool ${tool.id}:`, e);
            }
        }
    }

    private buildTools(): ToolRequest[] {
        return [
            {
                id: 'aide_calculate',
                name: 'aide_calculate',
                description:
                    'Évalue une expression mathématique et retourne le résultat numérique. ' +
                    'Supporte : arithmétique (+, -, *, /, ^, %), fonctions trigonométriques (sin, cos, tan, asin, acos, atan), ' +
                    'fonctions mathématiques (sqrt, cbrt, abs, ceil, floor, round, log, log10, exp), ' +
                    'constantes (pi, e), factorielle (n!), et combinatoires (combinations, permutations). ' +
                    'Par défaut les angles sont en RADIANS. Utiliser angle_unit="deg" pour les degrés. ' +
                    'Exemples : "sqrt(144)", "sin(pi/6)", "2^10", "factorial(10)", "log10(1000)", "combinations(10, 3)". ' +
                    'Appeler cet outil dès qu\'un calcul numérique est requis pour résoudre une énigme.',
                providerName: CalculatorToolManager.PROVIDER_NAME,
                parameters: buildParams({
                    expression: {
                        type: 'string',
                        description: 'Expression mathématique à évaluer. Syntaxe mathjs : "sqrt(144)", "sin(pi/4)", "2^10", "factorial(5)", "log(100, 10)".',
                        required: true,
                    },
                    angle_unit: {
                        type: 'string',
                        description: 'Unité d\'angle pour les fonctions trigonométriques : "rad" (défaut) ou "deg".',
                        required: false,
                        enum: ['rad', 'deg'],
                    },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    if (!args.expression) { return err('Paramètre "expression" manquant.'); }
                    try {
                        const angleUnit = args.angle_unit === 'deg' ? 'deg' : 'rad';
                        const res = this.calculatorService.evaluate(String(args.expression), angleUnit);
                        if (res.error) {
                            return err(`Erreur de calcul : ${res.error}`);
                        }
                        return ok({
                            expression: res.expression,
                            result: res.result,
                            numeric: res.numericResult,
                            angle_unit: angleUnit,
                        });
                    } catch (e: any) {
                        return err(e?.message ?? String(e));
                    }
                },
            },
            {
                id: 'aide_calculate_batch',
                name: 'aide_calculate_batch',
                description:
                    'Évalue plusieurs expressions mathématiques en une seule fois. ' +
                    'Utile pour résoudre plusieurs coordonnées ou formules en parallèle. ' +
                    'Retourne un tableau de résultats avec chaque expression et son résultat.',
                providerName: CalculatorToolManager.PROVIDER_NAME,
                parameters: buildParams({
                    expressions: {
                        type: 'string',
                        description: 'Liste d\'expressions séparées par des points-virgules. Ex: "2+3; sqrt(16); sin(pi/2)".',
                        required: true,
                    },
                    angle_unit: {
                        type: 'string',
                        description: 'Unité d\'angle : "rad" (défaut) ou "deg". Appliqué à toutes les expressions.',
                        required: false,
                        enum: ['rad', 'deg'],
                    },
                }),
                handler: async (argString: string) => {
                    const args = parseArgs(argString);
                    if (!args.expressions) { return err('Paramètre "expressions" manquant.'); }
                    try {
                        const angleUnit = args.angle_unit === 'deg' ? 'deg' : 'rad';
                        const parts = String(args.expressions).split(';').map((s: string) => s.trim()).filter(Boolean);
                        const results = parts.map(expr => {
                            const res = this.calculatorService.evaluate(expr, angleUnit);
                            return {
                                expression: expr,
                                result: res.error ? null : res.result,
                                numeric: res.error ? null : res.numericResult,
                                error: res.error ?? null,
                            };
                        });
                        return ok({ angle_unit: angleUnit, results });
                    } catch (e: any) {
                        return err(e?.message ?? String(e));
                    }
                },
            },
            {
                id: 'aide_open_calculator',
                name: 'aide_open_calculator',
                description: 'Ouvre le panneau calculatrice dans la barre latérale gauche de GeoApp.',
                providerName: CalculatorToolManager.PROVIDER_NAME,
                parameters: buildParams({}),
                handler: async () => {
                    try {
                        if (typeof window !== 'undefined') {
                            window.dispatchEvent(new CustomEvent('geoapp-open-calculator'));
                        }
                        return ok('Calculatrice ouverte.');
                    } catch (e: any) {
                        return err(e?.message ?? String(e));
                    }
                },
            },
        ];
    }
}
