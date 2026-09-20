/**
 * Widget pour afficher les logs (commentaires) d'une géocache.
 * 
 * Ce widget peut être affiché dans le panneau droit, en bas, ou dans la zone principale.
 * Il permet de visualiser les logs récupérés depuis Geocaching.com et de les rafraîchir.
 */
import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
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

/**
 * Interface représentant un log de géocache
 */
interface GeocacheLogDto {
    id: number;
    external_id: string;
    author: string;
    author_guid?: string;
    text: string;
    date: string | null;
    log_type: string;
    is_favorite: boolean;
    is_friend_log?: boolean;
    created_at: string | null;
}

/**
 * Interface pour la réponse de l'API des logs
 */
interface LogsApiResponse {
    geocache_id: number;
    gc_code: string;
    /** Nombre de logs stockés localement. */
    total_count: number;
    /** Nombre de logs sur Geocaching.com, `null` tant qu'on ne l'a pas appris. */
    total_available?: number | null;
    friends_count?: number;
    offset: number;
    limit: number;
    logs: GeocacheLogDto[];
}

/**
 * Props pour le composant LogItem
 */
interface LogItemProps {
    log: GeocacheLogDto;
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
const LogItem: React.FC<LogItemProps> = ({ log }) => {
    const color = getLogTypeColor(log.log_type);
    const icon = getLogTypeIcon(log.log_type);
    const [expanded, setExpanded] = React.useState(false);
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

    const textClassName = [
        'geoapp-log-card__text',
        expanded ? '' : 'geoapp-log-card__text--collapsed',
        !expanded && isOverflowing ? 'geoapp-log-card__text--faded' : '',
    ].filter(Boolean).join(' ');

    return (
        <div
            className='geoapp-log-card'
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

            {/* Texte du log */}
            {log.text && (
                <div className='geoapp-log-card__body'>
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
                            onClick={() => setExpanded(!expanded)}
                        >
                            {expanded ? 'Voir moins' : 'Voir plus'}
                        </button>
                    )}
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
}

/**
 * Composant pour afficher la liste des logs
 */
const LogsList: React.FC<LogsListProps> = ({ logs, isLoading, onLoadMore, hasMore }) => {
    if (isLoading && logs.length === 0) {
        return <LoadingState message='Chargement des logs…' />;
    }
    
    if (logs.length === 0) {
        return <EmptyState icon='fa-comments' title='Aucun log disponible' />;
    }
    
    return (
        <div>
            {logs.map(log => (
                <LogItem key={log.id} log={log} />
            ))}
            
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
export class GeocacheLogsWidget extends ReactWidget {
    static readonly ID = 'geocache.logs.widget';

    protected backendBaseUrl = 'http://localhost:8000';
    protected geocacheId?: number;
    protected geocacheCode?: string;
    protected geocacheName?: string;
    protected logs: GeocacheLogDto[] = [];
    protected totalCount = 0;
    /** Logs que la cache possède sur Geocaching.com, `undefined` si inconnu. */
    protected totalAvailable?: number;
    protected friendsCount = 0;
    protected friendsOnly = false;
    protected isLoading = false;
    protected isRefreshing = false;
    protected isAnalyzing = false;
    protected analysisResult?: string;
    protected offset = 0;
    protected limit = 25;
    protected summaryEntries: LogSummaryEntry[] = [];
    protected summaryTotalCount = 0;
    protected isSummaryLoading = false;

    constructor(
        @inject(MessageService) protected readonly messages: MessageService,
        @inject(PreferenceService) protected readonly preferenceService: PreferenceService,
        @inject(GeocacheLogsFetchService) protected readonly logsFetchService: GeocacheLogsFetchService,
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
    }

    protected onAfterAttach(msg: any): void {
        super.onAfterAttach(msg);
    }

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
    setGeocache(params: { geocacheId: number; gcCode?: string; name?: string }): void {
        this.geocacheId = params.geocacheId;
        this.geocacheCode = params.gcCode;
        this.geocacheName = params.name;
        this.logs = [];
        this.offset = 0;
        this.totalCount = 0;
        this.totalAvailable = undefined;
        this.friendsCount = 0;
        this.friendsOnly = false;
        this.analysisResult = undefined;
        this.summaryEntries = [];
        this.summaryTotalCount = 0;

        this.title.label = params.gcCode ? `Logs - ${params.gcCode}` : 'Logs';

        void this.loadInitial();
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
        await Promise.all([this.loadSummary(), this.loadLogs()]);
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
            const url = `${this.backendBaseUrl}/api/geocaches/${this.geocacheId}/logs`
                + `?limit=${this.limit}&offset=${this.offset}${friendsParam}`;
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
            this.totalAvailable = data.total_available ?? undefined;
            this.friendsCount = data.friends_count ?? 0;
            this.geocacheCode = data.gc_code;
            
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
     */
    protected toggleFriendsOnly = (): void => {
        this.friendsOnly = !this.friendsOnly;
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
     * Analyse les logs avec l'IA pour extraire des informations utiles
     */
    protected async analyzeLogs(): Promise<void> {
        if (!this.geocacheId || this.isAnalyzing) {
            return;
        }

        if (this.logs.length === 0) {
            this.messages.warn('Aucun log à analyser');
            return;
        }

        this.isAnalyzing = true;
        this.analysisResult = undefined;
        this.update();

        try {
            const languageModel = await this.languageModelRegistry.selectLanguageModel({
                agent: GeoAppLogsAnalyzerAgentId,
                purpose: 'chat',
                identifier: 'default/universal'
            });

            if (!languageModel) {
                this.messages.error('Aucun modèle IA n\'est configuré pour l\'analyse (vérifie la configuration IA de Theia)');
                return;
            }

            // Récupérer le hint
            const geocacheDetails = await this.fetchGeocacheDetails();
            const hint = geocacheDetails.hint_raw || geocacheDetails.hint || '';

            // Préparer les logs pour l'analyse (limiter à 50 pour éviter un contexte trop long)
            const logsToAnalyze = this.logs.slice(0, 50).map(log => ({
                type: log.log_type,
                author: log.author,
                date: log.date,
                text: log.text,
                is_favorite: log.is_favorite
            }));

            const prompt = `Tu es un assistant pour géocacheurs. Analyse les logs suivants et le hint (indice) d'une géocache.

Ton objectif est d'extraire et de résumer les informations UTILES pour un géocacheur qui veut trouver cette cache :
- Indices ou conseils mentionnés par les trouveurs
- Avertissements (cache difficile d'accès, terrain dangereux, besoin d'équipement spécial, etc.)
- Informations sur l'état de la cache (endommagée, humide, pleine, etc.)
- Conseils pratiques (meilleur moment pour y aller, parking, discrétion, etc.)
- Informations sur la difficulté réelle vs. la difficulté annoncée

NE MENTIONNE PAS :
- Les simples "TFTC" ou remerciements sans information
- Les logs qui ne contiennent aucune information utile
- Les détails personnels des géocacheurs

Formate ta réponse en sections claires avec des puces. Sois concis et pertinent.

HINT (indice officiel) :
${hint || 'Aucun hint fourni'}

LOGS (${logsToAnalyze.length} logs récents) :
${JSON.stringify(logsToAnalyze, null, 2)}`;

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
                this.messages.warn('Analyse IA: réponse vide');
                return;
            }

            this.analysisResult = analysisText;
            this.messages.info('Analyse des logs terminée');
            
        } catch (error) {
            console.error('[GeocacheLogsWidget] Failed to analyze logs:', error);
            this.messages.error(`Impossible d'analyser les logs: ${error}`);
        } finally {
            this.isAnalyzing = false;
            this.update();
        }
    }

    protected render(): React.ReactNode {
        const hasMore = this.logs.length < this.totalCount;
        // Ne se propose que quand on sait qu'il reste des logs à récupérer, et
        // seulement sur la liste complète : le filtre « Amis » compte autre chose.
        const remoteRemaining = !this.friendsOnly && this.totalAvailable !== undefined
            ? this.totalAvailable - this.totalCount
            : 0;
        
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
                                {this.friendsOnly ? ' de vos amis' : ' au total'}
                            </div>
                        )}
                    </div>

                    {/* Boutons d'action */}
                    {this.geocacheId && (
                        <div className='geoapp-logs-panel__actions'>
                            <button
                                className='geoapp-logs-panel__button geoapp-logs-panel__button--toggle'
                                onClick={() => this.toggleFriendsOnly()}
                                disabled={this.isLoading || (this.friendsCount === 0 && !this.friendsOnly)}
                                aria-pressed={this.friendsOnly}
                                title={this.friendsCount === 0
                                    ? "Aucun log d'ami détecté sur cette géocache (rafraîchissez les logs pour vérifier)"
                                    : "N'afficher que les logs de vos amis Geocaching.com"}
                            >
                                <i className='fa fa-user-friends' />
                                {`Amis${this.friendsCount > 0 ? ` (${this.friendsCount})` : ''}`}
                            </button>
                            <button
                                className='geoapp-logs-panel__button'
                                onClick={() => this.analyzeLogs()}
                                disabled={this.isAnalyzing || this.logs.length === 0}
                                title="Analyser les logs avec l'IA pour extraire des informations utiles"
                            >
                                <i className={`fa ${this.isAnalyzing ? 'fa-spinner fa-spin' : 'fa-brain'}`} />
                                {this.isAnalyzing ? 'Analyse...' : 'Analyser avec IA'}
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

                {/* Message si pas de géocache sélectionnée */}
                {!this.geocacheId ? (
                    <div className='geoapp-logs-panel__empty'>
                        <EmptyState fullHeight icon='fa-comments' title='Sélectionnez une géocache pour voir ses logs' />
                    </div>
                ) : (
                    <>
                        {/* Résultat de l'analyse IA */}
                        {this.analysisResult && (
                            <div className='geoapp-logs-analysis'>
                                <div className='geoapp-logs-analysis__header'>
                                    <h4 className='geoapp-logs-analysis__title'>
                                        <i className='fa fa-brain' />
                                        Analyse IA des Logs
                                    </h4>
                                    <button
                                        className='geoapp-logs-analysis__close'
                                        onClick={() => {
                                            this.analysisResult = undefined;
                                            this.update();
                                        }}
                                        title="Fermer l'analyse"
                                        aria-label="Fermer l'analyse"
                                    >
                                        <i className='fa fa-times' aria-hidden='true' />
                                    </button>
                                </div>
                                <div className='geoapp-logs-analysis__body'>
                                    {this.analysisResult}
                                </div>
                            </div>
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
                            />
                        </div>
                    </>
                )}
            </div>
        );
    }
}
