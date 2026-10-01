/**
 * Visites GPS Garmin : types de l'API `/api/gps-visits` et règles d'affichage.
 *
 * Fonctions pures (aucun React, aucun réseau), testées dans
 * `tests/gps-visits-model.test.ts`. Voir documentation/garmin-visites-technique.md.
 */

import { GpsVisitHint, LogEditorPrefill, LogTypeValue } from './log-editor/types';

export type GpsVisitStatus = 'found' | 'dnf' | 'unattempted' | 'needs_maintenance' | 'other';
export type GpsVisitState = 'pending' | 'logged' | 'ignored' | 'history';
export type GpsProposedLogType = 'found' | 'dnf' | 'note' | 'skip';

export interface GpsKnownGeocache {
    id: number;
    zone_id: number;
    zone_name: string;
    name: string;
}

export interface GpsVisitPass {
    time: string;
    status_raw: string;
}

/** Une cache pour un jour (ou une visite sans code), telle que la renvoie `GET /api/gps-visits`. */
export interface GpsVisitEntry {
    key: string;
    visit_ids: number[];
    gc_code: string | null;
    raw_code: string;
    resolved: boolean;
    resolution_source?: string | null;
    day: string;
    time: string;
    visited_at: string;
    status: GpsVisitStatus;
    status_raw: string;
    proposed_log_type: GpsProposedLogType;
    has_nm: boolean;
    needs_confirmation: boolean;
    comment: string;
    raw_count: number;
    passes: GpsVisitPass[];
    state: GpsVisitState;
    name: string | null;
    cache_type: string | null;
    geocaches: GpsKnownGeocache[];
    found: boolean;
    found_date: string | null;
}

export interface GpsVisitDay {
    day: string;
    entries: GpsVisitEntry[];
}

export interface GpsLastImport {
    at: string;
    source: string;
    total: number;
    new: number;
    last_visit_day: string | null;
}

export interface GpsVisitsListing {
    days: GpsVisitDay[];
    truncated: boolean;
    counts: Partial<Record<GpsVisitState, number>>;
    cutoff: string | null;
    last_import: GpsLastImport | null;
}

export interface GpsImportLandmarks {
    last_visit_day: string;
    week_before: string;
    month_before: string;
    first_visit_day: string | null;
}

export interface GpsImportReport {
    total: number;
    new: number;
    known: number;
    without_code: number;
    unreadable_count: number;
    unreadable: { line: number; content: string }[];
    needs_cutoff: boolean;
    landmarks: GpsImportLandmarks | null;
    source: string;
}

export interface DetectedVisitsFile {
    path: string;
    size: number;
    modified: string;
}

export const GPS_STATUS_LABELS: Record<GpsVisitStatus, { icon: string; label: string }> = {
    found: { icon: '✅', label: 'Trouvée' },
    dnf: { icon: '❌', label: 'Non trouvée' },
    unattempted: { icon: '⏸️', label: 'Pas tentée' },
    needs_maintenance: { icon: '⚠️', label: 'Needs Maintenance' },
    other: { icon: '📝', label: 'Autre' },
};

export function statusLabel(entry: Pick<GpsVisitEntry, 'status' | 'status_raw'>): string {
    const known = GPS_STATUS_LABELS[entry.status];
    return entry.status === 'other' && entry.status_raw ? entry.status_raw : known.label;
}

/** « 4 passages » quand plusieurs lignes du GPS ont été réduites à une seule. */
export function describePasses(entry: Pick<GpsVisitEntry, 'raw_count' | 'passes'>): { label: string; tooltip: string } | undefined {
    if (entry.raw_count <= 1) {
        return undefined;
    }
    return {
        label: `${entry.raw_count} passages`,
        tooltip: entry.passes.map(p => `${p.time} — ${p.status_raw}`).join('\n'),
    };
}

/** Jour local (AAAA-MM-JJ) d'une date ISO renvoyée par le backend. */
function dayOf(iso: string | null | undefined): string | undefined {
    if (!iso) {
        return undefined;
    }
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
    return match ? match[1] : undefined;
}

/** La cache est marquée trouvée le jour même de la visite : un log existe sans doute déjà. */
export function isAlreadyLoggedSameDay(entry: Pick<GpsVisitEntry, 'found' | 'found_date' | 'day'>): boolean {
    return entry.found && dayOf(entry.found_date) === entry.day;
}

export type CacheKnowledgeKind = 'no-code' | 'logged-same-day' | 'found-before' | 'in-app' | 'to-import';

/** Ce que l'App sait de la cache, pour l'indicateur de chaque ligne. */
export function describeCacheKnowledge(entry: GpsVisitEntry): { kind: CacheKnowledgeKind; label: string; tooltip?: string } {
    if (!entry.gc_code) {
        return { kind: 'no-code', label: 'Sans code', tooltip: entry.raw_code ? `Le GPS a écrit « ${entry.raw_code} »` : 'Le GPS n\'a écrit aucun code' };
    }
    if (isAlreadyLoggedSameDay(entry)) {
        return { kind: 'logged-same-day', label: 'Déjà loguée sur Geocaching.com', tooltip: 'Trouvée le jour de la visite d\'après Geocaching.com' };
    }
    const zones = entry.geocaches.map(g => g.zone_name);
    if (entry.found) {
        return { kind: 'found-before', label: 'Déjà trouvée', tooltip: entry.found_date ? `Trouvée le ${dayOf(entry.found_date)}` : undefined };
    }
    if (zones.length > 0) {
        return { kind: 'in-app', label: `Zone ${zones[0]}`, tooltip: zones.length > 1 ? `Présente dans : ${zones.join(', ')}` : undefined };
    }
    return { kind: 'to-import', label: 'À importer' };
}

/** Résumé d'un jour : « 12 trouvées · 1 non trouvée · 1 sans code ». */
export function summarizeDay(day: GpsVisitDay): string {
    let found = 0;
    let dnf = 0;
    let nm = 0;
    let withoutCode = 0;
    for (const entry of day.entries) {
        if (!entry.gc_code) {
            withoutCode += 1;
        }
        if (entry.status === 'found') {
            found += 1;
        } else if (entry.status === 'dnf') {
            dnf += 1;
        }
        if (entry.has_nm) {
            nm += 1;
        }
    }
    const parts: string[] = [];
    if (found) {
        parts.push(`${found} trouvée${found > 1 ? 's' : ''}`);
    }
    if (dnf) {
        parts.push(`${dnf} non trouvée${dnf > 1 ? 's' : ''}`);
    }
    if (nm) {
        parts.push(`${nm} NM`);
    }
    if (withoutCode) {
        parts.push(`${withoutCode} sans code`);
    }
    return parts.join(' · ') || `${day.entries.length} visite${day.entries.length > 1 ? 's' : ''}`;
}

const DAY_FORMAT = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});

/** « dimanche 27 septembre 2026 » — le jour est déjà local, on le formate sans le décaler. */
export function formatDayLabel(isoDay: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDay);
    if (!match) {
        return isoDay;
    }
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return DAY_FORMAT.format(date);
}

/** « 27/09 » pour un titre d'onglet. */
export function formatShortDay(isoDay: string): string {
    const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(isoDay);
    return match ? `${match[2]}/${match[1]}` : isoDay;
}

/** Bilan d'un import, pour la ligne d'état du widget. */
export function describeImportReport(report: GpsImportReport): string {
    const parts = [
        report.new === 0
            ? 'Aucune nouvelle visite'
            : `${report.new} nouvelle${report.new > 1 ? 's' : ''} visite${report.new > 1 ? 's' : ''}`,
        `${report.total} dans le fichier`,
    ];
    if (report.unreadable_count > 0) {
        parts.push(`${report.unreadable_count} ligne${report.unreadable_count > 1 ? 's' : ''} illisible${report.unreadable_count > 1 ? 's' : ''}`);
    }
    return parts.join(' · ');
}

/** Identifiants de lignes brutes d'un ensemble d'entrées (pour ignorer un jour entier). */
export function visitIdsOf(entries: GpsVisitEntry[]): number[] {
    return entries.flatMap(e => e.visit_ids);
}

/** Entrées à loguer d'un jour, dans l'ordre de visite. */
export function pendingEntries(day: GpsVisitDay): GpsVisitEntry[] {
    return day.entries.filter(e => e.state === 'pending');
}

/** Décale un jour AAAA-MM-JJ de `days` jours (calcul en UTC : aucun effet d'heure d'été). */
export function shiftIsoDay(isoDay: string, days: number): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDay);
    if (!match) {
        return isoDay;
    }
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
    return date.toISOString().slice(0, 10);
}

/** Repères proposés pour le point de départ, à partir du dernier jour de visite. */
export function buildCutoffLandmarks(lastVisitDay: string, firstVisitDay: string | null = null): GpsImportLandmarks {
    return {
        last_visit_day: lastVisitDay,
        week_before: shiftIsoDay(lastVisitDay, -7),
        month_before: shiftIsoDay(lastVisitDay, -30),
        first_visit_day: firstVisitDay,
    };
}

/** Une cache du jour prête pour l'éditeur : `geocache_id` nul tant qu'elle n'est pas importée. */
export type GpsPreparedEntry = GpsVisitEntry & { geocache_id: number | null };

/** Réponse de `POST /api/gps-visits/prepare`. */
export interface GpsPreparedDay {
    day: string;
    entries: GpsPreparedEntry[];
    /** Caches à importer avant d'ouvrir l'éditeur. */
    missing_codes: string[];
    /** Visites sans code : à rattacher (elles ne partent pas dans l'éditeur). */
    without_code: GpsVisitEntry[];
    /** Caches absentes de la base et non tentées : pas importées pour rien. */
    skipped_unattempted: string[];
    last_zone_id: number | null;
}

/** « 27/09/2026 » : nom proposé pour une nouvelle zone (« Sortie du 27/09/2026 »). */
export function formatFullDay(isoDay: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDay);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : isoDay;
}

export interface LogEditorOpening {
    geocacheIds: number[];
    title: string;
    prefill: LogEditorPrefill;
}

/**
 * Ce qu'il faut à l'éditeur de logs pour un jour : les géocaches dans l'ordre de
 * visite (il pilote `@cache_count`), la date et, par cache, le type proposé et
 * l'aide-mémoire du GPS. Les caches pas encore importées sont laissées de côté.
 */
export function buildLogEditorOpening(prepared: GpsPreparedDay): LogEditorOpening {
    const geocacheIds: number[] = [];
    const perCacheLogType: Record<number, LogTypeValue> = {};
    const perCacheVisit: Record<number, GpsVisitHint> = {};
    for (const entry of prepared.entries) {
        const id = entry.geocache_id;
        if (id === null || id === undefined || perCacheVisit[id]) {
            continue;
        }
        geocacheIds.push(id);
        perCacheLogType[id] = entry.proposed_log_type;
        perCacheVisit[id] = {
            time: entry.time,
            statusRaw: entry.status_raw,
            comment: entry.comment || undefined,
            passes: describePasses(entry)?.tooltip,
            hasNm: entry.has_nm || undefined,
            needsConfirmation: entry.needs_confirmation || undefined,
        };
    }
    return {
        geocacheIds,
        title: `Log GPS — ${formatShortDay(prepared.day)}`,
        prefill: { source: 'gps-visits', logDate: prepared.day, perCacheLogType, perCacheVisit },
    };
}
