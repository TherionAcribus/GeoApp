import { injectable, inject } from '@theia/core/shared/inversify';
import { DisposableCollection } from '@theia/core/lib/common';
import { FrontendApplicationContribution, FrontendApplication, ApplicationShell } from '@theia/core/lib/browser';
import { ShellLayoutRestorer } from '@theia/core/lib/browser/shell/shell-layout-restorer';

/**
 * Sauvegarde automatiquement le layout Theia quand des onglets sont ouverts ou fermés.
 *
 * Par défaut, Theia ne sauvegarde le layout qu'à la fermeture de la fenêtre (événement `unload`).
 * Si l'utilisateur ferme un onglet puis que le serveur est redémarré sans fermer le navigateur,
 * le layout n'est pas mis à jour et les anciens onglets réapparaissent.
 *
 * Les listeners ne sont installés qu'après `onDidInitializeLayout` : Theia exécute tous les
 * `onStart` avant la restauration du layout, et un démarrage lent pouvait laisser le debounce
 * stocker un layout partiellement restauré par-dessus le layout complet (spec §3.3.A).
 */
@injectable()
export class LayoutAutoSaveContribution implements FrontendApplicationContribution {

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(ShellLayoutRestorer)
    protected readonly layoutRestorer: ShellLayoutRestorer;

    private app: FrontendApplication | undefined;
    private saveTimer: ReturnType<typeof setTimeout> | undefined;
    /** Vrai seulement après l'inflation/restauration complète du layout. */
    private layoutInitialized = false;
    private readonly toDispose = new DisposableCollection();

    onStart(app: FrontendApplication): void {
        this.app = app;
    }

    onDidInitializeLayout(app: FrontendApplication): void {
        this.app = app;
        this.layoutInitialized = true;
        this.toDispose.pushAll([
            this.shell.onDidAddWidget(() => this.scheduleSave()),
            this.shell.onDidRemoveWidget(() => this.scheduleSave()),
        ]);
    }

    onStop(): void {
        if (this.saveTimer !== undefined) {
            clearTimeout(this.saveTimer);
            this.saveTimer = undefined;
            // Dernière chance : onStop précède l'unload de la fenêtre.
            this.saveLayout();
        }
        this.toDispose.dispose();
    }

    /**
     * Demande explicite de sauvegarde (contrôleur des barres latérales après une
     * action utilisateur aboutie). Sans effet avant la fin de l'initialisation.
     */
    requestSave(): void {
        this.scheduleSave();
    }

    private scheduleSave(): void {
        if (!this.layoutInitialized) {
            return;
        }
        if (this.saveTimer !== undefined) {
            clearTimeout(this.saveTimer);
        }
        this.saveTimer = setTimeout(() => {
            this.saveTimer = undefined;
            this.saveLayout();
        }, 2000);
    }

    private saveLayout(): void {
        if (this.app) {
            try {
                this.layoutRestorer.storeLayout(this.app);
            } catch (e) {
                console.error('[LayoutAutoSave] Erreur lors de la sauvegarde du layout:', e);
            }
        }
    }
}
