/**
 * Contribution Theia pour Formula Solver
 * Enregistre les commandes, menus et bindings
 */

import { injectable } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import { AbstractViewContribution, FrontendApplicationContribution, FrontendApplication } from '@theia/core/lib/browser';
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
