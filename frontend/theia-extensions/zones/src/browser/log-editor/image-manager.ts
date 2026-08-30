/**
 * Gestion des images sélectionnées pour les logs.
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 6). Les fonctions
 * de manipulation de liste et de gestion des object URLs sont pures ; l'upload
 * effectif reste dans le widget car il dépend de l'état de progression.
 */

import { SelectedLogImage } from './types';

/** Génère un identifiant unique pour une image sélectionnée. */
export function generateImageId(): string {
    try {
        const w: any = window as any;
        if (w?.crypto?.randomUUID) {
            return w.crypto.randomUUID();
        }
    } catch {
    }
    return `img-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Crée des `SelectedLogImage` à partir d'une liste de fichiers. */
export function createSelectedImagesFromFiles(files: FileList | File[]): SelectedLogImage[] {
    const list = Array.from(files as any as File[]).filter(f => f instanceof File);
    return list.map(file => ({
        id: generateImageId(),
        file,
        status: 'pending',
    }));
}

/** Ajoute des images à une liste existante. */
export function addImagesToList(
    current: SelectedLogImage[],
    newImages: SelectedLogImage[]
): SelectedLogImage[] {
    return [...current, ...newImages];
}

/** Retire une image par son ID. */
export function removeImageFromList(
    current: SelectedLogImage[],
    imageId: string
): SelectedLogImage[] {
    return current.filter(img => img.id !== imageId);
}

/** Renvoie (en la créant au besoin) l'object URL de prévisualisation d'un fichier. */
export function getOrCreatePreviewUrl(
    file: File,
    cache: Map<File, string>
): string | undefined {
    const existing = cache.get(file);
    if (existing) {
        return existing;
    }
    try {
        const url = URL.createObjectURL(file);
        cache.set(file, url);
        return url;
    } catch (e) {
        console.warn('[image-manager] createObjectURL failed', e);
        return undefined;
    }
}

/** Libère les object URLs des fichiers qui ne sont plus référencés. */
export function releaseUnusedPreviewUrls(
    cache: Map<File, string>,
    globalImages: SelectedLogImage[],
    perCacheImages: Record<number, SelectedLogImage[]>
): void {
    const inUse = new Set<File>();
    for (const img of globalImages) {
        inUse.add(img.file);
    }
    for (const list of Object.values(perCacheImages)) {
        for (const img of list) {
            inUse.add(img.file);
        }
    }
    for (const [file, url] of Array.from(cache.entries())) {
        if (!inUse.has(file)) {
            try {
                URL.revokeObjectURL(url);
            } catch {
            }
            cache.delete(file);
        }
    }
}

/** Réinitialise une image en mode « pending » pour un re-upload. */
export function resetImageForUpload(img: SelectedLogImage): SelectedLogImage {
    return {
        ...img,
        status: 'pending',
        imageGuid: undefined,
        error: undefined,
    };
}

/** Marque une image comme « uploading ». */
export function markImageUploading(img: SelectedLogImage): SelectedLogImage {
    return { ...img, status: 'uploading', error: undefined };
}

/** Calcule le résultat d'upload depuis une liste d'images traitées. */
export function computeImagesUploadResult(images: SelectedLogImage[]): {
    guids: string[];
    total: number;
    failed: number;
} {
    return {
        guids: images.filter(x => x.status === 'ok' && typeof x.imageGuid === 'string').map(x => x.imageGuid as string),
        total: images.length,
        failed: images.filter(x => x.status !== 'ok' || typeof x.imageGuid !== 'string').length,
    };
}
