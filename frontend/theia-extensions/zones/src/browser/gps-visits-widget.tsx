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
import { ZoneDto, ZonesService } from './zones-service';
import { consumeImportStream } from './import-stream';
import { GpsVisitsService } from './gps-visits-service';
import {
    DetectedVisitsFile,
    GPS_STATUS_LABELS,
    GpsImportLandmarks,
    GpsImportReport,
    GpsPreparedDay,
    GpsResolutionCandidate,
    GpsResolutionResult,
    GpsVisitDay,
    GpsVisitEntry,
    GpsVisitsListing,
    buildCutoffLandmarks,
    buildLogEditorOpening,
    describeCacheKnowledge,
    describeCandidateDay,
    describeImportReport,
    describeNeighbours,
    formatDistance,
    describePasses,
    formatDayLabel,
    formatFullDay,
    pendingEntries,
    statusLabel,
    summarizeDay,
    visitIdsOf,
} from './gps-visits-model';

type BusyAction = 'detect' | 'import' | 'cutoff' | 'state' | 'prepare' | 'resolve';

/** Panneau « Rattacher » d'une visite sans code. */
interface ResolveState {
    entry: GpsVisitEntry;
    loading: 'quick' | 'deep' | undefined;
    result: GpsResolutionResult | undefined;
    error: string | undefined;
    manualCode: string;
}

/** Panneau « Préparer les logs » : choix de la zone qui reçoit les caches manquantes, puis import. */
interface PrepareState {
    prepared: GpsPreparedDay;
    zones: ZoneDto[];
    /** Zone existante, ou 'new' pour en créer une. */
    zoneChoice: number | 'new';
    newZoneName: string;
    importing: boolean;
    progress: number;
    message: string;
    errors: string[];
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
    protected detectedFiles: DetectedVisitsFile[] = [];
    /** Panneau du point de départ (premier import, ou changement demandé). */
    protected cutoffPrompt: GpsImportLandmarks | undefined;
    protected cutoffChoice = '';
    protected showAllStates = false;
    protected collapsedDays = new Set<string>();
    protected dragOver = false;
    protected fileInput: HTMLInputElement | null = null;
    protected prepareState: PrepareState | undefined;
    protected resolveState: ResolveState | undefined;

    constructor(
        @inject(MessageService) protected readonly messages: MessageService,
        @inject(GpsVisitsService) protected readonly service: GpsVisitsService,
        @inject(GeocacheTabsManager) protected readonly geocacheTabsManager: GeocacheTabsManager,
        @inject(GeocacheLogEditorTabsManager) protected readonly logEditorTabsManager: GeocacheLogEditorTabsManager,
        @inject(ZonesService) protected readonly zonesService: ZonesService,
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
        this.toDispose.push(Disposable.create(() => {
            window.removeEventListener('geoapp-geocache-log-submitted', onLogSubmitted);
            window.clearTimeout(this.reloadTimer);
        }));
    }

    protected reloadTimer: number | undefined;

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
        } catch (e) {
            this.error = e instanceof Error ? e.message : String(e);
        } finally {
            this.loading = false;
            this.update();
        }
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
            this.messages.error(e instanceof Error ? e.message : String(e));
            return undefined;
        } finally {
            this.busy = undefined;
            this.update();
        }
    }

    protected detectGps = async (): Promise<void> => {
        const files = await this.runBusy('detect', () => this.service.detect());
        if (!files) {
            return;
        }
        this.detectedFiles = [];
        if (files.length === 0) {
            this.statusLine = 'Aucun GPS détecté. Si ton GPS n\'apparaît pas comme une clé USB, '
                + 'copie Garmin\\geocache_visits.txt et dépose‑le ici.';
            this.update();
            return;
        }
        if (files.length > 1) {
            this.detectedFiles = files;
            this.statusLine = `${files.length} GPS détectés : choisis celui à importer.`;
            this.update();
            return;
        }
        await this.importPath(files[0].path);
    };

    protected importPath = async (path: string): Promise<void> => {
        this.detectedFiles = [];
        const report = await this.runBusy('import', () => this.service.importPath(path));
        if (report) {
            await this.handleImportReport(report);
        }
    };

    protected importFile = async (file: File): Promise<void> => {
        const report = await this.runBusy('import', () => this.service.importFile(file));
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
        }
    };

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
    }

    protected openGeocache(entry: GpsVisitEntry): void {
        const known = entry.geocaches[0];
        if (!known) {
            return;
        }
        void this.geocacheTabsManager.openGeocacheDetails({ geocacheId: known.id, name: known.name })
            .catch(e => console.error('[GpsVisits] openGeocacheDetails failed:', e));
    }

    /* ------------------------------------------------------------- préparation */

    protected prepareDay = async (day: string): Promise<void> => {
        const prepared = await this.runBusy('prepare', () => this.service.prepare(day));
        if (!prepared) {
            return;
        }
        const withoutCode = prepared.without_code.length;
        if (withoutCode > 0) {
            this.messages.info(withoutCode === 1
                ? 'Une visite sans code n\'est pas incluse : rattache-la d\'abord à une cache.'
                : `${withoutCode} visites sans code ne sont pas incluses : rattache-les d'abord à une cache.`);
        }
        if (prepared.missing_codes.length === 0) {
            await this.openLogEditor(prepared);
            return;
        }
        let zones: ZoneDto[];
        try {
            zones = await this.zonesService.list();
        } catch (e) {
            this.messages.error(e instanceof Error ? e.message : String(e));
            return;
        }
        const lastZone = prepared.last_zone_id;
        this.prepareState = {
            prepared,
            zones,
            zoneChoice: lastZone !== null && zones.some(z => z.id === lastZone) ? lastZone : 'new',
            newZoneName: `Sortie du ${formatFullDay(prepared.day)}`,
            importing: false,
            progress: 0,
            message: '',
            errors: [],
        };
        this.update();
    };

    protected importMissingAndOpen = async (): Promise<void> => {
        const state = this.prepareState;
        if (!state || state.importing) {
            return;
        }
        let zoneId: number;
        if (state.zoneChoice === 'new') {
            const name = state.newZoneName.trim();
            if (!name) {
                this.messages.warn('Donne un nom à la nouvelle zone.');
                return;
            }
            state.importing = true;
            this.update();
            try {
                zoneId = (await this.zonesService.create({ name })).id;
            } catch (e) {
                state.importing = false;
                this.messages.error(e instanceof Error ? e.message : String(e));
                this.update();
                return;
            }
        } else {
            zoneId = state.zoneChoice;
        }
        state.importing = true;
        state.errors = [];
        this.update();
        try {
            const response = await this.service.importMissing(zoneId, state.prepared.missing_codes);
            const result = await consumeImportStream(response, (progress, message, extra) => {
                state.progress = progress;
                state.message = message;
                if (extra?.errorItem) {
                    state.errors = [...state.errors, extra.errorItem];
                }
                this.update();
            }, message => this.messages.error(message));
            if (result.hadError) {
                return;
            }
            const again = await this.service.prepare(state.prepared.day, zoneId);
            if (state.errors.length > 0) {
                this.messages.warn(`${state.errors.length} cache(s) n'ont pas pu être importées : elles ne sont pas dans l'onglet de log.`);
            }
            this.prepareState = undefined;
            await this.openLogEditor(again);
            await this.reload();
        } catch (e) {
            this.messages.error(e instanceof Error ? e.message : String(e));
        } finally {
            state.importing = false;
            this.update();
        }
    };

    protected async openLogEditor(prepared: GpsPreparedDay): Promise<void> {
        const opening = buildLogEditorOpening(prepared);
        if (opening.geocacheIds.length === 0) {
            this.messages.warn('Aucune cache à loguer pour ce jour.');
            return;
        }
        await this.logEditorTabsManager.openLogEditor(opening);
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
        e.preventDefault();
        if (!this.dragOver) {
            this.dragOver = true;
            this.update();
        }
    };

    protected onDragLeave = (): void => {
        this.dragOver = false;
        this.update();
    };

    protected onDrop = (e: React.DragEvent): void => {
        e.preventDefault();
        this.dragOver = false;
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) {
            void this.importFile(file);
        } else {
            this.update();
        }
    };

    protected onFileChosen = (e: React.ChangeEvent<HTMLInputElement>): void => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (file) {
            void this.importFile(file);
        }
    };

    /* ------------------------------------------------------------------ rendu */

    protected render(): React.ReactNode {
        return (
            <div className='geoapp-gps-visits'>
                {this.renderHeader()}
                {this.cutoffPrompt && this.renderCutoffPrompt(this.cutoffPrompt)}
                {this.prepareState && this.renderPreparePanel(this.prepareState)}
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
                className={`geoapp-gps-visits__header${this.dragOver ? ' is-drag-over' : ''}`}
                onDragOver={this.onDragOver}
                onDragLeave={this.onDragLeave}
                onDrop={this.onDrop}
            >
                <div className='geoapp-gps-visits__actions'>
                    <button className='theia-button' disabled={busy} onClick={() => { void this.detectGps(); }}
                        title='Cherche Garmin\geocache_visits.txt sur les lecteurs branchés'>
                        {this.busy === 'detect' || this.busy === 'import' ? '⏳ Lecture…' : '📟 Détecter le GPS'}
                    </button>
                    <button className='theia-button secondary' disabled={busy} onClick={() => this.fileInput?.click()}>
                        Choisir le fichier…
                    </button>
                    <input
                        ref={el => { this.fileInput = el; }}
                        type='file'
                        accept='.txt'
                        style={{ display: 'none' }}
                        onChange={this.onFileChosen}
                    />
                </div>
                <div className='geoapp-gps-visits__drop-hint'>
                    ou dépose ici le fichier <code>geocache_visits.txt</code>
                </div>
                {this.detectedFiles.length > 0 && (
                    <div className='geoapp-gps-visits__detected'>
                        {this.detectedFiles.map(file => (
                            <button key={file.path} className='theia-button secondary' disabled={busy}
                                onClick={() => { void this.importPath(file.path); }}>
                                {file.path}
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

    protected renderPreparePanel(state: PrepareState): React.ReactNode {
        const codes = state.prepared.missing_codes;
        const plural = codes.length > 1;
        return (
            <div className='geoapp-gps-visits__cutoff'>
                <div className='geoapp-gps-visits__cutoff-title'>
                    Préparer les logs du {formatDayLabel(state.prepared.day)}
                </div>
                <div className='geoapp-gps-visits__cutoff-help'>
                    {plural
                        ? `${codes.length} caches ne sont pas encore dans l'App (${codes.join(', ')}). Dans quelle zone les importer ?`
                        : `La cache ${codes[0]} n'est pas encore dans l'App. Dans quelle zone l'importer ?`}
                    {' '}Les caches déjà connues restent dans leur zone.
                </div>
                <label className='geoapp-gps-visits__cutoff-option'>
                    Zone :
                    <select
                        className='theia-select'
                        value={String(state.zoneChoice)}
                        disabled={state.importing}
                        onChange={e => {
                            state.zoneChoice = e.target.value === 'new' ? 'new' : Number(e.target.value);
                            this.update();
                        }}
                    >
                        <option value='new'>Nouvelle zone…</option>
                        {state.zones.map(zone => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
                    </select>
                    {state.zoneChoice === 'new' && (
                        <input
                            className='theia-input'
                            value={state.newZoneName}
                            disabled={state.importing}
                            onChange={e => { state.newZoneName = e.target.value; this.update(); }}
                        />
                    )}
                </label>
                {state.importing && (
                    <div className='geoapp-gps-visits__progress'>
                        <progress max={100} value={state.progress} /> {state.message}
                    </div>
                )}
                {state.errors.length > 0 && (
                    <ul className='geoapp-gps-visits__errors'>
                        {state.errors.map(error => <li key={error}>{error}</li>)}
                    </ul>
                )}
                <div className='geoapp-gps-visits__actions'>
                    <button className='theia-button' disabled={state.importing} onClick={() => { void this.importMissingAndOpen(); }}>
                        Importer et ouvrir l'éditeur de logs
                    </button>
                    <button className='theia-button secondary' disabled={state.importing}
                        onClick={() => { this.prepareState = undefined; this.update(); }}>
                        Annuler
                    </button>
                </div>
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
        return (
            <section key={day.day} className='geoapp-gps-visits__day'>
                <div className='geoapp-gps-visits__day-header'>
                    <button className='geoapp-gps-visits__day-toggle' onClick={() => this.toggleDay(day.day)}
                        aria-expanded={!collapsed}>
                        <span className={`codicon codicon-chevron-${collapsed ? 'right' : 'down'}`} />
                        <span className='geoapp-gps-visits__day-label'>{formatDayLabel(day.day)}</span>
                        <span className='geoapp-gps-visits__day-summary'>{summarizeDay(day)}</span>
                    </button>
                    <div className='geoapp-gps-visits__day-actions'>
                        {pending.length > 0 && (
                            <button className='theia-button' disabled={this.busy !== undefined || this.prepareState !== undefined}
                                title={'Importe les caches manquantes puis ouvre l\'éditeur de logs pré-rempli'}
                                onClick={() => { void this.prepareDay(day.day); }}>
                                {this.busy === 'prepare' ? '⏳' : '✍️'} Préparer les logs
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
            <div key={entry.key} className={`geoapp-gps-visits__entry is-${entry.state}${entry.gc_code ? '' : ' is-without-code'}`}>
                <span className='geoapp-gps-visits__time'>{entry.time}</span>
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
