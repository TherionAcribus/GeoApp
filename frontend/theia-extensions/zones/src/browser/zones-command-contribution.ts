import { injectable, inject } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { ZonesTreeWidget } from './zones-tree-widget';
import { ZoneGeocachesWidget } from './zone-geocaches-widget';
import { MapWidget } from './map/map-widget';
import { GeocachingAuthWidget } from './geocaching-auth-widget';
import { ArchiveManagerWidget } from './archive-manager-widget';

export const ZonesCommands = {
    OPEN: <Command>{ id: 'zones:open', label: 'Zones: Ouvrir' },
    OPEN_ZONE: <Command>{ id: 'zones:open-zone', label: 'Zones: Ouvrir Zone' },
    OPEN_MAP: <Command>{ id: 'geoapp.map.toggle', label: 'GeoApp: Afficher la carte' },
    OPEN_AUTH: <Command>{ id: 'geoapp.auth.open', label: 'GeoApp: Connexion Geocaching.com' },
    OPEN_ARCHIVE_MANAGER: <Command>{ id: 'geoapp.archive.manager.open', label: 'GeoApp: Gestionnaire d\'archive' }
};

@injectable()
export class ZonesCommandContribution implements CommandContribution {
    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(ZonesCommands.OPEN, {
            execute: async () => {
                const widget = await this.widgetManager.getOrCreateWidget(ZonesTreeWidget.ID);
                if (!widget.isAttached) {
                    this.shell.addWidget(widget, { area: 'left' });
                }
                this.shell.activateWidget(widget.id);
            }
        });

        // Ouvre un nouvel onglet central avec le tableau des géocaches de la zone
        commands.registerCommand(ZonesCommands.OPEN_ZONE, {
            execute: async (args?: { zoneId: number; zoneName?: string }) => {
                const widget = await this.widgetManager.getOrCreateWidget(ZoneGeocachesWidget.ID) as ZoneGeocachesWidget;
                if (!widget.isAttached) {
                    this.shell.addWidget(widget, { area: 'main' });
                }
                if (args?.zoneId) {
                    widget.setZone({ zoneId: args.zoneId, zoneName: args.zoneName });
                }
                this.shell.activateWidget(widget.id);
            }
        });

        // Ouvre/ferme la carte dans le Bottom Layer
        commands.registerCommand(ZonesCommands.OPEN_MAP, {
            execute: async () => {
                const widget = await this.widgetManager.getOrCreateWidget(MapWidget.ID);
                if (!widget.isAttached) {
                    this.shell.addWidget(widget, { area: 'bottom' });
                }
                this.shell.activateWidget(widget.id);
            }
        });

        // Ouvre le widget d'authentification Geocaching.com
        commands.registerCommand(ZonesCommands.OPEN_AUTH, {
            execute: async () => {
                const widget = await this.widgetManager.getOrCreateWidget(GeocachingAuthWidget.ID);
                if (!widget.isAttached) {
                    this.shell.addWidget(widget, { area: 'main' });
                }
                this.shell.activateWidget(widget.id);
            }
        });

        // Ouvre le gestionnaire d'archive de résolution
        commands.registerCommand(ZonesCommands.OPEN_ARCHIVE_MANAGER, {
            execute: async () => {
                const widget = await this.widgetManager.getOrCreateWidget(ArchiveManagerWidget.ID);
                if (!widget.isAttached) {
                    this.shell.addWidget(widget, { area: 'main' });
                }
                this.shell.activateWidget(widget.id);
            }
        });
    }
}


