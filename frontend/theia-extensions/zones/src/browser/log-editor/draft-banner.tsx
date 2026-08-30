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
    <div
        style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '6px 10px',
            fontSize: 12,
            borderRadius: 4,
            border: '1px solid var(--theia-editorWidget-border)',
            background: 'var(--theia-editorWidget-background)',
        }}
    >
        <span>💾 Brouillon restauré (enregistré le {formatIsoDateTimeFr(restoredDraftAt)}). Les photos ne sont pas conservées.</span>
        <button
            className='theia-button secondary'
            onClick={onDiscard}
            title='Effacer les textes restaurés et repartir sur un log vierge'
            style={{ fontSize: 11, padding: '2px 8px' }}
        >
            Repartir de zéro
        </button>
        <button
            className='theia-button secondary'
            onClick={onDismiss}
            title='Masquer ce message'
            style={{ fontSize: 11, padding: '2px 8px', marginLeft: 'auto' }}
        >
            ✕
        </button>
    </div>
);
