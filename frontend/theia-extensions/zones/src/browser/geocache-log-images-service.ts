/**
 * Téléchargement des photos jointes aux logs.
 *
 * Deux choses à ne pas confondre, exactement comme pour les logs eux-mêmes :
 * - **connaître** une photo (son URL, son titre) est gratuit — le
 *   rafraîchissement des logs le fait déjà, sans rien télécharger ;
 * - **la stocker** coûte une requête vers Geocaching.com et de la place disque,
 *   mais c'est ce qui la rend consultable hors ligne, sur le terrain.
 *
 * Ce service ne s'occupe que du second, et c'est lui qui porte la règle de la
 * préférence `geoApp.logs.downloadImages`. Tant qu'une photo n'est pas stockée,
 * rien ne doit l'afficher : son `source_url` pointe vers Geocaching.com, et
 * l'utiliser dans un `<img>` viderait la préférence de son sens — elle ne
 * couperait plus que l'écriture disque, pas le trafic.
 */
import { inject, injectable } from '@theia/core/shared/inversify';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { BackendApiClient } from './backend-api-client';
import { GeocacheLogDto, GeocacheLogImageDto } from './geocache-logs-types';

export const LOGS_DOWNLOAD_IMAGES_PREF = 'geoApp.logs.downloadImages';

/** Réponse de `POST /api/geocaches/<id>/logs/<logId>/images/store`. */
export interface LogImagesStoreResult {
    geocache_id: number;
    log_id: number;
    /** Nombre de photos effectivement téléchargées par cet appel. */
    stored: number;
    failed: { id: number; error: string }[];
    /** Toutes les photos du log, à jour. */
    images: GeocacheLogImageDto[];
}

/** Photos que le log annonce mais qui ne sont pas encore sur disque. */
export function pendingImages(log: GeocacheLogDto): GeocacheLogImageDto[] {
    return (log.images ?? []).filter(image => !image.stored);
}

/** Un log a-t-il des photos à télécharger ? */
export function hasPendingImages(log: GeocacheLogDto): boolean {
    return pendingImages(log).length > 0;
}

@injectable()
export class GeocacheLogImagesService {

    /**
     * Logs dont le téléchargement a déjà été tenté dans cette session.
     *
     * Sans cette mémoire, un log dont les photos échouent (retirées de
     * Geocaching.com, format exotique) serait retenté à chaque rendu du
     * panneau : la condition de déclenchement — « il reste des photos non
     * stockées » — resterait vraie indéfiniment.
     */
    protected readonly attempted = new Set<number>();

    /**
     * Les téléchargements s'enchaînent au lieu de partir en parallèle.
     *
     * Une page de logs en affiche vingt-cinq, dont facilement six avec photos :
     * sans file d'attente, ouvrir un panneau lancerait six téléchargements
     * simultanés vers Geocaching.com, pour des images que l'utilisateur n'a
     * même pas encore fait défiler.
     */
    protected queue: Promise<unknown> = Promise.resolve();

    constructor(
        @inject(BackendApiClient) protected readonly apiClient: BackendApiClient,
        @inject(PreferenceService) protected readonly preferenceService: PreferenceService
    ) { }

    /** Faut-il télécharger les photos sans que l'utilisateur le demande ? */
    shouldAutoDownload(): boolean {
        return this.preferenceService.get<boolean>(LOGS_DOWNLOAD_IMAGES_PREF, true) !== false;
    }

    /**
     * Télécharge les photos d'un log et les range sur disque.
     *
     * Les erreurs remontent : l'appelant sait, lui, si le téléchargement était
     * explicite (message d'erreur) ou automatique (échec discret).
     */
    async storeForLog(geocacheId: number, logId: number): Promise<LogImagesStoreResult> {
        this.attempted.add(logId);
        return this.apiClient.requestJson<LogImagesStoreResult>(
            `/api/geocaches/${geocacheId}/logs/${logId}/images/store`,
            this.apiClient.createJsonInit('POST'),
            'Impossible de télécharger les photos du log'
        );
    }

    /**
     * Téléchargement demandé par l'utilisateur, sérialisé derrière les autres.
     *
     * Passe outre la préférence — c'est précisément le « quand même,
     * ponctuellement » qu'elle laisse ouvert — mais pas la file d'attente.
     */
    async requestForLog(geocacheId: number, logId: number): Promise<LogImagesStoreResult> {
        const run = this.queue.then(() => this.storeForLog(geocacheId, logId));
        this.queue = run.catch(() => undefined);
        return run;
    }

    /**
     * Téléchargement automatique d'un log, si la préférence l'autorise.
     *
     * Renvoie `undefined` quand il n'y a rien à faire ; les erreurs sont
     * avalées (l'utilisateur n'a rien demandé) mais tracées en console.
     */
    async autoStoreForLog(
        geocacheId: number,
        log: GeocacheLogDto
    ): Promise<LogImagesStoreResult | undefined> {
        if (!this.shouldAutoDownload() || !hasPendingImages(log) || this.attempted.has(log.id)) {
            return undefined;
        }

        const run = this.queue.then(async () => {
            try {
                return await this.storeForLog(geocacheId, log.id);
            } catch (error) {
                console.error('[GeocacheLogImagesService] Auto-download failed', log.id, error);
                return undefined;
            }
        });

        // La file continue même si un maillon échoue.
        this.queue = run.catch(() => undefined);
        return run;
    }

    /**
     * Efface du disque les photos d'une géocache, sans perdre les logs.
     * Les photos restent listées, avec le bouton pour les récupérer à nouveau.
     */
    async clearForGeocache(geocacheId: number): Promise<{ cleared: number }> {
        this.attempted.clear();
        return this.apiClient.requestJson<{ cleared: number }>(
            `/api/geocaches/${geocacheId}/logs/images`,
            this.apiClient.createJsonInit('DELETE'),
            'Impossible de supprimer les photos des logs'
        );
    }
}
