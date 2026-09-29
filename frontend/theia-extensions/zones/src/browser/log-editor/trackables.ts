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

/** Un TB de mon inventaire, tel que le renvoie `GET /api/trackables/inventory`. */
export interface InventoryTrackable {
    reference_code: string;
    name?: string | null;
    icon_url?: string | null;
    type_name?: string | null;
    owner_username?: string | null;
    goal_html?: string | null;
    has_tracking_code?: boolean;
    last_cache_log_action?: string | null;
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
    inventory: InventoryTrackable[],
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
    inventory: InventoryTrackable[],
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

/** Filtre de la liste : code, nom ou type, insensible à la casse et aux accents. */
export function filterTrackables(inventory: InventoryTrackable[], query: string): InventoryTrackable[] {
    const needle = normalizeForSearch(query);
    if (!needle) {
        return inventory;
    }
    return inventory.filter(tb => [tb.reference_code, tb.name, tb.type_name, tb.owner_username]
        .some(value => normalizeForSearch(value ?? '').includes(needle)));
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
