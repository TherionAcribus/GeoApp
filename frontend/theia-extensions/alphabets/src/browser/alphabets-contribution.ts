/**
 * Contribution Theia pour l'extension Alphabets.
 * Enregistre les widgets, commandes, keybindings et menus.
 */
import { injectable, inject } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import {
    AbstractViewContribution,
    ApplicationShell,
    FrontendApplicationContribution,
    FrontendApplication
} from '@theia/core/lib/browser';
import { WidgetManager } from '@theia/core/lib/browser/widget-manager';
import { AlphabetsListWidget } from './alphabets-list-widget';
import { AlphabetViewerWidget } from './alphabet-viewer-widget';
import { CistercianNumeralsWidget } from './cistercian-numerals-widget';
import { CommonMenus } from '@theia/core/lib/browser';
import { AlphabetsCommands } from '../common/alphabet-protocol';
import { AlphabetTabsManager } from './alphabet-tabs-manager';

/**
 * Contribution pour le widget de liste des alphabets.
 */
@injectable()
export class AlphabetsListContribution
    extends AbstractViewContribution<AlphabetsListWidget>
    implements FrontendApplicationContribution {

    constructor(
        @inject(AlphabetTabsManager) protected readonly alphabetTabsManager: AlphabetTabsManager,
        @inject(WidgetManager) protected readonly widgetManager: WidgetManager,
        @inject(ApplicationShell) protected readonly shell: ApplicationShell
    ) {
        super({
            widgetId: AlphabetsListWidget.ID,
            widgetName: AlphabetsListWidget.LABEL,
            defaultWidgetOptions: {
                area: 'left',
                rank: 450  // Après plugins (400), avant debug (500)
            },
            toggleCommandId: AlphabetsCommands.OPEN_LIST.id
        });

        // Écouter l'événement d'ouverture d'alphabet depuis la recherche globale
        if (typeof window !== 'undefined') {
            window.addEventListener('geoapp-open-alphabet', ((event: CustomEvent) => {
                const { alphabetId } = event.detail;
                if (alphabetId) {
                    this.openAlphabetViewer(alphabetId);
                }
            }) as EventListener);
        }
    }
    
    /**
     * Ouvre le widget de visualisation pour un alphabet.
     */
    async openAlphabetViewer(alphabetId: string): Promise<AlphabetViewerWidget> {
        console.log('AlphabetsListContribution: openAlphabetViewer called with:', alphabetId);
        return this.alphabetTabsManager.openAlphabet({ alphabetId });
    }

    async openCistercianTool(): Promise<CistercianNumeralsWidget> {
        const widget = await this.widgetManager.getOrCreateWidget<CistercianNumeralsWidget>(CistercianNumeralsWidget.ID);
        if (!widget.isAttached) {
            this.shell.addWidget(widget, { area: 'main' });
        }
        this.shell.activateWidget(widget.id);
        return widget;
    }
    
    /**
     * Initialisation au démarrage de l'application.
     */
    async onStart(app: FrontendApplication): Promise<void> {
        // Optionnel: ouvrir automatiquement le widget au démarrage
        // await this.openView({ activate: false });
    }
    
    /**
     * Enregistrement des commandes.
     */
    registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        
        // Commande pour actualiser la liste
        registry.registerCommand(AlphabetsCommands.REFRESH, {
            execute: () => {
                const widget = this.tryGetWidget();
                if (widget) {
                    widget.refresh();
                }
            },
            isEnabled: () => this.tryGetWidget() !== undefined
        });
        
        // Commande pour redécouvrir les alphabets
        registry.registerCommand(AlphabetsCommands.DISCOVER, {
            execute: async () => {
                const widget = this.tryGetWidget();
                if (widget) {
                    await widget.discover();
                }
            },
            isEnabled: () => this.tryGetWidget() !== undefined
        });
        
        // Commande pour ouvrir un alphabet
        registry.registerCommand(AlphabetsCommands.OPEN_VIEWER, {
            execute: async (alphabetId?: string) => {
                console.log('AlphabetsCommands.OPEN_VIEWER: execute called with:', alphabetId);
                if (alphabetId) {
                    try {
                        await this.openAlphabetViewer(alphabetId);
                        console.log('AlphabetsCommands.OPEN_VIEWER: openAlphabetViewer completed');
                    } catch (error) {
                        console.error('AlphabetsCommands.OPEN_VIEWER: Error:', error);
                    }
                } else {
                    console.warn('AlphabetsCommands.OPEN_VIEWER: No alphabetId provided');
                }
            }
        });

        registry.registerCommand(AlphabetsCommands.OPEN_CISTERCIAN, {
            execute: async () => this.openCistercianTool()
        });
    }
    
    /**
     * Enregistrement des menus.
     */
    registerMenus(menus: MenuModelRegistry): void {
        super.registerMenus(menus);
        
        // Ajouter au menu View
        menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
            commandId: AlphabetsCommands.OPEN_LIST.id,
            label: 'Alphabets',
            order: '5'
        });
        menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
            commandId: AlphabetsCommands.OPEN_CISTERCIAN.id,
            label: 'Chiffres cisterciens',
            order: '5.1'
        });
    }
}

