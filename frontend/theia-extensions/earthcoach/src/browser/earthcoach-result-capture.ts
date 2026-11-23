import { Emitter, Event } from '@theia/core';
import { inject, injectable } from '@theia/core/shared/inversify';
import { EarthCoachPreparedRequest, EarthCoachResult, EarthCoachResultProposal } from './earthcoach-workspace-types';
import { EarthCoachWorkspaceService } from './earthcoach-workspace-service';
import { LoggingTask } from './earthcoach-types';
import { splitFinalAnswer } from './earthcoach-prompt-builder';
import {
    EarthCoachRequestTicket,
    EarthCoachRequestTickets,
    photoInstructionTaskIds,
    ticketFromPreparedRequest,
} from './earthcoach-request-tickets';

export interface EarthCoachCapturePayload {
    request_id: string;
    geocache_id: number;
    action: 'analyze' | 'resolve';
    proposals?: EarthCoachResultProposal[];
}

@injectable()
export class EarthCoachResultCaptureService {
    protected readonly requests = new Map<string, EarthCoachPreparedRequest>();
    /** Requetes dont l'outil de capture a ete appele explicitement par le modele. */
    protected readonly capturedRequestIds = new Set<string>();
    protected readonly capturedEmitter = new Emitter<EarthCoachResult>();
    /**
     * Copie legere de chaque requete dans le stockage local : un redemarrage
     * ou un 21e envoi chasse l'instantane, la capture doit rester possible.
     */
    protected tickets = new EarthCoachRequestTickets();

    @inject(EarthCoachWorkspaceService)
    protected readonly workspaceService!: EarthCoachWorkspaceService;

    get onDidCapture(): Event<EarthCoachResult> {
        return this.capturedEmitter.event;
    }

    register(request: EarthCoachPreparedRequest): void {
        this.requests.set(request.requestId, request);
        this.tickets.put(ticketFromPreparedRequest(request));
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
        this.tickets.put({
            requestId,
            geocacheId,
            action: 'resolve',
            photoTaskIds: [],
            finalResultId: resultId,
            createdAt: Date.now(),
        });
    }

    isFinalRequest(requestId: string | undefined): boolean {
        return this.tickets.get(requestId)?.finalResultId !== undefined;
    }

    /** Preparation du log public : correlee au resultat source, comme la reponse finale. */
    registerLogRequest(requestId: string, resultId: number, geocacheId: number): void {
        this.tickets.put({
            requestId,
            geocacheId,
            action: 'resolve',
            photoTaskIds: [],
            logResultId: resultId,
            createdAt: Date.now(),
        });
    }

    isLogRequest(requestId: string | undefined): boolean {
        return this.tickets.get(requestId)?.logResultId !== undefined;
    }

    async attachLogDraft(requestId: string, text: string): Promise<EarthCoachResult> {
        const resultId = this.tickets.get(requestId)?.logResultId;
        if (resultId === undefined) {
            throw new Error('Requête de log EarthCoach introuvable.');
        }
        if (!text.trim()) {
            throw new Error('Log EarthCoach vide : rien à enregistrer.');
        }
        const result = await this.workspaceService.saveLogDraft(resultId, text.trim());
        this.capturedEmitter.fire(result);
        return result;
    }

    /** Requete de dossier (pas de reponse finale) : instantane en memoire, sinon son ticket. */
    protected requestTicket(requestId: string | undefined): EarthCoachRequestTicket | undefined {
        const snapshot = requestId ? this.requests.get(requestId) : undefined;
        if (snapshot) {
            return { ...ticketFromPreparedRequest(snapshot), awaitingInput: this.tickets.get(requestId)?.awaitingInput };
        }
        const ticket = this.tickets.get(requestId);
        return ticket && ticket.finalResultId === undefined && ticket.logResultId === undefined ? ticket : undefined;
    }

    /**
     * Le modele demande des precisions avant la capture (earthcoach_ask_user):
     * la requete reste enregistree, la capture arrive a la reponse de
     * l'utilisateur avec le meme request_id.
     */
    markAwaitingInput(requestId: string, geocacheId: number, questions: string[]): void {
        const ticket = this.requestTicket(requestId);
        if (!ticket) {
            throw new Error('Instantané EarthCoach introuvable pour cette demande de précisions.');
        }
        if (ticket.geocacheId !== geocacheId) {
            throw new Error('La demande de précisions ne correspond pas à la géocache préparée.');
        }
        const cleaned = questions.map(question => question.trim()).filter(Boolean).slice(0, 3);
        if (!cleaned.length) {
            throw new Error('Aucune question de précision fournie.');
        }
        const snapshot = this.requests.get(requestId);
        if (snapshot) {
            snapshot.awaitingInput = cleaned;
        }
        this.tickets.update(requestId, { awaitingInput: true });
    }

    /**
     * L'utilisateur a repondu : ce tour-ci doit capturer. S'il ne le fait pas,
     * l'observateur doit avertir au lieu de croire a une nouvelle attente.
     */
    clearAwaitingInput(requestId: string): void {
        const snapshot = this.requests.get(requestId);
        if (snapshot) {
            snapshot.awaitingInput = undefined;
        }
        this.tickets.update(requestId, { awaitingInput: undefined });
    }

    isAwaitingInput(requestId: string | undefined): boolean {
        return Boolean(this.requestTicket(requestId)?.awaitingInput);
    }

    /**
     * Vrai quand un dossier prepare a enregistre ce requestId avant l'envoi:
     * c'est le critere de correlation de l'observateur de fin de reponse.
     */
    hasRequest(requestId: string | undefined): boolean {
        return this.requestTicket(requestId) !== undefined;
    }

    /**
     * Vrai quand l'outil de capture a ete appele pour cette requete : le
     * Markdown de fin de reponse, attache seul, laisserait le dossier sans
     * propositions.
     */
    wasCaptured(requestId: string | undefined): boolean {
        return Boolean(requestId) && this.capturedRequestIds.has(requestId as string);
    }

    /**
     * Rattache la reponse finale au resultat source : elle reste visible et
     * copiable dans le dossier au lieu de ne vivre que dans la session de chat.
     */
    async attachFinalAnswer(requestId: string, markdown: string): Promise<EarthCoachResult> {
        const resultId = this.tickets.get(requestId)?.finalResultId;
        if (resultId === undefined) {
            throw new Error('Requête de réponse finale EarthCoach introuvable.');
        }
        if (!markdown.trim()) {
            throw new Error('Réponse finale EarthCoach vide : rien à enregistrer.');
        }
        const { message, control } = splitFinalAnswer(markdown);
        const result = await this.workspaceService.saveFinalAnswer(resultId, message, control);
        this.capturedEmitter.fire(result);
        return result;
    }

    /**
     * Attache le Markdown de fin de reponse a la requete qui l'a produite.
     * Correlation stricte par `requestId` : avec plusieurs dossiers envoyes en
     * parallele, attacher "la derniere" requete melangeait les resultats.
     * Ce n'est pas une capture : `wasCaptured` reste faux.
     */
    async attachMarkdown(requestId: string, markdown: string, sessionId?: string): Promise<EarthCoachResult> {
        const ticket = this.requestTicket(requestId);
        if (!ticket) {
            throw new Error('Instantané EarthCoach introuvable pour cette réponse.');
        }
        if (!markdown.trim()) {
            throw new Error('Réponse EarthCoach vide : rien à attacher.');
        }
        return this.store({
            request_id: requestId,
            geocache_id: ticket.geocacheId,
            action: ticket.action,
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

    /** Appel de l'outil `earthcoach_capture_result` par le modele. */
    async capture(payload: EarthCoachCapturePayload, sessionId?: string): Promise<EarthCoachResult> {
        const result = await this.store(payload, { sessionId });
        // Suivi borne comme les autres maps: il distingue en fin de reponse
        // un dossier avec propositions d'un dossier qui n'a recu que le texte.
        this.capturedRequestIds.add(payload.request_id);
        if (this.capturedRequestIds.size > 50) {
            const oldest = this.capturedRequestIds.keys().next().value;
            if (oldest) {
                this.capturedRequestIds.delete(oldest);
            }
        }
        return result;
    }

    protected async store(payload: EarthCoachCapturePayload, options: { markdown?: string; sessionId?: string }): Promise<EarthCoachResult> {
        const snapshot = this.requests.get(payload.request_id);
        const ticket = this.requestTicket(payload.request_id);
        if (!ticket) {
            throw new Error('Instantané EarthCoach introuvable pour cette réponse.');
        }
        if (ticket.geocacheId !== payload.geocache_id) {
            throw new Error('La réponse EarthCoach ne correspond pas à la géocache préparée.');
        }
        if (payload.action !== ticket.action) {
            throw new Error('La réponse EarthCoach ne correspond pas à l action préparée.');
        }
        const proposals = withoutPhotoTaskProposals(payload.proposals || [], ticket.photoTaskIds)
            .map(normalizeCapturedProposal);
        // Reprise ciblee (approfondir / contester): pas de nouveau resultat, la
        // proposition recapturee remplace celle de la meme question dans le
        // resultat existant; le texte visible s y ajoute en Markdown.
        const result = ticket.refine
            ? await this.workspaceService.mergeResultProposal(ticket.refine.resultId, {
                proposal: proposals[0],
                proposalIndex: ticket.refine.proposalIndex,
                markdownAppend: options.markdown,
            })
            // Sans instantane (redemarrage), le backend complete le resultat
            // deja cree pour ce request_id ; a defaut, il part sans contexte.
            : await this.workspaceService.captureResult({
                geocacheId: payload.geocache_id,
                requestId: payload.request_id,
                action: payload.action,
                contextSnapshot: snapshot || {},
                proposals,
                markdown: options.markdown,
                sessionId: options.sessionId,
            });
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
    return withoutPhotoTaskProposals(proposals, photoInstructionTaskIds(loggingTasks));
}

export function withoutPhotoTaskProposals(proposals: EarthCoachResultProposal[], photoTaskIds: string[]): EarthCoachResultProposal[] {
    if (!photoTaskIds.length) {
        return proposals;
    }
    const ids = new Set(photoTaskIds);
    return proposals.filter(proposal => proposal.task_id === undefined || proposal.task_id === null || !ids.has(String(proposal.task_id)));
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
