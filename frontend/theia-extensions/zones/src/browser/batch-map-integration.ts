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
        console.log('[BatchMapIntegration] Constructor called with MapService:', !!mapService);
    }

    onStart(): void {
        if (this.started) {
            return;
        }
        this.started = true;

        console.log('[BatchMapIntegration] Starting batch map integration...');
        console.log('[BatchMapIntegration] MapService available:', !!this.mapService);

        (window as any).__batchMapListeners = true;

        window.addEventListener('geoapp-batch-load-geocaches', this.handleBatchLoadGeocaches as EventListener);
        window.addEventListener('geoapp-batch-highlight-coordinate', this.handleBatchHighlightCoordinate as EventListener);

        console.log('[BatchMapIntegration] Batch map integration started successfully');
    }

    onStop(): void {
        if (!this.started) {
            return;
        }
        this.started = false;

        console.log('[BatchMapIntegration] Stopping batch map integration...');
        window.removeEventListener('geoapp-batch-load-geocaches', this.handleBatchLoadGeocaches as EventListener);
        window.removeEventListener('geoapp-batch-highlight-coordinate', this.handleBatchHighlightCoordinate as EventListener);
        if ((window as any).__batchMapListeners) {
            delete (window as any).__batchMapListeners;
        }
    }

    private handleBatchLoadGeocaches = (event: Event): void => {
        console.log('[BatchMapIntegration] Raw event received:', event.type);
        const detail = (event as CustomEvent<{ geocaches?: any[] }>).detail;
        if (detail?.geocaches) {
            console.log('[BatchMapIntegration] Received load-geocaches event:', detail.geocaches.length, 'geocaches');
            this.mapService.loadGeocaches(detail.geocaches);
        } else {
            console.log('[BatchMapIntegration] Invalid event detail:', detail);
        }
    };

    private handleBatchHighlightCoordinate = (event: Event): void => {
        console.log('[BatchMapIntegration] Raw highlight event received:', event.type);
        const detail = (event as CustomEvent<any>).detail;
        if (detail) {
            console.log('[BatchMapIntegration] Received highlight-coordinate event:', detail.gcCode);
            this.mapService.highlightDetectedCoordinate(detail);
        } else {
            console.log('[BatchMapIntegration] Invalid highlight event detail:', detail);
        }
    };
}
