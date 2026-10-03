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
    /** La cache telle que les GPX du GPS la décrivent, quand elle n'est pas encore dans l'App. */
    device?: GpsDeviceCacheInfo | null;
    /** Position de la visite sur la trace du GPS. */
    position?: { latitude: number; longitude: number } | null;
    /** `track` : positionnée ; `no_track` : trace cherchée, pas trouvée ; nul : pas encore cherchée. */
    position_source?: 'track' | 'no_track' | null;
    /** Où placer la cache sur la carte : l'App, sinon les GPX du GPS, sinon la visite sur la trace. */
    map_position?: { latitude: number; longitude: number; source: 'app' | 'gps' | 'visit' } | null;
}

export interface GpsDeviceCacheInfo {
    gc_code: string;
    name: string | null;
    cache_type: string | null;
    latitude: number | null;
    longitude: number | null;
    /** Date du GPX (chargement de la Pocket Query sur le GPS). */
    gpx_date: string | null;
}

export interface GpsVisitDay {
    day: string;
    entries: GpsVisitEntry[];
    /** Zone de la sortie, si ce jour a déjà été préparé. */
    zone?: { id: number; name: string } | null;
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
    /** Visites déjà connues complétées par geocache_logs.xml (fuseau, secondes). */
    enriched?: number;
    /** Lecture du GPS : caches des GPX, positionnement sur les traces. */
    device?: GpsDeviceReport | null;
}

export interface GpsDeviceReport {
    source?: string;
    gpx_indexed?: number;
    positioned?: number;
    no_track?: number;
    tracks_read?: number;
    /** `after_cutoff` : positionnement reporté au choix du point de départ. */
    positioning?: 'done' | 'after_cutoff';
}

export interface DetectedVisitsFile {
    path: string;
    size: number;
    modified: string;
}

/** Un GPS branché (dossier Garmin), tel que `detect` le décrit. */
export interface DetectedDevice {
    root: string;
    visits_file: string | null;
    has_logs_xml: boolean;
    has_visits_txt: boolean;
    tracks_count: number;
    gpx_count: number;
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

export type CacheKnowledgeKind = 'no-code' | 'logged-same-day' | 'found-before' | 'in-app' | 'on-gps' | 'to-import';

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
    if (entry.device) {
        const date = entry.device.gpx_date ? formatShortDay(entry.device.gpx_date) : undefined;
        return {
            kind: 'on-gps',
            label: 'Sur le GPS',
            tooltip: `Décrite par les GPX du GPS${date ? ` (chargés le ${date})` : ''} : ajoutée sans téléchargement`,
        };
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
    if (report.enriched) {
        parts.push(`${report.enriched} complétée${report.enriched > 1 ? 's' : ''} (fuseau)`);
    }
    if (report.unreadable_count > 0) {
        parts.push(`${report.unreadable_count} ligne${report.unreadable_count > 1 ? 's' : ''} illisible${report.unreadable_count > 1 ? 's' : ''}`);
    }
    const device = report.device;
    if (device?.positioned) {
        parts.push(`${device.positioned} positionnée${device.positioned > 1 ? 's' : ''} sur la trace`);
    }
    if (device?.gpx_indexed) {
        parts.push(`${device.gpx_indexed} cache${device.gpx_indexed > 1 ? 's' : ''} lue${device.gpx_indexed > 1 ? 's' : ''} dans les GPX`);
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

/** Ce qui arrivera à une cache dans la zone de la sortie. */
export type GpsPreparationPlan = 'existing' | 'copy' | 'gps' | 'download';

/** Une cache retenue pour la sortie (`POST /api/gps-visits/prepare`). */
export type GpsPreparedEntry = GpsVisitEntry & {
    plan: GpsPreparationPlan;
    /** Sa géocache dans la zone de la sortie, quand elle y est déjà. */
    target_geocache_id: number | null;
};

/** Une visite laissée de côté : sans code (à rattacher) ou non tentée. */
export type GpsExcludedEntry = GpsVisitEntry & { reason: 'without_code' | 'unattempted' };

/** Récapitulatif de « Préparer la sortie ». */
export interface GpsPreparation {
    days: string[];
    entries: GpsPreparedEntry[];
    excluded: GpsExcludedEntry[];
    counts: Record<GpsPreparationPlan | 'without_code' | 'unattempted', number>;
    zone_id: number | null;
    /** Zone déjà associée à ces jours, sinon la dernière utilisée. */
    suggested_zone_id: number | null;
}

/** « 27/09/2026 » : nom proposé pour une nouvelle zone (« Sortie du 27/09/2026 »). */
export function formatFullDay(isoDay: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDay);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : isoDay;
}

/** « Sortie du 27/09/2026 », « Sortie du 26 au 27/09/2026 », « Sortie du 30/09 au 01/10/2026 ». */
export function defaultOutingZoneName(days: string[]): string {
    const sorted = [...days].sort();
    if (sorted.length === 0) {
        return 'Sortie';
    }
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (first === last) {
        return `Sortie du ${formatFullDay(first)}`;
    }
    const [fy, fm, fd] = first.split('-');
    const [ly, lm] = last.split('-');
    const from = fy !== ly ? formatFullDay(first) : fm !== lm ? `${fd}/${fm}` : fd;
    return `Sortie du ${from} au ${formatFullDay(last)}`;
}

/** Lignes du récapitulatif, dans l'ordre d'affichage (les compteurs nuls sont omis). */
export function describePreparation(counts: GpsPreparation['counts'], newZone: boolean): string[] {
    const plural = (n: number, one: string, many: string): string => `${n} ${n > 1 ? many : one}`;
    const lines: string[] = [];
    if (counts.existing) {
        lines.push(`✔️ ${plural(counts.existing, 'cache déjà dans la zone', 'caches déjà dans la zone')}`);
    }
    if (counts.copy) {
        lines.push(`➕ ${plural(counts.copy, 'cache connue ailleurs, ajoutée', 'caches connues ailleurs, ajoutées')} à la zone`
            + ' (elles restent aussi dans leurs zones)');
    }
    if (counts.gps) {
        lines.push(`📟 ${plural(counts.gps, 'cache créée', 'caches créées')} depuis les GPX du GPS (sans téléchargement)`);
    }
    if (counts.download) {
        lines.push(`⬇️ ${plural(counts.download, 'cache à télécharger', 'caches à télécharger')}`);
    }
    if (counts.without_code) {
        lines.push(`⏭️ ${plural(counts.without_code, 'visite sans code laissée', 'visites sans code laissées')} de côté (à rattacher d'abord)`);
    }
    if (counts.unattempted) {
        lines.push(`⏭️ ${plural(counts.unattempted, 'visite non tentée laissée', 'visites non tentées laissées')} de côté`);
    }
    if (newZone && lines.length > 0) {
        lines.unshift('🆕 La zone sera créée.');
    }
    return lines;
}

export interface LogEditorOpening {
    geocacheIds: number[];
    title: string;
    prefill: LogEditorPrefill;
}

/**
 * Un onglet de log par jour (l'éditeur n'a qu'une date par onglet) : les géocaches de
 * la zone de la sortie dans l'ordre de visite (il pilote `@cache_count`), la date et,
 * par cache, le type proposé et l'aide-mémoire du GPS. Une cache pas encore dans la
 * zone (ajout en échec) est laissée de côté.
 */
export function buildLogEditorOpenings(preparation: GpsPreparation): LogEditorOpening[] {
    const byDay = new Map<string, GpsPreparedEntry[]>();
    for (const entry of preparation.entries) {
        if (entry.target_geocache_id === null || entry.target_geocache_id === undefined) {
            continue;
        }
        byDay.set(entry.day, [...(byDay.get(entry.day) ?? []), entry]);
    }
    return [...byDay.keys()].sort().map(day => {
        const geocacheIds: number[] = [];
        const perCacheLogType: Record<number, LogTypeValue> = {};
        const perCacheVisit: Record<number, GpsVisitHint> = {};
        for (const entry of byDay.get(day)!) {
            const id = entry.target_geocache_id!;
            if (perCacheVisit[id]) {
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
            title: `Log GPS — ${formatShortDay(day)}`,
            prefill: { source: 'gps-visits', logDate: day, perCacheLogType, perCacheVisit },
        };
    });
}

/** Une ligne se coche si elle peut partir dans une sortie : à loguer, avec un code (lu ou rattaché). */
export function isSelectable(entry: GpsVisitEntry): boolean {
    return entry.state === 'pending' && !!entry.gc_code;
}

/** État de la case d'un jour : toutes, une partie ou aucune de ses lignes cochables. */
export function daySelectionState(day: GpsVisitDay, selected: ReadonlySet<string>): 'all' | 'some' | 'none' {
    const selectable = day.entries.filter(isSelectable);
    const count = selectable.filter(e => selected.has(e.key)).length;
    return count === 0 ? 'none' : count === selectable.length ? 'all' : 'some';
}

export type GpsCandidateConfidence = 'confirmed' | 'close_day' | 'same_day' | 'around' | 'other_day' | null;

/** Un candidat au rattachement d'une visite sans code (`GET /api/gps-visits/<id>/candidates`). */
export interface GpsResolutionCandidate {
    gc_code: string;
    name: string | null;
    cache_type: string | null;
    found_by_me: boolean | null;
    /** Ma date de trouvaille (AAAA-MM-JJ), lue sur Geocaching.com. */
    found_on: string | null;
    sources: ('neighbours' | 'my_finds')[];
    day_confidence: GpsCandidateConfidence;
    distance_m: number | null;
}

export interface GpsResolutionResult {
    visit_id: number;
    day: string;
    neighbours: { gc_code: string; name: string | null; located: boolean }[];
    located: boolean;
    search_radius_m: number | null;
    /** `not_requested` tant que la recherche approfondie n'a pas été demandée. */
    finds_state: 'not_requested' | 'ok' | 'out_of_reach' | 'empty' | 'unavailable';
    candidates: GpsResolutionCandidate[];
    authenticated: boolean;
}

/** « 129 m », « 1,7 km ». */
export function formatDistance(meters: number | null): string | undefined {
    if (meters === null || meters === undefined) {
        return undefined;
    }
    return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
}

/** Ce qu'on sait du jour de trouvaille d'un candidat, pour son badge. */
export function describeCandidateDay(candidate: GpsResolutionCandidate): { kind: 'strong' | 'medium' | 'weak'; label: string } {
    const foundOn = candidate.found_on ? formatFullDay(candidate.found_on) : undefined;
    switch (candidate.day_confidence) {
        case 'confirmed':
            return { kind: 'strong', label: 'Trouvée ce jour-là' };
        case 'close_day':
            return { kind: 'medium', label: `Trouvée le ${foundOn} (log à quelques jours près)` };
        case 'same_day':
            return { kind: 'medium', label: 'Trouvée ce jour-là (déduit de l\'ordre de tes trouvailles)' };
        case 'around':
            return { kind: 'weak', label: 'Trouvée vers ce jour (déduit de l\'ordre de tes trouvailles)' };
        case 'other_day':
            return { kind: 'weak', label: `Trouvée le ${foundOn}` };
        default:
            return candidate.found_by_me
                ? { kind: 'weak', label: 'Trouvée (date inconnue)' }
                : { kind: 'weak', label: 'Jamais trouvée (DNF ?)' };
    }
}

/** Phrase sur les voisines utilisées pour situer la visite. */
export function describeNeighbours(result: GpsResolutionResult): string {
    if (result.neighbours.length === 0) {
        return 'Aucune visite codée à moins d\'1 h 30 ce jour-là : la recherche de proximité est impossible.';
    }
    const names = result.neighbours.map(n => `${n.gc_code}${n.name ? ` (${n.name})` : ''}${n.located ? '' : ' — non située'}`);
    const radius = result.search_radius_m ? `, recherche dans un rayon d'environ ${formatDistance(result.search_radius_m)}` : '';
    return `Situé grâce à ${names.join(' et ')}${radius}.`;
}

/* ------------------------------------------------------------------ carte */

/** Couleur de la pastille d'une visite sur la carte, selon son résultat. */
export const GPS_STATUS_COLORS: Record<GpsVisitStatus, string> = {
    found: '#2e7d32',
    dnf: '#c62828',
    needs_maintenance: '#ef6c00',
    unattempted: '#757575',
    other: '#5e35b1',
};
const WITHOUT_CODE_COLOR = '#6a1b9a';

/** Un point de la carte des visites GPS (forme attendue par la carte : `MapGeocache`). */
export interface GpsMapPoint {
    /** Identifiant de la première visite de l'entrée : unique, et clé de la sélection. */
    id: number;
    gc_code: string;
    name: string;
    cache_type: string;
    latitude: number;
    longitude: number;
    /** Estompée : déjà loguée ou ignorée. */
    found: boolean;
    badgeText: string;
    badgeColor: string;
    popupNote: string;
    /** Géocache GeoApp à ouvrir, ou `null` (pas encore dans l'App, visite sans code). */
    openGeocacheId: number | null;
    /** Entrée de la liste correspondante. */
    entryKey: string;
}

/**
 * Points de la carte pour ces jours : numérotés **par jour** dans l'ordre de visite,
 * colorés selon le résultat. Une entrée sans position connue n'est pas placée.
 */
export function buildMapPoints(days: GpsVisitDay[]): GpsMapPoint[] {
    const points: GpsMapPoint[] = [];
    for (const day of days) {
        day.entries.forEach((entry, index) => {
            const position = entry.map_position;
            if (!position) {
                return;
            }
            const number = String(index + 1);
            const details = [`${formatShortDay(entry.day)} ${entry.time}`, statusLabel(entry)];
            if (entry.comment) {
                details.push(`« ${entry.comment} »`);
            }
            if (position.source === 'visit') {
                details.push('position de la visite sur la trace');
            }
            points.push({
                id: entry.visit_ids[0],
                gc_code: entry.gc_code ?? '?',
                name: entry.name ?? (entry.gc_code ? '' : 'Visite sans code'),
                cache_type: entry.cache_type ?? entry.device?.cache_type ?? 'Unknown Cache',
                latitude: position.latitude,
                longitude: position.longitude,
                found: entry.state !== 'pending',
                badgeText: entry.gc_code ? number : `${number}?`,
                badgeColor: entry.gc_code ? GPS_STATUS_COLORS[entry.status] : WITHOUT_CODE_COLOR,
                popupNote: details.join(' — '),
                openGeocacheId: entry.geocaches[0]?.id ?? null,
                entryKey: entry.key,
            });
        });
    }
    return points;
}

/** Jours à montrer sur la carte : ceux de la sélection, sinon ceux qui sont dépliés. */
export function mapDays(days: GpsVisitDay[], selected: ReadonlySet<string>, collapsed: ReadonlySet<string>): GpsVisitDay[] {
    if (selected.size > 0) {
        const withSelection = days.filter(day => day.entries.some(entry => selected.has(entry.key)));
        if (withSelection.length > 0) {
            return withSelection;
        }
    }
    return days.filter(day => !collapsed.has(day.day));
}
