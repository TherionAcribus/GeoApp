import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplication, FrontendApplicationContribution, WidgetManager } from '@theia/core/lib/browser';
import { ZoneGeocachesWidget } from './zone-geocaches-widget';
import { GeocacheLogsWidget } from './geocache-logs-widget';
import { GeocacheNotesWidget } from './geocache-notes-widget';
import { GeocacheLogEditorTabsManager } from './geocache-log-editor-tabs-manager';
import { GeocacheTabsManager } from './geocache-tabs-manager';
import { ZoneTabsManager } from './zone-tabs-manager';
import { GeoAppWidgetEventsService } from './geoapp-widget-events-service';
import { MapWidgetFactory } from './map/map-widget-factory';

@injectable()
export class ZonesFrontendContribution implements FrontendApplicationContribution {

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(MapWidgetFactory)
    protected readonly mapWidgetFactory: MapWidgetFactory;

    @inject(GeocacheLogEditorTabsManager)
    protected readonly geocacheLogEditorTabsManager: GeocacheLogEditorTabsManager;

    @inject(GeocacheTabsManager)
    protected readonly geocacheTabsManager: GeocacheTabsManager;

    @inject(ZoneTabsManager)
    protected readonly zoneTabsManager: ZoneTabsManager;

    @inject(GeoAppWidgetEventsService)
    protected readonly widgetEventsService: GeoAppWidgetEventsService;

    async onStart(app: FrontendApplication): Promise<void> {
        // Ouverture de la table d'une zone demandée par un widget qui ne peut pas
        // dépendre de ZoneTabsManager (la carte : cycle via MapWidgetFactory).
        this.widgetEventsService.onDidRequestOpenZone(request => {
            void this.zoneTabsManager.openZone(request).catch(error => {
                console.error('[ZonesFrontendContribution] Failed to open zone tab', error);
            });
        });

        window.addEventListener('open-zone-geocaches', async (event: any) => {
            try {
                const detail = event?.detail || {};
                const zoneId = detail.zoneId;
                const zoneName = detail.zoneName;
                if (!zoneId) {
                    return;
                }

                const widget = await this.widgetManager.getOrCreateWidget(ZoneGeocachesWidget.ID) as ZoneGeocachesWidget;
                widget.setZone({ zoneId, zoneName });
                if (!widget.isAttached) {
                    app.shell.addWidget(widget, { area: 'main' });
                }
                app.shell.activateWidget(widget.id);
            } catch (error) {
                console.error('[ZonesFrontendContribution] Failed to open zone widget', error);
            }
        });

        const openGeocacheMap = async (event: any) => {
            try {
                const geocache = event?.detail?.geocache;
                if (!geocache || !geocache.id) {
                    return;
                }

                const widget = await this.widgetManager.getOrCreateWidget(ZoneGeocachesWidget.ID) as ZoneGeocachesWidget;
                await widget.openGeocacheMap(geocache);
            } catch (error) {
                console.error('[ZonesFrontendContribution] Failed to open geocache map', error);
            }
        };

        document.addEventListener('open-geocache-map', openGeocacheMap);
        window.addEventListener('open-geocache-map', openGeocacheMap);

        const openGeneralMap = async () => {
            try {
                await this.mapWidgetFactory.openGeneralMap();
            } catch (error) {
                console.error('[ZonesFrontendContribution] Failed to open general map', error);
            }
        };

        document.addEventListener('open-general-map', openGeneralMap);
        window.addEventListener('open-general-map', openGeneralMap);

        window.addEventListener('message', async (messageEvent: MessageEvent) => {
            const data = messageEvent.data;
            if (!data || data.source !== 'alphabets-extension') {
                return;
            }

            if (data.type === 'open-geocache-map') {
                try {
                    const geocache = data.geocache;
                    if (!geocache || !geocache.id) {
                        return;
                    }

                    const widget = await this.widgetManager.getOrCreateWidget(ZoneGeocachesWidget.ID) as ZoneGeocachesWidget;
                    await widget.openGeocacheMap(geocache);
                } catch (error) {
                    console.error('[ZonesFrontendContribution] Failed to open geocache map from message', error);
                }
                return;
            }

            if (data.type === 'open-general-map') {
                await openGeneralMap();
            }
        });

        const openLogs = async (event: any) => {
            try {
                const detail = event?.detail || {};
                const geocacheId = detail.geocacheId;
                const gcCode = detail.gcCode;
                const name = detail.name;

                if (!geocacheId) {
                    return;
                }

                const widget = await this.widgetManager.getOrCreateWidget(GeocacheLogsWidget.ID) as GeocacheLogsWidget;
                widget.setGeocache({ geocacheId, gcCode, name });
                if (!widget.isAttached) {
                    app.shell.addWidget(widget, { area: 'right' });
                }
                app.shell.activateWidget(widget.id);
            } catch (error) {
                console.error('[ZonesFrontendContribution] Failed to open logs widget', error);
            }
        };

        window.addEventListener('open-geocache-logs', openLogs);
        document.addEventListener('open-geocache-logs', openLogs);

        const openNotes = async (event: any) => {
            try {
                const detail = event?.detail || {};
                const geocacheId = detail.geocacheId;
                const gcCode = detail.gcCode;
                const name = detail.name;

                if (!geocacheId) {
                    return;
                }

                const widget = await this.widgetManager.getOrCreateWidget(GeocacheNotesWidget.ID) as GeocacheNotesWidget;
                widget.setGeocache({ geocacheId, gcCode, name });
                if (!widget.isAttached) {
                    app.shell.addWidget(widget, { area: 'right' });
                }
                app.shell.activateWidget(widget.id);
            } catch (error) {
                console.error('[ZonesFrontendContribution] Failed to open notes widget', error);
            }
        };

        window.addEventListener('open-geocache-notes', openNotes);
        document.addEventListener('open-geocache-notes', openNotes);

        const openLogEditor = async (event: any) => {
            try {
                const detail = event?.detail || {};
                const geocacheIds = Array.isArray(detail.geocacheIds) ? detail.geocacheIds : [];
                const title = detail.title;
                if (!geocacheIds.length) {
                    return;
                }

                await this.geocacheLogEditorTabsManager.openLogEditor({ geocacheIds, title });
            } catch (error) {
                console.error('[ZonesFrontendContribution] Failed to open log editor', error);
            }
        };

        window.addEventListener('open-geocache-log-editor', openLogEditor);
        document.addEventListener('open-geocache-log-editor', openLogEditor);

        // Ouverture des détails d'une géocache (recherche globale, plugin executor…).
        // Listener global pour fonctionner même si le tableau de zone n'est pas ouvert.
        const openDetails = async (event: any) => {
            try {
                const detail = event?.detail || {};
                const geocacheId = detail.geocacheId;
                if (!geocacheId) {
                    return;
                }
                await this.geocacheTabsManager.openGeocacheDetails({
                    geocacheId,
                    name: detail.name,
                });
            } catch (error) {
                console.error('[ZonesFrontendContribution] Failed to open geocache details', error);
            }
        };

        window.addEventListener('geoapp-open-geocache-details', openDetails);
        document.addEventListener('geoapp-open-geocache-details', openDetails);
    }
}
