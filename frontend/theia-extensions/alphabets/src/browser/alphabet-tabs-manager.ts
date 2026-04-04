import { injectable, inject } from '@theia/core/shared/inversify';
import { ApplicationShell, Widget } from '@theia/core/lib/browser';
import { WidgetManager } from '@theia/core/lib/browser/widget-manager';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { MessageService } from '@theia/core';
import { AlphabetViewerWidget } from './alphabet-viewer-widget';

export type AlphabetTabMode = 'smart-replace' | 'always-new-tab' | 'always-replace';

interface AlphabetTabEntry {
    widget: AlphabetViewerWidget;
    alphabetId?: string;
    isPinned: boolean;
}

export interface OpenAlphabetOptions {
    alphabetId: string;
    forceDuplicate?: boolean;
}

@injectable()
export class AlphabetTabsManager {

    protected readonly tabs: AlphabetTabEntry[] = [];
    protected nextId = 1;
    private nextIdSynced = false;

    protected widgetCreator?: (alphabetId: string) => AlphabetViewerWidget;

    constructor(
        @inject(ApplicationShell) protected readonly shell: ApplicationShell,
        @inject(PreferenceService) protected readonly preferenceService: PreferenceService,
        @inject(MessageService) protected readonly messages: MessageService,
        @inject(WidgetManager) protected readonly widgetManager: WidgetManager,
    ) {
        if (typeof window !== 'undefined') {
            window.addEventListener('geoapp-alphabet-tab-interaction', this.handleInteractionEvent as EventListener);
        }
    }

    setWidgetCreator(creator: (alphabetId: string) => AlphabetViewerWidget): void {
        this.widgetCreator = creator;
    }

    async openAlphabet(options: OpenAlphabetOptions): Promise<AlphabetViewerWidget> {
        const { alphabetId, forceDuplicate } = options;

        this.cleanupDisposed();

        const contextKey = `alphabet:${alphabetId}`;

        if (!forceDuplicate) {
            const existing = this.tabs.find(entry => entry.alphabetId === alphabetId && !entry.widget.isDisposed);
            if (existing) {
                this.attachAndActivate(existing.widget);
                return existing.widget;
            }
        }

        const mode = this.getMode();
        const aliveTabs = this.tabs.filter(entry => !entry.widget.isDisposed);

        let targetEntry: AlphabetTabEntry | undefined;

        if (mode === 'always-replace') {
            targetEntry = aliveTabs[aliveTabs.length - 1];
        } else if (mode === 'smart-replace') {
            const previewTabs = aliveTabs.filter(entry => !entry.isPinned);
            targetEntry = previewTabs[previewTabs.length - 1];
        } else {
            targetEntry = undefined;
        }

        if (!targetEntry) {
            const widget = await this.createWidget(alphabetId);
            targetEntry = { widget, alphabetId, isPinned: false };
            this.tabs.push(targetEntry);
        } else {
            targetEntry.alphabetId = alphabetId;
            if (typeof (targetEntry.widget as any).setAlphabet === 'function') {
                (targetEntry.widget as any).setAlphabet(alphabetId);
            }
            targetEntry.isPinned = false;
        }

        this.attachAndActivate(targetEntry.widget);

        return targetEntry.widget;
    }

    protected getMode(): AlphabetTabMode {
        const raw = this.preferenceService.get('geoApp.ui.tabs.categories.alphabet', 'smart-replace') as string;
        if (raw === 'always-new-tab' || raw === 'always-replace' || raw === 'smart-replace') {
            return raw;
        }
        return 'smart-replace';
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

    protected async createWidget(alphabetId: string): Promise<AlphabetViewerWidget> {
        this.syncNextId();
        const instanceId = this.nextId++;
        const widget = await this.widgetManager.getOrCreateWidget(AlphabetViewerWidget.ID_PREFIX, { alphabetId, instanceId });

        widget.id = this.generateWidgetId(alphabetId, instanceId);

        return widget as AlphabetViewerWidget;
    }

    /**
     * S'assure que nextId est supérieur aux IDs des widgets déjà restaurés par le layout.
     */
    private syncNextId(): void {
        if (this.nextIdSynced) {
            return;
        }
        this.nextIdSynced = true;
        const prefix = AlphabetViewerWidget.ID_PREFIX + '-';
        for (const w of this.shell.getWidgets('main')) {
            if (w.id.startsWith(prefix)) {
                const hashIdx = w.id.lastIndexOf('#');
                if (hashIdx > 0) {
                    const num = parseInt(w.id.substring(hashIdx + 1), 10);
                    if (!isNaN(num) && num >= this.nextId) {
                        this.nextId = num + 1;
                    }
                }
            }
        }
    }

    protected generateWidgetId(alphabetId: string, instanceId: number): string {
        const base = AlphabetViewerWidget.ID_PREFIX;
        const id = `${base}-${alphabetId}#${instanceId}`;
        return id;
    }

    protected attachAndActivate(widget: AlphabetViewerWidget): void {
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
