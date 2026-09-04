/**
 * Le tool `save_outing_plan` : la voie normale de sortie du rapport hors du chat.
 *
 * Il ne demande au modèle que ce que le modèle seul peut produire — la substance du
 * rapport. L'identité de la sortie (zone, date, liste des caches) vient du contexte
 * enregistré par le contrôleur ; `outing_date` reste un paramètre facultatif, utilisé
 * seulement pour départager deux analyses lancées coup sur coup.
 *
 * Le tool est marqué `local_write` : il écrit en base. Sous le profil `guided`, il passe
 * donc par une confirmation Theia au premier appel, avec l'option « toujours autoriser ».
 * C'est le prix d'une déclaration honnête du risque ; le mentir pour éviter un clic
 * viderait de son sens la colonne « écrit en local » du panneau Policy.
 */

import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ToolCallResult, ToolInvocationRegistry, ToolRequest, ToolRequestParameters } from '@theia/ai-core';
import { OutingPlanCaptureService } from './outing-plan-capture';
import { OUTING_SAVE_PLAN_TOOL_ID, OUTING_SAVE_PLAN_TOOL_NAME } from './outing-plan-types';

@injectable()
export class OutingPlanToolsManager implements FrontendApplicationContribution {

    static readonly PROVIDER_NAME = 'geoapp.outing';

    @inject(ToolInvocationRegistry)
    protected readonly toolRegistry!: ToolInvocationRegistry;

    @inject(OutingPlanCaptureService)
    protected readonly capture!: OutingPlanCaptureService;

    async onStart(): Promise<void> {
        await this.toolRegistry.registerTool(this.createSavePlanTool());
    }

    protected createSavePlanTool(): ToolRequest {
        return {
            id: OUTING_SAVE_PLAN_TOOL_ID,
            name: OUTING_SAVE_PLAN_TOOL_NAME,
            description:
                'Enregistre le rapport de preparation de sortie sous forme structuree, pour '
                + 'la checklist cochable, les badges des tables de geocaches et l export. '
                + 'A appeler UNE SEULE FOIS, apres avoir redige le rapport complet, avec la '
                + 'meme substance que le texte. Ne remplace pas le rapport redige.',
            providerName: OutingPlanToolsManager.PROVIDER_NAME,
            parameters: {
                type: 'object',
                properties: {
                    summary: {
                        type: 'string',
                        description: 'Une ou deux phrases resumant la sortie.',
                    },
                    checklist: {
                        type: 'array',
                        description: 'Checklist materiel consolidee, une entree par objet a emporter.',
                        items: {
                            type: 'object',
                            properties: {
                                item: { type: 'string', description: 'Objet a emporter.' },
                                certainty: {
                                    type: 'string',
                                    enum: ['confirmed', 'probable', 'precaution'],
                                    description: 'Niveau de certitude, au sens de la regle 1.',
                                },
                                gc_codes: {
                                    type: 'array',
                                    items: { type: 'string' },
                                    description: 'Codes GC concernes.',
                                },
                                reason: {
                                    type: 'string',
                                    description: 'Source ou faisceau d indices (log date, listing, hint).',
                                },
                            },
                            required: ['item', 'certainty'],
                        },
                    },
                    alerts: {
                        type: 'array',
                        description: 'Alertes, la plus bloquante en premier.',
                        items: {
                            type: 'object',
                            properties: {
                                gc_code: { type: 'string', description: 'Cache concernee, si l alerte en vise une.' },
                                severity: {
                                    type: 'string',
                                    enum: ['blocking', 'warning', 'info'],
                                },
                                kind: {
                                    type: 'string',
                                    enum: [
                                        'unsolved_mystery', 'already_found', 'health', 'gear',
                                        'access', 'schedule', 'risk', 'data', 'other',
                                    ],
                                },
                                message: { type: 'string' },
                            },
                            required: ['severity', 'kind', 'message'],
                        },
                    },
                    per_cache: {
                        type: 'array',
                        description: 'Detail par cache : seulement celles qui ont une particularite.',
                        items: {
                            type: 'object',
                            properties: {
                                gc_code: { type: 'string' },
                                gear: {
                                    type: 'array',
                                    items: { type: 'string' },
                                    description: 'Materiel propre a cette cache.',
                                },
                                minutes: {
                                    type: 'number',
                                    description: 'Temps sur place retenu, en minutes.',
                                },
                                flags: {
                                    type: 'array',
                                    items: {
                                        type: 'string',
                                        enum: [
                                            'blocking', 'gear_required', 'unresolved_gear',
                                            'risky_health', 'time_sink', 'time_window',
                                            'access', 'stale_data',
                                        ],
                                    },
                                },
                                note: { type: 'string', description: 'Point d attention en une phrase.' },
                            },
                            required: ['gc_code'],
                        },
                    },
                    order: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Ordre de visite retenu, en codes GC.',
                    },
                    time_budget: {
                        type: 'object',
                        description: 'Budget de la journee, en minutes.',
                        properties: {
                            on_site_minutes: { type: 'number' },
                            travel_minutes: { type: 'number' },
                            total_minutes: { type: 'number' },
                        },
                    },
                    to_verify: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Ce qui reste a lever avant de partir.',
                    },
                    outing_date: {
                        type: 'string',
                        description:
                            'Date de la sortie au format AAAA-MM-JJ, telle qu annoncee dans les '
                            + 'donnees. Facultative : elle ne sert qu a departager deux analyses.',
                    },
                },
                required: ['checklist'],
                additionalProperties: false,
            } as ToolRequestParameters,
            handler: async (argString: string) => this.savePlan(argString),
        };
    }

    protected async savePlan(argString: string): Promise<ToolCallResult> {
        let args: Record<string, unknown>;
        try {
            args = JSON.parse(argString || '{}') as Record<string, unknown>;
        } catch (error) {
            return this.stringify({
                status: 'error',
                error: `Arguments illisibles : ${(error as Error)?.message ?? error}`,
            });
        }

        const outingDateHint = typeof args.outing_date === 'string' ? args.outing_date : undefined;

        try {
            const result = await this.capture.capture(args, {
                source: 'tool',
                outingDateHint,
            });

            return this.stringify({
                status: 'ok',
                plan_id: result.plan.id,
                outing_date: result.plan.outing_date,
                zone_name: result.plan.zone_name,
                checklist_items: result.plan.plan.checklist.length,
                alerts: result.plan.plan.alerts.length,
                caches_flagged: result.plan.plan.per_cache.length,
                // Les coupes de la normalisation remontent au modèle : s'il a produit
                // quarante lignes de checklist dont la moitié a fusionné, autant qu'il le
                // sache avant de commenter son propre rapport.
                warnings: result.warnings,
            });
        } catch (error) {
            return this.stringify({
                status: 'error',
                error: `Enregistrement impossible : ${(error as Error)?.message ?? error}`,
            });
        }
    }

    protected stringify(payload: unknown): string {
        return JSON.stringify(payload);
    }
}
