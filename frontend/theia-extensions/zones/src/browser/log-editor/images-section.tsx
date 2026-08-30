/**
 * Section photos d'un log : zone de dépôt + liste des images sélectionnées.
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 2). Composant pur.
 * Les object URLs des miniatures sont gérées par le widget (mutualisées par fichier)
 * et fournies via `getPreviewUrl` ; l'ajout/retrait d'images est délégué via callbacks.
 */

import * as React from '@theia/core/shared/react';
import { formatFileSize } from './helpers';
import { SelectedLogImage } from './types';

const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/jpg,image/webp';

const carriesFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

export const ImagesSection: React.FC<{
    images: SelectedLogImage[];
    title: string;
    disabled: boolean;
    /** Vrai si une opération de glisser-déposer survole actuellement cette zone. */
    isDragOver: boolean;
    onAddFiles: (files: FileList | File[]) => void;
    onRemoveImage: (imageId: string) => void;
    onDragOverChange: (active: boolean) => void;
    /** Renvoie l'object URL de prévisualisation d'un fichier (créée au besoin). */
    getPreviewUrl: (file: File) => string | undefined;
}> = ({ images, title, disabled, isDragOver, onAddFiles, onRemoveImage, onDragOverChange, getPreviewUrl }) => {
    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onDragOverChange(false);
        if (disabled) {
            return;
        }
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            onAddFiles(files);
        }
    };

    const onDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
        }
        if (!disabled && carriesFiles(e)) {
            onDragOverChange(true);
        }
    };

    const onDragEnter = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!disabled && carriesFiles(e)) {
            onDragOverChange(true);
        }
    };

    const onDragLeave = (e: React.DragEvent) => {
        // Ignore les passages sur un enfant de la zone : le survol reste actif.
        const related = e.relatedTarget as Node | null;
        if (related && e.currentTarget.contains(related)) {
            return;
        }
        onDragOverChange(false);
    };

    return (
        <div style={{ border: '1px solid var(--theia-panel-border)', borderRadius: 6, padding: 10, background: 'var(--theia-editor-background)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                <div style={{ fontWeight: 700 }}>{title}</div>
                <label style={{ fontSize: 12, opacity: disabled ? 0.6 : 0.9, cursor: disabled ? 'not-allowed' : 'pointer' }}>
                    <input
                        type='file'
                        accept={ACCEPTED_IMAGE_TYPES}
                        multiple
                        disabled={disabled}
                        style={{ display: 'none' }}
                        onChange={e => {
                            const files = e.currentTarget.files;
                            if (files && files.length > 0) {
                                onAddFiles(files);
                            }
                            e.currentTarget.value = '';
                        }}
                    />
                    + Ajouter…
                </label>
            </div>

            <div
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragEnter={onDragEnter}
                onDragLeave={onDragLeave}
                style={{
                    border: isDragOver ? '2px dashed var(--theia-focusBorder)' : '1px dashed var(--theia-panel-border)',
                    borderRadius: 6,
                    padding: isDragOver ? 9 : 10,
                    fontSize: 12,
                    textAlign: 'center',
                    opacity: disabled ? 0.6 : 0.9,
                    color: isDragOver ? 'var(--theia-focusBorder)' : undefined,
                    fontWeight: isDragOver ? 600 : undefined,
                    background: isDragOver ? 'var(--theia-list-dropBackground, var(--theia-list-hoverBackground))' : 'var(--theia-editor-background)',
                    transition: 'background 0.12s ease, border-color 0.12s ease',
                }}
            >
                {isDragOver ? 'Dépose ici pour ajouter les images' : 'Glisse-dépose tes images ici'}
            </div>

            {images.length === 0 ? (
                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>Aucune photo</div>
            ) : (
                <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                    {images.map(img => {
                        const previewUrl = getPreviewUrl(img.file);
                        const size = formatFileSize(img.file.size);
                        return (
                        <div key={img.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', fontSize: 12 }}>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                                <div
                                    style={{
                                        width: 44,
                                        height: 44,
                                        flex: '0 0 auto',
                                        borderRadius: 4,
                                        border: '1px solid var(--theia-panel-border)',
                                        background: 'var(--theia-editorWidget-background)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        overflow: 'hidden',
                                    }}
                                >
                                    {previewUrl ? (
                                        <img
                                            src={previewUrl}
                                            alt={img.file.name}
                                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                                        />
                                    ) : (
                                        <span style={{ opacity: 0.6 }}>🖼️</span>
                                    )}
                                </div>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={img.file.name}>
                                        {img.file.name}
                                    </div>
                                    <div style={{ opacity: 0.8 }} title={img.status === 'ok' ? img.imageGuid : undefined}>
                                        {img.status === 'pending' && `📎 Prête — sera envoyée avec le log${size ? ` · ${size}` : ''}`}
                                        {img.status === 'uploading' && '⬆️ Envoi en cours…'}
                                        {img.status === 'ok' && '✅ Envoyée à Geocaching.com'}
                                        {img.status === 'failed' && `⚠️ ${img.error ?? 'échec'}`}
                                    </div>
                                </div>
                            </div>
                            <button
                                className='theia-button secondary'
                                style={{ fontSize: 12, padding: '2px 10px' }}
                                disabled={disabled || img.status === 'uploading'}
                                onClick={() => onRemoveImage(img.id)}
                                title='Retirer cette image'
                            >
                                Supprimer
                            </button>
                        </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
