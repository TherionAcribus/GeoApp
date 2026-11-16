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

/** Langues proposees pour les echanges et pour le message au proprietaire. */
export const EARTHCOACH_LANGUAGE_OPTIONS: Array<{ value: string; label: string }> =
    Object.entries(LANGUAGE_LABELS).map(([value, label]) => ({ value, label }));

/** Code de langue d'une description complete que la detection n'a pas su attribuer. */
const UNKNOWN_LANGUAGE = 'full';

export function labelFor(language: string): string {
    if (language === UNKNOWN_LANGUAGE) {
        return 'Langue non détectée';
    }
    if (language.includes('+')) {
        return language.split('+').map(labelFor).join(' + ');
    }
    return LANGUAGE_LABELS[language] || language.toUpperCase();
}

/**
 * Mots-outils frequents et propres a chaque langue: les mots partages
 * (`de`, `en`, `la`, `is`...) gonfleraient la langue concurrente.
 */
const LANGUAGE_STOPWORDS: Record<string, Set<string>> = {
    fr: new Set(['le', 'les', 'des', 'est', 'et', 'une', 'dans', 'qui', 'pour', 'pas', 'sur', 'sont', 'avec', 'cette', 'du', 'au', 'aux', 'nous', 'vous', 'ces', 'mais', 'être', 'était', 'peut', 'été']),
    en: new Set(['the', 'and', 'of', 'to', 'are', 'with', 'this', 'that', 'which', 'from', 'you', 'your', 'was', 'were', 'have', 'has', 'be', 'it', 'on', 'at', 'by', 'will', 'can', 'there', 'these']),
    de: new Set(['der', 'die', 'das', 'und', 'ist', 'nicht', 'mit', 'ein', 'eine', 'von', 'zu', 'den', 'dem', 'sich', 'auf', 'auch', 'wird', 'sind', 'im', 'für', 'aus', 'bei', 'wie', 'werden', 'ich']),
    es: new Set(['el', 'los', 'las', 'y', 'muy', 'está', 'más', 'pero', 'también', 'sus', 'hay', 'ser', 'fue', 'desde', 'entre', 'sobre', 'cuando', 'puede', 'donde', 'usted', 'estos']),
    it: new Set(['gli', 'della', 'delle', 'dei', 'degli', 'che', 'è', 'sono', 'nel', 'nella', 'alla', 'anche', 'questo', 'questa', 'molto', 'più', 'di', 'ed', 'perché', 'essere', 'dalla', 'una']),
    nl: new Set(['het', 'een', 'van', 'niet', 'op', 'met', 'voor', 'zijn', 'dat', 'worden', 'ook', 'aan', 'bij', 'naar', 'wordt', 'deze', 'er', 'maar', 'uit', 'kan', 'hier', 'dit']),
    pt: new Set(['os', 'não', 'uma', 'em', 'ao', 'é', 'são', 'mais', 'também', 'pelo', 'pela', 'você', 'muito', 'foi', 'isso', 'nos', 'seu', 'sua', 'dos', 'das', 'até']),
};

/** En dessous, le texte est trop court pour trancher. */
const MIN_STOPWORD_HITS = 8;
/** Une seconde langue au-dela de cette part de la premiere signale un listing bilingue. */
const SECOND_LANGUAGE_RATIO = 0.35;

/**
 * Langue(s) d'un texte de listing par comptage de mots-outils: une langue
 * (`fr`), deux langues melangees sans separation exploitable (`fr+en`), ou
 * `undefined` si le texte est trop court.
 */
export function detectListingLanguage(text: string): string | undefined {
    const counts = new Map<string, number>();
    for (const word of (text || '').toLowerCase().match(/\p{L}+/gu) || []) {
        for (const [language, stopwords] of Object.entries(LANGUAGE_STOPWORDS)) {
            if (stopwords.has(word)) {
                counts.set(language, (counts.get(language) || 0) + 1);
            }
        }
    }
    const ranked = Array.from(counts.entries()).sort((left, right) => right[1] - left[1]);
    if (!ranked.length || ranked[0][1] < MIN_STOPWORD_HITS) {
        return undefined;
    }
    const [first, second] = ranked;
    return second && second[1] >= first[1] * SECOND_LANGUAGE_RATIO ? `${first[0]}+${second[0]}` : first[0];
}

/**
 * Langues redigees par le proprietaire: versions separees, ou langue(s)
 * detectee(s) dans la description complete. Une description surchargee est
 * le texte de l'utilisateur et ne dit rien du poseur.
 */
export function listingAuthoredLanguages(selection: EarthCoachDescriptionSelection): string[] | undefined {
    if (selection.versions.some(candidate => candidate.source === 'override')) {
        return undefined;
    }
    const languages = selection.versions
        .flatMap(candidate => candidate.language.split('+'))
        .filter(language => language !== UNKNOWN_LANGUAGE);
    return languages.length ? languages : undefined;
}

/**
 * Langue du message final au proprietaire: celle de l'utilisateur si le
 * listing la propose (le poseur la pratique), l'anglais sinon. `undefined`
 * quand la langue du listing est inconnue: le modele la deduit des questions.
 */
export function resolveFinalAnswerLanguage(userLanguage: string, listingLanguages?: string[]): string | undefined {
    if (!listingLanguages?.length) {
        return undefined;
    }
    return listingLanguages.includes(userLanguage) ? userLanguage : 'en';
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
        const detected = detectListingLanguage(htmlToPlainText(overrideHtml));
        const language = manual || (detected && !detected.includes('+') ? detected : undefined) || preferred || 'fr';
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

    // Sans versions separees, la langue est detectee dans le texte: le
    // libelle ne doit pas venir des preferences (un listing anglais affiche
    // et annonce au modele comme "Francais").
    const detected = detectListingLanguage(htmlToPlainText(effectiveHtml)) || UNKNOWN_LANGUAGE;
    const selected = version(detected, effectiveHtml, 'full');
    // Un listing dans une seule langue n'a rien a separer.
    const monolingual = detected !== UNKNOWN_LANGUAGE && !detected.includes('+');
    return {
        fingerprint,
        selectedLanguage: detected,
        selected,
        versions: [selected],
        reliable: monolingual,
        notice: monolingual ? undefined : 'La séparation des langues n’est pas assez fiable : la description complète sera utilisée.',
    };
}
