import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution, FrontendApplication, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { CommandRegistry, MenuModelRegistry } from '@theia/core/lib/common';
import { CommonMenus } from '@theia/core/lib/browser';
import { CalculatorWidget } from './calculator-widget';

export namespace CalculatorCommands {
    export const OPEN = {
        id: 'geoapp.calculator.open',
        label: 'Calculatrice',
    };
}

@injectable()
export class CalculatorContribution
    extends AbstractViewContribution<CalculatorWidget>
    implements FrontendApplicationContribution {

    constructor() {
        super({
            widgetId: CalculatorWidget.ID,
            widgetName: CalculatorWidget.LABEL,
            defaultWidgetOptions: {
                area: 'left',
                rank: 480,
            },
            toggleCommandId: CalculatorCommands.OPEN.id,
        });
    }

    async onStart(_app: FrontendApplication): Promise<void> {
        // nothing
    }

    registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
    }

    registerMenus(menus: MenuModelRegistry): void {
        // Pas de super.registerMenus : la classe de base ajouterait déjà
        // OPEN à VIEW_VIEWS (sans order) — l'entrée serait doublée.
        menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
            commandId: CalculatorCommands.OPEN.id,
            label: 'Calculatrice',
            order: '7',
        });
    }
}
