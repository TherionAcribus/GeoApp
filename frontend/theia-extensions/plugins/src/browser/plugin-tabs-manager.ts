import { injectable, inject } from '@theia/core/shared/inversify';
import { ApplicationShell, Widget } from '@theia/core/lib/browser';
import { WidgetManager } from '@theia/core/lib/browser/widget-manager';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { MessageService } from '@theia/core';
import { PluginExecutorWidget, GeocacheContext } from './plugin-executor-widget';

export type PluginTabMode = 'smart-replace' | 'always-new-tab' | 'always-replace';

interface PluginTabEntry {
    widget: PluginExecutorWidget;
    contextKey?: string;
    isPinned: boolean;
}

export interface OpenPluginOptions {
    pluginName: string;
    forceDuplicate?: boolean;
}

export interface OpenPluginForGeocacheOptions {
    context: GeocacheContext;
    pluginName?: string;
    autoExecute?: boolean;
    forceDuplicate?: boolean;
}

@injectable()
export class PluginTabsManager {

    protected readonly tabs: PluginTabEntry[] = [];
    protected nextId = 1;
    private nextIdSynced = false;

    protected widgetCreator?: () => PluginExecutorWidget;

    constructor(
        @inject(ApplicationShell) protected readonly shell: ApplicationShell,
        @inject(PreferenceService) protected readonly preferenceService: PreferenceService,
        @inject(MessageService) protected readonly messages: MessageService,
        @inject(WidgetManager) protected readonly widgetManager: WidgetManager,
    ) {
        if (typeof window !== 'undefined') {
            window.addEventListener('geoapp-plugin-tab-interaction', this.handleInteractionEvent as EventListener);
        }
    }

    setWidgetCreator(creator: () => PluginExecutorWidget): void {
        this.widgetCreator = creator;
    }

    async openPlugin(options: OpenPluginOptions): Promise<PluginExecutorWidget> {
        const { pluginName, forceDuplicate } = options;

        this.cleanupDisposed();

        const contextKey = `plugin:${pluginName}`;

        if (!forceDuplicate) {
            const existing = this.tabs.find(entry => entry.contextKey === contextKey && !entry.widget.isDisposed);
            if (existing) {
                this.attachAndActivate(existing.widget);
                existing.widget.initializePluginMode(pluginName);
                return existing.widget;
            }
        }

        const mode = this.getMode();
        const aliveTabs = this.tabs.filter(entry => !entry.widget.isDisposed);

        let targetEntry: PluginTabEntry | undefined;

        if (mode === 'always-replace') {
            targetEntry = aliveTabs[aliveTabs.length - 1];
        } else if (mode === 'smart-replace') {
            const previewTabs = aliveTabs.filter(entry => !entry.isPinned);
            targetEntry = previewTabs[previewTabs.length - 1];
        } else {
            targetEntry = undefined;
        }

        if (!targetEntry) {
            const widget = await this.createWidget();
            targetEntry = { widget, contextKey: undefined, isPinned: false };
            this.tabs.push(targetEntry);
        }

        targetEntry.contextKey = contextKey;
        targetEntry.isPinned = false;
        targetEntry.widget.initializePluginMode(pluginName);

        this.attachAndActivate(targetEntry.widget);

        return targetEntry.widget;
    }

    async openForGeocache(options: OpenPluginForGeocacheOptions): Promise<PluginExecutorWidget> {
        const { context, pluginName, autoExecute, forceDuplicate } = options;

        this.cleanupDisposed();

        const contextKey = `geocache:${context.gcCode}`;

        if (!forceDuplicate) {
            const existing = this.tabs.find(entry => entry.contextKey === contextKey && !entry.widget.isDisposed);
            if (existing) {
                this.attachAndActivate(existing.widget);
                existing.widget.initializeGeocacheMode(context, pluginName, autoExecute);
                return existing.widget;
            }
        }

        const mode = this.getMode();
        const aliveTabs = this.tabs.filter(entry => !entry.widget.isDisposed);

        let targetEntry: PluginTabEntry | undefined;

        if (mode === 'always-replace') {
            targetEntry = aliveTabs[aliveTabs.length - 1];
        } else if (mode === 'smart-replace') {
            const previewTabs = aliveTabs.filter(entry => !entry.isPinned);
            targetEntry = previewTabs[previewTabs.length - 1];
        } else {
            targetEntry = undefined;
        }

        if (!targetEntry) {
            const widget = await this.createWidget();
            targetEntry = { widget, contextKey: undefined, isPinned: false };
            this.tabs.push(targetEntry);
        }

        targetEntry.contextKey = contextKey;
        targetEntry.isPinned = false;
        targetEntry.widget.initializeGeocacheMode(context, pluginName, autoExecute);

        this.attachAndActivate(targetEntry.widget);

        return targetEntry.widget;
    }

    protected getMode(): PluginTabMode {
        const raw = this.preferenceService.get('geoApp.ui.tabs.categories.plugin', 'always-new-tab') as string;
        if (raw === 'always-new-tab' || raw === 'always-replace' || raw === 'smart-replace') {
            return raw;
        }
        return 'always-new-tab';
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

    protected async createWidget(): Promise<PluginExecutorWidget> {
        this.syncNextId();
        const instanceId = this.nextId++;
        const widget = await this.widgetManager.getOrCreateWidget(PluginExecutorWidget.ID, { instanceId });

        widget.id = this.generateWidgetId(instanceId);

        return widget as PluginExecutorWidget;
    }

    /**
     * S'assure que nextId est supérieur aux IDs des widgets déjà restaurés par le layout.
     */
    private syncNextId(): void {
        if (this.nextIdSynced) {
            return;
        }
        this.nextIdSynced = true;
        const prefix = PluginExecutorWidget.ID + '#';
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
        const base = PluginExecutorWidget.ID;
        const id = `${base}#${instanceId}`;
        return id;
    }

    protected attachAndActivate(widget: PluginExecutorWidget): void {
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
