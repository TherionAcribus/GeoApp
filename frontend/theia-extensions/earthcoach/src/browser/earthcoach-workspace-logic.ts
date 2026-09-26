import { GeoImage } from './earthcoach-types';
import { EarthCoachWorkspaceGroup } from './earthcoach-workspace-types';

export interface EarthCoachPreparedImages {
    available: GeoImage[];
    failures: Array<{ id: string; label?: string; reason: string }>;
}

async function assertFetchableImage(url: string, fetchImage: (url: string) => Promise<Response>): Promise<void> {
    const response = await fetchImage(url);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) {
        throw new Error('contenu non image');
    }
}

export async function prepareEarthCoachImagesForTransmission(
    images: GeoImage[],
    fetchImage: (url: string) => Promise<Response>,
    storeImage: (imageId: number) => Promise<string>
): Promise<EarthCoachPreparedImages> {
    const checked = await Promise.all(images.map(async image => {
        try {
            await assertFetchableImage(image.fileUri, fetchImage);
            return { image };
        } catch (directError) {
            const imageId = Number(image.id);
            if (!Number.isInteger(imageId) || imageId <= 0) {
                return { image, reason: directError instanceof Error ? directError.message : String(directError) };
            }
            try {
                const localUrl = await storeImage(imageId);
                await assertFetchableImage(localUrl, fetchImage);
                return { image: { ...image, fileUri: localUrl } };
            } catch (fallbackError) {
                return {
                    image,
                    reason: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
                };
            }
        }
    }));
    return {
        available: checked.filter(item => !item.reason).map(item => item.image),
        failures: checked.filter(item => item.reason).map(item => ({
            id: item.image.id,
            label: item.image.label,
            reason: item.reason || 'image indisponible',
        })),
    };
}

export interface EarthCoachSelectionValidation {
    valid: boolean;
    needsWithoutPhotoConfirmation: boolean;
    error?: string;
}

export function validateEarthCoachSelection(
    selected: GeoImage[],
    groups: EarthCoachWorkspaceGroup[],
    limit: number,
    confirmedWithoutPersonalPhoto: boolean
): EarthCoachSelectionValidation {
    if (selected.length > limit) {
        return {
            valid: false,
            needsWithoutPhotoConfirmation: false,
            error: `Réduisez la sélection à ${limit} images maximum (${selected.length} actuellement).`,
        };
    }
    const selectedIds = new Set(selected.map(image => Number(image.id)).filter(Number.isFinite));
    for (const group of groups) {
        const selectedCount = group.members.filter(member => selectedIds.has(member.image_id)).length;
        if (selectedCount > 0 && selectedCount < group.members.length) {
            return {
                valid: false,
                needsWithoutPhotoConfirmation: false,
                error: `Le groupe « ${group.title} » doit être envoyé entièrement ou retiré entièrement.`,
            };
        }
    }
    const needsConfirmation = !selected.some(image => image.origin === 'user_observation');
    if (needsConfirmation && !confirmedWithoutPersonalPhoto) {
        return {
            valid: false,
            needsWithoutPhotoConfirmation: true,
            error: 'Cochez « Continuer sans photo » pour confirmer cet envoi.',
        };
    }
    return { valid: true, needsWithoutPhotoConfirmation: needsConfirmation };
}
