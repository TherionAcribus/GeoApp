/**
 * Le filet de la capture : lire la réponse quand le tool n'a pas suffi.
 *
 * Deux choses distinctes s'y jouent, et il faut les tenir séparées.
 *
 * 1. **Le repêchage du plan.** Si la réponse porte un bloc JSON de plan, il est enregistré,
 *    que le tool ait fonctionné ou non. Les deux voies écrivent la même clé — zone et date
 *    de la sortie — donc la seconde écriture remplace la première au lieu de la doubler.
 *    Le prompt système demande les deux exprès : un modèle qui oublie le tool reste
 *    exploitable, et un modèle qui l'appelle ne perd rien à écrire aussi le bloc.
 * 2. **L'attache du rapport rédigé.** Le tool ne transmet que la structure ; le texte, lui,
 *    n'existe que dans la conversation. C'est pourtant lui qu'on exporte en Markdown. Quand
 *    le plan est déjà là et sans texte, on le lui attache sans rien réécrire d'autre.
 *
 * L'observateur ne s'active que sur une session d'analyse de sortie. Sans ce filtre, il
 * relirait chaque réponse du chat pour y chercher un bloc qui n'a aucune raison d'y être.
 */

import { inject, injectable } from '@theia/core/shared/inversify';
import { MessageService } from '@theia/core';
import { GeoAppChatResponseEvent, GeoAppChatResponseObserver } from './geoapp-chat-shared';
import { GEOAPP_OUTING_ANALYZER_AGENT_ID } from './outing-analysis-types';
import { OutingPlanCaptureService, extractOutingPlanBlock } from './outing-plan-capture';
import { OutingPlanService } from './outing-plan-service';

/** Préfixe du titre de session posé par `OutingAnalysisController.buildSessionTitle()`. */
export const OUTING_SESSION_TITLE_PREFIX = 'SORTIE - ';

@injectable()
export class OutingPlanResponseObserver implements GeoAppChatResponseObserver {

    @inject(OutingPlanCaptureService)
    protected readonly capture!: OutingPlanCaptureService;

    @inject(OutingPlanService)
    protected readonly planService!: OutingPlanService;

    @inject(MessageService)
    protected readonly messages!: MessageService;

    async handleChatResponse(event: GeoAppChatResponseEvent): Promise<void> {
        if (!isOutingSession(event)) {
            return;
        }

        const text = event.text || '';
        const block = extractOutingPlanBlock(text);

        if (block) {
            try {
                const result = await this.capture.capture(block, { source: 'parsed', markdown: text });
                result.warnings.forEach(warning => this.messages.warn(warning));
                return;
            } catch (error) {
                console.error('[OutingPlanResponseObserver] Plan repêché mais non enregistré', error);
                // On continue : le tool a peut-être réussi, et le texte reste à attacher.
            }
        }

        await this.attachMarkdownToExistingPlan(text);
    }

    /**
     * Attache le texte au plan de la sortie courante, s'il en existe un sans texte.
     *
     * Aucun plan trouvé n'est le cas normal quand le modèle n'a ni appelé le tool ni écrit
     * de bloc : il n'y a alors rien à sauver, et le rapport reste consultable dans la
     * conversation. Ce n'est pas une erreur à remonter à l'utilisateur.
     */
    protected async attachMarkdownToExistingPlan(text: string): Promise<void> {
        if (!text.trim()) {
            return;
        }

        const context = this.capture.resolveContext([]);
        if (!context) {
            return;
        }

        try {
            const plans = await this.planService.listPlans({
                outingDate: context.outingDate,
                zoneName: context.zoneName,
                limit: 1,
            });
            const plan = plans[0];
            if (plan) {
                await this.planService.attachMarkdown(plan.id, text);
            }
        } catch (error) {
            console.warn('[OutingPlanResponseObserver] Rapport non attaché au plan', error);
        }
    }
}

/**
 * Reconnaît une session d'analyse de sortie.
 *
 * L'agent épinglé est le critère sûr ; le titre sert de repli, parce qu'une session
 * reprise peut avoir perdu son épinglage tout en restant, pour l'utilisateur, la même
 * préparation de sortie.
 */
export function isOutingSession(event: GeoAppChatResponseEvent): boolean {
    return event.agentId === GEOAPP_OUTING_ANALYZER_AGENT_ID
        || (event.sessionTitle || '').startsWith(OUTING_SESSION_TITLE_PREFIX);
}
