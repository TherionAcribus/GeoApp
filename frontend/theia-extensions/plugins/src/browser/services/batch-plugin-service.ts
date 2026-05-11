/**
 * Service pour gérer l'ouverture et la manipulation du BatchPluginExecutorWidget.
 * 
 * Ce service fournit une API simple pour ouvrir le widget batch avec des géocaches
 * pré-sélectionnées depuis n'importe quel composant de l'application.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { WidgetManager, ApplicationShell } from '@theia/core/lib/browser';
import { BatchPluginExecutorWidget, BatchGeocacheContext, BatchPluginExecutorConfig } from '../batch-plugin-executor-widget';

@injectable()
export class BatchPluginService {
    
    @inject(WidgetManager)
    protected readonly widgetManager!: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    /**
     * Ouvre le widget BatchPluginExecutor avec les géocaches spécifiées
     * 
     * @param config Configuration du widget batch
     * @returns Promise<BatchPluginExecutorWidget> Le widget ouvert
     */
    async openBatchExecutor(config: BatchPluginExecutorConfig): Promise<BatchPluginExecutorWidget> {
        try {
            // Créer ou récupérer le widget
            const widget = await this.widgetManager.getOrCreateWidget(
                BatchPluginExecutorWidget.ID,
                BatchPluginExecutorWidget
            ) as BatchPluginExecutorWidget;

            // Initialiser avec la configuration
            widget.initialize(config);

            // Ajouter le widget à la zone principale et l'activer
            if (!widget.isAttached) {
                this.shell.addWidget(widget, { area: 'main' });
            }
            this.shell.activateWidget(widget.id);

            console.log(`[BatchPluginService] Opened batch executor with ${config.geocaches.length} geocaches`);
            return widget;
        } catch (error) {
            console.error('[BatchPluginService] Error opening batch executor:', error);
            throw error;
        }
    }

    /**
     * Ouvre le widget batch depuis une liste d'IDs de géocaches
     * 
     * @param geocacheIds Liste des IDs des géocaches
     * @param zoneId ID de la zone actuelle
     * @param zoneName Nom de la zone (optionnel)
     * @param fetchGeocacheDetails Fonction pour récupérer les détails des géocaches
     */
    async openBatchExecutorFromIds(
        geocacheIds: number[],
        zoneId: number,
        zoneName?: string,
        fetchGeocacheDetails?: (ids: number[]) => Promise<BatchGeocacheContext[]>
    ): Promise<BatchPluginExecutorWidget> {
        if (!fetchGeocacheDetails) {
            throw new Error('fetchGeocacheDetails function is required');
        }

        try {
            // Récupérer les détails des géocaches
            const geocaches = await fetchGeocacheDetails(geocacheIds);
            
            const config: BatchPluginExecutorConfig = {
                geocaches,
                zoneId,
                zoneName
            };

            return this.openBatchExecutor(config);
        } catch (error) {
            console.error('[BatchPluginService] Error opening batch executor from IDs:', error);
            throw error;
        }
    }

    /**
     * Vérifie si le widget batch est actuellement ouvert
     */
    isBatchExecutorOpen(): boolean {
        try {
            const widgets = this.shell.widgets;
            for (const widget of widgets) {
                if (widget.id === BatchPluginExecutorWidget.ID) {
                    return true;
                }
            }
            return false;
        } catch {
            return false;
        }
    }

    /**
     * Ferme le widget batch s'il est ouvert
     */
    async closeBatchExecutor(): Promise<void> {
        try {
            const widgets = this.shell.widgets;
            for (const widget of widgets) {
                if (widget.id === BatchPluginExecutorWidget.ID) {
                    await this.shell.closeWidget(widget.id);
                    console.log('[BatchPluginService] Batch executor closed');
                    break;
                }
            }
        } catch (error) {
            console.error('[BatchPluginService] Error closing batch executor:', error);
        }
    }
}
