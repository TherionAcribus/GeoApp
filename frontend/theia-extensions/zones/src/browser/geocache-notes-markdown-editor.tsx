/**
 * Zone de saisie Markdown des notes : barre d'outils + textarea + aperçu.
 *
 * Réutilise l'infrastructure Markdown de l'éditeur de logs (`log-markdown.ts`,
 * `MarkdownToolbar`, `MarkdownPreview`) afin que les notes et les logs partagent
 * exactement la même syntaxe et le même rendu — c'est la syntaxe de
 * Geocaching.com, ce qui compte puisqu'une note peut être poussée vers la note
 * personnelle GC.com.
 *
 * Contrairement à l'éditeur de logs (une barre d'outils unique pilotant la zone
 * de texte active), chaque zone de saisie de note embarque sa propre barre :
 * le widget des notes n'a donc rien à connaître du Markdown, tout l'état
 * d'édition (curseur, format sous le curseur, aperçu déplié) reste local.
 */

import * as React from 'react';
import { MarkdownFormatKind } from './log-markdown';
import { MarkdownPreview } from './log-editor/markdown-preview';
import { MarkdownToolbar } from './log-editor/markdown-toolbar';
import {
    clampSelection,
    computeMarkdownFormatEdit,
    computeMarkdownPrefixEdit,
    computePrefixSelection,
    detectCaretFormat
} from './log-editor/markdown-editor-helpers';

export interface NotesMarkdownEditorProps {
    value: string;
    onChange: (value: string) => void;
    onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
    placeholder?: string;
    rows?: number;
    autoFocus?: boolean;
    /** Désactive la barre d'outils (pendant un envoi en cours, par exemple). */
    disabled?: boolean;
    /** Préfixe des clés React de l'aperçu : doit être unique par zone de saisie. */
    previewKeyPrefix: string;
    /** Rendu entre la zone de texte et l'aperçu (compteur de caractères, boutons). */
    footer?: React.ReactNode;
    textareaStyle?: React.CSSProperties;
}

const editorColumnStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };

const toolbarRowStyle: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4
};

const defaultTextareaStyle: React.CSSProperties = {
    width: '100%',
    resize: 'vertical',
    padding: 8,
    borderRadius: 4,
    border: '1px solid var(--theia-panel-border)',
    fontFamily: 'inherit',
    fontSize: 13
};

export function NotesMarkdownEditor(props: NotesMarkdownEditorProps): React.JSX.Element {
    const textAreaRef = React.useRef<HTMLTextAreaElement | null>(null);
    // Sélection à restaurer après l'application d'un format : la valeur est
    // contrôlée par le widget, on ne peut repositionner le curseur qu'une fois
    // le nouveau texte descendu dans le DOM.
    const pendingSelectionRef = React.useRef<{ start: number; end: number } | undefined>(undefined);
    const [caretFormat, setCaretFormat] = React.useState<MarkdownFormatKind | undefined>(undefined);
    const [isFocused, setIsFocused] = React.useState(false);
    const [isPreviewOpen, setIsPreviewOpen] = React.useState(false);

    // Pas de tableau de dépendances : le widget parent peut re-rendre sans que
    // `value` change (autre frappe, autre note), et une sélection en attente doit
    // être consommée dès le premier rendu qui suit, quelle qu'en soit la cause.
    React.useLayoutEffect(() => {
        const pending = pendingSelectionRef.current;
        const textArea = textAreaRef.current;
        if (!pending || !textArea) {
            return;
        }
        pendingSelectionRef.current = undefined;
        const selection = clampSelection(pending.start, pending.end, textArea.value.length);
        textArea.focus();
        textArea.setSelectionRange(selection.start, selection.end);
    });

    const getSelection = (): { start: number; end: number } => {
        const textArea = textAreaRef.current;
        if (!textArea) {
            return { start: props.value.length, end: props.value.length };
        }
        return { start: textArea.selectionStart, end: textArea.selectionEnd };
    };

    const handleApplyFormat = (kind: MarkdownFormatKind, placeholder: string): void => {
        const { start, end } = getSelection();
        const edit = computeMarkdownFormatEdit(props.value, start, end, kind, placeholder);
        pendingSelectionRef.current = { start: edit.selectionStart, end: edit.selectionEnd };
        setCaretFormat(detectCaretFormat(edit.value, edit.selectionStart));
        props.onChange(edit.value);
    };

    const handleApplyPrefix = (prefix: string, placeholder: string): void => {
        const { start, end } = getSelection();
        const result = computeMarkdownPrefixEdit(props.value, start, end, prefix, placeholder);
        const selection = computePrefixSelection(result, prefix, placeholder);
        pendingSelectionRef.current = selection;
        props.onChange(result.value);
    };

    const refreshCaretFormat = (event: React.SyntheticEvent<HTMLTextAreaElement>): void => {
        const textArea = event.currentTarget;
        const next = detectCaretFormat(textArea.value, textArea.selectionStart ?? 0);
        if (next !== caretFormat) {
            setCaretFormat(next);
        }
    };

    return (
        <div style={editorColumnStyle}>
            <div style={toolbarRowStyle}>
                <MarkdownToolbar
                    activeCaretFormat={caretFormat}
                    isActive={isFocused}
                    disabled={props.disabled === true}
                    onApplyFormat={handleApplyFormat}
                    onApplyPrefix={handleApplyPrefix}
                />
            </div>
            <textarea
                ref={textAreaRef}
                value={props.value}
                onChange={event => props.onChange(event.target.value)}
                onKeyDown={props.onKeyDown}
                onSelect={refreshCaretFormat}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                placeholder={props.placeholder}
                rows={props.rows ?? 3}
                autoFocus={props.autoFocus}
                style={props.textareaStyle ?? defaultTextareaStyle}
            />
            {props.footer}
            <MarkdownPreview
                text={props.value}
                keyPrefix={props.previewKeyPrefix}
                isOpen={isPreviewOpen}
                onToggle={setIsPreviewOpen}
            />
        </div>
    );
}
