import { MessageService } from '@theia/core';
import { inject, injectable } from '@theia/core/shared/inversify';
import {
    GeoAppChatResponseEvent,
    GeoAppChatResponseObserver,
} from 'theia-ide-zones-ext/lib/browser/geoapp-chat-shared';
import { EarthCoachResultCaptureService, extractEarthCoachResultBlock, stripEarthCoachResultBlocks } from './earthcoach-result-capture';

@injectable()
export class EarthCoachResultObserver implements GeoAppChatResponseObserver {
    @inject(EarthCoachResultCaptureService)
    protected readonly capture!: EarthCoachResultCaptureService;

    @inject(MessageService)
    protected readonly messages!: MessageService;

    async handleChatResponse(event: GeoAppChatResponseEvent): Promise<void> {
        const title = event.sessionTitle || '';
        if (!title.startsWith('EARTHCOACH ANALYSE') && !title.startsWith('EARTHCOACH RÉSOLUTION')) {
            return;
        }
        const payload = extractEarthCoachResultBlock(event.text || '');
        const visibleMarkdown = stripEarthCoachResultBlocks(event.text || '');
        if (!payload) {
            try {
                await this.capture.attachLatestMarkdown(visibleMarkdown, event.sessionId);
            } catch (error) {
                console.warn('[EarthCoach] Unable to attach the response to the latest prepared request', error);
            }
            return;
        }
        try {
            await this.capture.capture(payload, { markdown: visibleMarkdown, sessionId: event.sessionId });
        } catch (error) {
            console.warn('[EarthCoach] Unable to capture structured result block', error);
            this.messages.warn('La réponse EarthCoach reste dans le chat, mais sa capture structurée a échoué.');
        }
    }
}
