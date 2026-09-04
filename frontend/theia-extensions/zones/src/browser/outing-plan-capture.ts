/**
 * Capture du rapport de sortie : comment le plan sort de la conversation.
 *
 * Deux voies, dans cet ordre.
 *
 * 1. **Le tool `save_outing_plan`**, que le prompt système impose d'appeler à la fin du
 *    rapport. C'est la voie normale : les arguments sont un objet JSON typé, ils arrivent
 *    une seule fois, et le front peut réagir immédiatement.
 * 2. **Le bloc ```json en fin de réponse**, repêché a posteriori. C'est le filet : un
 *    modèle peut oublier le tool, une policy peut le retirer, une session peut être
 *    reprise sur un autre agent. Le prompt système demande donc les deux, et la deuxième
 *    voie ne coûte rien quand la première a fonctionné — la capture est idempotente.
 *
 * Une chose n'est **jamais** demandée au modèle : l'identité de la sortie. Zone et date
 * sont connues de façon certaine côté front, au moment où l'analyse est lancée ; les faire
 * recopier par une IA introduirait la seule erreur capable de casser l'appariement des
 * plans. Le contrôleur enregistre donc son contexte ici avant d'ouvrir la session, et la
 * capture le retrouve.
 */

import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core';
import { OutingPlanService } from './outing-plan-service';
import { OutingPlanRecord } from './outing-plan-types';

/** Ce que le front sait de la sortie, et que le modèle n'a pas à savoir. */
export interface OutingCaptureContext {
    zoneName: string;
    /** Format `AAAA-MM-JJ`, le même que le titre de session. */
    outingDate: string;
    gcCodes: string[];
    registeredAt: number;
}

export interface OutingCaptureResult {
    plan: OutingPlanRecord;
    warnings: string[];
    source: 'tool' | 'parsed' | 'manual';
}

/**
 * Nombre de contextes gardés en mémoire.
 *
 * Une poignée suffit : on prépare une sortie, parfois deux, rarement plus dans la même
 * session de travail. Au-delà, le plus ancien est oublié — et un plan capturé sans
 * contexte retombe sur la date que le modèle a recopiée, qui est le moins mauvais recours.
 */
const MAX_REMEMBERED_CONTEXTS = 8;

@injectable()
export class OutingPlanCaptureService {

    @inject(OutingPlanService)
    protected readonly planService!: OutingPlanService;

    protected readonly contexts: OutingCaptureContext[] = [];

    protected readonly onDidCaptureEmitter = new Emitter<OutingCaptureResult>();

    /** Émis à chaque capture réussie : le panneau s'ouvre là-dessus. */
    get onDidCapture(): Event<OutingCaptureResult> {
        return this.onDidCaptureEmitter.event;
    }

    /** Appelé par le contrôleur juste avant d'ouvrir la session de chat. */
    registerOuting(context: Omit<OutingCaptureContext, 'registeredAt'>): void {
        const entry: OutingCaptureContext = {
            zoneName: context.zoneName || '',
            outingDate: context.outingDate,
            gcCodes: Array.from(new Set((context.gcCodes || []).map(code => code.toUpperCase()))),
            registeredAt: Date.now(),
        };

        const sameOuting = this.contexts.findIndex(
            candidate => candidate.zoneName === entry.zoneName
                && candidate.outingDate === entry.outingDate
        );
        if (sameOuting >= 0) {
            this.contexts.splice(sameOuting, 1);
        }

        this.contexts.unshift(entry);
        this.contexts.splice(MAX_REMEMBERED_CONTEXTS);
    }

    /** Les sorties connues, de la plus récemment lancée à la plus ancienne. */
    knownContexts(): readonly OutingCaptureContext[] {
        return this.contexts;
    }

    /**
     * À quelle sortie rattacher un plan.
     *
     * Trois critères, du plus sûr au plus faible : la date annoncée par le modèle si elle
     * correspond à une sortie lancée, sinon le recouvrement de codes GC le plus large,
     * sinon la dernière sortie lancée. Le dernier critère est presque toujours le bon —
     * une analyse répond dans la minute — mais il ne l'est plus quand deux analyses se
     * chevauchent, d'où les deux premiers.
     */
    resolveContext(
        planCodes: string[],
        outingDateHint?: string
    ): OutingCaptureContext | undefined {
        if (this.contexts.length === 0) {
            return undefined;
        }

        if (outingDateHint) {
            const dated = this.contexts.find(context => context.outingDate === outingDateHint);
            if (dated) {
                return dated;
            }
        }

        const codes = new Set((planCodes || []).map(code => (code || '').toUpperCase()));
        if (codes.size > 0) {
            let best: OutingCaptureContext | undefined;
            let bestOverlap = 0;
            for (const context of this.contexts) {
                const overlap = context.gcCodes.filter(code => codes.has(code)).length;
                if (overlap > bestOverlap) {
                    best = context;
                    bestOverlap = overlap;
                }
            }
            if (best) {
                return best;
            }
        }

        return this.contexts[0];
    }

    /**
     * Enregistre un plan brut.
     *
     * `rawPlan` est ce que le modèle a produit : il n'est pas validé ici, mais côté
     * serveur, qui est le seul endroit où les deux voies de capture se rejoignent.
     */
    async capture(
        rawPlan: unknown,
        options: {
            source: 'tool' | 'parsed' | 'manual';
            markdown?: string;
            modelName?: string;
            outingDateHint?: string;
            zoneNameHint?: string;
        }
    ): Promise<OutingCaptureResult> {
        const planCodes = collectPlanCodes(rawPlan);
        const context = this.resolveContext(planCodes, options.outingDateHint);

        const outingDate = context?.outingDate
            ?? (isIsoDate(options.outingDateHint) ? options.outingDateHint! : todayIsoDate());
        const zoneName = context?.zoneName ?? (options.zoneNameHint || '');
        const gcCodes = context?.gcCodes?.length ? context.gcCodes : planCodes;

        const saved = await this.planService.savePlan({
            zoneName,
            outingDate,
            gcCodes,
            plan: rawPlan,
            markdown: options.markdown,
            source: options.source,
            modelName: options.modelName,
        });

        const result: OutingCaptureResult = {
            plan: saved.plan,
            warnings: saved.warnings || [],
            source: options.source,
        };
        this.onDidCaptureEmitter.fire(result);
        return result;
    }
}

/**
 * Repêche le bloc de plan dans un rapport Markdown.
 *
 * Le prompt système demande un bloc ` ```json ` en toute fin de réponse. On accepte plus
 * large que ce qui est demandé — n'importe quelle clôture de bloc, n'importe où dans le
 * texte — et on retient le **dernier** candidat qui ressemble à un plan : un rapport peut
 * légitimement citer d'autres JSON en chemin, et le bloc de sortie est par contrat le
 * dernier. Renvoie `undefined` plutôt que de lever : l'absence de bloc est le cas normal
 * quand le tool a fait son travail.
 */
export function extractOutingPlanBlock(markdown: string): unknown | undefined {
    if (!markdown) {
        return undefined;
    }

    const fence = /```(?:json|geoapp-outing)?\s*\n([\s\S]*?)\n?```/gi;
    const candidates: unknown[] = [];

    let match = fence.exec(markdown);
    while (match) {
        const parsed = tryParseJson(match[1]);
        if (looksLikePlan(parsed)) {
            candidates.push(parsed);
        }
        match = fence.exec(markdown);
    }

    if (candidates.length > 0) {
        return candidates[candidates.length - 1];
    }

    // Bloc non clôturé : la réponse s'est arrêtée sur la dernière accolade. Le cas se
    // produit quand la génération est coupée juste avant les trois back-quotes finales.
    const opened = markdown.lastIndexOf('```json');
    if (opened >= 0) {
        const tail = markdown.slice(opened + '```json'.length);
        const parsed = tryParseJson(tail.replace(/```\s*$/, ''));
        if (looksLikePlan(parsed)) {
            return parsed;
        }
    }

    return undefined;
}

function tryParseJson(raw: string): unknown {
    const trimmed = (raw || '').trim();
    if (!trimmed.startsWith('{')) {
        return undefined;
    }
    try {
        return JSON.parse(trimmed);
    } catch {
        return undefined;
    }
}

/** Un objet est un plan s'il porte au moins une des trois sections structurantes. */
function looksLikePlan(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return Array.isArray(candidate.checklist)
        || Array.isArray(candidate.alerts)
        || Array.isArray(candidate.per_cache);
}

/** Tous les codes GC cités par un plan brut, quelle que soit la section. */
export function collectPlanCodes(rawPlan: unknown): string[] {
    if (!rawPlan || typeof rawPlan !== 'object') {
        return [];
    }
    const plan = rawPlan as Record<string, unknown>;
    const codes = new Set<string>();

    const add = (value: unknown) => {
        if (typeof value === 'string') {
            const code = value.trim().toUpperCase();
            if (/^GC[A-Z0-9]{1,12}$/.test(code)) {
                codes.add(code);
            }
        }
    };

    for (const entry of asArray(plan.per_cache)) {
        add((entry as Record<string, unknown>)?.gc_code);
    }
    for (const entry of asArray(plan.alerts)) {
        add((entry as Record<string, unknown>)?.gc_code);
    }
    for (const entry of asArray(plan.checklist)) {
        for (const code of asArray((entry as Record<string, unknown>)?.gc_codes)) {
            add(code);
        }
    }
    for (const code of asArray(plan.order)) {
        add(code);
    }

    return Array.from(codes);
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function isIsoDate(value: string | undefined): boolean {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function todayIsoDate(): string {
    const now = new Date();
    const month = `${now.getMonth() + 1}`.padStart(2, '0');
    const day = `${now.getDate()}`.padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
}
