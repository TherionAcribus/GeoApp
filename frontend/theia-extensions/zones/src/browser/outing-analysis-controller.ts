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
    OUTING_DETAIL_LEVEL_PREF,
    OUTING_GEAR_LOGS_PREF,
    OUTING_RECENT_LOGS_PREF,
    OUTING_WARN_ABOVE_PREF,
    OutingAnalysisBundle,
    OutingDetailLevel,
} from './outing-analysis-types';

export interface OutingAnalysisRequest {
    /** Nom de zone ou de contexte, repris dans le titre de session. */
    zoneName?: string;
    detailLevel?: OutingDetailLevel;
    /**
     * Date de la sortie ; par défaut le jour même.
     *
     * Elle ne sert pas qu'à titrer la session : le backend en tire l'heure du coucher du
     * soleil, qui borne toute la planification. Une sortie préparée le mercredi pour le
     * samedi n'a pas la même journée devant elle.
     */
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

        // La date d'abord : c'est la question à laquelle l'utilisateur répond sans y
        // penser, et celle qui change le plus le rapport (la lumière du jour en dépend).
        const outingDate = request.outingDate ?? await this.pickOutingDate(ids.length);
        if (!outingDate) {
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
                { ...request, detailLevel, outingDate },
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
     * Choix de la date de sortie.
     *
     * Trois raccourcis couvrent la quasi-totalité des cas — on prépare une sortie la
     * veille au soir ou le matin même — et la saisie libre reste ouverte pour le week-end
     * prochain. La date décide de l'heure du coucher du soleil : la laisser implicitement
     * à « aujourd'hui », comme c'était le cas jusqu'ici, revenait à donner la mauvaise
     * durée de journée à toute sortie préparée à l'avance.
     */
    protected async pickOutingDate(count: number): Promise<Date | undefined> {
        const shortcuts = [0, 1, 2].map(offset => {
            const day = this.addDays(new Date(), offset);
            return {
                label: ["Aujourd'hui", 'Demain', 'Après-demain'][offset],
                description: this.describeDate(day),
                value: offset,
            };
        });

        const picked = await this.quickInputService.pick(
            [...shortcuts, { label: 'Autre date…', description: 'Saisir une date au format AAAA-MM-JJ', value: -1 }],
            {
                title: `Analyser ${count} géocache${count > 1 ? 's' : ''} avec l'IA`,
                placeHolder: 'Date de la sortie (elle décide de la lumière du jour disponible)',
            }
        );

        if (!picked) {
            return undefined;
        }
        if (picked.value >= 0) {
            return this.addDays(new Date(), picked.value);
        }

        const raw = await this.quickInputService.input({
            title: 'Date de la sortie',
            prompt: 'Format AAAA-MM-JJ',
            value: this.formatDate(new Date()),
            ignoreFocusLost: true,
            validateInput: async input =>
                (this.parseDate(input) ? undefined : 'Date invalide (attendu : AAAA-MM-JJ)'),
        });

        return this.parseDate(raw);
    }

    /**
     * Lecture d'une date saisie, en heure **locale**.
     *
     * `new Date('2026-09-05')` serait interprétée en UTC et pourrait retomber la veille
     * une fois reformatée : on construit donc la date composant par composant. Le contrôle
     * de cohérence attrape le 31 février, que le constructeur accepterait en glissant.
     */
    protected parseDate(raw: string | undefined): Date | undefined {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((raw || '').trim());
        if (!match) {
            return undefined;
        }
        const [year, month, day] = match.slice(1).map(Number);
        const parsed = new Date(year, month - 1, day);
        const valid = parsed.getFullYear() === year
            && parsed.getMonth() === month - 1
            && parsed.getDate() === day;
        return valid ? parsed : undefined;
    }

    protected addDays(from: Date, days: number): Date {
        const shifted = new Date(from.getTime());
        shifted.setDate(shifted.getDate() + days);
        return shifted;
    }

    /** Libellé lisible d'une date, pour le picker : « samedi 5 septembre ». */
    protected describeDate(date: Date): string {
        try {
            return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
        } catch {
            // Environnement sans données de locale : la date ISO reste lisible.
            return this.formatDate(date);
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
        const outingDate = this.formatDate(request.outingDate);

        const bundle = await this.geocachesService.fetchAnalysisBundle(
            ids,
            {
                listingChars: preset.listingChars,
                recentLogsCount: this.readNumber(OUTING_RECENT_LOGS_PREF, preset.recentLogsCount),
                gearLogsCount: this.readNumber(OUTING_GEAR_LOGS_PREF, preset.gearLogsCount),
                // Le serveur en a besoin autant que le prompt : c'est lui qui calcule
                // l'heure du coucher du soleil à cette date.
                outingDate,
            },
            signal
        );

        const prompt = buildOutingAnalysisPrompt(bundle, {
            zoneName: request.zoneName,
            outingDate,
            detailLevel,
        });
        const promptSize = estimateOutingPromptSize(prompt);

        this.openChatSession({
            sessionTitle: this.buildSessionTitle(bundle, outingDate, request.zoneName),
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
    protected buildSessionTitle(
        bundle: OutingAnalysisBundle,
        outingDate: string,
        zoneName?: string
    ): string {
        const zone = zoneName?.trim() || 'sélection';
        return `SORTIE - ${zone} - ${outingDate} (${bundle.geocaches.length} caches)`;
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

        // Le seul avertissement sur lequel l'utilisateur peut encore agir avant l'envoi :
        // une cache déjà trouvée se retire de la sélection en deux clics, et l'analyse
        // coûte alors moins cher.
        if (bundle.already_found.length > 0) {
            const codes = bundle.already_found.slice(0, 5).join(', ');
            const rest = bundle.already_found.length > 5
                ? ` et ${bundle.already_found.length - 5} autre(s)`
                : '';
            warnings.push(
                `${bundle.already_found.length} géocache(s) déjà trouvée(s) dans la sélection `
                + `(${codes}${rest}) : à retirer, sauf si c'est voulu.`
            );
        }

        if (bundle.stale_logs.length > 0) {
            warnings.push(
                `${bundle.stale_logs.length} géocache(s) dont les logs locaux datent de plus de `
                + `six mois : leur santé décrit la date de collecte, pas l'état actuel.`
            );
        }

        if (bundle.missing.length > 0) {
            warnings.push(`${bundle.missing.length} géocache(s) introuvable(s) en base, ignorée(s).`);
        }

        // Une cache sans coordonnées est un trou de données, pas un choix : elle disparaît
        // de l'ordre de visite et des distances sans que rien ne le montre à l'écran.
        const withoutCoordinates = (bundle.geography?.excluded || [])
            .filter(item => item.reason === 'no_coordinates');
        if (withoutCoordinates.length > 0) {
            warnings.push(
                `${withoutCoordinates.length} géocache(s) sans coordonnées en base `
                + `(${withoutCoordinates.map(item => item.gc_code).join(', ')}) : absentes de `
                + `l'ordre de visite et des distances.`
            );
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
