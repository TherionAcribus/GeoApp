/**
 * Contribution Theia pour la recherche globale GeoApp.
 * 
 * Enregistre le widget sidebar, les commandes et keybindings.
 */

import { injectable } from '@theia/core/shared/inversify';
import { Command, MenuModelRegistry } from '@theia/core/lib/common';
import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { AbstractViewContribution } from '@theia/core/lib/browser';
import { GlobalSearchWidget } from './global-search-widget';

export namespace GlobalSearchCommands {
    export const OPEN: Command = {
        id: 'geoapp.globalSearch.open',
        label: 'GeoApp: Recherche globale'
    };
}

@injectable()
export class GlobalSearchContribution extends AbstractViewContribution<GlobalSearchWidget> {

    constructor() {
        super({
            widgetId: GlobalSearchWidget.ID,
            widgetName: GlobalSearchWidget.LABEL,
            defaultWidgetOptions: {
                area: 'left',
                rank: 300
            },
            toggleCommandId: GlobalSearchCommands.OPEN.id
        });
    }

    registerKeybindings(keybindings: KeybindingRegistry): void {
        super.registerKeybindings(keybindings);
        keybindings.registerKeybinding({
            command: GlobalSearchCommands.OPEN.id,
            keybinding: 'ctrlcmd+shift+f',
            when: '!editorFocus && !terminalFocus'
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        super.registerMenus(menus);
    }
}
