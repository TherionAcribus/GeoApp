import { MessageService } from '@theia/core';
import { inject, injectable } from '@theia/core/shared/inversify';
import {
    GeoAppChatResponseEvent,
    GeoAppChatResponseObserver,
} from 'theia-ide-zones-ext/lib/browser/geoapp-chat-shared';
import { EarthCoachResultCaptureService, stripEarthCoachResultBlocks } from './earthcoach-result-capture';

@injectable()
export class EarthCoachResultObserver implements GeoAppChatResponseObserver {
    @inject(EarthCoachResultCaptureService)
    protected readonly capture!: EarthCoachResultCaptureService;

    @inject(MessageService)
    protected readonly messages!: MessageService;

    async handleChatResponse(event: GeoAppChatResponseEvent): Promise<void> {
        // Les generations de reponse finale sont correlees par requestId, pas
        // par titre de session : elles doivent revenir dans le dossier meme si
        // le titre EARTHCOACH FINAL change un jour.
        if (this.capture.isFinalRequest(event.requestId)) {
            try {
                await this.capture.attachFinalAnswer(
                    event.requestId as string,
                    stripEarthCoachResultBlocks(event.text || '')
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
        const visibleMarkdown = stripEarthCoachResultBlocks(event.text || '');
        try {
            // hasRequest() a deja garanti un requestId defini. wasCaptured est
            // lu avant attachMarkdown: l'attachement appelle lui-meme
            // capture() et marquerait la requete comme deja capturee.
            const captured = this.capture.wasCaptured(event.requestId);
            await this.capture.attachMarkdown(event.requestId as string, visibleMarkdown, event.sessionId);
            if (!captured) {
                // Le modele n'a jamais appele l'outil de capture: le
                // dossier a le texte mais aucune proposition structuree.
                this.messages.warn('Le dossier EarthCoach a reçu le texte Markdown, mais aucune proposition structurée : vous pouvez demander à l agent de relancer la capture.');
            }
        } catch (error) {
            console.warn('[EarthCoach] Unable to attach the response to its prepared request', error);
        }
    }
}
