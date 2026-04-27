import { ContainerModule } from '@theia/core/shared/inversify';
import { bindViewContribution, FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';
import { CommandContribution, MenuContribution } from '@theia/core';
import { PluginExecutorContribution } from './plugins-contribution';
import { PluginExecutorWidget } from './plugin-executor-widget';

export default new ContainerModule(bind => {
    bind(PluginExecutorWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: PluginExecutorWidget.ID,
        createWidget: () => ctx.container.get<PluginExecutorWidget>(PluginExecutorWidget)
    })).inSingletonScope();

    bindViewContribution(bind, PluginExecutorContribution);
    bind(CommandContribution).toService(PluginExecutorContribution);
    bind(MenuContribution).toService(PluginExecutorContribution);
    bind(FrontendApplicationContribution).toService(PluginExecutorContribution);
});
