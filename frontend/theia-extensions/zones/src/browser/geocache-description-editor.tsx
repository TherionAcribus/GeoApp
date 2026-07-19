import * as React from 'react';
import DOMPurify from '@theia/core/shared/dompurify';
import { UpdateDescriptionInput } from './geocache-details-service';
import { DescriptionVariant, GeocacheDto } from './geocache-details-types';

export interface DescriptionEditorProps {
    geocacheData: GeocacheDto;
    geocacheId: number;
    defaultVariant: DescriptionVariant;
    onVariantChange: (variant: DescriptionVariant) => void;
    getEffectiveDescriptionHtml: (data: GeocacheDto, variant: DescriptionVariant) => string;
    onSaveDescription: (payload: UpdateDescriptionInput) => Promise<void>;
    onResetDescription: () => Promise<void>;
    onTranslateToFrench: () => Promise<void>;
    isTranslating: boolean;
    onTranslateAllToFrench: () => Promise<void>;
    isTranslatingAll: boolean;
    externalLinksOpenMode: 'new-tab' | 'new-window';
}

const headerRowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap'
};
const segmentedStyle: React.CSSProperties = {
    display: 'inline-flex',
    border: '1px solid var(--theia-panel-border)',
    borderRadius: 4,
    overflow: 'hidden'
};
const segmentBaseStyle: React.CSSProperties = {
    fontSize: 12,
    padding: '3px 12px',
    border: 'none',
    background: 'transparent',
    color: 'var(--theia-foreground)',
    cursor: 'pointer',
    lineHeight: 1.6
};
const chipBaseStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 10,
    whiteSpace: 'nowrap'
};
const modifiedChipStyle: React.CSSProperties = {
    ...chipBaseStyle,
    border: '1px solid var(--theia-charts-blue, #60a5fa)',
    color: 'var(--theia-charts-blue, #60a5fa)'
};
const mutedChipStyle: React.CSSProperties = {
    ...chipBaseStyle,
    color: 'var(--theia-descriptionForeground, var(--theia-foreground))',
    opacity: 0.6
};
const descBoxStyle: React.CSSProperties = {
    border: '1px solid var(--theia-foreground)',
    borderRadius: 4,
    padding: 8,
    maxWidth: 900,
    transition: 'opacity 0.15s ease'
};
const translateBannerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    padding: '6px 10px',
    borderRadius: 4,
    maxWidth: 900,
    background: 'var(--theia-editorWidget-background, rgba(96, 165, 250, 0.08))',
    border: '1px solid var(--theia-charts-blue, #60a5fa)',
    color: 'var(--theia-foreground)'
};
const translateMenuStyle: React.CSSProperties = {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 4,
    minWidth: 280,
    background: 'var(--theia-menu-background)',
    border: '1px solid var(--theia-menu-border)',
    borderRadius: 4,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
    zIndex: 100,
    padding: '4px 0'
};
const translateMenuItemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    width: '100%',
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: '8px 12px',
    color: 'var(--theia-menu-foreground)'
};
const translateMenuIconStyle: React.CSSProperties = { fontSize: 16, lineHeight: '18px', flexShrink: 0 };
const translateMenuTextColStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2 };
const translateMenuTitleStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600 };
const translateMenuSubStyle: React.CSSProperties = { fontSize: 11, opacity: 0.7 };

const toolbarStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    padding: '4px 6px',
    background: 'var(--theia-editorGroupHeader-tabsBackground, var(--theia-panel-background))',
    border: '1px solid var(--theia-panel-border)',
    borderBottom: 'none',
    borderRadius: '4px 4px 0 0',
    flexWrap: 'wrap'
};
const toolbarBtnStyle: React.CSSProperties = {
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: 3,
    padding: '3px 7px',
    cursor: 'pointer',
    color: 'var(--theia-foreground)',
    fontSize: 12,
    lineHeight: 1
};
const toolbarSepStyle: React.CSSProperties = {
    display: 'inline-block',
    width: 1,
    height: 16,
    background: 'var(--theia-panel-border)',
    margin: '0 4px',
    flexShrink: 0
};
const toolbarSelectStyle: React.CSSProperties = {
    background: 'var(--theia-input-background, transparent)',
    border: '1px solid var(--theia-panel-border)',
    borderRadius: 3,
    padding: '2px 4px',
    cursor: 'pointer',
    color: 'var(--theia-foreground)',
    fontSize: 11,
    height: 22,
    outline: 'none'
};
const editorContentStyle: React.CSSProperties = {
    border: '1px solid var(--theia-panel-border)',
    borderRadius: '0 0 4px 4px',
    padding: '8px 10px',
    minHeight: 180,
    maxHeight: 520,
    overflowY: 'auto',
    outline: 'none',
    lineHeight: 1.6,
    fontSize: 'inherit',
    color: 'var(--theia-foreground)',
    background: 'var(--theia-input-background, var(--theia-editor-background))'
};

function formatOverrideDate(iso?: string): string | undefined {
    if (!iso) {
        return undefined;
    }
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        return undefined;
    }
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function segmentStyle(active: boolean, disabled: boolean): React.CSSProperties {
    return {
        ...segmentBaseStyle,
        background: active ? 'var(--theia-button-background)' : 'transparent',
        color: active ? 'var(--theia-button-foreground)' : 'var(--theia-foreground)',
        fontWeight: active ? 600 : 400,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1
    };
}

export const DescriptionEditor: React.FC<DescriptionEditorProps> = ({
    geocacheData,
    geocacheId,
    defaultVariant,
    onVariantChange,
    getEffectiveDescriptionHtml,
    onSaveDescription,
    onResetDescription,
    onTranslateToFrench,
    isTranslating,
    onTranslateAllToFrench,
    isTranslatingAll,
    externalLinksOpenMode
}) => {
    const [variant, setVariant] = React.useState<DescriptionVariant>(defaultVariant);
    const [isEditing, setIsEditing] = React.useState(false);
    const [isTranslateMenuOpen, setIsTranslateMenuOpen] = React.useState(false);
    const descriptionRef = React.useRef<HTMLDivElement>(null);
    const translateMenuRef = React.useRef<HTMLDivElement>(null);
    const editorRef = React.useRef<HTMLDivElement>(null);
    const savedSelectionRef = React.useRef<Range | null>(null);

    const hasModified = Boolean(geocacheData.description_override_raw) || Boolean(geocacheData.description_override_html);
    const isAnyTranslating = isTranslating || isTranslatingAll;
    const overrideDate = formatOverrideDate(geocacheData.description_override_updated_at);

    React.useEffect(() => {
        if (!isTranslateMenuOpen) { return; }
        const handleClickOutside = (event: MouseEvent): void => {
            if (translateMenuRef.current && !translateMenuRef.current.contains(event.target as Node)) {
                setIsTranslateMenuOpen(false);
            }
        };
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') { setIsTranslateMenuOpen(false); }
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isTranslateMenuOpen]);

    const runTranslate = (action: () => Promise<void>): void => {
        setIsTranslateMenuOpen(false);
        void action();
    };

    // Réinitialisation complète uniquement quand on change de géocache.
    React.useEffect(() => {
        setVariant(defaultVariant);
        setIsEditing(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [geocacheId]);

    // Synchronise la variante affichée si le parent la change, sans interrompre une édition
    // en cours (sinon démarrer l'édition, qui bascule sur « modifiée », s'auto-annulerait).
    React.useEffect(() => {
        setVariant(defaultVariant);
    }, [defaultVariant]);

    const switchVariant = (next: DescriptionVariant) => {
        setVariant(next);
        onVariantChange(next);
    };

    // Initialise le contenteditable quand on entre en mode édition.
    React.useEffect(() => {
        if (isEditing && editorRef.current) {
            const html =
                geocacheData.description_override_html
                || geocacheData.description_html
                || '';
            editorRef.current.innerHTML = DOMPurify.sanitize(html);
            editorRef.current.focus();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isEditing]);

    const execFormat = (command: string, value?: string): void => {
        editorRef.current?.focus();
        document.execCommand(command, false, value);
    };

    // Sauvegarde la sélection courante avant que le focus quitte le contenteditable
    // (utile pour le color picker qui ouvre une fenêtre native et vole le focus).
    const saveSelection = (): void => {
        const sel = window.getSelection();
        savedSelectionRef.current = (sel && sel.rangeCount > 0) ? sel.getRangeAt(0).cloneRange() : null;
    };

    const restoreSelection = (): void => {
        if (savedSelectionRef.current) {
            const sel = window.getSelection();
            if (sel) {
                sel.removeAllRanges();
                sel.addRange(savedSelectionRef.current.cloneRange());
            }
        }
        editorRef.current?.focus();
    };

    const restoreAndApplyColor = (color: string): void => {
        restoreSelection();
        document.execCommand('foreColor', false, color);
    };

    const restoreAndApplyBackColor = (color: string): void => {
        restoreSelection();
        document.execCommand('hiliteColor', false, color);
    };

    const applyFontSize = (px: string): void => {
        restoreSelection();
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { return; }
        const range = sel.getRangeAt(0);
        const span = document.createElement('span');
        span.style.fontSize = px;
        try {
            // Cas simple : la sélection ne traverse pas de frontières d'éléments.
            range.surroundContents(span);
        } catch {
            // Cas complexe (sélection partielle sur plusieurs éléments) : extrait et
            // ré-insère le fragment dans un span.
            const fragment = range.extractContents();
            span.appendChild(fragment);
            range.insertNode(span);
        }
    };

    const handleEditorPaste = (e: React.ClipboardEvent<HTMLDivElement>): void => {
        e.preventDefault();
        const html = e.nativeEvent.clipboardData?.getData('text/html') || '';
        const text = e.nativeEvent.clipboardData?.getData('text/plain') || '';
        const content = html
            ? DOMPurify.sanitize(html)
            : text.replace(/\n/g, '<br>');
        document.execCommand('insertHTML', false, content);
    };

    const startEdit = () => {
        setIsEditing(true);
        // Ne basculer sur « modifiée » que si une version modifiée existe déjà ; sinon on
        // éviterait d'afficher une « modifiée » vide en cas d'annulation.
        if (hasModified) {
            switchVariant('modified');
        }
    };

    const cancelEdit = () => {
        setIsEditing(false);
    };

    const saveDescription = async () => {
        try {
            const html = DOMPurify.sanitize(editorRef.current?.innerHTML || '');
            await onSaveDescription({ description_override_html: html });
            setIsEditing(false);
        } catch (e) {
            console.error('Save description error', e);
        }
    };

    const resetDescription = async () => {
        try {
            await onResetDescription();
            setIsEditing(false);
            switchVariant('original');
        } catch (e) {
            console.error('Reset description error', e);
        }
    };

    const effectiveHtml = getEffectiveDescriptionHtml(geocacheData, variant);
    // Le HTML provient de geocaching.com (contenu tiers non maîtrisé) : on le nettoie avant
    // injection pour neutraliser tout script/handler. Mémoïsé pour éviter de re-sanitiser à
    // chaque render quand le HTML n'a pas changé.
    const sanitizedHtml = React.useMemo(() => DOMPurify.sanitize(effectiveHtml), [effectiveHtml]);

    React.useEffect(() => {
        const handleLinkClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            const link = target.closest('a');
            if (link && link.href && (link.href.startsWith('http://') || link.href.startsWith('https://'))) {
                e.preventDefault();
                e.stopPropagation();

                if (externalLinksOpenMode === 'new-window') {
                    window.open(link.href, '_blank', 'noopener,noreferrer');
                } else {
                    window.open(link.href, '_blank');
                }
            }
        };

        const descElement = descriptionRef.current;
        if (descElement) {
            descElement.addEventListener('click', handleLinkClick);
            return () => {
                descElement.removeEventListener('click', handleLinkClick);
            };
        }
        return undefined;
    }, [externalLinksOpenMode, effectiveHtml]);

    return (
        <div style={{ display: 'grid', gap: 8 }}>
            <div style={headerRowStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <strong>Description</strong>

                    {/* Bascule de version (segmented control) */}
                    <div role='radiogroup' aria-label='Version de la description' style={segmentedStyle}>
                        <button
                            type='button'
                            role='radio'
                            aria-checked={variant === 'original'}
                            onClick={() => switchVariant('original')}
                            disabled={isEditing}
                            style={segmentStyle(variant === 'original', isEditing)}
                            title='Afficher la description originale'
                        >
                            Originale
                        </button>
                        <button
                            type='button'
                            role='radio'
                            aria-checked={variant === 'modified'}
                            onClick={() => switchVariant('modified')}
                            disabled={isEditing || !hasModified}
                            style={segmentStyle(variant === 'modified', isEditing || !hasModified)}
                            title={hasModified ? 'Afficher la description modifiée / traduite' : 'Aucune description modifiée'}
                        >
                            Modifiée
                        </button>
                    </div>

                    {/* Indicateur d'état de la version modifiée */}
                    {hasModified ? (
                        <span
                            style={modifiedChipStyle}
                            title={overrideDate ? `Version modifiée disponible (mise à jour le ${overrideDate})` : 'Une version modifiée / traduite existe'}
                        >
                            <span aria-hidden='true'>✦</span>
                            {overrideDate ? `Modifiée · ${overrideDate}` : 'Modifiée'}
                        </span>
                    ) : (
                        <span style={mutedChipStyle}>Aucune modification</span>
                    )}
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {/* Menu de traduction */}
                    <div ref={translateMenuRef} style={{ position: 'relative' }}>
                        <button
                            className='theia-button secondary'
                            onClick={() => setIsTranslateMenuOpen(open => !open)}
                            disabled={isEditing || isAnyTranslating}
                            aria-haspopup='menu'
                            aria-expanded={isTranslateMenuOpen}
                            title="Traduire en français avec l'IA"
                            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                        >
                            {isAnyTranslating ? (
                                <>
                                    <i className='fa fa-spinner fa-spin' aria-hidden='true' />
                                    <span>Traduction…</span>
                                </>
                            ) : (
                                <>
                                    <span aria-hidden='true'>🌐</span>
                                    <span>Traduire</span>
                                    <span aria-hidden='true' style={{ fontSize: 10, marginLeft: 2 }}>▾</span>
                                </>
                            )}
                        </button>
                        {isTranslateMenuOpen && (
                            <div role='menu' aria-label='Options de traduction' style={translateMenuStyle}>
                                <button
                                    type='button'
                                    role='menuitem'
                                    onClick={() => runTranslate(onTranslateToFrench)}
                                    style={translateMenuItemStyle}
                                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--theia-menu-selectionBackground)'; }}
                                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                                >
                                    <span aria-hidden='true' style={translateMenuIconStyle}>📝</span>
                                    <span style={translateMenuTextColStyle}>
                                        <span style={translateMenuTitleStyle}>Description seule</span>
                                        <span style={translateMenuSubStyle}>Conserve le HTML, traduit uniquement le texte</span>
                                    </span>
                                </button>
                                <button
                                    type='button'
                                    role='menuitem'
                                    onClick={() => runTranslate(onTranslateAllToFrench)}
                                    style={translateMenuItemStyle}
                                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--theia-menu-selectionBackground)'; }}
                                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                                >
                                    <span aria-hidden='true' style={translateMenuIconStyle}>🌍</span>
                                    <span style={translateMenuTextColStyle}>
                                        <span style={translateMenuTitleStyle}>Tout le contenu</span>
                                        <span style={translateMenuSubStyle}>Description + indices + notes de waypoints</span>
                                    </span>
                                </button>
                            </div>
                        )}
                    </div>

                    {!isEditing ? (
                        <button
                            className='theia-button'
                            onClick={startEdit}
                            disabled={isAnyTranslating}
                            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                        >
                            <span aria-hidden='true'>✎</span>
                            <span>Éditer</span>
                        </button>
                    ) : undefined}
                </div>
            </div>

            {/* Bannière de progression de la traduction */}
            {isAnyTranslating ? (
                <div style={translateBannerStyle} role='status' aria-live='polite'>
                    <i className='fa fa-spinner fa-spin' aria-hidden='true' />
                    <span>
                        {isTranslatingAll
                            ? 'Traduction en cours : description + indices + notes de waypoints…'
                            : 'Traduction de la description en cours…'}
                    </span>
                </div>
            ) : undefined}

            {!isEditing ? (
                <div
                    ref={descriptionRef}
                    style={{ ...descBoxStyle, opacity: isAnyTranslating ? 0.55 : 1 }}
                    dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
                />
            ) : (
                <div style={{ display: 'grid', gap: 8, maxWidth: 900 }}>
                    {/* Barre d'outils de l'éditeur */}
                    <div style={toolbarStyle}>
                        <button type='button' title='Gras' aria-label='Gras' style={toolbarBtnStyle} onClick={() => execFormat('bold')}>
                            <i className='fa fa-bold' aria-hidden='true' />
                        </button>
                        <button type='button' title='Italique' aria-label='Italique' style={toolbarBtnStyle} onClick={() => execFormat('italic')}>
                            <i className='fa fa-italic' aria-hidden='true' />
                        </button>
                        <button type='button' title='Souligné' aria-label='Souligné' style={toolbarBtnStyle} onClick={() => execFormat('underline')}>
                            <i className='fa fa-underline' aria-hidden='true' />
                        </button>
                        <span style={toolbarSepStyle} />
                        {/* Sélecteur de taille de police */}
                        <select
                            title="Taille du texte (sélectionner du texte d'abord)"
                            style={toolbarSelectStyle}
                            value=''
                            onMouseDown={saveSelection}
                            onChange={(e) => { applyFontSize(e.target.value); }}
                        >
                            <option value='' disabled>Taille</option>
                            <option value='10px'>10</option>
                            <option value='12px'>12</option>
                            <option value='14px'>14</option>
                            <option value='16px'>16</option>
                            <option value='18px'>18</option>
                            <option value='20px'>20</option>
                            <option value='24px'>24</option>
                            <option value='28px'>28</option>
                            <option value='32px'>32</option>
                            <option value='48px'>48</option>
                        </select>
                        <span style={toolbarSepStyle} />
                        <button type='button' title='Liste à puces' aria-label='Liste à puces' style={toolbarBtnStyle} onClick={() => execFormat('insertUnorderedList')}>
                            <i className='fa fa-list-ul' aria-hidden='true' />
                        </button>
                        <button type='button' title='Liste numérotée' aria-label='Liste numérotée' style={toolbarBtnStyle} onClick={() => execFormat('insertOrderedList')}>
                            <i className='fa fa-list-ol' aria-hidden='true' />
                        </button>
                        <span style={toolbarSepStyle} />
                        <button type='button' title='Aligner à gauche' aria-label='Aligner à gauche' style={toolbarBtnStyle} onClick={() => execFormat('justifyLeft')}>
                            <i className='fa fa-align-left' aria-hidden='true' />
                        </button>
                        <button type='button' title='Centrer' aria-label='Centrer' style={toolbarBtnStyle} onClick={() => execFormat('justifyCenter')}>
                            <i className='fa fa-align-center' aria-hidden='true' />
                        </button>
                        <button type='button' title='Aligner à droite' aria-label='Aligner à droite' style={toolbarBtnStyle} onClick={() => execFormat('justifyRight')}>
                            <i className='fa fa-align-right' aria-hidden='true' />
                        </button>
                        <button type='button' title='Justifier' aria-label='Justifier' style={toolbarBtnStyle} onClick={() => execFormat('justifyFull')}>
                            <i className='fa fa-align-justify' aria-hidden='true' />
                        </button>
                        <span style={toolbarSepStyle} />
                        {/* Couleur du texte — label invisible sur input type=color pour ouvrir le picker natif */}
                        <label
                            title='Couleur du texte'
                            aria-label='Couleur du texte'
                            style={{ ...toolbarBtnStyle, cursor: 'pointer', position: 'relative', display: 'inline-flex', alignItems: 'center' }}
                            onMouseDown={saveSelection}
                        >
                            <i className='fa fa-font' aria-hidden='true' />
                            <input
                                type='color'
                                defaultValue='#ff0000'
                                style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%', inset: 0, cursor: 'pointer' }}
                                onChange={(e) => restoreAndApplyColor(e.target.value)}
                            />
                        </label>
                        {/* Couleur de fond du texte (surlignage) */}
                        <label
                            title='Couleur de fond du texte'
                            aria-label='Couleur de fond du texte'
                            style={{ ...toolbarBtnStyle, cursor: 'pointer', position: 'relative', display: 'inline-flex', alignItems: 'center' }}
                            onMouseDown={saveSelection}
                        >
                            <i className='fa fa-paint-brush' aria-hidden='true' />
                            <input
                                type='color'
                                defaultValue='#ffff00'
                                style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%', inset: 0, cursor: 'pointer' }}
                                onChange={(e) => restoreAndApplyBackColor(e.target.value)}
                            />
                        </label>
                        <span style={toolbarSepStyle} />
                        <button
                            type='button'
                            title='Insérer un lien'
                            aria-label='Insérer un lien'
                            style={toolbarBtnStyle}
                            onClick={() => {
                                const url = window.prompt('URL du lien :');
                                if (url) { execFormat('createLink', url); }
                            }}
                        >
                            <i className='fa fa-link' aria-hidden='true' />
                        </button>
                        <button type='button' title='Supprimer le lien' aria-label='Supprimer le lien' style={toolbarBtnStyle} onClick={() => execFormat('unlink')}>
                            <i className='fa fa-unlink' aria-hidden='true' />
                        </button>
                        <span style={toolbarSepStyle} />
                        <button type='button' title='Supprimer la mise en forme' aria-label='Supprimer la mise en forme' style={toolbarBtnStyle} onClick={() => execFormat('removeFormat')}>
                            <i className='fa fa-eraser' aria-hidden='true' />
                        </button>
                    </div>

                    {/* Zone d'édition WYSIWYG */}
                    <div
                        ref={editorRef}
                        contentEditable
                        suppressContentEditableWarning
                        onPaste={handleEditorPaste}
                        style={editorContentStyle}
                        aria-label='Éditeur de description'
                        aria-multiline='true'
                    />

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
                        <button
                            className='theia-button secondary'
                            onClick={resetDescription}
                            disabled={!hasModified}
                            title={!hasModified ? 'Aucune description modifiée' : undefined}
                        >
                            Revenir à l'originale
                        </button>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button className='theia-button secondary' onClick={cancelEdit}>Annuler</button>
                            <button className='theia-button' onClick={saveDescription}>Sauvegarder</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
