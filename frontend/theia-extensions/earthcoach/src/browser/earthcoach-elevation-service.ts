import { inject, injectable } from '@theia/core/shared/inversify';
import { BackendApiClient } from 'theia-ide-zones-ext/lib/browser/backend-api-client';
import { ElevationResult } from './earthcoach-elevation';

export interface ElevationQueryPoint {
    lat: number;
    lon: number;
}

@injectable()
export class EarthCoachElevationService {

    @inject(BackendApiClient)
    protected readonly apiClient!: BackendApiClient;

    async elevationAtPoints(points: ElevationQueryPoint[]): Promise<ElevationResult> {
        const params = new URLSearchParams({
            points: points.map(point => `${point.lat},${point.lon}`).join('|'),
        });
        return this.apiClient.requestJson<ElevationResult>(
            `/api/earthcoach/elevation?${params.toString()}`,
            {},
            'Erreur lors de la recuperation de l altitude'
        );
    }
}
