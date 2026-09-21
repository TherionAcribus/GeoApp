/**
 * Panneau de génération de log par IA.
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 2). Composant pur :
 * tout l'état (champs, ouverture, génération en cours) est détenu par le widget et
 * reflété via des callbacks. La logique d'appel au modèle IA reste dans le widget.
 */

import * as React from '@theia/core/shared/react';

export const AiGenerationPanel: React.FC<{
    open: boolean;
    onToggleOpen: (open: boolean) => void;
    keywords: string;
    onKeywordsChange: (value: string) => void;
    customInstructions: string;
    onCustomInstructionsChange: (value: string) => void;
    exampleLogs: string;
    onExampleLogsChange: (value: string) => void;
    isGenerating: boolean;
    allSubmitted: boolean;
    onGenerate: () => void;
    /** Langue dans laquelle le log est rédigé directement. Vide = pas de consigne de langue. */
    logLanguage: string;
}> = ({ open, onToggleOpen, keywords, onKeywordsChange, customInstructions, onCustomInstructionsChange, exampleLogs, onExampleLogsChange, isGenerating, allSubmitted, onGenerate, logLanguage }) => (
    <details
        className='geoapp-log-details'
        open={open}
        onToggle={(e: React.SyntheticEvent<HTMLDetailsElement>) => {
            onToggleOpen((e.target as HTMLDetailsElement).open);
        }}
    >
        <summary className='geoapp-log-details__summary'>
            🤖 Génération de log par IA
        </summary>
        <div className='geoapp-log-details__body'>
            <div>
                <label className='geoapp-log-field__label'>
                    Mots-clés / Idées *
                </label>
                <input
                    className='theia-input geoapp-log-field__input'
                    value={keywords}
                    onChange={e => onKeywordsChange(e.target.value)}
                    placeholder='Ex: belle balade, vue magnifique, cache bien cachée, famille...'
                    disabled={isGenerating || allSubmitted}
                />
                <div className='geoapp-log-field__hint'>
                    Les idées principales pour le contenu du log
                </div>
            </div>

            <div>
                <label className='geoapp-log-field__label'>
                    Instructions personnalisées (optionnel)
                </label>
                <textarea
                    className='theia-input geoapp-log-field__input geoapp-log-field__input--resizable'
                    value={customInstructions}
                    onChange={e => onCustomInstructionsChange(e.target.value)}
                    placeholder='Ex: Toujours terminer par TFTC, utiliser un ton humoristique, mentionner la météo...'
                    disabled={isGenerating || allSubmitted}
                    rows={3}
                />
                <div className='geoapp-log-field__hint'>
                    Instructions générales pour personnaliser le style de génération
                </div>
            </div>

            <div>
                <label className='geoapp-log-field__label'>
                    Exemples de logs (optionnel)
                </label>
                <textarea
                    className='theia-input geoapp-log-field__input geoapp-log-field__input--resizable'
                    value={exampleLogs}
                    onChange={e => onExampleLogsChange(e.target.value)}
                    placeholder="Colle ici 1 ou 2 exemples de logs que tu as déjà écrits pour que l'IA reproduise ton style..."
                    disabled={isGenerating || allSubmitted}
                    rows={4}
                />
                <div className='geoapp-log-field__hint'>
                    L'IA s'inspirera de ces exemples pour adopter ton style d'écriture
                </div>
            </div>

            <div className='geoapp-log-ai__actions'>
                <button
                    className='theia-button primary geoapp-log-button--generate'
                    onClick={onGenerate}
                    disabled={isGenerating || allSubmitted || !keywords.trim()}
                >
                    {isGenerating ? (
                        <>
                            <i className='fa fa-spinner fa-spin' />
                            Génération...
                        </>
                    ) : (
                        <>
                            🤖 Générer le log
                        </>
                    )}
                </button>
                {isGenerating ? (
                    <span className='geoapp-log-ai__status'>
                        L'IA rédige le log...
                    </span>
                ) : logLanguage && (
                    // La langue du sélecteur pilote aussi la génération : sans ce rappel,
                    // un log généré en allemand surprendrait.
                    <span className='geoapp-log-ai__status'>
                        Rédaction en {logLanguage}
                    </span>
                )}
            </div>
        </div>
    </details>
);
