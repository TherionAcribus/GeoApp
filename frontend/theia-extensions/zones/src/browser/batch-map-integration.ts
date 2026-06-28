/**
 * Integration service for batch plugin map events.
 *
 * It listens to custom events emitted by BatchPluginExecutorWidget and forwards
 * them to MapService so maps can display geocaches and detected coordinates.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MapService } from './map/map-service';

@injectable()
export class BatchMapIntegration implements FrontendApplicationContribution {
    private started = false;

    constructor(
        @inject(MapService) protected readonly mapService: MapService
    ) {
    }

    onStart(): void {
        if (this.started) {
            return;
        }
        this.started = true;


        (window as any).__batchMapListeners = true;

        window.addEventListener('geoapp-batch-load-geocaches', this.handleBatchLoadGeocaches as EventListener);
        window.addEventListener('geoapp-batch-highlight-coordinate', this.handleBatchHighlightCoordinate as EventListener);

    }

    onStop(): void {
        if (!this.started) {
            return;
        }
        this.started = false;

        window.removeEventListener('geoapp-batch-load-geocaches', this.handleBatchLoadGeocaches as EventListener);
        window.removeEventListener('geoapp-batch-highlight-coordinate', this.handleBatchHighlightCoordinate as EventListener);
        if ((window as any).__batchMapListeners) {
            delete (window as any).__batchMapListeners;
        }
    }

    private handleBatchLoadGeocaches = (event: Event): void => {
        const detail = (event as CustomEvent<{ geocaches?: any[] }>).detail;
        if (detail?.geocaches) {
            this.mapService.loadGeocaches(detail.geocaches);
        } else {
        }
    };

    private handleBatchHighlightCoordinate = (event: Event): void => {
        const detail = (event as CustomEvent<any>).detail;
        if (detail) {
            this.mapService.highlightDetectedCoordinate(detail);
        } else {
        }
    };
}
