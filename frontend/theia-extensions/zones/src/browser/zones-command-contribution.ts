import { injectable, inject } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { ZonesTreeWidget } from './zones-tree-widget';
import { ZoneGeocachesWidget } from './zone-geocaches-widget';
import { MapWidget } from './map/map-widget';

import { GeocachingAuthWidget } from './geocaching-auth-widget';
import { FriendsTab, GeocachingFriendsWidget } from './geocaching-friends-widget';
import { GeocachingFriendSummaryWidget } from './geocaching-friend-summary-widget';
import { ArchiveManagerWidget } from './archive-manager-widget';
import { TrackablesWidget, TrackablesWidgetContext } from './trackables-widget';
import { GpsVisitsWidget } from './gps-visits-widget';
import { GeoAppChatPolicyCommandId, GeoAppChatPolicyWidget } from './geoapp-chat-policy-widget';
import { OutingPlanCommandId, OutingPlanWidget } from './outing-plan-widget';
import { GeoAppAiSetupCommandId, GeoAppAiSetupWidget } from './geoapp-ai-setup-widget';
import { GEOAPP_AI_SETUP_PROVIDERS } from './geoapp-ai-setup-service';
import { ServerLogTerminalWidget } from './server-log-terminal-widget';

export const ZonesCommands = {
    OPEN: <Command>{ id: 'zones:open', label: 'Zones: Ouvrir' },
    OPEN_ZONE: <Command>{ id: 'zones:open-zone', label: 'Zones: Ouvrir Zone' },
    OPEN_MAP: <Command>{ id: 'geoapp.map.toggle', label: 'GeoApp: Afficher la carte' },
    // 'geoapp.mapManager.open' est la commande de bascule de
    // MapManagerViewContribution (AbstractViewContribution) — ne pas la
    // réenregistrer ici : un second handler créerait un doublon.
    OPEN_AUTH: <Command>{ id: 'geoapp.auth.open', label: 'GeoApp: Connexion Geocaching.com' },
    OPEN_FRIENDS: <Command>{ id: 'geoapp.friends.open', label: 'GeoApp: Amis' },
    OPEN_FRIEND_ACTIVITY: <Command>{ id: 'geoapp.friends.activity.open', label: 'GeoApp: Activité des amis' },
    OPEN_FRIEND_TODO: <Command>{ id: 'geoapp.friends.todo.open', label: 'GeoApp: Caches à faire avec les amis' },
    OPEN_FRIEND_SUMMARY: <Command>{ id: 'geoapp.friends.summary.open', label: 'GeoApp: Fiche ami' },
    OPEN_ARCHIVE_MANAGER: <Command>{ id: 'geoapp.archive.manager.open', label: 'GeoApp: Gestionnaire d\'archive' },
    OPEN_TRACKABLES: <Command>{ id: 'geoapp.trackables.open', label: 'GeoApp: Trackables' },
    OPEN_GPS_VISITS: <Command>{ id: 'geoapp.gpsVisits.open', label: 'GeoApp: Visites GPS' },
    OPEN_CHAT_POLICY: <Command>{ id: GeoAppChatPolicyCommandId, label: 'GeoApp: Policy Chat IA' },
    OPEN_AI_SETUP: <Command>{ id: GeoAppAiSetupCommandId, label: 'GeoApp: Configurer l\'IA' },
    OPEN_OUTING_PLAN: <Command>{ id: OutingPlanCommandId, label: 'GeoApp: Checklist de sortie' },
    OPEN_SERVER_LOG_TERMINAL: <Command>{ id: 'geoapp.serverLogs.open', label: 'GeoApp: Terminal serveur' }
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

        // Widget Amis : les trois commandes ouvrent le même widget sur un onglet
        // différent (liste, activité, à faire).
        const openFriendsTab = async (tab: FriendsTab): Promise<GeocachingFriendsWidget> => {
            const widget = await this.widgetManager.getOrCreateWidget(GeocachingFriendsWidget.ID) as GeocachingFriendsWidget;
            if (!widget.isAttached) {
                this.shell.addWidget(widget, { area: 'main' });
            }
            widget.showTab(tab);
            this.shell.activateWidget(widget.id);
            return widget;
        };

        commands.registerCommand(ZonesCommands.OPEN_FRIENDS, {
            execute: async () => { await openFriendsTab('friends'); }
        });

        commands.registerCommand(ZonesCommands.OPEN_FRIEND_ACTIVITY, {
            execute: async (args?: { username?: string }) => {
                const widget = await openFriendsTab('activity');
                // `{ username }` : vue focalisée sur un ami (depuis sa carte).
                if (args?.username) {
                    void widget.focusAuthor(args.username);
                }
            }
        });

        commands.registerCommand(ZonesCommands.OPEN_FRIEND_TODO, {
            execute: async () => { await openFriendsTab('todo'); }
        });

        // Ouvre la fiche synthétique d'un ami (`{ username }` requis)
        commands.registerCommand(ZonesCommands.OPEN_FRIEND_SUMMARY, {
            execute: async (args?: { username?: string }) => {
                const widget = await this.widgetManager.getOrCreateWidget(GeocachingFriendSummaryWidget.ID) as GeocachingFriendSummaryWidget;
                if (!widget.isAttached) {
                    this.shell.addWidget(widget, { area: 'main' });
                }
                if (args?.username) {
                    void widget.setFriend(args.username);
                }
                this.shell.activateWidget(widget.id);
            }
        });

        // Widget Trackables : `{ tab, trackableCode, action, geocacheCode }` préremplit
        // un onglet (fiche cache du lot 4 : 'retrieve'/'discover' depuis GC…).
        commands.registerCommand(ZonesCommands.OPEN_TRACKABLES, {
            execute: async (args?: TrackablesWidgetContext) => {
                const widget = await this.widgetManager.getOrCreateWidget(TrackablesWidget.ID) as TrackablesWidget;
                if (!widget.isAttached) {
                    this.shell.addWidget(widget, { area: 'main' });
                }
                if (args) {
                    widget.setContext(args);
                }
                this.shell.activateWidget(widget.id);
            }
        });

        commands.registerCommand(ZonesCommands.OPEN_GPS_VISITS, {
            execute: async () => {
                const widget = await this.widgetManager.getOrCreateWidget(GpsVisitsWidget.ID) as GpsVisitsWidget;
                if (!widget.isAttached) {
                    this.shell.addWidget(widget, { area: 'main' });
                }
                this.shell.activateWidget(widget.id);
                void widget.reload();
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

        commands.registerCommand(ZonesCommands.OPEN_CHAT_POLICY, {
            execute: async () => {
                const widget = await this.widgetManager.getOrCreateWidget(GeoAppChatPolicyWidget.ID);
                if (!widget.isAttached) {
                    this.shell.addWidget(widget, { area: 'main' });
                }
                this.shell.activateWidget(widget.id);
            }
        });

        // Assistant de configuration de l'IA ; args.provider ouvre directement ce fournisseur
        commands.registerCommand(ZonesCommands.OPEN_AI_SETUP, {
            execute: async (args?: { provider?: string }) => {
                const existing = this.widgetManager.tryGetWidget(GeoAppAiSetupWidget.ID);
                const widget = await this.widgetManager.getOrCreateWidget(GeoAppAiSetupWidget.ID) as GeoAppAiSetupWidget;
                if (!widget.isAttached) {
                    this.shell.addWidget(widget, { area: 'main' });
                }
                this.shell.activateWidget(widget.id);
                const provider = GEOAPP_AI_SETUP_PROVIDERS.find(candidate => candidate.id === args?.provider);
                if (provider) {
                    widget.openProvider(provider.id);
                } else if (existing) {
                    void widget.showStart();
                }
            }
        });

        commands.registerCommand(ZonesCommands.OPEN_OUTING_PLAN, {
            execute: async () => {
                const widget = await this.widgetManager.getOrCreateWidget(OutingPlanWidget.ID);
                if (!widget.isAttached) {
                    this.shell.addWidget(widget, { area: 'main' });
                }
                this.shell.activateWidget(widget.id);
            }
        });

        commands.registerCommand(ZonesCommands.OPEN_SERVER_LOG_TERMINAL, {
            execute: async () => {
                const widget = await this.widgetManager.getOrCreateWidget(ServerLogTerminalWidget.ID);
                if (!widget.isAttached) {
                    this.shell.addWidget(widget, { area: 'bottom' });
                }
                this.shell.activateWidget(widget.id);
            }
        });
    }
}


