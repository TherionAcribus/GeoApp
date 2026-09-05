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

    // --- Préservation du défilement et du curseur à travers les re-renders ---
    //
    // Le <textarea> est contrôlé : à chaque frappe, le parent appelle `update()` et
    // React fait `node.value = newValue`. Cela remet `scrollTop` à 0 et place le
    // curseur en fin de texte. Sans restauration, l'utilisateur qui tape en haut d'un
    // texte long voit le champ scroller vers le bas à chaque touche, et le curseur
    // saute parfois en fin de champ.
    //
    // `scheduleRestoreSelection` (côté parent) utilise `setTimeout(0)` : trop tard,
    // le navigateur a déjà peint le saut. On capture ici l'état (scroll + sélection)
    // lors des interactions, et on le restaure dans `useLayoutEffect` : celui-ci
    // s'exécute après la mise à jour DOM de React mais **avant le paint**, donc
    // l'utilisateur ne voit jamais le saut.
    const internalTextareaRef = React.useRef<HTMLTextAreaElement | null>(null);
    const savedScrollTop = React.useRef(0);
    const savedSelection = React.useRef<{ start: number; end: number } | null>(null);
    const prevValue = React.useRef(value);
    // Distingue les changements de valeur venant de la frappe (à restaurer) des
    // changements programmatiques (Markdown, patterns) : ces derniers ont leur propre
    // `setTimeout` pour positionner le curseur, on ne doit pas l'écraser.
    const wasUserInput = React.useRef(false);

    const captureState = React.useCallback((): void => {
        const ta = internalTextareaRef.current;
        if (!ta) {
            return;
        }
        savedScrollTop.current = ta.scrollTop;
        savedSelection.current = { start: ta.selectionStart, end: ta.selectionEnd };
    }, []);

    React.useLayoutEffect(() => {
        const ta = internalTextareaRef.current;
        if (!ta) {
            return;
        }
        // On ne restaure que lorsque la `value` a effectivement changé : c'est seulement
        // dans ce cas que React réécrit `node.value` et remet le scroll/sélection à zéro.
        if (prevValue.current === value) {
            return;
        }
        prevValue.current = value;

        // Restaure le scroll (pour la frappe ET les changements programmatiques : dans
        // les deux cas, l'utilisateur veut rester à l'endroit qu'il regardait).
        ta.scrollTop = savedScrollTop.current;

        // Ne restaure la sélection que pour la frappe : les changements programmatiques
        // (Markdown, insertion de pattern) positionnent le curseur via leur propre
        // `setTimeout` et ne doivent pas être écrasés.
        if (wasUserInput.current) {
            const saved = savedSelection.current;
            if (saved) {
                const max = ta.value.length;
                try {
                    ta.setSelectionRange(Math.min(saved.start, max), Math.min(saved.end, max));
                } catch {
                    // ignore (textarea désactivé ou détaché)
                }
            }
            wasUserInput.current = false;
        }

        // La couche de surlignage a été alignée pendant le commit (ref callback) sur le
        // `scrollTop` remis à 0 par React : on la recale sur le `scrollTop` restauré.
        onScrollSync(overlayKey, ta);
    });

    const {
        onFocus,
        onBlur,
        onChange,
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
        // Capture l'état (scroll + sélection) AVANT que le parent ne déclenche le
        // re-render qui réinitialisera le <textarea>. Le drapeau `wasUserInput` marque
        // ce changement comme venant de la frappe (à restaurer dans le useLayoutEffect).
        onChange: e => {
            captureState();
            wasUserInput.current = true;
            onChange?.(e);
        },
        // Le format sous le curseur pilote l'état allumé/éteint des boutons de la
        // barre d'outils. `select` ne couvre pas les simples déplacements de curseur,
        // d'où le trio select/keyUp/mouseUp.
        onFocus: e => {
            captureState();
            onFocus?.(e);
            onCaretChange(e.currentTarget);
        },
        onSelect: e => {
            captureState();
            onSelect?.(e);
            onCaretChange(e.currentTarget);
        },
        onKeyUp: e => {
            captureState();
            onKeyUp?.(e);
            onCaretChange(e.currentTarget);
        },
        onMouseUp: e => {
            captureState();
            onMouseUp?.(e);
            onCaretChange(e.currentTarget);
        },
        onBlur: e => {
            onBlur?.(e);
        },
        // Le <textarea> défile, pas la couche : sans cette synchronisation le
        // surlignage reste figé dès que le texte dépasse la hauteur visible.
        // On maintient aussi `savedScrollTop` à jour pour les re-renders ultérieurs.
        onScroll: e => {
            savedScrollTop.current = e.currentTarget.scrollTop;
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
                    internalTextareaRef.current = el;
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
