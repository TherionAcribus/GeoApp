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
import { Plugin, PluginFilters } from '../common/plugin-protocol';
import { PluginExecutorContribution } from './plugins-contribution';

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
    
    // État du widget
    protected plugins: Plugin[] = [];
    protected filteredPlugins: Plugin[] = [];
    protected loading = true;
    protected error: string | undefined;
    
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
            this.plugins = await this.pluginsService.listPlugins();
            this.extractCategories();
            this.applyFilters();
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
            await this.pluginsService.discoverPlugins();
            this.messageService.info('Redécouverte des plugins lancée');
            
            // Recharger après une courte pause
            setTimeout(() => this.loadPlugins(), 1000);
            
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
        console.log('Opening plugin executor for:', plugin.name);
        this.pluginExecutorContribution.openWithPlugin(plugin.name);
    };
    
    /**
     * Rendu du widget.
     */
    protected render(): React.ReactNode {
        return (
            <div className="mysterai-plugins-browser">
                {this.renderToolbar()}
                {this.renderFilters()}
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
                    disabled={this.loading}
                >
                    <i className="fa fa-refresh" />
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
                    <label>Catégorie4:</label>
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
        
        return (
            <div
                key={plugin.name}
                className={`plugin-item ${!isEnabled ? 'disabled' : ''}`}
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
                        {plugin.name}
                        <span className="plugin-version">v{plugin.version}</span>
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
                </div>
                
                {/* Indicateurs de ressources */}
                <div className="plugin-indicators">
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
        );
    }
}
