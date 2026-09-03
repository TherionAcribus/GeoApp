/**
 * Enchaînement de l'analyse IA d'une sortie, partagé par les deux points d'entrée.
 *
 * La table de zone déclenche l'analyse sur une sélection, le log-editor sur la totalité
 * de sa liste : deux gestes, une seule logique. Ce contrôleur la porte, pour que les
 * widgets n'aient plus qu'à fournir des identifiants et à afficher les avertissements.
 *
 * Deux niveaux, volontairement séparés :
 *
 * - `analyze()` ne touche à aucune UI — collecte, prompt, ouverture de session. C'est la
 *   partie testable, et celle qu'appellerait un futur point d'entrée non interactif.
 * - `runInteractive()` ajoute le choix du niveau de détail, la progression annulable et
 *   l'affichage des avertissements. Les deux widgets passent par là : dupliquer cette
 *   glue des deux côtés aurait coûté plus cher que de la porter ici, d'autant que le
 *   log-editor n'a pas de `QuickInputService` injecté.
 */

import { inject, injectable } from '@theia/core/shared/inversify';
import { MessageService } from '@theia/core';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { QuickInputService } from '@theia/core/lib/common/quick-pick-service';
import { GeocachesService } from './geocaches-service';
import {
    dispatchGeoAppOpenChatRequest,
    GeoAppOpenChatRequestDetailPayload,
} from './geoapp-chat-shared';
import { buildOutingAnalysisPrompt, estimateOutingPromptSize } from './outing-analysis-prompt';
import {
    GEOAPP_OUTING_ANALYZER_AGENT_ID,
    MAX_OUTING_ANALYSIS_GEOCACHES,
    OUTING_DETAIL_PRESETS,
    OutingAnalysisBundle,
    OutingDetailLevel,
} from './outing-analysis-types';

export const OUTING_DETAIL_LEVEL_PREF = 'geoApp.outing.analysis.detailLevel';
export const OUTING_RECENT_LOGS_PREF = 'geoApp.outing.analysis.recentLogsCount';
export const OUTING_GEAR_LOGS_PREF = 'geoApp.outing.analysis.gearLogsCount';
export const OUTING_WARN_ABOVE_PREF = 'geoApp.outing.analysis.warnAboveCount';

export interface OutingAnalysisRequest {
    /** Nom de zone ou de contexte, repris dans le titre de session. */
    zoneName?: string;
    detailLevel?: OutingDetailLevel;
    /** Date de la sortie ; par défaut le jour même. */
    outingDate?: Date;
}

export interface OutingAnalysisOutcome {
    /** Faux quand rien n'a été envoyé au chat (sélection vide, plafond dépassé). */
    started: boolean;
    /** Nombre de géocaches effectivement transmises. */
    analyzed: number;
    /** À afficher par l'appelant : données manquantes, volume, identifiants introuvables. */
    warnings: string[];
    /** Absent quand `started` est faux. */
    promptSize?: { chars: number; approxTokens: number };
}

@injectable()
export class OutingAnalysisController {

    @inject(GeocachesService)
    protected readonly geocachesService!: GeocachesService;

    @inject(PreferenceService)
    protected readonly preferenceService!: PreferenceService;

    @inject(MessageService)
    protected readonly messages!: MessageService;

    @inject(QuickInputService)
    protected readonly quickInputService!: QuickInputService;

    /**
     * Parcours complet depuis un widget : choix du détail, progression, avertissements.
     *
     * Renvoie l'issue pour que l'appelant puisse piloter son propre indicateur d'attente.
     * Une annulation utilisateur — au choix du détail ou pendant la collecte — ressort
     * comme un `started: false` sans avertissement : rien à signaler, c'est voulu.
     */
    async runInteractive(
        geocacheIds: number[],
        request: OutingAnalysisRequest = {}
    ): Promise<OutingAnalysisOutcome> {
        const ids = Array.from(new Set(geocacheIds || []));

        if (ids.length === 0) {
            this.messages.warn('Aucune géocache à analyser.');
            return { started: false, analyzed: 0, warnings: [] };
        }

        if (ids.length > MAX_OUTING_ANALYSIS_GEOCACHES) {
            this.messages.error(
                `${ids.length} géocaches sélectionnées : l'analyse IA est limitée à `
                + `${MAX_OUTING_ANALYSIS_GEOCACHES}. Réduis la sélection.`
            );
            return { started: false, analyzed: 0, warnings: [] };
        }

        const detailLevel = request.detailLevel ?? await this.pickDetailLevel(ids.length);
        if (!detailLevel) {
            return { started: false, analyzed: 0, warnings: [] };
        }

        const abortController = new AbortController();
        const progress = await this.messages.showProgress(
            {
                text: `Analyse IA de ${ids.length} géocache${ids.length > 1 ? 's' : ''}`,
                options: { cancelable: true, location: 'notification' },
            },
            () => abortController.abort()
        );
        progress.report({ message: 'Collecte des listings, attributs et logs…' });

        try {
            const outcome = await this.analyze(
                ids,
                { ...request, detailLevel },
                abortController.signal
            );

            outcome.warnings.forEach(warning => this.messages.warn(warning));

            if (outcome.started) {
                this.messages.info(
                    `Analyse envoyée au Chat IA : ${outcome.analyzed} géocache(s), `
                    + `~${outcome.promptSize?.approxTokens} tokens.`
                );
            }

            return outcome;
        } catch (error) {
            if ((error as Error)?.name === 'AbortError') {
                this.messages.warn('Analyse IA annulée');
                return { started: false, analyzed: 0, warnings: [] };
            }
            console.error('[OutingAnalysisController] Analyse IA échouée', error);
            this.messages.error(
                `Impossible de préparer l'analyse IA : ${(error as Error)?.message ?? error}`
            );
            return { started: false, analyzed: 0, warnings: [] };
        } finally {
            progress.cancel();
        }
    }

    /**
     * Choix du niveau de détail.
     *
     * Le défaut des préférences est présenté en premier et marqué comme tel : sur une
     * grosse sélection, c'est là qu'on bascule en « léger » en connaissance de cause.
     */
    protected async pickDetailLevel(count: number): Promise<OutingDetailLevel | undefined> {
        const preferred = this.readDetailLevel();
        const options: Array<{ level: OutingDetailLevel; label: string; description: string }> = [
            {
                level: 'standard',
                label: 'Standard',
                description: 'Listing tronqué, 5 logs récents — le bon compromis',
            },
            {
                level: 'light',
                label: 'Léger',
                description: 'Sans listing : attributs, hint et logs seulement',
            },
            {
                level: 'full',
                label: 'Complet',
                description: 'Listing long, 10 logs récents — réponse plus lente et coûteuse',
            },
        ];

        const picks = options
            .sort((a, b) => (a.level === preferred ? -1 : b.level === preferred ? 1 : 0))
            .map(option => ({
                label: option.level === preferred ? `${option.label} (défaut)` : option.label,
                description: option.description,
                value: option.level,
            }));

        const picked = await this.quickInputService.pick(picks, {
            title: `Analyser ${count} géocache${count > 1 ? 's' : ''} avec l'IA`,
            placeHolder: 'Niveau de détail transmis au modèle',
        });

        return picked?.value;
    }

    async analyze(
        geocacheIds: number[],
        request: OutingAnalysisRequest = {},
        signal?: AbortSignal
    ): Promise<OutingAnalysisOutcome> {
        const ids = Array.from(new Set(geocacheIds || []));

        if (ids.length === 0) {
            return { started: false, analyzed: 0, warnings: ['Aucune géocache à analyser.'] };
        }

        if (ids.length > MAX_OUTING_ANALYSIS_GEOCACHES) {
            return {
                started: false,
                analyzed: 0,
                warnings: [
                    `${ids.length} géocaches sélectionnées : l'analyse IA est limitée à `
                    + `${MAX_OUTING_ANALYSIS_GEOCACHES}. Réduis la sélection.`,
                ],
            };
        }

        const detailLevel = request.detailLevel ?? this.readDetailLevel();
        const preset = OUTING_DETAIL_PRESETS[detailLevel];

        const bundle = await this.geocachesService.fetchAnalysisBundle(
            ids,
            {
                listingChars: preset.listingChars,
                recentLogsCount: this.readNumber(OUTING_RECENT_LOGS_PREF, preset.recentLogsCount),
                gearLogsCount: this.readNumber(OUTING_GEAR_LOGS_PREF, preset.gearLogsCount),
            },
            signal
        );

        const prompt = buildOutingAnalysisPrompt(bundle, {
            zoneName: request.zoneName,
            outingDate: this.formatDate(request.outingDate),
            detailLevel,
        });
        const promptSize = estimateOutingPromptSize(prompt);

        this.openChatSession({
            sessionTitle: this.buildSessionTitle(bundle, request),
            prompt,
            focus: true,
            workflowKind: 'general',
            sessionKind: 'libre',
            preferredAgentId: GEOAPP_OUTING_ANALYZER_AGENT_ID,
        });

        return {
            started: true,
            analyzed: bundle.geocaches.length,
            warnings: this.collectWarnings(bundle),
            promptSize,
        };
    }

    /**
     * Ouverture de la session Chat.
     *
     * Isolée dans sa propre méthode pour que les tests puissent l'intercepter sans avoir
     * à simuler `window` ni `CustomEvent`.
     */
    protected openChatSession(detail: GeoAppOpenChatRequestDetailPayload): void {
        dispatchGeoAppOpenChatRequest(window, CustomEvent, detail);
    }

    /**
     * Titre de session.
     *
     * Il porte la date : sans `geocacheId` ni `gcCode`, le bridge apparie les sessions
     * sur ce titre. Deux analyses de la même zone le même jour reprennent donc la même
     * conversation — ce qui est le comportement voulu — et le lendemain en ouvre une neuve.
     */
    protected buildSessionTitle(bundle: OutingAnalysisBundle, request: OutingAnalysisRequest): string {
        const zone = request.zoneName?.trim() || 'sélection';
        const date = this.formatDate(request.outingDate);
        return `SORTIE - ${zone} - ${date} (${bundle.geocaches.length} caches)`;
    }

    protected collectWarnings(bundle: OutingAnalysisBundle): string[] {
        const warnings: string[] = [];

        if (bundle.without_local_logs.length > 0) {
            const codes = bundle.without_local_logs.slice(0, 5).join(', ');
            const rest = bundle.without_local_logs.length > 5
                ? ` et ${bundle.without_local_logs.length - 5} autre(s)`
                : '';
            warnings.push(
                `${bundle.without_local_logs.length} géocache(s) sans logs locaux (${codes}${rest}) : `
                + `l'analyse sera partielle pour celles-ci.`
            );
        }

        if (bundle.missing.length > 0) {
            warnings.push(`${bundle.missing.length} géocache(s) introuvable(s) en base, ignorée(s).`);
        }

        const warnAbove = this.readNumber(OUTING_WARN_ABOVE_PREF, 25);
        if (bundle.geocaches.length > warnAbove) {
            warnings.push(
                `${bundle.geocaches.length} géocaches transmises : la réponse peut être longue `
                + `et coûteuse. Le mode « léger » réduit nettement le volume.`
            );
        }

        return warnings;
    }

    protected readDetailLevel(): OutingDetailLevel {
        const raw = this.preferenceService.get<string>(OUTING_DETAIL_LEVEL_PREF, 'standard');
        return raw === 'light' || raw === 'full' ? raw : 'standard';
    }

    protected readNumber(preference: string, fallback: number): number {
        const raw = this.preferenceService.get<number>(preference, fallback);
        return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
    }

    /** Date au format ISO court : stable, donc appariable d'une session à l'autre. */
    protected formatDate(date?: Date): string {
        const value = date ?? new Date();
        const month = `${value.getMonth() + 1}`.padStart(2, '0');
        const day = `${value.getDate()}`.padStart(2, '0');
        return `${value.getFullYear()}-${month}-${day}`;
    }
}
