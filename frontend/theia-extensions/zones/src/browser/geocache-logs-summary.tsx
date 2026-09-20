/**
 * Composant réutilisable affichant un résumé des logs récents d'une géocache
 * sous forme d'une série d'icônes colorées.
 *
 * Peut être utilisé dans le widget des logs ET dans la fiche détail de la géocache.
 */
import * as React from 'react';
import { getLogTypeColor as getSummaryColor, getLogTypeIcon as getSummaryIcon } from './geocache-log-type-style';
import '../../src/browser/style/logs-panel.css';

/**
 * Entrée légère d'un résumé de log (pas de texte complet)
 */
export interface LogSummaryEntry {
    log_type: string;
    date: string | null;
    author: string;
    is_favorite: boolean;
}

/**
 * Réponse de l'API /logs/recent-summary
 */
export interface LogsRecentSummaryApiResponse {
    geocache_id: number;
    gc_code: string;
    total_count: number;
    entries: LogSummaryEntry[];
}

/**
 * Props du composant LogsRecentSummary
 */
export interface LogsRecentSummaryProps {
    entries: LogSummaryEntry[];
    totalCount: number;
    isLoading: boolean;
    /** Si fourni, affiche un lien/bouton pour ouvrir le panneau de logs complet */
    onOpenLogs?: () => void;
}

/**
 * Formate une date ISO en format court lisible
 */
function formatShortDate(dateStr: string | null): string {
    if (!dateStr) return '—';
    try {
        const d = new Date(dateStr);
        return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
        return dateStr;
    }
}

/**
 * Composant affichant le résumé des logs récents sous forme de série d'icônes.
 * Chaque icône représente un log récent et affiche un tooltip avec le type, l'auteur et la date.
 */
export const LogsRecentSummary: React.FC<LogsRecentSummaryProps> = ({
    entries,
    totalCount,
    isLoading,
    onOpenLogs,
}) => {
    if (isLoading) {
        return (
            <div className='geoapp-logs-summary__loading'>
                <i className='fa fa-spinner fa-spin' />
                Chargement du résumé...
            </div>
        );
    }

    if (entries.length === 0) {
        return null;
    }

    return (
        <div className='geoapp-logs-summary'>
            {/* Titre */}
            <div className='geoapp-logs-summary__header'>
                <span className='geoapp-logs-summary__title'>
                    Derniers logs
                    {totalCount > 0 && (
                        <span className='geoapp-logs-summary__total'>({totalCount} au total)</span>
                    )}
                </span>
                {onOpenLogs && (
                    <button
                        className='geoapp-logs-summary__open'
                        onClick={onOpenLogs}
                        title='Ouvrir le panneau des logs'
                    >
                        <i className='fa fa-external-link-alt' />
                        Voir tout
                    </button>
                )}
            </div>

            {/* Série d'icônes */}
            <div className='geoapp-logs-summary__icons'>
                {entries.map((entry, idx) => {
                    const color = getSummaryColor(entry.log_type);
                    const icon = getSummaryIcon(entry.log_type);
                    const tooltip = `${entry.log_type}
${entry.author}
${formatShortDate(entry.date)}`;
                    return (
                        <div
                            key={idx}
                            className='geoapp-logs-summary__entry'
                            title={tooltip}
                            // Couleur issue du type de log : c'est une donnée, pas un choix
                            // de design, donc elle reste posée en inline et la feuille la lit.
                            style={{ ['--geoapp-log-color' as any]: color }}
                        >
                            <span className='geoapp-logs-summary__badge'>
                                <i className={`fa ${icon}`} />
                                {entry.is_favorite && (
                                    <span className='geoapp-logs-summary__favorite' title='Log favori'>
                                        <i className='fa fa-star' />
                                    </span>
                                )}
                            </span>
                            <span className='geoapp-logs-summary__date'>
                                {formatShortDate(entry.date)}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
