/**
 * Barre d'outils principale du widget de logs.
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 5). Composant de
 * présentation : tout l'état et les callbacks sont passés via props.
 */

import * as React from '@theia/core/shared/react';

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
    /** Analyse IA de la sortie : porte sur toute la liste, cette table n'a pas de sélection. */
    onAnalyzeWithAi: () => void;
    analyzingWithAi: boolean;
}

export const LogEditorHeader: React.FC<LogEditorHeaderProps> = ({
    geocacheCount, loadedCount, isLoading, isLoadingHistory, canPrev, canNext,
    isSubmitting, submitProgress, canSubmit, submitTitle, stopRequested,
    onNavigateHistory, onSubmit, onRequestStop, onCopyFieldNotes, onDownloadFieldNotes,
    onAnalyzeWithAi, analyzingWithAi,
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
            <button
                className='theia-button primary geoapp-log-button'
                onClick={onSubmit}
                disabled={isLoading || isSubmitting || !canSubmit}
                title={submitTitle}
            >
                {isSubmitting && submitProgress
                    ? `⏳ Envoi ${submitProgress.current}/${submitProgress.total}…`
                    : '✅ Envoyer sur GC'}
            </button>
            {isSubmitting && (
                <button
                    className='theia-button secondary geoapp-log-button--stop'
                    onClick={onRequestStop}
                    disabled={stopRequested}
                    title="Termine la géocache en cours (photos + log) puis interrompt le lot. Les géocaches restantes sont conservées dans le brouillon."
                >
                    {stopRequested ? '⏹️ Arrêt demandé…' : '⏹️ Stop après la cache en cours'}
                </button>
            )}
            <button
                className='theia-button secondary geoapp-log-button'
                onClick={onAnalyzeWithAi}
                disabled={isLoading || loadedCount === 0 || analyzingWithAi}
                title="Analyser toute la sortie avec l'IA : matériel à emporter, temps à prévoir, alertes"
            >
                {analyzingWithAi ? '⏳ Analyse…' : '🧠 Analyser la sortie'}
            </button>
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
