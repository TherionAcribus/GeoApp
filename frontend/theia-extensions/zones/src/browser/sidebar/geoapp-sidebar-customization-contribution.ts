/**
 * Commandes du dialogue « Personnaliser les barres latérales » (spec §4.3).
 *
 * Points d'entrée : `Affichage > Apparence`, menu Réglages natif, palette de
 * commandes, et le menu contextuel des onglets latéraux
 * (`SHELL_TABBAR_CONTEXT_MENU`, visible uniquement sur les panneaux gauche et
 * droit via `isVisible`). `geoapp.sidebar.reset` n'a volontairement pas
 * d'entrée de menu permanente : il est dans le dialogue et la palette.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import { CommonMenus } from '@theia/core/lib/browser';
import { SHELL_TABBAR_CONTEXT_MENU } from '@theia/core/lib/browser/shell/tab-bars';
import { GeoAppSidebarController } from './geoapp-sidebar-controller';
import { GeoAppSidebarCustomizationDialog } from './geoapp-sidebar-customization-dialog';

export namespace GeoAppSidebarCommands {
    export const CUSTOMIZE = { id: 'geoapp.sidebar.customize', label: 'Personnaliser les barres latérales' };
    export const RESET = { id: 'geoapp.sidebar.reset', label: 'Restaurer les barres latérales par défaut' };
}

@injectable()
export class GeoAppSidebarCustomizationContribution implements CommandContribution, MenuContribution {

    @inject(GeoAppSidebarController)
    protected readonly controller: GeoAppSidebarController;

    @inject(GeoAppSidebarCustomizationDialog)
    protected readonly dialog: GeoAppSidebarCustomizationDialog;

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(GeoAppSidebarCommands.CUSTOMIZE, {
            // `open(false)` : le dialogue est un singleton réutilisable — ne pas
            // le disposer à la fermeture (sinon contenu vide à la réouverture).
            execute: () => this.dialog.open(false),
            // Le menu contextuel des tab bars passe l'événement souris : la
            // cible doit être dans le panneau latéral gauche ou droit — sinon
            // (main, bottom) l'entrée est masquée (spec §4.3).
            isVisible: (event?: MouseEvent) => this.isSidebarContext(event),
        });
        commands.registerCommand(GeoAppSidebarCommands.RESET, {
            execute: () => this.controller.resetToDefaults(),
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(CommonMenus.VIEW_APPEARANCE, {
            commandId: GeoAppSidebarCommands.CUSTOMIZE.id,
            label: 'Personnaliser les barres latérales…',
            order: '20',
        });

        menus.registerMenuAction(CommonMenus.MANAGE_GENERAL, {
            commandId: GeoAppSidebarCommands.CUSTOMIZE.id,
            label: 'Personnaliser les barres latérales…',
            order: '82',
        });

        menus.registerMenuAction(SHELL_TABBAR_CONTEXT_MENU, {
            commandId: GeoAppSidebarCommands.CUSTOMIZE.id,
            label: 'Personnaliser les barres latérales…',
            order: '10',
        });
    }

    /**
     * Vrai si l'événement du menu contextuel vient d'un onglet latéral. La
     * tab bar latérale vit dans `#theia-left-content-panel` /
     * `#theia-right-content-panel` (IDs du shell Theia).
     */
    protected isSidebarContext(event?: MouseEvent): boolean {
        const target = event?.target;
        if (!(target instanceof Element)) {
            // Palette de commandes / entrées de menu : toujours visible.
            return true;
        }
        return Boolean(target.closest('#theia-left-content-panel, #theia-right-content-panel'));
    }
}
