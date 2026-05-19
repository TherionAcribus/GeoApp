import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { ChatAgent } from '@theia/ai-chat/lib/common/chat-agents';
import {
    GeocacheDetailsHeaderActionContribution
} from 'theia-ide-zones-ext/lib/browser/geocache-details-header-actions';
import { EarthCoachAgent, EarthCoachAgentContribution } from './earthcoach-agent';
import { EarthCoachCommandContribution } from './earthcoach-command-contribution';
import { EarthCoachContextService } from './earthcoach-context-service';
import { EarthCoachFieldChecklistWidget } from './earthcoach-field-checklist-widget';
import { EarthCoachImageGalleryWidget } from './earthcoach-image-gallery-widget';
import { EarthCoachNoteTools } from './earthcoach-note-tools';
import { EarthCoachReferenceTools } from './earthcoach-reference-tools';
import { EarthCoachReferenceWidget } from './earthcoach-reference-widget';

export default new ContainerModule(bind => {
    bind(EarthCoachContextService).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(EarthCoachContextService);
    bind(EarthCoachReferenceTools).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(EarthCoachReferenceTools);
    bind(EarthCoachNoteTools).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(EarthCoachNoteTools);

    bind(EarthCoachReferenceWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: EarthCoachReferenceWidget.ID,
        createWidget: () => ctx.container.get(EarthCoachReferenceWidget),
    })).inSingletonScope();
    bind(EarthCoachFieldChecklistWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: EarthCoachFieldChecklistWidget.ID,
        createWidget: () => ctx.container.get(EarthCoachFieldChecklistWidget),
    })).inSingletonScope();
    bind(EarthCoachImageGalleryWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: EarthCoachImageGalleryWidget.ID,
        createWidget: () => ctx.container.get(EarthCoachImageGalleryWidget),
    })).inSingletonScope();

    bind(EarthCoachAgent).toSelf().inSingletonScope();
    bind(ChatAgent).toService(EarthCoachAgent);

    bind(EarthCoachAgentContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(EarthCoachAgentContribution);

    bind(EarthCoachCommandContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(EarthCoachCommandContribution);
    bind(MenuContribution).toService(EarthCoachCommandContribution);
    bind(GeocacheDetailsHeaderActionContribution).toService(EarthCoachCommandContribution);
});
