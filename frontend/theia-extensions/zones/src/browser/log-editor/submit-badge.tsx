/**
 * Badge de statut d'envoi d'un log (ok / skipped / failed / à envoyer).
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 2). Composant pur.
 */

import * as React from '@theia/core/shared/react';
import { SubmissionStatus } from './types';

export const SubmitBadge: React.FC<{
    status: SubmissionStatus | undefined;
    /** logReferenceCode renvoyé par Geocaching.com (infobulle du badge "ok"). */
    reference?: string;
    /** Raison du dernier échec (infobulle du badge "failed"). */
    error?: string;
    /** Mode compact : icône seule, sans texte (utilisé dans le tableau). */
    compact?: boolean;
    /** Type de log "skip" : affiche 🚫 au lieu de ⏳ quand la cache ne sera pas envoyée. */
    isSkipped?: boolean;
}> = ({ status, reference, error, compact, isSkipped }) => {
    if (status === 'ok') {
        return (
            <span
                style={badgeStyle('var(--theia-charts-green, #22c55e)')}
                title={reference ? `logReferenceCode: ${reference}` : 'Log envoyé'}
            >
                ✅{compact ? '' : ' Log envoyé'}
            </span>
        );
    }
    if (status === 'skipped') {
        return (
            <span
                style={badgeStyle('var(--theia-charts-orange, #f59e0b)')}
                title='Cache déjà loguée (non soumise)'
            >
                ↩️{compact ? '' : ' Déjà loguée'}
            </span>
        );
    }
    if (status === 'failed') {
        return (
            <span
                style={badgeStyle('var(--theia-errorForeground)')}
                title={error ?? 'Dernière tentative en échec'}
            >
                ⚠️{compact ? '' : ' Échec'}
            </span>
        );
    }
    if (isSkipped) {
        return (
            <span
                style={badgeStyle('var(--theia-charts-lines, #6b7280)')}
                title="Ne pas loguer : cette géocache sera ignorée à l'envoi"
            >
                🚫
            </span>
        );
    }
    return (
        <span
            style={badgeStyle('var(--theia-charts-lines, #6b7280)')}
            title='Pas encore envoyé'
        >
            ⏳{compact ? '' : ' À envoyer'}
        </span>
    );
};

function badgeStyle(background: string): React.CSSProperties {
    return {
        padding: '2px 6px',
        borderRadius: 3,
        fontSize: 12,
        background,
        color: '#fff',
        fontWeight: 700,
        whiteSpace: 'nowrap',
    };
}
