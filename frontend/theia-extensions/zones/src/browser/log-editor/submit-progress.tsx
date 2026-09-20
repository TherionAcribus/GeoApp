/**
 * Barre de progression de l'envoi des logs.
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 2). Composant pur.
 */

import * as React from '@theia/core/shared/react';

export interface SubmitProgressInfo {
    current: number;
    total: number;
    gcCode: string;
    imagesDone: number;
    imagesTotal: number;
}

export const SubmitProgress: React.FC<{
    progress: SubmitProgressInfo;
    stopRequested: boolean;
}> = ({ progress, stopRequested }) => {
    const { current, total, gcCode, imagesDone, imagesTotal } = progress;
    // La géocache en cours n'est pas encore terminée : elle compte pour la fraction
    // de ses photos déjà envoyées, ce qui évite une barre qui saute par paliers.
    const inCache = imagesTotal > 0 ? imagesDone / imagesTotal : 0;
    const ratio = total > 0 ? Math.min(1, (current - 1 + inCache) / total) : 0;

    return (
        <div className='geoapp-log-progress'>
            <div className='geoapp-log-progress__line'>
                <span className='geoapp-log-progress__current'>
                    Envoi {current}/{total}
                </span>
                <span className='geoapp-log-progress__code'>{gcCode}</span>
                {imagesTotal > 0 && (
                    <span className='geoapp-log-progress__images'>
                        — photo {Math.min(imagesDone + 1, imagesTotal)}/{imagesTotal}
                    </span>
                )}
                {stopRequested && (
                    <span className='geoapp-log-progress__stopping'>
                        Arrêt après cette géocache…
                    </span>
                )}
            </div>
            <div className='geoapp-log-progress__track'>
                <div
                    className={stopRequested
                        ? 'geoapp-log-progress__bar geoapp-log-progress__bar--stopping'
                        : 'geoapp-log-progress__bar'}
                    // Seule la largeur vient de l'avancement.
                    style={{ width: `${Math.round(ratio * 100)}%` }}
                />
            </div>
        </div>
    );
};
