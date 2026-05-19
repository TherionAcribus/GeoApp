import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { ChatAgent } from '@theia/ai-chat/lib/common/chat-agents';
import {
    GeocacheDetailsHeaderActionContribution
} from 'theia-ide-zones-ext/lib/browser/geocache-details-header-actions';
import { EarthCoachAgent, EarthCoachAgentContribution } from './earthcoach-agent';
import { EarthCoachCommandContribution } from './earthcoach-command-contribution';
import { EarthCoachContextService } from './earthcoach-context-service';
import { EarthCoachReferenceTools } from './earthcoach-reference-tools';

export default new ContainerModule(bind => {
    bind(EarthCoachContextService).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(EarthCoachContextService);
    bind(EarthCoachReferenceTools).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(EarthCoachReferenceTools);

    bind(EarthCoachAgent).toSelf().inSingletonScope();
    bind(ChatAgent).toService(EarthCoachAgent);

    bind(EarthCoachAgentContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(EarthCoachAgentContribution);

    bind(EarthCoachCommandContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(EarthCoachCommandContribution);
    bind(MenuContribution).toService(EarthCoachCommandContribution);
    bind(GeocacheDetailsHeaderActionContribution).toService(EarthCoachCommandContribution);
});
