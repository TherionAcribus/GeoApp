import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplication, FrontendApplicationContribution, WidgetManager, Widget } from '@theia/core/lib/browser';
import { ZonesTreeWidget } from './zones-tree-widget';
import { ZoneGeocachesWidget } from './zone-geocaches-widget';
import { GeocacheLogsWidget } from './geocache-logs-widget';
import { GeocacheNotesWidget } from './geocache-notes-widget';
import { GeocacheLogEditorTabsManager } from './geocache-log-editor-tabs-manager';
import { MapManagerWidget } from './map/map-manager-widget';
import { MapWidgetFactory } from './map/map-widget-factory';

@injectable()
export class ZonesFrontendContribution implements FrontendApplicationContribution {

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(MapWidgetFactory)
    protected readonly mapWidgetFactory: MapWidgetFactory;

    @inject(GeocacheLogEditorTabsManager)
    protected readonly geocacheLogEditorTabsManager: GeocacheLogEditorTabsManager;

    async onStart(app: FrontendApplication): Promise<void> {
        this.schedulePostStartupWidgets(app);

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
    }

    protected async getOrCreateWidget(): Promise<Widget> {
        return this.widgetManager.getOrCreateWidget(ZonesTreeWidget.ID);
    }

    protected schedulePostStartupWidgets(app: FrontendApplication): void {
        this.scheduleNonCriticalTask(async () => {
            await this.attachZonesWidget(app);
            await this.attachMapManagerWidget(app);
        });
    }

    protected async attachZonesWidget(app: FrontendApplication): Promise<void> {
        const widget = await this.getOrCreateWidget();
        if (!widget.isAttached) {
            app.shell.addWidget(widget, { area: 'left', rank: 100 });
        }
    }

    protected async attachMapManagerWidget(app: FrontendApplication): Promise<void> {
        const mapManagerWidget = await this.widgetManager.getOrCreateWidget(MapManagerWidget.ID);
        if (!mapManagerWidget.isAttached) {
            app.shell.addWidget(mapManagerWidget, { area: 'left', rank: 200 });
        }
    }

    protected scheduleNonCriticalTask(task: () => Promise<void> | void): void {
        const runner = () => {
            void Promise.resolve(task()).catch(error => {
                console.error('[ZonesFrontendContribution] Deferred startup task failed', error);
            });
        };

        if (typeof window !== 'undefined' && typeof (window as any).requestIdleCallback === 'function') {
            (window as any).requestIdleCallback(() => runner(), { timeout: 1500 });
            return;
        }

        setTimeout(runner, 0);
    }
}
