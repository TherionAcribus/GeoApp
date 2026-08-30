import { inject, injectable } from '@theia/core/shared/inversify';
import { CancellationToken, CancellationError, isCancelled } from '@theia/core';
import DOMPurify from '@theia/core/shared/dompurify';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
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

/** Statut d'une phase de traduction, pour la progression affichee a l'utilisateur. */
export type TranslationPhaseStatus = 'pending' | 'done' | 'failed' | 'skipped';

/** Progression detaillee d'une traduction, notifiee au widget a chaque transition de phase. */
export interface TranslationProgress {
    description: TranslationPhaseStatus;
    hints: TranslationPhaseStatus;
    waypoints: TranslationPhaseStatus;
}

/** Callback de progression, appele par le controleur a chaque changement d'etat d'une phase. */
export type TranslationProgressCallback = (progress: TranslationProgress) => void;

/** Resultat de l'etape de traduction de la description (lancee en parallele des hints/waypoints). */
type DescriptionStepResult =
    | { kind: 'done' }
    | { kind: 'empty' }
    | { kind: 'skipped' };

/** Resultat de l'etape de traduction des hints + waypoints (lancee en parallele de la description). */
type MetaStepResult =
    | { kind: 'done'; translatedHints: boolean; waypointCount: number }
    | { kind: 'skipped' };

@injectable()
export class GeocacheDetailsTranslationController {
    constructor(
        @inject(LanguageModelRegistry) protected readonly languageModelRegistry: LanguageModelRegistry,
        @inject(LanguageModelService) protected readonly languageModelService: LanguageModelService,
        @inject(GeocacheDetailsService) protected readonly geocacheDetailsService: GeocacheDetailsService,
        @inject(PreferenceService) protected readonly preferenceService: PreferenceService
    ) {}

    /** Langue cible de traduction, lue depuis la preference geoApp.translation.targetLanguage. */
    private getTargetLanguage(): string {
        const raw = this.preferenceService.get('geoApp.translation.targetLanguage', 'francais') as string;
        return (raw || 'francais').toString().trim() || 'francais';
    }

    async translateDescription(
        geocacheId: number,
        sourceHtml: string,
        cancellationToken?: CancellationToken,
        onProgress?: TranslationProgressCallback
    ): Promise<void> {
        const languageModel = await this.selectTranslationLanguageModel();
        onProgress?.({ description: 'pending', hints: 'skipped', waypoints: 'skipped' });
        const translatedHtml = await this.translateHtmlWithChunking(languageModel, sourceHtml, cancellationToken);
        if (!translatedHtml) {
            onProgress?.({ description: 'failed', hints: 'skipped', waypoints: 'skipped' });
            throw new Error('Traduction IA: reponse vide');
        }

        await this.geocacheDetailsService.updateDescription(geocacheId, {
            description_override_html: translatedHtml,
            description_override_raw: htmlToRawText(translatedHtml),
        });
        onProgress?.({ description: 'done', hints: 'skipped', waypoints: 'skipped' });
    }

    async translateAllContent(
        input: TranslateAllContentInput,
        cancellationToken?: CancellationToken,
        onProgress?: TranslationProgressCallback
    ): Promise<TranslateAllContentResult> {
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
        //
        // Les deux appels sont lances en parallele (Promise.allSettled) pour gagner du temps sur
        // les modeles cloud/API. Chaque etape est persistee des qu'elle aboutit: un echec sur
        // l'une n'empeche pas l'autre d'etre enregistree. Sur un modele local mono-requête, le
        // runtime serialisera de toute façon les deux appels sans regression de robustesse.
        const hasMetaWork = sourceHints || sourceWaypoints.length > 0;

        // Progression initiale : toutes les phases actives sont 'pending', les autres 'skipped'.
        const progress: TranslationProgress = {
            description: description ? 'pending' : 'skipped',
            hints: sourceHints ? 'pending' : 'skipped',
            waypoints: sourceWaypoints.length > 0 ? 'pending' : 'skipped',
        };
        const reportProgress = (): void => onProgress?.({ ...progress });

        reportProgress();

        const descriptionTask = description
            ? this.runDescriptionTranslation(languageModel, input.geocacheId, description, cancellationToken, (status => {
                progress.description = status;
                reportProgress();
            }))
            : Promise.resolve<DescriptionStepResult>({ kind: 'skipped' });
        const metaTask = hasMetaWork
            ? this.runMetaTranslation(languageModel, input.geocacheId, sourceHints, sourceWaypoints, cancellationToken, ((hintsStatus, waypointStatus) => {
                if (hintsStatus) {
                    progress.hints = hintsStatus;
                }
                if (waypointStatus) {
                    progress.waypoints = waypointStatus;
                }
                reportProgress();
            }))
            : Promise.resolve<MetaStepResult>({ kind: 'skipped' });

        const [descriptionOutcome, metaOutcome] = await Promise.allSettled([descriptionTask, metaTask]);

        const translated: string[] = [];
        const failed: string[] = [];
        let firstError: unknown;

        if (descriptionOutcome.status === 'fulfilled') {
            const result = descriptionOutcome.value;
            if (result.kind === 'done') {
                translated.push('description');
            } else if (result.kind === 'empty') {
                failed.push('description');
            }
            // 'skipped' : rien a signaler
        } else {
            // Une annulation utilisateur n'est pas une erreur: on la remonte immediatement
            // pour que l'appelant puisse l'ignorer sans afficher de message d'erreur.
            if (isCancelled(descriptionOutcome.reason as Error | undefined)) {
                throw descriptionOutcome.reason;
            }
            failed.push('description');
            firstError ??= descriptionOutcome.reason;
            console.error('[GeocacheDetailsTranslationController] echec traduction description', descriptionOutcome.reason);
        }

        if (metaOutcome.status === 'fulfilled') {
            const result = metaOutcome.value;
            if (result.kind === 'done') {
                if (result.translatedHints) {
                    translated.push('indices');
                } else if (sourceHints) {
                    failed.push('indices');
                }
                if (sourceWaypoints.length > 0) {
                    if (result.waypointCount > 0) {
                        translated.push(`notes de waypoints (${result.waypointCount}/${sourceWaypoints.length})`);
                    }
                    const missing = sourceWaypoints.length - result.waypointCount;
                    if (missing > 0) {
                        failed.push(`notes de waypoints (${missing}/${sourceWaypoints.length})`);
                    }
                }
            }
            // 'skipped' : rien a signaler
        } else {
            if (isCancelled(metaOutcome.reason as Error | undefined)) {
                throw metaOutcome.reason;
            }
            if (sourceHints) {
                failed.push('indices');
            }
            if (sourceWaypoints.length > 0) {
                failed.push(`notes de waypoints (${sourceWaypoints.length}/${sourceWaypoints.length})`);
            }
            firstError ??= metaOutcome.reason;
            console.error('[GeocacheDetailsTranslationController] echec traduction hints/waypoints', metaOutcome.reason);
        }

        if (translated.length === 0) {
            // Rien n'a pu etre enregistre: on remonte la premiere cause d'erreur rencontree.
            if (firstError) {
                throw firstError;
            }
            throw new Error(`Traduction IA: reponse vide (${failed.join(', ')})`);
        }

        return { translated, failed };
    }

    private async runDescriptionTranslation(
        languageModel: any,
        geocacheId: number,
        description: string,
        cancellationToken?: CancellationToken,
        onPhaseStatus?: (status: TranslationPhaseStatus) => void
    ): Promise<DescriptionStepResult> {
        const translatedHtml = await this.translateHtmlWithChunking(languageModel, description, cancellationToken);
        // Sans ce garde-fou, une reponse vide (ou reduite a un bloc de raisonnement) serait
        // persistee telle quelle et effacerait la description modifiee existante.
        if (!translatedHtml) {
            onPhaseStatus?.('failed');
            return { kind: 'empty' };
        }
        await this.geocacheDetailsService.updateTranslatedContent(geocacheId, {
            description_override_html: translatedHtml,
            description_override_raw: htmlToRawText(translatedHtml),
        });
        onPhaseStatus?.('done');
        return { kind: 'done' };
    }

    private async runMetaTranslation(
        languageModel: any,
        geocacheId: number,
        sourceHints: string,
        sourceWaypoints: TranslateAllWaypointInput[],
        cancellationToken?: CancellationToken,
        onPhaseStatus?: (hintsStatus: TranslationPhaseStatus | null, waypointStatus: TranslationPhaseStatus | null) => void
    ): Promise<MetaStepResult> {
        const meta = await this.translateHintsAndWaypoints(languageModel, sourceHints, sourceWaypoints, cancellationToken);

        const payload: UpdateTranslatedContentInput = {};
        if (sourceHints && meta.hintsDecoded) {
            payload.hints_decoded_override = meta.hintsDecoded;
        }
        if (meta.waypoints.length > 0) {
            payload.waypoints = meta.waypoints;
        }

        if (Object.keys(payload).length > 0) {
            await this.geocacheDetailsService.updateTranslatedContent(geocacheId, payload);
        }

        onPhaseStatus?.(
            sourceHints ? (meta.hintsDecoded ? 'done' : 'failed') : null,
            sourceWaypoints.length > 0 ? (meta.waypoints.length > 0 ? 'done' : 'failed') : null
        );

        return {
            kind: 'done',
            translatedHints: Boolean(meta.hintsDecoded),
            waypointCount: meta.waypoints.length,
        };
    }

    /** Seuil en deca duquel la description est traduite en un seul appel LLM. */
    private static readonly CHUNK_THRESHOLD = 6000;
    /** Taille cible (en caracteres) d'un chunk lors du decoupage. */
    private static readonly CHUNK_TARGET_SIZE = 4000;
    /** Ratio minimal (texte sortie / texte entree) en deca duquel on suspecte une troncature. */
    private static readonly TRUNCATION_MIN_RATIO = 0.25;
    /** Nombre de retries automatiques sur echec transitoire (reponse vide, JSON invalide). */
    private static readonly LLM_RETRY_COUNT = 1;
    /** Delai (ms) avant un retry, pour laisser le modele local respirer. */
    private static readonly LLM_RETRY_DELAY_MS = 500;

    /**
     * Execute une operation LLM avec retry automatique sur echec transitoire. Les erreurs
     * d'annulation ne sont jamais retentees (on les remonte immediatement). Une reponse vide
     * est consideree comme transitoire : un petit modele local peut renvoyer une reponse vide
     * ou un bloc de raisonnement isole au premier essai, puis reussir au second.
     */
    private async withLlmRetry<T>(
        operation: () => Promise<T>,
        isEmpty: (result: T) => boolean,
        cancellationToken?: CancellationToken
    ): Promise<T> {
        let lastError: unknown;
        for (let attempt = 0; attempt <= GeocacheDetailsTranslationController.LLM_RETRY_COUNT; attempt++) {
            if (cancellationToken?.isCancellationRequested) {
                throw new CancellationError();
            }
            try {
                const result = await operation();
                if (!isEmpty(result)) {
                    return result;
                }
                // Reponse vide : transitoire, on retente si possible.
                lastError = new Error('Traduction IA: reponse vide');
            } catch (error) {
                if (isCancelled(error as Error | undefined)) {
                    throw error;
                }
                lastError = error;
            }
            if (attempt < GeocacheDetailsTranslationController.LLM_RETRY_COUNT) {
                await new Promise(resolve => setTimeout(resolve, GeocacheDetailsTranslationController.LLM_RETRY_DELAY_MS));
            }
        }
        throw lastError instanceof Error ? lastError : new Error('Traduction IA: echec apres retry');
    }

    /**
     * Traduit un fragment HTML, en le decoupant en chunks si il est volumineux. Chaque chunk est
     * traduit separement pour rester sous la limite de generation des petits modeles, puis
     * reassemble. Une detection de troncature (balises non equilibrees + ratio longueur) est
     * appliquee sur chaque chunk : un chunk tronque est rejete plutot que d'enregistrer une
     * traduction amputee.
     *
     * Retourne le HTML traduit reassemble, ou '' si aucun chunk n'a produit de traduction
     * exploitable (pour que l'appelant puisse le comptabiliser comme un echec).
     */
    private async translateHtmlWithChunking(languageModel: any, sourceHtml: string, cancellationToken?: CancellationToken): Promise<string> {
        if (sourceHtml.length <= GeocacheDetailsTranslationController.CHUNK_THRESHOLD) {
            const translated = await this.translateHtmlFragment(languageModel, sourceHtml, 'description', cancellationToken);
            if (!translated || this.detectTruncation(sourceHtml, translated)) {
                return '';
            }
            return translated;
        }

        const chunks = this.splitHtmlIntoChunks(sourceHtml);
        const translatedChunks: string[] = [];
        for (let i = 0; i < chunks.length; i++) {
            if (cancellationToken?.isCancellationRequested) {
                return '';
            }
            const chunkTranslated = await this.translateHtmlFragment(languageModel, chunks[i], `description-chunk-${i}`, cancellationToken);
            if (!chunkTranslated || this.detectTruncation(chunks[i], chunkTranslated)) {
                // Un chunk tronque compromet la coherence du HTML reassemble : on abandonne
                // plutot que de persister une traduction partielle et potentiellement cassee.
                console.warn(`[GeocacheDetailsTranslationController] chunk ${i}/${chunks.length} tronque ou vide, abandon`);
                return '';
            }
            translatedChunks.push(chunkTranslated);
        }
        return translatedChunks.join('');
    }

    /**
     * Decoupe un fragment HTML en chunks aux frontieres des balises de bloc de niveau
     * superieur (</p>, </div>, </table>, </ul>, </ol>, </blockquote>, </h1>-</h6>), en visant
     * CHUNK_TARGET_SIZE caracteres par chunk. Les elements qui ne contiennent pas de balise de
     * bloc (texte libre, <br>, <img>...) restent dans le chunk courant.
     */
    private splitHtmlIntoChunks(html: string): string[] {
        const target = GeocacheDetailsTranslationController.CHUNK_TARGET_SIZE;
        // Frontieres naturelles : fin des balises de bloc les plus courantes.
        const boundaryRegex = /<\/(?:p|div|table|tbody|thead|tfoot|tr|ul|ol|li|blockquote|h[1-6]|section|article|header|footer|nav|aside|figure|figcaption|dl|dt|dd|pre|hr)\s*>/gi;

        const chunks: string[] = [];
        let lastCut = 0;
        let lastBoundary = 0;

        let match: RegExpExecArray | null;
        boundaryRegex.lastIndex = 0;
        while ((match = boundaryRegex.exec(html)) !== null) {
            const boundaryEnd = match.index + match[0].length;
            // Si on a depasse la taille cible depuis la derniere coupe, on coupe ici.
            if (boundaryEnd - lastCut >= target) {
                chunks.push(html.slice(lastCut, boundaryEnd));
                lastCut = boundaryEnd;
            }
            lastBoundary = boundaryEnd;
        }

        // Reste apres la derniere frontiere trouvee.
        if (lastCut < html.length) {
            // Si le reste est petit ou qu'on n'a jamais coupe, on le prend tel quel.
            const tail = html.slice(lastCut);
            if (tail.trim()) {
                chunks.push(tail);
            }
        }

        // Cas degenerate : aucune frontiere trouvee, on n'a qu'un seul chunk trop gros.
        // On le garde tel quel : le modele fera de son mieux, et la detection de troncature
        // le rejetera si necessaire.
        if (chunks.length === 0) {
            chunks.push(html);
        }

        return chunks;
    }

    /**
     * Detecte une traduction probablement tronquee. Deux signaux combines :
     *  1. Balises HTML non equilibrees : on compte les balises ouvrantes (excluant les
     *     self-closing comme <br/>, <img/>, <hr/>) et on compare au nombre de fermantes.
     *  2. Ratio de longueur du texte : si la sortie fait moins de TRUNCATION_MIN_RATIO de
     *     l'entree (en texte brut, pas en HTML), c'est suspect.
     *
     * Retourne true si la traduction semble tronquee.
     */
    private detectTruncation(sourceHtml: string, translatedHtml: string): boolean {
        // Signal 1 : balises non equilibrees dans la traduction.
        const selfClosing = /^(?:br|img|hr|input|meta|link|area|base|col|embed|source|track|wbr)$/i;
        const openTags: string[] = [];
        const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
        let tagMatch: RegExpExecArray | null;
        while ((tagMatch = tagRegex.exec(translatedHtml)) !== null) {
            const tagName = tagMatch[1].toLowerCase();
            const isClosing = tagMatch[0].startsWith('</');
            const isSelfClosing = tagMatch[2] === '/' || selfClosing.test(tagName);
            if (isClosing) {
                // Retirer la derniere balise ouvrante correspondante.
                const idx = openTags.lastIndexOf(tagName);
                if (idx >= 0) {
                    openTags.splice(idx, 1);
                }
            } else if (!isSelfClosing) {
                openTags.push(tagName);
            }
        }
        if (openTags.length > 0) {
            return true;
        }

        // Signal 2 : ratio de longueur du texte anormalement bas.
        const sourceText = htmlToRawText(sourceHtml).trim();
        const translatedText = htmlToRawText(translatedHtml).trim();
        if (sourceText.length > 200 && translatedText.length > 0) {
            const ratio = translatedText.length / sourceText.length;
            if (ratio < GeocacheDetailsTranslationController.TRUNCATION_MIN_RATIO) {
                return true;
            }
        }

        return false;
    }

    private async translateHtmlFragment(languageModel: any, sourceHtml: string, kind: string, cancellationToken?: CancellationToken): Promise<string> {
        return this.withLlmRetry(
            () => this.translateHtmlFragmentOnce(languageModel, sourceHtml, kind, cancellationToken),
            result => !result,
            cancellationToken
        );
    }

    private async translateHtmlFragmentOnce(languageModel: any, sourceHtml: string, kind: string, cancellationToken?: CancellationToken): Promise<string> {
        const language = this.getTargetLanguage();
        const prompt =
            `Tu es un traducteur. Traduis en ${language} le contenu TEXTUEL du HTML fourni, en conservant le HTML.\n`
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
            cancellationToken,
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
        waypoints: TranslateAllWaypointInput[],
        cancellationToken?: CancellationToken
    ): Promise<{ hintsDecoded: string; waypoints: Array<{ id: number; note_override: string }> }> {
        return this.withLlmRetry(
            () => this.translateHintsAndWaypointsOnce(languageModel, hintsDecoded, waypoints, cancellationToken),
            result => !result.hintsDecoded && result.waypoints.length === 0,
            cancellationToken
        );
    }

    private async translateHintsAndWaypointsOnce(
        languageModel: any,
        hintsDecoded: string,
        waypoints: TranslateAllWaypointInput[],
        cancellationToken?: CancellationToken
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
            cancellationToken,
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
        // On ne passe PAS par sanitizeTranslatedHtml ici : DOMPurify echapperait les < et > du
        // JSON et casserait le parsing. On ne retire que les blocs de raisonnement.
        const cleaned = this.stripReasoningBlocks(raw);
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

    /**
     * Nettoie une reponse LLM : retire les blocs de raisonnement (THINK, ANALYSIS) que certains
     * modeles locaux ajoutent, puis applique DOMPurify pour retirer tout contenu dangereux
     * (scripts, event handlers, etc.) par defense en profondeur. Le HTML traduit provient du
     * modele IA, qui a lui-meme recu du HTML tiers de geocaching.com : on ne fait pas confiance
     * a sa sortie sans sanitization, meme si l'affichage passe deja par DOMPurify.
     */
    private sanitizeTranslatedHtml(value: string): string {
        const cleaned = this.stripReasoningBlocks(value);
        // DOMPurify.sanitize sur une chaine vide retourne une chaine vide : pas de risque.
        // On garde ALLOW_DATA_ATTR et les attributs courants (class, id, href, src, alt, etc.)
        // pour ne pas casser la structure HTML legitime des descriptions de geocaches.
        return DOMPurify.sanitize(cleaned, {
            ALLOWED_URI_REGEXP: /^(?:(?:https?|ftp|mailto|tel|file|data):|[^a-z]|a)/i,
            ALLOW_DATA_ATTR: true,
        }).trim();
    }

    /**
     * Retire uniquement les blocs de raisonnement (THINK, ANALYSIS) sans appliquer DOMPurify.
     * Utilise pour nettoyer le JSON brut avant parsing : DOMPurify echapperait les < et > et
     * casserait le JSON.
     */
    private stripReasoningBlocks(value: string): string {
        return (value || '')
            .toString()
            .replace(/\[THINK\][\s\S]*?\[\/THINK\]/gi, '')
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/\[ANALYSIS\][\s\S]*?\[\/ANALYSIS\]/gi, '')
            .replace(/<analysis>[\s\S]*?<\/analysis>/gi, '')
            .trim();
    }

    private createHintsWaypointsPrompt(): string {
        const language = this.getTargetLanguage();
        return `Traduis en ${language} le contenu suivant et renvoie UNIQUEMENT un JSON valide.\n`
            + 'Contraintes :\n'
            + '- hints_decoded : traduis le texte de l indice.\n'
            + '- Ne traduis pas les coordonnees, codes GC, URLs, ni les identifiants techniques.\n'
            + '- waypoints : conserve les ids, traduis uniquement la note.\n'
            + 'Schema JSON de sortie : {"hints_decoded": string, "waypoints": [{"id": number, "note": string}] }\n';
    }
}
