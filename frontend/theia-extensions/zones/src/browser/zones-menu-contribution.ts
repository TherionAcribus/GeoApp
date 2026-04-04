import { injectable } from '@theia/core/shared/inversify';
import { MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import { CommonMenus } from '@theia/core/lib/browser';
import { ZonesCommands } from './zones-command-contribution';

@injectable()
export class ZonesMenuContribution implements MenuContribution {

    registerMenus(menus: MenuModelRegistry): void {
        // Ajouter au menu View
        menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
            commandId: 'geo-preferences:open',
            label: 'Préférences GeoApp',
            order: '0'  // En premier
        });

        menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
            commandId: ZonesCommands.OPEN_AUTH.id,
            label: 'Connexion Geocaching.com',
            order: '1'  // Juste après les préférences
        });

        menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
            commandId: ZonesCommands.OPEN_ARCHIVE_MANAGER.id,
            label: 'Gestionnaire d\'Archive',
            order: '2'
        });
    }
}
