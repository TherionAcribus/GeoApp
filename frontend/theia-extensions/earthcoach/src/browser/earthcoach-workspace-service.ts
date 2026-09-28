import { inject, injectable } from '@theia/core/shared/inversify';
import { BackendApiClient } from 'theia-ide-zones-ext/lib/browser/backend-api-client';
import { EarthCoachObservationImageDto } from './earthcoach-observations';
import {
    EarthCoachResult,
    EarthCoachResultProposal,
    EarthCoachPreparedRequest,
    EarthCoachWorkspace,
    EarthCoachWorkspaceInput,
} from './earthcoach-workspace-types';

export class EarthCoachWorkspaceConflictError extends Error {
    constructor(readonly workspace: EarthCoachWorkspace) {
        super('Le dossier EarthCoach a été modifié ailleurs.');
    }
}

@injectable()
export class EarthCoachWorkspaceService {
    @inject(BackendApiClient)
    protected readonly apiClient!: BackendApiClient;

    async getWorkspace(geocacheId: number): Promise<EarthCoachWorkspace> {
        const response = await this.apiClient.requestJson<{ workspace: EarthCoachWorkspace }>(
            `/api/geocaches/${geocacheId}/earthcoach-workspace`,
            {},
            'Erreur lors du chargement du dossier terrain EarthCoach'
        );
        return response.workspace;
    }

    async saveWorkspace(geocacheId: number, input: EarthCoachWorkspaceInput): Promise<EarthCoachWorkspace> {
        const response = await fetch(
            `${this.apiClient.getBaseUrl()}/api/geocaches/${geocacheId}/earthcoach-workspace`,
            this.apiClient.createJsonInit('PUT', input)
        );
        const payload = await response.json().catch(() => ({})) as { workspace?: EarthCoachWorkspace; error?: string };
        if (response.status === 409 && payload.workspace) {
            throw new EarthCoachWorkspaceConflictError(payload.workspace);
        }
        if (!response.ok || !payload.workspace) {
            throw new Error(payload.error || 'Erreur lors de l enregistrement du dossier terrain EarthCoach');
        }
        return payload.workspace;
    }

    async uploadImages(geocacheId: number, files: File[]): Promise<EarthCoachObservationImageDto[]> {
        const uploaded: EarthCoachObservationImageDto[] = [];
        for (const file of files) {
            const formData = new FormData();
            formData.append('image_file', file);
            formData.append('title', file.name || 'Photo terrain');
            uploaded.push(await this.apiClient.requestJson<EarthCoachObservationImageDto>(
                `/api/geocaches/${geocacheId}/images/upload`,
                { method: 'POST', body: formData },
                `Erreur lors de l ajout de ${file.name || 'la photo'}`
            ));
        }
        return uploaded;
    }

    async storeImageForChat(imageId: number): Promise<string> {
        const image = await this.apiClient.requestJson<{ url?: string }>(
            `/api/geocache-images/${imageId}/store`,
            this.apiClient.createJsonInit('POST'),
            `Impossible de préparer l image ${imageId} pour le chat`
        );
        const url = (image.url || '').trim();
        if (!url) {
            throw new Error(`L image ${imageId} ne fournit aucune URL locale`);
        }
        return url.startsWith('/') ? `${this.apiClient.getBaseUrl()}${url}` : url;
    }

    async listResults(geocacheId: number): Promise<EarthCoachResult[]> {
        const response = await this.apiClient.requestJson<{ results: EarthCoachResult[] }>(
            `/api/geocaches/${geocacheId}/earthcoach-results`,
            {},
            'Erreur lors du chargement des résultats EarthCoach'
        );
        return response.results || [];
    }

    async captureResult(input: {
        geocacheId: number;
        requestId: string;
        action: 'analyze' | 'resolve';
        contextSnapshot: EarthCoachPreparedRequest | Record<string, unknown>;
        proposals: EarthCoachResultProposal[];
        markdown?: string;
        sessionId?: string;
    }): Promise<EarthCoachResult> {
        const response = await this.apiClient.requestJson<{ result: EarthCoachResult }>(
            `/api/geocaches/${input.geocacheId}/earthcoach-results`,
            this.apiClient.createJsonInit('POST', {
                request_id: input.requestId,
                action: input.action,
                context_snapshot: input.contextSnapshot,
                proposals: input.proposals,
                markdown: input.markdown,
                session_id: input.sessionId,
            }),
            'Erreur lors de la capture du résultat EarthCoach'
        );
        return response.result;
    }

    async updateResult(resultId: number, proposals: EarthCoachResultProposal[]): Promise<EarthCoachResult> {
        const response = await this.apiClient.requestJson<{ result: EarthCoachResult }>(
            `/api/earthcoach-results/${resultId}`,
            this.apiClient.createJsonInit('PATCH', { proposals }),
            'Erreur lors de la modification du résultat EarthCoach'
        );
        return response.result;
    }

    async saveFinalAnswer(resultId: number, finalAnswer: string): Promise<EarthCoachResult> {
        const response = await this.apiClient.requestJson<{ result: EarthCoachResult }>(
            `/api/earthcoach-results/${resultId}`,
            this.apiClient.createJsonInit('PATCH', { final_answer: finalAnswer }),
            'Erreur lors de l enregistrement de la réponse finale EarthCoach'
        );
        return response.result;
    }

    async applyResultProposal(resultId: number, proposalIndex: number): Promise<void> {
        await this.applyResultProposals(resultId, [proposalIndex]);
    }

    /** Report groupe : le backend applique tout ou rien (rollback au premier refus). */
    async applyResultProposals(resultId: number, proposalIndexes: number[]): Promise<number> {
        const response = await this.apiClient.requestJson<{ applied?: unknown[] }>(
            `/api/earthcoach-results/${resultId}/apply`,
            this.apiClient.createJsonInit('POST', { proposal_indexes: proposalIndexes }),
            'Erreur lors du report des réponses EarthCoach'
        );
        return response.applied?.length ?? 0;
    }

    /**
     * Enregistre un recadrage pleine resolution comme image derivee de la source
     * (route des sous-images de l'editeur GeoApp).
     */
    async createCropImage(
        sourceImageId: number,
        rendered: Blob,
        rect: { x: number; y: number; width: number; height: number },
        title: string
    ): Promise<EarthCoachObservationImageDto> {
        const extension = rendered.type === 'image/png' ? 'png' : 'jpg';
        const formData = new FormData();
        formData.append('rendered_file', rendered, `detail.${extension}`);
        formData.append('mime_type', rendered.type);
        formData.append('title', title);
        formData.append('crop_rect_json', JSON.stringify({ left: rect.x, top: rect.y, width: rect.width, height: rect.height }));
        return this.apiClient.requestJson<EarthCoachObservationImageDto>(
            `/api/geocache-images/${sourceImageId}/snippets/new`,
            { method: 'POST', body: formData },
            'Impossible de créer le recadrage'
        );
    }
}
