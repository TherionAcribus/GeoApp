import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { ZonesTreeWidget } from './zones-tree-widget';
import { ZonesFrontendContribution } from './zones-frontend-contribution';
import { ZonesCommandContribution } from './zones-command-contribution';
import { ZoneGeocachesWidget } from './zone-geocaches-widget';
import { GeocacheDetailsWidget } from './geocache-details-widget';
import { GeocacheLogsWidget } from './geocache-logs-widget';
import { GeocacheLogEditorWidget } from './geocache-log-editor-widget';
import { GeocacheNotesWidget } from './geocache-notes-widget';
import { MapWidget } from './map/map-widget';
import { MapService } from './map/map-service';
import { MapWidgetFactory } from './map/map-widget-factory';
import { MapManagerWidget } from './map/map-manager-widget';
import { BatchMapIntegration } from './batch-map-integration';
import { GeocacheTabsManager } from './geocache-tabs-manager';
import { GeocacheLogEditorTabsManager } from './geocache-log-editor-tabs-manager';
import { GeocacheImageEditorWidget } from './geocache-image-editor-widget';
import { GeocacheImageEditorTabsManager } from './geocache-image-editor-tabs-manager';
import { GeocacheImageEditorFrontendContribution } from './geocache-image-editor-frontend-contribution';
import { ZoneTabsManager } from './zone-tabs-manager';
import { CheckerToolsManager } from './checker-tools-manager';
import {
    GeoAppChatAgent,
    GeoAppChatAgentContribution,
    GeoAppChatFastAgent,
    GeoAppChatLocalAgent,
    GeoAppChatStrongAgent,
    GeoAppChatWebAgent
} from './geoapp-chat-agent';
import { GeoAppOcrAgentContribution } from './geoapp-ocr-agent';
import { GeoAppTranslateDescriptionAgentContribution } from './geoapp-translate-description-agent';
import { GeoAppLogsAnalyzerAgentContribution } from './geoapp-logs-analyzer-agent';
import { GeoAppLogWriterAgentContribution } from './geoapp-log-writer-agent';
import { GeoAppChatBridge } from './geoapp-chat-bridge';
import { ChatAgent } from '@theia/ai-chat/lib/common/chat-agents';
import { GeocachingAuthWidget } from './geocaching-auth-widget';
import { ArchiveManagerWidget } from './archive-manager-widget';
import { ZonesMenuContribution } from './zones-menu-contribution';
import { GeoAppSidebarContribution } from './geoapp-sidebar-contribution';
import { GeoAppDefaultLeftPanelContribution } from './geoapp-default-left-panel-contribution';
import { LayoutAutoSaveContribution } from './layout-auto-save-contribution';
import { BackendApiClient } from './backend-api-client';
import { ZonesService } from './zones-service';
import { GeocachesService } from './geocaches-service';
import { GeoAppWidgetEventsService } from './geoapp-widget-events-service';
import { GeocacheDetailsService } from './geocache-details-service';
import { GeocacheDetailsArchiveController } from './geocache-details-archive-controller';
import { GeocacheDetailsChatController } from './geocache-details-chat-controller';
import { GeocacheDetailsNavigationController } from './geocache-details-navigation-controller';
import { GeocacheDetailsNotesController } from './geocache-details-notes-controller';
import { GeocacheDetailsPreferencesController } from './geocache-details-preferences-controller';
import { GeocacheDetailsContentController } from './geocache-details-content-controller';
import { GeocacheDetailsTranslationController } from './geocache-details-translation-controller';
import { GeocacheNotesService } from './geocache-notes-service';
import { GeocacheNotesController } from './geocache-notes-controller';
import { ArchiveManagerService } from './archive-manager-service';
import { ArchiveManagerController } from './archive-manager-controller';

export default new ContainerModule(bind => {
    bind(BackendApiClient).toSelf().inSingletonScope();
    bind(ZonesService).toSelf().inSingletonScope();
    bind(GeocachesService).toSelf().inSingletonScope();
    bind(GeocacheDetailsService).toSelf().inSingletonScope();
    bind(GeocacheNotesService).toSelf().inSingletonScope();
    bind(ArchiveManagerService).toSelf().inSingletonScope();
    bind(GeocacheDetailsArchiveController).toSelf().inSingletonScope();
    bind(GeocacheDetailsChatController).toSelf().inSingletonScope();
    bind(GeocacheDetailsContentController).toSelf().inSingletonScope();
    bind(GeocacheDetailsNavigationController).toSelf().inSingletonScope();
    bind(GeocacheDetailsNotesController).toSelf().inSingletonScope();
    bind(GeocacheDetailsPreferencesController).toSelf().inSingletonScope();
    bind(GeocacheDetailsTranslationController).toSelf().inSingletonScope();
    bind(GeocacheNotesController).toSelf().inSingletonScope();
    bind(ArchiveManagerController).toSelf().inSingletonScope();
    bind(GeoAppWidgetEventsService).toSelf().inSingletonScope();

    bind(ZonesTreeWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: ZonesTreeWidget.ID,
        createWidget: () => ctx.container.get(ZonesTreeWidget)
    })).inSingletonScope();

    // ZoneGeocachesWidget: instances gérées par ZoneTabsManager et le WidgetManager (plusieurs onglets possibles)
    bind(ZoneGeocachesWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: ZoneGeocachesWidget.ID,
        createWidget: (options?: any) => {
            const widget = ctx.container.get(ZoneGeocachesWidget);
            if (options?.instanceId) {
                widget.id = `${ZoneGeocachesWidget.ID}#${options.instanceId}`;
            }
            return widget;
        }
    })).inSingletonScope();

    // GeocacheDetailsWidget: instances gérées par GeocacheTabsManager et le WidgetManager (plusieurs onglets possibles)
    bind(GeocacheDetailsWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: GeocacheDetailsWidget.ID,
        createWidget: (options?: any) => {
            const widget = ctx.container.get(GeocacheDetailsWidget);
            if (options?.instanceId) {
                widget.id = `${GeocacheDetailsWidget.ID}#${options.instanceId}`;
            }
            return widget;
        }
    })).inSingletonScope();

    // GeocacheImageEditorWidget: instances gérées par GeocacheImageEditorTabsManager (plusieurs onglets possibles)
    bind(GeocacheImageEditorWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: GeocacheImageEditorWidget.ID,
        createWidget: (options?: any) => {
            const widget = ctx.container.get(GeocacheImageEditorWidget);
            if (options?.instanceId) {
                widget.id = `${GeocacheImageEditorWidget.ID}#${options.instanceId}`;
            }
            return widget;
        }
    })).inSingletonScope();

    // Widget des logs de géocache (affichable dans right, bottom ou main)
    bind(GeocacheLogsWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: GeocacheLogsWidget.ID,
        createWidget: () => ctx.container.get(GeocacheLogsWidget)
    })).inSingletonScope();

    bind(GeocacheLogEditorWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: GeocacheLogEditorWidget.ID,
        createWidget: (options?: any) => {
            const widget = ctx.container.get(GeocacheLogEditorWidget);
            if (options?.instanceId) {
                widget.id = `${GeocacheLogEditorWidget.ID}#${options.instanceId}`;
            }
            return widget;
        }
    })).inSingletonScope();

    // Widget des notes de géocache (affichable dans right, bottom ou main)
    bind(GeocacheNotesWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: GeocacheNotesWidget.ID,
        createWidget: () => ctx.container.get(GeocacheNotesWidget)
    })).inSingletonScope();

    bind(MapService).toSelf().inSingletonScope();
    
    // MapWidget n'est plus singleton pour permettre plusieurs instances
    bind(MapWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: MapWidget.ID,
        createWidget: () => {
            // Créer un child container pour chaque widget
            const child = ctx.container.createChild();
            return child.get(MapWidget);
        }
    })).inSingletonScope();
    
    // MapWidgetFactory avec configuration du créateur
    bind(MapWidgetFactory).toSelf().inSingletonScope().onActivation((context, factory) => {
        // Configurer le créateur de widget avec accès au container
        factory.setWidgetCreator((mapContext) => {
            const child = context.container.createChild();
            const widget = child.get(MapWidget);
            if (mapContext) {
                widget.setContext(mapContext);
            }
            return widget;
        });
        return factory;
    });

    bind(MapManagerWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: MapManagerWidget.ID,
        createWidget: () => ctx.container.get(MapManagerWidget)
    })).inSingletonScope();

    // Gestionnaire centralisé des onglets de détails de géocaches
    bind(GeocacheTabsManager).toSelf().inSingletonScope();

    bind(GeocacheLogEditorTabsManager).toSelf().inSingletonScope();

    // Gestionnaire centralisé des onglets d'éditeur d'images
    bind(GeocacheImageEditorTabsManager).toSelf().inSingletonScope();

    bind(GeocacheImageEditorFrontendContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(GeocacheImageEditorFrontendContribution);

    // Gestionnaire centralisé des onglets de tableaux de géocaches par zone
    bind(ZoneTabsManager).toSelf().inSingletonScope();

    bind(ZonesFrontendContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(ZonesFrontendContribution);

    bind(ZonesCommandContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(ZonesCommandContribution);
    bind(FrontendApplicationContribution).toService(ZonesCommandContribution);

    // Contribution pour les menus
    bind(ZonesMenuContribution).toSelf().inSingletonScope();
    bind(MenuContribution).toService(ZonesMenuContribution);

    // Contribution pour la sidebar (icônes en bas de la barre latérale)
    bind(GeoAppSidebarContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(GeoAppSidebarContribution);
    bind(MenuContribution).toService(GeoAppSidebarContribution);

    bind(GeoAppDefaultLeftPanelContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(GeoAppDefaultLeftPanelContribution);

    bind(LayoutAutoSaveContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(LayoutAutoSaveContribution);

    // Batch Map Integration pour écouter les événements du plugin batch
    bind(BatchMapIntegration).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(BatchMapIntegration);

    bind(CheckerToolsManager).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(CheckerToolsManager);

    bind(GeoAppOcrAgentContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(GeoAppOcrAgentContribution);

    bind(GeoAppTranslateDescriptionAgentContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(GeoAppTranslateDescriptionAgentContribution);

    bind(GeoAppLogsAnalyzerAgentContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(GeoAppLogsAnalyzerAgentContribution);

    bind(GeoAppLogWriterAgentContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(GeoAppLogWriterAgentContribution);

    bind(GeoAppChatBridge).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(GeoAppChatBridge);

    bind(GeoAppChatAgentContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(GeoAppChatAgentContribution);

    bind(GeoAppChatAgent).toSelf().inSingletonScope();
    bind(ChatAgent).toService(GeoAppChatAgent);

    bind(GeoAppChatLocalAgent).toSelf().inSingletonScope();
    bind(ChatAgent).toService(GeoAppChatLocalAgent);

    bind(GeoAppChatFastAgent).toSelf().inSingletonScope();
    bind(ChatAgent).toService(GeoAppChatFastAgent);

    bind(GeoAppChatStrongAgent).toSelf().inSingletonScope();
    bind(ChatAgent).toService(GeoAppChatStrongAgent);

    bind(GeoAppChatWebAgent).toSelf().inSingletonScope();
    bind(ChatAgent).toService(GeoAppChatWebAgent);

    // Widget d'authentification Geocaching.com
    bind(GeocachingAuthWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: GeocachingAuthWidget.ID,
        createWidget: () => ctx.container.get(GeocachingAuthWidget)
    })).inSingletonScope();

    // Widget de gestion de l'archive de résolution
    bind(ArchiveManagerWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: ArchiveManagerWidget.ID,
        createWidget: () => ctx.container.get(ArchiveManagerWidget)
    })).inSingletonScope();
});
