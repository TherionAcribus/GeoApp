import { GeoImage } from './earthcoach-types';
import { EarthCoachWorkspaceGroup } from './earthcoach-workspace-types';

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
