import { injectable, inject } from '@theia/core/shared/inversify';
import {
    ApplicationShell,
    FrontendApplication,
    FrontendApplicationContribution,
    StorageService,
    Widget,
    WidgetManager
} from '@theia/core/lib/browser';

interface DefaultLeftPanelWidgetDescriptor {
    readonly id: string;
    readonly label: string;
    readonly rank: number;
    readonly rememberDismissal: boolean;
}

const DEFAULT_LEFT_PANEL_WIDGETS: ReadonlyArray<DefaultLeftPanelWidgetDescriptor> = [
    { id: 'zones.tree.widget', label: 'Zones', rank: 100, rememberDismissal: true },
    { id: 'geoapp-map-manager', label: 'Gestion des cartes', rank: 200, rememberDismissal: false },
    { id: 'geoapp-global-search-widget', label: 'Recherche Globale', rank: 300, rememberDismissal: true },
    { id: 'mysterai-plugins-browser', label: 'Plugins', rank: 400, rememberDismissal: true },
    { id: 'alphabets-list', label: 'Alphabets', rank: 450, rememberDismissal: true },
    { id: 'formula-solver:widget', label: 'Formula Solver', rank: 500, rememberDismissal: true }
];

@injectable()
export class GeoAppDefaultLeftPanelContribution implements FrontendApplicationContribution {

    protected readonly hiddenWidgetsStorageKey = 'geoapp.leftPanel.hiddenDefaultWidgets.v1';
    protected readonly pluginsMigrationStorageKey = 'geoapp.leftPanel.pluginsWidgetMigration.v1';
    protected readonly hiddenWidgetIds = new Set<string>();
    protected widgetTrackingInstalled = false;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(StorageService)
    protected readonly storageService: StorageService;

    async onDidInitializeLayout(_app: FrontendApplication): Promise<void> {
        await this.loadHiddenWidgetIds();
        await this.dropVisibleWidgetsFromHiddenState();
        await this.migrateLegacyPluginsWidget();
        this.installWidgetTracking();
        await this.ensureDefaultLeftWidgets();
    }

    protected installWidgetTracking(): void {
        if (this.widgetTrackingInstalled) {
            return;
        }
        this.widgetTrackingInstalled = true;

        this.shell.onDidAddWidget(widget => {
            void this.handleWidgetAdded(widget);
        });
        this.shell.onDidRemoveWidget(widget => {
            void this.handleWidgetRemoved(widget);
        });
    }

    protected async handleWidgetAdded(widget: Widget): Promise<void> {
        const descriptor = this.findDescriptor(widget.id);
        if (!descriptor?.rememberDismissal) {
            return;
        }

        if (this.hiddenWidgetIds.delete(descriptor.id)) {
            await this.persistHiddenWidgetIds();
        }
    }

    protected async handleWidgetRemoved(widget: Widget): Promise<void> {
        const descriptor = this.findDescriptor(widget.id);
        if (!descriptor?.rememberDismissal) {
            return;
        }

        const existingWidget = this.widgetManager.tryGetWidget(descriptor.id);
        if (existingWidget?.isAttached) {
            return;
        }

        if (!this.hiddenWidgetIds.has(descriptor.id)) {
            this.hiddenWidgetIds.add(descriptor.id);
            await this.persistHiddenWidgetIds();
        }
    }

    protected async loadHiddenWidgetIds(): Promise<void> {
        const stored = await this.storageService.getData<string[]>(this.hiddenWidgetsStorageKey, []);
        this.hiddenWidgetIds.clear();

        if (!Array.isArray(stored)) {
            return;
        }

        for (const widgetId of stored) {
            if (typeof widgetId === 'string' && this.findDescriptor(widgetId)?.rememberDismissal) {
                this.hiddenWidgetIds.add(widgetId);
            }
        }
    }

    protected async persistHiddenWidgetIds(): Promise<void> {
        await this.storageService.setData(this.hiddenWidgetsStorageKey, Array.from(this.hiddenWidgetIds).sort());
    }

    protected async dropVisibleWidgetsFromHiddenState(): Promise<void> {
        let changed = false;

        for (const descriptor of DEFAULT_LEFT_PANEL_WIDGETS) {
            if (!descriptor.rememberDismissal || !this.isWidgetAttached(descriptor.id)) {
                continue;
            }

            if (this.hiddenWidgetIds.delete(descriptor.id)) {
                changed = true;
            }
        }

        if (changed) {
            await this.persistHiddenWidgetIds();
        }
    }

    protected async ensureDefaultLeftWidgets(): Promise<void> {
        for (const descriptor of DEFAULT_LEFT_PANEL_WIDGETS) {
            if (this.isWidgetAttached(descriptor.id)) {
                continue;
            }

            if (descriptor.rememberDismissal && this.hiddenWidgetIds.has(descriptor.id)) {
                continue;
            }

            try {
                const widget = this.widgetManager.tryGetWidget(descriptor.id) ?? await this.widgetManager.getOrCreateWidget(descriptor.id);
                if (!widget.isAttached) {
                    await this.shell.addWidget(widget, {
                        area: 'left',
                        rank: descriptor.rank
                    });
                }
            } catch (error) {
                console.error(`[GeoAppDefaultLeftPanel] Failed to attach ${descriptor.label}`, error);
            }
        }
    }

    protected async migrateLegacyPluginsWidget(): Promise<void> {
        const alreadyMigrated = await this.storageService.getData<boolean>(this.pluginsMigrationStorageKey, false);
        if (alreadyMigrated) {
            return;
        }

        const legacyPluginsWidgetId = 'vsx-extensions-view-container';
        const desiredPluginsWidgetId = 'mysterai-plugins-browser';
        const legacyWidget = this.widgetManager.tryGetWidget(legacyPluginsWidgetId);
        const desiredWidget = this.widgetManager.tryGetWidget(desiredPluginsWidgetId);

        if (legacyWidget?.isAttached && !desiredWidget?.isAttached && this.shell.getAreaFor(legacyWidget) === 'left') {
            legacyWidget.close();
        }

        await this.storageService.setData(this.pluginsMigrationStorageKey, true);
    }

    protected isWidgetAttached(widgetId: string): boolean {
        const widget = this.widgetManager.tryGetWidget(widgetId);
        return Boolean(widget?.isAttached);
    }

    protected findDescriptor(widgetId: string): DefaultLeftPanelWidgetDescriptor | undefined {
        return DEFAULT_LEFT_PANEL_WIDGETS.find(descriptor => descriptor.id === widgetId);
    }
}
