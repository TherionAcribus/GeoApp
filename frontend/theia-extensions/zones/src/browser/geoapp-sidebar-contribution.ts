import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, FrontendApplication } from '@theia/core/lib/browser';
import { SidebarBottomMenuWidget } from '@theia/core/lib/browser/shell/sidebar-bottom-menu-widget';
import { CommandRegistry, MenuModelRegistry, MenuContribution } from '@theia/core/lib/common';
import { ApplicationShell } from '@theia/core/lib/browser';
import { SidebarMenu } from '@theia/core/lib/browser/shell/sidebar-menu-widget';

export const GEOAPP_PREFERENCES_MENU = ['geoapp-preferences-menu'];
export const GEOAPP_AUTH_MENU = ['geoapp-auth-menu'];

/**
 * Contribution pour ajouter des icônes GeoApp dans la sidebar bottom menu de Theia.
 * Ces icônes apparaissent au-dessus de l'icône des paramètres.
 */
@injectable()
export class GeoAppSidebarContribution implements FrontendApplicationContribution, MenuContribution {

    @inject(CommandRegistry)
    protected readonly commandRegistry: CommandRegistry;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    protected sidebarBottomMenu: SidebarBottomMenuWidget | undefined;

    protected isConnected: boolean = false;
    protected userAvatar: string | undefined;

    @postConstruct()
    protected init(): void {
        this.checkAuthStatus();
        // Écouter les événements de changement d'authentification
        window.addEventListener('geoapp-auth-changed', this.handleAuthChange.bind(this));
        // Vérifier périodiquement aussi (backup)
        setInterval(() => this.checkAuthStatus(), 60000);
    }

    protected handleAuthChange(event: Event): void {
        const customEvent = event as CustomEvent;
        const { isConnected, user } = customEvent.detail;
        
        const wasConnected = this.isConnected;
        this.isConnected = isConnected;
        this.userAvatar = user?.avatar_url;
        
        // Mettre à jour l'icône immédiatement si l'état a changé
        if (wasConnected !== this.isConnected) {
            this.updateAuthIcon();
        }
    }

    registerMenus(menus: MenuModelRegistry): void {
        // Enregistrer l'action pour le menu Préférences
        menus.registerMenuAction(GEOAPP_PREFERENCES_MENU, {
            commandId: 'geo-preferences:open',
            label: 'Ouvrir les préférences GeoApp',
            order: '0'
        });

        // Enregistrer l'action pour le menu Auth
        menus.registerMenuAction(GEOAPP_AUTH_MENU, {
            commandId: 'geoapp.auth.open',
            label: 'Gérer la connexion',
            order: '0'
        });
    }

    async onStart(app: FrontendApplication): Promise<void> {
        // Attendre un peu que l'application soit initialisée
        setTimeout(() => {
            this.findSidebarBottomMenu();
            
            if (this.sidebarBottomMenu) {
                this.addGeoAppMenus();
            } else {
                // Réessayer après un délai supplémentaire
                setTimeout(() => {
                    this.findSidebarBottomMenu();
                    if (this.sidebarBottomMenu) {
                        this.addGeoAppMenus();
                    }
                }, 2000);
            }
        }, 500);
    }

    protected findSidebarBottomMenu(): void {
        const leftPanel = (this.shell as any).leftPanelHandler;
        const rightPanel = (this.shell as any).rightPanelHandler;
        
        if (leftPanel && leftPanel.bottomMenu) {
            this.sidebarBottomMenu = leftPanel.bottomMenu;
        } else if (rightPanel && rightPanel.bottomMenu) {
            this.sidebarBottomMenu = rightPanel.bottomMenu;
        }
    }

    protected addGeoAppMenus(): void {
        if (!this.sidebarBottomMenu) {
            return;
        }

        const preferencesMenu: SidebarMenu = {
            id: 'geoapp-preferences-menu',
            iconClass: 'fa fa-sliders',
            title: 'Préférences GeoApp',
            menuPath: GEOAPP_PREFERENCES_MENU,
            order: 0
        };

        const authMenu: SidebarMenu = {
            id: 'geoapp-auth-menu',
            iconClass: this.getAuthIconClass(),
            title: this.getAuthTitle(),
            menuPath: GEOAPP_AUTH_MENU,
            order: 1
        };

        this.sidebarBottomMenu.addMenu(preferencesMenu);
        this.sidebarBottomMenu.addMenu(authMenu);
    }

    protected getAuthIconClass(): string {
        if (this.isConnected) {
            return 'codicon codicon-account';
        } else {
            return 'codicon codicon-debug-disconnect';
        }
    }

    protected getAuthTitle(): string {
        return this.isConnected ? 'Connecté à Geocaching.com' : 'Non connecté - Cliquez pour vous connecter';
    }

    protected async checkAuthStatus(): Promise<void> {
        try {
            const response = await fetch('http://localhost:8000/api/auth/status');
            if (response.ok) {
                const data = await response.json();
                const wasConnected = this.isConnected;
                this.isConnected = data.status === 'logged_in';
                this.userAvatar = data.user?.avatar;
                
                if (wasConnected !== this.isConnected) {
                    this.updateAuthIcon();
                }
            }
        } catch (error) {
            this.isConnected = false;
            console.debug('[GeoAppSidebar] Failed to check auth status:', error);
        }
    }

    protected updateAuthIcon(): void {
        if (!this.sidebarBottomMenu) {
            return;
        }
        
        this.sidebarBottomMenu.removeMenu('geoapp-auth-menu');
        
        const authMenu: SidebarMenu = {
            id: 'geoapp-auth-menu',
            iconClass: this.getAuthIconClass(),
            title: this.getAuthTitle(),
            menuPath: GEOAPP_AUTH_MENU,
            order: 1
        };
        
        this.sidebarBottomMenu.addMenu(authMenu);
    }
}
