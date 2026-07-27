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
    total_count: number;
    friends_count?: number;
    offset: number;
    limit: number;
    logs: GeocacheLogDto[];
}

/**
 * Interface pour la réponse du rafraîchissement
 */
interface RefreshApiResponse {
    geocache_id: number;
    gc_code: string;
    message: string;
    added: number;
    updated: number;
    friends: number;
    total: number;
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

/**
 * Composant pour afficher un seul log
 */
const LogItem: React.FC<LogItemProps> = ({ log }) => {
    const color = getLogTypeColor(log.log_type);
    const icon = getLogTypeIcon(log.log_type);
    const [expanded, setExpanded] = React.useState(false);
    
    // Tronquer le texte si trop long
    const maxLength = 200;
    const isLong = log.text && log.text.length > maxLength;
    const displayText = expanded || !isLong 
        ? log.text 
        : log.text.substring(0, maxLength) + '...';
    
    return (
        <div 
            style={{
                background: 'var(--theia-editor-background)',
                border: '1px solid var(--theia-panel-border)',
                borderLeft: `4px solid ${color}`,
                borderRadius: 6,
                padding: 12,
                marginBottom: 8
            }}
        >
            {/* En-tête du log */}
            <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'flex-start',
                marginBottom: 8
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {/* Icône du type */}
                    <span 
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 28,
                            height: 28,
                            borderRadius: '50%',
                            background: color,
                            color: 'white',
                            fontSize: 12
                        }}
                    >
                        <i className={`fa ${icon}`} />
                    </span>
                    
                    {/* Type et auteur */}
                    <div>
                        <div style={{ fontWeight: 'bold', color }}>
                            {log.log_type}
                            {log.is_favorite && (
                                <span style={{ marginLeft: 6, color: 'var(--theia-charts-yellow, #fbbf24)' }} title="Favori">
                                    <i className="fa fa-star" />
                                </span>
                            )}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.8 }}>
                            par <strong>{log.author}</strong>
                            {log.is_friend_log && (
                                <span
                                    title="Log écrit par un de vos amis Geocaching.com"
                                    style={{
                                        marginLeft: 6,
                                        padding: '1px 6px',
                                        borderRadius: 8,
                                        fontSize: 11,
                                        background: 'var(--theia-badge-background)',
                                        color: 'var(--theia-badge-foreground)'
                                    }}
                                >
                                    <i className="fa fa-user-friends" style={{ marginRight: 4 }} />
                                    ami
                                </span>
                            )}
                        </div>
                    </div>
                </div>
                
                {/* Date */}
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                    {formatDate(log.date)}
                </div>
            </div>
            
            {/* Texte du log */}
            {log.text && (
                <div style={{ 
                    marginTop: 8,
                    paddingTop: 8,
                    borderTop: '1px solid var(--theia-panel-border)',
                    whiteSpace: 'pre-wrap',
                    fontSize: 13,
                    lineHeight: 1.5
                }}>
                    {renderLogMarkdown(displayText, `log-${log.id}`)}
                    {isLong && (
                        <button
                            onClick={() => setExpanded(!expanded)}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--theia-textLink-foreground)',
                                cursor: 'pointer',
                                marginLeft: 4,
                                padding: 0,
                                fontSize: 12
                            }}
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
                    onClick={onLoadMore}
                    disabled={isLoading}
                    style={{
                        width: '100%',
                        padding: '10px 16px',
                        background: 'var(--theia-button-background)',
                        color: 'var(--theia-button-foreground)',
                        border: 'none',
                        borderRadius: 4,
                        cursor: isLoading ? 'wait' : 'pointer',
                        marginTop: 8
                    }}
                >
                    {isLoading ? (
                        <>
                            <i className="fa fa-spinner fa-spin" style={{ marginRight: 8 }} />
                            Chargement...
                        </>
                    ) : (
                        <>
                            <i className="fa fa-chevron-down" style={{ marginRight: 8 }} />
                            Charger plus de logs
                        </>
                    )}
                </button>
            )}
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

    private addGlobalEventListeners(): void {
        if (typeof window === 'undefined') {
            return;
        }
        window.addEventListener('geoapp-geocache-selected', this.handleGeocacheSelected as EventListener);
    }

    private removeGlobalEventListeners(): void {
        if (typeof window === 'undefined') {
            return;
        }
        window.removeEventListener('geoapp-geocache-selected', this.handleGeocacheSelected as EventListener);
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
        this.friendsCount = 0;
        this.friendsOnly = false;
        this.analysisResult = undefined;
        this.summaryEntries = [];
        this.summaryTotalCount = 0;
        
        this.title.label = params.gcCode ? `Logs - ${params.gcCode}` : 'Logs';
        
        this.loadSummary();
        this.loadLogs();
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
     * Rafraîchit les logs depuis Geocaching.com
     */
    protected async refreshLogs(): Promise<void> {
        if (!this.geocacheId || this.isRefreshing) {
            return;
        }

        this.isRefreshing = true;
        this.update();

        try {
            const url = `${this.backendBaseUrl}/api/geocaches/${this.geocacheId}/logs/refresh?count=50`;
            const response = await fetch(url, { method: 'POST' });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            const data: RefreshApiResponse = await response.json();
            
            const friendsInfo = data.friends > 0 ? `, ${data.friends} d'ami(s)` : '';
            this.messages.info(
                `Logs rafraîchis : ${data.added} ajoutés, ${data.updated} mis à jour${friendsInfo}`
            );
            
            // Recharger les logs et le résumé depuis le début
            this.offset = 0;
            await this.loadSummary();
            await this.loadLogs();
            
        } catch (error) {
            console.error('[GeocacheLogsWidget] Failed to refresh logs:', error);
            this.messages.error(`Impossible de rafraîchir les logs: ${error}`);
        } finally {
            this.isRefreshing = false;
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
        
        return (
            <div style={{ 
                padding: 16, 
                height: '100%', 
                overflow: 'auto',
                display: 'flex',
                flexDirection: 'column'
            }}>
                {/* En-tête */}
                <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    marginBottom: 16,
                    flexShrink: 0
                }}>
                    <div>
                        <h3 style={{ margin: 0, fontSize: 16 }}>
                            {this.geocacheCode ? (
                                <>Logs - {this.geocacheCode}</>
                            ) : (
                                <>Logs</>
                            )}
                        </h3>
                        {this.geocacheName && (
                            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                                {this.geocacheName}
                            </div>
                        )}
                        {this.totalCount > 0 && (
                            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
                                {this.totalCount} log{this.totalCount > 1 ? 's' : ''}
                                {this.friendsOnly ? ' de vos amis' : ' au total'}
                            </div>
                        )}
                    </div>
                    
                    {/* Boutons d'action */}
                    {this.geocacheId && (
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button
                                onClick={() => this.toggleFriendsOnly()}
                                disabled={this.isLoading || (this.friendsCount === 0 && !this.friendsOnly)}
                                style={{
                                    padding: '8px 16px',
                                    background: this.friendsOnly
                                        ? 'var(--theia-button-background)'
                                        : 'var(--theia-editor-background)',
                                    color: this.friendsOnly
                                        ? 'var(--theia-button-foreground)'
                                        : 'var(--theia-foreground)',
                                    border: '1px solid var(--theia-panel-border)',
                                    borderRadius: 4,
                                    cursor: this.friendsCount === 0 && !this.friendsOnly ? 'not-allowed' : 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    opacity: this.friendsCount === 0 && !this.friendsOnly ? 0.5 : 1
                                }}
                                title={this.friendsCount === 0
                                    ? "Aucun log d'ami détecté sur cette géocache (rafraîchissez les logs pour vérifier)"
                                    : "N'afficher que les logs de vos amis Geocaching.com"}
                            >
                                <i className="fa fa-user-friends" />
                                {`Amis${this.friendsCount > 0 ? ` (${this.friendsCount})` : ''}`}
                            </button>
                            <button
                                onClick={() => this.analyzeLogs()}
                                disabled={this.isAnalyzing || this.logs.length === 0}
                                style={{
                                    padding: '8px 16px',
                                    background: 'var(--theia-button-background)',
                                    color: 'var(--theia-button-foreground)',
                                    border: 'none',
                                    borderRadius: 4,
                                    cursor: (this.isAnalyzing || this.logs.length === 0) ? 'not-allowed' : 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    opacity: this.logs.length === 0 ? 0.5 : 1
                                }}
                                title="Analyser les logs avec l'IA pour extraire des informations utiles"
                            >
                                <i className={`fa ${this.isAnalyzing ? 'fa-spinner fa-spin' : 'fa-brain'}`} />
                                {this.isAnalyzing ? 'Analyse...' : 'Analyser avec IA'}
                            </button>
                            <button
                                onClick={() => this.refreshLogs()}
                                disabled={this.isRefreshing}
                                style={{
                                    padding: '8px 16px',
                                    background: 'var(--theia-button-background)',
                                    color: 'var(--theia-button-foreground)',
                                    border: 'none',
                                    borderRadius: 4,
                                    cursor: this.isRefreshing ? 'wait' : 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8
                                }}
                                title="Récupérer les logs depuis Geocaching.com"
                            >
                                <i className={`fa ${this.isRefreshing ? 'fa-spinner fa-spin' : 'fa-sync-alt'}`} />
                                {this.isRefreshing ? 'Rafraîchissement...' : 'Rafraîchir'}
                            </button>
                        </div>
                    )}
                </div>
                
                {/* Message si pas de géocache sélectionnée */}
                {!this.geocacheId ? (
                    <div style={{ flex: 1, display: 'flex' }}>
                        <EmptyState fullHeight icon='fa-comments' title='Sélectionnez une géocache pour voir ses logs' />
                    </div>
                ) : (
                    <>
                        {/* Résultat de l'analyse IA */}
                        {this.analysisResult && (
                            <div style={{
                                background: 'var(--theia-editor-background)',
                                border: '2px solid var(--theia-focusBorder)',
                                borderRadius: 6,
                                padding: 16,
                                marginBottom: 16,
                                flexShrink: 0
                            }}>
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    marginBottom: 12
                                }}>
                                    <h4 style={{
                                        margin: 0,
                                        fontSize: 14,
                                        fontWeight: 'bold',
                                        color: 'var(--theia-focusBorder)'
                                    }}>
                                        <i className="fa fa-brain" style={{ marginRight: 8 }} />
                                        Analyse IA des Logs
                                    </h4>
                                    <button
                                        onClick={() => {
                                            this.analysisResult = undefined;
                                            this.update();
                                        }}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            color: 'var(--theia-foreground)',
                                            cursor: 'pointer',
                                            padding: 4,
                                            opacity: 0.7
                                        }}
                                        title="Fermer l'analyse"
                                        aria-label="Fermer l'analyse"
                                    >
                                        <i className="fa fa-times" aria-hidden="true" />
                                    </button>
                                </div>
                                <div style={{
                                    whiteSpace: 'pre-wrap',
                                    fontSize: 13,
                                    lineHeight: 1.6,
                                    color: 'var(--theia-foreground)'
                                }}>
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

                        {/* Liste des logs */}
                        <div style={{ flex: 1, overflow: 'auto' }}>
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
