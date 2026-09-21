/**
 * Widget pour afficher les logs (commentaires) d'une géocache.
 * 
 * Ce widget peut être affiché dans le panneau droit, en bas, ou dans la zone principale.
 * Il permet de visualiser les logs récupérés depuis Geocaching.com et de les rafraîchir.
 */
import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { StatefulWidget } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { LanguageModelRegistry, LanguageModelService, UserRequest, getTextOfResponse, getJsonOfResponse, isLanguageModelParsedResponse } from '@theia/ai-core';
import { GeoAppLogsAnalyzerAgentId } from './geoapp-logs-analyzer-agent';
import { LogsRecentSummary, LogSummaryEntry, LogsRecentSummaryApiResponse } from './geocache-logs-summary';
import { EmptyState, LoadingState } from './state-views';
import { getLogTypeColor, getLogTypeIcon } from './geocache-log-type-style';
import { renderLogMarkdown } from './log-markdown-renderer';
import '../../src/browser/style/logs-panel.css';
import {
    GeocacheLogsFetchService,
    LOGS_PAGE_SIZE,
    LogsRefreshOptions
} from './geocache-logs-fetch-service';
import { GeocacheLogDto, LOGS_ANALYSIS_MAX_LOGS, LogsApiResponse } from './geocache-logs-types';
import { GeocacheDetailsTracker } from './geocache-details-tracker';
import {
    describeGeocacheTab,
    GeocacheTabRef,
    LOGS_PANEL_SYNC_MODE_PREF,
    LogsPanelSyncMode,
    normalizeLogsPanelSyncMode
} from './geocache-logs-scope';
import { LogsScopeBanner } from './geocache-logs-scope-banner';
import { GeocacheLogImagesService, hasPendingImages } from './geocache-log-images-service';
import { LogImages } from './geocache-log-images';
import {
    GeocacheLogsAnalysisDto,
    GeocacheLogsAnalysisInput,
    GeocacheLogsAnalysisService
} from './geocache-logs-analysis-service';
import { buildLogsAnalysisPrompt, describeAnalysisScope } from './geocache-logs-analysis-prompt';
import { LogsAnalysisPanel } from './geocache-logs-analysis-view';
import { VirtualizedList } from './virtualized-list';

/**
 * Props pour le composant LogItem
 */
interface LogItemProps {
    log: GeocacheLogDto;
    /** Résout une URL relative du backend en URL absolue. */
    resolveUrl: (url: string) => string;
    /** Téléchargement des photos demandé explicitement sur ce log. */
    onDownloadImages: (log: GeocacheLogDto) => void;
    isDownloadingImages: boolean;
    /**
     * Repli « Voir plus ». Porté par la liste : la virtualisation démonte les
     * cartes hors champ, et un état local serait perdu au démontage.
     */
    expanded: boolean;
    onToggleExpand: () => void;
}

/**
 * Formate une date ISO en format lisible
 */
function formatDate(dateStr: string | null): string {
    if (!dateStr) {
        return 'Date inconnue';
    }
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('fr-FR', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });
    } catch {
        return dateStr;
    }
}

const LOG_TEXT_FONT_SIZE = 13;
const LOG_TEXT_LINE_HEIGHT = 1.5;

/** Nombre de lignes visibles d'un log replié. */
const COLLAPSED_TEXT_MAX_LINES = 6;

/**
 * Hauteur d'un log replié, en pixels.
 *
 * Exprimer le repli en lignes plutôt qu'en caractères donne des cartes de hauteur
 * régulière quel que soit le contenu (listes, citations, blocs de code), là où une
 * troncature à N caractères produisait des hauteurs très variables.
 */
const COLLAPSED_TEXT_MAX_HEIGHT = Math.round(
    LOG_TEXT_FONT_SIZE * LOG_TEXT_LINE_HEIGHT * COLLAPSED_TEXT_MAX_LINES
);

/** Fondu de bas de bloc appliqué à un log replié qui déborde. */
const COLLAPSED_TEXT_MASK = 'linear-gradient(to bottom, black calc(100% - 20px), transparent)';

/**
 * Composant pour afficher un seul log
 */
const LogItem: React.FC<LogItemProps> = ({
    log, resolveUrl, onDownloadImages, isDownloadingImages, expanded, onToggleExpand
}) => {
    const color = getLogTypeColor(log.log_type);
    const icon = getLogTypeIcon(log.log_type);
    const [isOverflowing, setIsOverflowing] = React.useState(false);
    const textRef = React.useRef<HTMLDivElement | null>(null);

    // Le repli est visuel : le Markdown est toujours rendu en entier, et seule la
    // hauteur du conteneur est bornée. Couper la chaîne avant le rendu laissait des
    // délimiteurs orphelins (`**gras` sans sa fermeture s'affichait littéralement)
    // et tombait au milieu d'un mot.
    // `scrollHeight` reste la hauteur du contenu complet, y compris replié : la même
    // mesure vaut donc dans les deux états, et le bouton ne disparaît pas au dépliage.
    React.useLayoutEffect(() => {
        const element = textRef.current;
        if (!element) {
            setIsOverflowing(false);
            return;
        }
        const measure = () => setIsOverflowing(element.scrollHeight > COLLAPSED_TEXT_MAX_HEIGHT + 1);
        measure();

        // La largeur du panneau décide du nombre de lignes : un texte qui tient
        // replié dans un panneau large déborde dans un panneau étroit.
        if (typeof ResizeObserver === 'undefined') {
            return;
        }
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [log.text]);

    const images = log.images ?? [];

    const textClassName = [
        'geoapp-log-card__text',
        expanded ? '' : 'geoapp-log-card__text--collapsed',
        !expanded && isOverflowing ? 'geoapp-log-card__text--faded' : '',
    ].filter(Boolean).join(' ');

    return (
        <div
            className={`geoapp-log-card${log.is_own_log ? ' geoapp-log-card--own' : ''}`}
            // Couleur issue du type de log : une donnée, pas un choix de design.
            style={{ ['--geoapp-log-color' as any]: color }}
        >
            {/* En-tête du log */}
            <div className='geoapp-log-card__header'>
                <div className='geoapp-log-card__identity'>
                    {/* Icône du type */}
                    <span className='geoapp-log-card__icon'>
                        <i className={`fa ${icon}`} />
                    </span>

                    {/* Type et auteur */}
                    <div>
                        <div className='geoapp-log-card__type'>
                            {log.log_type}
                            {log.is_favorite && (
                                <span className='geoapp-log-card__favorite' title='Favori'>
                                    <i className='fa fa-star' />
                                </span>
                            )}
                        </div>
                        <div className='geoapp-log-card__author'>
                            par <strong>{log.author}</strong>
                            {log.is_own_log && (
                                <span
                                    className='geoapp-log-card__own-badge'
                                    title='Log écrit avec votre compte Geocaching.com'
                                >
                                    <i className='fa fa-user-check' />
                                    vous
                                </span>
                            )}
                            {log.is_friend_log && (
                                <span
                                    className='geoapp-log-card__friend-badge'
                                    title='Log écrit par un de vos amis Geocaching.com'
                                >
                                    <i className='fa fa-user-friends' />
                                    ami
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Date */}
                <div className='geoapp-log-card__date'>
                    {formatDate(log.date)}
                </div>
            </div>

            {/* Texte du log, puis ses photos */}
            {(log.text || images.length > 0) && (
                <div className='geoapp-log-card__body'>
                    {log.text && (
                        <>
                            <div
                                ref={textRef}
                                className={textClassName}
                                // Le seuil de repli vit dans le TSX (il sert aussi de seuil de
                                // mesure) et descend dans la feuille par cette variable.
                                style={{ ['--geoapp-log-collapsed-height' as any]: `${COLLAPSED_TEXT_MAX_HEIGHT}px` }}
                            >
                                {renderLogMarkdown(log.text, `log-${log.id}`)}
                            </div>
                            {isOverflowing && (
                                <button
                                    className='geoapp-log-card__toggle'
                                    onClick={onToggleExpand}
                                >
                                    {expanded ? 'Voir moins' : 'Voir plus'}
                                </button>
                            )}
                        </>
                    )}

                    {/* Hors du bloc de texte, et c'est structurel : ce bloc est
                        mesuré au montage pour décider du bouton « Voir plus », et
                        des images qui se chargent en asynchrone fausseraient la
                        mesure après coup. */}
                    <LogImages
                        images={images}
                        resolveUrl={resolveUrl}
                        onDownload={() => onDownloadImages(log)}
                        isDownloading={isDownloadingImages}
                    />
                </div>
            )}
        </div>
    );
};

/**
 * Props pour le composant LogsList
 */
interface LogsListProps {
    logs: GeocacheLogDto[];
    isLoading: boolean;
    onLoadMore?: () => void;
    hasMore: boolean;
    resolveUrl: (url: string) => string;
    onDownloadImages: (log: GeocacheLogDto) => void;
    /** Identifiants des logs dont les photos sont en cours de téléchargement. */
    downloadingImageLogIds: ReadonlySet<number>;
    /** Récupération sur Geocaching.com, proposée quand rien n'est stocké. */
    onRefresh: () => void;
    isRefreshing: boolean;
}

/**
 * Composant pour afficher la liste des logs
 */
const LogsList: React.FC<LogsListProps> = ({
    logs, isLoading, onLoadMore, hasMore, resolveUrl, onDownloadImages, downloadingImageLogIds,
    onRefresh, isRefreshing
}) => {
    // Cartes dépliées : hors de `LogItem`, dont le montage dépend du défilement.
    const [expandedLogIds, setExpandedLogIds] = React.useState<ReadonlySet<number>>(new Set());

    if (isLoading && logs.length === 0) {
        return <LoadingState message='Chargement des logs…' />;
    }

    if (logs.length === 0) {
        // « Aucun log » tout court laissait croire à une géocache jamais loguée.
        // Le plus souvent, rien n'a encore été récupéré depuis Geocaching.com :
        // c'est ce qu'il faut dire, avec le bouton qui le fait.
        return (
            <EmptyState
                icon='fa-comments'
                title='Aucun log stocké pour cette géocache'
                description={
                    'Les logs sont lus dans la base locale de GeoApp. '
                    + '« Rafraîchir » va les chercher sur Geocaching.com — '
                    + "à moins que la géocache n'en ait réellement aucun."
                }
                action={
                    <button
                        className='geoapp-logs-panel__button'
                        onClick={onRefresh}
                        disabled={isRefreshing}
                    >
                        <i className={`fa ${isRefreshing ? 'fa-spinner fa-spin' : 'fa-sync-alt'}`} />
                        {isRefreshing ? 'Rafraîchissement...' : 'Récupérer les logs'}
                    </button>
                }
            />
        );
    }

    return (
        <div>
            <VirtualizedList
                items={logs}
                itemKey={log => log.id}
                // Carte repliée typique : en-tête, six lignes de texte, marges.
                estimatedItemHeight={200}
                overscan={800}
                renderItem={log => (
                    <LogItem
                        log={log}
                        resolveUrl={resolveUrl}
                        onDownloadImages={onDownloadImages}
                        isDownloadingImages={downloadingImageLogIds.has(log.id)}
                        expanded={expandedLogIds.has(log.id)}
                        onToggleExpand={() => setExpandedLogIds(previous => {
                            const next = new Set(previous);
                            if (next.has(log.id)) {
                                next.delete(log.id);
                            } else {
                                next.add(log.id);
                            }
                            return next;
                        })}
                    />
                )}
            />

            {hasMore && (
                <button
                    className='geoapp-logs-load-more'
                    onClick={onLoadMore}
                    disabled={isLoading}
                >
                    {isLoading ? (
                        <>
                            <i className='fa fa-spinner fa-spin' />
                            Chargement...
                        </>
                    ) : (
                        <>
                            <i className='fa fa-chevron-down' />
                            Charger plus de logs
                        </>
                    )}
                </button>
            )}
        </div>
    );
};

/**
 * Props du bandeau « il reste des logs sur Geocaching.com »
 */
interface RemoteLogsBannerProps {
    storedCount: number;
    totalAvailable: number;
    isRefreshing: boolean;
    onLoadNextPage: () => void;
    onLoadAll: () => void;
}

/**
 * Bandeau proposant de récupérer les logs qui n'ont pas été chargés.
 *
 * Il n'apparaît que quand on *sait* qu'il en reste : le réglage « Tout » est
 * plafonné, et c'est ici que l'utilisateur décide d'aller au-delà — page par
 * page, ou d'un coup en connaissance du nombre.
 */
const RemoteLogsBanner: React.FC<RemoteLogsBannerProps> = ({
    storedCount, totalAvailable, isRefreshing, onLoadNextPage, onLoadAll
}) => {
    const remaining = totalAvailable - storedCount;
    const nextBatch = Math.min(LOGS_PAGE_SIZE, remaining);

    return (
        <div className='geoapp-logs-remote-banner'>
            <div className='geoapp-logs-remote-banner__text'>
                <i className='fa fa-cloud-download-alt' />
                Cette géocache compte <strong>{totalAvailable}</strong> logs sur Geocaching.com,
                dont <strong>{storedCount}</strong> chargé{storedCount > 1 ? 's' : ''} ici.
            </div>
            <div className='geoapp-logs-remote-banner__actions'>
                <button
                    className='geoapp-logs-remote-banner__button'
                    onClick={onLoadNextPage}
                    disabled={isRefreshing}
                >
                    <i className='fa fa-chevron-down' />
                    Charger {nextBatch} de plus
                </button>
                <button
                    className='geoapp-logs-remote-banner__button'
                    onClick={onLoadAll}
                    disabled={isRefreshing}
                >
                    <i className='fa fa-cloud-download-alt' />
                    Tout charger ({totalAvailable})
                </button>
            </div>
        </div>
    );
};

/**
 * Widget Theia pour afficher les logs d'une géocache
 */
@injectable()
export class GeocacheLogsWidget extends ReactWidget implements StatefulWidget {
    static readonly ID = 'geocache.logs.widget';

    protected backendBaseUrl = 'http://localhost:8000';
    protected geocacheId?: number;
    protected geocacheCode?: string;
    protected geocacheName?: string;
    protected logs: GeocacheLogDto[] = [];
    protected totalCount = 0;
    /**
     * Nombre de logs stockés, filtre « Amis » exclu.
     *
     * `totalCount` suit le filtre courant : sous « Amis » il tombe à trois logs
     * alors que la base en contient trois cents. L'analyse IA, elle, porte sur
     * tout le stock — c'est donc ce compteur-ci qu'elle annonce et qu'elle
     * compare pour savoir si elle a vieilli.
     */
    protected storedLogsCount = 0;
    /** Logs que la cache possède sur Geocaching.com, `undefined` si inconnu. */
    protected totalAvailable?: number;
    /** Nombre de logs d'amis : ce que le filtre « Amis » affichera. */
    protected friendsCount = 0;
    /**
     * Nombre d'amis distincts derrière ces logs.
     *
     * C'est lui qui est affiché sur le bouton, pour parler le même langage que
     * le bandeau « vos amis ont trouvé » de la fiche : un ami qui poste un
     * Found puis une note ne doit pas y compter double.
     */
    protected friendsFindersCount = 0;
    protected friendsOnly = false;
    protected ownCount = 0;
    protected ownOnly = false;
    protected isLoading = false;
    protected isRefreshing = false;
    protected isAnalyzing = false;
    /** Analyse IA stockée pour cette géocache, `undefined` si elle n'en a pas. */
    protected analysis?: GeocacheLogsAnalysisDto;
    /** Logs dont les photos sont en cours de téléchargement. */
    protected downloadingImageLogIds = new Set<number>();
    protected offset = 0;
    protected limit = 25;
    protected summaryEntries: LogSummaryEntry[] = [];
    protected summaryTotalCount = 0;
    protected isSummaryLoading = false;
    /**
     * En mode « suivre l'onglet actif », vrai quand l'utilisateur a demandé une
     * autre géocache depuis le bandeau.
     *
     * Sans ce drapeau, le suivi reprendrait la main au premier changement
     * d'onglet et le choix explicite ne tiendrait pas une seconde — le bandeau
     * offre donc un « Reprendre le suivi » plutôt qu'un choix qui s'annule seul.
     */
    protected followSuspended = false;

    constructor(
        @inject(MessageService) protected readonly messages: MessageService,
        @inject(PreferenceService) protected readonly preferenceService: PreferenceService,
        @inject(GeocacheDetailsTracker) protected readonly detailsTracker: GeocacheDetailsTracker,
        @inject(GeocacheLogsFetchService) protected readonly logsFetchService: GeocacheLogsFetchService,
        @inject(GeocacheLogsAnalysisService) protected readonly analysisService: GeocacheLogsAnalysisService,
        @inject(GeocacheLogImagesService) protected readonly logImagesService: GeocacheLogImagesService,
        @inject(LanguageModelRegistry) protected readonly languageModelRegistry: LanguageModelRegistry,
        @inject(LanguageModelService) protected readonly languageModelService: LanguageModelService
    ) {
        super();
        this.id = GeocacheLogsWidget.ID;
        this.title.label = 'Logs';
        this.title.caption = 'Logs de la géocache';
        this.title.closable = true;
        this.title.iconClass = 'fa fa-comments';
        this.addClass('theia-geocache-logs-widget');
    }

    @postConstruct()
    initialize(): void {
        // Écouter les événements de sélection de géocache
        this.addGlobalEventListeners();

        this.toDispose.push(this.detailsTracker.onDidChangeActive(() => this.handleActiveGeocacheChanged()));
        this.toDispose.push(this.preferenceService.onPreferenceChanged(event => {
            if (event.preferenceName !== LOGS_PANEL_SYNC_MODE_PREF) {
                return;
            }
            // Changer de mode remet le suivi à zéro : la suspension décrivait
            // l'ancien réglage.
            this.followSuspended = false;
            this.syncWithActiveTab();
            this.update();
        }));
    }

    protected onAfterAttach(msg: any): void {
        super.onAfterAttach(msg);
        // `onBeforeDetach` les retire : sans cette reprise, fermer puis rouvrir
        // le panneau le coupait définitivement des événements globaux — un log
        // envoyé n'y apparaissait plus. Réenregistrer la même fonction sur le
        // même type est sans effet, l'appel du `postConstruct` reste donc valide.
        this.addGlobalEventListeners();
        this.syncWithActiveTab();
    }

    /**
     * Le panneau latéral peut être replié sans être détaché : le rouvrir doit
     * le remettre en phase avec l'onglet actif, sinon il affiche les logs de la
     * géocache qui était au premier plan au moment du repli.
     */
    protected onAfterShow(msg: any): void {
        super.onAfterShow(msg);
        this.syncWithActiveTab();
    }

    /** Mode de suivi courant, tel que la préférence le décrit. */
    protected getSyncMode(): LogsPanelSyncMode {
        return normalizeLogsPanelSyncMode(this.preferenceService.get<string>(LOGS_PANEL_SYNC_MODE_PREF));
    }

    /**
     * Aligne le panneau sur l'onglet au premier plan, si le réglage le demande.
     *
     * Ne fait rien quand le panneau est fermé : charger les logs d'une géocache
     * que personne ne regarde ne sert à rien et peut coûter un aller-retour vers
     * Geocaching.com (premier chargement automatique).
     */
    protected syncWithActiveTab(): void {
        if (!this.isAttached || !this.isVisible) {
            return;
        }
        if (this.getSyncMode() !== 'follow-active' || this.followSuspended) {
            return;
        }
        const active = this.detailsTracker.getActive();
        if (!active || active.geocacheId === this.geocacheId) {
            return;
        }
        this.setGeocache(active);
    }

    /**
     * L'onglet au premier plan a changé — ou a changé de géocache.
     *
     * En mode « sur demande », rien ne bouge : on se contente de redessiner, le
     * bandeau ayant désormais quelque chose à dire (les logs affichés ne sont
     * plus ceux de la géocache consultée).
     */
    protected handleActiveGeocacheChanged(): void {
        const before = this.geocacheId;
        this.syncWithActiveTab();
        if (this.geocacheId === before && this.isAttached) {
            this.update();
        }
    }

    /**
     * Géocache choisie dans le bandeau.
     *
     * En mode suivi, choisir une autre géocache que celle du premier plan
     * suspend le suivi : sans ça, le choix serait défait au prochain changement
     * d'onglet.
     */
    protected showGeocacheFromBanner = (ref: GeocacheTabRef): void => {
        const active = this.detailsTracker.getActive();
        this.setGeocache(ref, {
            suspendFollow: this.getSyncMode() === 'follow-active'
                && ref.geocacheId !== active?.geocacheId
        });
    };

    /** Reprend le suivi de l'onglet actif après un choix manuel. */
    protected resumeFollow = (): void => {
        this.followSuspended = false;
        const active = this.detailsTracker.getActive();
        if (active && active.geocacheId !== this.geocacheId) {
            this.setGeocache(active);
        } else {
            this.update();
        }
    };

    protected onBeforeDetach(msg: any): void {
        this.removeGlobalEventListeners();
        super.onBeforeDetach(msg);
    }

    private handleGeocacheSelected = (event: CustomEvent<{ geocacheId: number; gcCode?: string; name?: string }>): void => {
        const { geocacheId, gcCode, name } = event.detail;
        this.setGeocache({ geocacheId, gcCode, name });
    };

    /**
     * Le log qu'on vient d'envoyer est déjà inséré en base par le backend :
     * un simple rechargement suffit pour le voir apparaître, sans repasser par
     * `/logs/refresh` (donc sans appel à Geocaching.com).
     */
    private handleGeocacheLogSubmitted = (event: CustomEvent<{ geocacheId: number }>): void => {
        if (!this.geocacheId || event.detail?.geocacheId !== this.geocacheId) {
            return;
        }
        this.offset = 0;
        this.loadSummary();
        this.loadLogs();
    };

    private addGlobalEventListeners(): void {
        if (typeof window === 'undefined') {
            return;
        }
        window.addEventListener('geoapp-geocache-selected', this.handleGeocacheSelected as EventListener);
        window.addEventListener('geoapp-geocache-log-submitted', this.handleGeocacheLogSubmitted as EventListener);
    }

    private removeGlobalEventListeners(): void {
        if (typeof window === 'undefined') {
            return;
        }
        window.removeEventListener('geoapp-geocache-selected', this.handleGeocacheSelected as EventListener);
        window.removeEventListener('geoapp-geocache-log-submitted', this.handleGeocacheLogSubmitted as EventListener);
    }

    /**
     * Définit la géocache dont on veut afficher les logs
     */
    setGeocache(
        params: { geocacheId: number; gcCode?: string; name?: string },
        options: { suspendFollow?: boolean } = {}
    ): void {
        this.followSuspended = options.suspendFollow === true;
        this.geocacheId = params.geocacheId;
        this.geocacheCode = params.gcCode;
        this.geocacheName = params.name;
        this.logs = [];
        this.offset = 0;
        this.totalCount = 0;
        this.storedLogsCount = 0;
        this.totalAvailable = undefined;
        this.friendsCount = 0;
        this.friendsFindersCount = 0;
        this.friendsOnly = false;
        this.ownCount = 0;
        this.ownOnly = false;
        this.analysis = undefined;
        this.summaryEntries = [];
        this.summaryTotalCount = 0;
        this.downloadingImageLogIds.clear();

        this.title.label = params.gcCode ? `Logs - ${params.gcCode}` : 'Logs';

        void this.loadInitial();
    }

    /**
     * Le panneau retrouve sa géocache au redémarrage.
     *
     * Sans ça, rouvrir GeoApp laissait un panneau vide alors que l'utilisateur
     * l'avait délibérément laissé ouvert sur une géocache — et, en mode « sur
     * demande », rien ne venait le remplir.
     */
    storeState(): object | undefined {
        if (!this.geocacheId) {
            return undefined;
        }
        return {
            geocacheId: this.geocacheId,
            gcCode: this.geocacheCode,
            name: this.geocacheName
        };
    }

    restoreState(oldState: object): void {
        const state = oldState as Partial<{ geocacheId: number; gcCode: string; name: string }> | undefined;
        if (!state || typeof state.geocacheId !== 'number') {
            return;
        }
        this.setGeocache({ geocacheId: state.geocacheId, gcCode: state.gcCode, name: state.name });
    }

    /** Identité de la géocache affichée, telle que le bandeau la présente. */
    protected getCurrentRef(): GeocacheTabRef | undefined {
        return this.geocacheId
            ? { geocacheId: this.geocacheId, gcCode: this.geocacheCode, name: this.geocacheName }
            : undefined;
    }

    /**
     * Affiche d'abord ce qui est déjà stocké, puis déclenche le premier
     * chargement depuis Geocaching.com si la géocache n'a encore aucun log.
     *
     * L'ordre compte : sans logs en base, le panneau resterait vide jusqu'à un
     * clic sur « Rafraîchir » — c'est précisément ce que le réglage
     * `geoApp.logs.autoFetchTrigger` évite.
     */
    protected async loadInitial(): Promise<void> {
        const geocacheId = this.geocacheId;
        await Promise.all([this.loadSummary(), this.loadLogs(), this.loadAnalysis()]);
        if (this.geocacheId !== geocacheId) {
            return;
        }
        await this.autoFetchIfNeeded();
    }

    /**
     * Premier chargement automatique, quand le réglage le confie au panneau Logs.
     */
    protected async autoFetchIfNeeded(): Promise<void> {
        const geocacheId = this.geocacheId;
        if (!geocacheId || this.isRefreshing) {
            return;
        }
        if (!this.logsFetchService.shouldAutoFetch('logs-panel', geocacheId, this.totalCount)) {
            return;
        }
        await this.refreshLogs({ auto: true });
    }

    /**
     * Charge le résumé des logs récents depuis le backend
     */
    protected async loadSummary(): Promise<void> {
        if (!this.geocacheId) {
            return;
        }

        this.isSummaryLoading = true;
        this.update();

        try {
            const count = this.preferenceService.get<number>('geoApp.logs.recentSummaryCount', 5);
            const url = `${this.backendBaseUrl}/api/geocaches/${this.geocacheId}/logs/recent-summary?count=${count}`;
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data: LogsRecentSummaryApiResponse = await response.json();
            this.summaryEntries = data.entries;
            this.summaryTotalCount = data.total_count;
        } catch (error) {
            console.error('[GeocacheLogsWidget] Failed to load logs summary:', error);
        } finally {
            this.isSummaryLoading = false;
            this.update();
        }
    }

    /**
     * Charge les logs depuis le backend
     */
    protected async loadLogs(): Promise<void> {
        if (!this.geocacheId || this.isLoading) {
            return;
        }

        this.isLoading = true;
        this.update();

        try {
            const friendsParam = this.friendsOnly ? '&friends_only=true' : '';
            const ownParam = this.ownOnly ? '&own_only=true' : '';
            const url = `${this.backendBaseUrl}/api/geocaches/${this.geocacheId}/logs`
                + `?limit=${this.limit}&offset=${this.offset}${friendsParam}${ownParam}`;
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data: LogsApiResponse = await response.json();

            if (this.offset === 0) {
                this.logs = data.logs;
            } else {
                this.logs = [...this.logs, ...data.logs];
            }

            this.totalCount = data.total_count;
            // Sous les filtres « Amis » et « Mes logs », `total_count` ne compte
            // que le sous-ensemble filtré : on garde le dernier total complet.
            if (!this.friendsOnly && !this.ownOnly) {
                this.storedLogsCount = data.total_count;
            }
            this.totalAvailable = data.total_available ?? undefined;
            this.friendsCount = data.friends_count ?? 0;
            this.friendsFindersCount = data.friends_distinct_count ?? this.friendsCount;
            this.ownCount = data.own_count ?? 0;
            this.geocacheCode = data.gc_code;

            void this.autoDownloadImages();
            
        } catch (error) {
            console.error('[GeocacheLogsWidget] Failed to load logs:', error);
            this.messages.error('Impossible de charger les logs');
        } finally {
            this.isLoading = false;
            this.update();
        }
    }

    /**
     * Bascule entre « tous les logs » et « seulement ceux de mes amis ».
     * Le filtre est appliqué côté serveur pour rester cohérent avec la pagination.
     * Les deux filtres s'excluent : mon log n'est pas un log d'ami.
     */
    protected toggleFriendsOnly = (): void => {
        this.friendsOnly = !this.friendsOnly;
        if (this.friendsOnly) {
            this.ownOnly = false;
        }
        this.offset = 0;
        this.logs = [];
        this.loadLogs();
    };

    /**
     * Bascule entre « tous les logs » et « seulement les miens » — le recours
     * pour retrouver son log dans une géocache très loggée.
     */
    protected toggleOwnOnly = (): void => {
        this.ownOnly = !this.ownOnly;
        if (this.ownOnly) {
            this.friendsOnly = false;
        }
        this.offset = 0;
        this.logs = [];
        this.loadLogs();
    };

    /**
     * Charge plus de logs (pagination)
     */
    protected loadMore = (): void => {
        this.offset += this.limit;
        this.loadLogs();
    };

    /**
     * Récupère les logs depuis Geocaching.com.
     *
     * `auto` distingue le premier chargement automatique d'un clic sur
     * « Rafraîchir » : l'automatique reste discret (pas de message quand il n'a
     * rien ramené, échec silencieux), le manuel parle toujours.
     */
    protected async refreshLogs(options: LogsRefreshOptions & { auto?: boolean } = {}): Promise<void> {
        const geocacheId = this.geocacheId;
        if (!geocacheId || this.isRefreshing) {
            return;
        }

        const { auto, ...fetchOptions } = options;

        this.isRefreshing = true;
        this.update();

        try {
            const data = auto
                ? await this.logsFetchService.autoFetch('logs-panel', geocacheId, this.totalCount)
                : await this.logsFetchService.refresh(geocacheId, fetchOptions);

            // La géocache a pu changer pendant la récupération : ce qui suit ne
            // parlerait plus de ce que le panneau affiche.
            if (!data || this.geocacheId !== geocacheId) {
                return;
            }

            if (!auto || data.added > 0) {
                const friendsInfo = data.friends > 0 ? `, ${data.friends} d'ami(s)` : '';
                this.messages.info(
                    `Logs rafraîchis : ${data.added} ajoutés, ${data.updated} mis à jour${friendsInfo}`
                );
            }

            if (data.truncated) {
                this.messages.warn(
                    `Chargement interrompu à ${data.total} logs : la géocache en compte trop pour tout récupérer d'un coup.`
                );
            }

            // Recharger les logs et le résumé depuis le début
            this.offset = 0;
            await this.loadSummary();
            await this.loadLogs();

        } catch (error) {
            console.error('[GeocacheLogsWidget] Failed to refresh logs:', error);
            if (!auto) {
                this.messages.error(`Impossible de rafraîchir les logs: ${error}`);
            }
        } finally {
            this.isRefreshing = false;
            this.update();
        }
    }

    /**
     * Récupère la page de logs qui suit celles déjà stockées.
     */
    protected loadNextRemotePage = (): void => {
        void this.refreshLogs({
            count: LOGS_PAGE_SIZE,
            page: this.logsFetchService.nextPageFor(this.totalCount)
        });
    };

    /**
     * Récupère tout le logbook, après confirmation : sur une géocache très
     * loggée c'est long, et c'est autant de requêtes vers Geocaching.com.
     */
    protected loadAllRemoteLogs = async (): Promise<void> => {
        const total = this.totalAvailable;
        const confirmed = await this.messages.warn(
            `Récupérer les ${total} logs de cette géocache depuis Geocaching.com ? `
            + "L'opération peut prendre un moment.",
            'Tout charger',
            'Annuler'
        );
        if (confirmed !== 'Tout charger') {
            return;
        }
        await this.refreshLogs({ count: LOGS_PAGE_SIZE, all: true });
    };

    /**
     * Résout une URL relative du backend (`/api/...`) en URL absolue.
     * Les DTO ne portent que le chemin : c'est le front qui sait où répond le
     * backend.
     */
    protected resolveUrl = (url: string): string =>
        url.startsWith('/') ? `${this.backendBaseUrl}${url}` : url;

    /**
     * Télécharge les photos des logs affichés, si la préférence l'autorise.
     *
     * Limité aux logs **affichés**, et pas à tout le stock : une géocache très
     * loggée compte des milliers de logs, dont un quart avec photos — les
     * télécharger tous sur un simple affichage ferait plusieurs centaines de
     * mégaoctets que personne n'a demandés. Le service sérialise les appels.
     */
    protected async autoDownloadImages(): Promise<void> {
        if (!this.logImagesService.shouldAutoDownload()) {
            return;
        }
        for (const log of this.logs) {
            if (hasPendingImages(log)) {
                void this.runImagesDownload(log, { auto: true });
            }
        }
    }

    /**
     * Téléchargement demandé par l'utilisateur sur un log précis.
     *
     * C'est le recours quand la préférence est désactivée : on garde la main
     * log par log, sans rien avoir laissé partir automatiquement.
     */
    protected downloadLogImages = (log: GeocacheLogDto): void => {
        void this.runImagesDownload(log, { auto: false });
    };

    /**
     * Récupère les photos d'un log et remplace la carte concernée.
     *
     * Seule l'entrée du log est remplacée, pas toute la liste : un
     * rechargement complet ferait sauter la position de défilement et les logs
     * dépliés à chaque photo qui arrive.
     */
    protected async runImagesDownload(
        log: GeocacheLogDto,
        options: { auto: boolean }
    ): Promise<void> {
        const geocacheId = this.geocacheId;
        if (!geocacheId || this.downloadingImageLogIds.has(log.id)) {
            return;
        }

        this.downloadingImageLogIds.add(log.id);
        this.update();

        try {
            const result = options.auto
                ? await this.logImagesService.autoStoreForLog(geocacheId, log)
                : await this.logImagesService.requestForLog(geocacheId, log.id);

            // La géocache a pu changer pendant le téléchargement : la liste ne
            // parle plus du même log.
            if (!result || this.geocacheId !== geocacheId) {
                return;
            }

            this.logs = this.logs.map(existing =>
                existing.id === log.id ? { ...existing, images: result.images } : existing
            );

            if (!options.auto && result.failed.length > 0) {
                this.messages.warn(
                    `${result.failed.length} photo(s) n'ont pas pu être téléchargée(s) : `
                    + 'elles ont pu être retirées de Geocaching.com.'
                );
            }
        } catch (error) {
            console.error('[GeocacheLogsWidget] Failed to download log images:', error);
            if (!options.auto) {
                this.messages.error(`Impossible de télécharger les photos : ${error}`);
            }
        } finally {
            this.downloadingImageLogIds.delete(log.id);
            this.update();
        }
    }

    /**
     * Récupère les détails de la géocache (pour obtenir le hint)
     */
    protected async fetchGeocacheDetails(): Promise<{ hint?: string; hint_raw?: string }> {
        if (!this.geocacheId) {
            return {};
        }

        try {
            const url = `${this.backendBaseUrl}/api/geocaches/${this.geocacheId}`;
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            return {
                hint: data.hint_html || data.hint_raw,
                hint_raw: data.hint_raw
            };
        } catch (error) {
            console.error('[GeocacheLogsWidget] Failed to fetch geocache details:', error);
            return {};
        }
    }

    /**
     * Lit l'analyse IA déjà enregistrée pour cette géocache.
     *
     * Une analyse absente est un état normal (la plupart des géocaches n'en ont
     * pas) : l'échec est donc silencieux, comme pour le résumé des logs.
     */
    protected async loadAnalysis(): Promise<void> {
        const geocacheId = this.geocacheId;
        if (!geocacheId) {
            return;
        }

        try {
            const analysis = await this.analysisService.load(geocacheId);
            // La géocache a pu changer pendant la lecture.
            if (this.geocacheId !== geocacheId) {
                return;
            }
            this.analysis = analysis;
        } catch (error) {
            console.error('[GeocacheLogsWidget] Failed to load logs analysis:', error);
        } finally {
            this.update();
        }
    }

    /**
     * Supprime l'analyse enregistrée, après confirmation.
     *
     * La confirmation n'est pas de la politesse : l'analyse est maintenant
     * persistée, et la refaire coûte un appel de modèle. Pour la faire
     * simplement disparaître de l'écran, le panneau a un bouton « replier ».
     */
    protected deleteAnalysis = async (): Promise<void> => {
        const geocacheId = this.geocacheId;
        if (!geocacheId || !this.analysis) {
            return;
        }

        const confirmed = await this.messages.warn(
            "Supprimer l'analyse IA enregistrée pour cette géocache ? "
            + 'La refaire demandera un nouvel appel au modèle.',
            'Supprimer',
            'Annuler'
        );
        if (confirmed !== 'Supprimer') {
            return;
        }

        try {
            await this.analysisService.clear(geocacheId);
            if (this.geocacheId !== geocacheId) {
                return;
            }
            this.analysis = undefined;
            this.update();
        } catch (error) {
            console.error('[GeocacheLogsWidget] Failed to delete logs analysis:', error);
            this.messages.error(`Impossible de supprimer l'analyse : ${error}`);
        }
    };

    /**
     * Analyse les logs avec l'IA pour en extraire ce qui sert sur le terrain.
     *
     * L'analyse porte sur les logs **stockés**, pas sur la page affichée : la
     * liste n'en montre que 25 au départ, et une analyse muette sur son
     * échantillon se lit comme un verdict sur toute la cache. Le périmètre
     * réellement couvert est transmis au modèle et enregistré avec le résultat.
     */
    protected analyzeLogs = async (): Promise<void> => {
        const geocacheId = this.geocacheId;
        if (!geocacheId || this.isAnalyzing) {
            return;
        }

        this.isAnalyzing = true;
        this.update();

        try {
            const languageModel = await this.languageModelRegistry.selectLanguageModel({
                agent: GeoAppLogsAnalyzerAgentId,
                purpose: 'chat',
                identifier: 'default/universal'
            });

            if (!languageModel) {
                this.messages.error("Aucun modèle IA n'est configuré pour l'analyse (vérifie la configuration IA de Theia)");
                return;
            }

            const [selection, geocacheDetails] = await Promise.all([
                this.analysisService.collectLogsToAnalyze(geocacheId),
                this.fetchGeocacheDetails()
            ]);

            if (this.geocacheId !== geocacheId) {
                return;
            }

            if (selection.logs.length === 0) {
                this.messages.warn('Aucun log à analyser');
                return;
            }

            const { prompt, analyzedCount } = buildLogsAnalysisPrompt({
                hint: geocacheDetails.hint_raw || geocacheDetails.hint,
                logs: selection.logs,
                storedCount: selection.storedCount,
                totalAvailable: selection.totalAvailable
            });

            const request: UserRequest = {
                messages: [
                    { actor: 'user', type: 'text', text: prompt },
                ],
                agentId: GeoAppLogsAnalyzerAgentId,
                requestId: `geoapp-logs-analyzer-${Date.now()}`,
                sessionId: `geoapp-logs-analyzer-session-${Date.now()}`,
            };

            const response = await this.languageModelService.sendRequest(languageModel, request);
            let analysisText = '';

            if (isLanguageModelParsedResponse(response)) {
                analysisText = JSON.stringify(response.parsed);
            } else {
                try {
                    analysisText = await getTextOfResponse(response);
                } catch {
                    const jsonResponse = await getJsonOfResponse(response) as any;
                    analysisText = typeof jsonResponse === 'string' ? jsonResponse : String(jsonResponse);
                }
            }

            analysisText = (analysisText || '').toString().trim();

            if (!analysisText) {
                this.messages.warn('Analyse IA : réponse vide');
                return;
            }

            if (this.geocacheId !== geocacheId) {
                return;
            }

            await this.storeAnalysis(geocacheId, {
                content: analysisText,
                model_id: (languageModel as any).name || languageModel.id,
                analyzed_count: analyzedCount,
                stored_count: selection.storedCount,
                total_available: selection.totalAvailable
            });

            this.messages.info(
                `Analyse des logs terminée (${describeAnalysisScope(
                    analyzedCount, selection.storedCount, selection.totalAvailable
                )})`
            );

        } catch (error) {
            console.error('[GeocacheLogsWidget] Failed to analyze logs:', error);
            this.messages.error(`Impossible d'analyser les logs: ${error}`);
        } finally {
            this.isAnalyzing = false;
            this.update();
        }
    };

    /**
     * Enregistre l'analyse et l'affiche.
     *
     * Si le backend refuse l'enregistrement, on affiche quand même le résultat :
     * le modèle a déjà répondu, et perdre sa réponse parce qu'on n'a pas su la
     * ranger serait le pire des deux mondes. L'analyse est alors marquée comme
     * non enregistrée par son identifiant nul.
     */
    protected async storeAnalysis(
        geocacheId: number,
        input: GeocacheLogsAnalysisInput
    ): Promise<void> {
        try {
            this.analysis = await this.analysisService.save(geocacheId, input);
        } catch (error) {
            console.error('[GeocacheLogsWidget] Failed to store logs analysis:', error);
            this.messages.warn("L'analyse n'a pas pu être enregistrée : elle sera perdue en changeant de géocache.");
            const now = new Date().toISOString();
            this.analysis = {
                id: 0,
                geocache_id: geocacheId,
                content: input.content,
                model_id: input.model_id,
                analyzed_count: input.analyzed_count,
                stored_count: input.stored_count,
                total_available: input.total_available,
                created_at: now,
                updated_at: now
            };
        }
    }

    protected render(): React.ReactNode {
        const hasMore = this.logs.length < this.totalCount;
        // Ne se propose que quand on sait qu'il reste des logs à récupérer, et
        // seulement sur la liste complète : les filtres comptent autre chose.
        const remoteRemaining = !this.friendsOnly && !this.ownOnly && this.totalAvailable !== undefined
            ? this.totalAvailable - this.totalCount
            : 0;

        // Le bouton annonce son périmètre avant de coûter un appel de modèle :
        // l'analyse porte sur les logs stockés (plafonnés), pas sur les 25 que
        // la liste montre au départ.
        const analyzableCount = Math.min(this.storedLogsCount, LOGS_ANALYSIS_MAX_LOGS);
        const following = this.getSyncMode() === 'follow-active';
        const activeTab = this.detailsTracker.getActive();
        const openTabs = this.detailsTracker.getOpenTabs();

        // Un panneau vide doit dire pourquoi il l'est, et ce qui le remplirait —
        // ce qui dépend du réglage : dans un cas c'est un clic dans la fiche,
        // dans l'autre il suffit d'ouvrir une géocache.
        const emptyDescription = following
            ? (activeTab
                ? `Chargement des logs de ${describeGeocacheTab(activeTab)}…`
                : 'Le panneau suit l\'onglet de géocache au premier plan : ouvrez une géocache '
                    + 'pour voir ses logs.')
            : (activeTab
                ? `Cliquez sur « Logs » dans la fiche de ${describeGeocacheTab(activeTab)}, `
                    + 'ou utilisez le bandeau ci-dessus. Le panneau garde ensuite ces logs '
                    + "même si vous changez d'onglet."
                : 'Ouvrez une géocache, puis cliquez sur « Logs » dans sa fiche. Le panneau '
                    + "garde ensuite ces logs même si vous changez d'onglet — réglable dans "
                    + 'les préférences, section Logs › Chargement.');

        const analyzeTitle = this.storedLogsCount === 0
            ? 'Aucun log stocké à analyser'
            : `Analyser les ${analyzableCount} log${analyzableCount > 1 ? 's' : ''} `
                + `${this.storedLogsCount > analyzableCount ? `les plus récents (sur ${this.storedLogsCount} stockés) ` : 'stockés '}`
                + "avec l'IA pour en extraire les informations utiles";

        return (
            <div className='geoapp-logs-panel'>
                {/* En-tête */}
                <div className='geoapp-logs-panel__header'>
                    <div>
                        <h3 className='geoapp-logs-panel__title'>
                            {this.geocacheCode ? (
                                <>Logs - {this.geocacheCode}</>
                            ) : (
                                <>Logs</>
                            )}
                        </h3>
                        {this.geocacheName && (
                            <div className='geoapp-logs-panel__subtitle'>
                                {this.geocacheName}
                            </div>
                        )}
                        {this.totalCount > 0 && (
                            <div className='geoapp-logs-panel__count'>
                                {this.totalCount} log{this.totalCount > 1 ? 's' : ''}
                                {this.friendsOnly ? ' de vos amis' : this.ownOnly ? ' à vous' : ' au total'}
                            </div>
                        )}
                    </div>

                    {/* Boutons d'action */}
                    {this.geocacheId && (
                        <div className='geoapp-logs-panel__actions'>
                            <button
                                className='geoapp-logs-panel__button geoapp-logs-panel__button--toggle'
                                onClick={() => this.toggleOwnOnly()}
                                disabled={this.isLoading || (this.ownCount === 0 && !this.ownOnly)}
                                aria-pressed={this.ownOnly}
                                title={this.ownCount === 0
                                    ? 'Aucun log à vous détecté sur cette géocache (rafraîchissez les logs pour vérifier)'
                                    : "N'afficher que vos propres logs"}
                            >
                                <i className='fa fa-user-check' />
                                {`Mes logs${this.ownCount > 0 ? ` (${this.ownCount})` : ''}`}
                            </button>
                            <button
                                className='geoapp-logs-panel__button geoapp-logs-panel__button--toggle'
                                onClick={() => this.toggleFriendsOnly()}
                                disabled={this.isLoading || (this.friendsCount === 0 && !this.friendsOnly)}
                                aria-pressed={this.friendsOnly}
                                title={this.friendsCount === 0
                                    ? "Aucun log d'ami détecté sur cette géocache (rafraîchissez les logs pour vérifier)"
                                    : `N'afficher que les logs de vos amis Geocaching.com `
                                        + `(${this.friendsFindersCount} ami(s), ${this.friendsCount} log(s))`}
                            >
                                <i className='fa fa-user-friends' />
                                {`Amis${this.friendsFindersCount > 0 ? ` (${this.friendsFindersCount})` : ''}`}
                            </button>
                            <button
                                className='geoapp-logs-panel__button'
                                onClick={() => void this.analyzeLogs()}
                                disabled={this.isAnalyzing || this.storedLogsCount === 0}
                                title={analyzeTitle}
                            >
                                <i className={`fa ${this.isAnalyzing ? 'fa-spinner fa-spin' : 'fa-brain'}`} />
                                {this.isAnalyzing ? 'Analyse...' : (this.analysis ? "Relancer l'analyse" : 'Analyser avec IA')}
                            </button>
                            <button
                                className='geoapp-logs-panel__button'
                                onClick={() => void this.refreshLogs()}
                                disabled={this.isRefreshing}
                                title='Récupérer les logs depuis Geocaching.com'
                            >
                                <i className={`fa ${this.isRefreshing ? 'fa-spinner fa-spin' : 'fa-sync-alt'}`} />
                                {this.isRefreshing ? 'Rafraîchissement...' : 'Rafraîchir'}
                            </button>
                        </div>
                    )}
                </div>

                {/* Quelle géocache ce panneau affiche, et comment en changer */}
                <LogsScopeBanner
                    current={this.getCurrentRef()}
                    active={activeTab}
                    openTabs={openTabs}
                    following={following}
                    followSuspended={this.followSuspended}
                    onShow={this.showGeocacheFromBanner}
                    onResumeFollow={this.resumeFollow}
                />

                {/* Message si pas de géocache sélectionnée */}
                {!this.geocacheId ? (
                    <div className='geoapp-logs-panel__empty'>
                        <EmptyState
                            fullHeight
                            icon='fa-comments'
                            title='Aucune géocache affichée'
                            description={emptyDescription}
                        />
                    </div>
                ) : (
                    <>
                        {/* Résultat de l'analyse IA, tel qu'il a été enregistré */}
                        {this.analysis && (
                            <LogsAnalysisPanel
                                analysis={this.analysis}
                                storedCount={this.storedLogsCount}
                                isAnalyzing={this.isAnalyzing}
                                onRerun={() => void this.analyzeLogs()}
                                onDelete={() => void this.deleteAnalysis()}
                            />
                        )}

                        {/* Résumé des logs récents */}
                        <LogsRecentSummary
                            entries={this.summaryEntries}
                            totalCount={this.summaryTotalCount}
                            isLoading={this.isSummaryLoading}
                        />

                        {/* Il reste des logs sur Geocaching.com */}
                        {remoteRemaining > 0 && this.totalAvailable !== undefined && (
                            <RemoteLogsBanner
                                storedCount={this.totalCount}
                                totalAvailable={this.totalAvailable}
                                isRefreshing={this.isRefreshing}
                                onLoadNextPage={this.loadNextRemotePage}
                                onLoadAll={() => void this.loadAllRemoteLogs()}
                            />
                        )}

                        {/* Liste des logs */}
                        <div className='geoapp-logs-panel__list'>
                            <LogsList
                                logs={this.logs}
                                isLoading={this.isLoading}
                                onLoadMore={this.loadMore}
                                hasMore={hasMore}
                                resolveUrl={this.resolveUrl}
                                onDownloadImages={this.downloadLogImages}
                                downloadingImageLogIds={this.downloadingImageLogIds}
                                onRefresh={() => void this.refreshLogs()}
                                isRefreshing={this.isRefreshing}
                            />
                        </div>
                    </>
                )}
            </div>
        );
    }
}
