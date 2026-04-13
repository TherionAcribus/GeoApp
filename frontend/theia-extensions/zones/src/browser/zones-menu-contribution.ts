import { injectable } from '@theia/core/shared/inversify';
import { MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import { CommonMenus } from '@theia/core/lib/browser';
import { ZonesCommands } from './zones-command-contribution';

@injectable()
export class ZonesMenuContribution implements MenuContribution {

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
            commandId: 'geo-preferences:open',
            label: 'Preferences GeoApp',
            order: '0'
        });

        menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
            commandId: ZonesCommands.OPEN.id,
            label: 'Zones',
            order: '0.5'
        });

        menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
            commandId: ZonesCommands.OPEN_AUTH.id,
            label: 'Connexion Geocaching.com',
            order: '1'
        });

        menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
            commandId: ZonesCommands.OPEN_ARCHIVE_MANAGER.id,
            label: 'Gestionnaire d\'Archive',
            order: '2'
        });
    }
}
