/**
 * Contribution Theia pour Formula Solver
 * Enregistre les commandes, menus et bindings
 */

import { injectable } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import { AbstractViewContribution } from '@theia/core/lib/browser';
import { FormulaSolverWidget } from './formula-solver-widget';
import {
    FormulaSolverCommand,
    FormulaSolverSolveFromGeocacheCommand,
    FormulaSolverToggleCommand
} from './formula-solver-commands';
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { CommonMenus } from '@theia/core/lib/browser/common-frontend-contribution';

export {
    FormulaSolverCommand,
    FormulaSolverSolveFromGeocacheCommand,
    FormulaSolverToggleCommand
} from './formula-solver-commands';

@injectable()
export class FormulaSolverContribution
    extends AbstractViewContribution<FormulaSolverWidget>
    implements CommandContribution, MenuContribution, TabBarToolbarContribution {

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

    /**
     * La position de la vue n'est plus forcée : `defaultWidgetOptions` à droite
     * est la valeur par défaut du layout initial, mais une vue déplacée à
     * gauche ou fermée par l'utilisateur le reste (spec barres latérales §3.3.C
     * — l'ancien onStart + setTimeout ré-attachait le widget à chaque démarrage
     * et annulait les choix utilisateur).
     */

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
