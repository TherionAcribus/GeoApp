import { Emitter, Event } from '@theia/core';
import { inject, injectable } from '@theia/core/shared/inversify';
import { EarthCoachPreparedRequest, EarthCoachResult, EarthCoachResultProposal } from './earthcoach-workspace-types';
import { EarthCoachWorkspaceService } from './earthcoach-workspace-service';
import { LoggingTask } from './earthcoach-types';

export interface EarthCoachCapturePayload {
    request_id: string;
    geocache_id: number;
    action: 'analyze' | 'resolve';
    proposals?: EarthCoachResultProposal[];
}

interface EarthCoachFinalRequest {
    resultId: number;
    geocacheId: number;
}

@injectable()
export class EarthCoachResultCaptureService {
    protected readonly requests = new Map<string, EarthCoachPreparedRequest>();
    /** Requetes de generation de la reponse finale, correlees au resultat source. */
    protected readonly finalRequests = new Map<string, EarthCoachFinalRequest>();
    /** Requetes dont une capture a effectivement produit des propositions. */
    protected readonly capturedRequestIds = new Set<string>();
    protected readonly capturedEmitter = new Emitter<EarthCoachResult>();

    @inject(EarthCoachWorkspaceService)
    protected readonly workspaceService!: EarthCoachWorkspaceService;

    get onDidCapture(): Event<EarthCoachResult> {
        return this.capturedEmitter.event;
    }

    register(request: EarthCoachPreparedRequest): void {
        this.requests.set(request.requestId, request);
        if (this.requests.size > 20) {
            const oldest = this.requests.keys().next().value;
            if (oldest) {
                this.requests.delete(oldest);
            }
        }
    }

    /**
     * Une generation de reponse finale n'est pas un dossier prepare : elle est
     * correlee directement au resultat dont elle derive. Le `requestId` envoye
     * avec le dispatch revient dans l'evenement de fin de reponse.
     */
    registerFinalRequest(requestId: string, resultId: number, geocacheId: number): void {
        this.finalRequests.set(requestId, { resultId, geocacheId });
        if (this.finalRequests.size > 20) {
            const oldest = this.finalRequests.keys().next().value;
            if (oldest) {
                this.finalRequests.delete(oldest);
            }
        }
    }

    isFinalRequest(requestId: string | undefined): boolean {
        return Boolean(requestId) && this.finalRequests.has(requestId as string);
    }

    /**
     * Le modele demande des precisions avant la capture (earthcoach_ask_user):
     * la requete reste enregistree, la capture arrive a la reponse de
     * l'utilisateur avec le meme request_id.
     */
    markAwaitingInput(requestId: string, geocacheId: number, questions: string[]): void {
        const snapshot = this.requests.get(requestId);
        if (!snapshot) {
            throw new Error('Instantané EarthCoach introuvable pour cette demande de précisions.');
        }
        if (snapshot.geocacheId !== geocacheId) {
            throw new Error('La demande de précisions ne correspond pas à la géocache préparée.');
        }
        const cleaned = questions.map(question => question.trim()).filter(Boolean).slice(0, 3);
        if (!cleaned.length) {
            throw new Error('Aucune question de précision fournie.');
        }
        snapshot.awaitingInput = cleaned;
    }

    isAwaitingInput(requestId: string | undefined): boolean {
        const snapshot = requestId ? this.requests.get(requestId) : undefined;
        return Boolean(snapshot?.awaitingInput?.length);
    }

    /**
     * Vrai quand un dossier prepare a enregistre ce requestId avant l'envoi:
     * c'est le critere de correlation de l'observateur de fin de reponse.
     */
    hasRequest(requestId: string | undefined): boolean {
        return Boolean(requestId) && this.requests.has(requestId as string);
    }

    /**
     * Vrai quand l'outil de capture a deja enregistre des propositions pour
     * cette requete : un attachement Markdown seul, sans capture prealable,
     * laisserait le dossier sans propositions.
     */
    wasCaptured(requestId: string | undefined): boolean {
        return Boolean(requestId) && this.capturedRequestIds.has(requestId as string);
    }

    /**
     * Rattache la reponse finale au resultat source : elle reste visible et
     * copiable dans le dossier au lieu de ne vivre que dans la session de chat.
     */
    async attachFinalAnswer(requestId: string, markdown: string): Promise<EarthCoachResult> {
        const target = this.finalRequests.get(requestId);
        if (!target) {
            throw new Error('Requête de réponse finale EarthCoach introuvable.');
        }
        if (!markdown.trim()) {
            throw new Error('Réponse finale EarthCoach vide : rien à enregistrer.');
        }
        const result = await this.workspaceService.saveFinalAnswer(target.resultId, markdown);
        this.capturedEmitter.fire(result);
        return result;
    }

    /**
     * Attache le Markdown de fin de reponse a la requete qui l'a produite.
     * Correlation stricte par `requestId` : avec plusieurs dossiers envoyes en
     * parallele, attacher "la derniere" requete melangeait les resultats.
     */
    async attachMarkdown(requestId: string, markdown: string, sessionId?: string): Promise<EarthCoachResult> {
        const snapshot = this.requests.get(requestId);
        if (!snapshot) {
            throw new Error('Instantané EarthCoach introuvable pour cette réponse.');
        }
        if (!markdown.trim()) {
            throw new Error('Réponse EarthCoach vide : rien à attacher.');
        }
        return this.capture({
            request_id: snapshot.requestId,
            geocache_id: snapshot.geocacheId,
            action: snapshot.action === 'resolve' ? 'resolve' : 'analyze',
            proposals: [],
        }, { markdown, sessionId });
    }

    /**
     * Le bridge chat reteste chaque image a l'envoi (decodage puis reencodage):
     * une image qui echoue a cette derniere etape n'a jamais atteint le modele.
     * On la sort de `images`/`groups` et on la bascule dans `unavailableImages`
     * pour que l'instantane corresponde a ce que le modele a reellement vu.
     */
    markImagesUntransmitted(requestId: string, failedIds: string[], reason: string): boolean {
        const snapshot = this.requests.get(requestId);
        if (!snapshot || !failedIds.length) {
            return false;
        }
        const failed = new Set(failedIds.map(String));
        const lost = snapshot.images.filter(image => failed.has(String(image.id)));
        if (!lost.length) {
            return false;
        }
        snapshot.images = snapshot.images.filter(image => !failed.has(String(image.id)));
        snapshot.groups = snapshot.groups
            .map(group => ({
                ...group,
                members: group.members.filter(member => !failed.has(String(member.image_id))),
            }))
            .filter(group => group.members.length > 0);
        snapshot.unavailableImages = [
            ...snapshot.unavailableImages,
            ...lost.map(image => ({ id: image.id, label: image.label, reason })),
        ];
        return true;
    }

    async capture(payload: EarthCoachCapturePayload, options: { markdown?: string; sessionId?: string } = {}): Promise<EarthCoachResult> {
        const snapshot = this.requests.get(payload.request_id);
        if (!snapshot) {
            throw new Error('Instantané EarthCoach introuvable pour cette réponse.');
        }
        if (snapshot.geocacheId !== payload.geocache_id) {
            throw new Error('La réponse EarthCoach ne correspond pas à la géocache préparée.');
        }
        const expectedAction = snapshot.action === 'resolve' ? 'resolve' : 'analyze';
        if (payload.action !== expectedAction) {
            throw new Error('La réponse EarthCoach ne correspond pas à l action préparée.');
        }
        const proposals = withoutPhotoInstructionProposals(payload.proposals || [], snapshot.loggingTasks)
            .map(normalizeCapturedProposal);
        // Reprise ciblee (approfondir / contester): pas de nouveau resultat, la
        // proposition recapturee remplace celle de la meme question dans le
        // resultat existant; le texte visible s y ajoute en Markdown.
        const result = snapshot.refine
            ? await this.workspaceService.mergeResultProposal(snapshot.refine.resultId, {
                proposal: proposals[0],
                proposalIndex: snapshot.refine.proposalIndex,
                markdownAppend: options.markdown,
            })
            : await this.workspaceService.captureResult({
                geocacheId: payload.geocache_id,
                requestId: payload.request_id,
                action: payload.action,
                contextSnapshot: snapshot,
                proposals,
                markdown: options.markdown,
                sessionId: options.sessionId,
            });
        // Suivi borne comme les autres maps: il distingue en fin de reponse
        // un dossier avec propositions d'un dossier qui n'a recu que le texte.
        this.capturedRequestIds.add(payload.request_id);
        if (this.capturedRequestIds.size > 50) {
            const oldest = this.capturedRequestIds.keys().next().value;
            if (oldest) {
                this.capturedRequestIds.delete(oldest);
            }
        }
        this.capturedEmitter.fire(result);
        return result;
    }
}

/**
 * Masque ce qui n'est pas la synthese: bloc ```earthcoach-result perdu,
 * et la reflexion et les appels d'outils que d'anciennes versions
 * enregistraient avec le texte (serialisation `asDisplayString` de Theia).
 */
export function stripEarthCoachResultBlocks(markdown: string): string {
    return (markdown || '')
        .replace(/```earthcoach-result\s*\n[\s\S]*?\n?```/gi, '')
        .replace(/<Thinking>[\s\S]*?<\/Thinking>/g, '')
        .replace(/^Tool call: [a-z0-9_]+\(.*\)\s*$/gim, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Une consigne photo n'est pas une question : une proposition qui la vise
 * (le modele en produit parfois malgre la consigne) ressortirait « Manquante ».
 */
export function withoutPhotoInstructionProposals(
    proposals: EarthCoachResultProposal[],
    loggingTasks: LoggingTask[]
): EarthCoachResultProposal[] {
    const photoTaskIds = new Set(loggingTasks
        .filter(task => task.kind === 'photo')
        .map(task => String(task.id).replace(/^logging-task-/, '')));
    if (!photoTaskIds.size) {
        return proposals;
    }
    return proposals.filter(proposal => proposal.task_id === undefined || proposal.task_id === null || !photoTaskIds.has(String(proposal.task_id)));
}

/** Libelles que le modele ajoute en tete de `missing`, deja titre « Elements a completer ». */
const MISSING_LABEL_PATTERN = /^[ \t]*(?:to complete|still needed|missing|[àa] compl[ée]ter|reste [àa] (?:faire|relever)|zu erg[äa]nzen|por completar|da completare|aan te vullen|a completar)[ \t]*:[ \t]*/gim;

/** Retire de `missing` le libelle redondant, ligne par ligne. */
export function normalizeCapturedProposal(proposal: EarthCoachResultProposal): EarthCoachResultProposal {
    if (!proposal.missing) {
        return proposal;
    }
    return { ...proposal, missing: proposal.missing.replace(MISSING_LABEL_PATTERN, '').trim() || null };
}

/**
 * Le prompt systeme impose la ligne de badge en tete de chaque reponse: elle
 * n'a pas sa place dans le message final copie pour le proprietaire.
 */
export function stripEarthCoachModeBadge(markdown: string): string {
    return (markdown || '').replace(/^\s*\*\*Mode EarthCoach :[^\n]*(?:\n|$)/, '').trim();
}
