/**
 * Barre « traduire tous les blocs », en mode « texte différent par cache ».
 *
 * Composant pur : tout l'état et les callbacks viennent du widget. C'est le seul point de la
 * traduction qui déclenche un appel LLM par géocache, d'où la progression et le bouton Stop.
 */

import * as React from '@theia/core/shared/react';

export const BatchTranslationBar: React.FC<{
    logLanguage: string;
    /** Non vide quand la traduction est impossible : sert d'infobulle sur le bouton désactivé. */
    disabledReason?: string;
    disabled: boolean;
    progress?: { current: number; total: number };
    stopRequested: boolean;
    onTranslateAll: () => void;
    onRequestStop: () => void;
}> = ({ logLanguage, disabledReason, disabled, progress, stopRequested, onTranslateAll, onRequestStop }) => (
    <div className='geoapp-log-batch-translation'>
        <button
            className='theia-button secondary geoapp-log-button--medium'
            onClick={onTranslateAll}
            disabled={disabled || progress !== undefined || disabledReason !== undefined}
            title={disabledReason ?? `Traduire le texte de chaque géocache en ${logLanguage} avec l'IA (un appel par géocache)`}
        >
            🌐 Traduire tous les blocs
        </button>
        {progress && (
            <>
                <span className='geoapp-log-batch-translation__status' role='status' aria-live='polite'>
                    Traduction {progress.current}/{progress.total}…
                </span>
                <button
                    className='theia-button secondary geoapp-log-button--compact'
                    onClick={onRequestStop}
                    disabled={stopRequested}
                    title='Termine la géocache en cours puis interrompt le lot'
                >
                    {stopRequested ? '⏹️ Arrêt demandé…' : '⏹️ Stop'}
                </button>
            </>
        )}
    </div>
);
