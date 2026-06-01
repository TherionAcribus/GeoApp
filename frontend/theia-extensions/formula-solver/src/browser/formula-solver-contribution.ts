/**
 * Contribution Theia pour Formula Solver
 * Enregistre les commandes, menus et bindings
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import { AbstractViewContribution, ApplicationShell, FrontendApplicationContribution, FrontendApplication, WidgetManager } from '@theia/core/lib/browser';
import { FormulaSolverWidget } from './formula-solver-widget';
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { CommonMenus } from '@theia/core/lib/browser/common-frontend-contribution';

export const FormulaSolverCommand: Command = {
    id: 'formula-solver:open',
    label: 'Formula Solver: Ouvrir'
};

export const FormulaSolverToggleCommand: Command = {
    id: 'formula-solver:toggle',
    label: 'Formula Solver'
};

export const FormulaSolverSolveFromGeocacheCommand: Command = {
    id: 'formula-solver:solve-from-geocache',
    label: 'Résoudre la formule'
};

@injectable()
export class FormulaSolverContribution
    extends AbstractViewContribution<FormulaSolverWidget>
    implements FrontendApplicationContribution, CommandContribution, MenuContribution, TabBarToolbarContribution {

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    @inject(WidgetManager)
    protected readonly widgetManager!: WidgetManager;

    constructor() {
        super({
            widgetId: FormulaSolverWidget.ID,
            widgetName: FormulaSolverWidget.LABEL,
            defaultWidgetOptions: {
                area: 'right',
                rank: 500
            },
            toggleCommandId: FormulaSolverToggleCommand.id
        });
    }

    async onStart(app: FrontendApplication): Promise<void> {
        console.log('[FORMULA-SOLVER] Contribution started');
        // Migration: déplacer le widget vers le panel droit s'il est à gauche
        setTimeout(() => this.migrateToRightPanel(), 2000);
    }

    protected async migrateToRightPanel(): Promise<void> {
        try {
            const widget = this.widgetManager.tryGetWidget(FormulaSolverWidget.ID);
            if (widget && widget.isAttached) {
                const currentArea = this.shell.getAreaFor(widget);
                if (currentArea === 'left') {
                    console.log('[FORMULA-SOLVER] Migration: déplacement du widget de left vers right');
                    this.shell.addWidget(widget, { area: 'right', rank: 500 });
                    this.shell.activateWidget(FormulaSolverWidget.ID);
                }
            } else {
                // Widget pas encore attaché — l'ouvrir dans le bon panel
                const w = await this.widgetManager.getOrCreateWidget(FormulaSolverWidget.ID);
                if (!w.isAttached) {
                    this.shell.addWidget(w, { area: 'right', rank: 500 });
                }
                this.shell.activateWidget(FormulaSolverWidget.ID);
            }
        } catch (e) {
            console.error('[FORMULA-SOLVER] Migration error:', e);
        }
    }

    registerCommands(commands: CommandRegistry): void {
        // Commande pour ouvrir le widget
        commands.registerCommand(FormulaSolverCommand, {
            execute: () => this.openView({ activate: true, reveal: true })
        });

        // Commande pour toggle le widget
        commands.registerCommand(FormulaSolverToggleCommand, {
            execute: () => this.toggleView()
        });

        // Commande pour résoudre depuis une geocache
        commands.registerCommand(FormulaSolverSolveFromGeocacheCommand, {
            execute: async (geocacheId: number) => {
                console.log(`[FORMULA-SOLVER] Ouverture depuis geocache ${geocacheId}`);
                const widget = await this.openView({ activate: true, reveal: true });
                if (widget instanceof FormulaSolverWidget) {
                    await widget.loadFromGeocache(geocacheId);
                }
            }
        });

        console.log('[FORMULA-SOLVER] Commands registered');
    }

    registerMenus(menus: MenuModelRegistry): void {
        // Ajouter dans le menu View
        menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
            commandId: FormulaSolverToggleCommand.id,
            label: 'Formula Solver',
            order: '10'
        });

        console.log('[FORMULA-SOLVER] Menus registered');
    }

    async registerToolbarItems(toolbar: TabBarToolbarRegistry): Promise<void> {
        // Pas de toolbar items pour l'instant
    }
}
