/**
 * Module frontend Theia pour l'extension GeoApp Search.
 * 
 * Enregistre les services de recherche (in-page + global),
 * les renderers, widgets et contributions.
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { KeybindingContribution, FrontendApplicationContribution, WidgetFactory, bindViewContribution } from '@theia/core/lib/browser';
import { SearchService } from './search-service';
import { SearchOverlayRenderer } from './search-overlay-renderer';
import { SearchContribution } from './search-contribution';
import { GlobalSearchService } from './global-search-service';
import { GlobalSearchWidget } from './global-search-widget';
import { GlobalSearchContribution } from './global-search-contribution';

import './style/search-overlay.css';
import './style/global-search.css';

export default new ContainerModule(bind => {
    console.log('[GEOAPP-SEARCH] Loading search-frontend-module...');

    // === Recherche in-page (Ctrl+F) ===
    bind(SearchService).toSelf().inSingletonScope();
    bind(SearchOverlayRenderer).toSelf().inSingletonScope();

    bind(SearchContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(SearchContribution);
    bind(KeybindingContribution).toService(SearchContribution);
    bind(FrontendApplicationContribution).toService(SearchContribution);

    // === Recherche globale (Ctrl+Shift+F) ===
    bind(GlobalSearchService).toSelf().inSingletonScope();

    bind(GlobalSearchWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: GlobalSearchWidget.ID,
        createWidget: () => ctx.container.get(GlobalSearchWidget)
    })).inSingletonScope();

    bindViewContribution(bind, GlobalSearchContribution);
    bind(FrontendApplicationContribution).toService(GlobalSearchContribution);
    bind(CommandContribution).toService(GlobalSearchContribution);
    bind(KeybindingContribution).toService(GlobalSearchContribution);
    bind(MenuContribution).toService(GlobalSearchContribution);
});
