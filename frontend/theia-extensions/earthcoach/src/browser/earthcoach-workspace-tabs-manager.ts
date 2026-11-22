import { ApplicationShell } from '@theia/core/lib/browser';
import { WidgetManager } from '@theia/core/lib/browser/widget-manager';
import { inject, injectable } from '@theia/core/shared/inversify';
import { EarthCoachContext } from './earthcoach-context-service';
import { EarthCoachWorkspaceWidget } from './earthcoach-workspace-widget';
import { EarthCoachWorkspaceOpenOptions } from './earthcoach-workspace-types';

@injectable()
export class EarthCoachWorkspaceTabsManager {
    protected nextId = 1;

    constructor(
        @inject(ApplicationShell) protected readonly shell: ApplicationShell,
        @inject(WidgetManager) protected readonly widgetManager: WidgetManager,
    ) { }

    async open(context: EarthCoachContext, options: EarthCoachWorkspaceOpenOptions = {}): Promise<EarthCoachWorkspaceWidget> {
        const openWidgets = this.openWidgets();
        // Les onglets restaures au redemarrage ne sont pas passes par `open`:
        // on les retrouve aupres du WidgetManager plutot que dans une liste interne.
        const existing = openWidgets.find(widget => widget.getGeocacheId() === context.geocacheData.id);
        if (existing) {
            existing.setContext(context, options);
            this.attach(existing);
            return existing;
        }
        const instanceId = this.allocateInstanceId(openWidgets);
        const widget = await this.widgetManager.getOrCreateWidget<EarthCoachWorkspaceWidget>(
            EarthCoachWorkspaceWidget.ID,
            { instanceId }
        );
        widget.id = `${EarthCoachWorkspaceWidget.ID}#${instanceId}`;
        widget.setContext(context, options);
        this.attach(widget);
        return widget;
    }

    protected attach(widget: EarthCoachWorkspaceWidget): void {
        if (!widget.isAttached) {
            this.shell.addWidget(widget, { area: 'main' });
        }
        this.shell.activateWidget(widget.id);
    }

    protected openWidgets(): EarthCoachWorkspaceWidget[] {
        return this.widgetManager.getWidgets(EarthCoachWorkspaceWidget.ID).filter(
            (widget): widget is EarthCoachWorkspaceWidget => widget instanceof EarthCoachWorkspaceWidget && !widget.isDisposed
        );
    }

    /**
     * Un identifiant deja pris par un onglet restaure ferait renvoyer ce meme
     * onglet par `getOrCreateWidget` (cle factory + options).
     */
    protected allocateInstanceId(openWidgets: EarthCoachWorkspaceWidget[]): number {
        const prefix = `${EarthCoachWorkspaceWidget.ID}#`;
        for (const widget of openWidgets) {
            const num = widget.id.startsWith(prefix) ? parseInt(widget.id.substring(prefix.length), 10) : NaN;
            if (!isNaN(num) && num >= this.nextId) {
                this.nextId = num + 1;
            }
        }
        return this.nextId++;
    }
}
