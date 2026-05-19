import { inject, injectable } from '@theia/core/shared/inversify';
import {
    CommandContribution,
    CommandRegistry,
    MenuContribution,
    MenuModelRegistry,
    MessageService,
} from '@theia/core/lib/common';
import { CommonMenus } from '@theia/core/lib/browser';
import { QuickInputService, QuickPickValue } from '@theia/core/lib/common/quick-pick-service';
import {
    buildGeoAppOpenChatRequestDetail,
    dispatchGeoAppOpenChatRequest,
} from 'theia-ide-zones-ext/lib/browser/geoapp-chat-shared';
import {
    GeocacheDetailsHeaderAction,
    GeocacheDetailsHeaderActionContribution,
    GeocacheDetailsHeaderActionContext,
    isEarthCacheGeocache,
} from 'theia-ide-zones-ext/lib/browser/geocache-details-header-actions';
import { EarthCoachContextService } from './earthcoach-context-service';
import {
    EarthCoachAgentId,
    EarthCoachOpenRequest,
    EarthCoachQuickAction,
} from './earthcoach-types';
import { buildEarthCoachPrompt, toImageContext } from './earthcoach-prompt-builder';

export namespace EarthCoachCommands {
    export const OPEN = {
        id: 'earthcoach.open',
        label: 'Ouvrir EarthCoach',
    };
}

const QUICK_ACTIONS: Array<QuickPickValue<EarthCoachQuickAction>> = [
    {
        label: 'Comprendre cette EarthCache',
        description: 'Notions, contexte geologique et questions a clarifier',
        value: 'understand',
    },
    {
        label: 'Preparer ma visite',
        description: 'Checklist terrain et observations a relever',
        value: 'prepare_visit',
    },
    {
        label: 'Expliquer un mot',
        description: 'Definition simple d un terme geologique',
        value: 'explain_word',
    },
    {
        label: 'Analyser mes observations',
        description: 'Tri observation / interpretation / hypothese',
        value: 'analyze_observations',
    },
    {
        label: 'Resoudre avec mes observations',
        description: 'Mode resolver explicite, sans inventer le terrain',
        value: 'resolve',
    },
];

@injectable()
export class EarthCoachCommandContribution implements CommandContribution, MenuContribution, GeocacheDetailsHeaderActionContribution {

    @inject(MessageService)
    protected readonly messages!: MessageService;

    @inject(QuickInputService)
    protected readonly quickInputService!: QuickInputService;

    @inject(EarthCoachContextService)
    protected readonly contextService!: EarthCoachContextService;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(EarthCoachCommands.OPEN, {
            execute: (request?: EarthCoachOpenRequest) => this.openEarthCoach(request),
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
            commandId: EarthCoachCommands.OPEN.id,
            label: 'EarthCoach',
            order: '42',
        });
    }

    getGeocacheDetailsHeaderActions(context: GeocacheDetailsHeaderActionContext): GeocacheDetailsHeaderAction[] {
        if (!isEarthCacheGeocache(context.geocacheData)) {
            return [];
        }
        return [{
            id: EarthCoachCommands.OPEN.id,
            label: 'EarthCoach',
            title: 'Ouvrir EarthCoach pour cette EarthCache',
            order: '45',
            execute: () => this.openEarthCoach({ geocacheData: context.geocacheData }),
        }];
    }

    protected async openEarthCoach(request?: EarthCoachOpenRequest): Promise<void> {
        const context = await this.contextService.collectContext(request);
        if (!context) {
            this.messages.warn('Aucune geocache active pour EarthCoach.');
            return;
        }
        if (!isEarthCacheGeocache(context.geocacheData)) {
            this.messages.warn('EarthCoach est prevu pour les EarthCaches. Ouvre une EarthCache pour l utiliser.');
            return;
        }

        const action = request?.action || await this.pickAction();
        if (!action) {
            return;
        }
        const mode = action === 'resolve' ? 'resolver' : 'coach';
        const prompt = buildEarthCoachPrompt({
            geocache: context.geocacheData,
            mode,
            action,
            observations: context.observations,
            gcPersonalNote: context.gcPersonalNote,
            images: context.images,
        });

        const gcLabel = context.geocacheData.gc_code || context.geocacheData.name;
        const sessionTitle = mode === 'resolver'
            ? `EARTHCOACH RESOLUTION - ${gcLabel}`
            : `EARTHCOACH - ${gcLabel}`;

        dispatchGeoAppOpenChatRequest(
            window,
            CustomEvent,
            buildGeoAppOpenChatRequestDetail({
                geocacheId: context.geocacheData.id,
                gcCode: context.geocacheData.gc_code,
                geocacheName: context.geocacheData.name,
                sessionTitle,
                prompt,
                focus: true,
                workflowKind: 'general',
                preferredProfile: mode === 'resolver' ? 'strong' : undefined,
                preferredAgentId: EarthCoachAgentId,
                earthcoachMode: mode,
                sessionKind: 'earthcoach',
                imageContexts: context.images.slice(0, 5).map(toImageContext),
                resumeState: {
                    earthcoach: {
                        mode,
                        action,
                        imageOrigins: context.images.map(image => ({
                            id: image.id,
                            origin: image.origin,
                            label: image.label,
                        })),
                    },
                },
            })
        );
    }

    protected async pickAction(): Promise<EarthCoachQuickAction | undefined> {
        const picked = await this.quickInputService.pick(QUICK_ACTIONS, {
            title: 'EarthCoach',
            placeHolder: 'Choisir une aide pour cette EarthCache',
            matchOnDescription: true,
        });
        return picked?.value;
    }
}
