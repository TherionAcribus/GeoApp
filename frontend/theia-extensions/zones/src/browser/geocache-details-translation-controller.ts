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

/**
 * Bilan d'une traduction globale: quelles parties ont ete effectivement traduites et
 * enregistrees, et quelles parties non vides en entree n'ont rien produit d'exploitable.
 */
export interface TranslateAllContentResult {
    translated: string[];
    failed: string[];
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

    async translateAllContent(input: TranslateAllContentInput): Promise<TranslateAllContentResult> {
        const languageModel = await this.selectTranslationLanguageModel();

        const description = (input.descriptionHtml || '').trim();
        const sourceHints = (input.hintsDecoded || '').trim();
        // Une note source vide ne peut produire qu'une traduction vide: l'envoyer au modele
        // ne servirait qu'a risquer d'ecraser un note_override existant.
        const sourceWaypoints = (input.waypoints || []).filter(waypoint => (waypoint?.note || '').trim().length > 0);

        if (!description && !sourceHints && sourceWaypoints.length === 0) {
            throw new Error('Traduction IA: aucun contenu a traduire');
        }

        // Decoupage volontaire: la description (souvent volumineuse) est traduite en HTML brut,
        // separement des hints + waypoints (petit JSON). Un unique appel qui renvoie tout dans un
        // seul JSON depasse frequemment la limite de generation des petits modeles locaux et se
        // retrouve tronque, faisant echouer l'ensemble.
        // Chaque etape est persistee des qu'elle aboutit: un echec sur les hints/waypoints ne doit
        // pas faire perdre la description, qui est de loin l'appel le plus long et le plus couteux.
        const translated: string[] = [];
        const failed: string[] = [];

        if (description) {
            const translatedHtml = await this.translateHtmlFragment(languageModel, description, 'description');
            // Sans ce garde-fou, une reponse vide (ou reduite a un bloc de raisonnement) serait
            // persistee telle quelle et effacerait la description modifiee existante.
            if (translatedHtml) {
                await this.geocacheDetailsService.updateTranslatedContent(input.geocacheId, {
                    description_override_html: translatedHtml,
                    description_override_raw: htmlToRawText(translatedHtml),
                });
                translated.push('description');
            } else {
                failed.push('description');
            }
        }

        if (!sourceHints && sourceWaypoints.length === 0) {
            if (translated.length === 0) {
                throw new Error(`Traduction IA: reponse vide (${failed.join(', ')})`);
            }
            return { translated, failed };
        }

        // Une reponse JSON invalide ou une erreur reseau sur cette 2e etape est rattrapee: elle est
        // comptabilisee comme un echec partiel plutot que d'annuler la description deja enregistree.
        let meta: { hintsDecoded: string; waypoints: Array<{ id: number; note_override: string }> } = {
            hintsDecoded: '',
            waypoints: [],
        };
        let metaError: unknown;
        try {
            meta = await this.translateHintsAndWaypoints(languageModel, sourceHints, sourceWaypoints);
        } catch (error) {
            metaError = error;
            console.error('[GeocacheDetailsTranslationController] echec traduction hints/waypoints', error);
        }

        const payload: UpdateTranslatedContentInput = {};

        if (sourceHints) {
            if (meta.hintsDecoded) {
                payload.hints_decoded_override = meta.hintsDecoded;
                translated.push('indices');
            } else {
                failed.push('indices');
            }
        }

        if (sourceWaypoints.length > 0) {
            if (meta.waypoints.length > 0) {
                payload.waypoints = meta.waypoints;
                translated.push(`notes de waypoints (${meta.waypoints.length}/${sourceWaypoints.length})`);
            }
            if (meta.waypoints.length < sourceWaypoints.length) {
                const missing = sourceWaypoints.length - meta.waypoints.length;
                failed.push(`notes de waypoints (${missing}/${sourceWaypoints.length})`);
            }
        }

        if (translated.length === 0) {
            // Rien n'a pu etre enregistre: on remonte la cause reelle si l'etape 2 a leve.
            if (metaError) {
                throw metaError;
            }
            throw new Error(`Traduction IA: reponse vide (${failed.join(', ')})`);
        }

        if (Object.keys(payload).length > 0) {
            await this.geocacheDetailsService.updateTranslatedContent(input.geocacheId, payload);
        }

        return { translated, failed };
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
            // `parsed` est le resultat d'un parsing JSON. Pour une traduction HTML on attend une
            // simple chaine : JSON.stringify l'entourerait de guillemets et echapperait les
            // sauts de ligne, produisant un HTML corrompu. On extrait donc la chaine attendue
            // et on retombe sur le contenu textuel brut (content) sinon.
            translatedHtml = this.extractHtmlFromParsedResponse(response);
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

        const translatedHints = this.sanitizeTranslatedHtml((parsed?.hints_decoded ?? '').toString());
        const translatedWaypoints = Array.isArray(parsed?.waypoints) ? parsed.waypoints : [];

        // On ne garde que les waypoints demandes (le modele peut en inventer ou en dupliquer)
        // dont la note traduite est non vide: sinon on ecraserait un note_override existant.
        // Certains modeles renvoient l'id en chaine ("12") au lieu d'un nombre : on coerce via
        // Number() et on valide avec Number.isFinite pour rester tolerant sans accepter n'importe quoi.
        const requestedIds = new Set(waypoints.map(waypoint => waypoint.id));
        const seenIds = new Set<number>();
        const notes: Array<{ id: number; note_override: string }> = [];
        for (const waypoint of translatedWaypoints) {
            if (!waypoint) {
                continue;
            }
            const id = Number(waypoint.id);
            if (!Number.isFinite(id) || !requestedIds.has(id) || seenIds.has(id)) {
                continue;
            }
            const note = this.sanitizeTranslatedHtml((waypoint.note ?? '').toString());
            if (!note) {
                continue;
            }
            seenIds.add(id);
            notes.push({ id, note_override: note });
        }

        return { hintsDecoded: translatedHints, waypoints: notes };
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

    /**
     * Extrait le HTML traduit d'une reponse LLM « parsee » (JSON). Pour une traduction HTML on
     * attend une simple chaine ; `JSON.stringify` l'entourerait de guillemets et echapperait les
     * sauts de ligne, produisant un HTML corrompu. On gere donc :
     *  - une chaine directement (cas attendu),
     *  - un objet portant un champ texte evident (html/description/content/text/...),
     *  - sinon le contenu textuel brut (content), qui est le HTML renvoye par le modele.
     */
    private extractHtmlFromParsedResponse(response: { parsed: unknown; content: string }): string {
        const parsed = response.parsed;
        if (typeof parsed === 'string') {
            return parsed;
        }
        if (parsed && typeof parsed === 'object') {
            const candidate = parsed as Record<string, unknown>;
            for (const key of ['html', 'description', 'content', 'text', 'translation', 'translated_html', 'translatedHtml']) {
                const value = candidate[key];
                if (typeof value === 'string') {
                    return value;
                }
            }
        }
        return response.content ?? '';
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
