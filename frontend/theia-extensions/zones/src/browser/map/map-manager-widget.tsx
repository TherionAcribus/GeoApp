import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ApplicationShell } from '@theia/core/lib/browser';
import { MapWidget, MapContext } from './map-widget';
import '../../../src/browser/map/map-manager-widget.css';

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

        this.toDispose.push(this.shell.onDidAddWidget(() => this.refreshMapList()));
        this.toDispose.push(this.shell.onDidRemoveWidget(() => this.refreshMapList()));
        this.toDispose.push(this.shell.onDidChangeActiveWidget(() => this.refreshMapList()));

        this.refreshMapList();
        this.update();
    }

    private refreshMapList(): void {
        const bottomWidgets = this.shell.getWidgets('bottom');
        const mapWidgets = bottomWidgets.filter(widget => widget.id.startsWith('geoapp-map'));

        const newMaps = mapWidgets.map(widget => {
            const mapWidget = widget as MapWidget;
            const context = mapWidget.getContext ? mapWidget.getContext() : undefined;

            return {
                id: widget.id,
                label: widget.title.label,
                context: context || { type: 'general' as const, label: widget.title.label }
            };
        });

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
                        <small>Les cartes s'ouvrent automatiquement quand vous naviguez dans les zones ou geocaches</small>
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
                                        onClick={event => {
                                            event.stopPropagation();
                                            this.closeMap(map.id);
                                        }}
                                        title="Fermer"
                                    >
                                        x
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
                return '\u{1F5FA}\uFE0F';
            case 'geocache':
                return '\u{1F4CD}';
            default:
                return '\u{1F30D}';
        }
    }

    private getMapTypeLabel(type: 'zone' | 'geocache' | 'general'): string {
        switch (type) {
            case 'zone':
                return 'Zone';
            case 'geocache':
                return 'Geocache';
            default:
                return 'Generale';
        }
    }

    private activateMap(mapId: string): void {
        this.shell.activateWidget(mapId);
    }

    private closeMap(mapId: string): void {
        const widget = this.shell.getWidgets('bottom').find(candidate => candidate.id === mapId);
        if (widget) {
            widget.close();
        }
        this.refreshMapList();
    }

    private closeAllMaps(): void {
        const mapWidgets = this.shell.getWidgets('bottom').filter(widget => widget.id.startsWith('geoapp-map'));
        mapWidgets.forEach(widget => widget.close());
        this.refreshMapList();
    }
}
