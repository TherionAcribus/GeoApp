import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, FrontendApplication } from '@theia/core/lib/browser';
import { MenuModelRegistry, MenuContribution } from '@theia/core/lib/common';
import { ApplicationShell } from '@theia/core/lib/browser';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';

export const GEOAPP_AUTH_MENU = ['geoapp-auth-menu'];

/**
 * Icône « Connexion Geocaching.com » en bas de la barre latérale gauche — seul
 * raccourci conservé : l'authentification GeoApp n'est pas un
 * `AuthenticationProvider` Theia, son état (connecté/déconnecté) doit rester
 * visible en permanence. Préférences, Amis, Trackables et Documentation
 * vivent dans les menus/commandes, pas dans l'Activity Bar (spec §2.6, §4.4).
 *
 * Installation via l'API publique `leftPanelHandler.addBottomMenu` une fois le
 * shell initialisé — plus de polling ni de cast `(shell as any)`.
 */
@injectable()
export class GeoAppSidebarContribution implements FrontendApplicationContribution, MenuContribution {

    /** Rang distinct des rangs natifs Theia (Réglages/Comptes occupent 0–2). */
    protected static readonly AUTH_MENU_ORDER = 100;
    protected static readonly AUTH_MENU_ID = 'geoapp-auth-menu';

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(PreferenceService)
    protected readonly preferenceService: PreferenceService;

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
        menus.registerMenuAction(GEOAPP_AUTH_MENU, {
            commandId: 'geoapp.auth.open',
            label: 'Gérer la connexion',
            order: '0'
        });
    }

    onStart(_app: FrontendApplication): void {
        // `initialized` est public et résout quand les panneaux latéraux
        // existent — exactement le moment où addBottomMenu peut être appelé.
        void this.shell.initialized.then(() => this.addAuthMenu());
        this.startAuthPolling();
    }

    protected addAuthMenu(): void {
        this.shell.leftPanelHandler.addBottomMenu({
            id: GeoAppSidebarContribution.AUTH_MENU_ID,
            iconClass: this.getAuthIconClass(),
            title: this.getAuthTitle(),
            menuPath: GEOAPP_AUTH_MENU,
            order: GeoAppSidebarContribution.AUTH_MENU_ORDER
        });
    }

    protected getAuthIconClass(): string {
        return this.isConnected ? 'codicon codicon-account' : 'codicon codicon-debug-disconnect';
    }

    protected getAuthTitle(): string {
        return this.isConnected ? 'Connecté à Geocaching.com' : 'Non connecté - Cliquez pour vous connecter';
    }

    protected startAuthPolling(): void {
        if (this.authPollingStarted) {
            return;
        }

        this.authPollingStarted = true;
        setTimeout(() => void this.checkAuthStatus(), 1500);
        setInterval(() => void this.checkAuthStatus(), 60000);
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
        // Différé après l'initialisation : un changement d'état très tôt au
        // démarrage s'applique quand même, une seule fois le panneau prêt.
        // Même id et même rang : le retrait/ajout conserve la position de
        // l'icône et ne déplace jamais les autres éléments du menu.
        void this.shell.initialized.then(() => {
            this.shell.leftPanelHandler.removeBottomMenu(GeoAppSidebarContribution.AUTH_MENU_ID);
            this.addAuthMenu();
        });
    }
}
