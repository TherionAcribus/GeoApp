import { Disposable, MessageService } from '@theia/core';
import { inject, injectable } from '@theia/core/shared/inversify';
import { ChatModel, ChatResponseModel } from '@theia/ai-chat/lib/common/chat-model';
import {
    collectAuthoredResponseText,
    GeoAppChatResponseEvent,
    GeoAppChatResponseObserver,
} from 'theia-ide-zones-ext/lib/browser/geoapp-chat-shared';
import { EarthCoachResultCaptureService, stripEarthCoachModeBadge, stripEarthCoachResultBlocks } from './earthcoach-result-capture';

/** Texte redige seul: la reflexion et les appels d'outils n'ont pas leur place dans le dossier. */
function authoredText(event: GeoAppChatResponseEvent): string {
    return event.markdown ?? event.text ?? '';
}

/** Resout `true` quand la reponse aboutit, `false` si elle est annulee ou en erreur. */
function whenResponseSettles(response: ChatResponseModel): Promise<boolean> {
    return new Promise(resolve => {
        let listener: Disposable | undefined;
        const check = (): void => {
            if (response.isComplete || response.isCanceled || response.isError) {
                listener?.dispose();
                resolve(response.isComplete && !response.isCanceled && !response.isError);
            }
        };
        listener = response.onDidChange(check);
        check();
    });
}

@injectable()
export class EarthCoachResultObserver implements GeoAppChatResponseObserver {
    @inject(EarthCoachResultCaptureService)
    protected readonly capture!: EarthCoachResultCaptureService;

    @inject(MessageService)
    protected readonly messages!: MessageService;

    /** Requetes dont le tour suivant est deja suivi (un seul abonnement par attente). */
    protected readonly followedRequests = new Set<string>();

    async handleChatResponse(event: GeoAppChatResponseEvent): Promise<void> {
        // Les generations de reponse finale sont correlees par requestId, pas
        // par titre de session : elles doivent revenir dans le dossier meme si
        // le titre EARTHCOACH FINAL change un jour.
        if (this.capture.isFinalRequest(event.requestId)) {
            try {
                await this.capture.attachFinalAnswer(
                    event.requestId as string,
                    stripEarthCoachModeBadge(stripEarthCoachResultBlocks(authoredText(event)))
                );
            } catch (error) {
                console.warn('[EarthCoach] Unable to attach the final answer to its result', error);
                this.messages.warn('La réponse finale reste dans le chat, mais son rattachement au dossier a échoué.');
            }
            return;
        }
        // Correlation stricte par requestId : tout envoi de dossier enregistre
        // sa requete avant le dispatch, ce qui rend le filtrage par titre de
        // session (EARTHCOACH ANALYSE / RESOLUTION) inutile et fragile.
        if (!this.capture.hasRequest(event.requestId)) {
            return;
        }
        const visibleMarkdown = stripEarthCoachResultBlocks(authoredText(event));
        try {
            // hasRequest() a deja garanti un requestId defini.
            const captured = this.capture.wasCaptured(event.requestId);
            await this.capture.attachMarkdown(event.requestId as string, visibleMarkdown, event.sessionId);
            if (!captured) {
                if (this.capture.isAwaitingInput(event.requestId)) {
                    // Tour de precision: le modele pose des questions avant la
                    // capture, ce n est pas un oubli de propositions.
                    this.messages.info('EarthCoach attend vos précisions dans le chat pour finaliser le dossier.');
                } else {
                    // Le modele n'a jamais appele l'outil de capture: le
                    // dossier a le texte mais aucune proposition structuree.
                    this.messages.warn('Le dossier EarthCoach a reçu le texte Markdown, mais aucune proposition structurée : vous pouvez demander à l agent de relancer la capture.');
                }
            }
        } catch (error) {
            console.warn('[EarthCoach] Unable to attach the response to its prepared request', error);
        }
    }

    /**
     * Apres un tour de precision (earthcoach_ask_user), l'utilisateur repond
     * directement dans le chat : le bridge ne voit pas cette requete, qu'il
     * n'a pas envoyee. On suit donc le tour suivant de la session pour y
     * rattacher le texte et signaler une capture oubliee.
     */
    followNextTurn(session: ChatModel, requestId: string): void {
        if (this.followedRequests.has(requestId)) {
            return;
        }
        this.followedRequests.add(requestId);
        const listener = session.onDidChange(event => {
            if (event.kind !== 'addRequest') {
                return;
            }
            listener.dispose();
            this.followedRequests.delete(requestId);
            // Ce tour doit capturer ; s'il repose des questions, l'outil
            // remettra lui-meme l'attente.
            this.capture.clearAwaitingInput(requestId);
            const response = event.request.response;
            void whenResponseSettles(response).then(completed => {
                if (!completed) {
                    return;
                }
                return this.handleChatResponse({
                    sessionId: session.id,
                    sessionTitle: '',
                    requestId,
                    text: response.response.asDisplayString(),
                    markdown: collectAuthoredResponseText(response.response.content),
                });
            });
        });
    }
}
