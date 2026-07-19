import * as React from '@theia/core/shared/react';

export type StatusIconStatus = 'pending' | 'running' | 'done' | 'error';

const CODICON_BY_STATUS: Record<StatusIconStatus, string> = {
    pending: 'codicon-circle-large-outline',
    running: 'codicon-loading codicon-modifier-spin',
    done: 'codicon-pass',
    error: 'codicon-error'
};

const COLOR_BY_STATUS: Record<StatusIconStatus, string | undefined> = {
    pending: undefined,
    running: 'var(--theia-progressBar-background, #0078d4)',
    done: 'var(--theia-successBackground, #4caf50)',
    error: 'var(--theia-errorForeground)'
};

const LABEL_BY_STATUS: Record<StatusIconStatus, string> = {
    pending: 'En attente',
    running: 'En cours',
    done: 'Terminé',
    error: 'Erreur'
};

/**
 * Icône de statut (codicon) remplaçant les emojis ⏳ ✅ ❌ ⬜ utilisés pour représenter
 * l'état d'exécution d'un plugin/tâche, afin de rester cohérent avec le thème Theia actif.
 */
export function StatusIcon({ status, label }: { status: StatusIconStatus; label?: string }): React.JSX.Element {
    return (
        <span
            className={`codicon ${CODICON_BY_STATUS[status]}`}
            style={{ color: COLOR_BY_STATUS[status] }}
            role='img'
            aria-label={label ?? LABEL_BY_STATUS[status]}
            title={label ?? LABEL_BY_STATUS[status]}
        />
    );
}
