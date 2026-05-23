import { inject, injectable } from '@theia/core/shared/inversify';
import { BackendApiClient } from 'theia-ide-zones-ext/lib/browser/backend-api-client';
import { GeoImage } from './earthcoach-types';
import {
    EarthCoachObservationDto,
    EarthCoachObservationImageDto,
    EarthCoachObservationInput,
    EarthCoachObservationsApiResponse,
} from './earthcoach-observations';

interface EarthCoachObservationMutationResponse {
    observation: EarthCoachObservationDto;
    geocache_id?: number;
}

@injectable()
export class EarthCoachObservationService {

    @inject(BackendApiClient)
    protected readonly apiClient!: BackendApiClient;

    async listObservations(geocacheId: number): Promise<EarthCoachObservationsApiResponse> {
        return this.apiClient.requestJson<EarthCoachObservationsApiResponse>(
            `/api/geocaches/${geocacheId}/observations`,
            {},
            'Erreur lors du chargement des observations EarthCoach'
        );
    }

    async createObservation(geocacheId: number, payload: EarthCoachObservationInput): Promise<EarthCoachObservationDto> {
        const response = await this.apiClient.requestJson<EarthCoachObservationMutationResponse>(
            `/api/geocaches/${geocacheId}/observations`,
            this.apiClient.createJsonInit('POST', payload),
            'Erreur lors de la creation de l observation EarthCoach'
        );
        return response.observation;
    }

    async updateObservation(observationId: number, payload: EarthCoachObservationInput): Promise<EarthCoachObservationDto> {
        const response = await this.apiClient.requestJson<EarthCoachObservationMutationResponse>(
            `/api/observations/${observationId}`,
            this.apiClient.createJsonInit('PUT', payload),
            'Erreur lors de la mise a jour de l observation EarthCoach'
        );
        return response.observation;
    }

    async deleteObservation(observationId: number): Promise<void> {
        await this.apiClient.requestVoid(
            `/api/observations/${observationId}`,
            { method: 'DELETE' },
            'Erreur lors de la suppression de l observation EarthCoach'
        );
    }

    async uploadImage(geocacheId: number, file: File): Promise<EarthCoachObservationImageDto> {
        const formData = new FormData();
        formData.append('image_file', file);
        formData.append('title', file.name || 'Photo terrain');
        return this.apiClient.requestJson<EarthCoachObservationImageDto>(
            `/api/geocaches/${geocacheId}/images/upload`,
            { method: 'POST', body: formData },
            'Erreur lors de l ajout de la photo EarthCoach'
        );
    }

    toGeoImage(geocacheId: number, image: EarthCoachObservationImageDto, index: number = 0): GeoImage | undefined {
        const rawUrl = (image.url || image.source_url || '').trim();
        if (!rawUrl) {
            return undefined;
        }
        const fileUri = rawUrl.startsWith('/') ? `${this.apiClient.getBaseUrl()}${rawUrl}` : rawUrl;
        const sourceUrl = (image.source_url || '').trim().toLowerCase();
        const origin = sourceUrl.startsWith('geoapp-upload://') ? 'user_observation' : 'cache_listing';
        return {
            id: image.id != null ? String(image.id) : `image-${index + 1}`,
            origin,
            cacheId: String(geocacheId),
            label: image.title || `Image ${index + 1}`,
            description: image.note,
            takenAt: image.created_at || undefined,
            fileUri,
        };
    }
}
