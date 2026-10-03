import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core';
import { ApplicationShell } from '@theia/core/lib/browser';
import { WidgetManager } from '@theia/core/lib/browser/widget-manager';
import { getDraftKey } from './log-editor/log-history-store';

import { GeocacheLogEditorWidget } from './geocache-log-editor-widget';
import { LogEditorPrefill } from './log-editor/types';

export interface OpenGeocacheLogEditorOptions {
    geocacheIds: number[];
    title?: string;
    /** Pré-remplissage (visites GPS) : date, types de log, aide-mémoire par cache. */
    prefill?: LogEditorPrefill;
}

@injectable()
export class GeocacheLogEditorTabsManager {

    protected nextId = 1;
    private nextIdSynced = false;

    constructor(
        @inject(ApplicationShell) protected readonly shell: ApplicationShell,
        @inject(WidgetManager) protected readonly widgetManager: WidgetManager,
    ) { }

    protected readonly onDidChangeLogEditorsEmitter = new Emitter<void>();
    /** Un onglet de log s'ouvre ou se ferme (« Reprendre » du widget Visites GPS). */
    readonly onDidChangeLogEditors: Event<void> = this.onDidChangeLogEditorsEmitter.event;

    @postConstruct()
    protected init(): void {
        const notify = (widget: unknown): void => {
            if (widget instanceof GeocacheLogEditorWidget) {
                this.onDidChangeLogEditorsEmitter.fire();
            }
        };
        this.shell.onDidAddWidget(notify);
        this.shell.onDidRemoveWidget(notify);
    }

    /** Onglet ouvert sur exactement ces géocaches (ordre indifférent), s'il y en a un. */
    findLogEditor(geocacheIds: number[]): GeocacheLogEditorWidget | undefined {
        const key = getDraftKey(geocacheIds);
        if (!key) {
            return undefined;
        }
        return this.shell.getWidgets('main').find((widget): widget is GeocacheLogEditorWidget =>
            widget instanceof GeocacheLogEditorWidget && getDraftKey(widget.getGeocacheIds()) === key
        );
    }

    /** Revient à l'onglet de ces géocaches s'il est ouvert, sinon l'ouvre : son brouillon est restauré. */
    async resumeLogEditor(options: OpenGeocacheLogEditorOptions): Promise<GeocacheLogEditorWidget> {
        const open = this.findLogEditor(options.geocacheIds);
        if (open) {
            this.shell.activateWidget(open.id);
            return open;
        }
        return this.openLogEditor(options);
    }

    async openLogEditor(options: OpenGeocacheLogEditorOptions): Promise<GeocacheLogEditorWidget> {
        const widget = await this.createWidget();
        widget.setContext({
            geocacheIds: options.geocacheIds,
            title: options.title,
            prefill: options.prefill,
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
