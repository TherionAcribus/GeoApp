import { inject, injectable } from '@theia/core/shared/inversify';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { GeocacheDetailsService } from './geocache-details-service';
import {
    buildGeocacheFreeChatContext,
    buildGeocacheFreeChatFinalPrompt,
    buildGeocacheGeoAppOpenChatDetail,
} from './geocache-chat-prompt-shared';
import {
    buildGeoAppBaseSessionTitle,
    GeoAppChatImageContext,
    buildGeoAppOpenChatRequestDetail,
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

    // Cache du workflowKind derive du reseau, par geocache. On ne cache que la partie
    // couteuse (l'appel /workflow/preview) ; le profil est recalcule a chaque appel a
    // partir des preferences courantes, pour rester juste si l'utilisateur les modifie.
    private readonly workflowPreviewCache = new Map<number, GeoAppChatWorkflowKind>();

    constructor(
        @inject(PreferenceService) protected readonly preferenceService: PreferenceService,
        @inject(GeocacheDetailsService) protected readonly geocacheDetailsService: GeocacheDetailsService
    ) {}

    async resolveRoutingPreview(geocacheId?: number): Promise<GeocacheChatRoutingState> {
        if (!geocacheId) {
            return this.createDefaultRoutingState();
        }

        const cachedWorkflow = this.workflowPreviewCache.get(geocacheId);
        if (cachedWorkflow) {
            return {
                workflowPreview: cachedWorkflow,
                profilePreview: this.resolveChatProfileForWorkflow(cachedWorkflow)
            };
        }

        try {
            const preview = await this.geocacheDetailsService.previewWorkflow<GeoAppWorkflowResolutionPreview>(geocacheId);
            const workflowPreview = resolveGeoAppChatWorkflowKindFromOrchestrator(preview);
            this.workflowPreviewCache.set(geocacheId, workflowPreview);
            return {
                workflowPreview,
                profilePreview: this.resolveChatProfileForWorkflow(workflowPreview)
            };
        } catch (error) {
            console.warn('[GeocacheDetailsChatController] resolveRoutingPreview error', error);
            return this.createDefaultRoutingState();
        }
    }

    /**
     * Invalide l'apercu de routage cache pour une geocache (ou tout le cache si aucun
     * id), a appeler quand le listing change (edition, traduction, statut resolu...).
     */
    invalidateRoutingPreview(geocacheId?: number): void {
        if (typeof geocacheId === 'number') {
            this.workflowPreviewCache.delete(geocacheId);
        } else {
            this.workflowPreviewCache.clear();
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
            {
                ...buildGeocacheGeoAppOpenChatDetail(
                    geocacheData,
                    workflowPreview,
                    profileOverride === 'default' ? undefined : profileOverride,
                ),
                sessionKind: 'auto',
            }
        );
    }

    buildFreeChatDraft(geocacheData: GeocacheDto): string {
        return buildGeocacheFreeChatContext(geocacheData);
    }

    openFreeChat(
        geocacheData: GeocacheDto,
        draft: string,
        imageUrls: string[],
        profileOverride: GeoAppChatWorkflowProfile
    ): void {
        const finalPrompt = buildGeocacheFreeChatFinalPrompt(draft, imageUrls);
        const gcCode = geocacheData.gc_code;
        const baseTitle = buildGeoAppBaseSessionTitle(gcCode, geocacheData.name, `CHAT LIBRE - ${gcCode || geocacheData.name}`);
        dispatchGeoAppOpenChatRequest(
            window,
            CustomEvent,
            buildGeoAppOpenChatRequestDetail({
                geocacheId: geocacheData.id,
                gcCode,
                geocacheName: geocacheData.name,
                sessionTitle: baseTitle,
                prompt: finalPrompt,
                imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
                focus: true,
                workflowKind: 'general',
                preferredProfile: profileOverride === 'default' ? undefined : profileOverride,
                sessionKind: 'libre',
            })
        );
    }

    openImagesChat(
        geocacheData: GeocacheDto,
        imageContexts: GeoAppChatImageContext[],
        profileOverride: GeoAppChatWorkflowProfile
    ): void {
        const gcCode = geocacheData.gc_code;
        const baseTitle = buildGeoAppBaseSessionTitle(gcCode, geocacheData.name, `CHAT IMAGES - ${gcCode || geocacheData.name}`);
        const imageList = imageContexts
            .map(image => {
                const label = image.label || image.id || image.url;
                const note = image.description?.trim() ? `\n  Note utilisateur: ${image.description.trim()}` : '';
                return `- [${image.origin}] ${image.id || label} - ${label}${note}`;
            })
            .join('\n');
        const prompt = [
            buildGeocacheFreeChatContext(geocacheData),
            '',
            'Analyse les images selectionnees pour cette geocache.',
            'Separe strictement ce qui est visible sur les images, ce qui est une interpretation, et ce qui reste une hypothese.',
            '',
            'Images selectionnees:',
            imageList,
        ].join('\n');
        dispatchGeoAppOpenChatRequest(
            window,
            CustomEvent,
            buildGeoAppOpenChatRequestDetail({
                geocacheId: geocacheData.id,
                gcCode,
                geocacheName: geocacheData.name,
                sessionTitle: baseTitle,
                prompt,
                imageContexts,
                focus: true,
                workflowKind: 'image_puzzle',
                preferredProfile: profileOverride === 'default' ? undefined : profileOverride,
                sessionKind: 'libre',
            })
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
