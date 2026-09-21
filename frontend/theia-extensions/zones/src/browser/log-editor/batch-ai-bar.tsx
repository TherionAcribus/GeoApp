/**
 * Barre des actions IA de lot, en mode « texte différent par cache ».
 *
 * Composant pur : tout l'état et les callbacks viennent du widget. C'est le seul point de
 * l'éditeur qui déclenche un appel LLM **par géocache**, d'où la progression et le bouton Stop,
 * partagés par les deux actions — une seule tourne à la fois.
 *
 * Elle porte aussi les deux menus (langue de traduction, mode de correction) pour ce mode de
 * saisie : la barre d'outils du texte commun, qui porte les mêmes split buttons, n'est pas
 * rendue ici.
 */

import * as React from '@theia/core/shared/react';
import { ImproveSplitButton } from './improve-split-button';
import { LogImprovementMode } from './log-improver';
import { TranslateSplitButton } from './translate-split-button';

export const BatchAiBar: React.FC<{
    languages: string[];
    logLanguage: string;
    isLogLanguagePinned: boolean;
    /** Non vide quand la traduction est impossible : sert d'infobulle sur le bouton désactivé. */
    translateDisabledReason?: string;
    improvementMode: LogImprovementMode;
    /** Non vide quand la correction est impossible. */
    improveDisabledReason?: string;
    disabled: boolean;
    /** Progression du lot en cours, quelle que soit l'action. */
    progress?: { current: number; total: number };
    /** Quelle action tourne : détermine lequel des deux boutons montre le spinner. */
    runningAction?: 'translate' | 'improve';
    stopRequested: boolean;
    isLanguageMenuOpen: boolean;
    onToggleLanguageMenu: () => void;
    onCloseLanguageMenu: () => void;
    onSelectLanguage: (language: string) => void;
    onToggleLogLanguagePin: () => void;
    onTranslateAll: () => void;
    isImprovementMenuOpen: boolean;
    onToggleImprovementMenu: () => void;
    onCloseImprovementMenu: () => void;
    onSelectImprovementMode: (mode: LogImprovementMode) => void;
    onImproveAll: () => void;
    onRequestStop: () => void;
}> = ({
    languages, logLanguage, isLogLanguagePinned, translateDisabledReason,
    improvementMode, improveDisabledReason,
    disabled, progress, runningAction, stopRequested,
    isLanguageMenuOpen, onToggleLanguageMenu, onCloseLanguageMenu, onSelectLanguage,
    onToggleLogLanguagePin, onTranslateAll,
    isImprovementMenuOpen, onToggleImprovementMenu, onCloseImprovementMenu,
    onSelectImprovementMode, onImproveAll,
    onRequestStop,
}) => (
    <div className='geoapp-log-batch-ai'>
        <TranslateSplitButton
            label='Traduire tous les blocs'
            languages={languages}
            logLanguage={logLanguage}
            isLogLanguagePinned={isLogLanguagePinned}
            translateDisabled={disabled || progress !== undefined || translateDisabledReason !== undefined}
            translateDisabledReason={translateDisabledReason}
            isTranslating={progress !== undefined && runningAction === 'translate'}
            open={isLanguageMenuOpen}
            onToggleMenu={onToggleLanguageMenu}
            onCloseMenu={onCloseLanguageMenu}
            onSelectLanguage={onSelectLanguage}
            onToggleLogLanguagePin={onToggleLogLanguagePin}
            onTranslate={onTranslateAll}
        />
        <ImproveSplitButton
            label='Corriger tous les blocs'
            mode={improvementMode}
            improveDisabled={disabled || progress !== undefined || improveDisabledReason !== undefined}
            improveDisabledReason={improveDisabledReason}
            isImproving={progress !== undefined && runningAction === 'improve'}
            open={isImprovementMenuOpen}
            onToggleMenu={onToggleImprovementMenu}
            onCloseMenu={onCloseImprovementMenu}
            onSelectMode={onSelectImprovementMode}
            onImprove={onImproveAll}
        />
        {progress && (
            <>
                <span className='geoapp-log-batch-ai__status' role='status' aria-live='polite'>
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
