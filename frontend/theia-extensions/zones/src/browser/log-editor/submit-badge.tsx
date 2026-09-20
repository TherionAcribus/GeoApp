/**
 * Badge de statut d'envoi d'un log (ok / skipped / failed / à envoyer).
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 2). Composant pur.
 * La couleur de chaque statut est dans `style/log-editor.css`.
 */

import * as React from '@theia/core/shared/react';
import { SubmissionStatus } from './types';

const BADGE = 'geoapp-log-submit-badge';

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
                className={`${BADGE} ${BADGE}--ok`}
                title={reference ? `logReferenceCode: ${reference}` : 'Log envoyé'}
            >
                ✅{compact ? '' : ' Log envoyé'}
            </span>
        );
    }
    if (status === 'skipped') {
        return (
            <span
                className={`${BADGE} ${BADGE}--skipped`}
                title='Cache déjà loguée (non soumise)'
            >
                ↩️{compact ? '' : ' Déjà loguée'}
            </span>
        );
    }
    if (status === 'failed') {
        return (
            <span
                className={`${BADGE} ${BADGE}--failed`}
                title={error ?? 'Dernière tentative en échec'}
            >
                ⚠️{compact ? '' : ' Échec'}
            </span>
        );
    }
    if (isSkipped) {
        return (
            <span
                className={`${BADGE} ${BADGE}--pending`}
                title="Ne pas loguer : cette géocache sera ignorée à l'envoi"
            >
                🚫
            </span>
        );
    }
    return (
        <span
            className={`${BADGE} ${BADGE}--pending`}
            title='Pas encore envoyé'
        >
            ⏳{compact ? '' : ' À envoyer'}
        </span>
    );
};
