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
        <div style={{ margin: '8px 0' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12, marginBottom: 4 }}>
                <span style={{ fontWeight: 600 }}>
                    Envoi {current}/{total}
                </span>
                <span style={{ opacity: 0.85 }}>{gcCode}</span>
                {imagesTotal > 0 && (
                    <span style={{ opacity: 0.7 }}>
                        — photo {Math.min(imagesDone + 1, imagesTotal)}/{imagesTotal}
                    </span>
                )}
                {stopRequested && (
                    <span style={{ marginLeft: 'auto', color: 'var(--theia-editorWarning-foreground, #d29922)', fontWeight: 600 }}>
                        Arrêt après cette géocache…
                    </span>
                )}
            </div>
            <div
                style={{
                    height: 6,
                    borderRadius: 3,
                    background: 'var(--theia-panel-border)',
                    overflow: 'hidden',
                }}
            >
                <div
                    style={{
                        width: `${Math.round(ratio * 100)}%`,
                        height: '100%',
                        background: stopRequested
                            ? 'var(--theia-editorWarning-foreground, #d29922)'
                            : 'var(--theia-progressBar-background, var(--theia-button-background))',
                        transition: 'width 0.2s ease',
                    }}
                />
            </div>
        </div>
    );
};
