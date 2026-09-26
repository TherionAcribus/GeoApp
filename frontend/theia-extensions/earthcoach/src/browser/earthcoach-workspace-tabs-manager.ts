import { ApplicationShell } from '@theia/core/lib/browser';
import { WidgetManager } from '@theia/core/lib/browser/widget-manager';
import { inject, injectable } from '@theia/core/shared/inversify';
import { EarthCoachContext } from './earthcoach-context-service';
import { EarthCoachWorkspaceWidget } from './earthcoach-workspace-widget';
import { EarthCoachWorkspaceOpenOptions } from './earthcoach-workspace-types';

interface WorkspaceTabEntry {
    widget: EarthCoachWorkspaceWidget;
    geocacheId: number;
}

@injectable()
export class EarthCoachWorkspaceTabsManager {
    protected readonly tabs: WorkspaceTabEntry[] = [];
    protected nextId = 1;

    constructor(
        @inject(ApplicationShell) protected readonly shell: ApplicationShell,
        @inject(WidgetManager) protected readonly widgetManager: WidgetManager,
    ) { }

    async open(context: EarthCoachContext, options: EarthCoachWorkspaceOpenOptions = {}): Promise<EarthCoachWorkspaceWidget> {
        this.cleanup();
        const existing = this.tabs.find(entry => entry.geocacheId === context.geocacheData.id && !entry.widget.isDisposed);
        if (existing) {
            existing.widget.setContext(context, options);
            this.attach(existing.widget);
            return existing.widget;
        }
        const instanceId = this.nextId++;
        const widget = await this.widgetManager.getOrCreateWidget<EarthCoachWorkspaceWidget>(
            EarthCoachWorkspaceWidget.ID,
            { instanceId }
        );
        widget.id = `${EarthCoachWorkspaceWidget.ID}#${instanceId}`;
        widget.setContext(context, options);
        this.tabs.push({ widget, geocacheId: context.geocacheData.id });
        this.attach(widget);
        return widget;
    }

    protected attach(widget: EarthCoachWorkspaceWidget): void {
        if (!widget.isAttached) {
            this.shell.addWidget(widget, { area: 'main' });
        }
        this.shell.activateWidget(widget.id);
    }

    protected cleanup(): void {
        for (let index = this.tabs.length - 1; index >= 0; index -= 1) {
            if (this.tabs[index].widget.isDisposed) {
                this.tabs.splice(index, 1);
            }
        }
    }
}
