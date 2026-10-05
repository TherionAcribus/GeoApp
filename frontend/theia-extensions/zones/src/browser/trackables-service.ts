import { inject, injectable } from '@theia/core/shared/inversify';
import { BackendApiClient } from './backend-api-client';

/** Résumé liste d'un trackable (`to_list_dict` : inventaire, inventaire d'une cache). */
export interface TrackableListItem {
    reference_code: string;
    name: string | null;
    icon_url: string | null;
    type_id: number | null;
    type_name: string | null;
    owner_username: string | null;
    has_tracking_code: boolean;
    last_cache_log_action: string | null;
    updated_at: string | null;
}

export interface TrackableInventoryResponse {
    trackables: TrackableListItem[];
    total: number;
    last_sync_at: string | null;
    stale: boolean;
    sync_error: string | null;
    empty_remote_guarded: boolean;
}

export interface TrackableGeocacheInventoryResponse {
    gc_code: string;
    trackables: TrackableListItem[];
    total: number;
    synced_at: string | null;
    stale: boolean;
    refreshed: boolean;
    sync_error: string | null;
    empty_remote_guarded: boolean;
}

export interface TrackableLookupResponse {
    trackable: Record<string, unknown>;
    tracking_code_matched: boolean;
}

export interface TrackableLogTypeOption {
    id: number;
    label: string | null;
}

/** Ce que la page de log d'un TB autorise à l'instant T (`GET /<TB>/log-info`). */
export interface TrackableLogInfo {
    reference_code: string;
    allowed_log_type_ids: number[];
    allowed_log_types: TrackableLogTypeOption[];
    current_geocache_code: string | null;
    current_geocache_name: string | null;
    name: string | null;
    owner_username: string | null;
    parse_warnings: string[];
    has_tracking_code: boolean;
}

export interface TrackableDetailResponse {
    trackable: Record<string, unknown>;
    details: Record<string, unknown>;
}

/** Corps accepté par `POST /api/trackables/<TB>/logs` (cf. blueprint). */
export interface TrackableLogSubmission {
    logType: number;
    text: string;
    /** `YYYY-MM-DD`. */
    date: string;
    trackingCode?: string;
    geocacheCode?: string;
    /** Conflit de localisation explicitement confirmé par l'utilisateur. */
    locationConflictConfirmed?: boolean;
    /** Idempotence côté backend : rejoue la même réponse pour un même id. */
    operationId?: string;
}

/** Client de `/api/trackables` (voir documentation/trackables-technique.md). */
@injectable()
export class TrackablesService {
    constructor(
        @inject(BackendApiClient) protected readonly apiClient: BackendApiClient
    ) {}

    /** Mon inventaire ; `refresh` relit le site, `maxAgeSeconds` seulement si périmé. */
    async getInventory(options: { refresh?: boolean; maxAgeSeconds?: number } = {}): Promise<TrackableInventoryResponse> {
        const query = options.refresh ? 'refresh=1' : `max_age=${options.maxAgeSeconds ?? 86400}`;
        return this.apiClient.requestJson<TrackableInventoryResponse>(
            `/api/trackables/inventory?${query}`, {}, "Erreur lors du chargement de l'inventaire"
        );
    }

    /** TBs déclarés dans une cache, même politique de fraîcheur que l'inventaire. */
    async getGeocacheInventory(
        gcCode: string,
        options: { refresh?: boolean; maxAgeSeconds?: number } = {}
    ): Promise<TrackableGeocacheInventoryResponse> {
        const query = options.refresh ? 'refresh=1' : `max_age=${options.maxAgeSeconds ?? 86400}`;
        return this.apiClient.requestJson<TrackableGeocacheInventoryResponse>(
            `/api/trackables/geocache/${encodeURIComponent(gcCode)}?${query}`, {},
            'Erreur lors du chargement des trackables de la cache'
        );
    }

    /** Retrouve un TB par code public ou code de suivi (POST : jamais dans une URL). */
    async lookup(code: string): Promise<TrackableLookupResponse> {
        return this.apiClient.requestJson<TrackableLookupResponse>(
            '/api/trackables/lookup',
            this.apiClient.createJsonInit('POST', { code }),
            'Erreur lors de la recherche du trackable'
        );
    }

    /** Fiche détaillée d'un TB (code public), résumé + page HTML assainie. */
    async getTrackable(code: string, refresh = false): Promise<TrackableDetailResponse> {
        return this.apiClient.requestJson<TrackableDetailResponse>(
            `/api/trackables/${encodeURIComponent(code)}${refresh ? '?refresh=1' : ''}`,
            {},
            'Erreur lors du chargement de la fiche du trackable'
        );
    }

    /** Types de log autorisés et cache courante, d'après la page de log du TB. */
    async getLogInfo(code: string): Promise<TrackableLogInfo> {
        return this.apiClient.requestJson<TrackableLogInfo>(
            `/api/trackables/${encodeURIComponent(code)}/log-info`,
            {},
            'Erreur lors de la lecture de la page de log du trackable'
        );
    }

    /**
     * Logue un TB seul (découvert, retiré, pris…). Action publique sur
     * Geocaching.com : le corps est validé par le backend (types autorisés relus).
     */
    async postLog(code: string, submission: TrackableLogSubmission): Promise<Record<string, unknown>> {
        return this.apiClient.requestJson<Record<string, unknown>>(
            `/api/trackables/${encodeURIComponent(code)}/logs`,
            this.apiClient.createJsonInit('POST', submission),
            "Erreur lors de l'envoi du log du trackable"
        );
    }
}
