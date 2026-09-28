import { EarthCoachGeocacheData } from './earthcoach-types';
import { EarthCoachDescriptionSelection, EarthCoachDescriptionVersion } from './earthcoach-workspace-types';

const LANGUAGE_LABELS: Record<string, string> = {
    fr: 'Français',
    en: 'English',
    de: 'Deutsch',
    es: 'Español',
    it: 'Italiano',
    nl: 'Nederlands',
    pt: 'Português',
};

const LANGUAGE_MARKERS: Array<{ language: string; pattern: RegExp }> = [
    { language: 'fr', pattern: /^(?:fran[cç]ais|french|version fran[cç]aise)$/i },
    { language: 'en', pattern: /^(?:english|anglais|version anglaise)$/i },
    { language: 'de', pattern: /^(?:deutsch|german|allemand|version allemande)$/i },
    { language: 'es', pattern: /^(?:espa[nñ]ol|spanish|espagnol)$/i },
    { language: 'it', pattern: /^(?:italiano|italian|italien)$/i },
    { language: 'nl', pattern: /^(?:nederlands|dutch|n[ée]erlandais)$/i },
    { language: 'pt', pattern: /^(?:portugu[eê]s|portuguese|portugais)$/i },
];

function normalizeLanguage(value?: string | null): string | undefined {
    const normalized = (value || '').trim().toLowerCase().replace('_', '-').split('-')[0];
    return normalized || undefined;
}

function decodeHtml(value: string): string {
    if (typeof document !== 'undefined') {
        const element = document.createElement('textarea');
        element.innerHTML = value;
        return element.value;
    }
    return value
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");
}

export function htmlToPlainText(html: string): string {
    return decodeHtml(html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p\s*>|<\/div\s*>|<\/li\s*>|<\/h[1-6]\s*>/gi, '\n')
        .replace(/<[^>]+>/g, ' '))
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function fingerprintDescription(value: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}-${value.length}`;
}

function labelFor(language: string): string {
    return LANGUAGE_LABELS[language] || language.toUpperCase();
}

function version(language: string, html: string, source: EarthCoachDescriptionVersion['source']): EarthCoachDescriptionVersion {
    const text = htmlToPlainText(html);
    return {
        language,
        label: labelFor(language),
        html,
        text,
        complete: text.length >= 120,
        source,
    };
}

const LANG_CONTAINER_OPEN_PATTERN = /<(div|section|article|main)\b[^>]*\blang=["']?([a-zA-Z]{2,8}(?:[-_][a-zA-Z]{2,8})?)["']?[^>]*>/gi;

/**
 * Trouve l'index de la balise fermante correspondant a l'ouvrante qui finit
 * a `openEnd`. Une regex non gourmande `.*?<\/div>` s'arrete au premier
 * </div> rencontre, meme quand il ferme un div imbrique: des questions
 * situees apres ce div disparaissaient alors du segment de langue tout en
 * restant declare "fiable". On compte donc l'imbrication des balises du
 * meme nom pour atteindre la vraie fin du bloc.
 */
function findMatchingCloseIndex(html: string, tagName: string, openEnd: number): number {
    const pattern = new RegExp(`<\\/?${tagName}\\b[^>]*>`, 'gi');
    pattern.lastIndex = openEnd;
    let depth = 1;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html))) {
        if (match[0].startsWith('</')) {
            depth -= 1;
        } else if (!/\/\s*>$/.test(match[0])) {
            depth += 1;
        }
        if (depth === 0) {
            return match.index;
        }
    }
    return -1;
}

function extractLangAttributeVersions(html: string): EarthCoachDescriptionVersion[] {
    const versions: EarthCoachDescriptionVersion[] = [];
    const pattern = new RegExp(LANG_CONTAINER_OPEN_PATTERN.source, 'gi');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html))) {
        const language = normalizeLanguage(match[2]);
        if (!language || /\/\s*>$/.test(match[0])) {
            continue;
        }
        const openEnd = match.index + match[0].length;
        const closeIndex = findMatchingCloseIndex(html, match[1].toLowerCase(), openEnd);
        // Balise fermante manquante: le reste du document fait office de
        // segment, plutot que de perdre la fin du listing.
        versions.push(version(language, html.slice(openEnd, closeIndex >= 0 ? closeIndex : html.length), 'segmented'));
        if (closeIndex < 0) {
            break;
        }
        // Les blocs de langue ne s'imbriquent pas: on reprend apres celui-ci
        // pour ne pas re-detector un sous-div porteur de son propre lang.
        pattern.lastIndex = closeIndex;
    }
    return versions;
}

function detectMarkerLanguage(label: string): string | undefined {
    const normalized = htmlToPlainText(label).replace(/[:\-–—]+$/g, '').trim();
    return LANGUAGE_MARKERS.find(marker => marker.pattern.test(normalized))?.language;
}

function extractHeadingVersions(html: string): EarthCoachDescriptionVersion[] {
    const headings = Array.from(html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi));
    const candidates: EarthCoachDescriptionVersion[] = [];
    headings.forEach((heading, index) => {
        const language = detectMarkerLanguage(heading[2]);
        if (!language || heading.index === undefined) {
            return;
        }
        const start = heading.index + heading[0].length;
        const end = headings.slice(index + 1).find(next => detectMarkerLanguage(next[2]))?.index ?? html.length;
        candidates.push(version(language, html.slice(start, end), 'segmented'));
    });
    return candidates;
}

function deduplicateVersions(versions: EarthCoachDescriptionVersion[]): EarthCoachDescriptionVersion[] {
    const byLanguage = new Map<string, EarthCoachDescriptionVersion>();
    for (const candidate of versions) {
        const existing = byLanguage.get(candidate.language);
        if (!existing || candidate.text.length > existing.text.length) {
            byLanguage.set(candidate.language, candidate);
        }
    }
    return Array.from(byLanguage.values()).filter(candidate => Boolean(candidate.text));
}

export function selectEarthCoachDescription(
    geocache: EarthCoachGeocacheData,
    preferredLanguage?: string,
    manualLanguage?: string | null,
    previousFingerprint?: string | null
): EarthCoachDescriptionSelection {
    const overrideHtml = (geocache.description_override_html || geocache.description_override_raw || '').trim();
    const originalHtml = (geocache.description_html || geocache.description_raw || '').trim();
    const effectiveHtml = overrideHtml || originalHtml;
    const fingerprint = fingerprintDescription(effectiveHtml);
    const preferred = normalizeLanguage(preferredLanguage);
    const manual = previousFingerprint === fingerprint ? normalizeLanguage(manualLanguage) : undefined;

    if (overrideHtml) {
        const language = manual || preferred || 'fr';
        const selected = version(language, overrideHtml, 'override');
        return {
            fingerprint,
            selectedLanguage: language,
            selected,
            versions: [selected],
            reliable: true,
        };
    }

    const segmented = deduplicateVersions([
        ...extractLangAttributeVersions(originalHtml),
        ...extractHeadingVersions(originalHtml),
    ]).filter(candidate => candidate.complete);
    if (segmented.length >= 2) {
        const languageOrder = [manual, preferred, 'fr', 'en'].filter((item): item is string => Boolean(item));
        const selected = languageOrder
            .map(language => segmented.find(candidate => candidate.language === language))
            .find((candidate): candidate is EarthCoachDescriptionVersion => Boolean(candidate)) || segmented[0];
        return {
            fingerprint,
            selectedLanguage: selected.language,
            selected,
            versions: segmented,
            reliable: true,
        };
    }

    const fallbackLanguage = manual || preferred || 'full';
    const selected = version(fallbackLanguage, effectiveHtml, 'full');
    return {
        fingerprint,
        selectedLanguage: fallbackLanguage,
        selected,
        versions: [selected],
        reliable: false,
        notice: 'La séparation des langues n’est pas assez fiable : la description complète sera utilisée.',
    };
}
