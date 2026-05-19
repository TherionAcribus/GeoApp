/********************************************************************************
 * Copyright (C) 2021 Ericsson and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { inject, injectable } from '@theia/core/shared/inversify';
import { CommonMenus } from '@theia/core/lib/browser/common-frontend-contribution';
import { ApplicationShell, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { MenuContribution, MenuModelRegistry, MenuPath } from '@theia/core/lib/common/menu';
import { WindowService } from '@theia/core/lib/browser/window/window-service';

const MENU_BAR_NODES_TO_REMOVE = [
    '6_debug',
    '5_go',
    '7_terminal',
];

const SIDEBAR_WIDGET_IDS_TO_HIDE = new Set([
    'explorer-view-container',
    'scm-view-container',
    'search-view-container',
    'test-view-container',
]);

@injectable()
export class GeoAppMenuCleanupContribution implements FrontendApplicationContribution {

    @inject(MenuModelRegistry)
    protected readonly menuRegistry: MenuModelRegistry;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    onStart(): void {
        this.removeMenuBarItems();
        this.setupSidebarCleanup();
    }

    protected removeMenuBarItems(): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const root = (this.menuRegistry as any).root;
        if (!root?.children) { return; }
        const menubar = root.children.find((c: { id: string }) => c.id === 'menubar');
        if (!menubar?.children) { return; }
        for (const id of MENU_BAR_NODES_TO_REMOVE) {
            const node = menubar.children.find((c: { id: string }) => c.id === id);
            if (node) {
                menubar.removeNode(node);
            }
        }
    }

    protected setupSidebarCleanup(): void {
        this.shell.onDidAddWidget(widget => {
            if (SIDEBAR_WIDGET_IDS_TO_HIDE.has(widget.id)) {
                setTimeout(() => widget.close(), 0);
            }
        });
        for (const widget of this.shell.getWidgets('left')) {
            if (SIDEBAR_WIDGET_IDS_TO_HIDE.has(widget.id)) {
                widget.close();
            }
        }
    }
}

export namespace TheiaIDEMenus {
    export const THEIA_IDE_HELP: MenuPath = [...CommonMenus.HELP, 'theia-ide'];
}
export namespace TheiaIDECommands {
    export const CATEGORY = 'TheiaIDE';
    export const REPORT_ISSUE: Command = {
        id: 'theia-ide:report-issue',
        category: CATEGORY,
        label: 'Report Issue'
    };
    export const DOCUMENTATION: Command = {
        id: 'theia-ide:documentation',
        category: CATEGORY,
        label: 'Documentation'
    };
}

@injectable()
export class TheiaIDEContribution implements CommandContribution, MenuContribution {

    @inject(WindowService)
    protected readonly windowService: WindowService;

    static REPORT_ISSUE_URL = 'https://github.com/eclipse-theia/theia-ide/issues/new?assignees=&labels=&template=bug_report.md';
    static DOCUMENTATION_URL = 'https://theia-ide.org/docs/user_getting_started/';

    registerCommands(commandRegistry: CommandRegistry): void {
        commandRegistry.registerCommand(TheiaIDECommands.REPORT_ISSUE, {
            execute: () => this.windowService.openNewWindow(TheiaIDEContribution.REPORT_ISSUE_URL, { external: true })
        });
        commandRegistry.registerCommand(TheiaIDECommands.DOCUMENTATION, {
            execute: () => this.windowService.openNewWindow(TheiaIDEContribution.DOCUMENTATION_URL, { external: true })
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(TheiaIDEMenus.THEIA_IDE_HELP, {
            commandId: TheiaIDECommands.REPORT_ISSUE.id,
            label: TheiaIDECommands.REPORT_ISSUE.label,
            order: '1'
        });
        menus.registerMenuAction(TheiaIDEMenus.THEIA_IDE_HELP, {
            commandId: TheiaIDECommands.DOCUMENTATION.id,
            label: TheiaIDECommands.DOCUMENTATION.label,
            order: '2'
        });
    }
}
