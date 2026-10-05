import { injectable } from '@theia/core/shared/inversify';
import { MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import { CommonMenus } from '@theia/core/lib/browser';
import { ZonesCommands } from './zones-command-contribution';

@injectable()
export class ZonesMenuContribution implements MenuContribution {

    registerMenus(menus: MenuModelRegistry): void {
        // Préférences et Connexion vivent dans le menu Réglages natif
        // (spec barres latérales §4.4) — plus dans le bas de l'Activity Bar.
        menus.registerMenuAction(CommonMenus.MANAGE_GENERAL, {
            commandId: 'geo-preferences:open',
            label: 'Préférences GeoApp',
            order: '80'
        });

        menus.registerMenuAction(CommonMenus.MANAGE_GENERAL, {
            commandId: ZonesCommands.OPEN_AUTH.id,
            label: 'Connexion Geocaching.com',
            order: '81'
        });

        menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
            commandId: ZonesCommands.OPEN.id,
            label: 'Zones',
            order: '0.5'
        });

        // « Cartes » est enregistrée par MapManagerViewContribution
        // (AbstractViewContribution) avec le même order '0.7'.

        menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
            commandId: ZonesCommands.OPEN_AUTH.id,
            label: 'Connexion Geocaching.com',
            order: '1'
        });

        // Un seul widget Amis : l'activité en est un onglet.
        menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
            commandId: ZonesCommands.OPEN_FRIENDS.id,
            label: 'Amis',
            order: '1.5'
        });

        menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
            commandId: ZonesCommands.OPEN_TRACKABLES.id,
            label: 'Trackables',
            order: '1.6'
        });

        menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
            commandId: ZonesCommands.OPEN_GPS_VISITS.id,
            label: 'Visites GPS',
            order: '1.7'
        });

        menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
            commandId: ZonesCommands.OPEN_ARCHIVE_MANAGER.id,
            label: 'Gestionnaire d\'Archive',
            order: '2'
        });

        menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
            commandId: ZonesCommands.OPEN_CHAT_POLICY.id,
            label: 'Policy Chat IA GeoApp',
            order: '2.5'
        });

        menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
            commandId: ZonesCommands.OPEN_AI_SETUP.id,
            label: 'Configurer l\'IA',
            order: '2.6'
        });

        menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
            commandId: ZonesCommands.OPEN_SERVER_LOG_TERMINAL.id,
            label: 'Terminal serveur',
            order: '2.6'
        });
    }
}
