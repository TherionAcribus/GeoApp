/**
 * Widget « Trackables » (lot 5 de la spec) : trois onglets.
 *
 * - **Inventaire** : mon inventaire (`GET /api/trackables/inventory`), recherche,
 *   date du relevé, état périmé, « Rafraîchir », ouverture de la fiche et action
 *   rapide « Loguer » (qui préremplit l'onglet Loguer).
 * - **Loguer / Découvrir** : prévu pour le collage multi-codes, l'aperçu par
 *   lookup et la file d'envoi — arrive avec la suite du lot.
 * - **Fiche** : détails assainis du TB et logs paginés — arrive avec la suite.
 *
 * Ouverture : commande `geoapp.trackables.open` ou événement `open-trackables`
 * avec `{ tab, trackableCode, action, geocacheCode }` — la fiche de cache du
 * lot 4 préremplira l'onglet Loguer (« Retirer » / « Découvrir »).
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core';
import DOMPurify from '@theia/core/shared/dompurify';
import '../../src/browser/style/trackables-widget.css';
import { formatIsoDateTimeFr } from './log-editor/helpers';
import {
    InventoryTrackable,
    describeInventorySync,
    filterTrackables,
    geocacheUrl,
    trackableUrl,
} from './log-editor/trackables';
import {
    StoredTrackableQueueItem,
    TRACKABLE_LOG_TYPE_FALLBACK_CHOICES,
    TRACKABLE_LOG_TYPE_FALLBACK_LABELS,
    TRACKABLE_QUEUE_STORAGE_VERSION,
    TrackableQueueItem,
    buildTrackableQueueReport,
    defaultTrackableLogType,
    isLikelyPublicCode,
    parseTrackableCodeTokens,
    queueItemDisplayCode,
    restoreQueueFromStorage,
    sanitizeQueueForStorage,
    trackableLogTypeNeedsGeocache,
    trackableLogTypeNeedsTrackingCode,
    trackableQueueCounts,
} from './log-editor/trackables-log-queue';

export type TrackablesWidgetTab = 'inventory' | 'log' | 'detail';

/** Préremplissage à l'ouverture : l'onglet visé, le TB, l'action et la cache d'origine. */
export interface TrackablesWidgetContext {
    tab?: TrackablesWidgetTab;
    /** Code public TB… (ou code de suivi, transmis tel quel au backend, jamais affiché). */
    trackableCode?: string;
    /** Action du lot 4 : retirer ou découvrir le TB dans une cache. */
    action?: 'retrieve' | 'discover' | 'log';
    geocacheCode?: string;
}

const TRACKABLES_WIDGET_TABS: readonly { id: TrackablesWidgetTab; label: string }[] = [
    { id: 'inventory', label: 'Inventaire' },
    { id: 'log', label: 'Loguer / Découvrir' },
    { id: 'detail', label: 'Fiche' },
];

/** La copie locale est réinterrogée au-delà de cet âge — même politique que l'éditeur. */
const TRACKABLE_INVENTORY_MAX_AGE_SECONDS = 900;

interface InventoryState {
    loading: boolean;
    loaded: boolean;
    trackables: InventoryTrackable[];
    lastSyncAt: string | null;
    stale: boolean;
    error?: string;
    notice?: string;
}

const EMPTY_INVENTORY: InventoryState = {
    loading: false, loaded: false, trackables: [], lastSyncAt: null, stale: false,
};

/** File persistée en localStorage — `sanitizeQueueForStorage` a retiré tout code de suivi. */
const TRACKABLE_QUEUE_STORAGE_KEY = 'geoapp.trackables.queue';

/** Log de la fiche HTML — `details.logs[]` de `GET /api/trackables/<TB>`. */
interface TrackableDetailLog {
    log_reference_code?: string | null;
    log_type_id?: number | null;
    log_type_label?: string | null;
    log_date?: string | null;
    log_date_raw?: string | null;
    log_date_ambiguous?: boolean;
    author_username?: string | null;
    geocache_code?: string | null;
    geocache_name?: string | null;
    text_html?: string | null;
}

/** `details` de `GET /api/trackables/<TB>` — HTML déjà assaini au parsing (§ 4). */
interface TrackableDetailData {
    name?: string | null;
    owner_username?: string | null;
    released_at?: string | null;
    origin?: string | null;
    location_kind?: string | null;
    location_name?: string | null;
    location_geocache_code?: string | null;
    goal_html?: string | null;
    details_html?: string | null;
    image_url?: string | null;
    icon_url?: string | null;
    type_name?: string | null;
    distance_km?: number | null;
    is_locked?: boolean;
    logs?: TrackableDetailLog[];
    parse_warnings?: string[];
}

interface TrackableDetailState {
    loading: boolean;
    /** Code public du TB affiché. */
    requestedCode?: string;
    trackable?: InventoryTrackable & { goal_html?: string | null; has_tracking_code?: boolean };
    details?: TrackableDetailData;
    error?: string;
}

const EMPTY_DETAIL: TrackableDetailState = { loading: false };
/** Pagination locale des logs de la fiche. */
const DETAIL_LOGS_PER_PAGE = 10;

@injectable()
export class TrackablesWidget extends ReactWidget {
    static readonly ID = 'geoapp-trackables-widget';

    protected backendBaseUrl = 'http://localhost:8000';
    protected activeTab: TrackablesWidgetTab = 'inventory';
    protected inventory: InventoryState = { ...EMPTY_INVENTORY };
    protected inventoryFilter = '';
    /** Préremplissage des onglets à venir (lot 5.2 / 5.3 et actions du lot 4). */
    protected pendingLogContext: { code: string; action?: string; geocacheCode?: string } | undefined;
    protected pendingDetailCode: string | undefined;

    /* ---- File « Loguer / Découvrir » ---- */
    /** Collage brut du champ multi-codes — mémoire seule, jamais persisté. */
    protected queueInput = '';
    protected queue: TrackableQueueItem[] = [];
    /** Codes de suivi saisis par élément — mémoire seule : jamais en localStorage. */
    protected queueTrackingCodes: Record<string, string> = {};
    protected queueLogDate = new Date().toISOString().slice(0, 10);
    protected queueLogText = '';
    protected queueRunning = false;
    protected queuePreflighting = false;
    protected queueStopRequested = false;
    protected queueSequence = 0;

    /* ---- Onglet « Fiche » ---- */
    /** Saisie du code de fiche — mémoire seule (peut être un code de suivi). */
    protected detailInput = '';
    protected detail: TrackableDetailState = { ...EMPTY_DETAIL };
    protected detailLogPage = 0;

    constructor(
        @inject(MessageService) protected readonly messages: MessageService,
    ) {
        super();
        this.id = TrackablesWidget.ID;
        this.title.label = 'Trackables';
        this.title.caption = 'Trackables (travel bugs)';
        this.title.closable = true;
        this.title.iconClass = 'fa fa-bug';
        this.addClass('theia-trackables-widget');
    }

    @postConstruct()
    initialize(): void {
        // Reprise de la file persistée (sans codes de suivi : la saisie brute et
        // les codes entrés ne sont jamais stockés localement, cf. lot 5.2).
        try {
            const raw = window.localStorage.getItem(TRACKABLE_QUEUE_STORAGE_KEY);
            if (raw) {
                const stored = JSON.parse(raw) as {
                    version?: number;
                    logDate?: string;
                    logText?: string;
                    items?: StoredTrackableQueueItem[];
                };
                const items = restoreQueueFromStorage(stored);
                if (items.length > 0) {
                    this.queue = items.map((item, index) => ({
                        key: item.key ?? `restored-${index}`,
                        inputCode: item.reference_code ?? '',
                        reference_code: item.reference_code,
                        name: item.name,
                        owner_username: item.owner_username,
                        current_geocache_code: item.current_geocache_code,
                        has_tracking_code: item.has_tracking_code,
                        allowed_log_types: item.allowed_log_types,
                        logTypeId: item.logTypeId,
                        status: item.status,
                        statusDetail: item.statusDetail,
                        trackable_url: item.trackable_url,
                    }));
                }
                if (stored.logDate) {
                    this.queueLogDate = stored.logDate;
                }
                if (stored.logText) {
                    this.queueLogText = stored.logText;
                }
            }
        } catch (e) {
            console.warn('[TrackablesWidget] file persistée illisible, ignorée', e);
        }
        // Les éléments restaurés en attente repartent au préflight.
        if (this.queue.some(item => item.status === 'pending')) {
            void this.preflightQueue();
        }
        void this.loadInventory('auto');
    }

    /** Contexte d'ouverture : onglet + préremplissage (fiche cache du lot 4, file externe). */
    setContext(ctx: TrackablesWidgetContext): void {
        if (ctx.trackableCode && (ctx.tab === 'log' || ctx.tab === 'detail')) {
            if (ctx.tab === 'log') {
                this.pendingLogContext = { code: ctx.trackableCode, action: ctx.action, geocacheCode: ctx.geocacheCode };
                // Le code entre directement dans la file : « Retirer »/« Découvrir »
                // d'une fiche cache arrive prêt à l'aperçu.
                this.enqueueCode(ctx.trackableCode, ctx.action, ctx.geocacheCode);
            } else {
                this.pendingDetailCode = ctx.trackableCode;
                this.detailInput = ctx.trackableCode;
                if (this.detail.requestedCode !== ctx.trackableCode && !this.detail.loading) {
                    void this.loadTrackableDetail(ctx.trackableCode, false);
                }
            }
        }
        if (ctx.tab) {
            this.activeTab = ctx.tab;
        }
        if (!this.inventory.loaded && !this.inventory.loading) {
            void this.loadInventory('auto');
        }
        this.update();
    }

    /** Ajoute un code à la file s'il n'y figure pas déjà, puis lance le préflight. */
    protected enqueueCode(code: string, preferredAction?: string, geocacheCode?: string): void {
        const normalized = code.trim().toUpperCase();
        if (!normalized) {
            return;
        }
        const exists = this.queue.some(item =>
            item.inputCode.toUpperCase() === normalized || item.reference_code === normalized);
        if (!exists) {
            this.queue = [...this.queue, {
                key: `q${++this.queueSequence}-${Date.now()}`,
                inputCode: normalized,
                geocacheCode,
                status: 'pending',
                statusDetail: preferredAction === 'retrieve' ? 'Retirer (fiche cache)'
                    : preferredAction === 'discover' ? 'Découvrir (fiche cache)' : undefined,
            }];
            this.persistQueue();
        }
        if (preferredAction) {
            this.pendingLogContext = { code: normalized, action: preferredAction, geocacheCode };
        }
        void this.preflightQueue();
    }

    showTab(tab: TrackablesWidgetTab): void {
        this.activeTab = tab;
        if (tab === 'inventory' && !this.inventory.loaded && !this.inventory.loading) {
            void this.loadInventory('auto');
        }
        if (tab === 'detail' && this.pendingDetailCode
            && this.detail.requestedCode !== this.pendingDetailCode && !this.detail.loading) {
            this.detailInput = this.pendingDetailCode;
            void this.loadTrackableDetail(this.pendingDetailCode, false);
        }
        this.update();
    }

    protected async loadInventory(mode: 'auto' | 'refresh'): Promise<void> {
        if (this.inventory.loading) {
            return;
        }
        this.inventory = { ...this.inventory, loading: true, error: undefined };
        this.update();
        const query = mode === 'refresh' ? '?refresh=1' : `?max_age=${TRACKABLE_INVENTORY_MAX_AGE_SECONDS}`;
        try {
            const res = await fetch(`${this.backendBaseUrl}/api/trackables/inventory${query}`, {
                credentials: 'include',
            });
            const body = await res.json().catch(() => undefined);
            if (!res.ok || !body?.success) {
                this.inventory = {
                    ...EMPTY_INVENTORY,
                    loaded: true,
                    error: res.status === 401
                        ? 'Connectez-vous à Geocaching.com pour charger votre inventaire.'
                        : `Inventaire indisponible${body?.error_message ? ` : ${body.error_message}` : ''}.`,
                };
            } else {
                const trackables: InventoryTrackable[] = Array.isArray(body.trackables)
                    ? body.trackables.filter((tb: unknown): tb is InventoryTrackable =>
                        !!tb && typeof (tb as InventoryTrackable).reference_code === 'string')
                    : [];
                let notice: string | undefined;
                if (body.empty_remote_guarded === true) {
                    notice = 'Geocaching.com renvoie un inventaire vide : la copie locale est conservée. '
                        + 'Cliquez « Rafraîchir » pour confirmer un inventaire réellement vide.';
                } else if (typeof body.sync_error === 'string' && body.sync_error) {
                    notice = `Relecture impossible (${body.sync_error}) : copie locale affichée.`;
                }
                this.inventory = {
                    loading: false,
                    loaded: true,
                    trackables,
                    lastSyncAt: typeof body.last_sync_at === 'string' ? body.last_sync_at : null,
                    stale: body.stale === true,
                    notice,
                };
                if (mode === 'refresh') {
                    this.messages.info(describeInventorySync(body.sync));
                }
            }
        } catch (e) {
            console.error('[TrackablesWidget] loadInventory error', e);
            this.inventory = { ...EMPTY_INVENTORY, loaded: true, error: 'Backend injoignable : inventaire non chargé.' };
        } finally {
            this.inventory.loading = false;
            this.update();
        }
    }

    /* ------------------------------------------------------------ Fiche TB */

    /**
     * Charge la fiche : un code de suivi est d'abord résolu par `POST /lookup`
     * (jamais en URL) ; un code public part directement en `GET /<TB>` — la
     * réponse est côté backend dans le cache court de 5 min (`refresh=1` force).
     */
    protected async loadTrackableDetail(rawCode: string, refresh: boolean): Promise<void> {
        const code = rawCode.trim().toUpperCase();
        if (!code || this.detail.loading) {
            return;
        }
        this.detail = { loading: true, requestedCode: isLikelyPublicCode(code) ? code : undefined };
        this.detailLogPage = 0;
        this.update();
        try {
            let publicCode = code;
            if (!isLikelyPublicCode(code)) {
                const lookupRes = await fetch(`${this.backendBaseUrl}/api/trackables/lookup`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code }),
                });
                const lookupBody = await lookupRes.json().catch(() => undefined);
                const ref = lookupBody?.trackable?.reference_code;
                if (!lookupRes.ok || !lookupBody?.success || typeof ref !== 'string') {
                    this.detail = {
                        loading: false,
                        error: lookupBody?.error_message || 'Aucun trackable trouvé pour ce code.',
                    };
                    this.update();
                    return;
                }
                publicCode = ref;
            }
            const res = await fetch(
                `${this.backendBaseUrl}/api/trackables/${encodeURIComponent(publicCode)}${refresh ? '?refresh=1' : ''}`,
                { credentials: 'include' },
            );
            const body = await res.json().catch(() => undefined);
            if (!res.ok || !body?.success) {
                this.detail = {
                    loading: false, requestedCode: publicCode,
                    error: body?.error_message || `Fiche indisponible (HTTP ${res.status}).`,
                };
            } else {
                this.detail = {
                    loading: false,
                    requestedCode: publicCode,
                    trackable: body.trackable,
                    details: body.details,
                };
                this.detailInput = publicCode;
            }
        } catch {
            this.detail = { loading: false, requestedCode: code, error: 'Backend injoignable : fiche non chargée.' };
        }
        this.update();
    }

    /** Les liens du HTML assaini s'ouvrent dans le navigateur, jamais dans le widget. */
    protected onDetailHtmlClick(e: React.MouseEvent<HTMLElement>): void {
        const anchor = (e.target as HTMLElement).closest('a');
        if (anchor?.href) {
            e.preventDefault();
            window.open(anchor.href, '_blank', 'noopener,noreferrer');
        }
    }

    /* ------------------------------------------------- File Loguer/Découvrir */

    protected persistQueue(): void {
        try {
            window.localStorage.setItem(TRACKABLE_QUEUE_STORAGE_KEY, JSON.stringify({
                version: TRACKABLE_QUEUE_STORAGE_VERSION,
                logDate: this.queueLogDate,
                logText: this.queueLogText,
                items: sanitizeQueueForStorage(this.queue),
            }));
        } catch (e) {
            console.warn('[TrackablesWidget] persistance de la file impossible', e);
        }
    }

    protected patchQueueItem(key: string, patch: Partial<TrackableQueueItem>): void {
        this.queue = this.queue.map(item => (item.key === key ? { ...item, ...patch } : item));
        this.persistQueue();
        this.update();
    }

    /** « Analyser » : extraction + dédoublonnage, puis préflight des nouveaux. */
    protected analyzeQueueInput(): void {
        const codes = parseTrackableCodeTokens(this.queueInput);
        const known = new Set(this.queue.flatMap(item => [
            item.inputCode.toUpperCase(),
            item.reference_code ?? '',
        ]));
        const fresh = codes.filter(code => !known.has(code));
        if (fresh.length > 0) {
            this.queue = [
                ...this.queue,
                ...fresh.map(code => ({
                    key: `q${++this.queueSequence}-${Date.now()}`,
                    inputCode: code,
                    status: 'pending' as const,
                })),
            ];
            // Le collage est consommé : on le vide plutôt que de garder
            // un secret lisible dans le champ.
            this.queueInput = '';
            this.persistQueue();
        }
        if (codes.length === 0) {
            this.messages.warn('Aucun code reconnu dans le collage.');
        }
        this.update();
        void this.preflightQueue();
    }

    /**
     * Préflight de tous les éléments en attente — sans envoyer de log :
     * `POST /lookup` (le code reste dans le corps) puis `GET /<TB>/log-info`
     * pour les types autorisés et la cache courante.
     */
    protected async preflightQueue(): Promise<void> {
        if (this.queuePreflighting) {
            return;
        }
        this.queuePreflighting = true;
        try {
            for (;;) {
                const item = this.queue.find(entry => entry.status === 'pending');
                if (!item) {
                    break;
                }
                this.patchQueueItem(item.key, { status: 'preflight' });
                try {
                    const lookupRes = await fetch(`${this.backendBaseUrl}/api/trackables/lookup`, {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ code: item.inputCode }),
                    });
                    const lookupBody = await lookupRes.json().catch(() => undefined);
                    if (!lookupRes.ok || !lookupBody?.success) {
                        this.patchQueueItem(item.key, {
                            status: 'error',
                            statusDetail: lookupBody?.error_message || `Lookup impossible (HTTP ${lookupRes.status}).`,
                        });
                        continue;
                    }
                    const tb = lookupBody.trackable ?? {};
                    const ref = typeof tb.reference_code === 'string' ? tb.reference_code : undefined;
                    if (!ref) {
                        this.patchQueueItem(item.key, { status: 'error', statusDetail: 'Réponse de lookup sans code public.' });
                        continue;
                    }
                    let patch: Partial<TrackableQueueItem> = {
                        reference_code: ref,
                        name: tb.name,
                        owner_username: tb.owner_username,
                        current_geocache_code: tb.current_geocache_code,
                        current_geocache_name: tb.current_geocache_name,
                        has_tracking_code: tb.has_tracking_code === true || lookupBody.tracking_code_matched === true,
                    };
                    // Types autorisés : la page de log du TB fait foi (relecture distante).
                    let logInfoOk = false;
                    try {
                        const infoRes = await fetch(
                            `${this.backendBaseUrl}/api/trackables/${encodeURIComponent(ref)}/log-info`,
                            { credentials: 'include' },
                        );
                        const info = await infoRes.json().catch(() => undefined);
                        if (infoRes.ok && info?.success) {
                            logInfoOk = true;
                            const allowed: { id: number; label: string }[] = Array.isArray(info.allowed_log_types)
                                ? info.allowed_log_types.filter(
                                    (t: unknown): t is { id: number; label: string } =>
                                        !!t && typeof (t as { id?: unknown }).id === 'number')
                                : [];
                            patch = {
                                ...patch,
                                allowed_log_types: allowed,
                                logTypeId: defaultTrackableLogType(allowed, this.pendingLogContext?.action),
                                current_geocache_code: info.current_geocache_code ?? patch.current_geocache_code,
                                current_geocache_name: info.current_geocache_name ?? patch.current_geocache_name,
                                has_tracking_code: patch.has_tracking_code || info.has_tracking_code === true,
                            };
                        }
                    } catch {
                        // Traité par le repli ci-dessous.
                    }
                    if (!logInfoOk) {
                        // log-info injoignable : choix courants du site en repli —
                        // le backend revalide avant l'envoi, rien n'est acquis.
                        patch = {
                            ...patch,
                            allowed_log_types: patch.allowed_log_types ?? [...TRACKABLE_LOG_TYPE_FALLBACK_CHOICES],
                            logTypeId: patch.logTypeId ?? defaultTrackableLogType(
                                TRACKABLE_LOG_TYPE_FALLBACK_CHOICES, this.pendingLogContext?.action),
                            statusDetail: 'Types de log non relus (log-info) : le site revalidera à l’envoi.',
                        };
                    } else if (patch.allowed_log_types && patch.allowed_log_types.length === 0) {
                        patch = { ...patch, statusDetail: 'Aucun type de log proposé par le site pour ce trackable.' };
                    }
                    this.patchQueueItem(item.key, { ...patch, status: 'ready', statusDetail: undefined });
                } catch {
                    this.patchQueueItem(item.key, { status: 'error', statusDetail: 'Backend injoignable pendant le préflight.' });
                }
            }
        } finally {
            this.queuePreflighting = false;
            this.update();
        }
    }

    /**
     * Envoi séquentiel : un POST à la fois, arrêt possible entre deux envois.
     * Les POST ne sont jamais rejoués : une coupure donne `unknown`, pas un doublon.
     */
    protected async submitQueue(): Promise<void> {
        if (this.queueRunning) {
            return;
        }
        if (!this.queueLogText.trim()) {
            this.messages.warn('Le texte du log est requis.');
            return;
        }
        this.queueRunning = true;
        this.queueStopRequested = false;
        this.update();
        try {
            for (const item of this.queue) {
                if (this.queueStopRequested) {
                    break;
                }
                if (item.status !== 'ready' || !item.reference_code || item.logTypeId === undefined) {
                    continue;
                }
                const needsCode = trackableLogTypeNeedsTrackingCode(item.logTypeId) && !item.has_tracking_code;
                const trackingCode = (this.queueTrackingCodes[item.reference_code] ?? '').trim();
                if (needsCode && !trackingCode) {
                    this.patchQueueItem(item.key, { statusDetail: 'Code de suivi requis pour ce type de log.' });
                    continue;
                }
                if (trackableLogTypeNeedsGeocache(item.logTypeId) && !item.geocacheCode?.trim()) {
                    this.patchQueueItem(item.key, { statusDetail: 'Indiquez la cache (GC…) de retrait.' });
                    continue;
                }
                this.patchQueueItem(item.key, { status: 'submitting', statusDetail: undefined });
                // Nouvelle tentative = nouvel operationId : un réessai volontaire
                // n'est pas un doublon du précédent.
                const operationId = crypto.randomUUID();
                try {
                    const res = await fetch(
                        `${this.backendBaseUrl}/api/trackables/${encodeURIComponent(item.reference_code)}/logs`,
                        {
                            method: 'POST',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                logType: item.logTypeId,
                                text: this.queueLogText,
                                date: this.queueLogDate,
                                trackingCode: trackingCode || undefined,
                                geocacheCode: item.geocacheCode,
                                locationConflictConfirmed: item.locationConflictConfirmed || undefined,
                                operationId,
                            }),
                        },
                    );
                    const body = await res.json().catch(() => undefined);
                    if (res.ok && body?.success) {
                        this.patchQueueItem(item.key, {
                            status: 'confirmed', statusDetail: undefined,
                            has_tracking_code: true,
                            locationConflictPending: false, locationConflictConfirmed: false,
                        });
                    } else if (res.status === 409 && body?.error === 'trackable_location_conflict') {
                        this.patchQueueItem(item.key, {
                            status: 'ready',
                            statusDetail: body.error_message || 'Conflit de localisation : confirmez pour envoyer.',
                            locationConflictPending: true,
                        });
                    } else if (res.status === 409 && body?.error === 'operation_in_flight') {
                        this.patchQueueItem(item.key, {
                            status: 'unknown',
                            statusDetail: 'Envoi déjà en cours côté serveur : à vérifier avant de renvoyer.',
                        });
                    } else if (body?.error === 'unknown_remote_outcome') {
                        this.patchQueueItem(item.key, {
                            status: 'unknown',
                            statusDetail: body.error_message || 'Résultat distant incertain : à vérifier sur Geocaching.com.',
                            trackable_url: typeof body.trackable_url === 'string' ? body.trackable_url : undefined,
                        });
                    } else {
                        // `network_failed_before_response` et refus métier : réessai possible.
                        this.patchQueueItem(item.key, {
                            status: 'rejected',
                            statusDetail: body?.error_message || `Envoi refusé (HTTP ${res.status}).`,
                        });
                    }
                } catch {
                    // Coupure réseau sur un POST : le site a peut-être enregistré le
                    // log. Jamais de renvoi à l'aveugle — l'élément passe en « unknown ».
                    this.patchQueueItem(item.key, {
                        status: 'unknown',
                        statusDetail: 'Coupure réseau au résultat inconnu : vérifiez la fiche avant de renvoyer.',
                    });
                }
            }
        } finally {
            this.queueRunning = false;
            this.queueStopRequested = false;
            const counts = trackableQueueCounts(this.queue);
            if (counts.unknown > 0) {
                this.messages.warn(
                    `File terminée : ${counts.confirmed} confirmé(s), ${counts.rejected} refusé(s), `
                    + `${counts.unknown} à vérifier sur Geocaching.com.`,
                );
            } else {
                this.messages.info(`File terminée : ${counts.confirmed} confirmé(s), ${counts.rejected} refusé(s).`);
            }
            this.persistQueue();
            this.update();
        }
    }

    /** Remet un élément refusé dans la file (nouvel envoi = nouvel operationId). */
    protected retryQueueItem(key: string): void {
        this.patchQueueItem(key, {
            status: 'ready', statusDetail: undefined,
            locationConflictPending: false, locationConflictConfirmed: false,
        });
        void this.submitQueue();
    }

    /** Confirme le conflit de localisation affiché par le backend et renvoie. */
    protected confirmLocationConflict(key: string): void {
        this.patchQueueItem(key, { locationConflictConfirmed: true, locationConflictPending: false });
        void this.submitQueue();
    }

    protected clearQueue(): void {
        if (this.queueRunning) {
            return;
        }
        this.queue = [];
        this.queueTrackingCodes = {};
        this.persistQueue();
        this.update();
    }

    protected copyQueueReport(): void {
        void navigator.clipboard.writeText(buildTrackableQueueReport(this.queue))
            .then(() => this.messages.info('Bilan de la file copié.'))
            .catch(() => this.messages.warn('Copie impossible dans le presse-papiers.'));
    }

    protected render(): React.ReactNode {
        return (
            <div className='geoapp-trackables-widget'>
                <div className='geoapp-trackables-widget__tabs' role='tablist'>
                    {TRACKABLES_WIDGET_TABS.map(tab => (
                        <button
                            key={tab.id}
                            type='button'
                            role='tab'
                            aria-selected={this.activeTab === tab.id}
                            className={'geoapp-trackables-widget__tab'
                                + (this.activeTab === tab.id ? ' is-active' : '')}
                            onClick={() => this.showTab(tab.id)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
                {this.activeTab === 'inventory' && this.renderInventoryTab()}
                {this.activeTab === 'log' && this.renderLogTab()}
                {this.activeTab === 'detail' && this.renderDetailTab()}
            </div>
        );
    }

    protected renderInventoryTab(): React.ReactNode {
        const inv = this.inventory;
        const visible = filterTrackables(inv.trackables, this.inventoryFilter);
        return (
            <div className='geoapp-trackables-widget__panel' role='tabpanel'>
                <div className='geoapp-trackables-widget__toolbar'>
                    <input
                        className='theia-input geoapp-trackables-widget__filter'
                        type='search'
                        placeholder='Rechercher (code, nom, type, propriétaire)…'
                        aria-label='Rechercher un trackable'
                        value={this.inventoryFilter}
                        onChange={e => { this.inventoryFilter = e.currentTarget.value; this.update(); }}
                    />
                    {inv.lastSyncAt && (
                        <span
                            className='geoapp-trackables-widget__sync'
                            title='Dernier relevé de l’inventaire sur Geocaching.com'
                        >
                            relevé le {formatIsoDateTimeFr(inv.lastSyncAt)}{inv.stale ? ' (périmé)' : ''}
                        </span>
                    )}
                    <button
                        type='button'
                        className='theia-button secondary'
                        disabled={inv.loading}
                        title='Relire mon inventaire sur Geocaching.com'
                        onClick={() => { void this.loadInventory('refresh'); }}
                    >
                        {inv.loading ? '⏳ Relecture…' : '⟳ Rafraîchir'}
                    </button>
                </div>

                {inv.error && <div className='geoapp-trackables-widget__error' role='alert'>{inv.error}</div>}
                {!inv.error && inv.notice && (
                    <div className='geoapp-trackables-widget__notice' role='status'>{inv.notice}</div>
                )}
                <span className='geoapp-trackables-widget__visually-hidden' role='status'>
                    {inv.loading ? 'Relecture de l’inventaire en cours…'
                        : `${inv.trackables.length} trackable(s) dans l’inventaire`}
                </span>

                {!inv.error && inv.loaded && !inv.loading && inv.trackables.length === 0 && (
                    <div className='geoapp-trackables-widget__empty'>Aucun trackable dans votre inventaire.</div>
                )}

                {inv.trackables.length > 0 && (
                    <>
                        {this.inventoryFilter && (
                            <div className='geoapp-trackables-widget__count' aria-live='polite'>
                                {visible.length} sur {inv.trackables.length}
                            </div>
                        )}
                        <div className='geoapp-trackables-widget__list' role='list'>
                            {visible.map(tb => (
                                <TrackableInventoryRow
                                    key={tb.reference_code}
                                    trackable={tb}
                                    onShowDetail={code => {
                                        this.pendingDetailCode = code;
                                        this.showTab('detail');
                                    }}
                                    onLog={code => {
                                        this.pendingLogContext = { code, action: 'log' };
                                        this.showTab('log');
                                    }}
                                />
                            ))}
                            {visible.length === 0 && (
                                <div className='geoapp-trackables-widget__empty'>
                                    Aucun trackable ne correspond à la recherche.
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        );
    }

    /**
     * Onglet « Loguer / Découvrir » : collage multi-codes → préflight (lookup +
     * types autorisés) → file séquentielle avec états et arrêt entre deux envois.
     */
    protected renderLogTab(): React.ReactNode {
        const counts = trackableQueueCounts(this.queue);
        const busy = this.queueRunning || this.queuePreflighting;
        const sendable = this.queue.some(item => item.status === 'ready');
        return (
            <div className='geoapp-trackables-widget__panel' role='tabpanel'>
                {this.pendingLogContext && (
                    <div className='geoapp-trackables-widget__notice' role='status'>
                        Prérempli depuis la fiche cache : {this.pendingLogContext.action === 'retrieve' ? 'retirer'
                            : this.pendingLogContext.action === 'discover' ? 'découvrir' : 'loguer'}
                        {this.pendingLogContext.geocacheCode ? ` dans ${this.pendingLogContext.geocacheCode}` : ''}.
                    </div>
                )}
                <label className='geoapp-trackables-widget__label'>
                    Codes de suivi ou publics — un par ligne, collage libre, URLs coord.info ou ?tracker= acceptées :
                    <textarea
                        className='theia-input geoapp-trackables-widget__codes'
                        rows={3}
                        value={this.queueInput}
                        disabled={this.queueRunning}
                        onChange={e => { this.queueInput = e.currentTarget.value; this.update(); }}
                        placeholder={'TB1A2B3\nhttps://coord.info/TB7XYZ\ntracker=AB12CD, AF12CD…'}
                    />
                </label>
                <div className='geoapp-trackables-widget__toolbar'>
                    <button
                        type='button'
                        className='theia-button'
                        disabled={busy || !this.queueInput.trim()}
                        title='Extraire les codes et lancer le préflight (lookup + types autorisés)'
                        onClick={() => this.analyzeQueueInput()}
                    >
                        {this.queuePreflighting ? '⏳ Préflight…' : 'Analyser'}
                    </button>
                    {counts.total > 0 && (
                        <span className='geoapp-trackables-widget__count' aria-live='polite'>
                            {counts.total} élément(s) — {counts.ready} prêt(s), {counts.confirmed} confirmé(s),{' '}
                            {counts.rejected} refusé(s), {counts.unknown} à vérifier, {counts.errors} en erreur
                        </span>
                    )}
                    {counts.total > 0 && !this.queueRunning && (
                        <>
                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.copyQueueReport()}
                                title='Copier le bilan (codes publics uniquement)'
                            >
                                Copier le bilan
                            </button>
                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.clearQueue()}
                            >
                                Vider la file
                            </button>
                        </>
                    )}
                </div>

                {this.queue.length > 0 && (
                    <>
                        <div className='geoapp-trackables-widget__common'>
                            <label className='geoapp-trackables-widget__label'>
                                Date du log
                                <input
                                    type='date'
                                    className='theia-input'
                                    value={this.queueLogDate}
                                    onChange={e => {
                                        this.queueLogDate = e.currentTarget.value;
                                        this.persistQueue();
                                        this.update();
                                    }}
                                />
                            </label>
                            <label className='geoapp-trackables-widget__label geoapp-trackables-widget__label--grow'>
                                Texte commun à tous les logs
                                <textarea
                                    className='theia-input'
                                    rows={2}
                                    value={this.queueLogText}
                                    disabled={this.queueRunning}
                                    onChange={e => {
                                        this.queueLogText = e.currentTarget.value;
                                        this.persistQueue();
                                        this.update();
                                    }}
                                />
                            </label>
                        </div>
                        <div className='geoapp-trackables-widget__toolbar'>
                            {this.queueRunning ? (
                                <button
                                    type='button'
                                    className='theia-button'
                                    onClick={() => { this.queueStopRequested = true; this.update(); }}
                                >
                                    ⏹ Arrêter après l’envoi en cours
                                </button>
                            ) : (
                                <button
                                    type='button'
                                    className='theia-button'
                                    disabled={!sendable || !this.queueLogText.trim()}
                                    title='Envoyer les logs en file, un par un'
                                    onClick={() => { void this.submitQueue(); }}
                                >
                                    ▶ Envoyer la file
                                </button>
                            )}
                            {this.queueRunning && (
                                <span className='geoapp-trackables-widget__count' role='status'>
                                    Envoi en cours : {counts.settled + counts.unknown}/{counts.total}
                                </span>
                            )}
                        </div>
                        <div className='geoapp-trackables-widget__queue' role='list'>
                            {this.queue.map(item => this.renderQueueItem(item))}
                        </div>
                    </>
                )}
            </div>
        );
    }

    protected renderQueueItem(item: TrackableQueueItem): React.ReactNode {
        const displayCode = queueItemDisplayCode(item);
        const needsCode = item.reference_code !== undefined
            && item.logTypeId !== undefined
            && trackableLogTypeNeedsTrackingCode(item.logTypeId)
            && !item.has_tracking_code;
        const needsGeocache = item.status === 'ready'
            && trackableLogTypeNeedsGeocache(item.logTypeId);
        return (
            <div
                key={item.key}
                className={`geoapp-trackables-widget__queue-item geoapp-trackables-widget__queue-item--${item.status}`}
                role='listitem'
            >
                <span className={`geoapp-trackables-widget__queue-badge geoapp-trackables-widget__queue-badge--${item.status}`}>
                    {TRACKABLE_QUEUE_STATUS_LABELS[item.status]}
                </span>
                <span className='geoapp-trackables-widget__queue-id'>
                    {item.reference_code ? (
                        <a href={trackableUrl(item.reference_code)} target='_blank' rel='noopener noreferrer'>
                            {displayCode}
                        </a>
                    ) : displayCode}
                    {item.name ? ` — ${item.name}` : ''}
                </span>
                <span className='geoapp-trackables-widget__queue-meta'>
                    {[item.owner_username, item.current_geocache_code
                        ? `dans ${item.current_geocache_code}` : undefined]
                        .filter(Boolean).join(' · ')}
                </span>
                {item.status === 'ready' && item.allowed_log_types && item.allowed_log_types.length > 0 && (
                    <select
                        className='theia-select geoapp-trackables-widget__queue-type'
                        value={item.logTypeId ?? ''}
                        disabled={this.queueRunning}
                        aria-label={`Type de log pour ${displayCode}`}
                        onChange={e => this.patchQueueItem(item.key, { logTypeId: Number(e.currentTarget.value) })}
                    >
                        {item.allowed_log_types.map(t => (
                            <option key={t.id} value={t.id}>
                                {t.label || TRACKABLE_LOG_TYPE_FALLBACK_LABELS[t.id] || `Type ${t.id}`}
                            </option>
                        ))}
                    </select>
                )}
                {needsGeocache && (
                    <input
                        className='theia-input geoapp-trackables-widget__queue-geocache'
                        value={item.geocacheCode ?? ''}
                        disabled={this.queueRunning}
                        placeholder='GC… de retrait'
                        aria-label={`Cache de retrait pour ${displayCode}`}
                        onChange={e => this.patchQueueItem(item.key, { geocacheCode: e.currentTarget.value })}
                    />
                )}
                {item.status === 'ready' && needsCode && (
                    <TrackingCodeInput
                        value={this.queueTrackingCodes[item.reference_code!] ?? ''}
                        disabled={this.queueRunning}
                        onChange={value => {
                            this.queueTrackingCodes = { ...this.queueTrackingCodes, [item.reference_code!]: value };
                            this.update();
                        }}
                    />
                )}
                {item.statusDetail && (
                    <span className='geoapp-trackables-widget__queue-detail'>{item.statusDetail}</span>
                )}
                <span className='geoapp-trackables-widget__queue-actions'>
                    {item.locationConflictPending && (
                        <button
                            type='button'
                            className='theia-button secondary'
                            onClick={() => this.confirmLocationConflict(item.key)}
                        >
                            Confirmer et envoyer
                        </button>
                    )}
                    {item.status === 'rejected' && (
                        <button
                            type='button'
                            className='theia-button secondary'
                            onClick={() => this.retryQueueItem(item.key)}
                        >
                            Renvoyer
                        </button>
                    )}
                    {item.status === 'unknown' && (
                        <a
                            href={item.trackable_url ?? (item.reference_code ? trackableUrl(item.reference_code) : '#')}
                            target='_blank'
                            rel='noopener noreferrer'
                        >
                            Vérifier sur Geocaching.com
                        </a>
                    )}
                    {!this.queueRunning && (item.status === 'error' || item.status === 'confirmed') && (
                        <button
                            type='button'
                            className='theia-button secondary'
                            title='Retirer de la file'
                            onClick={() => {
                                this.queue = this.queue.filter(entry => entry.key !== item.key);
                                this.persistQueue();
                                this.update();
                            }}
                        >
                            Retirer
                        </button>
                    )}
                </span>
            </div>
        );
    }

    /** Onglet « Fiche » : saisie du code, détail assaini et logs paginés. */
    protected renderDetailTab(): React.ReactNode {
        const d = this.detail;
        const details = d.details;
        const tb = d.trackable;
        const logs = details?.logs ?? [];
        const pageCount = Math.max(1, Math.ceil(logs.length / DETAIL_LOGS_PER_PAGE));
        const page = Math.min(this.detailLogPage, pageCount - 1);
        const pageLogs = logs.slice(page * DETAIL_LOGS_PER_PAGE, (page + 1) * DETAIL_LOGS_PER_PAGE);
        return (
            <div className='geoapp-trackables-widget__panel' role='tabpanel'>
                <div className='geoapp-trackables-widget__toolbar'>
                    <input
                        className='theia-input geoapp-trackables-widget__filter'
                        value={this.detailInput}
                        placeholder='Code public TB… ou code de suivi'
                        aria-label='Code du trackable à afficher'
                        disabled={d.loading}
                        onChange={e => { this.detailInput = e.currentTarget.value; this.update(); }}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && this.detailInput.trim() && !d.loading) {
                                void this.loadTrackableDetail(this.detailInput, false);
                            }
                        }}
                    />
                    <button
                        type='button'
                        className='theia-button'
                        disabled={d.loading || !this.detailInput.trim()}
                        onClick={() => { void this.loadTrackableDetail(this.detailInput, false); }}
                    >
                        {d.loading ? '⏳ Chargement…' : 'Charger'}
                    </button>
                    {d.requestedCode && (
                        <button
                            type='button'
                            className='theia-button secondary'
                            disabled={d.loading}
                            title='Relire la fiche sur Geocaching.com'
                            onClick={() => { void this.loadTrackableDetail(this.detailInput, true); }}
                        >
                            ⟳ Rafraîchir
                        </button>
                    )}
                </div>

                {d.error && <div className='geoapp-trackables-widget__error' role='alert'>{d.error}</div>}
                <span className='geoapp-trackables-widget__visually-hidden' role='status'>
                    {d.loading ? 'Chargement de la fiche en cours…'
                        : d.requestedCode ? `Fiche ${d.requestedCode} affichée` : 'Aucune fiche chargée'}
                </span>

                {!d.error && !d.loading && !details && !d.requestedCode && (
                    <div className='geoapp-trackables-widget__empty'>
                        Saisissez un code public ou un code de suivi, ou ouvrez une fiche depuis l’inventaire.
                    </div>
                )}

                {details && d.requestedCode && (
                    <div className='geoapp-trackables-widget__detail'>
                        <div className='geoapp-trackables-widget__detail-head'>
                            {(details.icon_url || tb?.icon_url) && (
                                <img
                                    className='geoapp-trackables-widget__detail-icon'
                                    src={details.icon_url ?? tb?.icon_url ?? ''}
                                    alt=''
                                    width={32}
                                    height={32}
                                    loading='lazy'
                                    decoding='async'
                                />
                            )}
                            <div className='geoapp-trackables-widget__detail-title'>
                                <strong>{details.name ?? tb?.name ?? d.requestedCode}</strong>
                                <span className='geoapp-trackables-widget__meta'>
                                    <a href={trackableUrl(d.requestedCode)} target='_blank' rel='noopener noreferrer'>
                                        {d.requestedCode}
                                    </a>
                                    {[details.type_name ?? tb?.type_name,
                                        tb?.owner_username ?? details.owner_username
                                            ? `propriétaire : ${tb?.owner_username ?? details.owner_username}` : undefined,
                                        details.is_locked ? 'verrouillé' : undefined,
                                        tb?.has_tracking_code ? 'code de suivi connu' : undefined]
                                        .filter(Boolean).join(' · ')}
                                </span>
                            </div>
                            <button
                                type='button'
                                className='theia-button secondary'
                                title='Préremplir l’onglet Loguer avec ce trackable'
                                onClick={() => {
                                    this.enqueueCode(d.requestedCode!, 'log');
                                    this.showTab('log');
                                }}
                            >
                                Loguer
                            </button>
                        </div>

                        {details.parse_warnings && details.parse_warnings.length > 0 && (
                            <div className='geoapp-trackables-widget__notice' role='status'>
                                Fiche partiellement lisible : {details.parse_warnings.join(', ')} absent(s).
                            </div>
                        )}

                        <dl className='geoapp-trackables-widget__detail-meta'>
                            {details.released_at && (
                                <><dt>Lâché le</dt><dd>{formatIsoDateTimeFr(details.released_at)}</dd></>
                            )}
                            {details.origin && <><dt>Origine</dt><dd>{details.origin}</dd></>}
                            {(details.location_name || details.location_geocache_code) && (
                                <><dt>Position</dt><dd>
                                    {TRACKABLE_LOCATION_KIND_LABELS[details.location_kind ?? ''] ?? ''}{' '}
                                    {details.location_geocache_code ? (
                                        <a href={geocacheUrl(details.location_geocache_code)}
                                            target='_blank' rel='noopener noreferrer'>
                                            {details.location_geocache_code}
                                        </a>
                                    ) : undefined}
                                    {details.location_name ? ` ${details.location_name}` : ''}
                                </dd></>
                            )}
                            {details.distance_km != null && (
                                <><dt>Distance</dt><dd>{details.distance_km.toLocaleString('fr-FR')} km</dd></>
                            )}
                        </dl>

                        {details.image_url && (
                            <img
                                className='geoapp-trackables-widget__detail-image'
                                src={details.image_url}
                                alt={details.name ?? d.requestedCode}
                                loading='lazy'
                                decoding='async'
                            />
                        )}

                        {details.goal_html && (
                            <section className='geoapp-trackables-widget__detail-section'>
                                <h4>Objectif</h4>
                                <SanitizedHtml html={details.goal_html} onClick={this.onDetailHtmlClick} />
                            </section>
                        )}
                        {details.details_html && (
                            <section className='geoapp-trackables-widget__detail-section'>
                                <h4>Description</h4>
                                <SanitizedHtml html={details.details_html} onClick={this.onDetailHtmlClick} />
                            </section>
                        )}

                        <section className='geoapp-trackables-widget__detail-section'>
                            <h4>
                                Logs{logs.length > 0 ? ` (${logs.length})` : ''}
                                {logs.length > DETAIL_LOGS_PER_PAGE
                                    ? ` — page ${page + 1}/${pageCount}` : ''}
                            </h4>
                            {logs.length === 0 ? (
                                <div className='geoapp-trackables-widget__empty'>Aucun log sur la fiche.</div>
                            ) : (
                                <>
                                    <div className='geoapp-trackables-widget__logs' role='list'>
                                        {pageLogs.map((log, index) => (
                                            <div
                                                key={log.log_reference_code ?? `${page}-${index}`}
                                                className='geoapp-trackables-widget__log'
                                                role='listitem'
                                            >
                                                <div className='geoapp-trackables-widget__log-head'>
                                                    <strong>{log.log_type_label ?? 'Log'}</strong>
                                                    <span className='geoapp-trackables-widget__meta'>
                                                        {log.log_date ?? log.log_date_raw ?? 'date inconnue'}
                                                        {log.log_date_ambiguous ? ' (date incertaine)' : ''}
                                                        {log.author_username ? ` — ${log.author_username}` : ''}
                                                        {log.geocache_code ? (
                                                            <>
                                                                {' · '}
                                                                <a href={geocacheUrl(log.geocache_code)}
                                                                    target='_blank' rel='noopener noreferrer'>
                                                                    {log.geocache_code}
                                                                </a>
                                                                {log.geocache_name ? ` ${log.geocache_name}` : ''}
                                                            </>
                                                        ) : ''}
                                                    </span>
                                                </div>
                                                {log.text_html && (
                                                    <SanitizedHtml
                                                        html={log.text_html}
                                                        onClick={this.onDetailHtmlClick}
                                                    />
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    {pageCount > 1 && (
                                        <div className='geoapp-trackables-widget__toolbar'>
                                            <button
                                                type='button'
                                                className='theia-button secondary'
                                                disabled={page <= 0}
                                                onClick={() => { this.detailLogPage = page - 1; this.update(); }}
                                            >
                                                ← Précédent
                                            </button>
                                            <button
                                                type='button'
                                                className='theia-button secondary'
                                                disabled={page >= pageCount - 1}
                                                onClick={() => { this.detailLogPage = page + 1; this.update(); }}
                                            >
                                                Suivant →
                                            </button>
                                        </div>
                                    )}
                                </>
                            )}
                        </section>
                    </div>
                )}
            </div>
        );
    }
}

/** Libellés des états de la file, affichés dans les badges. */
const TRACKABLE_QUEUE_STATUS_LABELS: Record<TrackableQueueItem['status'], string> = {
    pending: 'en attente',
    preflight: 'préflight…',
    ready: 'prêt',
    submitting: 'envoi…',
    confirmed: 'confirmé',
    rejected: 'refusé',
    unknown: 'à vérifier',
    error: 'erreur',
};

/**
 * Code de suivi : champ masqué par défaut avec affichage temporaire —
 * le site l'exige pour découvrir/retirer/prendre, la saisie ne quitte jamais
 * la mémoire sauf vers le backend au moment du POST.
 */
const TrackingCodeInput: React.FC<{
    value: string;
    disabled?: boolean;
    onChange: (value: string) => void;
}> = ({ value, disabled, onChange }) => {
    const [visible, setVisible] = React.useState(false);
    return (
        <span className='geoapp-trackables-widget__tracking-code'>
            <input
                className='theia-input'
                type={visible ? 'text' : 'password'}
                value={value}
                disabled={disabled}
                placeholder='Code de suivi'
                aria-label='Code de suivi du trackable'
                autoComplete='off'
                onChange={e => onChange(e.currentTarget.value)}
            />
            <button
                type='button'
                className='theia-button secondary'
                disabled={disabled}
                title={visible ? 'Masquer le code' : 'Afficher le code temporairement'}
                onClick={() => setVisible(v => !v)}
            >
                {visible ? '🙈' : '👁'}
            </button>
        </span>
    );
};

/** Localisation de la fiche — miroir des `location_kind` de `TrackableDetails`. */
const TRACKABLE_LOCATION_KIND_LABELS: Record<string, string> = {
    cache: 'dans la cache',
    user: 'chez',
    owner: 'chez son propriétaire,',
    unknown: '',
};

/**
 * HTML de fiche : le backend l'a assaini à l'extraction (§ 4) ; DOMPurify fait
 * ici la défense en profondeur avant `dangerouslySetInnerHTML`, et les liens
 * partent dans le navigateur via `onClick`.
 */
const SanitizedHtml: React.FC<{
    html: string;
    onClick: (e: React.MouseEvent<HTMLElement>) => void;
}> = ({ html, onClick }) => (
    <div
        className='geoapp-trackables-widget__html'
        onClick={onClick}
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
    />
);

/** Ligne d'inventaire : identité compacte + actions « Fiche » et « Loguer ». */
const TrackableInventoryRow: React.FC<{
    trackable: InventoryTrackable;
    onShowDetail: (code: string) => void;
    onLog: (code: string) => void;
}> = ({ trackable, onShowDetail, onLog }) => {
    const [iconFailed, setIconFailed] = React.useState(false);
    return (
        <div className='geoapp-trackables-widget__row' role='listitem'>
            {trackable.icon_url && !iconFailed ? (
                <img
                    className='geoapp-trackables-widget__icon'
                    src={trackable.icon_url}
                    alt=''
                    loading='lazy'
                    decoding='async'
                    width={16}
                    height={16}
                    onError={() => setIconFailed(true)}
                />
            ) : (
                <span className='geoapp-trackables-widget__icon' />
            )}
            <span
                className='geoapp-trackables-widget__name'
                title={[trackable.name, trackable.type_name].filter(Boolean).join(' — ') || undefined}
            >
                {trackable.name || trackable.reference_code}
            </span>
            <a
                className='geoapp-trackables-widget__code'
                href={trackableUrl(trackable.reference_code)}
                target='_blank'
                rel='noopener noreferrer'
                title='Ouvrir la fiche sur Geocaching.com'
            >
                {trackable.reference_code}
            </a>
            <span className='geoapp-trackables-widget__meta'>
                {[trackable.type_name, trackable.owner_username].filter(Boolean).join(' · ')}
            </span>
            <span className='geoapp-trackables-widget__row-actions'>
                <button
                    type='button'
                    className='theia-button secondary'
                    title='Ouvrir la fiche dans l’onglet Fiche'
                    onClick={() => onShowDetail(trackable.reference_code)}
                >
                    Fiche
                </button>
                <button
                    type='button'
                    className='theia-button secondary'
                    title='Loguer ce trackable (onglet Loguer)'
                    onClick={() => onLog(trackable.reference_code)}
                >
                    Loguer
                </button>
            </span>
        </div>
    );
};
