import { GeoImage, LoggingTask, UserObservation } from './earthcoach-types';
import {
    EarthCoachResultProposal,
    EarthCoachSnapshotTask,
    EarthCoachWorkspaceGroup,
    EarthCoachWorkspaceImageContext,
} from './earthcoach-workspace-types';

export interface EarthCoachPreparedImages<P = void> {
    available: GeoImage[];
    failures: Array<{ id: string; label?: string; reason: string }>;
    /**
     * Resultat de `prepareImage` pour chaque image disponible, indexe par l'URL
     * finalement retenue (directe ou copie locale `/store`).
     */
    prepared: Map<string, P>;
}

async function prepareFetchableImage<P>(
    url: string,
    fetchImage: (url: string) => Promise<Response>,
    prepareImage?: (blob: Blob) => Promise<P>
): Promise<P | undefined> {
    const response = await fetchImage(url);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) {
        throw new Error('contenu non image');
    }
    // La validation est la preparation : le bridge chat decode puis reencode
    // chaque image avant envoi. Faire cet encodage ici verifie qu'il reussira
    // (HEIC, fichier tronque...) et evite au bridge de tout refaire.
    return prepareImage ? prepareImage(blob) : undefined;
}

export async function prepareEarthCoachImagesForTransmission<P = void>(
    images: GeoImage[],
    fetchImage: (url: string) => Promise<Response>,
    storeImage: (imageId: number) => Promise<string>,
    prepareImage?: (blob: Blob) => Promise<P>
): Promise<EarthCoachPreparedImages<P>> {
    const prepared = new Map<string, P>();
    const checked = await Promise.all(images.map(async image => {
        try {
            const encoded = await prepareFetchableImage(image.fileUri, fetchImage, prepareImage);
            if (encoded !== undefined) {
                prepared.set(image.fileUri, encoded);
            }
            return { image };
        } catch (directError) {
            const imageId = Number(image.id);
            if (!Number.isInteger(imageId) || imageId <= 0) {
                return { image, reason: directError instanceof Error ? directError.message : String(directError) };
            }
            try {
                const localUrl = await storeImage(imageId);
                const encoded = await prepareFetchableImage(localUrl, fetchImage, prepareImage);
                if (encoded !== undefined) {
                    prepared.set(localUrl, encoded);
                }
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
        prepared,
    };
}

export interface EarthCoachSelectionValidation {
    valid: boolean;
    needsWithoutPhotoConfirmation: boolean;
    error?: string;
    /** Selection au-dela de la limite d'images. */
    overLimit?: boolean;
    /** Index du premier groupe envoye partiellement (a completer ou retirer). */
    incompleteGroupIndex?: number;
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
            overLimit: true,
            error: `Réduisez la sélection à ${limit} images maximum (${selected.length} actuellement).`,
        };
    }
    const selectedIds = new Set(selected.map(image => Number(image.id)).filter(Number.isFinite));
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
        const group = groups[groupIndex];
        const selectedCount = group.members.filter(member => selectedIds.has(member.image_id)).length;
        if (selectedCount > 0 && selectedCount < group.members.length) {
            return {
                valid: false,
                needsWithoutPhotoConfirmation: false,
                incompleteGroupIndex: groupIndex,
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

/** Id numerique en fin de chaine : `logging-task-12`, `observation-7`, `12`. */
export function trailingNumericId(value: string | number | null | undefined): number | undefined {
    if (value == null) {
        return undefined;
    }
    const match = String(value).match(/(\d+)$/);
    const parsed = match ? Number(match[1]) : NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export type EarthCoachCoverageState = 'answered' | 'ready_to_resolve' | 'needs_field' | 'needs_photo';

export interface EarthCoachCoverageRow {
    taskId: number;
    position: number;
    question: string;
    guidance?: string;
    status: LoggingTask['status'];
    observationId?: number;
    observationExcerpt?: string;
    requiresPhoto: boolean;
    hasPersonalPhoto: boolean;
    state: EarthCoachCoverageState;
}

function compactExcerpt(value: string, max = 70): string {
    const compact = value.replace(/\s+/g, ' ').trim();
    return compact.length > max ? `${compact.slice(0, max)}…` : compact;
}

/**
 * Etat de chaque question avant envoi : on voit ce qui partira en « Manquante »
 * sans payer un appel au modele pour l'apprendre.
 */
export function buildEarthCoachCoverage(
    loggingTasks: LoggingTask[],
    observations: UserObservation[],
    images: GeoImage[],
    imageContexts: EarthCoachWorkspaceImageContext[]
): EarthCoachCoverageRow[] {
    const observationsById = new Map<number, UserObservation>();
    for (const observation of observations) {
        // Les notes converties en observations de repli n'ont pas d'id structure.
        if (observation.source === 'note') {
            continue;
        }
        const id = trailingNumericId(observation.id);
        if (id !== undefined) {
            observationsById.set(id, observation);
        }
    }
    const personalImageIds = new Set(
        images.filter(image => image.origin === 'user_observation')
            .map(image => trailingNumericId(image.id))
            .filter((id): id is number => id !== undefined)
    );
    return [...loggingTasks]
        .sort((left, right) => left.position - right.position)
        .map(task => {
            const observationId = trailingNumericId(task.observationId);
            const observation = observationId !== undefined ? observationsById.get(observationId) : undefined;
            const hasPersonalPhoto = observationId !== undefined && (
                Boolean(observation?.images.some(image => image.origin === 'user_observation')) ||
                imageContexts.some(item => item.observation_id === observationId && personalImageIds.has(item.image_id))
            );
            let state: EarthCoachCoverageState;
            if (task.status === 'answered') {
                state = 'answered';
            } else if (observationId === undefined) {
                state = 'needs_field';
            } else if (task.requiresPhoto && !hasPersonalPhoto) {
                state = 'needs_photo';
            } else {
                state = 'ready_to_resolve';
            }
            return {
                taskId: trailingNumericId(task.id) ?? 0,
                position: task.position,
                question: task.question,
                guidance: task.guidance,
                status: task.status,
                observationId,
                observationExcerpt: observation ? compactExcerpt(observation.note) : undefined,
                requiresPhoto: task.requiresPhoto,
                hasPersonalPhoto,
                state,
            };
        });
}

/**
 * Numero « Qn » d'une proposition : d'abord la question telle qu'elle etait a
 * la generation, sinon la question courante de meme id.
 */
export function resolveProposalPosition(
    proposal: EarthCoachResultProposal,
    snapshotTasks: EarthCoachSnapshotTask[] | undefined,
    currentTasks: LoggingTask[]
): number | undefined {
    const taskId = trailingNumericId(proposal.task_id);
    if (taskId === undefined) {
        return undefined;
    }
    const fromSnapshot = snapshotTasks?.find(task => task.id === taskId)?.position;
    if (typeof fromSnapshot === 'number') {
        return fromSnapshot;
    }
    return currentTasks.find(task => trailingNumericId(task.id) === taskId)?.position;
}

/** Questions de l'instantane pour lesquelles le modele n'a rendu aucune proposition. */
export function findUncoveredSnapshotTasks(
    proposals: EarthCoachResultProposal[],
    snapshotTasks: EarthCoachSnapshotTask[] | undefined
): EarthCoachSnapshotTask[] {
    if (!snapshotTasks?.length) {
        return [];
    }
    const covered = new Set(
        proposals.map(proposal => trailingNumericId(proposal.task_id)).filter((id): id is number => id !== undefined)
    );
    return snapshotTasks
        .filter(task => !covered.has(task.id))
        .sort((left, right) => (left.position ?? 0) - (right.position ?? 0));
}

/** Meme regle que le backend (`/apply`) : prete, une reponse, rien a completer, une question cible. */
export function isProposalApplicable(proposal: EarthCoachResultProposal): boolean {
    return proposal.status === 'ready'
        && Boolean(proposal.answer?.trim())
        && !proposal.missing?.trim()
        && trailingNumericId(proposal.task_id) !== undefined;
}

export function applicableProposalIndexes(proposals: EarthCoachResultProposal[]): number[] {
    return proposals
        .map((proposal, index) => (isProposalApplicable(proposal) ? index : -1))
        .filter(index => index >= 0);
}

export interface EarthCoachRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** En dessous, un recadrage n'apporte rien au modele (et trahit un simple clic). */
export const EARTHCOACH_MIN_CROP_SIZE = 32;

/**
 * Convertit une selection tracee sur l'apercu (pixels affiches) en rectangle
 * dans l'image source pleine resolution, borne a l'image. Renvoie undefined
 * si la zone est trop petite pour etre utile.
 */
export function computeEarthCoachCropRect(
    selection: EarthCoachRect,
    displayed: { width: number; height: number },
    natural: { width: number; height: number },
    minSize = EARTHCOACH_MIN_CROP_SIZE
): EarthCoachRect | undefined {
    if (!displayed.width || !displayed.height || !natural.width || !natural.height) {
        return undefined;
    }
    const scaleX = natural.width / displayed.width;
    const scaleY = natural.height / displayed.height;
    // Une selection tracee vers la gauche ou le haut a une largeur negative.
    const left = Math.min(selection.x, selection.x + selection.width);
    const top = Math.min(selection.y, selection.y + selection.height);
    const right = Math.max(selection.x, selection.x + selection.width);
    const bottom = Math.max(selection.y, selection.y + selection.height);
    const x0 = Math.max(0, Math.floor(left * scaleX));
    const y0 = Math.max(0, Math.floor(top * scaleY));
    const x1 = Math.min(natural.width, Math.ceil(right * scaleX));
    const y1 = Math.min(natural.height, Math.ceil(bottom * scaleY));
    const width = x1 - x0;
    const height = y1 - y0;
    if (width < minSize || height < minSize) {
        return undefined;
    }
    return { x: x0, y: y0, width, height };
}

/**
 * Zone reellement occupee par une image `object-fit: contain` dans son element :
 * les bandes vides autour ne doivent pas decaler le recadrage.
 */
export function containedImageBox(
    element: { width: number; height: number },
    natural: { width: number; height: number }
): EarthCoachRect | undefined {
    if (!element.width || !element.height || !natural.width || !natural.height) {
        return undefined;
    }
    const scale = Math.min(element.width / natural.width, element.height / natural.height);
    const width = natural.width * scale;
    const height = natural.height * scale;
    return { x: (element.width - width) / 2, y: (element.height - height) / 2, width, height };
}

const PROPOSAL_FIELDS: Array<keyof EarthCoachResultProposal> = [
    'task_id', 'question', 'question_translation', 'status', 'answer', 'evidence_ids', 'confidence', 'missing',
];

function normalizedField(proposal: EarthCoachResultProposal, field: keyof EarthCoachResultProposal): string {
    const value = proposal[field];
    if (value === undefined || value === null || value === '') {
        return '';
    }
    return JSON.stringify(value);
}

export function proposalDiffersFromAi(proposal: EarthCoachResultProposal, ai?: EarthCoachResultProposal): boolean {
    return Boolean(ai) && PROPOSAL_FIELDS.some(field => normalizedField(proposal, field) !== normalizedField(ai!, field));
}

/** Patch qui remplace entierement la proposition par la version IA (champs absents compris). */
export function revertProposalPatch(ai: EarthCoachResultProposal): Partial<EarthCoachResultProposal> {
    const patch: Partial<EarthCoachResultProposal> = {};
    for (const field of PROPOSAL_FIELDS) {
        (patch as Record<string, unknown>)[field] = ai[field];
    }
    return patch;
}
