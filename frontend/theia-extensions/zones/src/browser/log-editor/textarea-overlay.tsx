/**
 * Zone de texte avec couche de surlignage des @patterns.
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 3). Le <textarea>
 * porte un texte transparent par-dessus une couche qui affiche le même texte avec
 * les @patterns colorés. Les deux couches doivent produire exactement le même
 * découpage de lignes : toute différence de police, de padding ou de box-sizing
 * décale le surlignage.
 */

import * as React from '@theia/core/shared/react';

/** Affiche un texte avec les @patterns surlignés (version lecture seule, sans <textarea>). */
export const TextWithHighlightedPatterns: React.FC<{
    text: string;
    geocacheId: number | null;
    nodeKey: string;
    patternNames: Set<string>;
    resolvePatternValue: (patternName: string, geocacheId: number | null) => string;
}> = ({ text, geocacheId, nodeKey, patternNames, resolvePatternValue }) => {
    const regex = /@([a-zA-Z_][a-zA-Z0-9_]*)/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let partIndex = 0;

    while ((match = regex.exec(text)) !== null) {
        const patternName = match[1];
        const isValidPattern = patternNames.has(patternName);

        if (match.index > lastIndex) {
            parts.push(<span key={`${nodeKey}-text-${partIndex++}`}>{text.slice(lastIndex, match.index)}</span>);
        }

        if (isValidPattern) {
            const resolvedValue = resolvePatternValue(patternName, geocacheId);
            parts.push(
                <span
                    key={`${nodeKey}-pattern-${partIndex++}`}
                    style={{
                        color: 'var(--theia-textLink-foreground)',
                        textDecoration: 'underline',
                        cursor: 'help'
                    }}
                    title={`${match[0]} → ${resolvedValue}`}
                >
                    {match[0]}
                </span>
            );
        } else {
            parts.push(<span key={`${nodeKey}-text-${partIndex++}`}>{match[0]}</span>);
        }

        lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
        parts.push(<span key={`${nodeKey}-text-${partIndex++}`}>{text.slice(lastIndex)}</span>);
    }

    return <>{parts.length > 0 ? parts : text}</>;
};

export const TextareaWithOverlay: React.FC<{
    value: string;
    geocacheId: number | null;
    textareaProps: React.TextareaHTMLAttributes<HTMLTextAreaElement>;
    textareaRef: (el: HTMLTextAreaElement | null) => void;
    overlayKey: string;
    /** Noms des patterns connus (pour le surlignage). */
    patternNames: Set<string>;
    /** Résout la valeur d'un @pattern pour l'infobulle. */
    resolvePatternValue: (patternName: string, geocacheId: number | null) => string;
    /** Appelé quand le curseur change (sélection, focus, keyup, mouseup). */
    onCaretChange: (textArea: HTMLTextAreaElement) => void;
    /** Appelé quand le <textarea> défile, pour aligner la couche de surlignage. */
    onScrollSync: (overlayKey: string, textArea: HTMLTextAreaElement) => void;
    /** Stocke la référence du <textarea> pour la synchronisation de défilement. */
    registerTextarea: (overlayKey: string, el: HTMLTextAreaElement | null) => void;
    /** Stocke la référence de la couche de surlignage pour la synchronisation. */
    registerOverlay: (overlayKey: string, el: HTMLDivElement | null) => void;
}> = ({ value, geocacheId, textareaProps, textareaRef, overlayKey, patternNames, resolvePatternValue, onCaretChange, onScrollSync, registerTextarea, registerOverlay }) => {
    const regex = /@([a-zA-Z_][a-zA-Z0-9_]*)/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let partIndex = 0;

    while ((match = regex.exec(value)) !== null) {
        const patternName = match[1];
        const isValidPattern = patternNames.has(patternName);

        if (match.index > lastIndex) {
            parts.push(<span key={`${overlayKey}-text-${partIndex++}`}>{value.slice(lastIndex, match.index)}</span>);
        }

        if (isValidPattern) {
            const resolvedValue = resolvePatternValue(patternName, geocacheId);
            parts.push(
                <span
                    key={`${overlayKey}-pattern-${partIndex++}`}
                    style={{
                        backgroundColor: 'rgba(0, 122, 204, 0.15)',
                        color: 'var(--theia-textLink-foreground)',
                        borderRadius: 2
                    }}
                    title={`${match[0]} → ${resolvedValue}`}
                >
                    {match[0]}
                </span>
            );
        } else {
            parts.push(<span key={`${overlayKey}-text-${partIndex++}`}>{match[0]}</span>);
        }

        lastIndex = regex.lastIndex;
    }

    if (lastIndex < value.length) {
        parts.push(<span key={`${overlayKey}-text-${partIndex++}`}>{value.slice(lastIndex)}</span>);
    }

    const {
        onFocus,
        onBlur,
        onScroll,
        onSelect,
        onKeyUp,
        onMouseUp,
        className,
        style: textareaStyle,
        ...restTextareaProps
    } = textareaProps;

    // Le texte du <textarea> est rendu transparent et c'est la couche ci-dessous qui
    // l'affiche (avec les @patterns colorés). Les deux couches doivent donc produire
    // exactement le même découpage de lignes : toute différence de police, de padding
    // ou de box-sizing décale le surlignage, d'autant plus que le texte est long.
    // Ces valeurs sont volontairement explicites (et non `inherit`) car le <textarea>
    // porte la classe `theia-input`, dont le CSS ne s'applique pas à la couche : elle
    // impose `font-size: var(--theia-ui-font-size1)`, `line-height: var(--theia-content-line-height)`
    // et surtout `padding: 3px 0 3px 8px`, dont le `padding-right: 0` change la largeur
    // de retour à la ligne. En les redéclarant inline, les deux couches sont identiques
    // (le style inline l'emporte sur la classe).
    const sharedMetrics = {
        boxSizing: 'border-box',
        padding: textareaStyle?.padding ?? '6px 8px',
        fontFamily: 'var(--theia-ui-font-family)',
        fontSize: 'var(--theia-ui-font-size1)',
        lineHeight: 'var(--theia-content-line-height)',
        letterSpacing: 'normal',
        whiteSpace: 'pre-wrap',
        wordWrap: 'break-word',
        overflowWrap: 'break-word',
        tabSize: 4,
        // Réserve la gouttière de barre de défilement sur les deux couches : sans elle,
        // l'apparition de la barre rétrécit la largeur de texte du seul <textarea>
        // et les retours à la ligne des deux couches divergent à nouveau.
        scrollbarGutter: 'stable',
    } as React.CSSProperties;

    const mergedTextareaStyle: React.CSSProperties = {
        ...textareaStyle,
        ...sharedMetrics,
        display: 'block',
        position: 'relative',
        backgroundColor: 'transparent',
        zIndex: 2,
        color: 'transparent',
        caretColor: 'var(--theia-editor-foreground)',
        border: 'none',
        outline: 'none',
        width: '100%'
    };

    const textareaMergedProps: React.TextareaHTMLAttributes<HTMLTextAreaElement> = {
        ...restTextareaProps,
        // `geoapp-log-textarea` porte la règle ::selection translucide, sans laquelle
        // la sélection masque le texte affiché par la couche de surlignage.
        className: className ? `${className} geoapp-log-textarea` : 'geoapp-log-textarea',
        style: mergedTextareaStyle as React.CSSProperties & { [key: string]: string | number | undefined },
        // Le format sous le curseur pilote l'état allumé/éteint des boutons de la
        // barre d'outils. `select` ne couvre pas les simples déplacements de curseur,
        // d'où le trio select/keyUp/mouseUp.
        onFocus: e => {
            onFocus?.(e);
            onCaretChange(e.currentTarget);
        },
        onSelect: e => {
            onSelect?.(e);
            onCaretChange(e.currentTarget);
        },
        onKeyUp: e => {
            onKeyUp?.(e);
            onCaretChange(e.currentTarget);
        },
        onMouseUp: e => {
            onMouseUp?.(e);
            onCaretChange(e.currentTarget);
        },
        onBlur: e => {
            onBlur?.(e);
        },
        // Le <textarea> défile, pas la couche : sans cette synchronisation le
        // surlignage reste figé dès que le texte dépasse la hauteur visible.
        onScroll: e => {
            onScrollSync(overlayKey, e.currentTarget);
            onScroll?.(e);
        },
    };

    return (
        <div
            style={{
                position: 'relative',
                border: '1px solid var(--theia-panel-border)',
                borderRadius: 3,
                background: 'var(--theia-editor-background)'
            }}
        >
            <textarea
                {...textareaMergedProps}
                ref={el => {
                    textareaRef(el);
                    registerTextarea(overlayKey, el);
                    if (el) {
                        onScrollSync(overlayKey, el);
                    }
                }}
            />
            <div
                ref={el => {
                    registerOverlay(overlayKey, el);
                }}
                style={{
                    ...sharedMetrics,
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    overflow: 'hidden',
                    pointerEvents: 'none',
                    zIndex: 1,
                    color: 'var(--theia-editor-foreground)'
                }}
            >
                {parts.length > 0 ? parts : value}
            </div>
        </div>
    );
};
