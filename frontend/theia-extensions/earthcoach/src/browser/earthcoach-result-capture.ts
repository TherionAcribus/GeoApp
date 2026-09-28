import { Emitter, Event } from '@theia/core';
import { inject, injectable } from '@theia/core/shared/inversify';
import { EarthCoachPreparedRequest, EarthCoachResult, EarthCoachResultProposal } from './earthcoach-workspace-types';
import { EarthCoachWorkspaceService } from './earthcoach-workspace-service';

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

    /**
     * Repli pour les evenements anciens qui ne transportent pas encore de
     * `requestId`. Ne pas l'utiliser pour les nouveaux envois.
     */
    async attachLatestMarkdown(markdown: string, sessionId?: string): Promise<EarthCoachResult | undefined> {
        const requests = Array.from(this.requests.values());
        const snapshot = requests[requests.length - 1];
        if (!snapshot || !markdown.trim()) {
            return undefined;
        }
        return this.capture({
            request_id: snapshot.requestId,
            geocache_id: snapshot.geocacheId,
            action: snapshot.action === 'resolve' ? 'resolve' : 'analyze',
            proposals: [],
        }, { markdown, sessionId });
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
        const result = await this.workspaceService.captureResult({
            geocacheId: payload.geocache_id,
            requestId: payload.request_id,
            action: payload.action,
            contextSnapshot: snapshot,
            proposals: payload.proposals || [],
            markdown: options.markdown,
            sessionId: options.sessionId,
        });
        this.capturedEmitter.fire(result);
        return result;
    }
}

export function extractEarthCoachResultBlock(markdown: string): EarthCoachCapturePayload | undefined {
    const pattern = /```earthcoach-result\s*\n([\s\S]*?)\n?```/gi;
    let latest: EarthCoachCapturePayload | undefined;
    let match = pattern.exec(markdown || '');
    while (match) {
        try {
            const parsed = JSON.parse(match[1]) as EarthCoachCapturePayload;
            if (
                parsed && typeof parsed.request_id === 'string' &&
                Number.isInteger(parsed.geocache_id) &&
                (parsed.action === 'analyze' || parsed.action === 'resolve')
            ) {
                latest = parsed;
            }
        } catch {
            // Un bloc invalide ne doit pas masquer un éventuel bloc valide suivant.
        }
        match = pattern.exec(markdown || '');
    }
    return latest;
}

export function stripEarthCoachResultBlocks(markdown: string): string {
    return (markdown || '').replace(/```earthcoach-result\s*\n[\s\S]*?\n?```/gi, '').trim();
}
