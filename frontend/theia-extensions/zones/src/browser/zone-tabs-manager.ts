// Service responsable de la gestion des onglets de tableau de géocaches par zone (ouverture, réutilisation, modes de remplacement)

import { injectable, inject } from '@theia/core/shared/inversify';
import { ApplicationShell, Widget } from '@theia/core/lib/browser';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { MessageService } from '@theia/core';
import { WidgetManager } from '@theia/core/lib/browser/widget-manager';
import { ZoneGeocachesWidget } from './zone-geocaches-widget';
import { MapService } from './map/map-service';
import { MapWidgetFactory } from './map/map-widget-factory';
import { GeocacheTabsManager } from './geocache-tabs-manager';

export type ZoneTabMode = 'smart-replace' | 'always-new-tab' | 'always-replace';

interface ZoneTabEntry {
    widget: ZoneGeocachesWidget;
    zoneId?: number;
    isPinned: boolean;
}

export interface OpenZoneOptions {
    zoneId: number;
    zoneName?: string;
    forceDuplicate?: boolean;
}

@injectable()
export class ZoneTabsManager {

    protected readonly tabs: ZoneTabEntry[] = [];
    protected nextId = 1;
    private nextIdSynced = false;

    constructor(
        @inject(ApplicationShell) protected readonly shell: ApplicationShell,
        @inject(PreferenceService) protected readonly preferenceService: PreferenceService,
        @inject(MessageService) protected readonly messages: MessageService,
        @inject(WidgetManager) protected readonly widgetManager: WidgetManager,
        @inject(MapService) protected readonly mapService: MapService,
        @inject(MapWidgetFactory) protected readonly mapWidgetFactory: MapWidgetFactory,
        @inject(GeocacheTabsManager) protected readonly geocacheTabsManager: GeocacheTabsManager,
    ) {
        if (typeof window !== 'undefined') {
            window.addEventListener('geoapp-zone-tab-interaction', this.handleInteractionEvent as EventListener);
        }
    }

    /**
     * Ouvre ou réutilise un onglet de tableau de géocaches pour une zone donnée, en appliquant la stratégie de préférences.
     */
    async openZone(options: OpenZoneOptions): Promise<ZoneGeocachesWidget> {
        const { zoneId, zoneName, forceDuplicate } = options;

        this.cleanupDisposed();

        // Si on a déjà un onglet pour cette zone, le réactiver (sauf si duplication forcée)
        if (!forceDuplicate) {
            const existing = this.tabs.find(entry => entry.zoneId === zoneId && !entry.widget.isDisposed);
            if (existing) {
                this.attachAndActivate(existing.widget);
                existing.widget.setZone({ zoneId, zoneName });
                return existing.widget;
            }
        }

        const mode = this.getMode();
        const aliveTabs = this.tabs.filter(entry => !entry.widget.isDisposed);

        let targetEntry: ZoneTabEntry | undefined;

        if (mode === 'always-replace') {
            // Toujours réutiliser le dernier onglet existant (pinned ou non)
            targetEntry = aliveTabs[aliveTabs.length - 1];
        } else if (mode === 'smart-replace') {
            // Réutiliser le dernier onglet non pinné (mode "preview") s'il existe
            const previewTabs = aliveTabs.filter(entry => !entry.isPinned);
            targetEntry = previewTabs[previewTabs.length - 1];
        } else {
            // always-new-tab : ne jamais réutiliser
            targetEntry = undefined;
        }

        if (!targetEntry) {
            const widget = await this.createWidget();
            targetEntry = { widget, zoneId: undefined, isPinned: false };
            this.tabs.push(targetEntry);
        }

        targetEntry.zoneId = zoneId;
        // Nouveau contenu => repasse en mode preview (non pinné)
        targetEntry.isPinned = false;
        targetEntry.widget.setZone({ zoneId, zoneName });

        this.attachAndActivate(targetEntry.widget);

        return targetEntry.widget;
    }

    protected getMode(): ZoneTabMode {
        const raw = this.preferenceService.get('geoApp.ui.tabs.categories.zone', 'always-replace') as string;
        if (raw === 'always-new-tab' || raw === 'always-replace' || raw === 'smart-replace') {
            return raw;
        }
        return 'always-replace';
    }

    private handleInteractionEvent = (event: Event): void => {
        const custom = event as CustomEvent<{ widgetId?: string; type?: string }>;
        const detail = custom.detail;
        if (!detail || !detail.widgetId || !detail.type) {
            return;
        }

        if (!this.shouldPinForInteraction(detail.type)) {
            return;
        }

        const entry = this.tabs.find(e => e.widget.id === detail.widgetId && !e.widget.isDisposed);
        if (entry) {
            entry.isPinned = true;
        }
    };

    private shouldPinForInteraction(type: string): boolean {
        if (type === 'click') {
            return this.preferenceService.get('geoApp.ui.tabs.smartReplace.interaction.clickInContent', true) as boolean;
        }
        if (type === 'scroll') {
            return this.preferenceService.get('geoApp.ui.tabs.smartReplace.interaction.scroll', true) as boolean;
        }
        if (type === 'min-open-time') {
            return this.preferenceService.get('geoApp.ui.tabs.smartReplace.interaction.minOpenTimeEnabled', true) as boolean;
        }
        return false;
    }

    protected async createWidget(): Promise<ZoneGeocachesWidget> {
        this.syncNextId();
        const instanceId = this.nextId++;
        const widget = await this.widgetManager.getOrCreateWidget(ZoneGeocachesWidget.ID, { instanceId });

        // Affecter un ID unique pour permettre plusieurs onglets simultanés
        widget.id = this.generateWidgetId(instanceId);

        return widget as ZoneGeocachesWidget;
    }

    /**
     * S'assure que nextId est supérieur aux IDs des widgets déjà restaurés par le layout.
     */
    private syncNextId(): void {
        if (this.nextIdSynced) {
            return;
        }
        this.nextIdSynced = true;
        const prefix = ZoneGeocachesWidget.ID + '#';
        for (const w of this.shell.getWidgets('main')) {
            if (w.id.startsWith(prefix)) {
                const num = parseInt(w.id.substring(prefix.length), 10);
                if (!isNaN(num) && num >= this.nextId) {
                    this.nextId = num + 1;
                }
            }
        }
    }

    protected generateWidgetId(instanceId: number): string {
        const base = ZoneGeocachesWidget.ID;
        const id = `${base}#${instanceId}`;
        return id;
    }

    protected attachAndActivate(widget: ZoneGeocachesWidget): void {
        if (!widget.isAttached) {
            this.shell.addWidget(widget, { area: 'main' });
        }
        this.activate(widget);
    }

    protected activate(widget: Widget): void {
        if (widget.id) {
            this.shell.activateWidget(widget.id);
        }
    }

    protected cleanupDisposed(): void {
        for (let i = this.tabs.length - 1; i >= 0; i--) {
            if (this.tabs[i].widget.isDisposed) {
                this.tabs.splice(i, 1);
            }
        }
    }
}
