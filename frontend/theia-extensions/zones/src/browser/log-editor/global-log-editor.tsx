/**
 * Éditeur de log global (mode « texte identique pour toutes les géocaches »).
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 5). Composant de
 * présentation : tout l'état et les callbacks sont passés via props.
 */

import * as React from '@theia/core/shared/react';
import { LogTypeIcon } from '../geocache-log-type-icons';
import { ALREADY_FOUND_ACCENT } from './constants';
import { CharCounter } from './char-counter';
import { ImagesSection } from './images-section';
import { GeocacheListItem, LogHistoryEntry, LogTypeValue, PatternSuggestion, SelectedLogImage } from './types';
import { MarkdownPreview } from './markdown-preview';
import { MarkdownToolbar } from './markdown-toolbar';
import { TextareaWithOverlay } from './textarea-overlay';
import { MarkdownFormatKind } from '../log-markdown';

export interface GlobalLogEditorProps {
    // Date
    logDate: string;
    onLogDateChange: (value: string) => void;
    isLogDatePinned: boolean;
    onToggleLogDatePin: () => void;

    // Type
    logType: LogTypeValue;
    onLogTypeChange: (value: LogTypeValue) => void;
    pendingAlreadyFoundCount: number;
    pendingAlreadyFoundCodes: string;

    // Mode texte
    useSameTextForAll: boolean;
    onToggleUseSameTextForAll: (checked: boolean) => void;
    globalText: string;
    globalTextExcerpt: string;
    onApplyGlobalTextToAll: () => void;

    // Historique
    historyDropdownOpen: boolean;
    onToggleHistoryDropdown: () => void;
    logHistory: LogHistoryEntry[];
    onApplyHistoryTextOnly: (entry: LogHistoryEntry) => void;
    canUseHistory: boolean;

    // Toolbar
    isToolbarDisabled: boolean;
    activeCaretFormat: MarkdownFormatKind | undefined;
    isEditorActive: boolean;
    onApplyFormat: (kind: MarkdownFormatKind, placeholder: string) => void;
    onApplyPrefix: (prefix: string, placeholder: string) => void;

    // Textarea
    textareaProps: React.TextareaHTMLAttributes<HTMLTextAreaElement>;
    textareaRef: (el: HTMLTextAreaElement | null) => void;
    overlayKey: string;
    patternNames: Set<string>;
    resolvePatternValue: (patternName: string, geocacheId: number | null) => string;
    onCaretChange: (textArea: HTMLTextAreaElement) => void;
    onScrollSync: (overlayKey: string, textArea: HTMLTextAreaElement) => void;
    registerTextarea: (overlayKey: string, el: HTMLTextAreaElement | null) => void;
    registerOverlay: (overlayKey: string, el: HTMLDivElement | null) => void;
    isTextareaDisabled: boolean;

    // Autocomplétion
    autocompleteOpen: boolean;
    autocompleteSuggestions: PatternSuggestion[];
    autocompleteActiveIndex: number;
    autocompletePosition?: { top: number; left: number };
    onAutocompleteHover: (idx: number) => void;
    onAutocompleteClick: (suggestion: PatternSuggestion) => void;

    // Compteur
    charCounterStats: { raw: number; min: number; max: number; worst?: GeocacheListItem };

    // Images
    images: SelectedLogImage[];
    isImagesDisabled: boolean;
    isDragOver: boolean;
    onAddFiles: (files: FileList | File[]) => void;
    onRemoveImage: (imageId: string) => void;
    onDragOverChange: (active: boolean) => void;
    getPreviewUrl: (file: File) => string | undefined;

    // Aperçu
    resolvedText: string;
    previewKeyPrefix: string;
    isPreviewOpen: boolean;
    onPreviewToggle: (open: boolean) => void;
}

export const GlobalLogEditor: React.FC<GlobalLogEditorProps> = (props) => {
    const {
        logDate, onLogDateChange, isLogDatePinned, onToggleLogDatePin,
        logType, onLogTypeChange, pendingAlreadyFoundCount, pendingAlreadyFoundCodes,
        useSameTextForAll, onToggleUseSameTextForAll, globalText, globalTextExcerpt, onApplyGlobalTextToAll,
        historyDropdownOpen, onToggleHistoryDropdown, logHistory, onApplyHistoryTextOnly, canUseHistory,
        isToolbarDisabled, activeCaretFormat, isEditorActive, onApplyFormat, onApplyPrefix,
        textareaProps, textareaRef, overlayKey, patternNames, resolvePatternValue,
        onCaretChange, onScrollSync, registerTextarea, registerOverlay, isTextareaDisabled,
        autocompleteOpen, autocompleteSuggestions, autocompleteActiveIndex, autocompletePosition,
        onAutocompleteHover, onAutocompleteClick,
        charCounterStats,
        images, isImagesDisabled, isDragOver, onAddFiles, onRemoveImage, onDragOverChange, getPreviewUrl,
        resolvedText, previewKeyPrefix, isPreviewOpen, onPreviewToggle,
    } = props;

    return (
        <>
            <div style={{ display: 'grid', gridTemplateColumns: '190px 220px 1fr', gap: 12, alignItems: 'end' }}>
                <div>
                    <label style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 4 }}>Date</label>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <input
                            type='date'
                            className='theia-input'
                            value={logDate}
                            onChange={e => onLogDateChange(e.target.value)}
                            style={{ flex: 1, minWidth: 0 }}
                        />
                        <button
                            className='theia-button secondary'
                            onClick={onToggleLogDatePin}
                            title={isLogDatePinned
                                ? 'Date épinglée : elle sera réutilisée pour les prochains logs. Cliquer pour revenir à la date du jour.'
                                : 'Épingler la date pour la réutiliser lors des prochains logs'}
                            aria-pressed={isLogDatePinned}
                            style={{
                                padding: '2px 6px',
                                minWidth: 26,
                                fontSize: 13,
                                opacity: isLogDatePinned ? 1 : 0.6,
                                color: isLogDatePinned ? 'var(--theia-focusBorder)' : undefined,
                            }}
                        >
                            <i className={isLogDatePinned ? 'fa fa-thumb-tack' : 'fa fa-thumb-tack fa-rotate-90'} />
                        </button>
                    </div>
                </div>
                <div>
                    <label style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 4 }}>Type</label>
                    <select
                        className='theia-select'
                        value={logType}
                        onChange={e => onLogTypeChange(e.target.value as LogTypeValue)}
                        style={{ width: '100%' }}
                    >
                        <option value='found'>Found it</option>
                        <option value='dnf'>Didn't find it</option>
                        <option value='note'>Write note</option>
                        <option value='skip'>Ne pas loguer</option>
                    </select>
                    {logType === 'found' && pendingAlreadyFoundCount > 0 && (
                        <div
                            style={{ fontSize: 11, marginTop: 4, color: ALREADY_FOUND_ACCENT, display: 'flex', alignItems: 'center', gap: 4 }}
                            title={pendingAlreadyFoundCodes}
                        >
                            <LogTypeIcon kind='found' size={13} />
                            {pendingAlreadyFoundCount} déjà trouvée(s) → "Ne pas loguer"
                        </div>
                    )}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                        type='checkbox'
                        checked={useSameTextForAll}
                        onChange={e => onToggleUseSameTextForAll(e.target.checked)}
                    />
                    <span style={{ fontSize: 12, opacity: 0.85 }}>Texte identique pour toutes les géocaches</span>
                    {!useSameTextForAll && globalText.trim() !== '' && (
                        <button
                            className='theia-button secondary'
                            onClick={onApplyGlobalTextToAll}
                            title={`Remplacer le texte de chaque géocache par le texte commun :\n\n${globalTextExcerpt}`}
                            style={{ fontSize: 11, padding: '2px 6px' }}
                        >
                            ↺ Réappliquer le texte commun
                        </button>
                    )}
                </div>
            </div>

            {useSameTextForAll && (
                <div>
                    <label style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 4 }}>Texte (Markdown)</label>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
                        <div style={{ position: 'relative' }}>
                            <button
                                className='theia-button secondary'
                                style={{ fontSize: 12, padding: '2px 10px' }}
                                onClick={onToggleHistoryDropdown}
                                disabled={isToolbarDisabled || logHistory.length === 0}
                                title='Réutiliser un log récent'
                            >
                                📝 Logs récents ({logHistory.length})
                            </button>
                            {historyDropdownOpen && logHistory.length > 0 && (
                                <div
                                    style={{
                                        position: 'absolute',
                                        top: '100%',
                                        left: 0,
                                        marginTop: 4,
                                        width: 400,
                                        maxHeight: 300,
                                        overflowY: 'auto',
                                        border: '1px solid var(--theia-panel-border)',
                                        background: 'var(--theia-editor-background)',
                                        borderRadius: 3,
                                        zIndex: 1000,
                                        boxShadow: '0 4px 12px rgba(0,0,0,0.35)'
                                    }}
                                >
                                    <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--theia-panel-border)', fontSize: 11, fontWeight: 600, opacity: 0.8 }}>
                                        Cliquez pour réutiliser le texte
                                    </div>
                                    {logHistory.map((entry, idx) => {
                                        const date = new Date(entry.createdAt);
                                        const dateStr = date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                        const timeStr = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                                        const preview = (entry.globalText ?? '').slice(0, 80);
                                        return (
                                            <div
                                                key={entry.id}
                                                style={{
                                                    padding: '8px',
                                                    cursor: 'pointer',
                                                    borderBottom: idx < logHistory.length - 1 ? '1px solid var(--theia-panel-border)' : 'none',
                                                    background: 'transparent'
                                                }}
                                                onMouseEnter={e => { e.currentTarget.style.background = 'var(--theia-list-hoverBackground)'; }}
                                                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                                                onClick={() => onApplyHistoryTextOnly(entry)}
                                            >
                                                <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 2 }}>
                                                    {dateStr} à {timeStr}
                                                </div>
                                                <div style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {preview || '(vide)'}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        <MarkdownToolbar
                            activeCaretFormat={activeCaretFormat}
                            isActive={isEditorActive}
                            disabled={isToolbarDisabled}
                            onApplyFormat={onApplyFormat}
                            onApplyPrefix={onApplyPrefix}
                        />
                    </div>
                    <div style={{ position: 'relative' }}>
                        <TextareaWithOverlay
                            value={globalText}
                            geocacheId={null}
                            textareaProps={{ ...textareaProps, disabled: isTextareaDisabled }}
                            textareaRef={textareaRef}
                            overlayKey={overlayKey}
                            patternNames={patternNames}
                            resolvePatternValue={resolvePatternValue}
                            onCaretChange={onCaretChange}
                            onScrollSync={onScrollSync}
                            registerTextarea={registerTextarea}
                            registerOverlay={registerOverlay}
                        />
                        {autocompleteOpen && autocompleteSuggestions.length > 0 && autocompletePosition && (
                            <div
                                style={{
                                    position: 'fixed',
                                    top: `${autocompletePosition.top + 20}px`,
                                    left: `${autocompletePosition.left}px`,
                                    width: 320,
                                    maxHeight: 200,
                                    overflowY: 'auto',
                                    border: '1px solid var(--theia-panel-border)',
                                    background: 'var(--theia-editor-background)',
                                    borderRadius: 3,
                                    zIndex: 1000,
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.35)'
                                }}
                                onMouseDown={e => e.preventDefault()}
                            >
                                {autocompleteSuggestions.map((s, idx) => (
                                    <div
                                        key={s.id}
                                        style={{
                                            padding: '6px 8px',
                                            cursor: 'pointer',
                                            background: idx === autocompleteActiveIndex
                                                ? 'var(--theia-list-activeSelectionBackground)'
                                                : 'transparent'
                                        }}
                                        onMouseEnter={() => onAutocompleteHover(idx)}
                                        onClick={() => onAutocompleteClick(s)}
                                    >
                                        <div style={{ fontSize: '0.9em', fontWeight: 600 }}>{s.label}</div>
                                        <div style={{ fontSize: '0.8em', opacity: 0.7 }}>{s.description}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {!(charCounterStats.raw === 0 && charCounterStats.max === 0) && (
                        <CharCounter {...charCounterStats} />
                    )}

                    <div style={{ marginTop: 10 }}>
                        <ImagesSection
                            images={images}
                            title='Photos'
                            disabled={isImagesDisabled}
                            isDragOver={isDragOver}
                            onAddFiles={onAddFiles}
                            onRemoveImage={onRemoveImage}
                            onDragOverChange={onDragOverChange}
                            getPreviewUrl={getPreviewUrl}
                        />
                    </div>

                    <MarkdownPreview
                        text={resolvedText}
                        keyPrefix={previewKeyPrefix}
                        isOpen={isPreviewOpen}
                        onToggle={onPreviewToggle}
                    />
                </div>
            )}
        </>
    );
};
