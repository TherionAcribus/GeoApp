import * as React from '@theia/core/shared/react';
import { GeoAppAiExecutionService } from 'theia-ide-zones-ext/lib/browser/geoapp-ai-execution-service';

export type AiExecution = NonNullable<ReturnType<GeoAppAiExecutionService['getLatestExecution']>>;

interface AiExecutionBadgeProps {
    label: string;
    execution?: AiExecution;
}

/**
 * Pastille résumant la dernière exécution IA d'une étape (statut, modèle, durée) ;
 * le détail (fournisseur, tokens, erreur) est dans l'infobulle.
 */
export const AiExecutionBadge: React.FC<AiExecutionBadgeProps> = ({ label, execution }) => {
    if (!execution) {
        return null;
    }
    const statusLabel = {
        running: 'en cours',
        succeeded: 'succès',
        failed: 'échec',
        cancelled: 'annulée',
    }[execution.status];
    const model = execution.reportedModel || execution.resolution.displayModel || execution.resolution.resolvedModelId || 'modèle inconnu';
    const provider = execution.reportedProvider || execution.resolution.provider;
    const duration = typeof execution.durationMs === 'number'
        ? `${(execution.durationMs / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s`
        : undefined;
    const usage = execution.tokenUsage
        ? `Tokens : ${execution.tokenUsage.inputTokens ?? '?'} entrée / ${execution.tokenUsage.outputTokens ?? '?'} sortie`
        : undefined;
    const title = [
        `Tâche : ${execution.taskLabel}`,
        `Statut : ${statusLabel}`,
        provider ? `Fournisseur : ${provider}` : undefined,
        `Modèle : ${model}`,
        usage,
        execution.errorCode ? `Code : ${execution.errorCode}` : undefined,
        execution.errorMessage ? `Erreur : ${execution.errorMessage}` : undefined,
    ].filter(Boolean).join('\n');
    const color = execution.status === 'failed'
        ? 'var(--theia-errorForeground, #f87171)'
        : execution.status === 'cancelled'
            ? 'var(--theia-charts-orange, #d18616)'
            : execution.status === 'succeeded'
                ? 'var(--theia-charts-green, #4ade80)'
                : 'var(--theia-charts-blue, #3794ff)';
    return (
        <span
            style={{
                border: `1px solid ${color}`,
                borderRadius: '10px',
                color,
                display: 'inline-flex',
                fontSize: '11px',
                padding: '2px 8px',
                whiteSpace: 'nowrap',
            }}
            title={title}
            aria-label={title}
        >
            {label} · {statusLabel} · {model}{duration ? ` · ${duration}` : ''}
        </span>
    );
};
