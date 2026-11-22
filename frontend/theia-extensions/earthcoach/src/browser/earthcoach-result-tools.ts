import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ToolInvocationRegistry, ToolRequest, ToolRequestParameters } from '@theia/ai-core';
import { inject, injectable } from '@theia/core/shared/inversify';
import { ChatToolContext } from '@theia/ai-chat/lib/common/chat-tool-request-service';
import { EarthCoachCapturePayload, EarthCoachResultCaptureService } from './earthcoach-result-capture';
import { EarthCoachResultObserver } from './earthcoach-result-observer';
import { EarthCoachResultProposal } from './earthcoach-workspace-types';

@injectable()
export class EarthCoachResultTools implements FrontendApplicationContribution {
    static readonly TOOL_ID = 'earthcoach.capture_result';
    static readonly ASK_TOOL_ID = 'earthcoach.ask_user';

    @inject(ToolInvocationRegistry)
    protected readonly registry!: ToolInvocationRegistry;

    @inject(EarthCoachResultCaptureService)
    protected readonly capture!: EarthCoachResultCaptureService;

    @inject(EarthCoachResultObserver)
    protected readonly observer!: EarthCoachResultObserver;

    async onStart(): Promise<void> {
        for (const tool of this.buildAllTools()) {
            try {
                await this.registry.registerTool(tool);
            } catch (error) {
                console.warn(`[EarthCoach] Could not register ${tool.name}`, error);
            }
        }
    }

    buildAllTools(): ToolRequest[] {
        return [this.createTool(), this.createAskTool()];
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
                                question_number: { type: 'number', description: 'Rang de la question dans le listing (1, 2, 3...), numérotation continue sur toute la cache ; reprendre le numéro Qn fourni quand les questions sont enregistrées.' },
                                location: { type: 'string', description: 'Lieu auquel la question se rapporte, tel que le listing le nomme (ex. « Station 2 », « WP1 - Façade de l église », « Étape 3 ») ; omis si la cache n a qu un seul lieu.' },
                                question: { type: 'string', description: 'Question originale du propriétaire, inchangée.' },
                                question_type: { type: 'string', enum: ['knowledge', 'photo', 'field'], description: 'Origine de la réponse : knowledge = titre, listing, autre question ou connaissance géologique, photo = lisible sur les images transmises, field = relevé propre à la visite (mesure, comptage, détail personnel) que ni le titre, ni le listing, ni les autres questions, ni les photos ne permettent de déduire.' },
                                question_translation: { type: 'string', description: 'Traduction de la question dans la langue utilisateur demandée.' },
                                status: { type: 'string', enum: ['ready', 'partial', 'missing'] },
                                answer: { type: 'string', description: 'Meilleure réponse candidate (une estimation explicite y a sa place, jamais une mesure inventée), dans la langue utilisateur demandée.' },
                                reasoning: { type: 'string', description: 'Raisonnement qui justifie la réponse en une ou deux phrases, dans la langue utilisateur demandée.' },
                                basis: { type: 'array', items: { type: 'string', enum: ['observation', 'photo', 'listing', 'geology', 'tool'] }, description: 'Sur quoi repose la réponse candidate.' },
                                evidence_ids: { type: 'array', items: { type: 'string' } },
                                confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                                missing: { type: 'string', description: 'Donnée propre à la visite qui manque encore (mesure, comptage, détail que ni le listing ni les photos ne donnent), dans la langue utilisateur demandée, sans libellé en tête du type « À compléter : ». Vide quand la réponse tient sur le listing ou les photos : une simple confirmation sur place n y a pas sa place. Ne dispense jamais de proposer une réponse.' },
                            },
                            required: ['question', 'status'],
                            additionalProperties: false,
                        },
                    },
                },
                required: ['request_id', 'geocache_id', 'action', 'proposals'],
                additionalProperties: false,
            } as ToolRequestParameters,
            handler: async (argString: string, ctx?: unknown) => {
                try {
                    const args = JSON.parse(argString || '{}') as EarthCoachCapturePayload;
                    const payload: EarthCoachCapturePayload = {
                        request_id: String(args.request_id || ''),
                        geocache_id: Number(args.geocache_id),
                        action: args.action,
                        proposals: Array.isArray(args.proposals) ? args.proposals as EarthCoachResultProposal[] : [],
                    };
                    // La conversation est rattachee des la capture : le lien du
                    // resultat existe meme si la reponse est ensuite interrompue.
                    const sessionId = ChatToolContext.is(ctx) ? ctx.request.session.id : undefined;
                    const result = await this.capture.capture(payload, sessionId);
                    return `Résultat EarthCoach enregistré dans le dossier terrain (résultat ${result.id}).`;
                } catch (error) {
                    return `Échec de l'enregistrement EarthCoach : ${error instanceof Error ? error.message : String(error)}`;
                }
            },
        };
    }

    /**
     * Tour de precision optionnel : quand une mesure de terrain essentielle
     * manque, le modele pose 1 a 3 questions ciblees AVANT la capture et
     * attend la reponse de l'utilisateur dans la meme session (le request_id
     * du dossier reste enregistre). Pas une question de confort : reserve aux
     * donnees qui feraient basculer la reponse.
     */
    protected createAskTool(): ToolRequest {
        return {
            id: EarthCoachResultTools.ASK_TOOL_ID,
            name: 'earthcoach_ask_user',
            description: 'Pose à l utilisateur 1 à 3 questions ciblées quand une donnée de terrain essentielle manque pour répondre. À utiliser AVANT earthcoach_capture_result, puis attendre la réponse dans la session avant de capturer.',
            providerName: 'geoapp.earthcoach',
            parameters: {
                type: 'object',
                properties: {
                    request_id: { type: 'string', description: 'Identifiant immuable fourni dans le dossier terrain.' },
                    geocache_id: { type: 'number', description: 'ID GeoApp fourni dans le dossier.' },
                    questions: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '1 à 3 questions ciblées, dans la langue utilisateur demandée.',
                    },
                },
                required: ['request_id', 'geocache_id', 'questions'],
                additionalProperties: false,
            } as ToolRequestParameters,
            handler: async (argString: string, ctx?: unknown) => {
                try {
                    const args = JSON.parse(argString || '{}') as { request_id?: unknown; geocache_id?: unknown; questions?: unknown };
                    const questions = Array.isArray(args.questions)
                        ? args.questions.map(question => String(question)).filter(question => question.trim())
                        : [];
                    const requestId = String(args.request_id || '');
                    this.capture.markAwaitingInput(requestId, Number(args.geocache_id), questions);
                    // La reponse de l'utilisateur part du chat, hors du bridge :
                    // le tour suivant est suivi depuis la session elle-meme.
                    if (ChatToolContext.is(ctx)) {
                        this.observer.followNextTurn(ctx.request.session, requestId);
                    }
                    return 'Questions transmises à l utilisateur. Attends sa réponse, puis appelle earthcoach_capture_result avec le même request_id.';
                } catch (error) {
                    return `Échec de la demande de précisions : ${error instanceof Error ? error.message : String(error)}`;
                }
            },
        };
    }
}
