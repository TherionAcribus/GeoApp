/**
 * Widget « Visites GPS » : les visites lues dans le `geocache_visits.txt` d'un GPS
 * Garmin, groupées par jour, pour loguer une sortie sans tout ressaisir.
 *
 * - En‑tête : « Détecter le GPS » (le backend parcourt les lecteurs branchés),
 *   ou dépôt du fichier pour les GPS sans lettre de lecteur (MTP).
 * - Premier import : choix du point de départ, les visites plus anciennes
 *   restent en historique.
 * - Liste : un jour par bloc, une ligne par cache (plusieurs passages réduits).
 * - « Préparer les logs » : importe les caches manquantes dans la zone choisie,
 *   puis ouvre l'éditeur de logs pré-rempli (ordre de visite, date, types, aide-mémoire).
 *
 * Voir documentation/garmin-visites-technique.md.
 */

import * as React from '@theia/core/shared/react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Disposable, MessageService } from '@theia/core';
import '../../src/browser/style/gps-visits-widget.css';
import { GeocacheTabsManager } from './geocache-tabs-manager';
import { GeocacheLogEditorTabsManager } from './geocache-log-editor-tabs-manager';
import { ZonesService } from './zones-service';
import { consumeImportStream } from './import-stream';
import { GpsVisitsService } from './gps-visits-service';
import { MapWidgetFactory } from './map/map-widget-factory';
import { ListSelectionRequest, MapService } from './map/map-service';
import { MapWidget } from './map/map-widget';
import { BackendApiError } from './backend-api-client';
import { OutingPreparationPanel, OutingPreparationState, OutingRunState } from './gps-outing-preparation';
import {
    DetectedDevice,
    GPS_STATUS_LABELS,
    GpsImportLandmarks,
    GpsImportReport,
    GpsPreparation,
    GpsResolutionCandidate,
    GpsResolutionResult,
    GpsVisitDay,
    GpsVisitEntry,
    GpsVisitsListing,
    buildCutoffLandmarks,
    GpsMapPoint,
    buildLogEditorOpenings,
    buildMapPoints,
    mapDays,
    daySelectionState,
    defaultOutingZoneName,
    describeCacheKnowledge,
    describeCandidateDay,
    describeImportReport,
    describeNeighbours,
    formatDistance,
    describePasses,
    formatDayLabel,
    isSelectable,
    pendingEntries,
    statusLabel,
    summarizeDay,
    visitIdsOf,
} from './gps-visits-model';

type BusyAction = 'detect' | 'import' | 'cutoff' | 'state' | 'prepare' | 'resolve';

/** Intervalle de la détection au branchement, quand le widget est visible. */
const GPS_WATCH_INTERVAL_MS = 10_000;

/** Panneau « Rattacher » d'une visite sans code. */
interface ResolveState {
    entry: GpsVisitEntry;
    loading: 'quick' | 'deep' | undefined;
    result: GpsResolutionResult | undefined;
    error: string | undefined;
    manualCode: string;
}

/** Identifiant d'un ajout à une zone, fourni au backend (journal et annulation). */
function newOperationId(): string {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

@injectable()
export class GpsVisitsWidget extends ReactWidget {
    static readonly ID = 'geoapp-gps-visits-widget';

    protected listing: GpsVisitsListing | undefined;
    protected loading = false;
    protected error: string | undefined;
    protected busy: BusyAction | undefined;
    /** Bilan du dernier import ou de la dernière détection. */
    protected statusLine: string | undefined;
    /** Plusieurs GPS branchés : l'utilisateur choisit. */
    protected detectedDevices: DetectedDevice[] = [];
    /** Panneau du point de départ (premier import, ou changement demandé). */
    protected cutoffPrompt: GpsImportLandmarks | undefined;
    protected cutoffChoice = '';
    protected showAllStates = false;
    protected collapsedDays = new Set<string>();
    protected dragOver = false;
    protected fileInput: HTMLInputElement | null = null;
    /** Panneau « Préparer la sortie ». */
    protected preparation: OutingPreparationState | undefined;
    /** Lignes cochées (clé d'entrée), éventuellement sur plusieurs jours. */
    protected selection = new Set<string>();
    /** Points affichés sur la carte des visites GPS (id = première visite de l'entrée). */
    protected mapPoints: GpsMapPoint[] = [];
    /** Tracés déjà chargés, par jour. */
    protected trackCache = new Map<string, Array<[number, number]>>();
    protected resolveState: ResolveState | undefined;

    constructor(
        @inject(MessageService) protected readonly messages: MessageService,
        @inject(GpsVisitsService) protected readonly service: GpsVisitsService,
        @inject(GeocacheTabsManager) protected readonly geocacheTabsManager: GeocacheTabsManager,
        @inject(GeocacheLogEditorTabsManager) protected readonly logEditorTabsManager: GeocacheLogEditorTabsManager,
        @inject(ZonesService) protected readonly zonesService: ZonesService,
        @inject(MapWidgetFactory) protected readonly mapWidgetFactory: MapWidgetFactory,
        @inject(MapService) protected readonly mapService: MapService,
    ) {
        super();
        this.id = GpsVisitsWidget.ID;
        this.title.label = 'Visites GPS';
        this.title.caption = 'Visites GPS Garmin (geocache_visits.txt)';
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-device-mobile';
        this.addClass('geoapp-gps-visits-widget');
        this.node.tabIndex = 0;
    }

    @postConstruct()
    initialize(): void {
        void this.reload();
        // Un log envoyé depuis l'éditeur fait passer les visites du jour en « loguée »
        // côté backend : on recharge, une fois le lot calmé.
        const onLogSubmitted = (): void => this.scheduleReload();
        window.addEventListener('geoapp-geocache-log-submitted', onLogSubmitted);
        // Ctrl+clic et menu contextuel de la carte des visites : ils cochent dans cette liste.
        this.toDispose.push(this.mapService.onDidRequestListSelection(request => this.handleMapSelectionRequest(request)));
        this.toDispose.push(Disposable.create(() => {
            window.removeEventListener('geoapp-geocache-log-submitted', onLogSubmitted);
            window.clearTimeout(this.reloadTimer);
        }));
    }

    protected reloadTimer: number | undefined;

    /* --------------------------------------------- détection au branchement */

    /** Fichiers vus au dernier passage : `undefined` tant que le premier passage n'a pas eu lieu. */
    protected knownGpsPaths: Set<string> | undefined;
    protected detectTimer: number | undefined;

    protected onAfterShow(msg: any): void {
        super.onAfterShow(msg);
        this.startGpsWatch();
    }

    protected onAfterHide(msg: any): void {
        super.onAfterHide(msg);
        this.stopGpsWatch();
    }

    protected onBeforeDetach(msg: any): void {
        this.stopGpsWatch();
        super.onBeforeDetach(msg);
    }

    /**
     * Interroge `detect` toutes les 10 s tant que le widget est visible. Le premier
     * passage sert de référence : un GPS déjà branché à l'ouverture ne déclenche rien
     * (« Détecter le GPS » est là pour ça). Seule une apparition propose l'import.
     */
    protected startGpsWatch(): void {
        if (this.detectTimer !== undefined) {
            return;
        }
        void this.checkForNewGps();
        this.detectTimer = window.setInterval(() => { void this.checkForNewGps(); }, GPS_WATCH_INTERVAL_MS);
    }

    protected stopGpsWatch(): void {
        if (this.detectTimer !== undefined) {
            window.clearInterval(this.detectTimer);
            this.detectTimer = undefined;
        }
        this.knownGpsPaths = undefined;
    }

    protected async checkForNewGps(): Promise<void> {
        if (this.busy) {
            return;
        }
        let devices: DetectedDevice[];
        try {
            devices = await this.service.detect();
        } catch {
            return;
        }
        const roots = new Set(devices.map(d => d.root));
        const previous = this.knownGpsPaths;
        this.knownGpsPaths = roots;
        if (!previous) {
            return;
        }
        const appeared = devices.filter(d => !previous.has(d.root));
        if (appeared.length === 0) {
            return;
        }
        const action = await this.messages.info(`GPS détecté : ${appeared[0].root}`, 'Importer les visites');
        if (action === 'Importer les visites') {
            await this.importDevice(appeared[0].root);
        }
    }

    protected scheduleReload(): void {
        window.clearTimeout(this.reloadTimer);
        this.reloadTimer = window.setTimeout(() => { void this.reload(); }, 1000);
    }

    protected onActivateRequest(msg: any): void {
        super.onActivateRequest(msg);
        this.node.focus();
    }

    /* ------------------------------------------------------------------ données */

    async reload(): Promise<void> {
        this.loading = true;
        this.error = undefined;
        this.update();
        try {
            this.listing = await this.service.list(this.showAllStates ? ['pending', 'logged', 'ignored'] : ['pending']);
            this.pruneSelection();
            void this.refreshMap(false);
        } catch (e) {
            this.error = this.describeError(e);
        } finally {
            this.loading = false;
            this.update();
        }
    }

    /** Une route inconnue (404 sans JSON) signifie un backend lancé avant la mise à jour. */
    protected describeError(e: unknown): string {
        if (e instanceof BackendApiError && e.status === 404 && /HTTP 404/.test(e.message)) {
            return 'Le backend en cours d\'exécution ne connaît pas encore les visites GPS : '
                + 'redémarre-le (backend/app.py), puis recharge cette vue.';
        }
        return e instanceof Error ? e.message : String(e);
    }

    protected async runBusy<T>(action: BusyAction, task: () => Promise<T>): Promise<T | undefined> {
        if (this.busy) {
            return undefined;
        }
        this.busy = action;
        this.update();
        try {
            return await task();
        } catch (e) {
            this.messages.error(this.describeError(e));
            return undefined;
        } finally {
            this.busy = undefined;
            this.update();
        }
    }

    protected detectGps = async (): Promise<void> => {
        const devices = await this.runBusy('detect', () => this.service.detect());
        if (!devices) {
            return;
        }
        this.detectedDevices = [];
        if (devices.length === 0) {
            this.statusLine = "Aucun GPS détecté. Si ton GPS n'apparaît pas comme une clé USB, copie son dossier "
                + 'Garmin (geocache_logs.xml, et si possible GPX\\Archive) et dépose les fichiers ici.';
            this.update();
            return;
        }
        if (devices.length > 1) {
            this.detectedDevices = devices;
            this.statusLine = `${devices.length} GPS détectés : choisis celui à importer.`;
            this.update();
            return;
        }
        await this.importDevice(devices[0].root);
    };

    /** Tout le GPS : visites, caches des GPX, positions sur les traces (la lecture des GPX peut prendre ~30 s la 1re fois). */
    protected importDevice = async (root: string): Promise<void> => {
        this.detectedDevices = [];
        this.statusLine = 'Lecture du GPS… (la première lecture des GPX peut prendre une trentaine de secondes)';
        this.update();
        const report = await this.runBusy('import', () => this.service.importDevice(root));
        if (report) {
            await this.handleImportReport(report);
        }
    };

    protected importFiles = async (files: File[]): Promise<void> => {
        if (files.length === 0) {
            return;
        }
        const report = await this.runBusy('import', () => this.service.importFiles(files));
        if (report) {
            await this.handleImportReport(report);
        }
    };

    protected async handleImportReport(report: GpsImportReport): Promise<void> {
        this.statusLine = describeImportReport(report);
        if (report.needs_cutoff && report.landmarks) {
            this.cutoffPrompt = report.landmarks;
            this.cutoffChoice = report.landmarks.last_visit_day;
        }
        await this.reload();
    }

    protected openCutoffPrompt = (): void => {
        const lastDay = this.listing?.last_import?.last_visit_day;
        if (!lastDay) {
            this.messages.info('Importe d\'abord le fichier du GPS.');
            return;
        }
        this.cutoffPrompt = buildCutoffLandmarks(lastDay);
        this.cutoffChoice = this.listing?.cutoff || lastDay;
        this.update();
    };

    protected applyCutoff = async (): Promise<void> => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(this.cutoffChoice)) {
            this.messages.warn('Choisis une date de départ.');
            return;
        }
        const result = await this.runBusy('cutoff', () => this.service.setCutoff(this.cutoffChoice));
        if (result) {
            this.cutoffPrompt = undefined;
            await this.reload();
            // Le positionnement attendait le point de départ (sinon 14 ans de traces à lire).
            await this.positionPending(true);
        }
    };

    /** Positionne sur les traces du GPS les visites à loguer qui ne le sont pas encore. */
    protected async positionPending(quiet: boolean): Promise<void> {
        try {
            const result = await this.service.position();
            if (result.positioned > 0) {
                this.statusLine = `${result.positioned} visite(s) positionnée(s) sur la trace du GPS.`;
                await this.reload();
            }
        } catch (e) {
            if (!quiet) {
                this.messages.warn(this.describeError(e));
            }
        }
    }

    protected setEntriesState = async (entries: GpsVisitEntry[], state: 'pending' | 'ignored' | 'logged'): Promise<void> => {
        const ids = visitIdsOf(entries);
        if (ids.length === 0) {
            return;
        }
        const updated = await this.runBusy('state', () => this.service.setState(ids, state));
        if (updated !== undefined) {
            await this.reload();
        }
    };

    protected toggleAllStates = (): void => {
        this.showAllStates = !this.showAllStates;
        void this.reload();
    };

    protected toggleDay(day: string): void {
        if (this.collapsedDays.has(day)) {
            this.collapsedDays.delete(day);
        } else {
            this.collapsedDays.add(day);
        }
        this.update();
        void this.refreshMap(false);
    }

    protected openGeocache(entry: GpsVisitEntry): void {
        const known = entry.geocaches[0];
        if (!known) {
            return;
        }
        void this.geocacheTabsManager.openGeocacheDetails({ geocacheId: known.id, name: known.name })
            .catch(e => console.error('[GpsVisits] openGeocacheDetails failed:', e));
    }

    /* -------------------------------------------------------------- sélection */

    protected allEntries(): GpsVisitEntry[] {
        return (this.listing?.days ?? []).flatMap(day => day.entries);
    }

    protected selectedEntries(): GpsVisitEntry[] {
        return this.allEntries().filter(entry => this.selection.has(entry.key) && isSelectable(entry));
    }

    protected toggleEntry(entry: GpsVisitEntry): void {
        if (this.selection.has(entry.key)) {
            this.selection.delete(entry.key);
        } else {
            this.selection.add(entry.key);
        }
        this.selectionChanged();
    }

    protected toggleDaySelection(day: GpsVisitDay): void {
        const select = daySelectionState(day, this.selection) !== 'all';
        for (const entry of day.entries.filter(isSelectable)) {
            if (select) {
                this.selection.add(entry.key);
            } else {
                this.selection.delete(entry.key);
            }
        }
        this.selectionChanged();
    }

    protected clearSelection = (): void => {
        this.selection.clear();
        this.selectionChanged();
    };

    /** Après un rechargement : on oublie les lignes disparues (loguées, ignorées). */
    protected pruneSelection(): void {
        const keys = new Set(this.allEntries().filter(isSelectable).map(entry => entry.key));
        for (const key of [...this.selection]) {
            if (!keys.has(key)) {
                this.selection.delete(key);
            }
        }
    }

    protected selectionChanged(): void {
        this.update();
        void this.refreshMap(false);
    }

    protected ignoreSelection = async (): Promise<void> => {
        await this.setEntriesState(this.selectedEntries(), 'ignored');
        this.clearSelection();
    };

    /* ------------------------------------------------------------------ carte */

    /** Ouvre (ou recharge) la carte des visites dans le panneau des cartes. */
    protected showMap = async (): Promise<void> => {
        await this.refreshMap(true);
    };

    /**
     * Points des jours sélectionnés (ou dépliés) et leurs tracés. Sans `open`, ne fait
     * rien si la carte est fermée, et la recharge en place sinon (sans voler le focus).
     */
    protected async refreshMap(open: boolean): Promise<void> {
        const existing = this.mapWidgetFactory.findGpsVisitsMap();
        if (!open && !existing) {
            return;
        }
        const days = mapDays(this.listing?.days ?? [], this.selection, this.collapsedDays);
        const points = buildMapPoints(days);
        const dayIds = days.map(day => day.day);
        const missing = dayIds.filter(day => !this.trackCache.has(day));
        if (missing.length > 0) {
            try {
                const tracks = await this.service.tracks(missing);
                for (const day of missing) {
                    this.trackCache.set(day, tracks[day] ?? []);
                }
            } catch (e) {
                console.warn('[GpsVisits] tracés indisponibles', e);
            }
        }
        const lines = dayIds.map(day => this.trackCache.get(day) ?? []).filter(line => line.length >= 2);
        this.mapPoints = points;
        if (open) {
            const map = await this.mapWidgetFactory.openGpsVisitsMap(points, lines);
            map.setSelectedGeocaches(this.selectedPointIds());
            if (points.length === 0) {
                this.messages.info("Aucune position connue pour ces visites : importe le GPS (traces et GPX) ou prépare la sortie.");
            }
        } else if (existing) {
            existing.loadGeocaches(points);
            existing.setTrackLines(lines);
            existing.setSelectedGeocaches(this.selectedPointIds());
        }
    }

    protected selectedPointIds(): number[] {
        return this.mapPoints.filter(point => this.selection.has(point.entryKey)).map(point => point.id);
    }

    /** Ctrl+clic / menu contextuel sur la carte des visites : la sélection vit ici. */
    protected handleMapSelectionRequest(request: ListSelectionRequest): void {
        if (request.mapId !== MapWidget.GPS_VISITS_ID) {
            return;
        }
        if (request.mode === 'clear') {
            this.selection.clear();
        } else {
            const entries = new Map(this.allEntries().map(entry => [entry.key, entry]));
            for (const id of request.geocacheIds) {
                const point = this.mapPoints.find(candidate => candidate.id === id);
                const entry = point ? entries.get(point.entryKey) : undefined;
                if (!entry || !isSelectable(entry)) {
                    continue;
                }
                const selected = this.selection.has(entry.key);
                if (request.mode === 'add' || (request.mode === 'toggle' && !selected)) {
                    this.selection.add(entry.key);
                } else {
                    this.selection.delete(entry.key);
                }
            }
        }
        this.selectionChanged();
    }

    /** Centre la carte des visites sur une ligne (et l'ouvre au besoin). */
    protected async centerOnEntry(entry: GpsVisitEntry): Promise<void> {
        if (!entry.map_position) {
            this.messages.info("Position inconnue pour cette visite : ni dans l'App, ni dans les GPX, ni sur une trace du GPS.");
            return;
        }
        if (!this.mapWidgetFactory.findGpsVisitsMap() || !this.mapPoints.some(point => point.entryKey === entry.key)) {
            this.collapsedDays.delete(entry.day);
            await this.refreshMap(true);
        }
        const point = this.mapPoints.find(candidate => candidate.entryKey === entry.key);
        if (point) {
            this.mapService.selectGeocache({
                id: point.id, gc_code: point.gc_code, name: point.name, cache_type: point.cache_type,
                latitude: point.latitude, longitude: point.longitude, mapId: MapWidget.GPS_VISITS_ID,
            });
        }
    }

    /* ------------------------------------------------------------- préparation */

    /** « Préparer les logs » d'un jour : coche le jour, puis ouvre la préparation. */
    protected prepareDay = (day: GpsVisitDay): void => {
        for (const entry of day.entries.filter(isSelectable)) {
            this.selection.add(entry.key);
        }
        this.selectionChanged();
        void this.openPreparation(visitIdsOf(day.entries.filter(isSelectable)));
    };

    protected prepareSelection = (): void => {
        void this.openPreparation(visitIdsOf(this.selectedEntries()));
    };

    protected async openPreparation(visitIds: number[]): Promise<void> {
        if (visitIds.length === 0) {
            this.messages.info('Coche d\'abord les caches de la sortie.');
            return;
        }
        const state: OutingPreparationState = {
            visitIds, preparation: undefined, loading: true, zones: [], zoneChoice: 'new',
            newZoneName: '', showDetail: false, run: undefined, error: undefined,
        };
        this.preparation = state;
        this.update();
        try {
            const [zones, first] = await Promise.all([this.zonesService.list(), this.service.prepare(visitIds)]);
            state.zones = zones;
            state.newZoneName = defaultOutingZoneName(first.days);
            const suggested = first.suggested_zone_id;
            state.zoneChoice = suggested !== null && zones.some(z => z.id === suggested) ? suggested : 'new';
            state.preparation = state.zoneChoice === 'new' ? first : await this.service.prepare(visitIds, state.zoneChoice);
        } catch (e) {
            state.error = this.describeError(e);
        } finally {
            state.loading = false;
            this.update();
        }
    }

    protected changePreparationZone = async (choice: number | 'new'): Promise<void> => {
        const state = this.preparation;
        if (!state || state.run) {
            return;
        }
        state.zoneChoice = choice;
        state.loading = true;
        state.error = undefined;
        this.update();
        try {
            const preparation = await this.service.prepare(state.visitIds, choice === 'new' ? undefined : choice);
            if (this.preparation === state && state.zoneChoice === choice) {
                state.preparation = preparation;
            }
        } catch (e) {
            state.error = this.describeError(e);
        } finally {
            state.loading = false;
            this.update();
        }
    };

    protected confirmPreparation = async (): Promise<void> => {
        const state = this.preparation;
        if (!state || state.run || !state.preparation) {
            return;
        }
        const zone = state.zoneChoice === 'new'
            ? { newZoneName: state.newZoneName.trim() }
            : { zoneId: state.zoneChoice };
        const run: OutingRunState = {
            operationId: newOperationId(), progress: 0, message: 'Démarrage…', errors: [], cancelling: false,
        };
        state.run = run;
        state.error = undefined;
        this.update();
        try {
            const response = await this.service.startZoneOperation(run.operationId, zone, state.visitIds);
            const result = await consumeImportStream(response, (progress, message, extra) => {
                run.progress = progress;
                run.message = message;
                run.counts = extra?.counts as OutingRunState['counts'];
                if (extra?.errorItem) {
                    run.errors = [...run.errors, extra.errorItem];
                }
                this.update();
            }, message => { state.error = message; });
            const final = result.finalPayload as { cancelled?: boolean; message?: string; operation?: { zone_id: number } } | undefined;
            if (!final) {
                state.error = state.error ?? 'L\'ajout s\'est interrompu sans bilan : vérifie la zone, puis annule l\'ajout si besoin.';
                return;
            }
            if (final.cancelled) {
                this.messages.info(final.message ?? 'Ajout annulé.');
                this.preparation = undefined;
                await this.reload();
                return;
            }
            const zoneId = final.operation?.zone_id;
            const prepared = zoneId !== undefined ? await this.service.prepare(state.visitIds, zoneId) : undefined;
            this.preparation = undefined;
            this.clearSelection();
            if (prepared) {
                await this.openLogEditors(prepared);
            }
            await this.reload();
            void this.offerUndo(run.operationId, final.message ?? 'Caches ajoutées à la zone.', run.errors.length);
        } catch (e) {
            state.error = this.describeError(e);
        } finally {
            if (this.preparation === state) {
                state.run = undefined;
            }
            this.update();
        }
    };

    protected cancelPreparationRun = async (): Promise<void> => {
        const run = this.preparation?.run;
        if (!run || run.cancelling) {
            return;
        }
        run.cancelling = true;
        this.update();
        try {
            await this.service.cancelZoneOperation(run.operationId);
        } catch (e) {
            run.cancelling = false;
            this.messages.error(this.describeError(e));
            this.update();
        }
    };

    /** Notification de fin avec « Annuler l'ajout » : retire les caches ajoutées, tant qu'aucun log n'est parti. */
    protected async offerUndo(operationId: string, message: string, errors: number): Promise<void> {
        const undoLabel = 'Annuler l\'ajout';
        const text = errors > 0 ? `${message} ${errors} cache(s) n'ont pas pu être ajoutées.` : message;
        const action = errors > 0
            ? await this.messages.warn(text, undoLabel)
            : await this.messages.info(text, undoLabel);
        if (action !== undoLabel) {
            return;
        }
        try {
            const result = await this.service.cancelZoneOperation(operationId);
            this.messages.info(result.message ?? 'Ajout annulé.');
            await this.reload();
        } catch (e) {
            this.messages.error(this.describeError(e));
        }
    }

    protected async openLogEditors(preparation: GpsPreparation): Promise<void> {
        const openings = buildLogEditorOpenings(preparation);
        if (openings.length === 0) {
            this.messages.warn('Aucune cache à loguer dans cette sélection.');
            return;
        }
        for (const opening of openings) {
            await this.logEditorTabsManager.openLogEditor(opening);
        }
    }

    /* ------------------------------------------------------------ rattachement */

    protected openResolve = (entry: GpsVisitEntry): void => {
        this.resolveState = { entry, loading: undefined, result: undefined, error: undefined, manualCode: '' };
        void this.searchCandidates(false);
    };

    protected async searchCandidates(deep: boolean): Promise<void> {
        const state = this.resolveState;
        if (!state || state.loading) {
            return;
        }
        state.loading = deep ? 'deep' : 'quick';
        state.error = undefined;
        this.update();
        try {
            const result = await this.service.candidates(state.entry.visit_ids[0], deep);
            if (this.resolveState === state) {
                state.result = result;
            }
        } catch (e) {
            state.error = e instanceof Error ? e.message : String(e);
        } finally {
            state.loading = undefined;
            this.update();
        }
    }

    protected resolveWith = async (gcCode: string | null, source: 'neighbours' | 'my_finds' | 'manual'): Promise<void> => {
        const entry = this.resolveState?.entry;
        const visitId = entry?.visit_ids[0];
        if (visitId === undefined) {
            return;
        }
        const done = await this.runBusy('resolve', async () => {
            await this.service.resolve(visitId, gcCode, source);
            return true;
        });
        if (done) {
            this.resolveState = undefined;
            await this.reload();
        }
    };

    protected detach = async (entry: GpsVisitEntry): Promise<void> => {
        const done = await this.runBusy('resolve', async () => {
            await this.service.resolve(entry.visit_ids[0], null);
            return true;
        });
        if (done) {
            await this.reload();
        }
    };

    /* ------------------------------------------------------------------ dépôt */

    protected onDragOver = (e: React.DragEvent): void => {
        // Sans ça, Theia ouvre le fichier déposé dans un éditeur.
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        if (!this.dragOver) {
            this.dragOver = true;
            this.update();
        }
    };

    protected onDragLeave = (e: React.DragEvent): void => {
        // Quitter un enfant déclenche aussi `dragleave` : on ignore tant qu'on reste dans le widget.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) {
            return;
        }
        this.dragOver = false;
        this.update();
    };

    protected onDrop = (e: React.DragEvent): void => {
        e.preventDefault();
        e.stopPropagation();
        this.dragOver = false;
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length > 0) {
            void this.importFiles(files);
        } else {
            this.update();
        }
    };

    protected onFileChosen = (e: React.ChangeEvent<HTMLInputElement>): void => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = '';
        void this.importFiles(files);
    };

    /* ------------------------------------------------------------------ rendu */

    protected render(): React.ReactNode {
        return (
            <div
                className={`geoapp-gps-visits${this.dragOver ? ' is-drag-over' : ''}`}
                onDragEnter={this.onDragOver}
                onDragOver={this.onDragOver}
                onDragLeave={this.onDragLeave}
                onDrop={this.onDrop}
            >
                {this.renderHeader()}
                {this.cutoffPrompt && this.renderCutoffPrompt(this.cutoffPrompt)}
                {this.renderSelectionBar()}
                {this.preparation && this.renderPreparationPanel(this.preparation)}
                {this.resolveState && this.renderResolvePanel(this.resolveState)}
                {this.renderBody()}
                {this.renderFooter()}
            </div>
        );
    }

    protected renderHeader(): React.ReactNode {
        const busy = this.busy !== undefined;
        return (
            <div
                className='geoapp-gps-visits__header'
            >
                <div className='geoapp-gps-visits__actions'>
                    <button className='theia-button' disabled={busy} onClick={() => { void this.detectGps(); }}
                        title='Cherche Garmin\geocache_visits.txt sur les lecteurs branchés'>
                        {this.busy === 'detect' || this.busy === 'import' ? '⏳ Lecture…' : '📟 Détecter le GPS'}
                    </button>
                    <button className='theia-button secondary' onClick={() => { void this.showMap(); }}
                        title='Ouvrir la carte des visites dans le panneau des cartes (sélection, ou jours dépliés)'>
                        🗺️ Carte
                    </button>
                    <button className='theia-button secondary' disabled={busy} onClick={() => this.fileInput?.click()}>
                        Choisir le fichier…
                    </button>
                    <input
                        ref={el => { this.fileInput = el; }}
                        type='file'
                        accept='.txt,.xml,.gpx'
                        multiple
                        style={{ display: 'none' }}
                        onChange={this.onFileChosen}
                    />
                </div>
                <div className='geoapp-gps-visits__drop-hint'>
                    ou dépose ici le fichier <code>geocache_visits.txt</code>
                </div>
                {this.detectedDevices.length > 0 && (
                    <div className='geoapp-gps-visits__detected'>
                        {this.detectedDevices.map(device => (
                            <button key={device.root} className='theia-button secondary' disabled={busy}
                                onClick={() => { void this.importDevice(device.root); }}>
                                {device.root} ({device.tracks_count} traces, {device.gpx_count} GPX)
                            </button>
                        ))}
                    </div>
                )}
                {this.statusLine && <div className='geoapp-gps-visits__status'>{this.statusLine}</div>}
            </div>
        );
    }

    protected renderCutoffPrompt(landmarks: GpsImportLandmarks): React.ReactNode {
        const options: { value: string; label: string }[] = [
            { value: landmarks.last_visit_day, label: `Dernier jour de visite (${formatDayLabel(landmarks.last_visit_day)})` },
            { value: landmarks.week_before, label: `Depuis le ${formatDayLabel(landmarks.week_before)}` },
            { value: landmarks.month_before, label: `Depuis le ${formatDayLabel(landmarks.month_before)}` },
        ];
        const isCustom = !options.some(o => o.value === this.cutoffChoice);
        return (
            <div className='geoapp-gps-visits__cutoff'>
                <div className='geoapp-gps-visits__cutoff-title'>À partir de quand veux‑tu loguer ?</div>
                <div className='geoapp-gps-visits__cutoff-help'>
                    Le GPS garde toutes ses visites depuis le premier jour. Les visites plus anciennes que
                    le point de départ sont gardées en historique, sans être proposées. Tu pourras le changer plus tard.
                </div>
                {options.map(option => (
                    <label key={option.value} className='geoapp-gps-visits__cutoff-option'>
                        <input
                            type='radio'
                            name='gps-visits-cutoff'
                            checked={this.cutoffChoice === option.value}
                            onChange={() => { this.cutoffChoice = option.value; this.update(); }}
                        />
                        {option.label}
                    </label>
                ))}
                <label className='geoapp-gps-visits__cutoff-option'>
                    <input
                        type='radio'
                        name='gps-visits-cutoff'
                        checked={isCustom}
                        onChange={() => { this.cutoffChoice = ''; this.update(); }}
                    />
                    Autre date :
                    <input
                        type='date'
                        className='theia-input'
                        value={isCustom ? this.cutoffChoice : ''}
                        onChange={e => { this.cutoffChoice = e.target.value; this.update(); }}
                    />
                </label>
                <div className='geoapp-gps-visits__actions'>
                    <button className='theia-button' disabled={this.busy !== undefined} onClick={() => { void this.applyCutoff(); }}>
                        Valider
                    </button>
                    {this.listing?.cutoff && (
                        <button className='theia-button secondary' onClick={() => { this.cutoffPrompt = undefined; this.update(); }}>
                            Annuler
                        </button>
                    )}
                </div>
            </div>
        );
    }

    protected renderPreparationPanel(state: OutingPreparationState): React.ReactNode {
        return (
            <OutingPreparationPanel
                state={state}
                onZoneChange={choice => { void this.changePreparationZone(choice); }}
                onNewZoneName={name => { state.newZoneName = name; this.update(); }}
                onToggleDetail={() => { state.showDetail = !state.showDetail; this.update(); }}
                onConfirm={() => { void this.confirmPreparation(); }}
                onCancelRun={() => { void this.cancelPreparationRun(); }}
                onClose={() => { this.preparation = undefined; this.update(); }}
            />
        );
    }

    /** Barre d'action de la sélection, visible dès qu'une cache est cochée. */
    protected renderSelectionBar(): React.ReactNode {
        const selected = this.selectedEntries();
        if (selected.length === 0) {
            return undefined;
        }
        const days = new Set(selected.map(entry => entry.day)).size;
        const busy = this.busy !== undefined || this.preparation?.run !== undefined;
        return (
            <div className='geoapp-gps-visits__selection-bar'>
                <span>
                    {selected.length} cache{selected.length > 1 ? 's' : ''} sur {days} jour{days > 1 ? 's' : ''}
                </span>
                <button className='theia-button' disabled={busy} onClick={this.prepareSelection}>✍️ Préparer les logs</button>
                <button className='theia-button secondary' disabled={busy} onClick={() => { void this.ignoreSelection(); }}>Ignorer</button>
                <button className='theia-button secondary' disabled={busy} onClick={this.clearSelection}>Vider la sélection</button>
            </div>
        );
    }

    protected renderResolvePanel(state: ResolveState): React.ReactNode {
        const { entry, result } = state;
        const busy = this.busy !== undefined;
        const manualValid = /^GC[0-9A-Z]{1,8}$/i.test(state.manualCode.trim());
        return (
            <div className='geoapp-gps-visits__cutoff'>
                <div className='geoapp-gps-visits__cutoff-title'>
                    Rattacher la visite de {entry.time} ({formatDayLabel(entry.day)}) — {entry.status_raw}
                </div>
                {state.loading === 'quick' && <div className='geoapp-gps-visits__cutoff-help'>⏳ Recherche autour des visites voisines…</div>}
                {state.loading === 'deep' && (
                    <div className='geoapp-gps-visits__cutoff-help'>
                        ⏳ Recherche dans l'ordre de tes trouvailles — environ une minute (Geocaching.com limite le rythme des recherches).
                    </div>
                )}
                {state.error && <div className='geoapp-gps-visits__errors'>{state.error}</div>}
                {result && (
                    <>
                        <div className='geoapp-gps-visits__cutoff-help'>{describeNeighbours(result)}</div>
                        {!result.authenticated && (
                            <div className='geoapp-gps-visits__cutoff-help'>Connecte-toi à Geocaching.com pour une recherche complète.</div>
                        )}
                        {result.candidates.length === 0
                            ? <div className='geoapp-gps-visits__cutoff-help'>Aucun candidat.</div>
                            : (
                                <div className='geoapp-gps-visits__candidates'>
                                    {result.candidates.map(candidate => this.renderCandidate(candidate, busy))}
                                </div>
                            )}
                        {result.finds_state === 'not_requested' && (
                            <button className='theia-button secondary' disabled={busy || state.loading !== undefined}
                                title={'Utile quand aucune voisine n\'est située : place tes trouvailles absentes du GPS par leur ordre de date'}
                                onClick={() => { void this.searchCandidates(true); }}>
                                Chercher aussi dans l'ordre de mes trouvailles (≈ 1 min)
                            </button>
                        )}
                        {result.finds_state === 'out_of_reach' && (
                            <div className='geoapp-gps-visits__cutoff-help'>
                                Ce jour est plus ancien que les ~10 000 trouvailles que Geocaching.com laisse parcourir.
                            </div>
                        )}
                    </>
                )}
                <div className='geoapp-gps-visits__cutoff-option'>
                    Code GC :
                    <input
                        className='theia-input'
                        placeholder='GC…'
                        value={state.manualCode}
                        onChange={e => { state.manualCode = e.target.value; this.update(); }}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && manualValid) {
                                void this.resolveWith(state.manualCode.trim().toUpperCase(), 'manual');
                            }
                        }}
                    />
                    <button className='theia-button' disabled={busy || !manualValid}
                        onClick={() => { void this.resolveWith(state.manualCode.trim().toUpperCase(), 'manual'); }}>
                        Rattacher
                    </button>
                </div>
                <div className='geoapp-gps-visits__cutoff-help'>
                    Les caches archivées n'apparaissent pas dans la recherche. Une Adventure Lab ne se logue pas
                    sur Geocaching.com : dans ce cas, ignore la visite.
                </div>
                <div className='geoapp-gps-visits__actions'>
                    <button className='theia-button secondary' onClick={() => { this.resolveState = undefined; this.update(); }}>
                        Fermer
                    </button>
                </div>
            </div>
        );
    }

    protected renderCandidate(candidate: GpsResolutionCandidate, busy: boolean): React.ReactNode {
        const day = describeCandidateDay(candidate);
        const distance = formatDistance(candidate.distance_m);
        const source = candidate.sources.includes('neighbours') ? 'neighbours' : 'my_finds';
        return (
            <div key={candidate.gc_code} className='geoapp-gps-visits__candidate'>
                <button className='theia-button secondary' disabled={busy}
                    onClick={() => { void this.resolveWith(candidate.gc_code, source); }}>
                    Choisir
                </button>
                <span className='geoapp-gps-visits__code'>{candidate.gc_code}</span>
                <span className='geoapp-gps-visits__name' title={candidate.name ?? undefined}>{candidate.name ?? ''}</span>
                {candidate.cache_type && <span className='geoapp-gps-visits__passes'>{candidate.cache_type}</span>}
                {distance && <span className='geoapp-gps-visits__time'>{distance}</span>}
                <span className={`geoapp-gps-visits__day-badge is-${day.kind}`}>{day.label}</span>
            </div>
        );
    }

    protected renderBody(): React.ReactNode {
        if (this.loading && !this.listing) {
            return <div className='geoapp-gps-visits__empty'>Chargement…</div>;
        }
        if (this.error) {
            return <div className='geoapp-gps-visits__empty is-error'>{this.error}</div>;
        }
        const days = this.listing?.days ?? [];
        if (days.length === 0) {
            const neverImported = !this.listing?.last_import;
            return (
                <div className='geoapp-gps-visits__empty'>
                    {neverImported
                        ? 'Branche ton GPS et clique sur « Détecter le GPS ».'
                        : 'Aucune visite à loguer. 🎉'}
                </div>
            );
        }
        return (
            <div className='geoapp-gps-visits__days'>
                {days.map(day => this.renderDay(day))}
                {this.listing?.truncated && (
                    <div className='geoapp-gps-visits__empty'>Seuls les jours les plus récents sont affichés.</div>
                )}
            </div>
        );
    }

    protected renderDay(day: GpsVisitDay): React.ReactNode {
        const collapsed = this.collapsedDays.has(day.day);
        const pending = pendingEntries(day);
        const selectable = day.entries.filter(isSelectable).length;
        const selectionState = daySelectionState(day, this.selection);
        const busy = this.busy !== undefined || this.preparation?.run !== undefined;
        return (
            <section key={day.day} className='geoapp-gps-visits__day'>
                <div className='geoapp-gps-visits__day-header'>
                    {selectable > 0 && (
                        <input
                            type='checkbox'
                            title='Cocher toutes les caches de ce jour'
                            checked={selectionState === 'all'}
                            ref={el => { if (el) { el.indeterminate = selectionState === 'some'; } }}
                            onChange={() => this.toggleDaySelection(day)}
                        />
                    )}
                    <button className='geoapp-gps-visits__day-toggle' onClick={() => this.toggleDay(day.day)}
                        aria-expanded={!collapsed}>
                        <span className={`codicon codicon-chevron-${collapsed ? 'right' : 'down'}`} />
                        <span className='geoapp-gps-visits__day-label'>{formatDayLabel(day.day)}</span>
                        <span className='geoapp-gps-visits__day-summary'>{summarizeDay(day)}</span>
                    </button>
                    {day.zone && (
                        <span className='geoapp-gps-visits__day-zone' title='Zone de la sortie de ce jour'>📁 {day.zone.name}</span>
                    )}
                    <div className='geoapp-gps-visits__day-actions'>
                        {selectable > 0 && (
                            <button className='theia-button' disabled={busy}
                                title={day.zone
                                    ? "Rouvre la préparation : changer de zone, compléter, ouvrir l'éditeur de logs"
                                    : "Choisir la zone de la sortie, y ajouter les caches, puis ouvrir l'éditeur de logs"}
                                onClick={() => this.prepareDay(day)}>
                                ✍️ {day.zone ? 'Préparer / changer la zone' : 'Préparer les logs'}
                            </button>
                        )}
                        {pending.length > 0 && (
                            <button className='theia-button secondary' disabled={this.busy !== undefined}
                                title='Ne plus proposer les visites de ce jour'
                                onClick={() => { void this.setEntriesState(pending, 'ignored'); }}>
                                Tout ignorer
                            </button>
                        )}
                    </div>
                </div>
                {!collapsed && (
                    <div className='geoapp-gps-visits__entries'>
                        {day.entries.map(entry => this.renderEntry(entry))}
                    </div>
                )}
            </section>
        );
    }

    protected renderEntry(entry: GpsVisitEntry): React.ReactNode {
        const status = GPS_STATUS_LABELS[entry.status];
        const knowledge = describeCacheKnowledge(entry);
        const passes = describePasses(entry);
        const known = entry.geocaches[0];
        return (
            <div key={entry.key} className={`geoapp-gps-visits__entry is-${entry.state}${entry.gc_code ? '' : ' is-without-code'}${this.selection.has(entry.key) ? ' is-selected' : ''}`}>
                <span className='geoapp-gps-visits__check'>
                    {isSelectable(entry) && (
                        <input type='checkbox' checked={this.selection.has(entry.key)} onChange={() => this.toggleEntry(entry)}
                            title='Cocher pour la sortie' />
                    )}
                </span>
                <span
                    className={`geoapp-gps-visits__time${entry.map_position ? ' is-locatable' : ''}`}
                    title={entry.map_position ? 'Voir sur la carte' : undefined}
                    onClick={entry.map_position ? () => { void this.centerOnEntry(entry); } : undefined}
                >
                    {entry.time}
                </span>
                {entry.position && (
                    <span className='geoapp-gps-visits__located' title="Position relevée sur la trace du GPS à l'heure de la visite">📍</span>
                )}
                <span className='geoapp-gps-visits__status' title={entry.status_raw}>
                    {status.icon} {statusLabel(entry)}
                    {entry.has_nm && entry.status !== 'needs_maintenance' && <span title='Needs Maintenance signalé sur le GPS'> ⚠️</span>}
                </span>
                <span className='geoapp-gps-visits__code'>
                    {entry.gc_code
                        ? (known
                            ? <a href='#' onClick={e => { e.preventDefault(); this.openGeocache(entry); }}>{entry.gc_code}</a>
                            : entry.gc_code)
                        : <em>{entry.raw_code ? `« ${entry.raw_code} »` : 'sans code'}</em>}
                    {entry.resolved && (
                        <span className='geoapp-gps-visits__resolved' title='Code absent du GPS, rattaché par toi'> 🔗</span>
                    )}
                </span>
                <span className='geoapp-gps-visits__name' title={entry.name ?? undefined}>{entry.name ?? ''}</span>
                <span className={`geoapp-gps-visits__knowledge is-${knowledge.kind}`} title={knowledge.tooltip}>{knowledge.label}</span>
                {passes && <span className='geoapp-gps-visits__passes' title={passes.tooltip}>{passes.label}</span>}
                {entry.comment && <span className='geoapp-gps-visits__comment' title={entry.comment}>📟 « {entry.comment} »</span>}
                <span className='geoapp-gps-visits__entry-actions'>
                    {!entry.gc_code && entry.state === 'pending' && (
                        <button className='theia-button secondary' disabled={this.busy !== undefined}
                            title='Proposer les caches que tu as pu visiter à ce moment-là'
                            onClick={() => this.openResolve(entry)}>
                            Rattacher…
                        </button>
                    )}
                    {entry.resolved && entry.state === 'pending' && (
                        <button className='theia-button secondary' disabled={this.busy !== undefined}
                            title='Annuler le rattachement : la visite redevient sans code'
                            onClick={() => { void this.detach(entry); }}>
                            Détacher
                        </button>
                    )}
                    {entry.state === 'pending' && knowledge.kind === 'logged-same-day' && (
                        <button className='theia-button secondary' disabled={this.busy !== undefined}
                            title='Geocaching.com indique une trouvaille ce jour-là : ne plus proposer cette visite'
                            onClick={() => { void this.setEntriesState([entry], 'logged'); }}>
                            Marquer comme loguée
                        </button>
                    )}
                    {entry.state === 'pending' && (
                        <button className='theia-button secondary' disabled={this.busy !== undefined}
                            onClick={() => { void this.setEntriesState([entry], 'ignored'); }}>
                            Ignorer
                        </button>
                    )}
                    {entry.state !== 'pending' && (
                        <button className='theia-button secondary' disabled={this.busy !== undefined}
                            title={entry.state === 'logged' ? 'Loguée' : 'Ignorée'}
                            onClick={() => { void this.setEntriesState([entry], 'pending'); }}>
                            Remettre à loguer
                        </button>
                    )}
                </span>
            </div>
        );
    }

    protected renderFooter(): React.ReactNode {
        const counts = this.listing?.counts ?? {};
        return (
            <div className='geoapp-gps-visits__footer'>
                <label>
                    <input type='checkbox' checked={this.showAllStates} onChange={this.toggleAllStates} />
                    Afficher aussi les visites loguées et ignorées
                    {this.showAllStates && ` (${counts.logged ?? 0} loguées, ${counts.ignored ?? 0} ignorées)`}
                </label>
                {this.listing?.last_import && (
                    <button className='theia-button secondary' onClick={this.openCutoffPrompt}
                        title={this.listing.cutoff ? `Point de départ actuel : ${formatDayLabel(this.listing.cutoff)}` : undefined}>
                        Changer le point de départ
                    </button>
                )}
            </div>
        );
    }
}
