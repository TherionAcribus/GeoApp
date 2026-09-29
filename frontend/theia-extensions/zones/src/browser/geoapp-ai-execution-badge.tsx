import * as React from '@theia/core/shared/react';
import { GeoAppAiExecutionRecord } from '@mysterai/theia-plugins/lib/common/ai-model-contract';

function formatDuration(durationMs?: number): string | undefined {
    return typeof durationMs === 'number'
        ? `${(durationMs / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s`
        : undefined;
}

function formatUsage(execution: GeoAppAiExecutionRecord): string | undefined {
    const input = execution.tokenUsage?.inputTokens;
    const output = execution.tokenUsage?.outputTokens;
    return input === undefined && output === undefined
        ? undefined
        : `${input ?? '?'} entrée / ${output ?? '?'} sortie`;
}

export const GeoAppAiExecutionBadge: React.FC<{
    label: string;
    execution?: GeoAppAiExecutionRecord;
}> = ({ label, execution }) => {
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
    const duration = formatDuration(execution.durationMs);
    const usage = formatUsage(execution);
    const color = execution.status === 'succeeded'
        ? 'var(--theia-charts-green, #22c55e)'
        : execution.status === 'failed'
            ? 'var(--theia-errorForeground, #f87171)'
            : execution.status === 'cancelled'
                ? 'var(--theia-charts-orange, #d18616)'
                : 'var(--theia-descriptionForeground, var(--theia-foreground))';
    const title = [
        `Tâche : ${execution.taskLabel}`,
        `Statut : ${statusLabel}`,
        provider ? `Fournisseur : ${provider}` : undefined,
        `Modèle : ${model}`,
        usage ? `Tokens : ${usage}` : undefined,
        execution.errorCode ? `Code : ${execution.errorCode}` : undefined,
        execution.errorMessage ? `Erreur : ${execution.errorMessage}` : undefined,
    ].filter(Boolean).join('\n');
    return <span
        style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 6px',
            border: `1px solid ${color}`,
            borderRadius: 3,
            color,
            fontSize: 11,
            lineHeight: 1.4,
            whiteSpace: 'nowrap',
        }}
        title={title}
        aria-label={title}
    >
        {label} · {statusLabel} · {model}{duration ? ` · ${duration}` : ''}
    </span>;
};
