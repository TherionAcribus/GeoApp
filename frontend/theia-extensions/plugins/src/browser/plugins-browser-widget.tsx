/**
 * Widget Plugins Browser - Liste et gestion des plugins.
 * 
 * Ce widget affiche la liste des plugins disponibles avec des filtres,
 * permet de voir les détails et de rafraîchir la liste.
 */

import * as React from '@theia/core/shared/react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core/lib/common/message-service';
import { PluginsService } from '../common/plugin-protocol';
import { Plugin, PluginFilters, PluginsStatus } from '../common/plugin-protocol';
import { PluginExecutorContribution } from './plugins-contribution';
import { PluginToolsManager } from './plugin-tools-manager';

/**
 * Widget pour naviguer dans les plugins disponibles.
 */
@injectable()
export class PluginsBrowserWidget extends ReactWidget {
    
    static readonly ID = 'mysterai-plugins-browser';
    static readonly LABEL = 'Plugin List';
    
    @inject(PluginsService)
    protected readonly pluginsService!: PluginsService;
    
    @inject(MessageService)
    protected readonly messageService!: MessageService;
    
    @inject(PluginExecutorContribution)
    protected readonly pluginExecutorContribution!: PluginExecutorContribution;

    @inject(PluginToolsManager)
    protected readonly pluginToolsManager!: PluginToolsManager;
    
    // État du widget
    protected plugins: Plugin[] = [];
    protected filteredPlugins: Plugin[] = [];
    protected loading = true;
    protected error: string | undefined;
    protected status: PluginsStatus | undefined;

    // Plugins en cours d'action (toggle / reload) : leurs contrôles sont gelés
    protected busyPlugins = new Set<string>();
    
    // Filtres
    protected sourceFilter: 'all' | 'official' | 'custom' = 'all';
    protected categoryFilter = 'all';
    protected enabledFilter: 'all' | 'enabled' | 'disabled' = 'all';
    protected searchQuery = '';
    
    // Catégories disponibles
    protected availableCategories: string[] = [];
    
    constructor() {
        super();
        this.id = PluginsBrowserWidget.ID;
        this.title.label = PluginsBrowserWidget.LABEL;
        this.title.caption = PluginsBrowserWidget.LABEL;
        this.title.closable = true;
        this.title.iconClass = 'fa fa-puzzle-piece';
    }
    
    @postConstruct()
    protected init(): void {
        this.update();
        this.loadPlugins();
    }
    
    /**
     * Charge la liste des plugins depuis le backend.
     */
    async loadPlugins(): Promise<void> {
        this.loading = true;
        this.error = undefined;
        this.update();
        
        try {
            await this.fetchPlugins();
            this.loading = false;
            this.update();

        } catch (err) {
            this.error = err instanceof Error ? err.message : 'Erreur inconnue';
            this.loading = false;
            this.update();
            this.messageService.error(`Erreur lors du chargement des plugins: ${this.error}`);
        }
    }

    /**
     * Récupère la liste des plugins et leur statut sans toucher au spinner :
     * utilisé par loadPlugins et pour le rafraîchissement silencieux après
     * une action sur un plugin.
     */
    protected async fetchPlugins(): Promise<void> {
        // enabled=false côté backend signifie « ne pas restreindre aux
        // plugins activés » : la liste complète est nécessaire au filtre
        // « Désactivés » (appliqué localement).
        const [plugins, status] = await Promise.all([
            this.pluginsService.listPlugins({ enabled: false }),
            this.pluginsService.getPluginsStatus().catch(err => {
                console.warn('Statut des plugins indisponible:', err);
                return undefined;
            })
        ]);
        this.plugins = plugins;
        this.status = status;
        this.extractCategories();
        this.applyFilters();
    }
    
    /**
     * Extrait les catégories uniques des plugins.
     */
    protected extractCategories(): void {
        const categoriesSet = new Set<string>();
        
        this.plugins.forEach(plugin => {
            if (plugin.categories) {
                plugin.categories.forEach(cat => categoriesSet.add(cat));
            }
        });
        
        this.availableCategories = Array.from(categoriesSet).sort();
    }
    
    /**
     * Applique les filtres sur la liste des plugins.
     */
    protected applyFilters(): void {
        let filtered = [...this.plugins];
        
        // Filtre par source
        if (this.sourceFilter !== 'all') {
            filtered = filtered.filter(p => p.source === this.sourceFilter);
        }
        
        // Filtre par catégorie
        if (this.categoryFilter !== 'all') {
            filtered = filtered.filter(p =>
                p.categories?.includes(this.categoryFilter)
            );
        }
        
        // Filtre par statut enabled
        if (this.enabledFilter === 'enabled') {
            filtered = filtered.filter(p => p.enabled === true);
        } else if (this.enabledFilter === 'disabled') {
            filtered = filtered.filter(p => p.enabled === false);
        }
        
        // Filtre par recherche textuelle
        if (this.searchQuery.trim()) {
            const query = this.searchQuery.toLowerCase();
            filtered = filtered.filter(p =>
                p.name.toLowerCase().includes(query) ||
                p.description?.toLowerCase().includes(query) ||
                p.author?.toLowerCase().includes(query)
            );
        }
        
        this.filteredPlugins = filtered;
    }
    
    /**
     * Rafraîchit la liste des plugins.
     */
    async refresh(): Promise<void> {
        await this.loadPlugins();
        this.messageService.info('Liste des plugins rafraîchie');
    }
    
    /**
     * Demande au backend de redécouvrir les plugins.
     */
    async discoverPlugins(): Promise<void> {
        try {
            // POST /api/plugins/discover est synchrone : la liste peut être
            // rechargée immédiatement.
            const result = await this.pluginsService.discoverPlugins();
            await this.loadPlugins();

            const errorCount = Object.keys(result.errors).length;
            if (errorCount > 0) {
                this.messageService.warn(
                    `${result.discovered} plugin(s) découvert(s), ${errorCount} erreur(s) — détail dans la liste des plugins`
                );
            } else {
                this.messageService.info(`${result.discovered} plugin(s) découvert(s)`);
            }

        } catch (err) {
            const message = err instanceof Error ? err.message : 'Erreur inconnue';
            this.messageService.error(`Erreur lors de la redécouverte: ${message}`);
        }
    }
    
    /**
     * Gère le changement de filtre de source.
     */
    protected handleSourceFilterChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
        this.sourceFilter = event.target.value as any;
        this.applyFilters();
        this.update();
    };
    
    /**
     * Gère le changement de filtre de catégorie.
     */
    protected handleCategoryFilterChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
        this.categoryFilter = event.target.value;
        this.applyFilters();
        this.update();
    };
    
    /**
     * Gère le changement de filtre enabled.
     */
    protected handleEnabledFilterChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
        this.enabledFilter = event.target.value as any;
        this.applyFilters();
        this.update();
    };
    
    /**
     * Gère le changement de recherche.
     */
    protected handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
        this.searchQuery = event.target.value;
        this.applyFilters();
        this.update();
    };
    
    /**
     * Gère le clic sur un plugin - Ouvre le Plugin Executor avec le plugin pré-sélectionné.
     */
    protected handlePluginClick = (plugin: Plugin): void => {
        if (plugin.enabled !== true) {
            this.messageService.info(
                `Le plugin ${plugin.name} est désactivé. Activez-le pour l'utiliser.`
            );
            return;
        }
        this.pluginExecutorContribution.openWithPlugin(plugin.name);
    };

    /**
     * Active ou désactive un plugin, puis rafraîchit la liste et les outils.
     */
    protected async togglePluginEnabled(plugin: Plugin): Promise<void> {
        this.busyPlugins.add(plugin.name);
        this.update();

        try {
            await this.pluginsService.setPluginEnabled(plugin.name, !plugin.enabled);
            await this.fetchPlugins();
            void this.pluginToolsManager.refreshTools({ silent: true });
            this.messageService.info(
                `Plugin ${plugin.name} ${plugin.enabled ? 'désactivé' : 'activé'}`
            );
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Erreur inconnue';
            this.messageService.error(
                `Erreur lors du changement d'état du plugin: ${message}`
            );
        } finally {
            this.busyPlugins.delete(plugin.name);
            this.update();
        }
    }

    /**
     * Recharge un plugin (code rechargé depuis le disque).
     */
    protected async reloadPlugin(plugin: Plugin): Promise<void> {
        this.busyPlugins.add(plugin.name);
        this.update();

        try {
            await this.pluginsService.reloadPlugin(plugin.name);
            this.messageService.info(`Plugin ${plugin.name} rechargé`);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Erreur inconnue';
            this.messageService.error(
                `Erreur lors du rechargement de ${plugin.name}: ${message}`
            );
        } finally {
            // Rafraîchir le statut pour afficher une éventuelle erreur de chargement
            await this.fetchPlugins().catch(err => console.warn('Rafraîchissement des plugins impossible:', err));
            this.busyPlugins.delete(plugin.name);
            this.update();
        }
    }

    /**
     * Retourne les deux derniers segments d'un chemin de dossier.
     */
    protected lastPathSegments(path: string): string {
        const segments = path.split(/[\\/]/).filter(Boolean);
        return segments.slice(-2).join('/');
    }
    
    /**
     * Rendu du widget.
     */
    protected render(): React.ReactNode {
        return (
            <div className="mysterai-plugins-browser">
                {this.renderToolbar()}
                {this.renderFilters()}
                {this.renderDiscoveryErrors()}
                {this.renderContent()}
            </div>
        );
    }
    
    /**
     * Rendu de la barre d'outils.
     */
    protected renderToolbar(): React.ReactNode {
        return (
            <div className="plugins-toolbar">
                <button
                    className="theia-button"
                    onClick={() => this.refresh()}
                    title="Rafraîchir la liste"
                    aria-label="Rafraîchir la liste"
                    disabled={this.loading}
                >
                    <i className="fa fa-refresh" aria-hidden="true" />
                </button>
                <button
                    className="theia-button"
                    onClick={() => this.discoverPlugins()}
                    title="Redécouvrir les plugins"
                    disabled={this.loading}
                >
                    <i className="fa fa-search" /> Découvrir
                </button>
                <div className="plugins-count">
                    {this.filteredPlugins.length} / {this.plugins.length} plugins
                </div>
            </div>
        );
    }
    
    /**
     * Rendu des filtres.
     */
    protected renderFilters(): React.ReactNode {
        return (
            <div className="plugins-filters">
                <div className="filter-group">
                    <label>Recherche:</label>
                    <input
                        type="text"
                        className="theia-input"
                        placeholder="Nom, description..."
                        value={this.searchQuery}
                        onChange={this.handleSearchChange}
                        disabled={this.loading}
                    />
                </div>
                
                <div className="filter-group">
                    <label>Source:</label>
                    <select
                        className="theia-select"
                        value={this.sourceFilter}
                        onChange={this.handleSourceFilterChange}
                        disabled={this.loading}
                    >
                        <option value="all">Tous</option>
                        <option value="official">Official</option>
                        <option value="custom">Custom</option>
                    </select>
                </div>
                
                <div className="filter-group">
                    <label>Catégorie:</label>
                    <select
                        className="theia-select"
                        value={this.categoryFilter}
                        onChange={this.handleCategoryFilterChange}
                        disabled={this.loading}
                    >
                        <option value="all">Toutes</option>
                        {this.availableCategories.map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                        ))}
                    </select>
                </div>
                
                <div className="filter-group">
                    <label>Statut:</label>
                    <select
                        className="theia-select"
                        value={this.enabledFilter}
                        onChange={this.handleEnabledFilterChange}
                        disabled={this.loading}
                    >
                        <option value="all">Tous</option>
                        <option value="enabled">Activés</option>
                        <option value="disabled">Désactivés</option>
                    </select>
                </div>
            </div>
        );
    }
    
    /**
     * Rendu du panneau des erreurs de découverte (dossiers de plugins
     * ignorés car non enregistrés ou en double).
     */
    protected renderDiscoveryErrors(): React.ReactNode {
        const discoveryErrors = this.status?.discovery_errors;
        const entries = discoveryErrors ? Object.entries(discoveryErrors) : [];
        if (entries.length === 0) {
            return undefined;
        }

        return (
            <details className="plugins-discovery-errors">
                <summary>
                    <i className="fa fa-exclamation-triangle" aria-hidden="true" />
                    {entries.length} dossier(s) de plugin ignoré(s)
                </summary>
                <ul>
                    {entries.map(([dirPath, message]) => (
                        <li key={dirPath}>
                            <code title={dirPath}>{this.lastPathSegments(dirPath)}</code> {message}
                        </li>
                    ))}
                </ul>
            </details>
        );
    }

    /**
     * Rendu du contenu principal.
     */
    protected renderContent(): React.ReactNode {
        if (this.loading) {
            return (
                <div className="plugins-loading">
                    <i className="fa fa-spinner fa-spin" />
                    <p>Chargement des plugins...</p>
                </div>
            );
        }
        
        if (this.error) {
            return (
                <div className="plugins-error">
                    <i className="fa fa-exclamation-triangle" />
                    <p>{this.error}</p>
                    <button className="theia-button" onClick={() => this.loadPlugins()}>
                        Réessayer
                    </button>
                </div>
            );
        }
        
        if (this.filteredPlugins.length === 0) {
            return (
                <div className="plugins-empty">
                    <i className="fa fa-puzzle-piece" />
                    <p>Aucun plugin trouvé</p>
                    {this.plugins.length > 0 && (
                        <p className="hint">Essayez de modifier les filtres</p>
                    )}
                </div>
            );
        }
        
        return (
            <div className="plugins-list">
                {this.filteredPlugins.map(plugin => this.renderPluginItem(plugin))}
            </div>
        );
    }
    
    /**
     * Rendu d'un élément de plugin.
     */
    protected renderPluginItem(plugin: Plugin): React.ReactNode {
        const isOfficial = plugin.source === 'official';
        const isEnabled = plugin.enabled === true;
        const pluginError = this.status?.plugins[plugin.name]?.error;
        const missingDeps = this.status?.plugins[plugin.name]?.missing_dependencies;
        const hasWarning = !pluginError && !!missingDeps && missingDeps.length > 0;
        const isBusy = this.busyPlugins.has(plugin.name);
        const isLoaded = this.status?.plugins[plugin.name]?.loaded === true;

        return (
            <div
                key={plugin.name}
                className={`plugin-item ${!isEnabled ? 'disabled' : ''} ${pluginError ? 'has-error' : ''} ${hasWarning ? 'has-warning' : ''}`}
                onClick={() => this.handlePluginClick(plugin)}
            >
                <div className="plugin-header">
                    <div className="plugin-status">
                        {isEnabled ? (
                            <i className="fa fa-check-circle enabled-icon" title="Activé" />
                        ) : (
                            <i className="fa fa-circle-o disabled-icon" title="Désactivé" />
                        )}
                    </div>
                    <div className="plugin-name">
                        <button type="button" className="plugin-name-button">
                            {plugin.name}
                        </button>
                        <span className="plugin-version">v{plugin.version}</span>
                    </div>
                    <div className="plugin-actions" onClick={e => e.stopPropagation()}>
                        <button
                            type="button"
                            className="theia-button secondary plugin-action-button"
                            title="Recharger le plugin"
                            aria-label={`Recharger le plugin ${plugin.name}`}
                            disabled={isBusy || !isEnabled}
                            onClick={() => this.reloadPlugin(plugin)}
                        >
                            <i className={`fa fa-refresh${isBusy ? ' fa-spin' : ''}`} aria-hidden="true" />
                        </button>
                        <label
                            className="plugin-toggle"
                            title={isEnabled ? 'Désactiver le plugin' : 'Activer le plugin'}
                        >
                            <input
                                type="checkbox"
                                role="switch"
                                checked={isEnabled}
                                disabled={isBusy}
                                aria-label={`Activer le plugin ${plugin.name}`}
                                onChange={() => this.togglePluginEnabled(plugin)}
                            />
                            <span className="plugin-toggle-track" aria-hidden="true" />
                        </label>
                    </div>
                    <div className="plugin-badge">
                        {isOfficial ? (
                            <span className="badge official" title="Plugin officiel">
                                <i className="fa fa-star" />
                            </span>
                        ) : (
                            <span className="badge custom" title="Plugin custom">
                                <i className="fa fa-user" />
                            </span>
                        )}
                    </div>
                </div>
                
                {plugin.description && (
                    <div className="plugin-description">
                        {plugin.description}
                    </div>
                )}

                {pluginError && (
                    <div className="plugin-error-message" role="status">
                        <i className="fa fa-exclamation-triangle" aria-hidden="true" />
                        {pluginError}
                    </div>
                )}

                {missingDeps && missingDeps.length > 0 && (
                    <div className="plugin-warning-message" role="status">
                        <i className="fa fa-exclamation-circle" aria-hidden="true" />
                        {`Dépendance(s) manquante(s) : ${missingDeps.join(', ')}`}
                    </div>
                )}
                
                <div className="plugin-footer">
                    {plugin.categories && plugin.categories.length > 0 && (
                        <div className="plugin-categories">
                            {plugin.categories.map(cat => (
                                <span key={cat} className="category-tag">{cat}</span>
                            ))}
                        </div>
                    )}
                    {plugin.author && (
                        <div className="plugin-author">
                            <i className="fa fa-user-o" /> {plugin.author}
                        </div>
                    )}

                    {/* Indicateurs de ressources et d'état */}
                    <div className="plugin-indicators">
                        {isLoaded && (
                            <span className="indicator" title="Chargé en mémoire">
                                <i className="fa fa-bolt" aria-hidden="true" />
                            </span>
                        )}
                        {plugin.heavy_cpu && (
                            <span className="indicator" title="Gourmand en CPU">
                                <i className="fa fa-microchip" />
                            </span>
                        )}
                        {plugin.needs_network && (
                            <span className="indicator" title="Nécessite le réseau">
                                <i className="fa fa-wifi" />
                            </span>
                        )}
                        {plugin.needs_filesystem && (
                            <span className="indicator" title="Accès fichiers">
                                <i className="fa fa-folder-open" />
                            </span>
                        )}
                    </div>
                </div>
            </div>
        );
    }
}
