import { inject, injectable } from '@theia/core/shared/inversify';
import { BackendApiClient } from 'theia-ide-zones-ext/lib/browser/backend-api-client';
import { FrenchGeologyResult, GeologyResult } from './earthcoach-geology';

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

    async frenchGeologyAtPoint(lat: number, lon: number, boreholes = false): Promise<FrenchGeologyResult> {
        const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
        if (boreholes) {
            params.set('boreholes', '1');
        }
        return this.apiClient.requestJson<FrenchGeologyResult>(
            `/api/earthcoach/geology/fr?${params.toString()}`,
            {},
            'Erreur lors de la recuperation du contexte geologique BRGM'
        );
    }
}
