import { ContainerModule } from '@theia/core/shared/inversify';
import {
    CommandContribution,
    MenuContribution,
} from '@theia/core/lib/common';
import {
    FrontendApplicationContribution,
    KeybindingContribution,
    WidgetFactory,
} from '@theia/core/lib/browser';
import { DocWidget } from './doc-widget';
import { DocContentService } from './doc-content-service';
import { DocSearchService } from './doc-search-service';
import { DocContribution } from './doc-contribution';
import { GeoAppDocAgent, GeoAppDocAgentContribution } from './doc-agent';
import { ChatAgent } from '@theia/ai-chat/lib/common/chat-agents';

export default new ContainerModule(bind => {
    console.log('[GEOAPP-DOC] Loading doc-frontend-module...');

    bind(DocContentService).toSelf().inSingletonScope();
    bind(DocSearchService).toSelf().inSingletonScope();

    bind(DocWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: DocWidget.ID,
        createWidget: () => ctx.container.get(DocWidget),
    })).inSingletonScope();

    bind(DocContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(DocContribution);
    bind(MenuContribution).toService(DocContribution);
    bind(KeybindingContribution).toService(DocContribution);
    bind(FrontendApplicationContribution).toService(DocContribution);

    bind(GeoAppDocAgent).toSelf().inSingletonScope();
    bind(ChatAgent).toService(GeoAppDocAgent);

    bind(GeoAppDocAgentContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(GeoAppDocAgentContribution);
});
