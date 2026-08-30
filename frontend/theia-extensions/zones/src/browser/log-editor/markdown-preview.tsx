/**
 * Bloc « Aperçu Markdown » : rendu du texte final, précédé d'un avertissement
 * quand des astérisques ne seront pas interprétées par Geocaching.com.
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 2). Composant pur.
 * L'état replié/déplié est détenu par le widget (un Set d'identifiants) pour survivre
 * aux re-rendus sans perdre l'ouverture quand l'utilisateur tape ailleurs.
 */

import * as React from '@theia/core/shared/react';
import { findUnrenderedEmphasis } from '../log-markdown';
import { renderLogMarkdown } from '../log-markdown-renderer';

export const MarkdownPreview: React.FC<{
    text: string;
    keyPrefix: string;
    isOpen: boolean;
    onToggle: (open: boolean) => void;
}> = ({ text, keyPrefix, isOpen, onToggle }) => {
    const unrendered = findUnrenderedEmphasis(text);
    // Le rendu Markdown complet (parsing + arbre React) est le poste le plus lourd du
    // widget, multiplié par le nombre de géocaches. Tant que le bloc est replié il
    // n'est vu par personne : on ne le construit qu'une fois déplié. L'avertissement
    // du résumé, lui, reste calculé pour rester visible sans avoir à déplier.

    return (
        <details
            style={{ marginTop: 8 }}
            open={isOpen}
            onToggle={event => {
                const open = (event.currentTarget as HTMLDetailsElement).open;
                onToggle(open);
            }}
        >
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                Aperçu Markdown (texte final)
                {unrendered.length > 0 && (
                    <span style={{ marginLeft: 6, fontWeight: 400, color: 'var(--theia-editorWarning-foreground, #d29922)' }}>
                        ⚠️ {unrendered.length} ligne{unrendered.length > 1 ? 's' : ''} avec des astérisques non interprétées
                    </span>
                )}
            </summary>
            {isOpen && unrendered.length > 0 && (
                <div
                    style={{
                        marginTop: 8,
                        padding: 8,
                        borderRadius: 6,
                        border: '1px solid var(--theia-editorWarning-foreground, #d29922)',
                        fontSize: 12,
                    }}
                >
                    <div style={{ marginBottom: 4 }}>
                        Geocaching.com exige que les astérisques soient collées au texte :{' '}
                        <code>**gras**</code> fonctionne, <code>**gras **</code> non.
                    </div>
                    <ul style={{ margin: '4px 0 0 18px' }}>
                        {unrendered.map((line, index) => (
                            <li key={`${keyPrefix}-warn-${index}`}>
                                <code>{line}</code>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {isOpen && (
                <div
                    style={{
                        marginTop: 8,
                        background: 'var(--theia-editor-background)',
                        border: '1px solid var(--theia-panel-border)',
                        borderRadius: 6,
                        padding: 10,
                        fontSize: 13,
                        overflow: 'auto',
                    }}
                >
                    {renderLogMarkdown(text, keyPrefix)}
                </div>
            )}
        </details>
    );
};
