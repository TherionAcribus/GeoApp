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
        <div className='geoapp-log-images'>
            <div className='geoapp-log-images__header'>
                <div className='geoapp-log-images__title'>{title}</div>
                <label className={disabled
                    ? 'geoapp-log-images__add geoapp-log-images__add--disabled'
                    : 'geoapp-log-images__add'}
                >
                    <input
                        type='file'
                        className='geoapp-log-images__file-input'
                        accept={ACCEPTED_IMAGE_TYPES}
                        multiple
                        disabled={disabled}
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
                className={[
                    'geoapp-log-images__dropzone',
                    isDragOver ? 'geoapp-log-images__dropzone--over' : '',
                    disabled ? 'geoapp-log-images__dropzone--disabled' : '',
                ].filter(Boolean).join(' ')}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragEnter={onDragEnter}
                onDragLeave={onDragLeave}
            >
                {isDragOver ? 'Dépose ici pour ajouter les images' : 'Glisse-dépose tes images ici'}
            </div>

            {images.length === 0 ? (
                <div className='geoapp-log-images__empty'>Aucune photo</div>
            ) : (
                <div className='geoapp-log-images__list'>
                    {images.map(img => {
                        const previewUrl = getPreviewUrl(img.file);
                        const size = formatFileSize(img.file.size);
                        return (
                        <div key={img.id} className='geoapp-log-images__item'>
                            <div className='geoapp-log-images__item-main'>
                                <div className='geoapp-log-images__thumb'>
                                    {previewUrl ? (
                                        <img src={previewUrl} alt={img.file.name} />
                                    ) : (
                                        <span className='geoapp-log-images__thumb-placeholder'>🖼️</span>
                                    )}
                                </div>
                                <div className='geoapp-log-images__meta'>
                                    <div className='geoapp-log-images__name' title={img.file.name}>
                                        {img.file.name}
                                    </div>
                                    <div
                                        className='geoapp-log-images__status'
                                        title={img.status === 'ok' ? img.imageGuid : undefined}
                                    >
                                        {img.status === 'pending' && `📎 Prête — sera envoyée avec le log${size ? ` · ${size}` : ''}`}
                                        {img.status === 'uploading' && '⬆️ Envoi en cours…'}
                                        {img.status === 'ok' && '✅ Envoyée à Geocaching.com'}
                                        {img.status === 'failed' && `⚠️ ${img.error ?? 'échec'}`}
                                    </div>
                                </div>
                            </div>
                            <button
                                className='theia-button secondary geoapp-log-button--medium'
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
