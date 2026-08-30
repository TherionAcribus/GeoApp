/**
 * Service de soumission des logs vers Geocaching.com (via le backend).
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 3). Fonctions pures :
 * les appels HTTP et la construction du récapitulatif sont ici, l'orchestration
 * de l'état (boucle de soumission, statuts par cache, progression) reste dans le widget.
 */

import { ConfirmDialog } from '@theia/core/lib/browser';
import { dayOffsetFromToday, formatIsoDateFr, getLogTypeLabel, todayIsoDate } from './helpers';
import { GeocacheListItem, LogTypeValue, SelectedLogImage } from './types';

/** URL de base du backend GeoApp. */
export type BackendBaseUrl = string;

/** Payload d'envoi d'un log vers le backend. */
export interface SubmitLogPayload {
    text: string;
    date: string;
    logType: LogTypeValue;
    favorite: boolean;
    images?: string[];
}

/** Résultat structuré d'un envoi de log. */
export interface SubmitLogResult {
    ok: boolean;
    /** logReferenceCode renvoyé par Geocaching.com (en cas de succès). */
    logReferenceCode?: string;
    /** Vrai si le backend a détecté un log déjà existant (HTTP 409 + ALREADY_LOGGED). */
    alreadyLogged?: boolean;
    /** Date de trouvaille renvoyée par le backend dans le cas "already logged" (Found it uniquement). */
    foundDate?: string;
    /** Type de log que GC a déjà accepté, quand déjàLogged est vrai pour une note/DNF. */
    alreadyLoggedLogType?: LogTypeValue;
    /** Message d'erreur exploitable (en cas d'échec). */
    error?: string;
}

/** Upload une seule image vers le backend. */
export async function uploadOneLogImage(
    backendBaseUrl: BackendBaseUrl,
    geocacheId: number,
    img: SelectedLogImage
): Promise<SelectedLogImage> {
    try {
        const form = new FormData();
        form.append('image_file', img.file, img.file.name);

        const res = await fetch(`${backendBaseUrl}/api/geocaches/${geocacheId}/logs/images/upload`, {
            method: 'POST',
            credentials: 'include',
            body: form,
        });

        let body: any = undefined;
        try {
            body = await res.json();
        } catch {
            body = undefined;
        }

        if (!res.ok) {
            const detail = body?.error ? `: ${body.error}` : '';
            return { ...img, status: 'failed', error: `HTTP ${res.status}${detail}` };
        }

        const guid = typeof body?.image_guid === 'string' ? body.image_guid : undefined;
        if (!guid) {
            return { ...img, status: 'failed', error: 'Missing image_guid' };
        }

        return { ...img, status: 'ok', imageGuid: guid, error: undefined };
    } catch (e) {
        console.error('[log-submit-service] uploadOneLogImage error', e);
        return { ...img, status: 'failed', error: 'Erreur réseau/backend' };
    }
}

/** Délai avant timeout d'un envoi de log (ms). GC peut mettre 10-15s avec des photos. */
const SUBMIT_TIMEOUT_MS = 30_000;

/** Délai avant un retry réseau (ms) : assez court pour ne pas bloquer l'utilisateur, assez long pour laisser le réseau revenir. */
const SUBMIT_RETRY_DELAY_MS = 1_500;

/**
 * Tente un envoi de log avec timeout.
 *
 * Retourne `{ retriable: true }` si l'erreur est réseau (timeout ou échec de connexion) :
 * le caller peut alors réessayer. Retourne `{ retriable: false, result }` si le backend
 * a répondu (même avec un code d'erreur) : la réponse est exploitable, pas de retry.
 */
async function submitOneLogWithTimeout(
    backendBaseUrl: BackendBaseUrl,
    geocacheId: number,
    payload: SubmitLogPayload
): Promise<{ retriable: true } | { retriable: false; result: SubmitLogResult }> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);
    try {
        const res = await fetch(`${backendBaseUrl}/api/geocaches/${geocacheId}/logs/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload),
            signal: controller.signal,
        });

        let body: any = undefined;
        try {
            body = await res.json();
        } catch {
            body = undefined;
        }

        if (res.ok) {
            const ref = typeof body?.log_reference_code === 'string' ? body.log_reference_code : undefined;
            return { retriable: false, result: { ok: true, logReferenceCode: ref } };
        }

        const errorCode = typeof body?.error_code === 'string' ? body.error_code : undefined;
        if (res.status === 409 && errorCode === 'ALREADY_LOGGED') {
            // Le backend ne renvoie found_date que pour les "Found it". Pour les notes/DNF,
            // on transmet le type de log pour que le widget sache qu'il ne faut pas marquer
            // la cache comme "already_found".
            const foundDate = typeof body?.found_date === 'string' ? body.found_date : undefined;
            const alreadyLoggedLogType: LogTypeValue | undefined = foundDate
                ? 'found'
                : (payload.logType === 'dnf' ? 'dnf' : payload.logType === 'note' ? 'note' : undefined);
            return {
                retriable: false,
                result: { ok: false, alreadyLogged: true, foundDate, alreadyLoggedLogType },
            };
        }

        const detail = body?.error ? `: ${body.error}` : '';
        return { retriable: false, result: { ok: false, error: `Envoi refusé par le backend${detail}` } };
    } catch (e) {
        // TypeError = échec de connexion (réseau coupé, DNS, etc.)
        // AbortError = timeout
        // Dans les deux cas, le backend n'a pas répondu : on peut réessayer sans risque de doublon
        // (si le log a été accepté, le retry recevra un 409 ALREADY_LOGGED, géré ci-dessus).
        const isAbort = e instanceof DOMException && e.name === 'AbortError';
        const isNetwork = e instanceof TypeError;
        if (isAbort || isNetwork) {
            console.warn('[log-submit-service] submitOneLog réseau/timéout, retry possible', e);
            return { retriable: true };
        }
        // Autre erreur inattendue : pas de retry
        console.error('[log-submit-service] submitOneLog error', e);
        return { retriable: false, result: { ok: false, error: 'Erreur réseau/backend' } };
    } finally {
        window.clearTimeout(timer);
    }
}

/** Soumet un log vers le backend, avec un retry automatique unique sur erreur réseau. */
export async function submitOneLog(
    backendBaseUrl: BackendBaseUrl,
    geocacheId: number,
    payload: SubmitLogPayload
): Promise<SubmitLogResult> {
    const first = await submitOneLogWithTimeout(backendBaseUrl, geocacheId, payload);
    if (first.retriable === false) {
        return first.result;
    }

    // Retry unique après un court délai. Le cas vicieux (timeout après acceptation par GC)
    // est sûr : le retry recevra un 409 ALREADY_LOGGED, géré par submitOneLogWithTimeout.
    await new Promise(resolve => window.setTimeout(resolve, SUBMIT_RETRY_DELAY_MS));
    const retry = await submitOneLogWithTimeout(backendBaseUrl, geocacheId, payload);
    if (retry.retriable === false) {
        return retry.result;
    }

    // Deux échecs réseau consécutifs : on abandonne.
    return { ok: false, error: 'Erreur réseau (2 tentatives échouées)' };
}

/** Libellé affichable d'un type de log (ré-exporté depuis helpers pour compat). */
export { getLogTypeLabel };

/** Formate une date `YYYY-MM-DD` en ISO avec heure fixe pour l'API field notes. */
export function formatVisitedIso(dateOnly: string): string {
    const safe = (dateOnly || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(safe)) {
        return `${todayIsoDate()}T12:00Z`;
    }
    return `${safe}T12:00Z`;
}

/** Échappe le texte d'une field note (format CSV GSAK). */
export function escapeFieldNotesText(value: string): string {
    return (value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/"/g, '""');
}

/** Contexte nécessaire à la construction du récapitulatif avant envoi. */
export interface SubmissionSummaryContext {
    logDate: string;
    useSameTextForAll: boolean;
    geocaches: GeocacheListItem[];
    perCacheFavorite: Record<number, boolean>;
    globalImagesCount: number;
    /** Type de log effectif d'une géocache (sanitizé). */
    getLogTypeForGeocacheId: (geocacheId: number) => LogTypeValue;
    /** Nombre d'images pour une géocache. */
    getImagesForGeocacheId: (geocacheId: number) => number;
    /** Vrai si la géocache est marquée "Ne pas loguer". */
    isGeocacheSkipped: (geocacheId: number) => boolean;
    /** Vrai si le log a déjà été envoyé avec succès. */
    isGeocacheSubmittedOk: (geocacheId: number) => boolean;
}

/** Construit le nœud DOM du récapitulatif avant envoi. */
export function buildSubmissionSummaryNode(
    toSubmit: GeocacheListItem[],
    ctx: SubmissionSummaryContext
): HTMLElement {
    const node = document.createElement('div');
    node.style.textAlign = 'left';
    node.style.lineHeight = '1.5';

    const intro = document.createElement('div');
    intro.style.marginBottom = '8px';
    intro.textContent = toSubmit.length === 1
        ? '1 log va être publié sur Geocaching.com :'
        : `${toSubmit.length} logs vont être publiés sur Geocaching.com :`;
    node.appendChild(intro);

    const list = document.createElement('ul');
    list.style.margin = '0';
    list.style.paddingLeft = '18px';
    node.appendChild(list);

    const addLine = (text: string, highlight = false): void => {
        const item = document.createElement('li');
        item.textContent = text;
        if (highlight) {
            item.style.color = 'var(--theia-editorWarning-foreground, var(--theia-errorForeground))';
            item.style.fontWeight = '600';
        }
        list.appendChild(item);
    };

    const counts: Record<'found' | 'dnf' | 'note', number> = { found: 0, dnf: 0, note: 0 };
    for (const gc of toSubmit) {
        const logTypeForGc = ctx.getLogTypeForGeocacheId(gc.id);
        if (logTypeForGc !== 'skip') {
            counts[logTypeForGc] += 1;
        }
    }
    if (counts.found > 0) {
        addLine(`✅ ${counts.found} × Found it`);
    }
    if (counts.dnf > 0) {
        addLine(`❌ ${counts.dnf} × Didn't find it`);
    }
    if (counts.note > 0) {
        addLine(`📝 ${counts.note} × Write note`);
    }

    const offset = dayOffsetFromToday(ctx.logDate);
    let dateSuffix = '';
    if (offset === 0) {
        dateSuffix = " (aujourd'hui)";
    } else if (offset === -1) {
        dateSuffix = ' (hier)';
    } else if (offset !== undefined && offset < 0) {
        dateSuffix = ` (il y a ${-offset} jours)`;
    } else if (offset !== undefined && offset > 0) {
        dateSuffix = offset === 1 ? ' (demain !)' : ` (dans ${offset} jours !)`;
    }
    addLine(`📅 Date de visite : ${formatIsoDateFr(ctx.logDate)}${dateSuffix}`, offset !== undefined && offset > 0);

    const favorites = toSubmit.filter(gc => ctx.getLogTypeForGeocacheId(gc.id) === 'found' && ctx.perCacheFavorite[gc.id] === true).length;
    if (favorites > 0) {
        addLine(`⭐ ${favorites} point(s) favori(s) donné(s)`);
    }

    const photoCount = toSubmit.reduce((total, gc) => total + ctx.getImagesForGeocacheId(gc.id), 0);
    if (photoCount > 0) {
        addLine(ctx.useSameTextForAll
            ? `🖼️ ${ctx.globalImagesCount} photo(s) sur chacun des logs`
            : `🖼️ ${photoCount} photo(s) au total`);
    }

    const skipped = ctx.geocaches.filter(gc => ctx.isGeocacheSkipped(gc.id));
    if (skipped.length > 0) {
        const codes = skipped.slice(0, 6).map(gc => gc.gc_code).join(', ');
        const more = skipped.length > 6 ? `, +${skipped.length - 6}` : '';
        addLine(`⏭️ ${skipped.length} géocache(s) en « Ne pas loguer », non envoyée(s) : ${codes}${more}`);
    }

    const alreadySent = ctx.geocaches.filter(gc => ctx.isGeocacheSubmittedOk(gc.id)).length;
    if (alreadySent > 0) {
        addLine(`✔️ ${alreadySent} log(s) déjà envoyé(s) plus tôt, non renvoyé(s)`);
    }

    const footer = document.createElement('div');
    footer.style.marginTop = '10px';
    footer.style.opacity = '0.75';
    footer.textContent = "Un log publié ne peut plus être modifié ni supprimé depuis l'application.";
    node.appendChild(footer);

    return node;
}

/** Ouvre la boîte de dialogue de confirmation d'envoi. */
export async function confirmSubmission(
    toSubmit: GeocacheListItem[],
    ctx: SubmissionSummaryContext
): Promise<boolean> {
    const dialog = new ConfirmDialog({
        title: 'Envoyer sur Geocaching.com ?',
        msg: buildSubmissionSummaryNode(toSubmit, ctx),
        ok: toSubmit.length === 1 ? 'Envoyer le log' : `Envoyer les ${toSubmit.length} logs`,
        cancel: 'Annuler',
        maxWidth: 520,
    });
    return (await dialog.open()) === true;
}

/** Construit le contenu d'une field note (format CSV GSAK). */
export function buildFieldNotes(
    geocaches: GeocacheListItem[],
    logDate: string,
    useSameTextForAll: boolean,
    globalText: string,
    perCacheText: Record<number, string>,
    getLogTypeForGeocacheId: (geocacheId: number) => LogTypeValue,
    isGeocacheSkipped: (geocacheId: number) => boolean
): string {
    const visited = formatVisitedIso(logDate);

    // "Ne pas loguer" n'existe pas dans le format field notes : ces géocaches sont simplement absentes.
    const lines = geocaches
        .filter(gc => !isGeocacheSkipped(gc.id))
        .map(gc => {
            const rawText = useSameTextForAll ? globalText : (perCacheText[gc.id] ?? '');
            const escaped = escapeFieldNotesText(rawText);
            return `${gc.gc_code},${visited},${getLogTypeLabel(getLogTypeForGeocacheId(gc.id))},"${escaped}"`;
        });

    return lines.join('\n');
}
