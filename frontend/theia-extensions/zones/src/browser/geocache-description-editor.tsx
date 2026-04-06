import * as React from 'react';
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
    const descriptionRef = React.useRef<HTMLDivElement>(null);

    const hasModified = Boolean(geocacheData.description_override_raw) || Boolean(geocacheData.description_override_html);

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

    const displayLabel = variant === 'modified' ? 'Modifiée' : 'Originale';
    const effectiveHtml = getEffectiveDescriptionHtml(geocacheData, variant);

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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong>Description</strong>
                    <span style={{ opacity: 0.75, fontSize: 12 }}>(version: {displayLabel})</span>
                    {hasModified ? (
                        <span style={{ opacity: 0.75, fontSize: 12 }}>(modif. présente)</span>
                    ) : (
                        <span style={{ opacity: 0.75, fontSize: 12 }}>(pas de modif.)</span>
                    )}
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                        className='theia-button secondary'
                        onClick={() => switchVariant('original')}
                        disabled={isEditing || variant === 'original'}
                    >
                        Originale
                    </button>
                    <button
                        className='theia-button secondary'
                        onClick={() => switchVariant('modified')}
                        disabled={isEditing || (!hasModified && variant === 'modified')}
                        title={hasModified ? undefined : 'Aucune description modifiée'}
                    >
                        Modifiée
                    </button>
                    <button
                        className='theia-button secondary'
                        onClick={() => { void onTranslateToFrench(); }}
                        disabled={isEditing || isTranslating}
                        title='Traduire la description originale en français (conserve le HTML)'
                    >
                        {isTranslating ? 'Traduction…' : 'Traduire (FR)'}
                    </button>
                    <button
                        className='theia-button secondary'
                        onClick={() => { void onTranslateAllToFrench(); }}
                        disabled={isEditing || isTranslatingAll}
                        title='Traduire en français : description + indices + notes de waypoints'
                    >
                        {isTranslatingAll ? 'Traduction…' : 'Traduire tout (FR)'}
                    </button>
                    {!isEditing ? (
                        <button className='theia-button' onClick={startEdit}>Éditer</button>
                    ) : undefined}
                </div>
            </div>

            {!isEditing ? (
                <div
                    ref={descriptionRef}
                    style={{ border: '1px solid var(--theia-foreground)', borderRadius: 4, padding: 8, maxWidth: 900 }}
                    dangerouslySetInnerHTML={{ __html: effectiveHtml }}
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
