import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandService, MessageService } from '@theia/core';
import { FrontendApplicationContribution, WidgetManager } from '@theia/core/lib/browser';
import { StatusBar, StatusBarAlignment } from '@theia/core/lib/browser/status-bar/status-bar';
import { GeoAppAiSetupService, GeoAppAiSetupStatus } from './geoapp-ai-setup-service';
import { GeoAppAiSetupCommandId } from './geoapp-ai-setup-widget';

const STATUS_BAR_ENTRY_ID = 'geoapp-ai-setup-status';
/** Identifiant du widget d'accueil de Theia, qui porte déjà le bandeau de rappel. */
const GETTING_STARTED_WIDGET_ID = 'getting.started.widget';

/**
 * Rappelle que l'IA n'est pas configurée : élément de barre d'état tant que c'est le cas, et
 * notification unique par session quand la page d'accueil (qui affiche son propre bandeau)
 * n'est pas ouverte. Jamais de fenêtre modale.
 */
@injectable()
export class GeoAppAiSetupReminderContribution implements FrontendApplicationContribution {

    @inject(GeoAppAiSetupService)
    protected readonly setupService!: GeoAppAiSetupService;

    @inject(StatusBar)
    protected readonly statusBar!: StatusBar;

    @inject(MessageService)
    protected readonly messages!: MessageService;

    @inject(CommandService)
    protected readonly commandService!: CommandService;

    @inject(WidgetManager)
    protected readonly widgetManager!: WidgetManager;

    protected notified = false;

    onStart(): void {
        // Avant whenSettled, les fournisseurs n'ont pas fini d'enregistrer leurs modèles :
        // l'état « non prêt » serait un faux positif.
        this.setupService.whenSettled.then(async () => {
            this.setupService.onDidChangeStatus(status => this.updateStatusBar(status));
            const status = await this.setupService.getStatus();
            this.updateStatusBar(status);
            this.notifyOnce(status);
        }).catch(error => console.debug('[GeoAppAiSetup] rappel indisponible', error));
    }

    protected shouldRemind(status: GeoAppAiSetupStatus): boolean {
        return !status.ready && status.aiEnabled && !status.dismissed;
    }

    protected updateStatusBar(status: GeoAppAiSetupStatus): void {
        if (!this.shouldRemind(status)) {
            void this.statusBar.removeElement(STATUS_BAR_ENTRY_ID);
            return;
        }
        void this.statusBar.setElement(STATUS_BAR_ENTRY_ID, {
            text: '$(sparkle) IA à configurer',
            tooltip: 'L\'IA de GeoApp n\'est pas encore configurée. Cliquez pour ouvrir l\'assistant.',
            alignment: StatusBarAlignment.LEFT,
            priority: 1,
            command: GeoAppAiSetupCommandId,
        });
    }

    protected notifyOnce(status: GeoAppAiSetupStatus): void {
        if (this.notified || !this.shouldRemind(status)) {
            return;
        }
        this.notified = true;
        const welcome = this.widgetManager.tryGetWidget(GETTING_STARTED_WIDGET_ID);
        if (welcome?.isVisible) {
            return;
        }
        const configure = 'Configurer';
        const never = 'Ne plus proposer';
        this.messages.info('L\'IA de GeoApp n\'est pas encore configurée.', configure, 'Plus tard', never).then(choice => {
            if (choice === configure) {
                return this.commandService.executeCommand(GeoAppAiSetupCommandId);
            }
            if (choice === never) {
                return this.setupService.setDismissed(true);
            }
            return undefined;
        }).catch(error => console.debug('[GeoAppAiSetup] notification', error));
    }
}
