/**
 * Barre « traduire tous les blocs », en mode « texte différent par cache ».
 *
 * Composant pur : tout l'état et les callbacks viennent du widget. C'est le seul point de la
 * traduction qui déclenche un appel LLM par géocache, d'où la progression et le bouton Stop.
 * Elle porte aussi le choix de la langue pour ce mode de saisie, la barre d'outils du texte
 * commun (qui porte l'autre split button) n'étant pas rendue ici.
 */

import * as React from '@theia/core/shared/react';
import { TranslateSplitButton } from './translate-split-button';

export const BatchTranslationBar: React.FC<{
    languages: string[];
    logLanguage: string;
    isLogLanguagePinned: boolean;
    /** Non vide quand la traduction est impossible : sert d'infobulle sur le bouton désactivé. */
    disabledReason?: string;
    disabled: boolean;
    progress?: { current: number; total: number };
    stopRequested: boolean;
    isLanguageMenuOpen: boolean;
    onToggleLanguageMenu: () => void;
    onCloseLanguageMenu: () => void;
    onSelectLanguage: (language: string) => void;
    onToggleLogLanguagePin: () => void;
    onTranslateAll: () => void;
    onRequestStop: () => void;
}> = ({
    languages, logLanguage, isLogLanguagePinned, disabledReason, disabled, progress, stopRequested,
    isLanguageMenuOpen, onToggleLanguageMenu, onCloseLanguageMenu, onSelectLanguage,
    onToggleLogLanguagePin, onTranslateAll, onRequestStop,
}) => (
    <div className='geoapp-log-batch-translation'>
        <TranslateSplitButton
            label='Traduire tous les blocs'
            languages={languages}
            logLanguage={logLanguage}
            isLogLanguagePinned={isLogLanguagePinned}
            translateDisabled={disabled || progress !== undefined || disabledReason !== undefined}
            translateDisabledReason={disabledReason}
            isTranslating={progress !== undefined}
            open={isLanguageMenuOpen}
            onToggleMenu={onToggleLanguageMenu}
            onCloseMenu={onCloseLanguageMenu}
            onSelectLanguage={onSelectLanguage}
            onToggleLogLanguagePin={onToggleLogLanguagePin}
            onTranslate={onTranslateAll}
        />
        {progress && (
            <>
                <span className='geoapp-log-batch-translation__status' role='status' aria-live='polite'>
                    {progress.current}/{progress.total}
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
