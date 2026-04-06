import { inject, injectable } from '@theia/core/shared/inversify';
import {
    getJsonOfResponse,
    getTextOfResponse,
    isLanguageModelParsedResponse,
    LanguageModelRegistry,
    LanguageModelService,
    UserRequest
} from '@theia/ai-core';
import { GeoAppTranslateDescriptionAgentId } from './geoapp-translate-description-agent';
import {
    GeocacheDetailsService,
    UpdateTranslatedContentInput
} from './geocache-details-service';
import { htmlToRawText } from './geocache-details-utils';

export interface TranslateAllWaypointInput {
    id: number;
    note: string;
}

export interface TranslateAllContentInput {
    geocacheId: number;
    descriptionHtml: string;
    hintsDecoded: string;
    waypoints: TranslateAllWaypointInput[];
}

@injectable()
export class GeocacheDetailsTranslationController {
    constructor(
        @inject(LanguageModelRegistry) protected readonly languageModelRegistry: LanguageModelRegistry,
        @inject(LanguageModelService) protected readonly languageModelService: LanguageModelService,
        @inject(GeocacheDetailsService) protected readonly geocacheDetailsService: GeocacheDetailsService
    ) {}

    async translateDescription(geocacheId: number, sourceHtml: string): Promise<void> {
        const languageModel = await this.selectTranslationLanguageModel();
        const prompt =
            'Tu es un traducteur. Traduis en francais le contenu TEXTUEL du HTML fourni, en conservant le HTML.\n'
            + '- Ne change pas les balises, attributs, liens, images, classes, ids.\n'
            + '- Ne traduis pas les coordonnees, codes GC, URLs, ni les identifiants techniques.\n'
            + '- Ne renvoie que le HTML final, sans markdown, sans explications.';

        const request: UserRequest = {
            messages: [
                { actor: 'user', type: 'text', text: `${prompt}\n\nHTML:\n${sourceHtml}` },
            ],
            agentId: GeoAppTranslateDescriptionAgentId,
            requestId: `geoapp-translate-description-${Date.now()}`,
            sessionId: `geoapp-translate-description-session-${Date.now()}`,
        };

        const response = await this.languageModelService.sendRequest(languageModel, request);
        let translatedHtml = '';
        if (isLanguageModelParsedResponse(response)) {
            translatedHtml = JSON.stringify(response.parsed);
        } else {
            try {
                translatedHtml = await getTextOfResponse(response);
            } catch {
                const jsonResponse = await getJsonOfResponse(response) as unknown;
                translatedHtml = typeof jsonResponse === 'string' ? jsonResponse : String(jsonResponse);
            }
        }

        translatedHtml = this.sanitizeTranslatedHtml(translatedHtml);
        if (!translatedHtml) {
            throw new Error('Traduction IA: reponse vide');
        }

        await this.geocacheDetailsService.updateDescription(geocacheId, {
            description_override_html: translatedHtml,
            description_override_raw: htmlToRawText(translatedHtml),
        });
    }

    async translateAllContent(input: TranslateAllContentInput): Promise<void> {
        const languageModel = await this.selectTranslationLanguageModel();
        const request: UserRequest = {
            messages: [
                {
                    actor: 'user',
                    type: 'text',
                    text: `${this.createTranslateAllPrompt()}\nINPUT_JSON:\n${JSON.stringify({
                        description_html: input.descriptionHtml,
                        hints_decoded: input.hintsDecoded,
                        waypoints: input.waypoints,
                    })}`
                },
            ],
            agentId: GeoAppTranslateDescriptionAgentId,
            requestId: `geoapp-translate-all-${Date.now()}`,
            sessionId: `geoapp-translate-all-session-${Date.now()}`,
        };

        const response = await this.languageModelService.sendRequest(languageModel, request);
        let parsed: any;
        try {
            parsed = await getJsonOfResponse(response) as any;
        } catch {
            const text = await getTextOfResponse(response);
            parsed = JSON.parse(text);
        }

        const translatedHtml = (parsed?.description_html || '').toString();
        const translatedHints = (parsed?.hints_decoded || '').toString();
        const translatedWaypoints = Array.isArray(parsed?.waypoints) ? parsed.waypoints : [];
        const payload: UpdateTranslatedContentInput = {
            description_override_html: translatedHtml,
            description_override_raw: htmlToRawText(translatedHtml),
            hints_decoded_override: translatedHints,
            waypoints: translatedWaypoints
                .filter((waypoint: any) => waypoint && typeof waypoint.id === 'number' && waypoint.note !== undefined && waypoint.note !== null)
                .map((waypoint: any) => ({ id: waypoint.id, note_override: String(waypoint.note) })),
        };

        await this.geocacheDetailsService.updateTranslatedContent(input.geocacheId, payload);
    }

    private async selectTranslationLanguageModel(): Promise<any> {
        const languageModel = await this.languageModelRegistry.selectLanguageModel({
            agent: GeoAppTranslateDescriptionAgentId,
            purpose: 'chat',
            identifier: 'default/universal'
        });

        if (!languageModel) {
            throw new Error('Aucun modele IA n est configure pour la traduction');
        }
        return languageModel;
    }

    private sanitizeTranslatedHtml(value: string): string {
        return (value || '')
            .toString()
            .replace(/\[THINK\][\s\S]*?\[\/THINK\]/gi, '')
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/\[ANALYSIS\][\s\S]*?\[\/ANALYSIS\]/gi, '')
            .replace(/<analysis>[\s\S]*?<\/analysis>/gi, '')
            .trim();
    }

    private createTranslateAllPrompt(): string {
        return 'Traduis en francais le contenu suivant et renvoie UNIQUEMENT un JSON valide.\n'
            + 'Contraintes :\n'
            + '- description_html : conserve strictement le HTML (balises/attributs/liens/images), ne traduis que le texte.\n'
            + '- Ne traduis pas les coordonnees, codes GC, URLs, ni les identifiants techniques.\n'
            + '- waypoints : conserve les ids, traduis uniquement la note.\n'
            + 'Schema JSON de sortie : {"description_html": string, "hints_decoded": string, "waypoints": [{"id": number, "note": string}] }\n';
    }
}
