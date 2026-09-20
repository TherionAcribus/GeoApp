/**
 * Affichage de l'analyse IA des logs.
 *
 * Trois choses que le bloc de texte brut d'avant ne faisait pas :
 *
 * - **rendre le Markdown** : le modèle répond en titres et en puces ; les
 *   afficher tels quels (`##`, `-`, `**`) donnait un pavé illisible, alors que
 *   le rendu des logs existe déjà juste à côté ;
 * - **dire son périmètre** : l'analyse porte sur N logs, et la cache en compte
 *   peut-être bien plus. Une analyse silencieuse sur son échantillon se lit
 *   comme un verdict sur toute la cache ;
 * - **signaler qu'elle a vieilli** : des logs arrivés depuis peuvent contredire
 *   ce qu'elle dit (une cache réparée, un accès fermé), d'où l'invitation à la
 *   relancer plutôt qu'un affichage muet.
 */
import * as React from 'react';
import { GeocacheLogsAnalysisDto } from './geocache-logs-analysis-service';
import { describeAnalysisScope } from './geocache-logs-analysis-prompt';
import { renderLogMarkdown } from './log-markdown-renderer';
import '../../src/browser/style/logs-panel.css';

export interface LogsAnalysisPanelProps {
    analysis: GeocacheLogsAnalysisDto;
    /** Nombre de logs stockés *maintenant*, pour repérer une analyse dépassée. */
    storedCount: number;
    /** Une analyse est en cours : relancer et supprimer attendent leur tour. */
    isAnalyzing: boolean;
    onRerun: () => void;
    onDelete: () => void;
}

/** Date et heure d'une analyse, en format court. */
function formatAnalysisDate(dateStr?: string | null): string {
    if (!dateStr) {
        return 'date inconnue';
    }
    try {
        const date = new Date(dateStr);
        return date.toLocaleString('fr-FR', {
            day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    } catch {
        return dateStr;
    }
}

/**
 * Nombre de logs arrivés depuis l'analyse.
 *
 * `stored_count` absent (analyse d'avant ce compteur) vaut « on ne sait pas » :
 * mieux vaut ne rien annoncer que d'annoncer un écart faux.
 */
export function countLogsAddedSince(analysis: GeocacheLogsAnalysisDto, storedCount: number): number {
    if (typeof analysis.stored_count !== 'number') {
        return 0;
    }
    return Math.max(0, storedCount - analysis.stored_count);
}

export const LogsAnalysisPanel: React.FC<LogsAnalysisPanelProps> = ({
    analysis, storedCount, isAnalyzing, onRerun, onDelete
}) => {
    const [collapsed, setCollapsed] = React.useState(false);

    const analyzedCount = analysis.analyzed_count ?? 0;
    const scope = analyzedCount > 0
        ? describeAnalysisScope(
            analyzedCount,
            analysis.stored_count ?? analyzedCount,
            analysis.total_available ?? undefined
        )
        : undefined;
    const addedSince = countLogsAddedSince(analysis, storedCount);

    return (
        <div className='geoapp-logs-analysis'>
            <div className='geoapp-logs-analysis__header'>
                <h4 className='geoapp-logs-analysis__title'>
                    <i className='fa fa-brain' />
                    Analyse IA des logs
                </h4>
                <div className='geoapp-logs-analysis__actions'>
                    <button
                        className='geoapp-logs-analysis__action'
                        onClick={() => setCollapsed(!collapsed)}
                        title={collapsed ? "Déplier l'analyse" : "Replier l'analyse"}
                        aria-expanded={!collapsed}
                    >
                        <i className={`fa ${collapsed ? 'fa-chevron-down' : 'fa-chevron-up'}`} aria-hidden='true' />
                    </button>
                    <button
                        className='geoapp-logs-analysis__action'
                        onClick={onRerun}
                        disabled={isAnalyzing}
                        title="Relancer l'analyse sur les logs actuels"
                    >
                        <i className={`fa ${isAnalyzing ? 'fa-spinner fa-spin' : 'fa-sync-alt'}`} aria-hidden='true' />
                    </button>
                    <button
                        className='geoapp-logs-analysis__action geoapp-logs-analysis__action--danger'
                        onClick={onDelete}
                        disabled={isAnalyzing}
                        title="Supprimer l'analyse enregistrée"
                        aria-label="Supprimer l'analyse enregistrée"
                    >
                        <i className='fa fa-trash' aria-hidden='true' />
                    </button>
                </div>
            </div>

            {/* Ce que l'analyse a vu, et quand. */}
            <div className='geoapp-logs-analysis__meta'>
                <span>{formatAnalysisDate(analysis.updated_at || analysis.created_at)}</span>
                {scope && <span>· {scope}</span>}
                {analysis.model_id && <span>· {analysis.model_id}</span>}
            </div>

            {addedSince > 0 && (
                <div className='geoapp-logs-analysis__stale'>
                    <i className='fa fa-exclamation-triangle' aria-hidden='true' />
                    {addedSince} log{addedSince > 1 ? 's' : ''} {addedSince > 1 ? 'sont arrivés' : 'est arrivé'} depuis
                    cette analyse.
                    <button
                        className='geoapp-logs-analysis__stale-action'
                        onClick={onRerun}
                        disabled={isAnalyzing}
                    >
                        Relancer
                    </button>
                </div>
            )}

            {!collapsed && (
                <div className='geoapp-logs-analysis__body'>
                    {renderLogMarkdown(analysis.content, `logs-analysis-${analysis.id}`)}
                </div>
            )}
        </div>
    );
};
