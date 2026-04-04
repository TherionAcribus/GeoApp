import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { CommonMenus } from '@theia/core/lib/browser';

import { GeoPreferencesWidget } from './geo-preferences-widget';

export const GeoPreferencesCommands = {
    OPEN: {
        id: 'geo-preferences:open',
        label: 'Préférences GeoApp'
    }
};

@injectable()
export class GeoPreferencesFrontendContribution extends AbstractViewContribution<GeoPreferencesWidget>
    implements CommandContribution, MenuContribution, KeybindingContribution {

    constructor() {
        super({
            widgetId: GeoPreferencesWidget.ID,
            widgetName: GeoPreferencesWidget.LABEL,
            toggleCommandId: GeoPreferencesCommands.OPEN.id,
            defaultWidgetOptions: { area: 'main' }
        });
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(GeoPreferencesCommands.OPEN, {
            execute: () => this.openView({ activate: true, reveal: true })
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(CommonMenus.FILE_SETTINGS_SUBMENU, {
            commandId: GeoPreferencesCommands.OPEN.id,
            label: GeoPreferencesCommands.OPEN.label,
            order: '1'
        });
    }

    registerKeybindings(keybindings: KeybindingRegistry): void {
        keybindings.registerKeybinding({
            command: GeoPreferencesCommands.OPEN.id,
            keybinding: 'ctrlcmd+shift+,'
        });
    }
}

