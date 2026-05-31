import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser';
import { CommandRegistry, MenuModelRegistry } from '@theia/core/lib/common';
import { CommonMenus } from '@theia/core/lib/browser';
import { GridPuzzleWorkbenchWidget } from './grid-puzzle-workbench-widget';
import type { GeocacheContext } from './plugin-executor-widget';

export namespace GridPuzzleWorkbenchCommands {
    export const OPEN = {
        id: 'plugins.openGridPuzzleWorkbench',
        label: 'Grilles: ouvrir l atelier',
    };
}

@injectable()
export class GridPuzzleWorkbenchContribution extends AbstractViewContribution<GridPuzzleWorkbenchWidget> {
    constructor() {
        super({
            widgetId: GridPuzzleWorkbenchWidget.ID,
            widgetName: GridPuzzleWorkbenchWidget.LABEL,
            defaultWidgetOptions: {
                area: 'main',
            },
            toggleCommandId: GridPuzzleWorkbenchCommands.OPEN.id,
        });
    }

    registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
    }

    async openWithContext(context: GeocacheContext): Promise<void> {
        const widget = await this.openView({ activate: true });
        widget.initializeForGeocache(context);
    }

    registerMenus(menus: MenuModelRegistry): void {
        super.registerMenus(menus);
        menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
            commandId: GridPuzzleWorkbenchCommands.OPEN.id,
            label: 'Grilles',
            order: '5.6',
        });
    }
}
