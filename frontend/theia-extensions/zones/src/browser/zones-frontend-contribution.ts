import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplication, FrontendApplicationContribution, WidgetManager, Widget } from '@theia/core/lib/browser';
import { ZonesTreeWidget } from './zones-tree-widget';
import { ZoneGeocachesWidget } from './zone-geocaches-widget';
import { GeocacheLogsWidget } from './geocache-logs-widget';
import { GeocacheNotesWidget } from './geocache-notes-widget';
import { GeocacheLogEditorTabsManager } from './geocache-log-editor-tabs-manager';
import { MapManagerWidget } from './map/map-manager-widget';
import { MapWidgetFactory } from './map/map-widget-factory';

@injectable()
export class ZonesFrontendContribution implements FrontendApplicationContribution {

    constructor() {
        console.log('[ZonesFrontendContribution] CONSTRUCTEUR appelé - extension zones créée');
    }

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(MapWidgetFactory)
    protected readonly mapWidgetFactory: MapWidgetFactory;

    @inject(GeocacheLogEditorTabsManager)
    protected readonly geocacheLogEditorTabsManager: GeocacheLogEditorTabsManager;

    async onStart(app: FrontendApplication): Promise<void> {
        console.log('[ZonesFrontendContribution] ========== onStart appelé - extension zones initialisée ==========');

        // Ajouter le widget des zones
        const widget = await this.getOrCreateWidget();
        if (!widget.isAttached) {
            app.shell.addWidget(widget, { area: 'left', rank: 100 });
        }
        app.shell.activateWidget(widget.id);

        // Ajouter le gestionnaire de cartes
        console.log('[ZonesFrontendContribution] Création du MapManagerWidget...');
        const mapManagerWidget = await this.widgetManager.getOrCreateWidget(MapManagerWidget.ID);
        console.log('[ZonesFrontendContribution] MapManagerWidget créé:', mapManagerWidget.id);
        if (!mapManagerWidget.isAttached) {
            console.log('[ZonesFrontendContribution] Ajout du MapManagerWidget à la barre latérale gauche');
            app.shell.addWidget(mapManagerWidget, { area: 'left', rank: 200 });
        } else {
            console.log('[ZonesFrontendContribution] MapManagerWidget déjà attaché');
        }

        // Ecoute globale pour ouverture d'un onglet central de géocaches
        window.addEventListener('open-zone-geocaches', async (event: any) => {
            try {
                const detail = event?.detail || {};
                const zoneId = detail.zoneId;
                const zoneName = detail.zoneName;
                if (!zoneId) {
                    return;
                }
                const gWidget = await this.widgetManager.getOrCreateWidget(ZoneGeocachesWidget.ID) as ZoneGeocachesWidget;
                gWidget.setZone({ zoneId, zoneName });
                if (!gWidget.isAttached) {
                    app.shell.addWidget(gWidget, { area: 'main' });
                }
                app.shell.activateWidget(gWidget.id);
            } catch (e) {
                // eslint-disable-next-line no-console
                console.error('ZonesFrontendContribution: failed to open zone-geocaches widget', e);
            }
        });

        // Écoute globale pour ouverture d'une carte de géocache (utilisé par l'extension alphabets)
        console.log('[ZonesFrontendContribution] ========== Enregistrement des écouteurs open-geocache-map ==========');
        const eventHandler = async (event: any) => {
            try {
                console.log('[ZonesFrontendContribution] !!!!! ÉVÉNEMENT CUSTOMEVENTS REÇU !!!!!');
                console.log('[ZonesFrontendContribution] Événement open-geocache-map reçu sur', event.currentTarget === document ? 'document' : 'window');
                console.log('ZonesFrontendContribution: Événement open-geocache-map reçu', event);
                const detail = event?.detail || {};
                console.log('ZonesFrontendContribution: Détails de l\'événement:', detail);
                const geocache = detail.geocache;
                if (!geocache || !geocache.id) {
                    console.warn('ZonesFrontendContribution: Invalid geocache data for open-geocache-map event', detail);
                    return;
                }

                console.log('ZonesFrontendContribution: Received open-geocache-map event for', geocache.gc_code);
                console.log('ZonesFrontendContribution: Données géocache:', geocache);

                // Récupérer le widget de géocaches et ouvrir la carte
                console.log('ZonesFrontendContribution: Récupération du widget ZoneGeocachesWidget');
                const gWidget = await this.widgetManager.getOrCreateWidget(ZoneGeocachesWidget.ID) as ZoneGeocachesWidget;
                console.log('ZonesFrontendContribution: Widget récupéré:', gWidget);
                await gWidget.openGeocacheMap(geocache);
                console.log('ZonesFrontendContribution: openGeocacheMap terminé');
            } catch (e) {
                // eslint-disable-next-line no-console
                console.error('ZonesFrontendContribution: failed to open geocache map', e);
            }
        };

        document.addEventListener('open-geocache-map', eventHandler);
        window.addEventListener('open-geocache-map', eventHandler);
        console.log('[ZonesFrontendContribution] ========== Écouteurs CustomEvent enregistrés sur document et window ==========');

        // Écouteurs pour la carte générale
        console.log('[ZonesFrontendContribution] ========== Enregistrement des écouteurs open-general-map ==========');
        const generalMapHandler = async () => {
            try {
                console.log('[ZonesFrontendContribution] Événement open-general-map reçu');
                await this.mapWidgetFactory.openGeneralMap();
                console.log('[ZonesFrontendContribution] Carte générale ouverte/activée');
            } catch (error) {
                console.error('[ZonesFrontendContribution] Erreur lors de l\'ouverture de la carte générale', error);
            }
        };
        document.addEventListener('open-general-map', generalMapHandler);
        window.addEventListener('open-general-map', generalMapHandler);

        // Écouter aussi les messages window.postMessage
        const messageHandler = async (messageEvent: MessageEvent) => {
            // Log seulement pour les messages pertinents (éviter le spam)
            if (messageEvent.data && messageEvent.data.type === 'open-geocache-map' && messageEvent.data.source === 'alphabets-extension') {
                console.log('[ZonesFrontendContribution] Ouverture carte alphabets pour geocache:', messageEvent.data.geocache?.gc_code);
                const geocache = messageEvent.data.geocache;
                if (geocache && geocache.id) {
                    try {
                        // Utiliser le widgetManager pour récupérer ou créer le widget
                        const gWidget = await this.widgetManager.getOrCreateWidget(ZoneGeocachesWidget.ID) as ZoneGeocachesWidget;
                        await gWidget.openGeocacheMap(geocache);
                    } catch (error) {
                        console.error('[ZonesFrontendContribution] Erreur lors de l\'ouverture de la carte:', error);
                    }
                } else {
                    console.warn('[ZonesFrontendContribution] Données geocache invalides:', geocache);
                }
            } else if (messageEvent.data && messageEvent.data.type === 'open-general-map' && messageEvent.data.source === 'alphabets-extension') {
                console.log('[ZonesFrontendContribution] !!!!! MESSAGE POSTMESSAGE OPEN-GENERAL-MAP REÇU !!!!!');
                try {
                    await this.mapWidgetFactory.openGeneralMap();
                    console.log('[ZonesFrontendContribution] Carte générale ouverte via postMessage');
                } catch (error) {
                    console.error('[ZonesFrontendContribution] Erreur lors de l\'ouverture de la carte générale via postMessage', error);
                }
            }
        };
        window.addEventListener('message', messageHandler);
        console.log('[ZonesFrontendContribution] ========== Écouteur postMessage enregistré sur window ==========');

        // Écouteur pour ouvrir le widget des logs
        console.log('[ZonesFrontendContribution] ========== Enregistrement des écouteurs open-geocache-logs ==========');
        const openLogsHandler = async (event: any) => {
            try {
                const detail = event?.detail || {};
                const geocacheId = detail.geocacheId;
                const gcCode = detail.gcCode;
                const name = detail.name;
                
                if (!geocacheId) {
                    console.warn('[ZonesFrontendContribution] open-geocache-logs: geocacheId manquant');
                    return;
                }
                
                console.log('[ZonesFrontendContribution] Ouverture des logs pour geocache:', gcCode || geocacheId);
                
                const logsWidget = await this.widgetManager.getOrCreateWidget(GeocacheLogsWidget.ID) as GeocacheLogsWidget;
                logsWidget.setGeocache({ geocacheId, gcCode, name });
                
                if (!logsWidget.isAttached) {
                    // Afficher dans le panneau droit par défaut
                    app.shell.addWidget(logsWidget, { area: 'right' });
                }
                app.shell.activateWidget(logsWidget.id);
                
            } catch (error) {
                console.error('[ZonesFrontendContribution] Erreur lors de l\'ouverture des logs:', error);
            }
        };
        window.addEventListener('open-geocache-logs', openLogsHandler);
        document.addEventListener('open-geocache-logs', openLogsHandler);

        // Écouteur pour ouvrir le widget des notes
        console.log('[ZonesFrontendContribution] ========== Enregistrement des écouteurs open-geocache-notes ==========');
        const openNotesHandler = async (event: any) => {
            try {
                const detail = event?.detail || {};
                const geocacheId = detail.geocacheId;
                const gcCode = detail.gcCode;
                const name = detail.name;

                if (!geocacheId) {
                    console.warn('[ZonesFrontendContribution] open-geocache-notes: geocacheId manquant');
                    return;
                }

                console.log('[ZonesFrontendContribution] Ouverture des notes pour geocache:', gcCode || geocacheId);

                const notesWidget = await this.widgetManager.getOrCreateWidget(GeocacheNotesWidget.ID) as GeocacheNotesWidget;
                notesWidget.setGeocache({ geocacheId, gcCode, name });

                if (!notesWidget.isAttached) {
                    // Afficher dans le panneau droit par défaut
                    app.shell.addWidget(notesWidget, { area: 'right' });
                }
                app.shell.activateWidget(notesWidget.id);

            } catch (error) {
                console.error('[ZonesFrontendContribution] Erreur lors de l\'ouverture des notes:', error);
            }
        };
        window.addEventListener('open-geocache-notes', openNotesHandler);
        document.addEventListener('open-geocache-notes', openNotesHandler);

        // Écouteur pour ouvrir l'éditeur de logs (nouvel onglet)
        const openLogEditorHandler = async (event: any) => {
            try {
                const detail = event?.detail || {};
                const geocacheIds = Array.isArray(detail.geocacheIds) ? detail.geocacheIds : [];
                const title = detail.title;
                if (!geocacheIds.length) {
                    console.warn('[ZonesFrontendContribution] open-geocache-log-editor: geocacheIds manquant');
                    return;
                }
                await this.geocacheLogEditorTabsManager.openLogEditor({ geocacheIds, title });
            } catch (error) {
                console.error('[ZonesFrontendContribution] Erreur lors de l\'ouverture de l\'éditeur de logs:', error);
            }
        };

        window.addEventListener('open-geocache-log-editor', openLogEditorHandler);
        document.addEventListener('open-geocache-log-editor', openLogEditorHandler);

        console.log('[ZonesFrontendContribution] ========== Tous les écouteurs sont maintenant actifs ==========');
    }

    protected async getOrCreateWidget(): Promise<Widget> {
        return this.widgetManager.getOrCreateWidget(ZonesTreeWidget.ID);
    }
}


