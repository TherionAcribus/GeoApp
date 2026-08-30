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
}> = ({ open, onToggleOpen, keywords, onKeywordsChange, customInstructions, onCustomInstructionsChange, exampleLogs, onExampleLogsChange, isGenerating, allSubmitted, onGenerate }) => (
    <details
        open={open}
        onToggle={(e: React.SyntheticEvent<HTMLDetailsElement>) => {
            onToggleOpen((e.target as HTMLDetailsElement).open);
        }}
        style={{ marginBottom: 8 }}
    >
        <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
            🤖 Génération de log par IA
        </summary>
        <div style={{
            marginTop: 8,
            padding: 12,
            background: 'var(--theia-editor-background)',
            border: '1px solid var(--theia-panel-border)',
            borderRadius: 6,
            display: 'grid',
            gap: 12
        }}>
            <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    Mots-clés / Idées *
                </label>
                <input
                    className='theia-input'
                    value={keywords}
                    onChange={e => onKeywordsChange(e.target.value)}
                    placeholder='Ex: belle balade, vue magnifique, cache bien cachée, famille...'
                    disabled={isGenerating || allSubmitted}
                    style={{ width: '100%', fontSize: 12 }}
                />
                <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
                    Les idées principales pour le contenu du log
                </div>
            </div>

            <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    Instructions personnalisées (optionnel)
                </label>
                <textarea
                    className='theia-input'
                    value={customInstructions}
                    onChange={e => onCustomInstructionsChange(e.target.value)}
                    placeholder='Ex: Toujours terminer par TFTC, utiliser un ton humoristique, mentionner la météo...'
                    disabled={isGenerating || allSubmitted}
                    rows={3}
                    style={{ width: '100%', fontSize: 12, resize: 'vertical' }}
                />
                <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
                    Instructions générales pour personnaliser le style de génération
                </div>
            </div>

            <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    Exemples de logs (optionnel)
                </label>
                <textarea
                    className='theia-input'
                    value={exampleLogs}
                    onChange={e => onExampleLogsChange(e.target.value)}
                    placeholder="Colle ici 1 ou 2 exemples de logs que tu as déjà écrits pour que l'IA reproduise ton style..."
                    disabled={isGenerating || allSubmitted}
                    rows={4}
                    style={{ width: '100%', fontSize: 12, resize: 'vertical' }}
                />
                <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
                    L'IA s'inspirera de ces exemples pour adopter ton style d'écriture
                </div>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                    className='theia-button primary'
                    onClick={onGenerate}
                    disabled={isGenerating || allSubmitted || !keywords.trim()}
                    style={{ fontSize: 12, padding: '6px 16px' }}
                >
                    {isGenerating ? (
                        <>
                            <i className='fa fa-spinner fa-spin' style={{ marginRight: 6 }} />
                            Génération...
                        </>
                    ) : (
                        <>
                            🤖 Générer le log
                        </>
                    )}
                </button>
                {isGenerating && (
                    <span style={{ fontSize: 12, opacity: 0.7 }}>
                        L'IA rédige le log...
                    </span>
                )}
            </div>
        </div>
    </details>
);
