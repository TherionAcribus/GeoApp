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
    KeybindingContribution,
    KeybindingRegistry,
    WidgetManager,
} from '@theia/core/lib/browser';
import { CommandService } from '@theia/core';
import { DOC_WIDGET_ID, DOC_WIDGET_LABEL } from './doc-widget';

export namespace GeoAppDocCommands {
    export const OPEN = {
        id: 'geoapp.documentation.open',
        label: DOC_WIDGET_LABEL,
    };
    export const ASK_AIDE = {
        id: 'geoapp.aide.ask',
        label: 'GeoApp: Demander à @Aide',
    };
}

@injectable()
export class DocContribution implements CommandContribution, MenuContribution, KeybindingContribution {

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(CommandService)
    protected readonly commandService: CommandService;

    // Identifiants Theia (et non VS Code) du widget de chat IA.
    private static readonly CHAT_VIEW_WIDGET_ID = 'chat-view-widget';
    private static readonly CHAT_TOGGLE_COMMAND_ID = 'aiChat:toggle';

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(GeoAppDocCommands.OPEN, {
            execute: () => this.openDocWidget(),
        });
        registry.registerCommand(GeoAppDocCommands.ASK_AIDE, {
            execute: async (query?: string) => this.askAide(query),
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(CommonMenus.HELP, {
            commandId: GeoAppDocCommands.OPEN.id,
            label: DOC_WIDGET_LABEL,
            order: '0',
        });
        menus.registerMenuAction(CommonMenus.HELP, {
            commandId: GeoAppDocCommands.ASK_AIDE.id,
            label: 'Demander à @Aide',
            order: '1',
        });
    }

    registerKeybindings(registry: KeybindingRegistry): void {
        registry.registerKeybinding({
            command: GeoAppDocCommands.OPEN.id,
            keybinding: 'shift+f1',
        });
    }

    /**
     * L'icône bas de la barre latérale a été retirée (spec barres latérales
     * §4.4) : la documentation reste accessible par le menu Aide, `Shift+F1`
     * et la palette de commandes — et peut être épinglée à la barre d'outils
     * dynamique par l'utilisateur.
     */

    private async openDocWidget(): Promise<void> {
        const widget = await this.widgetManager.getOrCreateWidget(DOC_WIDGET_ID);
        if (!widget.isAttached) {
            this.shell.addWidget(widget, { area: 'main', mode: 'tab-after' });
        }
        this.shell.activateWidget(widget.id);
    }

    /**
     * Ouvre le chat IA (sans le refermer s'il est déjà visible) et préremplit
     * l'entrée avec « @Aide <query> » — même mécanique que « Demander à l'IA »
     * du widget documentation.
     */
    private async askAide(query?: string): Promise<void> {
        const prompt = query && String(query).trim() ? `@Aide ${String(query).trim()}` : '@Aide ';
        const existing = this.widgetManager.tryGetWidget(DocContribution.CHAT_VIEW_WIDGET_ID);
        if (!existing || !existing.isVisible) {
            try {
                await this.commandService.executeCommand(DocContribution.CHAT_TOGGLE_COMMAND_ID);
            } catch (e) {
                console.error('[GeoAppDoc] Impossible d\'ouvrir le chat IA:', e);
                return;
            }
        }
        this.prefillChatInput(prompt);
    }

    /**
     * Préremplit l'éditeur Monaco de l'input du chat avec `prompt`, sans envoyer.
     * L'éditeur est créé de façon asynchrone après l'ouverture du widget : on
     * réessaie brièvement tant qu'il n'est pas disponible.
     */
    private prefillChatInput(prompt: string, attempt: number = 0): void {
        const chatWidget = this.widgetManager.tryGetWidget<any>(DocContribution.CHAT_VIEW_WIDGET_ID);
        const editor = chatWidget?.inputWidget?.editor;
        const control = editor?.getControl?.();
        if (control) {
            control.setValue(prompt);
            control.setPosition({ lineNumber: 1, column: prompt.length + 1 });
            control.focus();
            return;
        }
        if (attempt < 10) {
            setTimeout(() => this.prefillChatInput(prompt, attempt + 1), 150);
        }
    }
}
