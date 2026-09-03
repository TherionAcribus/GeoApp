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
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ display: 'grid', gap: 8 }}>
            <div>
                <h3 style={{ margin: 0 }}>Logs</h3>
                <div style={{ opacity: 0.7, fontSize: 12, marginTop: 4 }}>
                    {/* Le compte demandé et le compte chargé diffèrent si une géocache est introuvable. */}
                    {loadedCount > 0 && loadedCount !== geocacheCount
                        ? `${loadedCount} géocache(s) sur ${geocacheCount} chargée(s)`
                        : `${geocacheCount} géocache(s)`}
                </div>
            </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
                className='theia-button secondary'
                onClick={() => onNavigateHistory(+1)}
                disabled={isLoading || isLoadingHistory || !canPrev}
                title='Log précédent'
                style={{ fontSize: 12, padding: '4px 10px' }}
            >
                ⬅️
            </button>
            <button
                className='theia-button secondary'
                onClick={() => onNavigateHistory(-1)}
                disabled={isLoading || isLoadingHistory || !canNext}
                title='Log suivant'
                style={{ fontSize: 12, padding: '4px 10px' }}
            >
                ➡️
            </button>
            <button
                className='theia-button primary'
                onClick={onSubmit}
                disabled={isLoading || isSubmitting || !canSubmit}
                title={submitTitle}
                style={{ fontSize: 12, padding: '4px 12px' }}
            >
                {isSubmitting && submitProgress
                    ? `⏳ Envoi ${submitProgress.current}/${submitProgress.total}…`
                    : '✅ Envoyer sur GC'}
            </button>
            {isSubmitting && (
                <button
                    className='theia-button secondary'
                    onClick={onRequestStop}
                    disabled={stopRequested}
                    title="Termine la géocache en cours (photos + log) puis interrompt le lot. Les géocaches restantes sont conservées dans le brouillon."
                    style={{
                        fontSize: 12,
                        padding: '4px 12px',
                        color: stopRequested ? undefined : 'var(--theia-editorWarning-foreground, #d29922)',
                        fontWeight: 600,
                    }}
                >
                    {stopRequested ? '⏹️ Arrêt demandé…' : '⏹️ Stop après la cache en cours'}
                </button>
            )}
            <button
                className='theia-button secondary'
                onClick={onAnalyzeWithAi}
                disabled={isLoading || loadedCount === 0 || analyzingWithAi}
                title="Analyser toute la sortie avec l'IA : matériel à emporter, temps à prévoir, alertes"
                style={{ fontSize: 12, padding: '4px 12px' }}
            >
                {analyzingWithAi ? '⏳ Analyse…' : '🧠 Analyser la sortie'}
            </button>
            <button
                className='theia-button secondary'
                onClick={onCopyFieldNotes}
                disabled={isLoading || loadedCount === 0}
                title='Copier le format geocache_visits.txt (field notes)'
                style={{ fontSize: 12, padding: '4px 12px' }}
            >
                📋 Copier field notes
            </button>
            <button
                className='theia-button secondary'
                onClick={onDownloadFieldNotes}
                disabled={isLoading || loadedCount === 0}
                title='Télécharger un fichier geocache_visits.txt'
                style={{ fontSize: 12, padding: '4px 12px' }}
            >
                ⬇️ Télécharger
            </button>
        </div>
    </div>
);
