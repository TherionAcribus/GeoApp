import { injectable, inject } from '@theia/core/shared/inversify';
import { ApplicationShell } from '@theia/core/lib/browser';
import { WidgetManager } from '@theia/core/lib/browser/widget-manager';

import { GeocacheLogEditorWidget } from './geocache-log-editor-widget';

export interface OpenGeocacheLogEditorOptions {
    geocacheIds: number[];
    title?: string;
}

@injectable()
export class GeocacheLogEditorTabsManager {

    protected nextId = 1;
    private nextIdSynced = false;

    constructor(
        @inject(ApplicationShell) protected readonly shell: ApplicationShell,
        @inject(WidgetManager) protected readonly widgetManager: WidgetManager,
    ) { }

    async openLogEditor(options: OpenGeocacheLogEditorOptions): Promise<GeocacheLogEditorWidget> {
        const widget = await this.createWidget();
        widget.setContext({
            geocacheIds: options.geocacheIds,
            title: options.title,
        });

        if (!widget.isAttached) {
            this.shell.addWidget(widget, { area: 'main' });
        }
        this.shell.activateWidget(widget.id);

        return widget;
    }

    protected async createWidget(): Promise<GeocacheLogEditorWidget> {
        this.syncNextId();
        const instanceId = this.nextId++;
        const widget = await this.widgetManager.getOrCreateWidget(GeocacheLogEditorWidget.ID, { instanceId });
        (widget as GeocacheLogEditorWidget).id = `${GeocacheLogEditorWidget.ID}#${instanceId}`;
        return widget as GeocacheLogEditorWidget;
    }

    private syncNextId(): void {
        if (this.nextIdSynced) {
            return;
        }
        this.nextIdSynced = true;
        const prefix = GeocacheLogEditorWidget.ID + '#';
        for (const w of this.shell.getWidgets('main')) {
            if (w.id.startsWith(prefix)) {
                const num = parseInt(w.id.substring(prefix.length), 10);
                if (!isNaN(num) && num >= this.nextId) {
                    this.nextId = num + 1;
                }
            }
        }
    }
}
