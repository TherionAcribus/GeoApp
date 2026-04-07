import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { SidebarBottomMenuWidget } from '@theia/core/lib/browser/shell/sidebar-bottom-menu-widget';
import { MenuModelRegistry, MenuContribution } from '@theia/core/lib/common';
import { ApplicationShell } from '@theia/core/lib/browser';
import { SidebarMenu } from '@theia/core/lib/browser/shell/sidebar-menu-widget';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';

export const GEOAPP_PREFERENCES_MENU = ['geoapp-preferences-menu'];
export const GEOAPP_AUTH_MENU = ['geoapp-auth-menu'];

@injectable()
export class GeoAppSidebarContribution implements FrontendApplicationContribution, MenuContribution {

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(PreferenceService)
    protected readonly preferenceService: PreferenceService;

    protected sidebarBottomMenu: SidebarBottomMenuWidget | undefined;
    protected isConnected = false;
    protected authPollingStarted = false;

    @postConstruct()
    protected init(): void {
        window.addEventListener('geoapp-auth-changed', this.handleAuthChange as EventListener);
    }

    protected readonly handleAuthChange = (event: Event): void => {
        const customEvent = event as CustomEvent;
        const isConnected = Boolean(customEvent.detail?.isConnected);
        const wasConnected = this.isConnected;
        this.isConnected = isConnected;

        if (wasConnected !== this.isConnected) {
            this.updateAuthIcon();
        }
    };

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(GEOAPP_PREFERENCES_MENU, {
            commandId: 'geo-preferences:open',
            label: 'Ouvrir les preferences GeoApp',
            order: '0'
        });

        menus.registerMenuAction(GEOAPP_AUTH_MENU, {
            commandId: 'geoapp.auth.open',
            label: 'Gerer la connexion',
            order: '0'
        });
    }

    onStart(): void {
        this.scheduleSidebarSetup();
        this.startAuthPolling();
    }

    protected scheduleSidebarSetup(): void {
        setTimeout(() => {
            this.findSidebarBottomMenu();
            if (this.sidebarBottomMenu) {
                this.addGeoAppMenus();
                return;
            }

            setTimeout(() => {
                this.findSidebarBottomMenu();
                if (this.sidebarBottomMenu) {
                    this.addGeoAppMenus();
                }
            }, 2000);
        }, 500);
    }

    protected startAuthPolling(): void {
        if (this.authPollingStarted) {
            return;
        }

        this.authPollingStarted = true;
        setTimeout(() => void this.checkAuthStatus(), 1500);
        setInterval(() => void this.checkAuthStatus(), 60000);
    }

    protected findSidebarBottomMenu(): void {
        const leftPanel = (this.shell as any).leftPanelHandler;
        const rightPanel = (this.shell as any).rightPanelHandler;

        if (leftPanel?.bottomMenu) {
            this.sidebarBottomMenu = leftPanel.bottomMenu;
            return;
        }

        if (rightPanel?.bottomMenu) {
            this.sidebarBottomMenu = rightPanel.bottomMenu;
        }
    }

    protected addGeoAppMenus(): void {
        if (!this.sidebarBottomMenu) {
            return;
        }

        this.sidebarBottomMenu.addMenu({
            id: 'geoapp-preferences-menu',
            iconClass: 'fa fa-sliders',
            title: 'Preferences GeoApp',
            menuPath: GEOAPP_PREFERENCES_MENU,
            order: 0
        });

        this.sidebarBottomMenu.addMenu({
            id: 'geoapp-auth-menu',
            iconClass: this.getAuthIconClass(),
            title: this.getAuthTitle(),
            menuPath: GEOAPP_AUTH_MENU,
            order: 1
        });
    }

    protected getAuthIconClass(): string {
        return this.isConnected ? 'codicon codicon-account' : 'codicon codicon-debug-disconnect';
    }

    protected getAuthTitle(): string {
        return this.isConnected ? 'Connecte a Geocaching.com' : 'Non connecte - Cliquez pour vous connecter';
    }

    protected async checkAuthStatus(): Promise<void> {
        const wasConnected = this.isConnected;
        try {
            const response = await fetch(`${this.getBackendBaseUrl()}/api/auth/status`);
            if (!response.ok) {
                this.isConnected = false;
                if (wasConnected !== this.isConnected) {
                    this.updateAuthIcon();
                }
                return;
            }

            const data = await response.json();
            this.isConnected = data.status === 'logged_in';

            if (wasConnected !== this.isConnected) {
                this.updateAuthIcon();
            }
        } catch (error) {
            this.isConnected = false;
            if (wasConnected !== this.isConnected) {
                this.updateAuthIcon();
            }
            console.debug('[GeoAppSidebar] Failed to check auth status:', error);
        }
    }

    protected getBackendBaseUrl(): string {
        const value = String(this.preferenceService.get('geoApp.backend.apiBaseUrl', 'http://localhost:8000') || 'http://localhost:8000');
        return value.replace(/\/+$/, '');
    }

    protected updateAuthIcon(): void {
        if (!this.sidebarBottomMenu) {
            return;
        }

        this.sidebarBottomMenu.removeMenu('geoapp-auth-menu');
        this.sidebarBottomMenu.addMenu({
            id: 'geoapp-auth-menu',
            iconClass: this.getAuthIconClass(),
            title: this.getAuthTitle(),
            menuPath: GEOAPP_AUTH_MENU,
            order: 1
        });
    }
}
