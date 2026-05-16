import { injectable, inject } from '@theia/core/shared/inversify';
import { ApplicationShell } from '@theia/core/lib/browser';
import { ZonesService } from 'theia-ide-zones-ext/lib/browser/zones-service';
import { DocActionUiContext } from './doc-action-types';

interface WidgetInfo {
    kind: string;
    geocacheId?: number;
    gcCode?: string;
    geocacheName?: string;
    zoneId?: number;
    zoneName?: string;
}

@injectable()
export class DocActionContextService {

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    @inject(ZonesService)
    protected readonly zonesService!: ZonesService;

    async collectContext(): Promise<DocActionUiContext> {
        const active = this.shell.activeWidget ?? this.shell.currentWidget;

        let activeZone: DocActionUiContext['activeZone'] | undefined;
        try {
            const zone = await this.zonesService.getActiveZone<{ id?: number | null; name?: string }>();
            if (zone) {
                activeZone = { id: zone.id ?? null, name: zone.name };
            }
        } catch {
            // ZonesService not available yet
        }

        const activeWidgetInfo = active ? this.parseWidget(active.id, active as any) : undefined;

        const openTabs: DocActionUiContext['openTabs'] = [];
        for (const widget of this.shell.getWidgets('main')) {
            const info = this.parseWidget(widget.id, widget as any);
            if (info && info.kind !== 'other') {
                openTabs.push({ id: widget.id, ...info });
            }
        }

        return {
            activeWidget: active && activeWidgetInfo
                ? { id: active.id, ...activeWidgetInfo } as DocActionUiContext['activeWidget']
                : undefined,
            activeZone,
            openTabs,
        };
    }

    private parseWidget(widgetId: string, widget: any): WidgetInfo {
        if (!widgetId) {
            return { kind: 'other' };
        }

        if (widgetId.startsWith('geocache.details.widget')) {
            const result: WidgetInfo = { kind: 'geocache-details' };
            if (widget?.geocacheId) { result.geocacheId = widget.geocacheId; }
            if (widget?.data?.gc_code) { result.gcCode = widget.data.gc_code; }
            if (widget?.data?.name) { result.geocacheName = widget.data.name; }
            return result;
        }

        if (widgetId.startsWith('zone.geocaches.widget')) {
            const result: WidgetInfo = { kind: 'zone-geocaches' };
            if (widget?.zoneId) { result.zoneId = widget.zoneId; }
            if (widget?.zoneName) { result.zoneName = widget.zoneName; }
            return result;
        }

        if (widgetId === 'zones.widget') { return { kind: 'zones-list' }; }
        if (widgetId === 'geoapp-documentation') { return { kind: 'documentation' }; }
        return { kind: 'other' };
    }

    formatContextForPrompt(context: DocActionUiContext): string {
        const parts: string[] = ['## Contexte UI actuel'];

        if (context.activeWidget && context.activeWidget.kind !== 'other') {
            parts.push(`Widget actif : ${context.activeWidget.kind} (id: ${context.activeWidget.id})`);
            if (context.activeWidget.geocacheId) {
                parts.push(
                    `  → Géocache active : id=${context.activeWidget.geocacheId}` +
                    `${context.activeWidget.gcCode ? ` code=${context.activeWidget.gcCode}` : ''}` +
                    `${context.activeWidget.geocacheName ? ` nom="${context.activeWidget.geocacheName}"` : ''}`
                );
            }
            if (context.activeWidget.zoneId) {
                parts.push(
                    `  → Zone ouverte : id=${context.activeWidget.zoneId}` +
                    `${context.activeWidget.zoneName ? ` nom="${context.activeWidget.zoneName}"` : ''}`
                );
            }
        } else {
            parts.push('Widget actif : aucun widget GeoApp');
        }

        if (context.activeZone?.id) {
            parts.push(
                `Zone active (sélectionnée) : id=${context.activeZone.id}` +
                `${context.activeZone.name ? ` nom="${context.activeZone.name}"` : ''}`
            );
        } else {
            parts.push('Zone active : aucune');
        }

        if (context.openTabs.length > 0) {
            parts.push('Onglets ouverts :');
            for (const tab of context.openTabs) {
                let line = `  - ${tab.kind}`;
                if (tab.geocacheId) {
                    line += ` (géocache id:${tab.geocacheId}${tab.gcCode ? ` ${tab.gcCode}` : ''})`;
                }
                if (tab.zoneId) {
                    line += ` (zone id:${tab.zoneId}${tab.zoneName ? ` "${tab.zoneName}"` : ''})`;
                }
                parts.push(line);
            }
        }

        return parts.join('\n');
    }
}
