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
import { CharCounter } from './char-counter';
import { DnfBadge } from './dnf-badge';
import { ImagesSection } from './images-section';
import { MarkdownPreview } from './markdown-preview';
import { MarkdownToolbar } from './markdown-toolbar';
import { PatternAutocompleteMenu } from './pattern-autocomplete-menu';
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
    /** Vrai tant que le stock de PF est en cours de synchronisation avec Geocaching.com. */
    favoritePointsPending?: boolean;
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

    // Traduction IA
    onTranslate: () => void;
    /** Non vide quand la traduction est impossible : sert d'infobulle sur le bouton désactivé. */
    translateDisabledReason?: string;
    isTranslating: boolean;
    logLanguage: string;
    canRevertTranslation: boolean;
    onRevertTranslation: () => void;

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
        favoritePointsPending = false,
        formatFavoritePercent, getLogTypeLabel,
        images, isImagesDisabled, isDragOver, onAddFiles, onRemoveImage, onDragOverChange, getPreviewUrl,
        isToolbarDisabled, activeCaretFormat, isEditorActive, onApplyFormat, onApplyPrefix,
        onTranslate, translateDisabledReason, isTranslating, logLanguage, canRevertTranslation, onRevertTranslation,
        globalText, globalTextExcerpt, onApplyGlobalText, isApplyGlobalTextDisabled, applyGlobalTextTitle,
        text, textareaProps, textareaRef, overlayKey, patternNames, resolvePatternValue,
        onCaretChange, onScrollSync, registerTextarea, registerOverlay,
        autocompleteOpen, autocompleteSuggestions, autocompleteActiveIndex, autocompletePosition,
        onAutocompleteHover, onAutocompleteClick,
        charCounterStats,
        resolvedText, previewKeyPrefix, isPreviewOpen, onPreviewToggle,
    } = props;

    const noPointsLeft = !isFavorite && remainingFavoritePoints <= 0;

    const translateReason = translateDisabledReason
        ?? (text.trim() === '' ? 'Le texte de cette géocache est vide : rien à traduire.' : undefined);

    // Même cascade que dans le tableau : envoyé, puis DNF, puis déjà trouvée.
    const stateModifier = isSubmittedOk
        ? ' geoapp-log-cache-block--logged'
        : isPendingDnf
            ? ' geoapp-log-cache-block--dnf'
            : isPendingAlreadyFound
                ? ' geoapp-log-cache-block--found'
                : '';

    return (
        <div className={`geoapp-log-cache-block${stateModifier}`}>
            <div className='geoapp-log-cache-block__header'>
                <div className='geoapp-log-cache-block__code'>{gc.gc_code}</div>
                <div className='geoapp-log-cache-block__badges'>
                    {isPendingDnf && <DnfBadge />}
                    {isPendingAlreadyFound && (
                        <span
                            className='geoapp-log-state-badge geoapp-log-state-badge--found'
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
                    <div className='geoapp-log-cache-block__name'>{gc.name}</div>
                </div>
            </div>

            <div className='geoapp-log-cache-block__controls'>
                <div className='geoapp-log-cache-block__favorites'>
                    PF: {typeof gc.favorites_count === 'number' ? gc.favorites_count : '—'}
                    {'  '}(
                    {formatFavoritePercent(gc.favorites_count, gc.logs_count)}
                    )
                </div>
                <div className='geoapp-log-cache-block__fields'>
                    <label className='geoapp-log-cache-block__field'>
                        <span className='geoapp-log-cache-block__field-label'>Type</span>
                        <select
                            className={isPendingDnf
                                ? 'theia-select geoapp-log-select geoapp-log-select--dnf'
                                : 'theia-select geoapp-log-select'}
                            value={logType}
                            onChange={e => onLogTypeChange(e.target.value as LogTypeValue)}
                            disabled={isSubmittedOk}
                            title={isSubmittedOk
                                ? 'Log déjà envoyé pour cette géocache'
                                : isPendingAlreadyFound ? alreadyFoundTooltip(gc) : undefined}
                        >
                            <option value='found' disabled={isPendingAlreadyFound}>{getLogTypeLabel('found')}</option>
                            <option value='dnf'>{getLogTypeLabel('dnf')}</option>
                            <option value='note'>{getLogTypeLabel('note')}</option>
                            <option value='skip'>{getLogTypeLabel('skip')}</option>
                        </select>
                    </label>

                    <label className={logType === 'found'
                        ? 'geoapp-log-cache-block__field geoapp-log-cache-block__field--active'
                        : 'geoapp-log-cache-block__field geoapp-log-cache-block__field--inactive'}
                    >
                        <input
                            type='checkbox'
                            checked={isFavorite}
                            onChange={e => onFavoriteChange(e.target.checked)}
                            disabled={logType !== 'found' || noPointsLeft}
                            title={noPointsLeft
                                ? (favoritePointsPending
                                    ? 'Synchronisation du stock de PF avec Geocaching.com…'
                                    : 'Plus de PF disponibles')
                                : ''}
                        />
                        Donner un PF
                    </label>
                </div>
            </div>

            <div className='geoapp-log-cache-block__images'>
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

            <div className='geoapp-log-cache-block__toolbar'>
                <MarkdownToolbar
                    activeCaretFormat={activeCaretFormat}
                    isActive={isEditorActive}
                    disabled={isToolbarDisabled}
                    onApplyFormat={onApplyFormat}
                    onApplyPrefix={onApplyPrefix}
                />
                <button
                    className='theia-button secondary geoapp-log-button--compact'
                    onClick={onTranslate}
                    disabled={isToolbarDisabled || isTranslating || translateReason !== undefined}
                    title={translateReason ?? `Traduire ce log en ${logLanguage} avec l'IA`}
                >
                    {isTranslating ? '⏳ Traduction…' : '🌐 Traduire'}
                </button>
                {canRevertTranslation && (
                    <button
                        className='theia-button secondary geoapp-log-button--compact'
                        onClick={onRevertTranslation}
                        disabled={isTranslating}
                        title='Restaurer le texte tel qu’il était avant la traduction'
                    >
                        ↩ Original
                    </button>
                )}
                {globalText.trim() !== '' && (
                    <button
                        className='theia-button secondary geoapp-log-button--compact geoapp-log-cache-block__apply-global'
                        onClick={onApplyGlobalText}
                        disabled={isApplyGlobalTextDisabled}
                        title={applyGlobalTextTitle}
                    >
                        ↺ Texte commun
                    </button>
                )}
            </div>
            <div className='geoapp-log-cache-block__textarea'>
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
                    <PatternAutocompleteMenu
                        suggestions={autocompleteSuggestions}
                        activeIndex={autocompleteActiveIndex}
                        position={autocompletePosition}
                        onHover={onAutocompleteHover}
                        onSelect={onAutocompleteClick}
                    />
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
