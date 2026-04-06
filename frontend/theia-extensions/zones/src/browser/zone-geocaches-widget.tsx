import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ApplicationShell, StatefulWidget, WidgetManager, ConfirmDialog, Dialog } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core';
import { QuickInputService, QuickPickValue } from '@theia/core/lib/common/quick-pick-service';
import { ProgressService } from '@theia/core/lib/common/progress-service';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { GeocachesTable, Geocache } from './geocaches-table';
import { ImportGpxDialog } from './import-gpx-dialog';
import { ImportBookmarkListDialog } from './import-bookmark-list-dialog';
import { ImportPocketQueryDialog } from './import-pocket-query-dialog';
import { MoveGeocacheDialog } from './move-geocache-dialog';
import { MapWidgetFactory } from './map/map-widget-factory';
import { GeocacheTabsManager } from './geocache-tabs-manager';
import { GeocachesService } from './geocaches-service';
import { ZonesService } from './zones-service';
import { GeoAppWidgetEventsService } from './geoapp-widget-events-service';
import { getErrorMessage } from './backend-api-client';

interface SerializedZoneGeocachesState {
    zoneId: number;
    zoneName?: string;
    lastAccessTimestamp?: number;
}

type ImportAroundCenter =
    | { type: 'point'; lat: number; lon: number }
    | { type: 'gc_code'; gc_code: string }
    | { type: 'geocache_id'; geocache_id: number; gc_code?: string; name?: string };

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
    protected zones: Array<{ id: number; name: string }> = [];
    protected showImportDialog = false;
    protected showBookmarkListDialog = false;
    protected showPocketQueryDialog = false;
    protected isImporting = false;
    protected copySelectedDialog: { geocacheIds: number[] } | null = null;
    protected moveSelectedDialog: { geocacheIds: number[] } | null = null;

    protected interactionTimerId: number | undefined;
    private lastAccessTimestamp: number = Date.now();

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
        @inject(ZonesService) protected readonly zonesService: ZonesService,
        @inject(GeoAppWidgetEventsService) protected readonly widgetEventsService: GeoAppWidgetEventsService,
    ) {
        super();
        this.id = ZoneGeocachesWidget.ID;
        this.title.label = 'Géocaches';
        this.title.caption = 'Géocaches';
        this.title.closable = true;
        this.title.iconClass = 'fa fa-table';
        this.addClass('theia-zone-geocaches-widget');

        // Écouter les événements personnalisés pour ouvrir l'onglet
        this.setupEventListeners();

        // eslint-disable-next-line no-console
        console.log('[ZoneGeocachesWidget] constructed');
    }

    protected onAfterAttach(msg: any): void {
        super.onAfterAttach(msg);
        this.addInteractionListeners();
        this.setupMinOpenTimeTimer();
    }

    protected onBeforeDetach(msg: any): void {
        this.removeInteractionListeners();
        super.onBeforeDetach(msg);
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

    private async refreshZoneData(): Promise<void> {
        this.widgetEventsService.requestZonesRefresh();
        await this.load();
    }

    private isAlreadyExistsError(error: unknown): boolean {
        return /already exists|existe d[ée]jà/i.test(getErrorMessage(error, ''));
    }

    private async consumeImportStream(
        response: Response,
        onProgress?: (percentage: number, message: string) => void
    ): Promise<string | undefined> {
        const reader = response.body?.getReader();
        if (!reader) {
            return undefined;
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let lastMessage: string | undefined;

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
                };

                if (data.error) {
                    const message = data.message || 'Erreur lors de l\'import';
                    this.messages.error(message);
                    onProgress?.(0, message);
                    return;
                }

                if (typeof data.progress === 'number') {
                    onProgress?.(data.progress, data.message || '');
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
        return lastMessage;
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

            const res = await this.geocachesService.exportGpx(geocacheIds, filename);

            const contentDisposition = res.headers.get('Content-Disposition') || '';
            const filenameMatch = /filename\s*=\s*"?([^";]+)"?/i.exec(contentDisposition);
            const downloadName = (filenameMatch?.[1] || '').trim() || filename;

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = downloadName;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);

            this.messages.info('Export GPX généré');
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
                console.log('ZoneGeocachesWidget: Received open-zone-geocaches event', detail);
                this.handleOpenZoneGeocaches(detail.zoneId, detail.zoneName);
            }
        });

        // Écouter les événements d'ouverture de détails de géocache depuis les cartes
        window.addEventListener('geoapp-open-geocache-details', this.handleOpenGeocacheDetailsFromMap.bind(this));

        // Écouter les événements "importer autour" depuis la carte
        window.addEventListener('geoapp-import-around', ((event: any) => {
            const detail = event?.detail;
            const center = detail?.center as ImportAroundCenter | undefined;
            if (!center) {
                return;
            }
            this.startImportAroundWizard(center);
        }) as any);
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

    private async runImportAround(request: { center: ImportAroundCenter; limit: number; radius_km?: number }): Promise<void> {
        if (!this.zoneId) {
            this.messages.warn('Zone active manquante');
            return;
        }

        const controller = new AbortController();
        const progress = await this.progressService.showProgress(
            {
                text: 'Import autour…',
                options: { cancelable: true, location: 'notification' },
            },
            () => controller.abort()
        );

        try {
            progress.report({ message: 'Démarrage…', work: { done: 0, total: 100 } });
            const response = await this.geocachesService.importAround({
                zone_id: this.zoneId,
                center: request.center,
                limit: request.limit,
                ...(request.radius_km !== undefined ? { radius_km: request.radius_km } : {}),
            }, controller.signal);

            if (!response.body) {
                throw new Error('Réponse streaming non supportée');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            let buffer = '';
            let lastMessage = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }
                buffer += decoder.decode(value, { stream: true });

                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = (line || '').trim();
                    if (!trimmed) {
                        continue;
                    }
                    try {
                        const data = JSON.parse(trimmed);
                        if (data.error) {
                            const msg = data.message || 'Erreur lors de l\'import';
                            progress.report({ message: msg, work: { done: 0, total: 100 } });
                            this.messages.error(msg);
                            continue;
                        }

                        const pct = typeof data.progress === 'number' ? data.progress : undefined;
                        const msg = data.message || '';

                        if (pct !== undefined) {
                            progress.report({ message: msg, work: { done: pct, total: 100 } });
                        } else if (msg) {
                            progress.report({ message: msg });
                        }

                        if (data.final_summary) {
                            lastMessage = msg;
                        }
                    } catch (e) {
                        console.error('Error parsing import-around progress data:', e);
                    }
                }
            }

            if (lastMessage) {
                this.messages.info(lastMessage);
            } else {
                this.messages.info('Import terminé');
            }

            await this.refreshZoneData();
        } catch (e) {
            if ((e as any)?.name === 'AbortError') {
                this.messages.warn('Import annulé');
                return;
            }
            console.error('Import around error', e);
            this.messages.error('Erreur lors de l\'import autour');
        } finally {
            progress.cancel();
        }
    }

    private async startImportAroundWizard(initialCenter?: ImportAroundCenter): Promise<void> {
        const request = await this.buildImportAroundRequest(initialCenter);
        if (!request) {
            return;
        }
        await this.runImportAround(request);
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

            console.log('ZoneGeocachesWidget: Successfully opened for zone', zoneId, zoneName);
        } catch (error) {
            console.error('ZoneGeocachesWidget: Error opening widget:', error);
            this.messages.error('Erreur lors de l\'ouverture de l\'onglet géocaches');
        }
    }

    /** Configure le widget avec l'ID et le nom de la zone */
    setZone(context: { zoneId: number; zoneName?: string }): void {
        // eslint-disable-next-line no-console
        console.log('[ZoneGeocachesWidget] setZone', context);
        this.zoneId = context.zoneId;
        this.zoneName = context.zoneName;
        this.lastAccessTimestamp = Date.now();
        this.title.label = `Géocaches - ${this.zoneName ?? this.zoneId}`;
        this.update();
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
                console.log('[ZoneGeocachesWidget] Fermeture de la carte zone associée:', this.zoneId);
                existingMap.close();
            }
        }
    }

    /**
     * Réactive la carte correspondante à cette zone
     */
    private reactivateMap(): void {
        console.log('[ZoneGeocachesWidget] reactivateMap appelé, zoneId:', this.zoneId, 'zoneName:', this.zoneName);
        
        // Si on a une zone chargée, réactiver sa carte
        if (this.zoneId && this.zoneName) {
            const mapId = `geoapp-map-zone-${this.zoneId}`;
            const bottomWidgets = this.shell.getWidgets('bottom');
            console.log('[ZoneGeocachesWidget] Widgets dans bottom:', bottomWidgets.map(w => w.id));
            
            const existingMap = bottomWidgets.find(w => w.id === mapId);
            console.log('[ZoneGeocachesWidget] Carte trouvée:', !!existingMap, 'ID recherché:', mapId);
            
            if (existingMap) {
                console.log('[ZoneGeocachesWidget] Réactivation de la carte zone:', this.zoneId);
                this.shell.activateWidget(mapId);
            } else {
                console.warn('[ZoneGeocachesWidget] Carte non trouvée dans le bottom layer');
            }
        } else {
            console.warn('[ZoneGeocachesWidget] Pas de zone chargée');
        }
    }

    protected async load(): Promise<void> {
        if (!this.zoneId) { return; }
        this.loading = true;
        this.update();
        try {
            // Charger les géocaches
            this.rows = await this.zonesService.listGeocaches<Geocache>(this.zoneId);
            
            // Charger la liste des zones pour le menu contextuel
            this.zones = await this.zonesService.list<{ id: number; name: string }>();
            
            // Charger les géocaches sur la carte (avec waypoints)
            const geocachesWithCoords = this.rows.filter(gc => 
                gc.latitude !== null && 
                gc.latitude !== undefined && 
                gc.longitude !== null && 
                gc.longitude !== undefined
            );
            
            console.log('[ZoneGeocachesWidget] Géocaches avec coordonnées:', geocachesWithCoords.length, '/', this.rows.length);
            console.log('[ZoneGeocachesWidget] Première géocache:', geocachesWithCoords[0]);
            
            if (geocachesWithCoords.length > 0 && this.zoneId && this.zoneName) {
                // Préparer les données pour la carte
                const mapGeocaches = geocachesWithCoords.map(gc => ({
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
                }));
                
                console.log('[ZoneGeocachesWidget] Ouverture carte pour zone:', this.zoneId, this.zoneName);
                console.log('[ZoneGeocachesWidget] Données envoyées:', mapGeocaches.length, 'géocaches');
                
                // Ouvrir une carte spécifique à cette zone
                this.mapWidgetFactory.openMapForZone(this.zoneId, this.zoneName, mapGeocaches);
            } else {
                console.warn('[ZoneGeocachesWidget] Aucune géocache avec coordonnées trouvée ou zone non définie');
            }
            
            // eslint-disable-next-line no-console
            console.log('[ZoneGeocachesWidget] load -> rows:', this.rows.length);
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
        
        try {
            for (const id of ids) {
                await this.geocachesService.delete(id);
            }
            this.messages.info(`${ids.length} géocache(s) supprimée(s)`);
            await this.refreshZoneData();
        } catch (e) {
            console.error('Delete error', e);
            this.messages.error(getErrorMessage(e, 'Erreur lors de la suppression'));
        }
    }

    protected async handleRefreshSelected(ids: number[]): Promise<void> {
        try {
            this.messages.info(`Rafraîchissement de ${ids.length} géocache(s)...`);
            for (const id of ids) {
                await this.geocachesService.refresh(id);
            }
            this.messages.info(`${ids.length} géocache(s) rafraîchie(s)`);
            await this.load();
        } catch (e) {
            console.error('Refresh error', e);
            this.messages.error('Erreur lors du rafraîchissement');
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

        for (const geocacheId of geocacheIds) {
            try {
                // Trouver la géocache dans les données actuelles pour obtenir le gc_code
                const geocache = this.rows.find(g => g.id === geocacheId);
                if (!geocache) continue;

                await this.geocachesService.copy(geocacheId, targetZoneId);
                copiedCount++;
            } catch (e) {
                if (this.isAlreadyExistsError(e)) {
                    alreadyExistsCount++;
                    continue;
                }
                console.error(`Copy error for geocache ${geocacheId}:`, e);
                errorCount++;
            }
        }

        // Fermer la boîte de dialogue
        this.closeCopySelectedDialog();

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
     * Gère l'ouverture de détails de géocache depuis une carte (événement personnalisé)
     */
    private handleOpenGeocacheDetailsFromMap = async (event: CustomEvent): Promise<void> => {
        const { geocacheId } = event.detail;
        console.log(`[ZoneGeocachesWidget] Ouverture de carte pour géocache ${geocacheId} depuis la carte`);

        try {
            // Trouver la géocache dans la liste actuelle
            const geocache = this.rows.find(row => row.id === geocacheId);
            if (geocache) {
                // Ouvrir la carte comme si on cliquait sur la ligne du tableau
                await this.handleRowClick(geocache);
            } else {
                // Si la géocache n'est pas dans la liste actuelle, récupérer ses données et ouvrir quand même
                const geocacheData = await this.geocachesService.get<GeocacheDetailsResponse>(geocacheId);
                const tempGeocache: Geocache = {
                    id: geocacheData.id,
                    gc_code: geocacheData.gc_code,
                    name: geocacheData.name,
                    owner: geocacheData.owner ?? null,
                    description: geocacheData.description || geocacheData.description_raw,
                    hint: geocacheData.hint || geocacheData.hints,
                    cache_type: geocacheData.cache_type || geocacheData.type || '',
                    difficulty: geocacheData.difficulty,
                    terrain: geocacheData.terrain,
                    size: geocacheData.size,
                    solved: geocacheData.solved,
                    found: geocacheData.found,
                    favorites_count: geocacheData.favorites_count,
                    hidden_date: geocacheData.hidden_date || geocacheData.placed_at || null,
                    latitude: geocacheData.latitude,
                    longitude: geocacheData.longitude,
                    coordinates_raw: geocacheData.coordinates_raw,
                    is_corrected: geocacheData.is_corrected,
                    original_latitude: geocacheData.original_latitude,
                    original_longitude: geocacheData.original_longitude,
                    waypoints: geocacheData.waypoints || []
                };

                if (tempGeocache.latitude !== null && tempGeocache.latitude !== undefined &&
                    tempGeocache.longitude !== null && tempGeocache.longitude !== undefined) {
                    await this.mapWidgetFactory.openMapForGeocache(
                        geocacheId,
                        tempGeocache.gc_code,
                        {
                            id: tempGeocache.id,
                            gc_code: tempGeocache.gc_code,
                            name: tempGeocache.name,
                            cache_type: tempGeocache.cache_type,
                            latitude: tempGeocache.latitude,
                            longitude: tempGeocache.longitude,
                            difficulty: tempGeocache.difficulty,
                            terrain: tempGeocache.terrain,
                            found: tempGeocache.found,
                            is_corrected: tempGeocache.is_corrected,
                            original_latitude: tempGeocache.original_latitude,
                            original_longitude: tempGeocache.original_longitude,
                            waypoints: tempGeocache.waypoints || []
                        }
                    );
                }
            }
        } catch (error) {
            console.error('[ZoneGeocachesWidget] Erreur lors de l\'ouverture de carte depuis la carte:', error);
        }
    };

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

                console.log(`[ZoneGeocachesWidget] Opened batch executor for ${selectedGeocaches.length} geocaches`);
                
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

        for (const geocacheId of geocacheIds) {
            try {
                // Trouver la géocache dans les données actuelles pour obtenir le gc_code
                const geocache = this.rows.find(g => g.id === geocacheId);
                if (!geocache) continue;

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
        }

        // Fermer la boîte de dialogue
        this.closeMoveSelectedDialog();

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

    protected async handleImportGpx(file: File, updateExisting: boolean, onProgress?: (percentage: number, message: string) => void): Promise<void> {
        if (!this.zoneId) {
            this.messages.warn('Zone active manquante');
            return;
        }

        try {
            this.isImporting = true;
            if (onProgress) {
                onProgress(0, 'Préparation de l\'import...');
            }

            const response = await this.geocachesService.importGpx(file, this.zoneId, updateExisting);
            const lastMessage = await this.consumeImportStream(response, onProgress);
            this.messages.info(lastMessage || 'Import terminé');

            // Fermer la dialog et recharger les données
            this.showImportDialog = false;
            await this.refreshZoneData();
        } catch (e) {
            console.error('Import GPX error', e);
            this.messages.error(getErrorMessage(e, 'Erreur lors de l\'import du fichier GPX'));
            if (onProgress) {
                onProgress(0, 'Erreur lors de l\'import');
            }
        } finally {
            this.isImporting = false;
        }
    }

    protected async handleImportBookmarkList(bookmarkCode: string, onProgress?: (percentage: number, message: string) => void): Promise<void> {
        if (!this.zoneId) {
            this.messages.error('Zone non définie');
            return;
        }

        this.isImporting = true;
        this.update();

        try {
            const response = await this.geocachesService.importBookmarkList(bookmarkCode, this.zoneId);
            const lastMessage = await this.consumeImportStream(response, onProgress);
            this.messages.info(lastMessage || 'Import terminé');

            this.showBookmarkListDialog = false;
            await this.refreshZoneData();
        } catch (e) {
            console.error('Import bookmark list error', e);
            this.messages.error(getErrorMessage(e, 'Erreur lors de l\'import de la liste de favoris'));
            if (onProgress) {
                onProgress(0, 'Erreur lors de l\'import');
            }
        } finally {
            this.isImporting = false;
        }
    }

    protected async handleImportPocketQuery(pqCode: string, onProgress?: (percentage: number, message: string) => void): Promise<void> {
        if (!this.zoneId) {
            this.messages.error('Zone non définie');
            return;
        }

        this.isImporting = true;
        this.update();

        try {
            const response = await this.geocachesService.importPocketQuery(pqCode, this.zoneId);
            const lastMessage = await this.consumeImportStream(response, onProgress);
            this.messages.info(lastMessage || 'Import terminé');

            this.showPocketQueryDialog = false;
            await this.refreshZoneData();
        } catch (e) {
            console.error('Import pocket query error', e);
            this.messages.error(getErrorMessage(e, 'Erreur lors de l\'import de la pocket query'));
            if (onProgress) {
                onProgress(0, 'Erreur lors de l\'import');
            }
        } finally {
            this.isImporting = false;
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
            console.log('[ZoneGeocachesWidget] openGeocacheMap appelée pour géocache:', geocache.gc_code);
            console.log('[ZoneGeocachesWidget] Données reçues:', geocache);

            // Ouvrir une carte spécifique pour cette géocache
            console.log('[ZoneGeocachesWidget] Appel de mapWidgetFactory.openMapForGeocache');
            await this.mapWidgetFactory.openMapForGeocache(
                geocache.id,
                geocache.gc_code,
                geocache
            );
            console.log('[ZoneGeocachesWidget] mapWidgetFactory.openMapForGeocache terminé');
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
                
                // Préparer les données de la géocache
                const geocacheData = {
                    id: geocache.id,
                    gc_code: geocache.gc_code,
                    name: geocache.name,
                    cache_type: geocache.cache_type,
                    latitude: geocache.latitude,
                    longitude: geocache.longitude,
                    difficulty: geocache.difficulty,
                    terrain: geocache.terrain,
                    found: geocache.found,
                    is_corrected: geocache.is_corrected,
                    original_latitude: geocache.original_latitude,
                    original_longitude: geocache.original_longitude,
                    waypoints: geocache.waypoints || []
                };

                console.log('[ZoneGeocachesWidget] Ouverture carte pour géocache:', geocache.gc_code);
                
                // Ouvrir une carte spécifique pour cette géocache
                await this.mapWidgetFactory.openMapForGeocache(
                    geocache.id,
                    geocache.gc_code,
                    geocacheData
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
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 8 }}>
                {/* Header with import form */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <h3 style={{ margin: 0 }}>{this.title.label}</h3>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <form
                            onSubmit={async (e) => {
                                e.preventDefault();
                                try {
                                    const form = e.currentTarget as HTMLFormElement;
                                    const fd = new FormData(form);
                                    const gc = this.extractGcCode(fd.get('gc_code') as string);
                                    if (!gc) { this.messages.warn('Code GC invalide'); return; }
                                    if (!this.zoneId) { this.messages.warn('Zone active manquante'); return; }
                                    await this.geocachesService.addToZone(this.zoneId, gc);
                                    form.reset();
                                    await this.refreshZoneData();
                                    this.messages.info(`Géocache ${gc} importée`);
                                } catch (err) {
                                    console.error('Import geocache error', err);
                                    this.messages.error(getErrorMessage(err, 'Erreur lors de l\'import de la géocache'));
                                }
                            }}
                            style={{ display: 'flex', gap: 6, alignItems: 'center' }}
                        >
                            <input name='gc_code' placeholder='Code GC (ex: GC12345)' style={{ width: 180, padding: '4px 8px' }} />
                            <button type='submit' className='theia-button'>+ Importer</button>
                        </form>
                        <button
                            className='theia-button secondary'
                            onClick={() => {
                                this.showImportDialog = true;
                                this.update();
                            }}
                            style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: 4,
                                backgroundColor: 'var(--theia-button-secondaryBackground)',
                                color: 'var(--theia-button-secondaryForeground)'
                            }}
                        >
                            <span>📁</span>
                            <span>Importer GPX</span>
                        </button>
                        <button
                            className='theia-button secondary'
                            onClick={() => {
                                this.showBookmarkListDialog = true;
                                this.update();
                            }}
                            style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: 4,
                                backgroundColor: 'var(--theia-button-secondaryBackground)',
                                color: 'var(--theia-button-secondaryForeground)'
                            }}
                        >
                            <span>⭐</span>
                            <span>Importer Liste</span>
                        </button>
                        <button
                            className='theia-button secondary'
                            onClick={() => {
                                this.showPocketQueryDialog = true;
                                this.update();
                            }}
                            style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: 4,
                                backgroundColor: 'var(--theia-button-secondaryBackground)',
                                color: 'var(--theia-button-secondaryForeground)'
                            }}
                        >
                            <span>💎</span>
                            <span>Importer PQ</span>
                        </button>
                        <button
                            className='theia-button secondary'
                            onClick={() => {
                                this.startImportAroundWizard();
                            }}
                        >
                            📍 Importer autour…
                        </button>
                    </div>
                </div>

                {/* Table or loading/empty state */}
                {this.loading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
                        <span>Chargement...</span>
                    </div>
                ) : this.rows.length === 0 ? (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, opacity: 0.6 }}>
                        <div style={{ textAlign: 'center' }}>
                            <p>Aucune géocache dans cette zone</p>
                            <p style={{ fontSize: '0.9em' }}>Utilisez le formulaire ci-dessus pour importer des géocaches</p>
                        </div>
                    </div>
                ) : (
                    <GeocachesTable
                        data={this.rows}
                        onRowClick={(geocache) => this.handleRowClick(geocache)}
                        onDeleteSelected={(ids) => this.handleDeleteSelected(ids)}
                        onRefreshSelected={(ids) => this.handleRefreshSelected(ids)}
                        onLogSelected={(ids: number[]) => this.openLogEditorForSelected(ids)}
                        onCopySelected={(ids) => this.handleCopySelected(ids)}
                        onMoveSelected={(ids) => this.handleMoveSelected(ids)}
                        onApplyPluginSelected={(ids) => this.handleApplyPluginSelected(ids)}
                        onExportGpxSelected={(ids) => this.handleExportGpxSelected(ids)}
                        onDelete={(geocache) => this.handleDelete(geocache.id, geocache.gc_code)}
                        onRefresh={(id) => this.handleRefresh(id)}
                        onMove={(geocache, targetZoneId) => this.handleMove(geocache, targetZoneId)}
                        onCopy={(geocache, targetZoneId) => this.handleCopy(geocache, targetZoneId)}
                        onImportAround={(geocache: Geocache) => {
                            this.startImportAroundWizard({
                                type: 'geocache_id',
                                geocache_id: geocache.id,
                                gc_code: geocache.gc_code,
                                name: geocache.name,
                            });
                        }}
                        zones={this.zones}
                        currentZoneId={this.zoneId}
                    />
                )}

                {/* Import GPX Dialog */}
                {this.showImportDialog && this.zoneId && (
                    <ImportGpxDialog
                        zoneId={this.zoneId}
                        onImport={(file, updateExisting, onProgress) => this.handleImportGpx(file, updateExisting, onProgress)}
                        onCancel={() => {
                            this.showImportDialog = false;
                            this.update();
                        }}
                        isImporting={this.isImporting}
                    />
                )}

                {/* Import Bookmark List Dialog */}
                {this.showBookmarkListDialog && this.zoneId && (
                    <ImportBookmarkListDialog
                        zoneId={this.zoneId}
                        onImport={(bookmarkCode, onProgress) => this.handleImportBookmarkList(bookmarkCode, onProgress)}
                        onCancel={() => {
                            this.showBookmarkListDialog = false;
                            this.update();
                        }}
                        isImporting={this.isImporting}
                    />
                )}

                {/* Import Pocket Query Dialog */}
                {this.showPocketQueryDialog && this.zoneId && (
                    <ImportPocketQueryDialog
                        zoneId={this.zoneId}
                        onImport={(pqCode, onProgress) => this.handleImportPocketQuery(pqCode, onProgress)}
                        onCancel={() => {
                            this.showPocketQueryDialog = false;
                            this.update();
                        }}
                        isImporting={this.isImporting}
                    />
                )}

                {/* Copy Selected Dialog */}
                {this.copySelectedDialog && this.zoneId && (
                    <MoveGeocacheDialog
                        geocacheCount={this.copySelectedDialog.geocacheIds.length}
                        currentZoneId={this.zoneId}
                        zones={this.zones}
                        onMove={async (targetZoneId: number) => {
                            await this.performCopySelected(this.copySelectedDialog!.geocacheIds, targetZoneId);
                        }}
                        onCancel={() => this.closeCopySelectedDialog()}
                        title="Copier les géocaches vers une zone"
                        actionLabel="Copier"
                    />
                )}

                {/* Move Selected Dialog */}
                {this.moveSelectedDialog && this.zoneId && (
                    <MoveGeocacheDialog
                        geocacheCount={this.moveSelectedDialog.geocacheIds.length}
                        currentZoneId={this.zoneId}
                        zones={this.zones}
                        onMove={async (targetZoneId: number) => {
                            await this.performMoveSelected(this.moveSelectedDialog!.geocacheIds, targetZoneId);
                        }}
                        onCancel={() => this.closeMoveSelectedDialog()}
                        title="Déplacer les géocaches vers une zone"
                        actionLabel="Déplacer"
                    />
                )}
            </div>
        );
    }
}


