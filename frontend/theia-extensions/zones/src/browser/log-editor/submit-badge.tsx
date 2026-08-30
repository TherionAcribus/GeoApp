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
}> = ({ status, reference, error }) => {
    if (status === 'ok') {
        return (
            <span
                style={{
                    padding: '2px 6px',
                    borderRadius: 3,
                    fontSize: 12,
                    background: 'var(--theia-charts-green, #22c55e)',
                    color: '#fff',
                    fontWeight: 700,
                    whiteSpace: 'nowrap'
                }}
                title={reference ? `logReferenceCode: ${reference}` : 'Log envoyé'}
            >
                ✅ Log envoyé
            </span>
        );
    }
    if (status === 'skipped') {
        return (
            <span
                style={{
                    padding: '2px 6px',
                    borderRadius: 3,
                    fontSize: 12,
                    background: 'var(--theia-charts-orange, #f59e0b)',
                    color: '#fff',
                    fontWeight: 700,
                    whiteSpace: 'nowrap'
                }}
                title='Cache déjà loguée (non soumise)'
            >
                ↩️ Déjà loguée
            </span>
        );
    }
    if (status === 'failed') {
        return (
            <span
                style={{
                    padding: '2px 6px',
                    borderRadius: 3,
                    fontSize: 12,
                    background: 'var(--theia-errorForeground)',
                    color: '#fff',
                    fontWeight: 700,
                    whiteSpace: 'nowrap'
                }}
                title={error ?? 'Dernière tentative en échec'}
            >
                ⚠️ Échec
            </span>
        );
    }
    return (
        <span
            style={{
                padding: '2px 6px',
                borderRadius: 3,
                fontSize: 12,
                background: 'var(--theia-charts-lines, #6b7280)',
                color: '#fff',
                fontWeight: 700,
                whiteSpace: 'nowrap'
            }}
            title='Pas encore envoyé'
        >
            ⏳ À envoyer
        </span>
    );
};
