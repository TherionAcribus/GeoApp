// Service responsable de la gestion des onglets de détails de géocaches (ouverture, réutilisation, modes de remplacement)

import { injectable, inject } from '@theia/core/shared/inversify';
import { ApplicationShell, Widget } from '@theia/core/lib/browser';
import { WidgetManager } from '@theia/core/lib/browser/widget-manager';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { MessageService, CommandService } from '@theia/core';
import { ChatService } from '@theia/ai-chat';
import { PluginExecutorContribution } from '@mysterai/theia-plugins/lib/browser/plugins-contribution';
import { GeocacheDetailsWidget } from './geocache-details-widget';

export type GeocacheTabMode = 'smart-replace' | 'always-new-tab' | 'always-replace';

interface GeocacheTabEntry {
    widget: GeocacheDetailsWidget;
    geocacheId?: number;
    isPinned: boolean;
}

export interface OpenGeocacheOptions {
    geocacheId: number;
    name?: string;
    forceDuplicate?: boolean;
}

@injectable()
export class GeocacheTabsManager {

    protected readonly tabs: GeocacheTabEntry[] = [];
    protected nextId = 1;
    private nextIdSynced = false;

    constructor(
        @inject(ApplicationShell) protected readonly shell: ApplicationShell,
        @inject(PreferenceService) protected readonly preferenceService: PreferenceService,
        @inject(MessageService) protected readonly messages: MessageService,
        @inject(PluginExecutorContribution) protected readonly pluginExecutorContribution: PluginExecutorContribution,
        @inject(CommandService) protected readonly commandService: CommandService,
        @inject(ChatService) protected readonly chatService: ChatService,
        @inject(WidgetManager) protected readonly widgetManager: WidgetManager,
    ) {
        if (typeof window !== 'undefined') {
            window.addEventListener('geoapp-geocache-tab-interaction', this.handleInteractionEvent as EventListener);
        }
    }

    /**
     * Ouvre ou réutilise un onglet de détails pour une géocache donnée, en appliquant la stratégie de préférences.
     */
    async openGeocacheDetails(options: OpenGeocacheOptions): Promise<GeocacheDetailsWidget> {
        const { geocacheId, name, forceDuplicate } = options;

        this.cleanupDisposed();

        // Si on a déjà un onglet pour cette géocache, le réactiver (sauf si duplication forcée)
        if (!forceDuplicate) {
            const existing = this.tabs.find(entry => entry.geocacheId === geocacheId && !entry.widget.isDisposed);
            if (existing) {
                this.attachAndActivate(existing.widget);
                existing.widget.setGeocache({ geocacheId, name });
                return existing.widget;
            }
        }

        const mode = this.getMode();
        const aliveTabs = this.tabs.filter(entry => !entry.widget.isDisposed);

        let targetEntry: GeocacheTabEntry | undefined;

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
            targetEntry = { widget, geocacheId: undefined, isPinned: false };
            this.tabs.push(targetEntry);
        }

        targetEntry.geocacheId = geocacheId;
        // Nouveau contenu => repasse en mode preview (non pinné)
        targetEntry.isPinned = false;
        targetEntry.widget.setGeocache({ geocacheId, name });

        this.attachAndActivate(targetEntry.widget);

        return targetEntry.widget;
    }

    /**
     * Retourne le widget de détails associé à une géocache, s'il est déjà ouvert.
     */
    getWidgetForGeocache(geocacheId: number): GeocacheDetailsWidget | undefined {
        const entry = this.tabs.find(e => e.geocacheId === geocacheId && !e.widget.isDisposed);
        return entry?.widget;
    }

    /**
     * Marque un widget comme "pinné" (non remplaçable) en mode smart-replace.
     */
    pinWidget(widget: GeocacheDetailsWidget): void {
        const entry = this.tabs.find(e => e.widget === widget);
        if (entry) {
            entry.isPinned = true;
        }
    }

    protected getMode(): GeocacheTabMode {
        const raw = this.preferenceService.get('geoApp.ui.tabs.categories.geocache', 'smart-replace') as string;
        if (raw === 'always-new-tab' || raw === 'always-replace' || raw === 'smart-replace') {
            return raw;
        }
        return 'smart-replace';
    }

    private handleInteractionEvent = (event: Event): void => {
        const custom = event as CustomEvent<{ widgetId?: string; geocacheId?: number; type?: string }>;
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

    protected async createWidget(): Promise<GeocacheDetailsWidget> {
        this.syncNextId();
        const instanceId = this.nextId++;
        const widget = await this.widgetManager.getOrCreateWidget(GeocacheDetailsWidget.ID, { instanceId });

        // Affecter un ID unique pour permettre plusieurs onglets simultanés
        widget.id = `${GeocacheDetailsWidget.ID}#${instanceId}`;

        return widget as GeocacheDetailsWidget;
    }

    /**
     * S'assure que nextId est supérieur aux IDs des widgets déjà restaurés par le layout.
     */
    private syncNextId(): void {
        if (this.nextIdSynced) {
            return;
        }
        this.nextIdSynced = true;
        const prefix = GeocacheDetailsWidget.ID + '#';
        for (const w of this.shell.getWidgets('main')) {
            if (w.id.startsWith(prefix)) {
                const num = parseInt(w.id.substring(prefix.length), 10);
                if (!isNaN(num) && num >= this.nextId) {
                    this.nextId = num + 1;
                }
            }
        }
    }

    protected attachAndActivate(widget: GeocacheDetailsWidget): void {
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
