/**
 * Barre d'outils principale du widget de logs.
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 5). Composant de
 * présentation : tout l'état et les callbacks sont passés via props.
 */

import * as React from '@theia/core/shared/react';
import { SubmitActions } from './submit-actions';

export interface LogEditorHeaderProps {
    geocacheCount: number;
    loadedCount: number;
    isLoading: boolean;
    isLoadingHistory: boolean;
    canPrev: boolean;
    canNext: boolean;
    isSubmitting: boolean;
    submitProgress?: { current: number; total: number };
    canSubmit: boolean;
    submitTitle: string;
    stopRequested: boolean;
    onNavigateHistory: (delta: number) => void;
    onSubmit: () => void;
    onRequestStop: () => void;
    onCopyFieldNotes: () => void;
    onDownloadFieldNotes: () => void;
}

export const LogEditorHeader: React.FC<LogEditorHeaderProps> = ({
    geocacheCount, loadedCount, isLoading, isLoadingHistory, canPrev, canNext,
    isSubmitting, submitProgress, canSubmit, submitTitle, stopRequested,
    onNavigateHistory, onSubmit, onRequestStop, onCopyFieldNotes, onDownloadFieldNotes,
}) => (
    <div className='geoapp-log-header'>
        <div>
            <h3 className='geoapp-log-header__title'>Logs</h3>
            <div className='geoapp-log-header__subtitle'>
                {/* Le compte demandé et le compte chargé diffèrent si une géocache est introuvable. */}
                {loadedCount > 0 && loadedCount !== geocacheCount
                    ? `${loadedCount} géocache(s) sur ${geocacheCount} chargée(s)`
                    : `${geocacheCount} géocache(s)`}
            </div>
        </div>
        <div className='geoapp-log-header__actions'>
            <button
                className='theia-button secondary geoapp-log-button geoapp-log-button--nav'
                onClick={() => onNavigateHistory(+1)}
                disabled={isLoading || isLoadingHistory || !canPrev}
                title='Log précédent'
            >
                ⬅️
            </button>
            <button
                className='theia-button secondary geoapp-log-button geoapp-log-button--nav'
                onClick={() => onNavigateHistory(-1)}
                disabled={isLoading || isLoadingHistory || !canNext}
                title='Log suivant'
            >
                ➡️
            </button>
            <SubmitActions
                isLoading={isLoading}
                isSubmitting={isSubmitting}
                submitProgress={submitProgress}
                canSubmit={canSubmit}
                submitTitle={submitTitle}
                stopRequested={stopRequested}
                onSubmit={onSubmit}
                onRequestStop={onRequestStop}
            />
            <button
                className='theia-button secondary geoapp-log-button'
                onClick={onCopyFieldNotes}
                disabled={isLoading || loadedCount === 0}
                title='Copier le format geocache_visits.txt (field notes)'
            >
                📋 Copier field notes
            </button>
            <button
                className='theia-button secondary geoapp-log-button'
                onClick={onDownloadFieldNotes}
                disabled={isLoading || loadedCount === 0}
                title='Télécharger un fichier geocache_visits.txt'
            >
                ⬇️ Télécharger
            </button>
        </div>
    </div>
);
