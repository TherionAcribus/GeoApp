/**
 * Éditeur de log global (mode « texte identique pour toutes les géocaches »).
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 5). Composant de
 * présentation : tout l'état et les callbacks sont passés via props.
 */

import * as React from '@theia/core/shared/react';
import { LogTypeIcon } from '../geocache-log-type-icons';
import { CharCounter } from './char-counter';
import { ImagesSection } from './images-section';
import { GeocacheListItem, LogHistoryEntry, LogTypeValue, PatternSuggestion, SelectedLogImage } from './types';
import { MarkdownPreview } from './markdown-preview';
import { MarkdownToolbar } from './markdown-toolbar';
import { PatternAutocompleteMenu } from './pattern-autocomplete-menu';
import { TextareaWithOverlay } from './textarea-overlay';
import { MarkdownFormatKind } from '../log-markdown';

export interface GlobalLogEditorProps {
    // Date
    logDate: string;
    onLogDateChange: (value: string) => void;
    isLogDatePinned: boolean;
    onToggleLogDatePin: () => void;

    // Langue de traduction
    /** Langues proposées, dans l'ordre configuré en préférences. Vide = traduction indisponible. */
    translationLanguages: string[];
    logLanguage: string;
    onLogLanguageChange: (value: string) => void;
    isLogLanguagePinned: boolean;
    onToggleLogLanguagePin: () => void;
    onTranslate: () => void;
    /** Non vide quand la traduction est impossible : sert d'infobulle sur le bouton désactivé. */
    translateDisabledReason?: string;
    isTranslating: boolean;
    canRevertTranslation: boolean;
    onRevertTranslation: () => void;

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
        translationLanguages, logLanguage, onLogLanguageChange, isLogLanguagePinned, onToggleLogLanguagePin,
        onTranslate, translateDisabledReason, isTranslating, canRevertTranslation, onRevertTranslation,
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
            <div className='geoapp-log-global__row'>
                <div>
                    <label className='geoapp-log-global__label'>Date</label>
                    <div className='geoapp-log-global__date'>
                        <input
                            type='date'
                            className='theia-input geoapp-log-global__date-input'
                            value={logDate}
                            onChange={e => onLogDateChange(e.target.value)}
                        />
                        <button
                            className='theia-button secondary geoapp-log-global__pin'
                            onClick={onToggleLogDatePin}
                            title={isLogDatePinned
                                ? 'Date épinglée : elle sera réutilisée pour les prochains logs. Cliquer pour revenir à la date du jour.'
                                : 'Épingler la date pour la réutiliser lors des prochains logs'}
                            aria-pressed={isLogDatePinned}
                        >
                            <i className={isLogDatePinned ? 'fa fa-thumb-tack' : 'fa fa-thumb-tack fa-rotate-90'} />
                        </button>
                    </div>
                </div>
                <div>
                    <label className='geoapp-log-global__label'>Type</label>
                    <select
                        className='theia-select geoapp-log-global__select'
                        value={logType}
                        onChange={e => onLogTypeChange(e.target.value as LogTypeValue)}
                    >
                        <option value='found'>Found it</option>
                        <option value='dnf'>Didn't find it</option>
                        <option value='note'>Write note</option>
                        <option value='skip'>Ne pas loguer</option>
                    </select>
                    {logType === 'found' && pendingAlreadyFoundCount > 0 && (
                        <div className='geoapp-log-global__already-found' title={pendingAlreadyFoundCodes}>
                            <LogTypeIcon kind='found' size={13} />
                            {pendingAlreadyFoundCount} déjà trouvée(s) → "Ne pas loguer"
                        </div>
                    )}
                </div>
                <div>
                    <label className='geoapp-log-global__label'>Langue</label>
                    <div className='geoapp-log-global__language'>
                        <select
                            className='theia-select geoapp-log-global__language-select'
                            value={logLanguage}
                            onChange={e => onLogLanguageChange(e.target.value)}
                            disabled={translationLanguages.length === 0}
                            title={translationLanguages.length === 0
                                ? 'Aucune langue configurée : Préférences → Logs → Traduction.'
                                : 'Langue cible de la traduction IA'}
                        >
                            {/* La langue épinglée peut avoir été retirée des préférences depuis :
                                on l'ajoute en tête pour ne pas la perdre silencieusement. */}
                            {logLanguage !== '' && !translationLanguages.includes(logLanguage) && (
                                <option value={logLanguage}>{logLanguage}</option>
                            )}
                            {translationLanguages.map(language => (
                                <option key={language} value={language}>{language}</option>
                            ))}
                        </select>
                        <button
                            className='theia-button secondary geoapp-log-global__pin'
                            onClick={onToggleLogLanguagePin}
                            disabled={translationLanguages.length === 0 && logLanguage === ''}
                            title={isLogLanguagePinned
                                ? 'Langue épinglée : elle sera réutilisée pour les prochains logs. Cliquer pour revenir à la langue par défaut.'
                                : 'Épingler la langue pour la réutiliser lors des prochains logs'}
                            aria-pressed={isLogLanguagePinned}
                        >
                            <i className={isLogLanguagePinned ? 'fa fa-thumb-tack' : 'fa fa-thumb-tack fa-rotate-90'} />
                        </button>
                    </div>
                </div>
                <div className='geoapp-log-global__same-text'>
                    <input
                        type='checkbox'
                        checked={useSameTextForAll}
                        onChange={e => onToggleUseSameTextForAll(e.target.checked)}
                    />
                    <span className='geoapp-log-global__same-text-label'>Texte identique pour toutes les géocaches</span>
                    {!useSameTextForAll && globalText.trim() !== '' && (
                        <button
                            className='theia-button secondary geoapp-log-button--compact'
                            onClick={onApplyGlobalTextToAll}
                            title={`Remplacer le texte de chaque géocache par le texte commun :\n\n${globalTextExcerpt}`}
                        >
                            ↺ Réappliquer le texte commun
                        </button>
                    )}
                </div>
            </div>

            {useSameTextForAll && (
                <div>
                    <label className='geoapp-log-global__label'>Texte (Markdown)</label>
                    <div className='geoapp-log-global__toolbar'>
                        <div className='geoapp-log-anchor'>
                            <button
                                className='theia-button secondary geoapp-log-button--medium'
                                onClick={onToggleHistoryDropdown}
                                disabled={isToolbarDisabled || logHistory.length === 0}
                                title='Réutiliser un log récent'
                            >
                                📝 Logs récents ({logHistory.length})
                            </button>
                            {historyDropdownOpen && logHistory.length > 0 && (
                                <div className='geoapp-log-menu'>
                                    <div className='geoapp-log-menu__title'>
                                        Cliquez pour réutiliser le texte
                                    </div>
                                    {logHistory.map(entry => {
                                        const date = new Date(entry.createdAt);
                                        const dateStr = date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                        const timeStr = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                                        const preview = (entry.globalText ?? '').slice(0, 80);
                                        return (
                                            <div
                                                key={entry.id}
                                                className='geoapp-log-menu__entry'
                                                onClick={() => onApplyHistoryTextOnly(entry)}
                                            >
                                                <div className='geoapp-log-menu__entry-date'>
                                                    {dateStr} à {timeStr}
                                                </div>
                                                <div className='geoapp-log-menu__entry-preview'>
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
                        <button
                            className='theia-button secondary geoapp-log-button--medium'
                            onClick={onTranslate}
                            disabled={isToolbarDisabled || isTranslating || translateDisabledReason !== undefined || globalText.trim() === ''}
                            title={translateDisabledReason ?? `Traduire le log en ${logLanguage} avec l'IA`}
                        >
                            {isTranslating ? '⏳ Traduction…' : `🌐 Traduire en ${logLanguage || '…'}`}
                        </button>
                        {canRevertTranslation && (
                            <button
                                className='theia-button secondary geoapp-log-button--compact'
                                onClick={onRevertTranslation}
                                disabled={isTranslating}
                                title='Restaurer le texte tel qu’il était avant la traduction'
                            >
                                ↩ Revenir à l’original
                            </button>
                        )}
                    </div>
                    <div className='geoapp-log-anchor'>
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

                    <div className='geoapp-log-global__images'>
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
