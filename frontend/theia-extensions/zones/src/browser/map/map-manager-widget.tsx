import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ApplicationShell } from '@theia/core/lib/browser';
import { MapWidget, MapContext } from './map-widget';
import '../../../src/browser/map/map-manager-widget.css';

/**
 * Widget pour gérer les cartes ouvertes (comme les terminaux dans VSCode)
 */
@injectable()
export class MapManagerWidget extends ReactWidget {
    static readonly ID = 'geoapp-map-manager';
    static readonly LABEL = 'Cartes';

    private openMaps: Array<{ id: string; label: string; context: MapContext }> = [];

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    @postConstruct()
    protected init(): void {
        this.id = MapManagerWidget.ID;
        this.title.label = MapManagerWidget.LABEL;
        this.title.caption = 'Gestion des cartes';
        this.title.closable = false;
        this.title.iconClass = 'fa fa-map';

        this.addClass('geoapp-map-manager-widget');
        
        console.log('[MapManagerWidget] Widget initialisé avec ID:', this.id);
        
        // Rafraîchir la liste toutes les secondes
        setInterval(() => {
            this.refreshMapList();
        }, 1000);
        
        this.update();
    }

    /**
     * Rafraîchit la liste des cartes ouvertes
     */
    private refreshMapList(): void {
        const bottomWidgets = this.shell.getWidgets('bottom');
        const mapWidgets = bottomWidgets.filter(w => w.id.startsWith('geoapp-map'));
        
        const newMaps = mapWidgets.map(w => {
            const mapWidget = w as MapWidget;
            const context = mapWidget.getContext ? mapWidget.getContext() : null;
            
            return {
                id: w.id,
                label: w.title.label,
                context: context || { type: 'general' as const, label: w.title.label }
            };
        });

        // Mettre à jour seulement si la liste a changé
        if (JSON.stringify(newMaps) !== JSON.stringify(this.openMaps)) {
            this.openMaps = newMaps;
            this.update();
        }
    }

    protected render(): React.ReactNode {
        return (
            <div className="map-manager-container">
                <div className="map-manager-header">
                    <h3>Cartes ouvertes ({this.openMaps.length})</h3>
                </div>
                
                {this.openMaps.length === 0 ? (
                    <div className="map-manager-empty">
                        <p>Aucune carte ouverte</p>
                        <small>Les cartes s'ouvrent automatiquement quand vous naviguez dans les zones ou géocaches</small>
                    </div>
                ) : (
                    <div className="map-manager-list">
                        {this.openMaps.map(map => (
                            <div
                                key={map.id}
                                className="map-manager-item"
                                onClick={() => this.activateMap(map.id)}
                                title={map.label}
                            >
                                <div className="map-item-icon">
                                    {this.getMapIcon(map.context.type)}
                                </div>
                                <div className="map-item-content">
                                    <div className="map-item-label">{map.label}</div>
                                    <div className="map-item-type">{this.getMapTypeLabel(map.context.type)}</div>
                                </div>
                                <div className="map-item-actions">
                                    <button
                                        className="map-item-close"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            this.closeMap(map.id);
                                        }}
                                        title="Fermer"
                                    >
                                        ×
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                
                <div className="map-manager-footer">
                    <button
                        className="map-manager-close-all"
                        onClick={() => this.closeAllMaps()}
                        disabled={this.openMaps.length === 0}
                        title="Fermer toutes les cartes"
                    >
                        <i className="fa fa-trash"></i> Fermer tout
                    </button>
                </div>
            </div>
        );
    }

    private getMapIcon(type: 'zone' | 'geocache' | 'general'): string {
        switch (type) {
            case 'zone':
                return '🗺️';
            case 'geocache':
                return '📍';
            default:
                return '🌍';
        }
    }

    private getMapTypeLabel(type: 'zone' | 'geocache' | 'general'): string {
        switch (type) {
            case 'zone':
                return 'Zone';
            case 'geocache':
                return 'Géocache';
            default:
                return 'Générale';
        }
    }

    private activateMap(mapId: string): void {
        console.log('[MapManagerWidget] Activation de la carte:', mapId);
        this.shell.activateWidget(mapId);
    }

    private closeMap(mapId: string): void {
        console.log('[MapManagerWidget] Fermeture de la carte:', mapId);
        const widget = this.shell.getWidgets('bottom').find(w => w.id === mapId);
        if (widget) {
            widget.close();
        }
        this.refreshMapList();
    }

    private closeAllMaps(): void {
        console.log('[MapManagerWidget] Fermeture de toutes les cartes');
        const mapWidgets = this.shell.getWidgets('bottom').filter(w => w.id.startsWith('geoapp-map'));
        mapWidgets.forEach(w => w.close());
        this.refreshMapList();
    }
}

