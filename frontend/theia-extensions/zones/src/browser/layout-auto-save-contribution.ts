import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, FrontendApplication, ApplicationShell } from '@theia/core/lib/browser';
import { ShellLayoutRestorer } from '@theia/core/lib/browser/shell/shell-layout-restorer';

/**
 * Sauvegarde automatiquement le layout Theia quand des onglets sont ouverts ou fermés.
 *
 * Par défaut, Theia ne sauvegarde le layout qu'à la fermeture de la fenêtre (événement `unload`).
 * Si l'utilisateur ferme un onglet puis que le serveur est redémarré sans fermer le navigateur,
 * le layout n'est pas mis à jour et les anciens onglets réapparaissent.
 *
 * Ce contribution écoute onDidAddWidget/onDidRemoveWidget et sauvegarde le layout avec un debounce
 * de 2 secondes pour éviter des sauvegardes trop fréquentes.
 */
@injectable()
export class LayoutAutoSaveContribution implements FrontendApplicationContribution {

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(ShellLayoutRestorer)
    protected readonly layoutRestorer: ShellLayoutRestorer;

    private app: FrontendApplication | undefined;
    private saveTimer: ReturnType<typeof setTimeout> | undefined;

    onStart(app: FrontendApplication): void {
        this.app = app;

        this.shell.onDidAddWidget(() => this.scheduleSave());
        this.shell.onDidRemoveWidget(() => this.scheduleSave());
    }

    private scheduleSave(): void {
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
