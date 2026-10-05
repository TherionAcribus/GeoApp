import { inject, injectable } from '@theia/core/shared/inversify';
import { BackendApiClient } from './backend-api-client';
import type { GeocacheImageV2Dto } from './geocache-images-panel';

/** Champs modifiables d'une image (`PATCH /api/geocache-images/<id>`). */
export interface GeocacheImagePatch {
    title?: string | null;
    note?: string | null;
    tags?: unknown[] | null;
    detected_features?: Record<string, unknown> | null;
    qr_payload?: string | null;
    ocr_text?: string | null;
    ocr_language?: string | null;
    image_type?: 'listing' | 'owner' | 'spoiler' | null;
}

/** Bilan de `POST /api/geocaches/<id>/images/store`. */
export interface GeocacheImagesStoreResult {
    stored: number;
    failed: { id: number; status?: number; error?: string }[];
    skipped: { id: number; reason: string }[];
}

/** Client de `/api/geocache-images` (cf. geocache-images-panel.tsx). */
@injectable()
export class GeocacheImagesService {
    constructor(
        @inject(BackendApiClient) protected readonly apiClient: BackendApiClient
    ) {}

    /** Images de la fiche, stockées ou distantes (déclenche la synchro des images du listing). */
    async listImages(geocacheId: number): Promise<GeocacheImageV2Dto[]> {
        return this.apiClient.requestJson<GeocacheImageV2Dto[]>(
            `/api/geocaches/${geocacheId}/images`, {}, 'Erreur lors du chargement des images'
        );
    }

    async updateImage(imageId: number, patch: GeocacheImagePatch): Promise<GeocacheImageV2Dto> {
        return this.apiClient.requestJson<GeocacheImageV2Dto>(
            `/api/geocache-images/${imageId}`,
            this.apiClient.createJsonInit('PATCH', patch),
            'Erreur lors de la mise à jour de l\'image'
        );
    }

    /** Télécharge l'image distante dans le stockage local. */
    async storeImage(imageId: number): Promise<GeocacheImageV2Dto> {
        return this.apiClient.requestJson<GeocacheImageV2Dto>(
            `/api/geocache-images/${imageId}/store`, { method: 'POST' },
            'Erreur lors du téléchargement de l\'image'
        );
    }

    /** Supprime le fichier local ; l'image reste liée à sa source distante. */
    async unstoreImage(imageId: number): Promise<GeocacheImageV2Dto> {
        return this.apiClient.requestJson<GeocacheImageV2Dto>(
            `/api/geocache-images/${imageId}/unstore`, { method: 'POST' },
            'Erreur lors de la suppression du fichier local'
        );
    }

    /** Télécharge toutes les images téléchargeables, ou le sous-ensemble `imageIds`. */
    async storeImages(geocacheId: number, imageIds?: number[]): Promise<GeocacheImagesStoreResult> {
        return this.apiClient.requestJson<GeocacheImagesStoreResult>(
            `/api/geocaches/${geocacheId}/images/store`,
            this.apiClient.createJsonInit('POST', imageIds !== undefined ? { image_ids: imageIds } : {}),
            'Erreur lors du téléchargement des images'
        );
    }

    async duplicateImage(imageId: number): Promise<GeocacheImageV2Dto> {
        return this.apiClient.requestJson<GeocacheImageV2Dto>(
            `/api/geocache-images/${imageId}/duplicate`, { method: 'POST' },
            'Erreur lors de la duplication de l\'image'
        );
    }

    /**
     * Supprime l'image et toutes ses dérivées. Refusé côté backend pour les
     * images racines du listing — seules les images ajoutées/éditées partent.
     */
    async deleteImage(imageId: number): Promise<{ deleted: number[] }> {
        return this.apiClient.requestJson<{ deleted: number[] }>(
            `/api/geocache-images/${imageId}`, { method: 'DELETE' },
            'Erreur lors de la suppression de l\'image'
        );
    }

    /** Supprime tous les fichiers locaux de la géocache (les liens distants restent). */
    async cleanupImages(geocacheId: number): Promise<void> {
        await this.apiClient.requestJson<{ message: string }>(
            `/api/geocaches/${geocacheId}/images/cleanup`, { method: 'POST' },
            'Erreur lors du nettoyage des images'
        );
    }

    /** Découpe un GIF animé : chaque frame devient une image dérivée. */
    async splitGif(imageId: number): Promise<Record<string, unknown>> {
        return this.apiClient.requestJson<Record<string, unknown>>(
            `/api/geocache-images/${imageId}/split-gif`, { method: 'POST' },
            'Erreur lors du découpage du GIF'
        );
    }

    /** Frames d'un GIF en base64, sans créer d'images (aperçu). */
    async extractGifFrames(imageId: number): Promise<{ frames: string[]; count: number }> {
        return this.apiClient.requestJson<{ frames: string[]; count: number }>(
            `/api/geocache-images/${imageId}/extract-frames`, { method: 'POST' },
            'Erreur lors de l\'extraction des frames'
        );
    }

    /** Ajoute une photo locale à la fiche (multipart `image_file`, + title/note). */
    async uploadImage(geocacheId: number, file: File, title?: string, note?: string): Promise<GeocacheImageV2Dto> {
        const formData = new FormData();
        formData.append('image_file', file);
        if (title) { formData.append('title', title); }
        if (note) { formData.append('note', note); }
        const res = await fetch(`${this.apiClient.getBaseUrl()}/api/geocaches/${geocacheId}/images/upload`, {
            method: 'POST',
            credentials: 'include',
            body: formData,
        });
        if (!res.ok) {
            const message = await res.text().catch(() => `HTTP ${res.status}`);
            throw new Error(message || `HTTP ${res.status}`);
        }
        return res.json() as Promise<GeocacheImageV2Dto>;
    }

    /** Exécute un plugin du backend (`qr_code_detector`, `exif_reader`, `easyocr_ocr`, `vision_ocr`…). */
    async executeImagePlugin(pluginName: string, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
        return this.apiClient.requestJson<Record<string, unknown>>(
            `/api/plugins/${encodeURIComponent(pluginName)}/execute`,
            this.apiClient.createJsonInit('POST', { inputs }),
            `Erreur lors de l'exécution du plugin ${pluginName}`
        );
    }

    /** Contenu binaire de l'image via le proxy backend `/raw` (stockée ou distante). */
    async fetchImageBlob(imageId: number): Promise<Blob> {
        const res = await fetch(`${this.apiClient.getBaseUrl()}/api/geocache-images/${imageId}/raw`, {
            credentials: 'include',
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        return res.blob();
    }
}
