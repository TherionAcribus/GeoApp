import { ContainerModule } from '@theia/core/shared/inversify';
import { WidgetFactory, bindViewContribution, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { CommandContribution, MenuContribution } from '@theia/core';
import { CalculatorService } from './calculator-service';
import { CalculatorWidget } from './calculator-widget';
import { CalculatorContribution } from './calculator-contribution';
import { CalculatorToolManager } from './calculator-tool-manager';

export default new ContainerModule(bind => {
    bind(CalculatorService).toSelf().inSingletonScope();

    bind(CalculatorWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: CalculatorWidget.ID,
        createWidget: () => ctx.container.get<CalculatorWidget>(CalculatorWidget),
    })).inSingletonScope();

    bindViewContribution(bind, CalculatorContribution);
    bind(FrontendApplicationContribution).toService(CalculatorContribution);

    bind(CalculatorToolManager).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(CalculatorToolManager);
});
