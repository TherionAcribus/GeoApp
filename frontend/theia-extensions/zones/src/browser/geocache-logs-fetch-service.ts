/**
 * Récupération des logs d'une géocache depuis Geocaching.com.
 *
 * Deux choses se ressemblent mais n'ont rien à voir :
 * - lire les logs **stockés** (`GET /logs`) : gratuit, immédiat ;
 * - les **récupérer** sur Geocaching.com (`POST /logs/refresh`) : deux requêtes
 *   vers le site (le userToken est caché côté backend), trois quand la page de
 *   la cache doit être retéléchargée — plusieurs secondes dans tous les cas.
 *
 * Ce service ne s'occupe que du second. Il est partagé par le panneau Logs et la
 * fiche géocache pour que le « premier chargement automatique » obéisse aux
 * mêmes règles où qu'il soit déclenché.
 */
import { inject, injectable } from '@theia/core/shared/inversify';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { BackendApiClient } from './backend-api-client';

export const LOGS_AUTO_FETCH_TRIGGER_PREF = 'geoApp.logs.autoFetchTrigger';
export const LOGS_INITIAL_FETCH_COUNT_PREF = 'geoApp.logs.initialFetchCount';

/** Valeurs de `geoApp.logs.autoFetchTrigger`. */
export type LogsAutoFetchTrigger = 'logs-panel' | 'geocache-open' | 'off';

/** D'où part une tentative de chargement automatique. */
export type LogsAutoFetchContext = 'logs-panel' | 'geocache-open';

export const DEFAULT_LOGS_AUTO_FETCH_TRIGGER: LogsAutoFetchTrigger = 'logs-panel';

/**
 * Taille de page utilisée pour « charger la suite » et pour « tout charger ».
 * Aligne le frontend sur `MAX_LOGS_PER_PAGE` du client backend : demander plus
 * dans un seul appel ne sert à rien, le logbook pagine de toute façon.
 */
export const LOGS_PAGE_SIZE = 100;

/** Valeurs proposées par `geoApp.logs.initialFetchCount`. */
export const LOGS_FETCH_COUNTS = [20, 50, LOGS_PAGE_SIZE];

export interface LogsRefreshOptions {
    /** Taille de page demandée. Par défaut, la préférence utilisateur. */
    count?: number;
    /** Page 1-based du logbook (pas un offset en nombre de logs). */
    page?: number;
    /** Enchaîner les pages jusqu'au bout — sur demande explicite seulement. */
    all?: boolean;
}

export interface LogsRefreshResult {
    geocache_id: number;
    gc_code: string;
    message: string;
    added: number;
    updated: number;
    replaced_local?: number;
    friends: number;
    friends_check_failed?: boolean;
    /** Nombre de logs désormais stockés localement. */
    total: number;
    /** Nombre de logs de la cache sur Geocaching.com, `null` si inconnu. */
    total_available?: number | null;
    /** `true` si « tout charger » s'est arrêté sur le plafond de sécurité. */
    truncated?: boolean;
}

@injectable()
export class GeocacheLogsFetchService {

    /**
     * Géocaches déjà tentées pendant cette session.
     *
     * Sans cette mémoire, une cache qui n'a réellement aucun log (ou dont la
     * récupération échoue) serait re-scrapée à chaque ouverture, puisque la
     * condition de déclenchement — « aucun log stocké » — resterait vraie.
     */
    protected readonly attempted = new Set<number>();

    /**
     * Les récupérations automatiques s'enchaînent au lieu de partir en parallèle :
     * en navigation rapide d'une cache à l'autre, on ne veut pas dix scrapings
     * simultanés vers Geocaching.com.
     */
    protected queue: Promise<unknown> = Promise.resolve();

    constructor(
        @inject(BackendApiClient) protected readonly apiClient: BackendApiClient,
        @inject(PreferenceService) protected readonly preferenceService: PreferenceService
    ) { }

    getTrigger(): LogsAutoFetchTrigger {
        const value = this.preferenceService.get<string>(
            LOGS_AUTO_FETCH_TRIGGER_PREF,
            DEFAULT_LOGS_AUTO_FETCH_TRIGGER
        );
        return value === 'geocache-open' || value === 'off' ? value : DEFAULT_LOGS_AUTO_FETCH_TRIGGER;
    }

    /** Nombre de logs à récupérer par défaut (« Tout » = `LOGS_PAGE_SIZE`). */
    getFetchCount(): number {
        const value = Number(this.preferenceService.get<number>(LOGS_INITIAL_FETCH_COUNT_PREF, 50));
        return LOGS_FETCH_COUNTS.includes(value) ? value : 50;
    }

    /**
     * Le chargement automatique n'a lieu qu'au premier contact avec une géocache :
     * une fois des logs stockés, c'est à l'utilisateur de demander un
     * rafraîchissement, sinon chaque ouverture de fiche taperait sur le site.
     *
     * Le panneau Logs déclenche aussi en mode « à l'ouverture de la géocache » :
     * c'est le filet de sécurité du cas où la fiche n'a jamais été ouverte (on
     * arrive sur les logs depuis le tableau) ou où la tâche de fond a échoué.
     * Ouvrir le panneau Logs, c'est de toute façon demander à voir les logs.
     */
    shouldAutoFetch(context: LogsAutoFetchContext, geocacheId: number, storedCount: number): boolean {
        const trigger = this.getTrigger();
        const triggered = context === 'logs-panel' ? trigger !== 'off' : trigger === context;
        return triggered
            && storedCount === 0
            && !this.attempted.has(geocacheId);
    }

    /** Marque une géocache comme déjà servie (après un rafraîchissement manuel). */
    markAttempted(geocacheId: number): void {
        this.attempted.add(geocacheId);
    }

    /**
     * Récupère les logs sur Geocaching.com et les enregistre côté backend.
     *
     * Les erreurs remontent telles quelles : l'appelant sait, lui, si l'action
     * était explicite (message d'erreur) ou automatique (échec discret).
     */
    async refresh(geocacheId: number, options: LogsRefreshOptions = {}): Promise<LogsRefreshResult> {
        this.markAttempted(geocacheId);

        const params = new URLSearchParams();
        params.set('count', String(options.count ?? this.getFetchCount()));
        if (options.page && options.page > 1) {
            params.set('page', String(options.page));
        }
        if (options.all) {
            params.set('all', 'true');
        }

        return this.apiClient.requestJson<LogsRefreshResult>(
            `/api/geocaches/${geocacheId}/logs/refresh?${params.toString()}`,
            this.apiClient.createJsonInit('POST'),
            'Impossible de récupérer les logs depuis Geocaching.com'
        );
    }

    /**
     * Récupération automatique, sérialisée derrière les précédentes.
     *
     * Renvoie `undefined` si les conditions ne sont pas réunies ; les erreurs
     * sont avalées (c'est une action que l'utilisateur n'a pas demandée) mais
     * tracées en console.
     */
    async autoFetch(
        context: LogsAutoFetchContext,
        geocacheId: number,
        storedCount: number
    ): Promise<LogsRefreshResult | undefined> {
        if (!this.shouldAutoFetch(context, geocacheId, storedCount)) {
            return undefined;
        }

        const run = this.queue.then(async () => {
            try {
                return await this.refresh(geocacheId);
            } catch (error) {
                console.error('[GeocacheLogsFetchService] Auto-fetch failed', geocacheId, error);
                return undefined;
            }
        });

        // La file continue même si un maillon échoue.
        this.queue = run.catch(() => undefined);
        return run;
    }

    /**
     * Page à demander pour obtenir les logs qui suivent ceux déjà stockés.
     * Le logbook pagine par numéro de page, pas par offset : on convertit ici.
     */
    nextPageFor(storedCount: number, pageSize: number = LOGS_PAGE_SIZE): number {
        return Math.floor(Math.max(0, storedCount) / Math.max(1, pageSize)) + 1;
    }
}
