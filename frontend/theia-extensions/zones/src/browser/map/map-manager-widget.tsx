import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ApplicationShell } from '@theia/core/lib/browser';
import { Disposable } from '@theia/core/lib/common/disposable';
import { MapWidget, MapContext } from './map-widget';
import '../../../src/browser/map/map-manager-widget.css';

@injectable()
export class MapManagerWidget extends ReactWidget {
    static readonly ID = 'geoapp-map-manager';
    static readonly LABEL = 'Cartes';

    private openMaps: Array<{ id: string; label: string; context: MapContext }> = [];
    /** Signature de la liste courante, pour éviter les rendus inutiles. */
    private mapsSignature = '';
    private refreshTimeout: ReturnType<typeof setTimeout> | undefined;
    /** Id de la dernière carte activée, mise en évidence dans la liste. */
    private activeMapId: string | undefined;

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

        // On ne réagit qu'aux ajouts/suppressions de widgets (l'affichage ne dépend
        // pas du widget actif). Les événements sont regroupés (debounce) pour éviter
        // de recalculer la liste à chaque widget ouvert lors d'un burst.
        this.toDispose.push(this.shell.onDidAddWidget(() => this.scheduleRefresh()));
        this.toDispose.push(this.shell.onDidRemoveWidget(() => this.scheduleRefresh()));
        this.toDispose.push(Disposable.create(() => this.clearRefreshTimeout()));

        // Mise en évidence de la carte active. Handler O(1) (lecture du widget actif
        // + mise à jour conditionnelle), sans recalcul de la liste.
        this.toDispose.push(this.shell.onDidChangeActiveWidget(() => this.updateActiveMap()));

        this.refreshMapList();
        this.updateActiveMap();
        this.update();
    }

    /** Met à jour la carte active si le widget actif est une carte (sinon conserve la dernière). */
    private updateActiveMap(): void {
        const active = this.shell.activeWidget;
        if (active && active.id !== MapManagerWidget.ID && active.id.startsWith('geoapp-map')) {
            if (this.activeMapId !== active.id) {
                this.activeMapId = active.id;
                this.update();
            }
        }
    }

    private clearRefreshTimeout(): void {
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
            this.refreshTimeout = undefined;
        }
    }

    /** Planifie un rafraîchissement groupé (debounce) suite aux événements du shell. */
    private scheduleRefresh(): void {
        this.clearRefreshTimeout();
        this.refreshTimeout = setTimeout(() => {
            this.refreshTimeout = undefined;
            this.refreshMapList();
        }, 100);
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

        // Oublier la carte active si elle n'est plus ouverte
        if (this.activeMapId && !newMaps.some(map => map.id === this.activeMapId)) {
            this.activeMapId = undefined;
        }

        // Comparaison légère par id + label + type (évite un JSON.stringify fragile
        // à l'ordre des clés des objets context).
        const signature = newMaps.map(map => `${map.id}|${map.label}|${map.context.type}`).join('::');
        if (signature !== this.mapsSignature) {
            this.mapsSignature = signature;
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
                    <div className="map-manager-list" role="list" aria-label="Cartes ouvertes">
                        {this.openMaps.map(map => {
                            const isActive = map.id === this.activeMapId;
                            return (
                            <div
                                key={map.id}
                                className={`map-manager-item${isActive ? ' map-manager-item--active' : ''}`}
                                role="button"
                                tabIndex={0}
                                aria-label={`Activer la carte ${map.label}`}
                                aria-current={isActive ? 'true' : undefined}
                                onClick={() => this.activateMap(map.id)}
                                onKeyDown={event => this.handleItemKeyDown(event, map.id)}
                                title={map.label}
                            >
                                <div className="map-item-icon" aria-hidden="true">
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
                                        aria-label={`Fermer la carte ${map.label}`}
                                        title="Fermer"
                                    >
                                        <span aria-hidden="true">×</span>
                                    </button>
                                </div>
                            </div>
                            );
                        })}
                    </div>
                )}

                <div className="map-manager-footer">
                    <button
                        className="map-manager-close-all"
                        onClick={() => this.closeAllMaps()}
                        disabled={this.openMaps.length === 0}
                        title="Fermer toutes les cartes"
                    >
                        <i className="fa fa-trash" aria-hidden="true"></i> Fermer tout
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

    private handleItemKeyDown(event: React.KeyboardEvent<HTMLDivElement>, mapId: string): void {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            this.activateMap(mapId);
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
