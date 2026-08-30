/**
 * Fonctions pures partagées par le widget d'édition de logs et ses sous-composants.
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 1) : aucune dépendance
 * à l'état du widget, uniquement des paramètres explicites.
 */

import { GeocacheListItem, LogTypeValue, SubmissionStatus } from './types';

/**
 * Date du jour au format ISO `YYYY-MM-DD` en heure **locale**.
 * `toISOString()` renvoie la date UTC : entre minuit et 2h (heure d’été française) on était
 * encore la veille, ce qui pré-datait les logs d'un jour.
 */
export function todayIsoDate(): string {
    const now = new Date();
    const month = `${now.getMonth() + 1}`.padStart(2, '0');
    const day = `${now.getDate()}`.padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
}

/** Date `YYYY-MM-DD` en format français, tel qu'affiché dans les logs et les récapitulatifs. */
export function formatIsoDateFr(iso: string): string {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) {
        return iso;
    }
    return parsed.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Nombre de jours entre `iso` et aujourd'hui (négatif = dans le passé). */
export function dayOffsetFromToday(iso: string): number | undefined {
    const target = Date.parse(`${iso}T12:00:00Z`);
    if (Number.isNaN(target)) {
        return undefined;
    }
    return Math.round((target - Date.parse(`${todayIsoDate()}T12:00:00Z`)) / 86400000);
}

/** Horodatage ISO en date + heure françaises, pour le bandeau de brouillon restauré. */
export function formatIsoDateTimeFr(iso: string): string {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) {
        return iso;
    }
    return parsed.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Une cache déjà trouvée ne peut plus recevoir de "Found it" : par défaut on ne la logue pas du tout. */
export function sanitizeLogTypeForGeocache(value: LogTypeValue, geocache: GeocacheListItem | undefined): LogTypeValue {
    if (value === 'found' && geocache?.already_found === true) {
        return 'skip';
    }
    return value;
}

export function formatFoundDate(iso: string | null | undefined): string | undefined {
    if (!iso) {
        return undefined;
    }
    const ts = Date.parse(iso);
    if (!isFinite(ts)) {
        return undefined;
    }
    return new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function alreadyFoundTooltip(geocache: GeocacheListItem): string {
    const date = formatFoundDate(geocache.found_date);
    return date
        ? `Déjà trouvée le ${date} — "Found it" impossible une seconde fois`
        : 'Déjà trouvée — "Found it" impossible une seconde fois';
}

/** Loguée à l'instant, pendant cette session : ce n'est pas une "déjà trouvée", c'est un envoi réussi. */
export function isJustLogged(geocache: GeocacheListItem, perCacheSubmitStatus: Record<number, SubmissionStatus>): boolean {
    return perCacheSubmitStatus[geocache.id] === 'ok';
}

/** Trouvée avant cette session : c'est le cas qui interdit un nouveau "Found it". */
export function isPreviouslyFound(geocache: GeocacheListItem, perCacheSubmitStatus: Record<number, SubmissionStatus>): boolean {
    return geocache.already_found === true && !isJustLogged(geocache, perCacheSubmitStatus);
}

/** Sera loguée "Didn't find it" : signalée en bleu tant que le log n'est pas parti. */
export function isPendingDnf(
    geocache: GeocacheListItem,
    logTypeForGeocache: LogTypeValue,
    perCacheSubmitStatus: Record<number, SubmissionStatus>
): boolean {
    return logTypeForGeocache === 'dnf' && !isJustLogged(geocache, perCacheSubmitStatus);
}

/** Libellé affichable d'un type de log. */
export function getLogTypeLabel(value: LogTypeValue): string {
    if (value === 'found') {
        return 'Found it';
    }
    if (value === 'dnf') {
        return "Didn't find it";
    }
    if (value === 'skip') {
        return 'Ne pas loguer';
    }
    return 'Write note';
}

/** Taille de fichier lisible : "12 o", "345 Ko", "1,2 Mo". */
export function formatFileSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) {
        return '';
    }
    if (bytes < 1024) {
        return `${bytes} o`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(0)} Ko`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function findPatternTokenStart(beforeCaret: string): number | null {
    const idx = beforeCaret.lastIndexOf('@');
    if (idx === -1) {
        return null;
    }
    const prev = beforeCaret[idx - 1];
    if (idx > 0 && prev && !/\s/.test(prev)) {
        return null;
    }
    return idx;
}

export function getCaretCoordinates(element: HTMLTextAreaElement, position: number): { top: number; left: number } {
    const div = document.createElement('div');
    const style = window.getComputedStyle(element);

    const properties = [
        'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
        'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize',
        'fontSizeAdjust', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform',
        'textIndent', 'textDecoration', 'letterSpacing', 'wordSpacing', 'tabSize'
    ];

    properties.forEach(prop => {
        div.style[prop as any] = style[prop as any];
    });

    div.style.position = 'absolute';
    div.style.visibility = 'hidden';
    div.style.whiteSpace = 'pre-wrap';
    div.style.wordWrap = 'break-word';
    div.style.top = '0px';
    div.style.left = '0px';

    document.body.appendChild(div);

    try {
        div.textContent = element.value.substring(0, position);

        const span = document.createElement('span');
        span.textContent = element.value.substring(position) || '.';
        div.appendChild(span);

        const elementRect = element.getBoundingClientRect();
        const spanRect = span.getBoundingClientRect();
        const divRect = div.getBoundingClientRect();

        return {
            top: elementRect.top + (spanRect.top - divRect.top) + element.scrollTop,
            left: elementRect.left + (spanRect.left - divRect.left) + element.scrollLeft
        };
    } finally {
        // `finally` plutot qu'une simple ligne apres les mesures : un miroir oublie dans
        // le document y resterait invisible mais bien present, une fois par frappe.
        div.remove();
    }
}
