/**
 * Contribution Theia pour l'extension Plugins.
 * 
 * Ce fichier enregistre les widgets, commandes, keybindings et menus
 * dans l'interface Theia.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import { AbstractViewContribution, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core';
import { PluginsBrowserWidget } from './plugins-browser-widget';
import { PluginExecutorWidget, GeocacheContext } from './plugin-executor-widget';
import { CommonMenus } from '@theia/core/lib/browser';
import { PluginToolsManager } from './plugin-tools-manager';
import { PluginTabsManager } from './plugin-tabs-manager';

/**
 * Commandes disponibles pour l'extension Plugins.
 */
export namespace PluginsCommands {
    export const OPEN_PLUGINS_BROWSER = {
        id: 'plugins.openBrowser',
        label: 'Plugins: Ouvrir le navigateur de plugins'
    };
    
    export const REFRESH_PLUGINS = {
        id: 'plugins.refresh',
        label: 'Plugins: Rafraîchir la liste'
    };
    
    export const DISCOVER_PLUGINS = {
        id: 'plugins.discover',
        label: 'Plugins: Redécouvrir les plugins'
    };

    export const OPEN_PLUGIN_EXECUTOR = {
        id: 'plugins.openExecutor',
        label: 'Plugins: Exécuter un plugin'
    };

    export const CHECK_TOOLS_STATUS = {
        id: 'plugins.checkTools',
        label: 'Plugins: Vérifier le statut des tools IA'
    };
}

/**
 * Contribution pour le widget Plugins Browser.
 */
@injectable()
export class PluginsBrowserContribution extends AbstractViewContribution<PluginsBrowserWidget> {

    @inject(MessageService)
    protected readonly messages!: MessageService;

    constructor(
        @inject(PluginToolsManager) protected readonly pluginToolsManager: PluginToolsManager
    ) {
        super({
            widgetId: PluginsBrowserWidget.ID,
            widgetName: PluginsBrowserWidget.LABEL,
            defaultWidgetOptions: {
                area: 'left',
                rank: 400  // Après explorer, avant debug
            },
            toggleCommandId: PluginsCommands.OPEN_PLUGINS_BROWSER.id
        });
    }
    
    /**
     * Enregistre les commandes.
     */
    registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        
        // Commande pour rafraîchir
        registry.registerCommand(PluginsCommands.REFRESH_PLUGINS, {
            execute: () => {
                const widget = this.tryGetWidget();
                if (widget) {
                    widget.refresh();
                }
                void this.pluginToolsManager.refreshTools({ silent: true });
            },
            isEnabled: () => this.tryGetWidget() !== undefined
        });
        
        // Commande pour redécouvrir
        registry.registerCommand(PluginsCommands.DISCOVER_PLUGINS, {
            execute: () => {
                const widget = this.tryGetWidget();
                if (widget) {
                    widget.discoverPlugins();
                }
                void this.pluginToolsManager.refreshTools({ silent: true });
            },
            isEnabled: () => this.tryGetWidget() !== undefined
        });

        // Commande pour vérifier le statut des tools IA
        registry.registerCommand(PluginsCommands.CHECK_TOOLS_STATUS, {
            execute: () => {
                const status = this.pluginToolsManager.getToolsStatus();
                this.pluginToolsManager.logToolsStatus();

                if (status.total === 0) {
                    this.messages.error('Aucun tool IA enregistré - vérifiez que les plugins sont actifs');
                } else {
                    this.messages.info(`${status.total} tools IA actifs: ${status.names.join(', ')}`);
                }
            }
        });
    }
    
    /**
     * Enregistre les menus.
     */
    registerMenus(menus: MenuModelRegistry): void {
        super.registerMenus(menus);
        
        // Ajouter au menu View
        menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
            commandId: PluginsCommands.OPEN_PLUGINS_BROWSER.id,
            label: 'Plugins Browser',
            order: '5'
        });
    }
}

/**
 * Contribution pour le widget Plugin Executor.
 */
@injectable()
export class PluginExecutorContribution extends AbstractViewContribution<PluginExecutorWidget> {
    
    constructor(
        @inject(PluginTabsManager) protected readonly pluginTabsManager: PluginTabsManager
    ) {
        super({
            widgetId: PluginExecutorWidget.ID,
            widgetName: PluginExecutorWidget.LABEL,
            defaultWidgetOptions: {
                area: 'main'
            },
            toggleCommandId: PluginsCommands.OPEN_PLUGIN_EXECUTOR.id
        });

        // Écouter l'événement d'ouverture de plugin depuis la recherche globale
        if (typeof window !== 'undefined') {
            window.addEventListener('geoapp-open-plugin', ((event: CustomEvent) => {
                const { pluginName } = event.detail;
                if (pluginName) {
                    this.openWithPlugin(pluginName);
                }
            }) as EventListener);
        }
    }
    
    /**
     * Ouvre l'executor en MODE GEOCACHE avec un contexte de géocache.
     * Utilisé quand l'utilisateur clique "Analyser" depuis GeocacheDetailsWidget.
     */
    async openWithContext(context: GeocacheContext, pluginName?: string, autoExecute: boolean = false): Promise<void> {
        console.log('[PluginExecutorContribution] openWithContext called', context, 'pluginName:', pluginName, 'autoExecute:', autoExecute);
        await this.pluginTabsManager.openForGeocache({
            context,
            pluginName,
            autoExecute
        });
    }
    
    /**
     * Ouvre l'executor en MODE PLUGIN avec un plugin pré-sélectionné.
     * Utilisé quand l'utilisateur clique sur un plugin dans le PluginsBrowserWidget.
     */
    async openWithPlugin(pluginName: string): Promise<void> {
        await this.pluginTabsManager.openPlugin({ pluginName });
    }
}

/**
 * Contribution pour initialiser l'extension au démarrage.
 */
@injectable()
export class PluginsFrontendApplicationContribution implements FrontendApplicationContribution {
    
    onStart(): void {
        // Hook pour initialisation au démarrage si nécessaire
        console.log('MysterAI Plugins Extension started');
    }
}
