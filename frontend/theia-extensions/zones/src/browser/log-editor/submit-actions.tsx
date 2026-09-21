/*
 * Boutons d'envoi du lot de logs : « Envoyer sur GC » et, pendant l'envoi,
 * « Stop après la cache en cours ».
 *
 * Partagé entre l'en-tête (`log-editor-header.tsx`) et le pied de page du
 * widget : le bouton est l'aboutissement du formulaire, il doit donc être
 * atteignable sans remonter tout en haut.
 */

import * as React from '@theia/core/shared/react';

export interface SubmitActionsProps {
    isLoading: boolean;
    isSubmitting: boolean;
    submitProgress?: { current: number; total: number };
    canSubmit: boolean;
    submitTitle: string;
    stopRequested: boolean;
    onSubmit: () => void;
    onRequestStop: () => void;
}

export const SubmitActions: React.FC<SubmitActionsProps> = ({
    isLoading, isSubmitting, submitProgress, canSubmit, submitTitle, stopRequested,
    onSubmit, onRequestStop,
}) => (
    <>
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
    </>
);
