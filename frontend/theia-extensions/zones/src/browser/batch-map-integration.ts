/**
 * Service d'intégration pour les événements du batch plugin
 * 
 * Ce service écoute les événements personnalisés envoyés par le BatchPluginExecutorWidget
 * et les transmet au MapService pour afficher les géocaches et les coordonnées détectées.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MapService } from './map/map-service';

@injectable()
export class BatchMapIntegration implements FrontendApplicationContribution {
    
    constructor(
        @inject(MapService) protected readonly mapService: MapService
    ) {
        console.log('[BatchMapIntegration] Constructor called with MapService:', !!mapService);
    }

    /**
     * Initialise les écouteurs d'événements personnalisés
     */
    onStart(): void {
        console.log('[BatchMapIntegration] Starting batch map integration...');
        console.log('[BatchMapIntegration] MapService available:', !!this.mapService);
        
        // Marquer que les listeners sont actifs
        (window as any).__batchMapListeners = true;
        
        // Écouter l'événement de chargement des géocaches
        window.addEventListener('geoapp-batch-load-geocaches', (event: any) => {
            console.log('[BatchMapIntegration] Raw event received:', event.type);
            const detail = event.detail;
            if (detail && detail.geocaches) {
                console.log('[BatchMapIntegration] Received load-geocaches event:', detail.geocaches.length, 'geocaches');
                this.mapService.loadGeocaches(detail.geocaches);
            } else {
                console.log('[BatchMapIntegration] Invalid event detail:', detail);
            }
        });

        // Écouter l'événement de mise en évidence des coordonnées
        window.addEventListener('geoapp-batch-highlight-coordinate', (event: any) => {
            console.log('[BatchMapIntegration] Raw highlight event received:', event.type);
            const detail = event.detail;
            if (detail) {
                console.log('[BatchMapIntegration] Received highlight-coordinate event:', detail.gcCode);
                this.mapService.highlightDetectedCoordinate(detail);
            } else {
                console.log('[BatchMapIntegration] Invalid highlight event detail:', detail);
            }
        });

        console.log('[BatchMapIntegration] Batch map integration started successfully');
    }

    /**
     * Nettoie les écouteurs d'événements
     */
    onStop(): void {
        console.log('[BatchMapIntegration] Stopping batch map integration...');
        // Les écouteurs sont automatiquement nettoyés quand la fenêtre est fermée
    }
}
