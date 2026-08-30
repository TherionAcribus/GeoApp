/**
 * Bloc d'édition d'une géocache, en mode « texte différent par cache ».
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 4). Composant de
 * présentation : tout l'état et les callbacks sont passés via props.
 */

import * as React from '@theia/core/shared/react';
import { LogTypeIcon } from '../geocache-log-type-icons';
import { MarkdownFormatKind } from '../log-markdown';
import { alreadyFoundTooltip } from './helpers';
import {
    ALREADY_FOUND_ACCENT,
    ALREADY_FOUND_ROW_BACKGROUND,
    DNF_ACCENT,
    DNF_ROW_BACKGROUND,
    JUST_LOGGED_ACCENT,
    JUST_LOGGED_ROW_BACKGROUND,
} from './constants';
import { CharCounter } from './char-counter';
import { DnfBadge } from './dnf-badge';
import { ImagesSection } from './images-section';
import { MarkdownPreview } from './markdown-preview';
import { MarkdownToolbar } from './markdown-toolbar';
import { SubmitBadge } from './submit-badge';
import { TextareaWithOverlay } from './textarea-overlay';
import { GeocacheListItem, LogTypeValue, PatternSuggestion, SelectedLogImage, SubmissionStatus } from './types';

export interface PerCacheBlockProps {
    gc: GeocacheListItem;

    // Statut et badges
    isSubmittedOk: boolean;
    isPendingDnf: boolean;
    isPendingAlreadyFound: boolean;
    submitStatus?: SubmissionStatus;
    submitReference?: string;
    submitError?: string;

    // Type de log et favoris
    logType: LogTypeValue;
    onLogTypeChange: (value: LogTypeValue) => void;
    isFavorite: boolean;
    onFavoriteChange: (value: boolean) => void;
    remainingFavoritePoints: number;
    formatFavoritePercent: (favoritesCount: number | undefined, logsCount: number | undefined) => string;
    getLogTypeLabel: (value: LogTypeValue) => string;

    // Images
    images: SelectedLogImage[];
    isImagesDisabled: boolean;
    isDragOver: boolean;
    onAddFiles: (files: FileList | File[]) => void;
    onRemoveImage: (imageId: string) => void;
    onDragOverChange: (active: boolean) => void;
    getPreviewUrl: (file: File) => string | undefined;

    // Markdown toolbar
    isToolbarDisabled: boolean;
    activeCaretFormat: MarkdownFormatKind | undefined;
    isEditorActive: boolean;
    onApplyFormat: (kind: MarkdownFormatKind, placeholder: string) => void;
    onApplyPrefix: (prefix: string, placeholder: string) => void;

    // Bouton "Texte commun"
    globalText: string;
    globalTextExcerpt: string;
    onApplyGlobalText: () => void;
    isApplyGlobalTextDisabled: boolean;
    applyGlobalTextTitle: string;

    // Zone de texte
    text: string;
    textareaProps: React.TextareaHTMLAttributes<HTMLTextAreaElement>;
    textareaRef: (el: HTMLTextAreaElement | null) => void;
    overlayKey: string;
    patternNames: Set<string>;
    resolvePatternValue: (patternName: string, geocacheId: number | null) => string;
    onCaretChange: (textArea: HTMLTextAreaElement) => void;
    onScrollSync: (overlayKey: string, textArea: HTMLTextAreaElement) => void;
    registerTextarea: (overlayKey: string, el: HTMLTextAreaElement | null) => void;
    registerOverlay: (overlayKey: string, el: HTMLDivElement | null) => void;

    // Autocomplétion
    autocompleteOpen: boolean;
    autocompleteSuggestions: PatternSuggestion[];
    autocompleteActiveIndex: number;
    autocompletePosition?: { top: number; left: number };
    onAutocompleteHover: (idx: number) => void;
    onAutocompleteClick: (suggestion: PatternSuggestion) => void;

    // Compteur
    charCounterStats: { raw: number; min: number; max: number; worst?: GeocacheListItem };

    // Aperçu Markdown
    resolvedText: string;
    previewKeyPrefix: string;
    isPreviewOpen: boolean;
    onPreviewToggle: (open: boolean) => void;
}

export const PerCacheBlock: React.FC<PerCacheBlockProps> = (props) => {
    const {
        gc, isSubmittedOk, isPendingDnf, isPendingAlreadyFound,
        submitStatus, submitReference, submitError,
        logType, onLogTypeChange, isFavorite, onFavoriteChange, remainingFavoritePoints,
        formatFavoritePercent, getLogTypeLabel,
        images, isImagesDisabled, isDragOver, onAddFiles, onRemoveImage, onDragOverChange, getPreviewUrl,
        isToolbarDisabled, activeCaretFormat, isEditorActive, onApplyFormat, onApplyPrefix,
        globalText, globalTextExcerpt, onApplyGlobalText, isApplyGlobalTextDisabled, applyGlobalTextTitle,
        text, textareaProps, textareaRef, overlayKey, patternNames, resolvePatternValue,
        onCaretChange, onScrollSync, registerTextarea, registerOverlay,
        autocompleteOpen, autocompleteSuggestions, autocompleteActiveIndex, autocompletePosition,
        onAutocompleteHover, onAutocompleteClick,
        charCounterStats,
        resolvedText, previewKeyPrefix, isPreviewOpen, onPreviewToggle,
    } = props;

    return (
        <div
            style={{
                // Même cascade que dans le tableau : envoyé, puis DNF, puis déjà trouvée.
                border: isSubmittedOk
                    ? `1px solid ${JUST_LOGGED_ACCENT}`
                    : isPendingDnf
                        ? `1px solid ${DNF_ACCENT}`
                        : isPendingAlreadyFound
                            ? `1px solid ${ALREADY_FOUND_ACCENT}`
                            : '1px solid var(--theia-panel-border)',
                borderRadius: 6,
                padding: 10,
                background: isSubmittedOk
                    ? JUST_LOGGED_ROW_BACKGROUND
                    : isPendingDnf
                        ? DNF_ROW_BACKGROUND
                        : isPendingAlreadyFound
                            ? ALREADY_FOUND_ROW_BACKGROUND
                            : 'var(--theia-editor-background)'
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <div style={{ fontWeight: 700 }}>{gc.gc_code}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    {isPendingDnf && <DnfBadge />}
                    {isPendingAlreadyFound && (
                        <span
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '2px 6px',
                                borderRadius: 3,
                                fontSize: 12,
                                background: ALREADY_FOUND_ROW_BACKGROUND,
                                color: ALREADY_FOUND_ACCENT,
                                border: `1px solid ${ALREADY_FOUND_ACCENT}`,
                                fontWeight: 700,
                                whiteSpace: 'nowrap'
                            }}
                            title={alreadyFoundTooltip(gc)}
                        >
                            <LogTypeIcon kind='found' size={14} title={alreadyFoundTooltip(gc)} />
                            Déjà trouvée
                        </span>
                    )}
                    {(submitStatus === 'ok' || submitStatus === 'failed') && (
                        <SubmitBadge
                            status={submitStatus}
                            reference={submitReference}
                            error={submitError}
                        />
                    )}
                    <div style={{ opacity: 0.8, fontSize: 12, textAlign: 'right' }}>{gc.name}</div>
                </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
                <div style={{ fontSize: 12, opacity: 0.85 }}>
                    PF: {typeof gc.favorites_count === 'number' ? gc.favorites_count : '—'}
                    {'  '}(
                    {formatFavoritePercent(gc.favorites_count, gc.logs_count)}
                    )
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                        <span style={{ opacity: 0.85 }}>Type</span>
                        <select
                            className='theia-select'
                            value={logType}
                            onChange={e => onLogTypeChange(e.target.value as LogTypeValue)}
                            disabled={isSubmittedOk}
                            title={isSubmittedOk
                                ? 'Log déjà envoyé pour cette géocache'
                                : isPendingAlreadyFound ? alreadyFoundTooltip(gc) : undefined}
                            style={isPendingDnf
                                ? { fontSize: 12, color: DNF_ACCENT, borderColor: DNF_ACCENT, fontWeight: 600 }
                                : { fontSize: 12 }}
                        >
                            <option value='found' disabled={isPendingAlreadyFound}>{getLogTypeLabel('found')}</option>
                            <option value='dnf'>{getLogTypeLabel('dnf')}</option>
                            <option value='note'>{getLogTypeLabel('note')}</option>
                            <option value='skip'>{getLogTypeLabel('skip')}</option>
                        </select>
                    </label>

                    <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, opacity: logType === 'found' ? 0.9 : 0.5 }}>
                        <input
                            type='checkbox'
                            checked={isFavorite}
                            onChange={e => onFavoriteChange(e.target.checked)}
                            disabled={logType !== 'found' || (!isFavorite && remainingFavoritePoints <= 0)}
                            title={!isFavorite && remainingFavoritePoints <= 0 ? 'Plus de PF disponibles' : ''}
                        />
                        Donner un PF
                    </label>
                </div>
            </div>

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

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 8, marginBottom: 6 }}>
                <MarkdownToolbar
                    activeCaretFormat={activeCaretFormat}
                    isActive={isEditorActive}
                    disabled={isToolbarDisabled}
                    onApplyFormat={onApplyFormat}
                    onApplyPrefix={onApplyPrefix}
                />
                {globalText.trim() !== '' && (
                    <button
                        className='theia-button secondary'
                        onClick={onApplyGlobalText}
                        disabled={isApplyGlobalTextDisabled}
                        title={applyGlobalTextTitle}
                        style={{ fontSize: 11, padding: '2px 6px', marginLeft: 'auto' }}
                    >
                        ↺ Texte commun
                    </button>
                )}
            </div>
            <div style={{ position: 'relative', marginTop: 8 }}>
                <TextareaWithOverlay
                    value={text}
                    geocacheId={gc.id}
                    textareaProps={textareaProps}
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

            <MarkdownPreview
                text={resolvedText}
                keyPrefix={previewKeyPrefix}
                isOpen={isPreviewOpen}
                onToggle={onPreviewToggle}
            />
        </div>
    );
};
