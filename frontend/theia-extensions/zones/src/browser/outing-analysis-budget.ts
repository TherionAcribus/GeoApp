/**
 * Budget de tokens de l'analyse de sortie : qui mérite son listing, et que sacrifier
 * quand le plafond est atteint.
 *
 * Jusqu'ici, un seul niveau de détail s'appliquait à toute la sélection. C'est le mauvais
 * découpage : l'information n'est pas répartie uniformément dans un lot de géocaches. Une
 * traditionnelle D1/T1 saine, trouvée la semaine dernière, n'a rien à dire que ses
 * attributs ne disent déjà — son listing coûte huit cents tokens pour confirmer qu'il n'y
 * a rien à confirmer. La T5 voisine, avec un drapeau « outil spécial » NON RÉSOLU, ne se
 * prépare pas sans son texte. Un budget uniforme choisit donc toujours mal : trop cher
 * pour les unes, trop pauvre pour les autres.
 *
 * D'où deux décisions séparées :
 *
 * 1. **le palier par cache** (`decideTier`) : la cache pose-t-elle une question ? Le
 *    balayage lexical du lot 7 est ce qui rend le palier `lean` acceptable — le matériel
 *    nommé dans le listing complet remonte de toute façon, même quand le listing lui-même
 *    n'est pas transmis ;
 * 2. **le plafond dur** (`buildBudgetedOutingPrompt`) : le prompt système compris, on
 *    reste sous N tokens, en rétrogradant par étapes ordonnées de la moins coûteuse à la
 *    plus douloureuse.
 *
 * Fonctions pures, sans dépendance Theia : testables telles quelles.
 */

import {
    buildOutingAnalysisPrompt,
    estimateOutingPromptSize,
    OutingPromptContext,
    OutingPromptSize,
} from './outing-analysis-prompt';
import {
    OUTING_DEFAULT_MAX_PROMPT_TOKENS,
    OUTING_TIER_PRESETS,
    OutingAnalysisBundle,
    OutingAnalysisGeocache,
    OutingCacheTier,
    OutingDetailLevel,
    OutingPromptPlan,
} from './outing-analysis-types';

/** Décision de palier pour une géocache, avec ce qui l'a motivée. */
export interface OutingTierDecision {
    gc_code: string;
    tier: OutingCacheTier;
    /** Motifs d'enrichissement, en clair. Vide pour une cache `lean`. */
    reasons: string[];
    /**
     * Somme des poids des motifs.
     *
     * Elle ne sert qu'à une chose : décider **qui perd son listing en premier** sous le
     * plafond. Une cache à un seul motif faible passe avant une cache qui en cumule trois.
     */
    priority: number;
}

/**
 * Signaux contextuels dont le listing porte la contrainte.
 *
 * Tous les signaux de contexte ne se valent pas : « park & grab » ou « chiens admis »
 * n'appellent aucune lecture, tandis que « challenge », « partenariat » ou « pas
 * accessible 24 h/24 » désignent une condition dont l'énoncé n'existe que dans le texte.
 */
const CONSTRAINT_CONTEXT_SIGNALS = new Set([
    'challenge',
    'partnership',
    'not_available_24h',
    'fee',
    'risk',
    'bonus',
    'hike_long',
]);

/** Types dont le déroulé — étapes, contenants successifs — vit dans le listing. */
const MULTI_STEP_TYPES = ['multi', 'letterbox', 'wherigo', 'earth'];

interface TierRule {
    id: string;
    weight: number;
    reason: string;
    test(geocache: OutingAnalysisGeocache): boolean;
}

function hasUnresolvedGear(geocache: OutingAnalysisGeocache): boolean {
    return (geocache.gear_signals || []).some(
        signal => signal.kind === 'gear' && !signal.resolved && !signal.is_negative
    );
}

function constraintContext(geocache: OutingAnalysisGeocache): string[] {
    return (geocache.gear_signals || [])
        .filter(signal => CONSTRAINT_CONTEXT_SIGNALS.has(signal.signal))
        .map(signal => signal.signal);
}

function isMultiStep(geocache: OutingAnalysisGeocache): boolean {
    const type = (geocache.type || '').toLowerCase();
    return MULTI_STEP_TYPES.some(key => type.includes(key));
}

/**
 * Règles d'enrichissement, du motif le plus décisif au plus circonstanciel.
 *
 * Les poids ne sont pas des probabilités, seulement un ordre : ils disent laquelle de deux
 * caches signalées garde son listing quand il faut en sacrifier une. Un drapeau non résolu
 * passe avant tout le reste, parce que c'est le seul cas où l'absence de texte rend la
 * réponse *impossible* plutôt que moins fine.
 */
const TIER_RULES: TierRule[] = [
    {
        id: 'unresolved_gear',
        weight: 100,
        reason: 'drapeau matériel non résolu',
        test: hasUnresolvedGear,
    },
    {
        id: 'health_very_risky',
        weight: 70,
        reason: 'santé très risquée',
        test: geocache => geocache.health?.level === 'very_risky',
    },
    {
        id: 'health_risky',
        weight: 55,
        reason: 'santé risquée',
        test: geocache => geocache.health?.level === 'risky',
    },
    {
        id: 'logging_tasks',
        weight: 50,
        reason: 'questions à répondre sur place',
        test: geocache => (geocache.logging_tasks_count || 0) > 0,
    },
    {
        id: 'health_unknown',
        weight: 45,
        reason: 'aucun log local : le listing est la seule source',
        test: geocache => geocache.health?.level === 'unknown',
    },
    {
        id: 'multi_step',
        weight: 40,
        reason: 'cache à étapes',
        test: isMultiStep,
    },
    {
        id: 'health_watch',
        weight: 30,
        reason: 'santé à surveiller',
        test: geocache => geocache.health?.level === 'watch',
    },
    {
        id: 'constraint_context',
        weight: 30,
        reason: 'contrainte de contexte',
        test: geocache => constraintContext(geocache).length > 0,
    },
    {
        id: 'high_terrain',
        weight: 25,
        reason: 'terrain élevé',
        test: geocache => (geocache.terrain || 0) >= 3.5,
    },
    {
        id: 'high_difficulty',
        weight: 20,
        reason: 'difficulté élevée',
        test: geocache => (geocache.difficulty || 0) >= 3.5,
    },
    {
        id: 'low_confidence',
        weight: 15,
        reason: 'estimation de temps peu fiable',
        test: geocache => geocache.time_estimate?.confidence === 'low',
    },
];

/**
 * Palier d'une géocache.
 *
 * Une mystery non résolue n'est volontairement pas un motif d'enrichissement : on n'ira
 * pas, et son listing est justement le plus long et le moins exploitable du lot. Le
 * rapport doit dire « résous-la d'abord », ce qu'il sait déjà sans lire l'énigme. Une
 * cache déjà trouvée non plus, pour la même raison inversée : elle sort de la sortie.
 */
export function decideTier(geocache: OutingAnalysisGeocache): OutingTierDecision {
    const fired = TIER_RULES.filter(rule => {
        try {
            return rule.test(geocache);
        } catch {
            // Bundle plus ancien que le front : un champ manquant ne doit pas casser le plan.
            return false;
        }
    });

    return {
        gc_code: geocache.gc_code,
        tier: fired.length > 0 ? 'rich' : 'lean',
        reasons: fired.map(rule => rule.reason),
        priority: fired.reduce((total, rule) => total + rule.weight, 0),
    };
}

export function decideTiers(bundle: OutingAnalysisBundle): OutingTierDecision[] {
    return (bundle.geocaches || []).map(decideTier);
}

/**
 * Plan initial : le palier de chaque cache, aux réglages du niveau de détail demandé.
 *
 * `adaptive: false` reproduit l'ancien comportement — tout le lot au palier `rich` — pour
 * l'utilisateur qui préfère un régime uniforme et pour les tests de non-régression. Le
 * plafond de tokens, lui, continue de s'appliquer : c'est un garde-fou, pas une option.
 */
export function buildOutingPromptPlan(
    bundle: OutingAnalysisBundle,
    detailLevel: OutingDetailLevel,
    options: { adaptive?: boolean; decisions?: OutingTierDecision[] } = {}
): OutingPromptPlan {
    const adaptive = options.adaptive !== false;
    const preset = OUTING_TIER_PRESETS[detailLevel] || OUTING_TIER_PRESETS.standard;
    const decisions = options.decisions || decideTiers(bundle);
    const tiers: Record<string, OutingCacheTier> = {};

    decisions.forEach(decision => {
        tiers[decision.gc_code] = adaptive ? decision.tier : 'rich';
    });

    return {
        tiers,
        listingChars: { ...preset.listingChars },
        recentLogs: { ...preset.recentLogs },
        gearLogs: { ...preset.gearLogs },
        degraded: [],
        adaptive,
    };
}

/**
 * Paramètres de collecte à demander au backend pour qu'un plan soit réalisable.
 *
 * Le serveur ne connaît pas les paliers : il sert le maximum dont le plan pourra avoir
 * besoin, et la coupe par cache se fait à la rédaction. Le surcoût est un transfert
 * localhost ; l'inverse — redemander le listing d'une cache après coup — serait un
 * aller-retour de plus par cache signalée.
 */
export function collectionOptionsForPlan(
    detailLevel: OutingDetailLevel,
    adaptive: boolean
): { listingChars: number; recentLogsCount: number; gearLogsCount: number } {
    const preset = OUTING_TIER_PRESETS[detailLevel] || OUTING_TIER_PRESETS.standard;
    const richest = <T extends Record<OutingCacheTier, number>>(values: T): number =>
        (adaptive ? Math.max(values.rich, values.lean) : values.rich);

    return {
        listingChars: richest(preset.listingChars),
        recentLogsCount: richest(preset.recentLogs),
        gearLogsCount: richest(preset.gearLogs),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Plafond dur et rétrogradation
// ─────────────────────────────────────────────────────────────────────────────

/** Longueur d'extrait à laquelle une première coupe reste indolore. */
const SHORTENED_LISTING_CHARS = 900;

interface DegradationStep {
    kind: string;
    label: string;
}

/**
 * Étapes de rétrogradation, dans l'ordre où elles seront appliquées.
 *
 * L'ordre est le cœur de la fonctionnalité, et il suit une règle simple : on sacrifie
 * d'abord ce qui est redondant, jamais ce qui est unique. Le listing est de loin le poste
 * le plus lourd et le plus redondant — son matériel a déjà été extrait par balayage — donc
 * il part en premier, en commençant par les caches les moins signalées. Les logs viennent
 * ensuite, parce qu'ils portent souvent la seule mention d'un outil. Les attributs, la
 * santé, la géographie et les temps estimés ne sont jamais touchés : ils coûtent peu et
 * portent l'essentiel.
 */
function* degradationSteps(
    plan: OutingPromptPlan,
    decisions: OutingTierDecision[]
): Generator<DegradationStep> {
    if (plan.listingChars.lean > 0) {
        plan.listingChars.lean = 0;
        yield { kind: 'lean_listing', label: 'listing retiré des caches sans particularité' };
    }

    if (plan.listingChars.rich > SHORTENED_LISTING_CHARS) {
        plan.listingChars.rich = SHORTENED_LISTING_CHARS;
        yield {
            kind: 'short_listing',
            label: `listing des caches signalées raccourci à ${SHORTENED_LISTING_CHARS} caractères`,
        };
    }

    // Les moins signalées d'abord : à budget égal, mieux vaut le texte complet de la T5 à
    // drapeau ouvert que deux extraits d'affaire de caches seulement « à surveiller ».
    const ordered = [...decisions].sort((left, right) => left.priority - right.priority);
    for (const decision of ordered) {
        if (plan.tiers[decision.gc_code] === 'rich') {
            plan.tiers[decision.gc_code] = 'lean';
            yield { kind: 'demote', label: decision.gc_code };
        }
    }

    if (plan.recentLogs.rich > 2 || plan.recentLogs.lean > 1) {
        plan.recentLogs = { rich: Math.min(plan.recentLogs.rich, 2), lean: Math.min(plan.recentLogs.lean, 1) };
        yield { kind: 'recent_logs', label: 'logs récents ramenés à 2 par cache' };
    }

    if (plan.gearLogs.rich > 4 || plan.gearLogs.lean > 2) {
        plan.gearLogs = { rich: Math.min(plan.gearLogs.rich, 4), lean: Math.min(plan.gearLogs.lean, 2) };
        yield { kind: 'gear_logs', label: 'logs matériel ramenés à 4 par cache' };
    }

    if (plan.recentLogs.rich > 0 || plan.recentLogs.lean > 0) {
        plan.recentLogs = { rich: 0, lean: 0 };
        yield { kind: 'no_recent_logs', label: 'aucun log récent transmis' };
    }

    if (plan.gearLogs.rich > 1 || plan.gearLogs.lean > 0) {
        plan.gearLogs = { rich: 1, lean: 0 };
        yield { kind: 'last_gear_log', label: 'un seul log matériel conservé par cache signalée' };
    }
}

/** Nombre de codes GC énumérés avant de basculer sur un décompte. */
const NAMED_DEMOTIONS = 5;

/**
 * Résumé lisible des étapes appliquées.
 *
 * Les rétrogradations individuelles — une par cache — sont regroupées **à leur place dans
 * la séquence** : le résumé doit se lire comme ce qui s'est passé, dans l'ordre où c'est
 * arrivé. Au-delà de cinq codes GC, on compte au lieu d'énumérer : soixante codes dans le
 * prompt coûteraient plus cher que le listing qu'ils remplacent.
 */
function summarize(steps: DegradationStep[]): string[] {
    const summary: string[] = [];
    let demoted: string[] = [];

    const flush = (): void => {
        if (demoted.length === 0) {
            return;
        }
        const named = demoted.slice(0, NAMED_DEMOTIONS).join(', ');
        const rest = demoted.length > NAMED_DEMOTIONS
            ? ` et ${demoted.length - NAMED_DEMOTIONS} autre(s)`
            : '';
        summary.push(
            `listing retiré pour ${demoted.length} cache(s) signalée(s), les moins prioritaires `
            + `d'abord (${named}${rest})`
        );
        demoted = [];
    };

    steps.forEach(step => {
        if (step.kind === 'demote') {
            demoted.push(step.label);
            return;
        }
        flush();
        summary.push(step.label);
    });
    flush();

    return summary;
}

export interface OutingBudgetOptions {
    /** Plafond dur, en tokens estimés, prompt système compris. `0` le désactive. */
    maxTokens?: number;
    /** Caractères du prompt système et de la policy, comptés dans l'estimation. */
    systemPromptChars?: number;
    /** Faux pour revenir au régime uniforme d'avant le budget adaptatif. */
    adaptive?: boolean;
}

export interface OutingBudgetResult {
    prompt: string;
    size: OutingPromptSize;
    plan: OutingPromptPlan;
    decisions: OutingTierDecision[];
    /** Nombre de caches ayant conservé le palier enrichi. */
    richCount: number;
    leanCount: number;
    /** Étapes de rétrogradation appliquées, déjà résumées pour l'affichage. */
    degradations: string[];
    /** Vrai quand le plafond reste dépassé après toutes les étapes. */
    overBudget: boolean;
}

/**
 * Construit le prompt le plus riche qui tienne sous le plafond.
 *
 * Le plafond n'est pas un refus : dépasser après rétrogradation complète n'annule pas
 * l'envoi, cela lève `overBudget`. Refuser d'analyser après que l'utilisateur a attendu la
 * collecte serait le pire des deux mondes — il lui reste un levier évident, réduire la
 * sélection, et il lui est dit. Le prompt, lui, sait qu'il est amputé : la section
 * « Couverture des données » l'écrit noir sur blanc.
 */
export function buildBudgetedOutingPrompt(
    bundle: OutingAnalysisBundle,
    context: OutingPromptContext,
    options: OutingBudgetOptions = {}
): OutingBudgetResult {
    const maxTokens = options.maxTokens ?? OUTING_DEFAULT_MAX_PROMPT_TOKENS;
    const systemPromptChars = options.systemPromptChars || 0;
    const decisions = decideTiers(bundle);
    const plan = buildOutingPromptPlan(bundle, context.detailLevel, {
        adaptive: options.adaptive,
        decisions,
    });

    const render = (): { prompt: string; size: OutingPromptSize } => {
        const prompt = buildOutingAnalysisPrompt(bundle, { ...context, plan });
        return { prompt, size: estimateOutingPromptSize(prompt, { systemPromptChars }) };
    };

    let rendered = render();
    const applied: DegradationStep[] = [];

    if (maxTokens > 0) {
        const steps = degradationSteps(plan, decisions);
        while (rendered.size.approxTokens > maxTokens) {
            const next = steps.next();
            if (next.done) {
                break;
            }
            applied.push(next.value);
            plan.degraded = summarize(applied);
            rendered = render();
        }
    }

    const richCount = (bundle.geocaches || []).filter(
        geocache => (plan.tiers[geocache.gc_code] || 'rich') === 'rich'
    ).length;

    return {
        prompt: rendered.prompt,
        size: rendered.size,
        plan,
        decisions,
        richCount,
        leanCount: (bundle.geocaches || []).length - richCount,
        degradations: plan.degraded,
        overBudget: maxTokens > 0 && rendered.size.approxTokens > maxTokens,
    };
}
