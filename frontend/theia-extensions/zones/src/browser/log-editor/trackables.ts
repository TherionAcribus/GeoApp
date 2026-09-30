/**
 * Trackables (TB) de mon inventaire dans l'éditeur de logs : logique pure.
 *
 * Chaque TB en main reçoit une action pour le lot : ne rien faire, visiter, ou
 * déposer. Cette action s'étale ensuite sur les géocaches du lot, dans l'ordre
 * d'envoi, avec les règles de Geocaching.com :
 * - « Visité » accompagne chaque log (trouvée ou note) tant que le TB est en main ;
 * - « Déposé » vise **une** géocache trouvée du lot. Le TB n'est plus en main après :
 *   il disparaît des logs suivants, et ne visite pas les caches d'avant (il y était
 *   pourtant, mais c'est le choix de c:geo et de la plupart des geocacheurs).
 *
 * Les DNF ne portent jamais de TB : on ne visite pas une cache qu'on n'a pas trouvée.
 * Voir documentation/trackables-technique.md.
 */

import {
    AdvancedFilterClause,
    FieldDefinition,
    FilterFieldKinds,
    TokenFilter,
    matchesSearchPattern,
    normalizeSearchText,
    parseSearchQuery,
} from '../geocache-filter-shared';
import { GeocacheListItem, LogTypeValue } from './types';

export type TrackableAction = 'none' | 'visit' | 'drop';

export const TRACKABLE_ACTIONS: readonly TrackableAction[] = ['none', 'visit', 'drop'];

export function isTrackableAction(value: unknown): value is TrackableAction {
    return typeof value === 'string' && (TRACKABLE_ACTIONS as readonly string[]).includes(value);
}

export const TRACKABLE_ACTION_LABELS: Record<TrackableAction, string> = {
    none: 'Ne rien faire',
    visit: 'Visité',
    drop: 'Déposé',
};

/**
 * À l'ouverture de l'éditeur, l'inventaire est relu sur Geocaching.com si le dernier relevé
 * a plus de 15 minutes : un TB pris ou déposé ailleurs (site, appli) doit apparaître sans geste.
 */
export const TRACKABLE_INVENTORY_MAX_AGE_SECONDS = 15 * 60;

/** Bilan d'un relevé de l'inventaire, tel que le renvoie le backend (`sync`). */
export interface TrackableInventorySyncReport {
    fetched?: number;
    /** TBs entrés dans l'inventaire (nouveaux, ou repris après un dépôt). */
    added?: number;
    removed?: number;
}

/** Message après un rafraîchissement demandé : ce qui a changé, pas seulement « c'est fait ». */
export function describeInventorySync(report: TrackableInventorySyncReport | undefined | null): string {
    const fetched = report?.fetched ?? 0;
    const parts: string[] = [];
    if (report?.added) {
        parts.push(report.added === 1 ? '1 entré' : `${report.added} entrés`);
    }
    if (report?.removed) {
        parts.push(report.removed === 1 ? '1 sorti' : `${report.removed} sortis`);
    }
    const changes = parts.length > 0 ? ` (${parts.join(', ')})` : ', aucun changement';
    return `Inventaire relu sur Geocaching.com : ${fetched} trackable(s) en main${changes}.`;
}

/** Préférence : un TB sans action mémorisée part en « Visité » plutôt qu'en « Ne rien faire ». */
export const TRACKABLE_AUTO_VISIT_PREF = 'geoApp.logs.trackableAutoVisit';

/**
 * Au-delà, avertissement avant envoi (c:geo : `MAX_GC_TRACKABLE_FOUNDS`). Geocaching.com
 * n'aime pas les logs qui font visiter des centaines de TBs d'un coup.
 */
export const TRACKABLE_VISIT_WARNING_THRESHOLD = 100;

/**
 * Un TB de mon inventaire, tel que le renvoie `GET /api/trackables/inventory`.
 *
 * DTO « liste » volontairement minimal (P2-02) : les champs riches — objectif
 * HTML, localisation, distances — ne viennent que de la fiche `GET /<TB>`.
 */
export interface InventoryTrackable {
    reference_code: string;
    name?: string | null;
    icon_url?: string | null;
    type_id?: number | null;
    type_name?: string | null;
    owner_username?: string | null;
    has_tracking_code?: boolean;
    last_cache_log_action?: string | null;
    updated_at?: string | null;
}

/** Choix de l'utilisateur pour le lot. */
export interface TrackableSelection {
    actions: Record<string, TrackableAction>;
    /** Géocache où déposer chaque TB en « Déposé » (id GeoApp). */
    dropTargets: Record<string, number>;
}

/** Action d'un TB dans le corps d'un log (`POST /logs/submit`, champ `trackables`). */
export interface TrackablePayloadEntry {
    code: string;
    action: TrackableAction;
}

/** Types de log qui peuvent porter des TBs, et ceux où l'on peut en déposer. */
const LOG_TYPES_CARRYING_TRACKABLES: readonly LogTypeValue[] = ['found', 'note'];
const LOG_TYPES_ACCEPTING_DROPS: readonly LogTypeValue[] = ['found'];

export function canCarryTrackables(logType: LogTypeValue): boolean {
    return LOG_TYPES_CARRYING_TRACKABLES.includes(logType);
}

export function canReceiveDrop(logType: LogTypeValue): boolean {
    return LOG_TYPES_ACCEPTING_DROPS.includes(logType);
}

/**
 * Action proposée à l'ouverture de l'éditeur (ordre de c:geo, `checkAndGetAction`) :
 * l'action mémorisée au dernier log, sinon la préférence « visite auto ».
 *
 * Un « Déposé » mémorisé n'est jamais repris : s'il est de nouveau en main, c'est
 * qu'on l'a repris depuis, et le redéposer d'office dans la cache suivante serait
 * une mauvaise surprise.
 */
export function defaultTrackableAction(trackable: InventoryTrackable, autoVisit: boolean): TrackableAction {
    const last = trackable.last_cache_log_action;
    if (last === 'visit' || last === 'none') {
        return last;
    }
    return autoVisit ? 'visit' : 'none';
}

/** Complète les actions connues avec les défauts des TBs qui n'en ont pas encore. */
export function withDefaultActions(
    inventory: InventoryTrackable[],
    current: Record<string, TrackableAction>,
    autoVisit: boolean
): Record<string, TrackableAction> {
    const next: Record<string, TrackableAction> = {};
    for (const tb of inventory) {
        const code = tb.reference_code;
        next[code] = isTrackableAction(current[code]) ? current[code] : defaultTrackableAction(tb, autoVisit);
    }
    return next;
}

/** Vrai si l'utilisateur a changé au moins une action par rapport au défaut (brouillon utile). */
export function hasTrackableChoices(
    inventory: InventoryTrackable[],
    selection: TrackableSelection,
    autoVisit: boolean
): boolean {
    return inventory.some(tb => {
        const action = selection.actions[tb.reference_code];
        return action !== undefined && action !== defaultTrackableAction(tb, autoVisit);
    });
}

/**
 * Choix réellement exprimés par l'utilisateur, pour le brouillon : seules les actions
 * qui diffèrent du défaut courant, plus les cibles de dépôt explicitement choisies.
 *
 * Sérialiser la table complète figerait les défauts du moment : à la restauration,
 * ils écraseraient une préférence ou une « dernière action » qui aurait changé entre-
 * temps. Le brouillon ne garde donc que les écarts ; les défauts sont recalculés.
 */
export function trackableSelectionOverrides(
    inventory: InventoryTrackable[],
    selection: TrackableSelection,
    autoVisit: boolean
): TrackableSelection {
    const actions: Record<string, TrackableAction> = {};
    const dropTargets: Record<string, number> = {};
    for (const tb of inventory) {
        const code = tb.reference_code;
        const action = selection.actions[code];
        if (action !== undefined && action !== defaultTrackableAction(tb, autoVisit)) {
            actions[code] = action;
            const target = selection.dropTargets[code];
            if (action === 'drop' && target !== undefined) {
                dropTargets[code] = target;
            }
        }
    }
    return { actions, dropTargets };
}

/** Contexte du lot : géocaches dans l'ordre d'envoi, et ce qui décide si elles partent. */
export interface TrackableBatchContext {
    geocaches: GeocacheListItem[];
    getLogType: (geocacheId: number) => LogTypeValue;
    /** Vrai si le log de cette géocache part avec l'envoi en cours (ni déjà envoyé, ni « Ne pas loguer »). */
    willSubmit: (geocacheId: number) => boolean;
}

/** Géocaches du lot où un dépôt est possible : trouvées, pas encore envoyées. */
export function dropTargetCandidates(ctx: TrackableBatchContext): GeocacheListItem[] {
    return ctx.geocaches.filter(gc => ctx.willSubmit(gc.id) && canReceiveDrop(ctx.getLogType(gc.id)));
}

/**
 * Cible de dépôt effective d'un TB : celle choisie si elle est encore valable, sinon la
 * dernière géocache trouvée du lot (on dépose en général là où la sortie se termine).
 */
export function resolveDropTarget(
    code: string,
    selection: TrackableSelection,
    ctx: TrackableBatchContext
): number | undefined {
    const candidates = dropTargetCandidates(ctx);
    const chosen = selection.dropTargets[code];
    if (chosen !== undefined && candidates.some(gc => gc.id === chosen)) {
        return chosen;
    }
    return candidates.length > 0 ? candidates[candidates.length - 1].id : undefined;
}

/**
 * Actions à envoyer avec le log d'une géocache.
 *
 * Chaque TB encore en main à ce moment du lot figure dans la liste, « Ne rien faire »
 * compris : le backend le mémorise comme défaut du prochain log, sans l'envoyer au site.
 * Un TB déposé plus tôt dans le lot n'y figure plus.
 */
export function trackablesForGeocache(
    geocacheId: number,
    inventory: readonly InventoryTrackable[],
    selection: TrackableSelection,
    ctx: TrackableBatchContext
): TrackablePayloadEntry[] {
    const logType = ctx.getLogType(geocacheId);
    if (!canCarryTrackables(logType)) {
        return [];
    }
    const position = ctx.geocaches.findIndex(gc => gc.id === geocacheId);
    const entries: TrackablePayloadEntry[] = [];

    for (const tb of inventory) {
        const code = tb.reference_code;
        const action = selection.actions[code] ?? 'none';
        if (action !== 'drop') {
            entries.push({ code, action });
            continue;
        }
        const target = resolveDropTarget(code, selection, ctx);
        if (target === undefined) {
            // Aucune cache trouvée où le déposer : bloqué par la validation avant envoi.
            continue;
        }
        const targetPosition = ctx.geocaches.findIndex(gc => gc.id === target);
        if (target === geocacheId) {
            entries.push({ code, action: 'drop' });
        } else if (position < targetPosition) {
            entries.push({ code, action: 'none' });
        }
        // Après la cache de dépôt : le TB n'est plus en main, il n'apparaît plus.
    }
    return entries;
}

/** Problème bloquant avant envoi. */
export interface TrackableValidationIssue {
    code: string;
    message: string;
}

/** TBs en « Déposé » qu'aucune géocache du lot ne peut recevoir. */
export function validateTrackableSelection(
    inventory: InventoryTrackable[],
    selection: TrackableSelection,
    ctx: TrackableBatchContext
): TrackableValidationIssue[] {
    const issues: TrackableValidationIssue[] = [];
    for (const tb of inventory) {
        if (selection.actions[tb.reference_code] !== 'drop') {
            continue;
        }
        if (resolveDropTarget(tb.reference_code, selection, ctx) === undefined) {
            issues.push({
                code: tb.reference_code,
                message: `${tb.reference_code} est en « Déposé », mais aucune géocache du lot n'est en « Trouvée » pour le recevoir.`,
            });
        }
    }
    return issues;
}

/** Bilan des actions, pour le récapitulatif avant envoi et le résumé par cache. */
export interface TrackableSelectionSummary {
    visitCount: number;
    drops: { code: string; name?: string | null; gcCode: string }[];
}

export function summarizeTrackableSelection(
    inventory: readonly InventoryTrackable[],
    selection: TrackableSelection,
    ctx: TrackableBatchContext
): TrackableSelectionSummary {
    let visitCount = 0;
    const drops: TrackableSelectionSummary['drops'] = [];
    for (const tb of inventory) {
        const action = selection.actions[tb.reference_code];
        if (action === 'visit') {
            visitCount += 1;
        } else if (action === 'drop') {
            const target = resolveDropTarget(tb.reference_code, selection, ctx);
            const gc = ctx.geocaches.find(item => item.id === target);
            if (gc) {
                drops.push({ code: tb.reference_code, name: tb.name, gcCode: gc.gc_code });
            }
        }
    }
    return { visitCount, drops };
}

/** Lignes du récapitulatif de confirmation ; `highlight` pour ce qui mérite un second regard. */
export function buildTrackableSummaryLines(
    summary: TrackableSelectionSummary,
    carryingLogCount: number
): { text: string; highlight: boolean }[] {
    const lines: { text: string; highlight: boolean }[] = [];
    if (summary.visitCount > 0 && carryingLogCount > 0) {
        const where = carryingLogCount === 1 ? 'sur le log' : `sur chacun des ${carryingLogCount} logs trouvés/notes`;
        lines.push({
            text: `🐞 ${summary.visitCount} TB visité(s) ${where}`,
            highlight: summary.visitCount > TRACKABLE_VISIT_WARNING_THRESHOLD,
        });
        if (summary.visitCount > TRACKABLE_VISIT_WARNING_THRESHOLD) {
            lines.push({
                text: `⚠️ Plus de ${TRACKABLE_VISIT_WARNING_THRESHOLD} visites par log : Geocaching.com peut les refuser ou les traiter lentement.`,
                highlight: true,
            });
        }
    }
    for (const drop of summary.drops) {
        lines.push({ text: `📦 ${drop.code}${drop.name ? ` (${drop.name})` : ''} déposé dans ${drop.gcCode}`, highlight: false });
    }
    return lines;
}

/** Résumé court d'une géocache (bloc par cache) : « 3 TB visités · TB1234 déposé ». */
export function describeTrackablesForGeocache(entries: TrackablePayloadEntry[]): string | undefined {
    const visits = entries.filter(e => e.action === 'visit').length;
    const drops = entries.filter(e => e.action === 'drop').map(e => e.code);
    const parts: string[] = [];
    if (visits > 0) {
        parts.push(visits === 1 ? '1 TB visité' : `${visits} TB visités`);
    }
    if (drops.length > 0) {
        parts.push(`${drops.join(', ')} déposé${drops.length > 1 ? 's' : ''}`);
    }
    return parts.length > 0 ? parts.join(' · ') : undefined;
}

/**
 * Champs filtrables d'un TB en main — même syntaxe que le tableau des
 * géocaches (`@champ:valeur`, joker `*`, panneau « Filtres supplémentaires »).
 * Les libellés sont réutilisés par la barre de filtre (autocomplétion,
 * éditeur de clauses).
 */
export const TRACKABLE_FIELD_DEFINITIONS: FieldDefinition[] = [
    { field: 'reference_code', label: 'Code', kind: 'text' },
    { field: 'name', label: 'Nom', kind: 'text' },
    { field: 'type_name', label: 'Type', kind: 'text' },
    { field: 'owner_username', label: 'Propriétaire', kind: 'text' },
    { field: 'has_tracking_code', label: 'Code de suivi connu', kind: 'boolean' },
    { field: 'updated_at', label: 'Relevé le', kind: 'date' },
];

/** Alias saisis (`@code:`, `@proprio:`, `@suivi:`) → champ canonique. */
const TRACKABLE_FIELD_ALIASES: Record<string, string> = {
    code: 'reference_code',
    tb: 'reference_code',
    reference_code: 'reference_code',
    nom: 'name',
    name: 'name',
    titre: 'name',
    type: 'type_name',
    type_name: 'type_name',
    owner: 'owner_username',
    proprietaire: 'owner_username',
    proprio: 'owner_username',
    owner_username: 'owner_username',
    suivi: 'has_tracking_code',
    tracking: 'has_tracking_code',
    has_tracking_code: 'has_tracking_code',
    maj: 'updated_at',
    releve: 'updated_at',
    updated_at: 'updated_at',
};

const TRACKABLE_FIELD_KINDS: FilterFieldKinds = {
    boolean: new Set(['has_tracking_code']),
    date: new Set(['updated_at']),
};

/** Résolution `@alias:` pour l'autocomplétion de la barre de filtre. */
export function normalizeTrackableFieldAlias(raw: string): string | null {
    const key = normalizeSearchText(raw.trim());
    return key ? TRACKABLE_FIELD_ALIASES[key] ?? null : null;
}

/** `parseSearchQuery` branché sur les alias/familles trackables. */
export function parseTrackableSearchQuery(input: string): { freeText: string; tokenFilters: TokenFilter[] } {
    return parseSearchQuery(input, { aliases: TRACKABLE_FIELD_ALIASES, kinds: TRACKABLE_FIELD_KINDS });
}

function trackableFieldValue(tb: InventoryTrackable, field: string): unknown {
    switch (field) {
        case 'reference_code': return tb.reference_code;
        case 'name': return tb.name;
        case 'type_name': return tb.type_name;
        case 'owner_username': return tb.owner_username;
        case 'has_tracking_code': return tb.has_tracking_code;
        case 'updated_at': return tb.updated_at;
        default: return undefined;
    }
}

/** Une clause (token `@…` ou ligne du panneau « filtres ») contre un TB. */
export function matchesTrackableClause(tb: InventoryTrackable, clause: TokenFilter): boolean {
    const op = clause.operator;
    const raw = trackableFieldValue(tb, clause.field);
    if (raw === undefined) {
        // Champ inconnu : ne pas exclure silencieusement tous les TBs.
        return true;
    }

    if (clause.field === 'has_tracking_code') {
        if (op !== 'is') {
            return true;
        }
        const actual = Boolean(raw);
        return clause.value === 'true' ? actual : clause.value === 'false' ? !actual : true;
    }

    if (clause.field === 'updated_at') {
        // Même comparaison par préfixe ISO que les dates des géocaches :
        // `@maj:>=2026-09` garde les TBs relevés depuis septembre 2026.
        const actual = String(raw ?? '');
        if (!/^\d{4}-\d{2}-\d{2}/.test(actual)) {
            return op === 'neq';
        }
        if (op === 'between') {
            const v1 = clause.value ?? '';
            const v2 = clause.value2 ?? '';
            return v1 && v2
                ? actual.slice(0, v1.length) >= v1 && actual.slice(0, v2.length) <= v2
                : true;
        }
        const w = clause.value ?? '';
        if (!w) {
            return true;
        }
        const p = actual.slice(0, w.length);
        switch (op) {
            case 'eq': return p === w;
            case 'neq': return p !== w;
            case 'gte': return p >= w;
            case 'gt': return p > w;
            case 'lte': return p <= w;
            case 'lt': return p < w;
            default: return true;
        }
    }

    const wanted = (clause.value ?? '').toString();
    if (!normalizeSearchText(wanted) && (op === 'contains' || op === 'not_contains' || op === 'eq' || op === 'neq')) {
        return true;
    }
    switch (op) {
        case 'contains': return matchesSearchPattern(raw, wanted, 'contains');
        case 'not_contains': return !matchesSearchPattern(raw, wanted, 'contains');
        case 'eq': return matchesSearchPattern(raw, wanted, 'equals');
        case 'neq': return !matchesSearchPattern(raw, wanted, 'equals');
        default: return true;
    }
}

/**
 * Filtre de la liste : texte libre (code, nom, type, propriétaire — insensible
 * casse/accents) plus les tokens `@champ:…` et les clauses du panneau
 * « Filtres supplémentaires », comme le tableau des géocaches.
 */
export function filterTrackables(
    inventory: InventoryTrackable[],
    query: string,
    clauses: AdvancedFilterClause[] = []
): InventoryTrackable[] {
    const { freeText, tokenFilters } = parseTrackableSearchQuery(query ?? '');
    let result = inventory;
    const needle = normalizeForSearch(freeText);
    if (needle) {
        result = result.filter(tb => [tb.reference_code, tb.name, tb.type_name, tb.owner_username]
            .some(value => normalizeForSearch(value ?? '').includes(needle)));
    }
    for (const clause of [...tokenFilters, ...clauses]) {
        result = result.filter(tb => matchesTrackableClause(tb, clause));
    }
    return result;
}

/** Filtres rapides par état : action choisie, ou dépôt dont le résultat reste à vérifier. */
export type TrackableQuickFilter = 'all' | 'none' | 'visit' | 'drop' | 'error';

export const TRACKABLE_QUICK_FILTERS: readonly { value: TrackableQuickFilter; label: string }[] = [
    { value: 'all', label: 'Tous' },
    { value: 'none', label: 'Rien' },
    { value: 'visit', label: 'Visités' },
    { value: 'drop', label: 'Déposés' },
    { value: 'error', label: 'En erreur' },
];

/** « En erreur » : un dépôt dont la réconciliation n'a pas tranché (« uncertain »). */
export function quickFilterTrackables(
    inventory: InventoryTrackable[],
    quickFilter: TrackableQuickFilter,
    actions: Record<string, TrackableAction>,
    dropResults: Record<string, TrackableDropResult>
): InventoryTrackable[] {
    if (quickFilter === 'all') {
        return inventory;
    }
    if (quickFilter === 'error') {
        return inventory.filter(tb => dropResults[tb.reference_code] === 'uncertain');
    }
    return inventory.filter(tb => (actions[tb.reference_code] ?? 'none') === quickFilter);
}

function normalizeForSearch(value: string): string {
    return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Garde d'un choix restauré (brouillon) : seulement des actions valides et des cibles numériques. */
export function sanitizeTrackableSelection(raw: unknown): TrackableSelection {
    const actions: Record<string, TrackableAction> = {};
    const dropTargets: Record<string, number> = {};
    if (raw && typeof raw === 'object') {
        const source = raw as { actions?: unknown; dropTargets?: unknown };
        if (source.actions && typeof source.actions === 'object') {
            for (const [code, action] of Object.entries(source.actions as Record<string, unknown>)) {
                if (isTrackableAction(action)) {
                    actions[code] = action;
                }
            }
        }
        if (source.dropTargets && typeof source.dropTargets === 'object') {
            for (const [code, target] of Object.entries(source.dropTargets as Record<string, unknown>)) {
                if (typeof target === 'number' && Number.isFinite(target)) {
                    dropTargets[code] = target;
                }
            }
        }
    }
    return { actions, dropTargets };
}

/** URL publique de la fiche d'un TB sur Geocaching.com. */
export function trackableUrl(code: string): string {
    return `https://www.geocaching.com/track/details.aspx?tracker=${encodeURIComponent(code)}`;
}

/** URL publique d'une cache sur Geocaching.com (même convention que les autres panneaux). */
export function geocacheUrl(code: string): string {
    return `https://www.geocaching.com/geocache/${encodeURIComponent(code)}`;
}

// ---------------------------------------------------------------------------
// Plan de lot figé et suivi des dépôts (P1-04)
// ---------------------------------------------------------------------------

/**
 * État d'un dépôt au fil du lot.
 *
 * - `planned`   : prévu, sa cache cible pas encore envoyée ;
 * - `submitted` : le log de la cible part ou est parti, résultat pas encore tranché ;
 * - `confirmed` : le log de la cible est passé (ou l'inventaire distant confirme) ;
 * - `failed`    : la cible a échoué ou a été sautée — le TB est encore en main ;
 * - `uncertain` : résultat distant inconnu (timeout, « déjà loguée » d'un essai
 *   coupé…) — à vérifier sur le site, jamais renvoyé à l'aveugle.
 */
export type TrackableDropState = 'planned' | 'submitted' | 'confirmed' | 'failed' | 'uncertain';

/** Un dépôt prévu, figé à la confirmation du lot : jamais reciblé ensuite. */
export interface PlannedDrop {
    code: string;
    name?: string | null;
    /** Id GeoApp de la géocache cible (position figée, pas recalculée). */
    targetGeocacheId: number;
    targetGcCode: string;
}

/**
 * Plan TB d'un lot, immuable : instantané des entrées par géocache, des dépôts
 * prévus et de l'ordre d'envoi. Calculé une fois, juste avant la boucle — après
 * confirmation de l'utilisateur, rien ne le recalcule.
 */
export interface TrackableBatchPlan {
    /** Entrées TB figées par géocache (payload prévu si tout réussit). */
    readonly entries: ReadonlyMap<number, readonly TrackablePayloadEntry[]>;
    /** Position d'envoi de chaque géocache du lot. */
    readonly positions: ReadonlyMap<number, number>;
    /** Dépôts prévus (cibles figées). */
    readonly drops: readonly PlannedDrop[];
}

/** Fige le plan TB du lot : payloads par géocache et cibles de dépôt résolues. */
export function buildTrackableBatchPlan(
    toSubmit: GeocacheListItem[],
    inventory: readonly InventoryTrackable[],
    selection: TrackableSelection,
    ctx: TrackableBatchContext
): TrackableBatchPlan {
    const entries = new Map<number, TrackablePayloadEntry[]>(
        toSubmit.map(gc => [gc.id, trackablesForGeocache(gc.id, inventory, selection, ctx)])
    );
    const positions = new Map<number, number>(toSubmit.map((gc, index) => [gc.id, index]));
    const drops: PlannedDrop[] = [];
    for (const tb of inventory) {
        if (selection.actions[tb.reference_code] !== 'drop') {
            continue;
        }
        const target = resolveDropTarget(tb.reference_code, selection, ctx);
        if (target === undefined) {
            continue; // bloqué par la validation avant envoi
        }
        const gc = ctx.geocaches.find(item => item.id === target);
        drops.push({ code: tb.reference_code, name: tb.name, targetGeocacheId: target, targetGcCode: gc?.gc_code ?? '' });
    }
    drops.sort((a, b) => (positions.get(a.targetGeocacheId) ?? 0) - (positions.get(b.targetGeocacheId) ?? 0));
    return { entries, positions, drops };
}

/**
 * Instantané TB figé **avant** d'ouvrir la confirmation : copies gelées de
 * l'inventaire et de la sélection, plan de lot et lignes du récapitulatif
 * calculés dessus. Le résumé accepté et le payload envoyé consomment exactement
 * cet objet — une modification (choix, relevé) arrivée pendant la confirmation
 * ne peut pas s'y glisser ; elle est détectée par `revision` et oblige à
 * re-figer puis reconfirmer.
 */
export interface TrackableSubmitSnapshot {
    /** Révision de l'état TB au moment de la fige ; comparée après confirmation. */
    readonly revision: number;
    readonly inventory: readonly InventoryTrackable[];
    readonly selection: TrackableSelection;
    readonly plan: TrackableBatchPlan;
    readonly summaryLines: readonly { text: string; highlight: boolean }[];
}

export function buildTrackableSubmitSnapshot(
    toSubmit: GeocacheListItem[],
    inventory: readonly InventoryTrackable[],
    selection: TrackableSelection,
    ctx: TrackableBatchContext,
    revision: number
): TrackableSubmitSnapshot {
    const frozenInventory: readonly InventoryTrackable[] = Object.freeze(
        inventory.map(tb => Object.freeze({ ...tb }))
    );
    const frozenSelection: TrackableSelection = Object.freeze({
        actions: Object.freeze({ ...selection.actions }),
        dropTargets: Object.freeze({ ...selection.dropTargets }),
    });
    const plan = buildTrackableBatchPlan(toSubmit, frozenInventory, frozenSelection, ctx);
    const summary = summarizeTrackableSelection(frozenInventory, frozenSelection, ctx);
    const carrying = toSubmit.filter(gc => canCarryTrackables(ctx.getLogType(gc.id))).length;
    const summaryLines = Object.freeze(buildTrackableSummaryLines(summary, carrying));
    return Object.freeze({ revision, inventory: frozenInventory, selection: frozenSelection, plan, summaryLines });
}

/**
 * Suivi des dépôts pendant la boucle d'envoi.
 *
 * Le plan est figé ; le tracker accumule ce qui s'est réellement passé. Tant
 * qu'un dépôt n'est pas `confirmed`, le TB reste « en main » pour les caches
 * suivantes : il y apparaît en « none » (non envoyé au site, mais mémorisé
 * localement) au lieu de disparaître comme si le dépôt avait réussi.
 */
export class TrackableDropTracker {
    private readonly states = new Map<string, TrackableDropState>();
    private readonly dropsByTarget = new Map<number, PlannedDrop[]>();

    constructor(readonly plan: TrackableBatchPlan) {
        for (const drop of plan.drops) {
            this.states.set(drop.code, 'planned');
            const list = this.dropsByTarget.get(drop.targetGeocacheId) ?? [];
            list.push(drop);
            this.dropsByTarget.set(drop.targetGeocacheId, list);
        }
    }

    /** Dépôts prévus sur cette géocache. */
    dropsFor(geocacheId: number): readonly PlannedDrop[] {
        return this.dropsByTarget.get(geocacheId) ?? [];
    }

    stateOf(code: string): TrackableDropState | undefined {
        return this.states.get(code);
    }

    /** Marque les dépôts de cette cible « partis » juste avant l'envoi du log. */
    markSubmitted(geocacheId: number): void {
        for (const drop of this.dropsFor(geocacheId)) {
            this.states.set(drop.code, 'submitted');
        }
    }

    markConfirmed(code: string): void {
        this.states.set(code, 'confirmed');
    }

    markFailed(code: string): void {
        this.states.set(code, 'failed');
    }

    markUncertain(code: string): void {
        this.states.set(code, 'uncertain');
    }

    /**
     * Dépôts non résolus dont la cible est passée : « failed » ou « uncertain »,
     * jamais « confirmed ». Ce sont eux qui font qu'une cache suivante porte le
     * TB alors que le plan le donnait déjà déposé.
     */
    unresolvedDropsBefore(geocacheId: number): PlannedDrop[] {
        const position = this.plan.positions.get(geocacheId);
        if (position === undefined) {
            return [];
        }
        return this.plan.drops.filter(drop => {
            const state = this.states.get(drop.code);
            const targetPosition = this.plan.positions.get(drop.targetGeocacheId);
            return targetPosition !== undefined && targetPosition < position
                && state !== 'confirmed';
        });
    }

    /**
     * Entrées TB à envoyer avec le log de cette géocache, compte tenu du réel.
     *
     * Le plan donnait un TB déposé absent des caches d'après sa cible ; si le
     * dépôt n'est pas confirmé, il est encore en main et revient en « none ».
     * Le dépôt lui-même n'est jamais rejoué sur une autre cache.
     */
    effectiveEntries(geocacheId: number): TrackablePayloadEntry[] {
        const base = [...(this.plan.entries.get(geocacheId) ?? [])];
        for (const drop of this.unresolvedDropsBefore(geocacheId)) {
            if (!base.some(entry => entry.code === drop.code)) {
                base.push({ code: drop.code, action: 'none' });
            }
        }
        return base;
    }

    /** Bilan de fin de lot : déposés, échoués, à vérifier. */
    outcome(): { confirmed: PlannedDrop[]; failed: PlannedDrop[]; uncertain: PlannedDrop[] } {
        const confirmed: PlannedDrop[] = [];
        const failed: PlannedDrop[] = [];
        const uncertain: PlannedDrop[] = [];
        for (const drop of this.plan.drops) {
            const state = this.states.get(drop.code);
            if (state === 'confirmed') {
                confirmed.push(drop);
            } else if (state === 'uncertain') {
                uncertain.push(drop);
            } else {
                // planned/submitted sans confirmation = non fait (lot interrompu, cible sautée…)
                failed.push(drop);
            }
        }
        return { confirmed, failed, uncertain };
    }
}

/** Lignes du bilan TB de fin de lot : distingue déposé / échoué / à vérifier. */
export function buildTrackableDropOutcomeLines(outcome: {
    confirmed: readonly PlannedDrop[];
    failed: readonly PlannedDrop[];
    uncertain: readonly PlannedDrop[];
}): { text: string; highlight: boolean }[] {
    const lines: { text: string; highlight: boolean }[] = [];
    for (const drop of outcome.confirmed) {
        lines.push({ text: `📦 ${drop.code} déposé dans ${drop.targetGcCode}`, highlight: false });
    }
    for (const drop of outcome.failed) {
        lines.push({
            text: `📦 ${drop.code} : dépôt dans ${drop.targetGcCode} non fait — le TB est encore en main`,
            highlight: true,
        });
    }
    for (const drop of outcome.uncertain) {
        lines.push({
            text: `📦 ${drop.code} : dépôt dans ${drop.targetGcCode} incertain — à vérifier sur Geocaching.com`,
            highlight: true,
        });
    }
    return lines;
}

/** Dépôts confirmés ou incertains persistés dans le brouillon : jamais rejoués. */
export type TrackableDropResult = 'confirmed' | 'uncertain';

/**
 * Sort d'un dépôt dans le journal d'historique : les trois issues sont notées —
 * le journal sert à savoir où chaque dépôt a *réellement* réussi.
 */
export type TrackableDropOutcome = 'confirmed' | 'failed' | 'uncertain';

/** Journal TB d'un envoi, vers `LogHistoryEntry.trackables`. */
export interface TrackableHistoryRecord {
    /** Entrées TB réellement parties dans le log de chaque géocache (id → entrées). */
    sent: Record<number, TrackablePayloadEntry[]>;
    /** Sort final de chaque dépôt tenté dans le lot. */
    dropOutcomes: Record<string, TrackableDropOutcome>;
}

export function isTrackableDropResult(value: unknown): value is TrackableDropResult {
    return value === 'confirmed' || value === 'uncertain';
}

/**
 * Applique les résultats de dépôt d'une session interrompue à une sélection
 * restaurée : un TB dont le dépôt a été confirmé ou laissé incertain repasse en
 * « none » et perd sa cible — jamais de re-dépôt automatique. L'utilisateur peut
 * toujours rechoisir « Déposé » manuellement après vérification.
 */
export function applyDropResultsToSelection(
    selection: TrackableSelection,
    dropResults: Record<string, TrackableDropResult>
): { selection: TrackableSelection; cleared: string[] } {
    const actions = { ...selection.actions };
    const dropTargets = { ...selection.dropTargets };
    const cleared: string[] = [];
    for (const [code, result] of Object.entries(dropResults)) {
        if (isTrackableDropResult(result) && actions[code] === 'drop') {
            actions[code] = 'none';
            delete dropTargets[code];
            cleared.push(code);
        }
    }
    return { selection: { actions, dropTargets }, cleared };
}

/** Sanitize les résultats de dépôt restaurés depuis un brouillon. */
export function sanitizeTrackableDropResults(raw: unknown): Record<string, TrackableDropResult> {
    const results: Record<string, TrackableDropResult> = {};
    if (raw && typeof raw === 'object') {
        for (const [code, value] of Object.entries(raw as Record<string, unknown>)) {
            if (isTrackableDropResult(value)) {
                results[code] = value;
            }
        }
    }
    return results;
}
