/**
 * Barre d'outils Markdown (gras, italique, code, lien, titres, liste, citation).
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 2). Composant pur :
 * l'application effective des formats est déléguée au widget via `onApplyFormat`
 * et `onApplyPrefix`, qui agissent sur la zone de texte active.
 */

import * as React from '@theia/core/shared/react';
import { MarkdownFormatKind } from '../log-markdown';

export const MarkdownToolbar: React.FC<{
    /** Format sous le curseur de la zone active : allume le bouton correspondant. */
    activeCaretFormat: MarkdownFormatKind | undefined;
    /** Vrai si cette barre pilote la zone de texte actuellement active. */
    isActive: boolean;
    disabled: boolean;
    onApplyFormat: (kind: MarkdownFormatKind, placeholder: string) => void;
    onApplyPrefix: (prefix: string, placeholder: string) => void;
}> = ({ activeCaretFormat, isActive, disabled, onApplyFormat, onApplyPrefix }) => {
    const buttonStyle: React.CSSProperties = { fontSize: 12, padding: '2px 10px' };
    const activeStyle: React.CSSProperties = {
        ...buttonStyle,
        background: 'var(--theia-button-background)',
        color: 'var(--theia-button-foreground)',
    };
    const isFormatActive = (kind: MarkdownFormatKind) => isActive && activeCaretFormat === kind;

    const formatButton = (kind: MarkdownFormatKind, placeholder: string, title: string, label: React.ReactNode) => {
        const active = isFormatActive(kind);
        return (
            <button
                className='theia-button secondary'
                style={active ? activeStyle : buttonStyle}
                onClick={() => onApplyFormat(kind, placeholder)}
                disabled={disabled}
                title={active ? `${title} — cliquer pour retirer` : title}
                aria-pressed={active}
            >
                {label}
            </button>
        );
    };

    const prefixButton = (prefix: string, placeholder: string, title: string, label: React.ReactNode) => (
        <button
            className='theia-button secondary'
            style={buttonStyle}
            onClick={() => onApplyPrefix(prefix, placeholder)}
            disabled={disabled}
            title={title}
        >
            {label}
        </button>
    );

    return (
        <>
            <span style={{ fontSize: 12, opacity: 0.75, marginRight: 6 }}>Markdown</span>
            {formatButton('bold', 'texte', 'Gras', <strong>B</strong>)}
            {formatButton('italic', 'texte', 'Italique', <em>I</em>)}
            {formatButton('code', 'code', 'Code inline', '</>')}
            {formatButton('link', 'lien', 'Lien', '🔗')}
            {prefixButton('# ', 'Titre', 'Titre', 'H1')}
            {prefixButton('## ', 'Sous-titre', 'Sous-titre', 'H2')}
            {prefixButton('- ', 'item', 'Liste', '-')}
            {prefixButton('> ', 'Citation', 'Citation', '>')}
        </>
    );
};
