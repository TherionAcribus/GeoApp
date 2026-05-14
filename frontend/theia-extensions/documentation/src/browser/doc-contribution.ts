import { injectable, inject } from '@theia/core/shared/inversify';
import {
    CommandContribution,
    CommandRegistry,
    MenuContribution,
    MenuModelRegistry,
} from '@theia/core/lib/common';
import {
    ApplicationShell,
    CommonMenus,
    FrontendApplicationContribution,
    KeybindingContribution,
    KeybindingRegistry,
    WidgetManager,
} from '@theia/core/lib/browser';
import { SidebarBottomMenuWidget } from '@theia/core/lib/browser/shell/sidebar-bottom-menu-widget';
import { DOC_WIDGET_ID, DOC_WIDGET_LABEL } from './doc-widget';

export namespace GeoAppDocCommands {
    export const OPEN = {
        id: 'geoapp.documentation.open',
        label: DOC_WIDGET_LABEL,
    };
}

export const GEOAPP_DOC_SIDEBAR_MENU = ['geoapp-doc-sidebar-menu'];

@injectable()
export class DocContribution implements CommandContribution, MenuContribution, KeybindingContribution, FrontendApplicationContribution {

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    protected sidebarBottomMenu: SidebarBottomMenuWidget | undefined;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(GeoAppDocCommands.OPEN, {
            execute: () => this.openDocWidget(),
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(CommonMenus.HELP, {
            commandId: GeoAppDocCommands.OPEN.id,
            label: DOC_WIDGET_LABEL,
            order: '0',
        });

        menus.registerMenuAction(GEOAPP_DOC_SIDEBAR_MENU, {
            commandId: GeoAppDocCommands.OPEN.id,
            label: 'Ouvrir la documentation',
            order: '0',
        });
    }

    registerKeybindings(registry: KeybindingRegistry): void {
        registry.registerKeybinding({
            command: GeoAppDocCommands.OPEN.id,
            keybinding: 'shift+f1',
        });
    }

    onStart(): void {
        this.scheduleSidebarSetup();
    }

    protected scheduleSidebarSetup(): void {
        setTimeout(() => {
            this.findSidebarBottomMenu();
            if (this.sidebarBottomMenu) {
                this.addDocSidebarIcon();
                return;
            }
            setTimeout(() => {
                this.findSidebarBottomMenu();
                if (this.sidebarBottomMenu) {
                    this.addDocSidebarIcon();
                }
            }, 2000);
        }, 500);
    }

    protected findSidebarBottomMenu(): void {
        const leftPanel = (this.shell as any).leftPanelHandler;
        if (leftPanel?.bottomMenu) {
            this.sidebarBottomMenu = leftPanel.bottomMenu;
        }
    }

    protected addDocSidebarIcon(): void {
        if (!this.sidebarBottomMenu) {
            return;
        }
        this.sidebarBottomMenu.addMenu({
            id: 'geoapp-doc-sidebar-menu',
            iconClass: 'codicon codicon-book',
            title: 'Documentation GeoApp (Shift+F1)',
            menuPath: GEOAPP_DOC_SIDEBAR_MENU,
            order: 2,
        });
    }

    private async openDocWidget(): Promise<void> {
        const widget = await this.widgetManager.getOrCreateWidget(DOC_WIDGET_ID);
        if (!widget.isAttached) {
            this.shell.addWidget(widget, { area: 'main', mode: 'tab-after' });
        }
        this.shell.activateWidget(widget.id);
    }
}
