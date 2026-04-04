// Service responsible for opening and reusing geocache image editor tabs.

import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell } from '@theia/core/lib/browser';
import { WidgetManager } from '@theia/core/lib/browser/widget-manager';
import { GeocacheImageEditorContext, GeocacheImageEditorWidget } from './geocache-image-editor-widget';

export interface OpenGeocacheImageEditorOptions extends GeocacheImageEditorContext {
}

interface EditorTabEntry {
    widget: GeocacheImageEditorWidget;
    geocacheId: number;
    imageId: number;
}

@injectable()
export class GeocacheImageEditorTabsManager {

    protected readonly tabs: EditorTabEntry[] = [];
    protected nextId = 1;
    private nextIdSynced = false;

    constructor(
        @inject(ApplicationShell) protected readonly shell: ApplicationShell,
        @inject(WidgetManager) protected readonly widgetManager: WidgetManager,
    ) {
    }

    async openImageEditor(options: OpenGeocacheImageEditorOptions): Promise<GeocacheImageEditorWidget> {
        const { geocacheId, imageId } = options;

        this.cleanupDisposed();

        const existing = this.tabs.find(entry => entry.geocacheId === geocacheId && entry.imageId === imageId && !entry.widget.isDisposed);
        if (existing) {
            existing.widget.setContext(options);
            this.attachAndActivate(existing.widget);
            return existing.widget;
        }

        const widget = await this.createWidget();
        widget.setContext(options);
        this.tabs.push({ widget, geocacheId, imageId });
        this.attachAndActivate(widget);
        return widget;
    }

    protected async createWidget(): Promise<GeocacheImageEditorWidget> {
        this.syncNextId();
        const instanceId = this.nextId++;
        const widget = await this.widgetManager.getOrCreateWidget(GeocacheImageEditorWidget.ID, { instanceId });

        (widget as GeocacheImageEditorWidget).id = `${GeocacheImageEditorWidget.ID}#${instanceId}`;

        return widget as GeocacheImageEditorWidget;
    }

    private syncNextId(): void {
        if (this.nextIdSynced) {
            return;
        }
        this.nextIdSynced = true;
        const prefix = GeocacheImageEditorWidget.ID + '#';
        for (const w of this.shell.getWidgets('main')) {
            if (w.id.startsWith(prefix)) {
                const num = parseInt(w.id.substring(prefix.length), 10);
                if (!isNaN(num) && num >= this.nextId) {
                    this.nextId = num + 1;
                }
            }
        }
    }

    protected attachAndActivate(widget: GeocacheImageEditorWidget): void {
        if (!widget.isAttached) {
            this.shell.addWidget(widget, { area: 'main' });
        }
        this.shell.activateWidget(widget.id);
    }

    protected cleanupDisposed(): void {
        for (let i = this.tabs.length - 1; i >= 0; i--) {
            if (this.tabs[i].widget.isDisposed) {
                this.tabs.splice(i, 1);
            }
        }
    }
}
