import * as React from 'react';
import DOMPurify from '@theia/core/shared/dompurify';
import { UpdateDescriptionInput } from './geocache-details-service';
import { DescriptionVariant, GeocacheDto } from './geocache-details-types';
import { rawTextToHtml } from './geocache-details-utils';

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
    const [editedRaw, setEditedRaw] = React.useState('');
    const [isTranslateMenuOpen, setIsTranslateMenuOpen] = React.useState(false);
    const descriptionRef = React.useRef<HTMLDivElement>(null);
    const translateMenuRef = React.useRef<HTMLDivElement>(null);

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

    React.useEffect(() => {
        setVariant(defaultVariant);
        setIsEditing(false);
        setEditedRaw('');
    }, [geocacheId, defaultVariant]);

    const switchVariant = (next: DescriptionVariant) => {
        setVariant(next);
        onVariantChange(next);
    };

    const startEdit = () => {
        const currentRaw = geocacheData.description_override_raw ?? geocacheData.description_raw ?? '';
        setEditedRaw(currentRaw);
        setIsEditing(true);
        switchVariant('modified');
    };

    const cancelEdit = () => {
        setIsEditing(false);
        setEditedRaw('');
    };

    const saveDescription = async () => {
        try {
            await onSaveDescription({
                description_override_raw: editedRaw,
                description_override_html: rawTextToHtml(editedRaw)
            });
            setIsEditing(false);
        } catch (e) {
            console.error('Save description error', e);
        }
    };

    const resetDescription = async () => {
        try {
            await onResetDescription();
            setIsEditing(false);
            setEditedRaw('');
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
                    <textarea
                        className='theia-input'
                        value={editedRaw}
                        onChange={e => setEditedRaw(e.target.value)}
                        rows={10}
                        style={{ width: '100%', resize: 'vertical' }}
                    />
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
