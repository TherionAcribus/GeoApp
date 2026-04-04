import { ContainerModule } from '@theia/core/shared/inversify';
import { WidgetFactory, bindViewContribution, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { PreferenceContribution } from '@theia/core/lib/common';

import { geoPreferenceSchema } from './geo-preferences-schema';
import { GeoPreferenceStore } from './geo-preference-store';
import { GeoPreferencesWidget } from './geo-preferences-widget';
import { GeoPreferencesFrontendContribution } from './geo-preferences-frontend-contribution';
import { PreferencesApiClient } from './services/preferences-api-client';
import { PreferenceSyncService } from './services/preference-sync-service';

import './style/geo-preferences.css';

export default new ContainerModule(bind => {
    bind(GeoPreferenceStore).toSelf().inSingletonScope();
    bind(PreferencesApiClient).toSelf().inSingletonScope();
    bind(PreferenceSyncService).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(PreferenceSyncService);

    bind(GeoPreferencesWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: GeoPreferencesWidget.ID,
        createWidget: () => ctx.container.get<GeoPreferencesWidget>(GeoPreferencesWidget)
    })).inSingletonScope();

    bindViewContribution(bind, GeoPreferencesFrontendContribution);
    bind(FrontendApplicationContribution).toService(GeoPreferencesFrontendContribution);

    bind(PreferenceContribution).toConstantValue({ schema: geoPreferenceSchema });
});

