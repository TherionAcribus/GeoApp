import { injectable, inject } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import { AbstractViewContribution, CommonMenus, WidgetManager } from '@theia/core/lib/browser';
import { PluginExecutorWidget, GeocacheContext } from './plugin-executor-widget';

export namespace PluginExecutorCommands {
    export const OPEN: Command = {
        id: 'geoapp.plugins.open',
        label: 'GeoApp: Plugins'
    };
}

@injectable()
export class PluginExecutorContribution
    extends AbstractViewContribution<PluginExecutorWidget>
    implements CommandContribution, MenuContribution {

    constructor(
        @inject(WidgetManager) protected readonly widgetManager: WidgetManager
    ) {
        super({
            widgetId: PluginExecutorWidget.ID,
            widgetName: PluginExecutorWidget.LABEL,
            defaultWidgetOptions: {
                area: 'left',
                rank: 400
            },
            toggleCommandId: PluginExecutorCommands.OPEN.id
        });
    }

    async openWithContext(context: GeocacheContext, pluginName?: string, autoExecute = false): Promise<PluginExecutorWidget> {
        const widget = await this.widgetManager.getOrCreateWidget<PluginExecutorWidget>(PluginExecutorWidget.ID);
        widget.setOptions({ context, pluginName, autoExecute });
        await this.shell.addWidget(widget, { area: 'left', rank: 400 });
        this.shell.activateWidget(widget.id);
        return widget;
    }

    registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
    }

    registerMenus(menus: MenuModelRegistry): void {
        super.registerMenus(menus);
        menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
            commandId: PluginExecutorCommands.OPEN.id,
            label: PluginExecutorCommands.OPEN.label,
        });
    }
}
