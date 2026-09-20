/**
 * Bandeau "Brouillon restauré" affiché après une restauration d'autosave.
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 2). Composant pur.
 */

import * as React from '@theia/core/shared/react';
import { formatIsoDateTimeFr } from './helpers';

export const DraftBanner: React.FC<{
    restoredDraftAt: string;
    onDiscard: () => void;
    onDismiss: () => void;
}> = ({ restoredDraftAt, onDiscard, onDismiss }) => (
    <div className='geoapp-log-draft-banner'>
        <span>💾 Brouillon restauré (enregistré le {formatIsoDateTimeFr(restoredDraftAt)}). Les photos ne sont pas conservées.</span>
        <button
            className='theia-button secondary geoapp-log-button--small'
            onClick={onDiscard}
            title='Effacer les textes restaurés et repartir sur un log vierge'
        >
            Repartir de zéro
        </button>
        <button
            className='theia-button secondary geoapp-log-button--small geoapp-log-draft-banner__dismiss'
            onClick={onDismiss}
            title='Masquer ce message'
        >
            ✕
        </button>
    </div>
);
