import { inject, injectable } from '@theia/core/shared/inversify';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { GeocacheDetailsService } from './geocache-details-service';
import {
    buildGeocacheGeoAppOpenChatDetail,
} from './geocache-chat-prompt-shared';
import {
    dispatchGeoAppOpenChatRequest,
    GeoAppWorkflowResolutionPreview,
    resolveGeoAppChatProfileForWorkflow,
    resolveGeoAppChatWorkflowKindFromOrchestrator,
} from './geoapp-chat-shared';
import {
    GeoAppChatProfile,
    GeoAppChatWorkflowKind,
    GeoAppChatWorkflowProfile
} from './geoapp-chat-agent';
import { GeocacheDto } from './geocache-details-types';

export interface GeocacheChatRoutingState {
    workflowPreview: GeoAppChatWorkflowKind;
    profilePreview: GeoAppChatProfile;
}

@injectable()
export class GeocacheDetailsChatController {
    constructor(
        @inject(PreferenceService) protected readonly preferenceService: PreferenceService,
        @inject(GeocacheDetailsService) protected readonly geocacheDetailsService: GeocacheDetailsService
    ) {}

    async resolveRoutingPreview(geocacheId?: number): Promise<GeocacheChatRoutingState> {
        if (!geocacheId) {
            return this.createDefaultRoutingState();
        }

        try {
            const preview = await this.geocacheDetailsService.resolveWorkflow<GeoAppWorkflowResolutionPreview>(geocacheId);
            const workflowPreview = resolveGeoAppChatWorkflowKindFromOrchestrator(preview);
            return {
                workflowPreview,
                profilePreview: this.resolveChatProfileForWorkflow(workflowPreview)
            };
        } catch (error) {
            console.warn('[GeocacheDetailsChatController] resolveRoutingPreview error', error);
            return this.createDefaultRoutingState();
        }
    }

    getEffectiveChatProfile(
        profilePreview: GeoAppChatProfile,
        profileOverride: GeoAppChatWorkflowProfile
    ): GeoAppChatProfile {
        return profileOverride === 'default' ? profilePreview : profileOverride;
    }

    getChatProfileOverrideLabel(
        profilePreview: GeoAppChatProfile,
        profileOverride: GeoAppChatWorkflowProfile
    ): string {
        if (profileOverride === 'default') {
            return `Auto (${profilePreview})`;
        }
        return profileOverride;
    }

    openGeocacheChat(
        geocacheData: GeocacheDto,
        workflowPreview: GeoAppChatWorkflowKind,
        profileOverride: GeoAppChatWorkflowProfile
    ): void {
        dispatchGeoAppOpenChatRequest(
            window,
            CustomEvent,
            buildGeocacheGeoAppOpenChatDetail(
                geocacheData,
                workflowPreview,
                profileOverride === 'default' ? undefined : profileOverride,
            )
        );
    }

    private createDefaultRoutingState(): GeocacheChatRoutingState {
        const workflowPreview: GeoAppChatWorkflowKind = 'general';
        return {
            workflowPreview,
            profilePreview: this.resolveChatProfileForWorkflow(workflowPreview)
        };
    }

    private resolveChatProfileForWorkflow(workflowKind: GeoAppChatWorkflowKind): GeoAppChatProfile {
        return resolveGeoAppChatProfileForWorkflow(workflowKind, undefined, {
            'geoApp.chat.defaultProfile': this.preferenceService.get('geoApp.chat.defaultProfile', 'fast'),
            'geoApp.chat.workflowProfile.secretCode': this.preferenceService.get('geoApp.chat.workflowProfile.secretCode', 'default'),
            'geoApp.chat.workflowProfile.formula': this.preferenceService.get('geoApp.chat.workflowProfile.formula', 'default'),
            'geoApp.chat.workflowProfile.checker': this.preferenceService.get('geoApp.chat.workflowProfile.checker', 'default'),
            'geoApp.chat.workflowProfile.hiddenContent': this.preferenceService.get('geoApp.chat.workflowProfile.hiddenContent', 'default'),
            'geoApp.chat.workflowProfile.imagePuzzle': this.preferenceService.get('geoApp.chat.workflowProfile.imagePuzzle', 'default'),
        });
    }
}
