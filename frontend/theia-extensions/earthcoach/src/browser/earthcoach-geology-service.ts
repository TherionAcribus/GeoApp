import { inject, injectable } from '@theia/core/shared/inversify';
import { BackendApiClient } from 'theia-ide-zones-ext/lib/browser/backend-api-client';
import { GeologyResult } from './earthcoach-geology';

@injectable()
export class EarthCoachGeologyService {

    @inject(BackendApiClient)
    protected readonly apiClient!: BackendApiClient;

    async geologyAtPoint(lat: number, lon: number): Promise<GeologyResult> {
        const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
        return this.apiClient.requestJson<GeologyResult>(
            `/api/earthcoach/geology?${params.toString()}`,
            {},
            'Erreur lors de la recuperation du contexte geologique'
        );
    }
}
