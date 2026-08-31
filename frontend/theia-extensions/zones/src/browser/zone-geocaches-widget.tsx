import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ApplicationShell, StatefulWidget, WidgetManager, ConfirmDialog, Dialog } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core';
import { QuickInputService, QuickPickValue } from '@theia/core/lib/common/quick-pick-service';
import { ProgressService } from '@theia/core/lib/common/progress-service';
import { PreferenceChange, PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';
import {
    DEFAULT_GEOCACHES_TABLE_VISIBLE_COLUMNS,
    GeocachesTable,
    Geocache,
    GeocachesTableColumnId,
    normalizeGeocachesTableVisibleColumnIds,
} from './geocaches-table';
import { ImportGpxDialog } from './import-gpx-dialog';
import { ImportBookmarkListDialog } from './import-bookmark-list-dialog';
import { ImportPocketQueryDialog } from './import-pocket-query-dialog';
import { ImportProgressCallback, ImportCounts } from './import-dialog-shell';
import { MoveGeocacheDialog } from './move-geocache-dialog';
import { MapWidgetFactory } from './map/map-widget-factory';
import type { MapWidget } from './map/map-widget';
import type { MapGeocache } from './map/map-layer-manager';
import { MapService, ListSelectionRequest } from './map/map-service';
import { GeocacheTabsManager } from './geocache-tabs-manager';
import { BackendApiClient } from './backend-api-client';
import { GeocachesService } from './geocaches-service';
import { ZonesService } from './zones-service';
import { GeoAppWidgetEventsService } from './geoapp-widget-events-service';
import { getErrorMessage } from './backend-api-client';
import { ZoneGeocachesView } from './zone-geocaches-view';
import { ImportAroundCenter, ImportAroundRequest } from './import-around-dialog';
import { ImportAroundService } from './import-around-service';

interface SerializedZoneGeocachesState {
    zoneId: number;
    zoneName?: string;
    lastAccessTimestamp?: number;
}


type GeocacheDetailsResponse = Geocache & {
    description_raw?: string;
    hints?: string;
    placed_at?: string;
    type?: string;
};

type WizardPick<T> = QuickPickValue<T>;

@injectable()
export class ZoneGeocachesWidget extends ReactWidget implements StatefulWidget {
    static readonly ID = 'zone.geocaches.widget';

    protected zoneId?: number;
    protected zoneName?: string;
    protected rows: Geocache[] = [];
    protected loading = false;
    /**
     * Géocaches cochées dans le tableau. Miroir de l'état interne du tableau,
     * tenu à jour par `handleSelectionChange` ; sert de base aux modifications
     * demandées depuis la carte.
     */
    protected selectedGeocacheIds: number[] = [];
    protected zones: Array<{ id: number; name: string }> = [];
    protected showImportDialog = false;
    protected showBookmarkListDialog = false;
    protected showPocketQueryDialog = false;
    protected isImporting = false;
    protected importAbortController?: AbortController;
    protected copySelectedDialog: { geocacheIds: number[] } | null = null;
    protected moveSelectedDialog: { geocacheIds: number[] } | null = null;
    protected importAroundDialogOpen = false;
    protected importAroundDialogInitialCenter?: ImportAroundCenter;
    protected tableVisibleColumnIds: GeocachesTableColumnId[] = [...DEFAULT_GEOCACHES_TABLE_VISIBLE_COLUMNS];
    /** « Qui a trouvé quoi » dans cette zone : code GC -> pseudos d'amis. */
    protected friendFinds: Record<string, string[]> = {};
    protected friendFindsProgress: { done: number; total: number; friend?: string } | null = null;

    protected interactionTimerId: number | undefined;
    private lastAccessTimestamp: number = Date.now();
    private readonly tableVisibleColumnsPreferenceKey = 'geoApp.geocaches.table.visibleColumns';
    private readonly preferenceChangeDisposable: { dispose: () => void };
    /** Vrai pendant que CE widget émet requestZonesRefresh, pour ignorer son propre événement. */
    private selfTriggeringZonesRefresh = false;

    protected readonly handleGeocacheLogSubmitted = (event: CustomEvent<{ geocacheId: number; found?: boolean }>): void => {
        const detail = event?.detail;
        const geocacheId = detail?.geocacheId;
        const found = detail?.found;
        if (typeof geocacheId !== 'number' || found !== true) {
            return;
        }
        if (!this.rows || this.rows.length === 0) {
            return;
        }
        const idx = this.rows.findIndex(r => r.id === geocacheId);
        if (idx < 0) {
            return;
        }
        const current = this.rows[idx];
        if (current?.found === true) {
            return;
        }
        const next = { ...current, found: true };
        this.rows = [...this.rows.slice(0, idx), next, ...this.rows.slice(idx + 1)];
        this.update();
    };

    protected openLogEditorForSelected = (ids: number[]): void => {
        if (!ids || ids.length === 0) {
            this.messages.warn('Aucune géocache sélectionnée');
            return;
        }
        if (typeof window === 'undefined') {
            return;
        }
        window.dispatchEvent(new CustomEvent('open-geocache-log-editor', {
            detail: {
                geocacheIds: ids,
                title: ids.length === 1 ? 'Log - 1 géocache' : `Log - ${ids.length} géocaches`,
            }
        }));
    };

    constructor(
        @inject(MessageService) protected readonly messages: MessageService,
        @inject(ApplicationShell) protected readonly shell: ApplicationShell,
        @inject(WidgetManager) protected readonly widgetManager: WidgetManager,
        @inject(MapWidgetFactory) protected readonly mapWidgetFactory: MapWidgetFactory,
        @inject(GeocacheTabsManager) protected readonly geocacheTabsManager: GeocacheTabsManager,
        @inject(PreferenceService) protected readonly preferenceService: PreferenceService,
        @inject(QuickInputService) protected readonly quickInputService: QuickInputService,
        @inject(ProgressService) protected readonly progressService: ProgressService,
        @inject(GeocachesService) protected readonly geocachesService: GeocachesService,
        @inject(BackendApiClient) protected readonly apiClient: BackendApiClient,
        @inject(ImportAroundService) protected readonly importAroundService: ImportAroundService,
        @inject(ZonesService) protected readonly zonesService: ZonesService,
        @inject(GeoAppWidgetEventsService) protected readonly widgetEventsService: GeoAppWidgetEventsService,
        @inject(MapService) protected readonly mapService: MapService,
    ) {
        super();
        this.id = ZoneGeocachesWidget.ID;
        this.title.label = 'Géocaches';
        this.title.caption = 'Géocaches';
        this.title.closable = true;
        this.title.iconClass = 'fa fa-table';
        this.addClass('theia-zone-geocaches-widget');
        this.tableVisibleColumnIds = this.readTableVisibleColumnIds();
        this.preferenceChangeDisposable = this.preferenceService.onPreferenceChanged(event => this.handlePreferenceChanged(event));

        // Sélection demandée depuis la carte de la zone (Ctrl+clic, menu contextuel).
        this.toDispose.push(
            this.mapService.onDidRequestListSelection(request => this.handleMapListSelectionRequest(request))
        );

        // Recharger la liste des zones cibles (copy/move) quand le tree widget
        // signale qu'une zone a été créée, supprimée, renommée ou fusionnée.
        this.toDispose.push(
            this.widgetEventsService.onDidChangeZoneList(() => { void this.reloadZonesList(); })
        );

        // Réactivité externe : rafraîchir les lignes du tableau quand une action
        // a lieu ailleurs (autre onglet de zone, suppression depuis l'arbre,
        // outils de l'assistant…). Le garde évite un double rechargement quand
        // c'est CE widget qui a émis l'événement (il fait déjà un load() complet).
        this.toDispose.push(
            this.widgetEventsService.onDidRequestZonesRefresh(() => {
                if (this.selfTriggeringZonesRefresh) {
                    return;
                }
                void this.reloadRows();
            })
        );

        // Réactivité aux édits faits depuis la page de détails (waypoint, coords
        // corrigées, statut de résolution…) : ne recharger que si la cache
        // concernée est présente dans ce tableau.
        this.toDispose.push(
            this.widgetEventsService.onDidChangeGeocache(event => {
                if (this.rows.some(row => row.id === event.geocacheId)) {
                    void this.reloadRows();
                }
            })
        );

        // Écouter les événements personnalisés pour ouvrir l'onglet
        this.setupEventListeners();

    }

    private readTableVisibleColumnIds(): GeocachesTableColumnId[] {
        const raw = this.preferenceService.get<unknown>(
            this.tableVisibleColumnsPreferenceKey,
            DEFAULT_GEOCACHES_TABLE_VISIBLE_COLUMNS
        );
        return normalizeGeocachesTableVisibleColumnIds(raw);
    }

    private handlePreferenceChanged(event: PreferenceChange): void {
        if (event.preferenceName !== this.tableVisibleColumnsPreferenceKey) {
            return;
        }
        this.tableVisibleColumnIds = this.readTableVisibleColumnIds();
        this.update();
    }

    protected readonly handleTableVisibleColumnIdsChange = (columnIds: GeocachesTableColumnId[]): void => {
        const normalized = normalizeGeocachesTableVisibleColumnIds(columnIds);
        this.tableVisibleColumnIds = normalized;
        this.update();
        void this.preferenceService.set(this.tableVisibleColumnsPreferenceKey, normalized, PreferenceScope.User);
    };

    protected onAfterAttach(msg: any): void {
        super.onAfterAttach(msg);
        this.addInteractionListeners();
        this.setupMinOpenTimeTimer();
    }

    protected onBeforeDetach(msg: any): void {
        this.removeInteractionListeners();
        super.onBeforeDetach(msg);
    }

    dispose(): void {
        this.preferenceChangeDisposable.dispose();
        super.dispose();
    }

    protected addInteractionListeners(): void {
        if (typeof window === 'undefined') {
            return;
        }
        this.node.addEventListener('click', this.handleContentClick, true);
        this.node.addEventListener('scroll', this.handleContentScroll, true);
        window.addEventListener('geoapp-geocache-log-submitted', this.handleGeocacheLogSubmitted as EventListener);
    }

    protected removeInteractionListeners(): void {
        if (typeof window === 'undefined') {
            return;
        }
        this.node.removeEventListener('click', this.handleContentClick, true);
        this.node.removeEventListener('scroll', this.handleContentScroll, true);
        window.removeEventListener('geoapp-geocache-log-submitted', this.handleGeocacheLogSubmitted as EventListener);
        this.clearMinOpenTimeTimer();
    }

    protected readonly handleContentClick = (): void => {
        this.emitInteraction('click');
    };

    protected readonly handleContentScroll = (): void => {
        this.emitInteraction('scroll');
    };

    protected emitInteraction(type: 'click' | 'scroll' | 'min-open-time'): void {
        if (typeof window === 'undefined') {
            return;
        }
        window.dispatchEvent(new CustomEvent('geoapp-zone-tab-interaction', {
            detail: {
                widgetId: this.id,
                type
            }
        }));
    }

    protected setupMinOpenTimeTimer(): void {
        this.clearMinOpenTimeTimer();

        if (typeof window === 'undefined') {
            return;
        }

        const enabled = this.preferenceService.get('geoApp.ui.tabs.smartReplace.interaction.minOpenTimeEnabled', true) as boolean;
        if (!enabled) {
            return;
        }

        const timeoutSeconds = this.preferenceService.get('geoApp.ui.tabs.smartReplaceTimeout', 30) as number;
        if (!timeoutSeconds || timeoutSeconds <= 0) {
            return;
        }

        this.interactionTimerId = window.setTimeout(() => {
            this.emitInteraction('min-open-time');
        }, timeoutSeconds * 1000);
    }

    protected clearMinOpenTimeTimer(): void {
        if (typeof window === 'undefined') {
            return;
        }
        if (this.interactionTimerId !== undefined) {
            window.clearTimeout(this.interactionTimerId);
            this.interactionTimerId = undefined;
        }
    }

    private extractGcCode(raw: string | null | undefined): string | undefined {
        const value = (raw || '').trim();
        if (!value) {
            return undefined;
        }
        const match = value.match(/(GC[0-9A-Z]+)/i);
        return match ? match[1].toUpperCase() : undefined;
    }

    protected async handleAddGeocacheSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();

        try {
            const form = event.currentTarget;
            const formData = new FormData(form);
            const gcCode = this.extractGcCode(formData.get('gc_code') as string);
            if (!gcCode) {
                this.messages.warn('Code GC invalide');
                return;
            }
            if (!this.zoneId) {
                this.messages.warn('Zone active manquante');
                return;
            }

            await this.geocachesService.addToZone(this.zoneId, gcCode);
            form.reset();
            await this.refreshZoneData();
            this.messages.info(`Geocache ${gcCode} importee`);
        } catch (error) {
            console.error('Import geocache error', error);
            this.messages.error(getErrorMessage(error, 'Erreur lors de l import de la geocache'));
        }
    }

    protected openImportDialog(): void {
        this.showImportDialog = true;
        this.update();
    }

    protected closeImportDialog(): void {
        this.showImportDialog = false;
        this.update();
    }

    protected openBookmarkListDialog(): void {
        this.showBookmarkListDialog = true;
        this.update();
    }

    protected closeBookmarkListDialog(): void {
        this.showBookmarkListDialog = false;
        this.update();
    }

    protected openPocketQueryDialog(): void {
        this.showPocketQueryDialog = true;
        this.update();
    }

    protected closePocketQueryDialog(): void {
        this.showPocketQueryDialog = false;
        this.update();
    }

    private async refreshZoneData(): Promise<void> {
        // L'émission est synchrone : on protège l'envoi pour que le handler
        // onDidRequestZonesRefresh de CE widget ignore son propre événement
        // (sinon double rechargement, vu qu'on enchaîne sur un load() complet).
        this.selfTriggeringZonesRefresh = true;
        try {
            this.widgetEventsService.requestZonesRefresh();
        } finally {
            this.selfTriggeringZonesRefresh = false;
        }
        await this.load();
    }

    private isAlreadyExistsError(error: unknown): boolean {
        return /already exists|existe d[ée]jà/i.test(getErrorMessage(error, ''));
    }

    /**
     * Exécute `worker` sur chaque élément avec un pool de concurrence borné, au
     * lieu d'enchaîner les requêtes une par une (séquentiel = N allers-retours
     * réseau en série). L'ordre de traitement n'est pas garanti ; le `worker`
     * est responsable de sa propre gestion d'erreur (comptage par élément).
     */
    private async runWithConcurrency<T>(
        items: T[],
        worker: (item: T) => Promise<void>,
        concurrency: number = 6
    ): Promise<void> {
        let cursor = 0;
        const pump = async (): Promise<void> => {
            while (true) {
                const index = cursor++;
                if (index >= items.length) {
                    return;
                }
                await worker(items[index]);
            }
        };
        const size = Math.max(1, Math.min(concurrency, items.length));
        await Promise.all(Array.from({ length: size }, () => pump()));
    }

    /**
     * Variante de `runWithConcurrency` qui affiche une notification de
     * progression Theia (barre + compteur « done/total ») mise à jour au fil de
     * l'avancement. Le `worker` gère sa propre erreur : un élément en échec est
     * tout de même compté comme traité pour faire avancer la barre.
     */
    private async runBulkWithProgress<T>(
        items: T[],
        worker: (item: T) => Promise<void>,
        options: { title: string; concurrency?: number }
    ): Promise<void> {
        const total = items.length;
        // showProgress est sur MessageService, pas sur ProgressService
        const progress = await this.messages.showProgress({
            text: options.title,
            options: { cancelable: false, location: 'notification' }
        });
        let done = 0;
        progress.report({ message: `0 / ${total}`, work: { done: 0, total } });
        try {
            await this.runWithConcurrency(items, async item => {
                await worker(item);
                done++;
                progress.report({ message: `${done} / ${total}`, work: { done, total } });
            }, options.concurrency);
        } finally {
            progress.cancel();
        }
    }

    private async consumeImportStream(
        response: Response,
        onProgress?: ImportProgressCallback
    ): Promise<{ lastMessage?: string; hadError: boolean }> {
        const reader = response.body?.getReader();
        if (!reader) {
            return { hadError: false };
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let lastMessage: string | undefined;
        let hadError = false;
        let errorMessage: string | undefined;

        const processLine = (rawLine: string): void => {
            const line = rawLine.trim();
            if (!line) {
                return;
            }

            try {
                const data = JSON.parse(line) as {
                    error?: boolean;
                    progress?: number;
                    message?: string;
                    final_summary?: boolean;
                    counts?: ImportCounts;
                    error_item?: string;
                };

                if (data.error) {
                    // Erreur fatale du flux (téléchargement échoué, aucun code…).
                    const message = data.message || 'Erreur lors de l\'import';
                    hadError = true;
                    errorMessage = message;
                    this.messages.error(message);
                    onProgress?.(0, message);
                    return;
                }

                if (typeof data.progress === 'number') {
                    onProgress?.(data.progress, data.message || '', {
                        counts: data.counts,
                        errorItem: data.error_item
                    });
                }

                if (data.final_summary && data.message) {
                    lastMessage = data.message;
                }
            } catch (error) {
                console.error('Error parsing import progress data:', error);
            }
        };

        while (true) {
            const { done, value } = await reader.read();
            if (value) {
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    processLine(line);
                }
            }

            if (done) {
                break;
            }
        }

        buffer += decoder.decode();
        processLine(buffer);
        return { lastMessage: errorMessage ?? lastMessage, hadError };
    }

    protected async handleExportGpxSelected(geocacheIds: number[]): Promise<void> {
        try {
            if (!geocacheIds || geocacheIds.length === 0) {
                this.messages.warn('Aucune géocache sélectionnée');
                return;
            }

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const safeZoneName = (this.zoneName || '')
                .replace(/[^A-Za-z0-9._-]+/g, '_')
                .replace(/^[_\-.]+|[_\-.]+$/g, '');
            const zoneSuffix = safeZoneName ? `_${safeZoneName}` : '';
            const filename = `geoapp${zoneSuffix}_geocaches_${timestamp}.gpx`;

            this.messages.info(`Export GPX en cours (${geocacheIds.length} géocache${geocacheIds.length > 1 ? 's' : ''})…`);

            const res = await this.geocachesService.exportGpx(geocacheIds, filename);

            // Parsing du Content-Disposition : on privilégie la forme
            // ``filename*=UTF-8''<name>`` (RFC 5987) à la forme legacy
            // ``filename="<name>"``, car c'est elle qui transporte les caractères
            // non-ASCII. Le backend sanitize en ASCII, mais on reste robuste.
            const contentDisposition = res.headers.get('Content-Disposition') || '';
            const starMatch = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(contentDisposition);
            const plainMatch = /filename\s*=\s*"?([^";]+)"?/i.exec(contentDisposition);
            const downloadName = decodeURIComponent((starMatch?.[1] || plainMatch?.[1] || '').trim()) || filename;

            const contentType = res.headers.get('Content-Type') || '';
            const isZip = contentType.includes('application/zip') || downloadName.toLowerCase().endsWith('.zip');

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = downloadName;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);

            this.messages.info(
                isZip
                    ? `Export GPX généré : archive ZIP (${geocacheIds.length} géocache${geocacheIds.length > 1 ? 's' : ''}, fichier GPX + waypoints)`
                    : `Export GPX généré (${geocacheIds.length} géocache${geocacheIds.length > 1 ? 's' : ''})`
            );
        } catch (e) {
            console.error('Export GPX error', e);
            this.messages.error('Erreur lors de l\'export GPX');
        }
    }

    storeState(): object | undefined {
        if (!this.zoneId) {
            return undefined;
        }
        this.lastAccessTimestamp = Date.now();
        const state: SerializedZoneGeocachesState = {
            zoneId: this.zoneId,
            zoneName: this.zoneName,
            lastAccessTimestamp: this.lastAccessTimestamp
        };
        return state;
    }

    restoreState(oldState: object): void {
        const state = oldState as Partial<SerializedZoneGeocachesState> | undefined;
        if (!state || typeof state.zoneId !== 'number') {
            return;
        }
        if (state.lastAccessTimestamp && typeof state.lastAccessTimestamp === 'number') {
            this.lastAccessTimestamp = state.lastAccessTimestamp;
        }
        this.setZone({ zoneId: state.zoneId, zoneName: state.zoneName });
    }

    private setupEventListeners(): void {
        // Écouter l'événement personnalisé pour ouvrir l'onglet des géocaches de zone
        window.addEventListener('open-zone-geocaches', (event: any) => {
            const detail = event.detail;
            if (detail && detail.zoneId) {
                this.handleOpenZoneGeocaches(detail.zoneId, detail.zoneName);
            }
        });

        // Note : l'ouverture des détails via 'geoapp-open-geocache-details' est
        // désormais gérée globalement dans ZonesFrontendContribution (listener
        // actif même si ce widget n'est pas monté).

        // Note : l'import « autour de… » déclenché depuis le menu contextuel d'une
        // carte est géré par MapWidget lui-même, qui connaît la zone cible (ou
        // demande à l'utilisateur de la choisir pour une carte libre).
    }

    private async pickCenterType(): Promise<'point' | 'geocache' | 'gc_code' | undefined> {
        const picks: WizardPick<'point' | 'geocache' | 'gc_code'>[] = [
            {
                label: 'Autour d’un point (latitude/longitude)',
                value: 'point',
            },
            {
                label: 'Autour d’une géocache de la zone',
                value: 'geocache',
            },
            {
                label: 'Autour d’un GC code (geocaching.com)',
                value: 'gc_code',
            },
        ];

        const picked = await this.quickInputService.pick(
            picks,
            {
                title: 'Importer des géocaches autour…',
                placeHolder: 'Choisir le centre',
            }
        );
        return picked?.value;
    }

    private async pickLimit(defaultLimit: number = 50): Promise<number | undefined> {
        const picks: WizardPick<number | 'custom'>[] = [
            { label: '20', value: 20 },
            { label: '50', value: 50 },
            { label: '100', value: 100 },
            { label: '200', value: 200 },
            { label: '500', value: 500 },
            { label: 'Personnalisé…', value: 'custom' },
        ];

        const picked = await this.quickInputService.pick(picks, {
            title: 'Importer des géocaches autour…',
            placeHolder: 'Limite (nombre max de géocaches)',
        });

        if (!picked) {
            return undefined;
        }

        if (picked.value === 'custom') {
            const raw = await this.promptNumber('Limite (nombre max de géocaches)', {
                placeholder: String(defaultLimit),
                defaultValue: String(defaultLimit),
                integer: true,
            });
            if (raw === undefined) {
                return undefined;
            }
            return parseInt(raw.trim(), 10);
        }

        return picked.value;
    }

    private async promptNumber(label: string, options: { placeholder: string; defaultValue?: string; integer?: boolean; allowEmpty?: boolean }): Promise<string | undefined> {
        const validate = async (input: string): Promise<string | undefined> => {
            const value = (input ?? '').trim();
            if (!value) {
                return options.allowEmpty ? undefined : 'Valeur requise';
            }
            const parsed = options.integer ? parseInt(value, 10) : Number(value);
            if (!Number.isFinite(parsed)) {
                return 'Nombre invalide';
            }
            if (parsed <= 0) {
                return 'La valeur doit être > 0';
            }
            return undefined;
        };

        return this.quickInputService.input({
            title: 'Importer des géocaches autour…',
            prompt: label,
            placeHolder: options.placeholder,
            value: options.defaultValue,
            ignoreFocusLost: true,
            validateInput: validate,
        });
    }

    private async promptText(label: string, options: { placeholder: string; defaultValue?: string; allowEmpty?: boolean }): Promise<string | undefined> {
        const validate = async (input: string): Promise<string | undefined> => {
            const value = (input ?? '').trim();
            if (!value && !options.allowEmpty) {
                return 'Valeur requise';
            }
            return undefined;
        };

        return this.quickInputService.input({
            title: 'Importer des géocaches autour…',
            prompt: label,
            placeHolder: options.placeholder,
            value: options.defaultValue,
            ignoreFocusLost: true,
            validateInput: validate,
        });
    }

    private async pickGeocacheFromZone(): Promise<ImportAroundCenter | undefined> {
        const rows = (this.rows || []).slice();
        if (rows.length === 0) {
            this.messages.warn('Aucune géocache dans la zone pour servir de centre');
            return undefined;
        }

        const picks: WizardPick<Geocache>[] = rows.map(gc => ({
            label: `${gc.gc_code} - ${gc.name}`,
            value: gc,
        }));

        const picked = await this.quickInputService.pick(
            picks,
            {
                title: 'Importer des géocaches autour…',
                placeHolder: 'Choisir la géocache centre',
                matchOnDescription: true,
                matchOnDetail: true,
            }
        );

        if (!picked) {
            return undefined;
        }

        return {
            type: 'geocache_id',
            geocache_id: picked.value.id,
            gc_code: picked.value.gc_code,
            name: picked.value.name,
        };
    }

    private async buildImportAroundRequest(initialCenter?: ImportAroundCenter): Promise<{ center: ImportAroundCenter; limit: number; radius_km?: number } | undefined> {
        let center: ImportAroundCenter | undefined = initialCenter;
        if (!center) {
            const centerType = await this.pickCenterType();
            if (!centerType) {
                return undefined;
            }

            if (centerType === 'point') {
                const latRaw = await this.promptText('Latitude', { placeholder: '48.8566' });
                if (latRaw === undefined) {
                    return undefined;
                }
                const lonRaw = await this.promptText('Longitude', { placeholder: '2.3522' });
                if (lonRaw === undefined) {
                    return undefined;
                }
                const lat = Number((latRaw ?? '').trim());
                const lon = Number((lonRaw ?? '').trim());
                if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
                    this.messages.error('Latitude/Longitude invalides');
                    return undefined;
                }
                center = { type: 'point', lat, lon };
            } else if (centerType === 'geocache') {
                center = await this.pickGeocacheFromZone();
                if (!center) {
                    return undefined;
                }
            } else {
                const codeRaw = await this.promptText('GC code', { placeholder: 'GC12345' });
                if (codeRaw === undefined) {
                    return undefined;
                }
                const gc_code = codeRaw.trim().toUpperCase();
                center = { type: 'gc_code', gc_code };
            }
        }

        const limit = await this.pickLimit(50);
        if (limit === undefined) {
            return undefined;
        }

        const radiusPicks: WizardPick<'none' | 'radius'>[] = [
            { label: 'Sans rayon (limite uniquement)', value: 'none' },
            { label: 'Avec rayon (km)', value: 'radius' },
        ];

        const radiusMode = await this.quickInputService.pick(
            radiusPicks,
            {
                title: 'Importer des géocaches autour…',
                placeHolder: 'Limiter la recherche par rayon ?'
            }
        );

        if (!radiusMode) {
            return undefined;
        }

        if (radiusMode.value === 'radius') {
            const radiusRaw = await this.promptNumber('Rayon (km)', {
                placeholder: '5',
                allowEmpty: false,
                integer: false,
            });
            if (radiusRaw === undefined) {
                return undefined;
            }
            const radius_km = Number(radiusRaw.trim());
            return { center, limit, radius_km };
        }

        return { center, limit };
    }

    private async runImportAroundWithProgress(
        request: ImportAroundRequest,
        onProgress?: (percentage: number, message: string) => void
    ): Promise<void> {
        if (!this.zoneId) {
            this.messages.warn('Zone active manquante');
            return;
        }

        const controller = new AbortController();
        try {
            const summary = await this.importAroundService.run(this.zoneId, request, {
                onProgress,
                onError: message => this.messages.error(message),
                signal: controller.signal,
            });

            this.messages.info(summary || 'Import terminé');

            await this.refreshZoneData();
        } catch (e) {
            if ((e as any)?.name === 'AbortError') {
                return;
            }
            console.error('Import around error', e);
            this.messages.error('Erreur lors de l\'import autour');
            throw e;
        }
    }

    private openImportAroundDialog(initialCenter?: ImportAroundCenter): void {
        this.importAroundDialogInitialCenter = initialCenter;
        this.importAroundDialogOpen = true;
        this.update();
    }

    private closeImportAroundDialog(): void {
        this.importAroundDialogOpen = false;
        this.importAroundDialogInitialCenter = undefined;
        this.update();
    }

    private async handleImportAroundDialogImport(
        request: ImportAroundRequest,
        onProgress?: (percentage: number, message: string) => void
    ): Promise<void> {
        this.isImporting = true;
        this.update();
        try {
            await this.runImportAroundWithProgress(request, onProgress);
            this.closeImportAroundDialog();
        } catch {
            // error already shown via messages service
        } finally {
            this.isImporting = false;
            this.update();
        }
    }

    private startImportAroundWizard(initialCenter?: ImportAroundCenter): void {
        this.openImportAroundDialog(initialCenter);
    }

    private async handleOpenZoneGeocaches(zoneId: number, zoneName?: string): Promise<void> {
        try {
            // Configurer le widget avec la zone
            this.setZone({ zoneId, zoneName });

            // Ajouter le widget à la zone principale s'il n'y est pas déjà
            if (!this.isAttached) {
                this.shell.addWidget(this, { area: 'main' });
            }

            // Activer le widget
            this.shell.activateWidget(this.id);

        } catch (error) {
            console.error('ZoneGeocachesWidget: Error opening widget:', error);
            this.messages.error('Erreur lors de l\'ouverture de l\'onglet géocaches');
        }
    }

    /** Configure le widget avec l'ID et le nom de la zone */
    setZone(context: { zoneId: number; zoneName?: string }): void {
        this.zoneId = context.zoneId;
        this.zoneName = context.zoneName;
        this.lastAccessTimestamp = Date.now();
        this.title.label = `Géocaches - ${this.zoneName ?? this.zoneId}`;
        this.update();
        // Charger une fois la liste des zones (cibles copy/move) ; ensuite tenue
        // à jour via onDidChangeZoneList. load() ne s'en occupe plus.
        void this.reloadZonesList();
        this.load();
        this.setupMinOpenTimeTimer();
    }

    /**
     * Appelé quand le widget devient actif
     * Réactive automatiquement la carte correspondante
     */
    protected onActivateRequest(msg: any): void {
        super.onActivateRequest(msg);
        this.reactivateMap();
    }

    /**
     * Appelé quand le widget va être fermé
     * Ferme automatiquement la carte correspondante
     */
    protected onCloseRequest(msg: any): void {
        // Fermer la carte de zone associée avant de fermer l'onglet
        this.closeAssociatedMap();

        // Appeler la méthode parente pour la fermeture normale
        super.onCloseRequest(msg);
    }

    /**
     * Ferme la carte associée à cette zone
     */
    private closeAssociatedMap(): void {
        if (this.zoneId && this.zoneName) {
            const mapId = `geoapp-map-zone-${this.zoneId}`;
            const existingMap = this.shell.getWidgets('bottom').find(w => w.id === mapId);

            if (existingMap) {
                existingMap.close();
            }
        }
    }

    /**
     * Réactive la carte correspondante à cette zone
     */
    private reactivateMap(): void {
        
        // Si on a une zone chargée, réactiver sa carte
        if (this.zoneId && this.zoneName) {
            const mapId = `geoapp-map-zone-${this.zoneId}`;
            const bottomWidgets = this.shell.getWidgets('bottom');
            
            const existingMap = bottomWidgets.find(w => w.id === mapId);
            
            if (existingMap) {
                this.shell.activateWidget(mapId);
            } else {
            }
        } else {
        }
    }

    /**
     * Convertit une géocache du tableau vers le format attendu par la carte.
     * À n'appeler que pour des géocaches dont latitude/longitude sont définies
     * (la carte exige des coordonnées numériques).
     */
    private toMapGeocache(gc: Geocache): MapGeocache {
        return {
            id: gc.id,
            gc_code: gc.gc_code,
            name: gc.name,
            cache_type: gc.cache_type,
            latitude: gc.latitude!,
            longitude: gc.longitude!,
            difficulty: gc.difficulty,
            terrain: gc.terrain,
            found: gc.found,
            is_corrected: gc.is_corrected,
            original_latitude: gc.original_latitude,
            original_longitude: gc.original_longitude,
            waypoints: gc.waypoints || []
        };
    }

    protected handleFilteredDataChange(geocaches: Geocache[]): void {
        const mapWidget = this.findZoneMapWidget();
        if (!mapWidget) { return; }
        const mapGeocaches = geocaches
            .filter(gc => gc.latitude != null && gc.longitude != null)
            .map(gc => this.toMapGeocache(gc));
        mapWidget.loadGeocaches(mapGeocaches);
    }

    /**
     * Répercute sur la carte les géocaches cochées dans le tableau (anneau noir
     * et pulsation à la sélection).
     *
     * Pas de `update()` ici : le tableau détient déjà cet état, le re-rendre à
     * chaque case cochée serait inutile. On mémorise seulement la sélection pour
     * pouvoir la modifier depuis la carte.
     */
    protected handleSelectionChange(geocacheIds: number[]): void {
        this.selectedGeocacheIds = geocacheIds;
        this.findZoneMapWidget()?.setSelectedGeocaches(geocacheIds);
    }

    /**
     * Applique au tableau une sélection demandée depuis la carte de cette zone.
     * Le tableau renverra ensuite la sélection vers la carte via
     * `handleSelectionChange`, ce qui met l'anneau à jour.
     */
    protected handleMapListSelectionRequest(request: ListSelectionRequest): void {
        if (!this.zoneId || request.mapId !== `geoapp-map-zone-${this.zoneId}`) {
            return;
        }

        const next = new Set(this.selectedGeocacheIds);
        switch (request.mode) {
            case 'clear':
                next.clear();
                break;
            case 'add':
                for (const id of request.geocacheIds) { next.add(id); }
                break;
            case 'remove':
                for (const id of request.geocacheIds) { next.delete(id); }
                break;
            default:
                for (const id of request.geocacheIds) {
                    if (next.has(id)) { next.delete(id); } else { next.add(id); }
                }
        }

        // Nouvelle référence de tableau : le tableau en dépend pour se réaligner.
        this.selectedGeocacheIds = [...next];
        this.update();
    }

    /** Carte associée à la zone courante, si elle est ouverte. */
    private findZoneMapWidget(): MapWidget | undefined {
        if (!this.zoneId) { return undefined; }
        const widgetId = `geoapp-map-zone-${this.zoneId}`;
        return this.shell.getWidgets('bottom').find(w => w.id === widgetId) as MapWidget | undefined;
    }

    private async reloadZonesList(): Promise<void> {
        try {
            this.zones = await this.zonesService.list<{ id: number; name: string }>();
            this.update();
        } catch (e) {
            console.error('[ZoneGeocachesWidget] Failed to reload zones list', e);
        }
    }

    /**
     * Rafraîchissement incrémental : recharge uniquement les lignes du tableau
     * (pas la liste des zones, pas de réouverture/activation de la carte). La
     * carte associée est tout de même mise à jour via onFilteredDataChange
     * déclenché par le re-rendu du tableau. Ne touche pas à l'état `loading`
     * pour éviter de masquer le tableau pendant un refresh externe.
     */
    private async reloadRows(): Promise<void> {
        if (!this.zoneId) {
            return;
        }
        try {
            this.rows = await this.zonesService.listGeocaches<Geocache>(this.zoneId);
            this.update();
        } catch (e) {
            console.error('[ZoneGeocachesWidget] reloadRows error', e);
        }
    }

    /**
     * Charge « qui a trouvé quoi » depuis la base locale (aucun appel à
     * geocaching.com : la collecte se fait via analyzeFriendFinds).
     */
    protected async loadFriendFinds(): Promise<void> {
        if (!this.zoneId) {
            return;
        }
        try {
            const data = await this.apiClient.requestJson<{ success: boolean; finds: Record<string, string[]> }>(
                `/api/friends/finds/zone/${this.zoneId}`
            );
            if (data?.success) {
                // Nouvelle référence d'objet : la colonne « Amis » du tableau en dépend.
                this.friendFinds = { ...data.finds };
                this.update();
            }
        } catch (error) {
            // Fonctionnalité optionnelle : son absence ne doit pas gêner la zone.
            console.debug('[ZoneGeocaches] friend finds indisponibles:', error);
        }
    }

    /**
     * Détermine, ami par ami, quelles caches de la zone il a trouvées.
     *
     * Séquentiel et volontairement lent : la recherche geocaching.com est
     * fortement limitée en débit (429). On s'arrête net au premier signal de
     * throttling plutôt que d'insister, en gardant ce qui a déjà été collecté.
     */
    protected analyzeFriendFinds = async (): Promise<void> => {
        if (!this.zoneId || this.friendFindsProgress) {
            return;
        }

        // Estimation préalable (1 requête) : une zone dispersée produit une boîte
        // englobante démesurée, et l'analyse peut alors durer des dizaines de minutes.
        try {
            const estimate = await this.apiClient.requestJson<{
                success: boolean; zone_caches: number; searched_caches: number; seconds_per_friend: number;
            }>(`/api/friends/finds/zone/${this.zoneId}/estimate`);

            if (estimate?.success && estimate.searched_caches > 10 * Math.max(estimate.zone_caches, 1)) {
                const minutes = Math.ceil((estimate.seconds_per_friend * 16) / 60);
                const confirmed = await new ConfirmDialog({
                    title: 'Analyse longue',
                    msg: `Les caches de cette zone sont dispersées : il faut balayer ${estimate.searched_caches} `
                        + `caches pour ${estimate.zone_caches} dans la zone, soit environ ${minutes} min `
                        + 'pour tous vos amis (geocaching.com limite fortement les recherches). Continuer ?',
                    ok: 'Lancer', cancel: 'Annuler'
                }).open();
                if (!confirmed) {
                    return;
                }
            }
        } catch (error) {
            console.debug('[ZoneGeocaches] estimation indisponible:', error);
        }

        let friends: Array<{ username: string }> = [];
        try {
            const data = await this.apiClient.requestJson<{ success: boolean; friends: Array<{ username: string }> }>(
                '/api/friends'
            );
            friends = data?.friends ?? [];
        } catch (error) {
            this.messages.error("Impossible de récupérer la liste d'amis : " + error);
            return;
        }

        if (friends.length === 0) {
            this.messages.info("Aucun ami Geocaching.com à analyser.");
            return;
        }

        this.friendFindsProgress = { done: 0, total: friends.length };
        this.update();

        let analyzed = 0;
        try {
            for (const friend of friends) {
                this.friendFindsProgress = { done: analyzed, total: friends.length, friend: friend.username };
                this.update();

                const response = await this.apiClient.request('/api/friends/finds/sync-zone', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ zone_id: this.zoneId, friend: friend.username })
                });

                if (response.status === 429) {
                    this.messages.warn(
                        `Geocaching.com limite les recherches : analyse interrompue après ${analyzed} ami(s). `
                        + 'Relancez dans quelques minutes pour continuer.'
                    );
                    break;
                }
                if (!response.ok) {
                    const payload = await response.json().catch(() => ({}));
                    this.messages.error(payload.error_message || `Échec de l'analyse (HTTP ${response.status})`);
                    break;
                }
                analyzed += 1;
            }
        } finally {
            this.friendFindsProgress = null;
            await this.loadFriendFinds();
            this.update();
        }

        if (analyzed > 0) {
            const withFriends = Object.keys(this.friendFinds).length;
            this.messages.info(
                `${analyzed} ami(s) analysé(s) : ${withFriends} cache(s) de la zone trouvée(s) par au moins un ami.`
            );
        }
    };

    protected async load(): Promise<void> {
        if (!this.zoneId) { return; }
        this.loading = true;
        this.update();
        try {
            // Charger les géocaches
            this.rows = await this.zonesService.listGeocaches<Geocache>(this.zoneId);

            // « Qui a trouvé quoi » : lecture locale, sans réseau geocaching.com.
            void this.loadFriendFinds();

            // NB : la liste des zones (cibles copy/move) n'est PAS rechargée ici.
            // Elle est chargée une fois dans setZone() puis tenue à jour via
            // l'événement onDidChangeZoneList — inutile de la refetch à chaque action.

            // Charger les géocaches sur la carte (avec waypoints)
            const geocachesWithCoords = this.rows.filter(gc =>
                gc.latitude !== null &&
                gc.latitude !== undefined &&
                gc.longitude !== null &&
                gc.longitude !== undefined
            );

            // La carte est ouverte même pour une zone vide : elle sert aussi à
            // remplir la zone (menu contextuel « Importer autour… »).
            if (this.zoneId && this.zoneName) {
                const mapGeocaches = geocachesWithCoords.map(gc => this.toMapGeocache(gc));
                this.mapWidgetFactory.openMapForZone(this.zoneId, this.zoneName, mapGeocaches);
            }

        } catch (e) {
            console.error('ZoneGeocachesWidget: load error', e);
            this.messages.warn('Impossible de charger les géocaches de la zone');
        } finally {
            this.loading = false;
            this.update();
        }
    }

    protected async handleDeleteSelected(ids: number[]): Promise<void> {
        const dialog = new ConfirmDialog({
            title: 'Supprimer les géocaches',
            msg: `Voulez-vous vraiment supprimer ${ids.length} géocache(s) sélectionnée(s) ?`,
            ok: Dialog.OK,
            cancel: Dialog.CANCEL
        });
        
        const confirmed = await dialog.open();
        if (!confirmed) {
            return;
        }

        let deletedCount = 0;
        let errorCount = 0;
        await this.runBulkWithProgress(ids, async id => {
            try {
                await this.geocachesService.delete(id);
                deletedCount++;
            } catch (e) {
                console.error('Delete error', e);
                errorCount++;
            }
        }, { title: `Suppression de ${ids.length} géocache(s)…` });

        await this.refreshZoneData();

        if (errorCount === 0) {
            this.messages.info(`${deletedCount} géocache(s) supprimée(s)`);
        } else {
            this.messages.warn(`${deletedCount} géocache(s) supprimée(s), ${errorCount} en erreur`);
        }
    }

    protected async handleRefreshSelected(ids: number[]): Promise<void> {
        let refreshedCount = 0;
        let errorCount = 0;
        // Concurrence volontairement basse : chaque refresh scrape geocaching.com,
        // trop de requêtes en parallèle risquerait un rate-limit côté source.
        await this.runBulkWithProgress(ids, async id => {
            try {
                await this.geocachesService.refresh(id);
                refreshedCount++;
            } catch (e) {
                console.error('Refresh error', e);
                errorCount++;
            }
        }, { title: `Rafraîchissement de ${ids.length} géocache(s)…`, concurrency: 3 });

        await this.load();

        if (errorCount === 0) {
            this.messages.info(`${refreshedCount} géocache(s) rafraîchie(s)`);
        } else {
            this.messages.warn(`${refreshedCount} géocache(s) rafraîchie(s), ${errorCount} en erreur`);
        }
    }

    protected async handleDelete(id: number, gcCode: string): Promise<void> {
        const dialog = new ConfirmDialog({
            title: 'Supprimer la géocache',
            msg: `Voulez-vous vraiment supprimer la géocache ${gcCode} ?`,
            ok: Dialog.OK,
            cancel: Dialog.CANCEL
        });
        
        const confirmed = await dialog.open();
        if (!confirmed) {
            return;
        }
        
        try {
            await this.geocachesService.delete(id);
            this.messages.info('Géocache supprimée');
            await this.refreshZoneData();
        } catch (e) {
            console.error('Delete error', e);
            this.messages.error(getErrorMessage(e, 'Erreur lors de la suppression'));
        }
    }

    protected async handleRefresh(id: number): Promise<void> {
        try {
            this.messages.info('Rafraîchissement en cours...');
            await this.geocachesService.refresh(id);
            this.messages.info('Géocache rafraîchie');
            await this.load();
        } catch (e) {
            console.error('Refresh error', e);
            this.messages.error('Erreur lors du rafraîchissement');
        }
    }

    protected async handleMove(geocache: Geocache, targetZoneId: number): Promise<void> {
        try {
            await this.geocachesService.move(geocache.id, targetZoneId);
            this.messages.info(`Géocache ${geocache.gc_code} déplacée`);
            await this.refreshZoneData();
        } catch (e) {
            console.error('Move error', e);
            this.messages.error(getErrorMessage(e, 'Erreur lors du déplacement'));
        }
    }

    protected async handleCopy(geocache: Geocache, targetZoneId: number): Promise<void> {
        try {
            await this.geocachesService.copy(geocache.id, targetZoneId);
            this.messages.info(`Géocache ${geocache.gc_code} copiée vers la zone cible`);
            await this.refreshZoneData();
        } catch (e) {
            console.error('Copy error', e);
            this.messages.error(getErrorMessage(e, 'Erreur lors de la copie'));
        }
    }

    protected async handleCopySelected(geocacheIds: number[]): Promise<void> {
        this.copySelectedDialog = { geocacheIds };
        this.update();
    }

    protected closeCopySelectedDialog(): void {
        this.copySelectedDialog = null;
        this.update();
    }

    protected async performCopySelected(geocacheIds: number[], targetZoneId: number): Promise<void> {
        let copiedCount = 0;
        let alreadyExistsCount = 0;
        let errorCount = 0;
        const targetZoneName = this.zones.find(z => z.id === targetZoneId)?.name || `Zone ${targetZoneId}`;

        // Fermer immédiatement le dialog : la barre de progression prend le relais
        this.closeCopySelectedDialog();

        await this.runBulkWithProgress(geocacheIds, async geocacheId => {
            // Ignorer les ids absents des données actuelles
            const geocache = this.rows.find(g => g.id === geocacheId);
            if (!geocache) {
                return;
            }
            try {
                await this.geocachesService.copy(geocacheId, targetZoneId);
                copiedCount++;
            } catch (e) {
                if (this.isAlreadyExistsError(e)) {
                    alreadyExistsCount++;
                    return;
                }
                console.error(`Copy error for geocache ${geocacheId}:`, e);
                errorCount++;
            }
        }, { title: `Copie de ${geocacheIds.length} géocache(s)…` });

        await this.refreshZoneData();

        // Afficher le résultat
        let message = '';
        if (copiedCount > 0) {
            message += `${copiedCount} géocache${copiedCount > 1 ? 's' : ''} copiée${copiedCount > 1 ? 's' : ''}`;
        }
        if (alreadyExistsCount > 0) {
            if (message) message += ', ';
            message += `${alreadyExistsCount} géocache${alreadyExistsCount > 1 ? 's' : ''} déjà présente${alreadyExistsCount > 1 ? 's' : ''} dans ${targetZoneName}`;
        }
        if (errorCount > 0) {
            if (message) message += ', ';
            message += `${errorCount} erreur${errorCount > 1 ? 's' : ''}`;
        }

        if (errorCount === 0) {
            this.messages.info(`Copie terminée: ${message}`);
        } else {
            this.messages.warn(`Copie partiellement réussie: ${message}`);
        }
    }

    protected async handleMoveSelected(geocacheIds: number[]): Promise<void> {
        this.moveSelectedDialog = { geocacheIds };
        this.update();
    }

    protected closeMoveSelectedDialog(): void {
        this.moveSelectedDialog = null;
        this.update();
    }

    /**
     * Gère l'application d'un plugin sur les géocaches sélectionnées
     */
    protected async handleApplyPluginSelected(geocacheIds: number[]): Promise<void> {
        if (!this.zoneId) {
            this.messages.warn('Zone active manquante');
            return;
        }

        try {
            // Récupérer les détails des géocaches sélectionnées
            const selectedGeocaches = this.rows.filter(g => geocacheIds.includes(g.id));
            
            if (selectedGeocaches.length === 0) {
                this.messages.warn('Aucune géocache sélectionnée');
                return;
            }

            // Ouvrir le widget batch via le WidgetManager
            const batchWidgetId = 'batch-plugin-executor-widget';
            
            try {
                // Créer ou récupérer le widget
                const widget = await this.widgetManager.getOrCreateWidget(batchWidgetId);
                
                // Préparer les données pour le widget
                const batchData = {
                    geocaches: selectedGeocaches.map(g => ({
                        id: g.id,
                        gc_code: g.gc_code,
                        name: g.name,
                        original_latitude: g.original_latitude,
                        original_longitude: g.original_longitude,
                        original_coordinates_raw: g.original_coordinates_raw,
                        coordinates: (g.latitude && g.longitude) ? {
                            latitude: g.latitude,
                            longitude: g.longitude,
                            coordinates_raw: g.coordinates_raw || `${g.latitude}, ${g.longitude}`
                        } : undefined,
                        description: g.description,
                        hint: g.hint,
                        difficulty: g.difficulty,
                        terrain: g.terrain,
                        waypoints: g.waypoints || []
                    })),
                    zoneId: this.zoneId,
                    zoneName: this.zoneName
                };

                // Envoyer les données au widget via un événement personnalisé
                window.dispatchEvent(new CustomEvent('batch-executor-initialize', {
                    detail: batchData
                }));

                // Ajouter et activer le widget
                if (!widget.isAttached) {
                    this.shell.addWidget(widget, { area: 'main' });
                }
                this.shell.activateWidget(widget.id);

                
            } catch (widgetError) {
                console.error('[ZoneGeocachesWidget] Error opening batch widget:', widgetError);
                this.messages.error('Impossible d\'ouvrir l\'exécuteur de plugins batch');
            }
            
        } catch (error) {
            console.error('[ZoneGeocachesWidget] Error in handleApplyPluginSelected:', error);
            this.messages.error('Erreur lors de l\'application du plugin');
        }
    }

    protected async performMoveSelected(geocacheIds: number[], targetZoneId: number): Promise<void> {
        let movedCount = 0;
        let alreadyExistsCount = 0;
        let errorCount = 0;
        const targetZoneName = this.zones.find(z => z.id === targetZoneId)?.name || `Zone ${targetZoneId}`;

        // Fermer immédiatement le dialog : la barre de progression prend le relais
        this.closeMoveSelectedDialog();

        await this.runBulkWithProgress(geocacheIds, async geocacheId => {
            // Ignorer les ids absents des données actuelles
            const geocache = this.rows.find(g => g.id === geocacheId);
            if (!geocache) {
                return;
            }
            try {
                const result = await this.geocachesService.move(geocacheId, targetZoneId);
                if (result?.already_exists) {
                    alreadyExistsCount++;
                } else {
                    movedCount++;
                }
            } catch (e) {
                console.error(`Move error for geocache ${geocacheId}:`, e);
                errorCount++;
            }
        }, { title: `Déplacement de ${geocacheIds.length} géocache(s)…` });

        await this.refreshZoneData();

        // Afficher le résultat
        let message = '';
        if (movedCount > 0) {
            message += `${movedCount} géocache${movedCount > 1 ? 's' : ''} déplacée${movedCount > 1 ? 's' : ''}`;
        }
        if (alreadyExistsCount > 0) {
            if (message) message += ', ';
            message += `${alreadyExistsCount} géocache${alreadyExistsCount > 1 ? 's' : ''} déjà présente${alreadyExistsCount > 1 ? 's' : ''} dans ${targetZoneName}`;
        }
        if (errorCount > 0) {
            if (message) message += ', ';
            message += `${errorCount} erreur${errorCount > 1 ? 's' : ''}`;
        }

        if (errorCount === 0) {
            this.messages.info(`Déplacement terminé: ${message}`);
        } else {
            this.messages.warn(`Déplacement partiellement réussi: ${message}`);
        }
    }

    protected async handleImportGpx(file: File, updateExisting: boolean, onProgress?: ImportProgressCallback): Promise<void> {
        if (!this.zoneId) {
            this.messages.warn('Zone active manquante');
            return;
        }

        const controller = new AbortController();
        this.importAbortController = controller;
        try {
            this.isImporting = true;
            if (onProgress) {
                onProgress(0, 'Préparation de l\'import...');
            }

            const response = await this.geocachesService.importGpx(file, this.zoneId, updateExisting, controller.signal);
            const { lastMessage, hadError } = await this.consumeImportStream(response, onProgress);
            if (hadError) {
                // Erreur déjà affichée : garder la dialog ouverte pour réessayer.
                await this.refreshZoneData();
                return;
            }
            this.messages.info(lastMessage || 'Import terminé');

            // Fermer la dialog et recharger les données
            this.showImportDialog = false;
            await this.refreshZoneData();
        } catch (e) {
            if ((e as { name?: string })?.name === 'AbortError') {
                this.messages.info('Import interrompu');
                onProgress?.(0, 'Import interrompu');
                await this.refreshZoneData();
            } else {
                console.error('Import GPX error', e);
                this.messages.error(getErrorMessage(e, 'Erreur lors de l\'import du fichier GPX'));
                onProgress?.(0, 'Erreur lors de l\'import');
            }
        } finally {
            this.isImporting = false;
            this.importAbortController = undefined;
        }
    }

    protected cancelImport(): void {
        this.importAbortController?.abort();
    }

    protected async handleImportBookmarkList(bookmarkCode: string, updateExisting: boolean, onProgress?: ImportProgressCallback): Promise<void> {
        if (!this.zoneId) {
            this.messages.error('Zone non définie');
            return;
        }

        const controller = new AbortController();
        this.importAbortController = controller;
        this.isImporting = true;
        this.update();

        try {
            const response = await this.geocachesService.importBookmarkList(bookmarkCode, this.zoneId, updateExisting, controller.signal);
            const { lastMessage, hadError } = await this.consumeImportStream(response, onProgress);
            if (hadError) {
                await this.refreshZoneData();
                return;
            }
            this.messages.info(lastMessage || 'Import terminé');

            this.showBookmarkListDialog = false;
            await this.refreshZoneData();
        } catch (e) {
            if ((e as { name?: string })?.name === 'AbortError') {
                this.messages.info('Import interrompu');
                onProgress?.(0, 'Import interrompu');
                await this.refreshZoneData();
            } else {
                console.error('Import bookmark list error', e);
                this.messages.error(getErrorMessage(e, 'Erreur lors de l\'import de la liste de favoris'));
                onProgress?.(0, 'Erreur lors de l\'import');
            }
        } finally {
            this.isImporting = false;
            this.importAbortController = undefined;
        }
    }

    protected async handleImportPocketQuery(pqCode: string, updateExisting: boolean, onProgress?: ImportProgressCallback): Promise<void> {
        if (!this.zoneId) {
            this.messages.error('Zone non définie');
            return;
        }

        const controller = new AbortController();
        this.importAbortController = controller;
        this.isImporting = true;
        this.update();

        try {
            const response = await this.geocachesService.importPocketQuery(pqCode, this.zoneId, updateExisting, controller.signal);
            const { lastMessage, hadError } = await this.consumeImportStream(response, onProgress);
            if (hadError) {
                await this.refreshZoneData();
                return;
            }
            this.messages.info(lastMessage || 'Import terminé');

            this.showPocketQueryDialog = false;
            await this.refreshZoneData();
        } catch (e) {
            if ((e as { name?: string })?.name === 'AbortError') {
                this.messages.info('Import interrompu');
                onProgress?.(0, 'Import interrompu');
                await this.refreshZoneData();
            } else {
                console.error('Import pocket query error', e);
                this.messages.error(getErrorMessage(e, 'Erreur lors de l\'import de la pocket query'));
                onProgress?.(0, 'Erreur lors de l\'import');
            }
        } finally {
            this.isImporting = false;
            this.importAbortController = undefined;
        }
    }

    /**
     * Ouvre une carte centrée sur une géocache spécifique.
     * Méthode publique utilisée par les autres extensions.
     */
    public async openGeocacheMap(geocache: {
        id: number;
        gc_code: string;
        name: string;
        latitude: number;
        longitude: number;
        cache_type?: string;
        difficulty?: number;
        terrain?: number;
        found?: boolean;
        is_corrected?: boolean;
        original_latitude?: number;
        original_longitude?: number;
        waypoints?: any[];
    }): Promise<void> {
        try {

            // Ouvrir une carte spécifique pour cette géocache
            await this.mapWidgetFactory.openMapForGeocache(
                geocache.id,
                geocache.gc_code,
                geocache
            );
        } catch (error) {
            console.error('[ZoneGeocachesWidget] Erreur lors de l\'ouverture de la carte:', error);
            this.messages.error(`Erreur lors de l'ouverture de la carte pour ${geocache.gc_code}`);
        }
    }

    protected async handleRowClick(geocache: Geocache): Promise<void> {
        try {
            // Ouvrir une carte spécifique pour cette géocache si elle a des coordonnées
            if (geocache.latitude !== null && geocache.latitude !== undefined && 
                geocache.longitude !== null && geocache.longitude !== undefined) {
                

                // Ouvrir une carte spécifique pour cette géocache
                await this.mapWidgetFactory.openMapForGeocache(
                    geocache.id,
                    geocache.gc_code,
                    this.toMapGeocache(geocache)
                );
            }

            // Ouvrir les détails de la géocache
            await this.geocacheTabsManager.openGeocacheDetails({
                geocacheId: geocache.id,
                name: geocache.name
            });
        } catch (error) {
            console.error('Failed to open GeocacheDetailsWidget:', error);
            this.messages.error('Impossible d\'ouvrir les détails de la géocache');
        }
    }

    protected render(): React.ReactNode {
        return (
            <ZoneGeocachesView
                titleLabel={String(this.title.label || 'Geocaches')}
                zoneId={this.zoneId}
                rows={this.rows}
                zones={this.zones}
                currentZoneId={this.zoneId}
                tableVisibleColumnIds={this.tableVisibleColumnIds}
                loading={this.loading}
                isImporting={this.isImporting}
                showImportDialog={this.showImportDialog}
                showBookmarkListDialog={this.showBookmarkListDialog}
                showPocketQueryDialog={this.showPocketQueryDialog}
                copySelectedDialog={this.copySelectedDialog}
                moveSelectedDialog={this.moveSelectedDialog}
                onSubmitAddGeocache={event => this.handleAddGeocacheSubmit(event)}
                onOpenImportDialog={() => this.openImportDialog()}
                onOpenBookmarkListDialog={() => this.openBookmarkListDialog()}
                onOpenPocketQueryDialog={() => this.openPocketQueryDialog()}
                onStartImportAround={() => this.startImportAroundWizard()}
                friendFinds={this.friendFinds}
                friendFindsProgress={this.friendFindsProgress}
                onAnalyzeFriendFinds={this.analyzeFriendFinds}
                showImportAroundDialog={this.importAroundDialogOpen}
                importAroundDialogInitialCenter={this.importAroundDialogInitialCenter}
                onImportAroundDialogImport={(req, onProgress) => this.handleImportAroundDialogImport(req, onProgress)}
                onCancelImportAroundDialog={() => this.closeImportAroundDialog()}
                onRowClick={geocache => this.handleRowClick(geocache)}
                onDeleteSelected={ids => this.handleDeleteSelected(ids)}
                onRefreshSelected={ids => this.handleRefreshSelected(ids)}
                onLogSelected={ids => this.openLogEditorForSelected(ids)}
                onCopySelected={ids => this.handleCopySelected(ids)}
                onMoveSelected={ids => this.handleMoveSelected(ids)}
                onApplyPluginSelected={ids => this.handleApplyPluginSelected(ids)}
                onExportGpxSelected={ids => this.handleExportGpxSelected(ids)}
                onDelete={geocache => this.handleDelete(geocache.id, geocache.gc_code)}
                onRefresh={id => this.handleRefresh(id)}
                onMove={(geocache, targetZoneId) => this.handleMove(geocache, targetZoneId)}
                onCopy={(geocache, targetZoneId) => this.handleCopy(geocache, targetZoneId)}
                onImportAround={geocache => this.startImportAroundWizard({
                    type: 'geocache_id',
                    geocache_id: geocache.id,
                    gc_code: geocache.gc_code,
                    name: geocache.name,
                })}

                onTableVisibleColumnIdsChange={this.handleTableVisibleColumnIdsChange}
                onFilteredDataChange={geocaches => this.handleFilteredDataChange(geocaches)}
                onSelectionChange={geocacheIds => this.handleSelectionChange(geocacheIds)}
                selectedGeocacheIds={this.selectedGeocacheIds}
                onImportGpx={(file, updateExisting, onProgress) => this.handleImportGpx(file, updateExisting, onProgress)}
                onImportBookmarkList={(bookmarkCode, updateExisting, onProgress) => this.handleImportBookmarkList(bookmarkCode, updateExisting, onProgress)}
                onImportPocketQuery={(pqCode, updateExisting, onProgress) => this.handleImportPocketQuery(pqCode, updateExisting, onProgress)}
                onCancelImportDialog={() => this.closeImportDialog()}
                onCancelBookmarkListDialog={() => this.closeBookmarkListDialog()}
                onCancelPocketQueryDialog={() => this.closePocketQueryDialog()}
                onCancelImport={() => this.cancelImport()}
                onConfirmCopySelected={targetZoneId => this.performCopySelected(this.copySelectedDialog!.geocacheIds, targetZoneId)}
                onCancelCopySelected={() => this.closeCopySelectedDialog()}
                onConfirmMoveSelected={targetZoneId => this.performMoveSelected(this.moveSelectedDialog!.geocacheIds, targetZoneId)}
                onCancelMoveSelected={() => this.closeMoveSelectedDialog()}
            />
        );
    }
}
