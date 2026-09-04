/**
 * Signale qu'une sortie vient d'être capturée, et propose d'ouvrir la checklist.
 *
 * Sans ce fil, le panneau existerait sans que personne ne sache qu'il s'est rempli :
 * l'utilisateur regarde le chat pendant la génération, pas la barre de commandes.
 *
 * Le double appel est le cas nominal, pas l'exception. Le prompt système demande au modèle
 * **et** le tool **et** le bloc JSON : une même sortie est donc souvent capturée deux fois
 * à quelques secondes d'intervalle, la seconde écriture remplaçant simplement la première.
 * Notifier deux fois serait du bruit, d'où la fenêtre de silence par plan.
 */

import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandService, MessageService } from '@theia/core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { OutingPlanCaptureService } from './outing-plan-capture';
import { OutingPlanCommandId } from './outing-plan-widget';

/** Deux captures du même plan plus rapprochées que ça sont les deux voies d'une même analyse. */
const DUPLICATE_WINDOW_MS = 60_000;

@injectable()
export class OutingPlanNotificationContribution implements FrontendApplicationContribution {

    @inject(OutingPlanCaptureService)
    protected readonly capture!: OutingPlanCaptureService;

    @inject(MessageService)
    protected readonly messages!: MessageService;

    @inject(CommandService)
    protected readonly commands!: CommandService;

    protected lastNotifiedPlanId?: number;
    protected lastNotifiedAt = 0;

    onStart(): void {
        this.capture.onDidCapture(result => {
            const now = Date.now();
            const isRepeat = result.plan.id === this.lastNotifiedPlanId
                && now - this.lastNotifiedAt < DUPLICATE_WINDOW_MS;
            if (isRepeat) {
                return;
            }
            this.lastNotifiedPlanId = result.plan.id;
            this.lastNotifiedAt = now;

            const plan = result.plan.plan;
            const zone = result.plan.zone_name || 'sélection';
            void this.messages.info(
                `Sortie « ${zone} » du ${result.plan.outing_date} : `
                + `${plan.checklist.length} ligne(s) de checklist, ${plan.alerts.length} alerte(s).`,
                'Ouvrir la checklist'
            ).then(action => {
                if (action) {
                    void this.commands.executeCommand(OutingPlanCommandId);
                }
            });
        });
    }
}
