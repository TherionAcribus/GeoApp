import { injectable, inject } from '@theia/core/shared/inversify';
import { ApplicationShell } from '@theia/core/lib/browser';
import { MapWidget, MapContext } from './map-widget';
import { MapService } from './map-service';

/**
 * Service pour gérer les cartes contextuelles
 */
@injectable()
export class MapWidgetFactory {

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    @inject(MapService)
    protected readonly mapService!: MapService;
    
    // Référence à la fonction de création de widget (sera injectée par le module)
    private widgetCreator?: (context?: MapContext) => MapWidget;

    /**
     * Configure le créateur de widget (appelé par le module)
     */
    setWidgetCreator(creator: (context?: MapContext) => MapWidget): void {
        this.widgetCreator = creator;
    }

    /**
     * Ouvre ou crée une carte pour un contexte donné
     */
    async openMapForContext(context: MapContext, geocaches?: any[]): Promise<MapWidget> {
        const widgetId = this.generateWidgetId(context);
        
        console.log(`[MapWidgetFactory] openMapForContext pour widgetId: ${widgetId}`);
        
        // Vérifier si une carte pour ce contexte existe déjà
        let widget = this.shell.getWidgets('bottom').find(w => w.id === widgetId) as MapWidget;
        
        if (!widget) {
            console.log(`[MapWidgetFactory] Création d'un NOUVEAU widget pour ${widgetId}`);
            
            if (!this.widgetCreator) {
                throw new Error('Widget creator not initialized. Call setWidgetCreator first.');
            }
            
            // ✅ Créer une nouvelle instance via le créateur
            widget = this.widgetCreator(context);
            
            console.log(`[MapWidgetFactory] Widget créé avec ID final: ${widget.id}`);
            
            // Ouvrir dans le bottom layer
            await this.shell.addWidget(widget, { area: 'bottom' });
            console.log(`[MapWidgetFactory] Widget ajouté au bottom layer`);
        } else {
            console.log(`[MapWidgetFactory] Réutilisation du widget existant ${widgetId}`);
        }

        const targetWidgetId = widget.id;
        
        // Charger les géocaches si fournies
        if (geocaches && geocaches.length > 0) {
            console.log(`[MapWidgetFactory] Chargement de ${geocaches.length} géocaches pour contexte:`, context);
            
            // Si le widget existe déjà, charger immédiatement
            if (widget.isAttached) {
                widget.loadGeocaches(geocaches);
            } else {
                // Sinon, attendre que la carte soit initialisée
                setTimeout(() => {
                    widget.loadGeocaches(geocaches);
                }, 300);
            }
        }
        
        // Activer le widget après avoir chargé les données
        this.shell.activateWidget(targetWidgetId);
        
        return widget;
    }

    /**
     * Ouvre une carte pour une zone
     */
    async openMapForZone(zoneId: number, zoneName: string, geocaches: any[]): Promise<MapWidget> {
        return this.openMapForContext({
            type: 'zone',
            id: zoneId,
            label: `Zone: ${zoneName}`
        }, geocaches);
    }

    /**
     * Ouvre une carte pour une géocache
     */
    async openMapForGeocache(geocacheId: number, gcCode: string, geocacheData: any): Promise<MapWidget> {
        // Préparer les données : la géocache + ses waypoints
        const geocaches = [geocacheData];

        const widget = await this.openMapForContext({
            type: 'geocache',
            id: geocacheId,
            label: `Géocache: ${gcCode}`
        }, geocaches);

        // La sélection automatique sera faite dans loadGeocaches() du widget
        console.log(`[MapWidgetFactory] Carte ouverte pour géocache ${gcCode} (id=${geocacheId})`);

        return widget;
    }

    /**
     * Ouvre une carte générale
     */
    async openGeneralMap(geocaches?: any[]): Promise<MapWidget> {
        return this.openMapForContext({
            type: 'general',
            label: 'Carte Généraleeee'
        }, geocaches);
    }

    /**
     * Génère un ID de widget unique basé sur le contexte
     */
    private generateWidgetId(context: MapContext): string {
        switch (context.type) {
            case 'zone':
                return `geoapp-map-zone-${context.id}`;
            case 'geocache':
                return `geoapp-map-geocache-${context.id}`;
            default:
                return MapWidget.ID;
        }
    }

    /**
     * Ferme toutes les cartes
     */
    closeAllMaps(): void {
        const widgets = this.shell.getWidgets('bottom')
            .filter(w => w.id.startsWith('geoapp-map'));
        
        widgets.forEach(w => w.close());
    }

    /**
     * Ferme les cartes d'un type spécifique
     */
    closeMapsByType(type: 'zone' | 'geocache' | 'general'): void {
        const prefix = type === 'general' ? 'geoapp-map' : `geoapp-map-${type}`;
        const widgets = this.shell.getWidgets('bottom')
            .filter(w => w.id.startsWith(prefix));
        
        widgets.forEach(w => w.close());
    }
}

