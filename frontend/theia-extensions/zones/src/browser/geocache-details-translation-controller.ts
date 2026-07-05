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
        const translatedHtml = await this.translateHtmlFragment(languageModel, sourceHtml, 'description');
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

        // Decoupage volontaire: la description (souvent volumineuse) est traduite en HTML brut,
        // separement des hints + waypoints (petit JSON). Un unique appel qui renvoie tout dans un
        // seul JSON depasse frequemment la limite de generation des petits modeles locaux et se
        // retrouve tronque, faisant echouer l'ensemble.
        const description = (input.descriptionHtml || '').trim();
        const translatedHtml = description
            ? await this.translateHtmlFragment(languageModel, description, 'description')
            : '';

        const meta = await this.translateHintsAndWaypoints(languageModel, input.hintsDecoded, input.waypoints);

        const payload: UpdateTranslatedContentInput = {
            description_override_html: translatedHtml,
            description_override_raw: htmlToRawText(translatedHtml),
            hints_decoded_override: meta.hintsDecoded,
            waypoints: meta.waypoints,
        };

        await this.geocacheDetailsService.updateTranslatedContent(input.geocacheId, payload);
    }

    private async translateHtmlFragment(languageModel: any, sourceHtml: string, kind: string): Promise<string> {
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
            requestId: `geoapp-translate-${kind}-${Date.now()}`,
            sessionId: `geoapp-translate-${kind}-session-${Date.now()}`,
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

        return this.sanitizeTranslatedHtml(translatedHtml);
    }

    private async translateHintsAndWaypoints(
        languageModel: any,
        hintsDecoded: string,
        waypoints: TranslateAllWaypointInput[]
    ): Promise<{ hintsDecoded: string; waypoints: Array<{ id: number; note_override: string }> }> {
        const hasHints = (hintsDecoded || '').trim().length > 0;
        const hasWaypoints = waypoints.length > 0;
        if (!hasHints && !hasWaypoints) {
            return { hintsDecoded: '', waypoints: [] };
        }

        const request: UserRequest = {
            messages: [
                {
                    actor: 'user',
                    type: 'text',
                    text: `${this.createHintsWaypointsPrompt()}\nINPUT_JSON:\n${JSON.stringify({
                        hints_decoded: hintsDecoded,
                        waypoints,
                    })}`
                },
            ],
            agentId: GeoAppTranslateDescriptionAgentId,
            requestId: `geoapp-translate-meta-${Date.now()}`,
            sessionId: `geoapp-translate-meta-session-${Date.now()}`,
        };

        const response = await this.languageModelService.sendRequest(languageModel, request);
        const parsed = await this.parseJsonResponse(response);

        const translatedHints = (parsed?.hints_decoded || '').toString();
        const translatedWaypoints = Array.isArray(parsed?.waypoints) ? parsed.waypoints : [];
        return {
            hintsDecoded: translatedHints,
            waypoints: translatedWaypoints
                .filter((waypoint: any) => waypoint && typeof waypoint.id === 'number' && waypoint.note !== undefined && waypoint.note !== null)
                .map((waypoint: any) => ({ id: waypoint.id, note_override: String(waypoint.note) })),
        };
    }

    /**
     * Parse une reponse LLM censee etre du JSON, en tolerant les blocs de raisonnement
     * (<think>...</think>) et les fences markdown que certains modeles locaux ajoutent.
     */
    private async parseJsonResponse(response: any): Promise<any> {
        try {
            return await getJsonOfResponse(response);
        } catch {
            const raw = await getTextOfResponse(response);
            return this.extractJson(raw);
        }
    }

    private extractJson(raw: string): any {
        const cleaned = this.sanitizeTranslatedHtml(raw);
        try {
            return JSON.parse(cleaned);
        } catch {
            const fence = cleaned.match(/```(?:json)?\s*([\s\S]+?)```/i);
            if (fence) {
                try {
                    return JSON.parse(fence[1].trim());
                } catch {
                    // continue avec l'extraction du premier objet
                }
            }
            const obj = cleaned.match(/\{[\s\S]+\}/);
            if (obj) {
                try {
                    return JSON.parse(obj[0]);
                } catch {
                    // echec final ci-dessous
                }
            }
            throw new Error('Traduction IA: reponse JSON invalide');
        }
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

    private createHintsWaypointsPrompt(): string {
        return 'Traduis en francais le contenu suivant et renvoie UNIQUEMENT un JSON valide.\n'
            + 'Contraintes :\n'
            + '- hints_decoded : traduis le texte de l indice.\n'
            + '- Ne traduis pas les coordonnees, codes GC, URLs, ni les identifiants techniques.\n'
            + '- waypoints : conserve les ids, traduis uniquement la note.\n'
            + 'Schema JSON de sortie : {"hints_decoded": string, "waypoints": [{"id": number, "note": string}] }\n';
    }
}
