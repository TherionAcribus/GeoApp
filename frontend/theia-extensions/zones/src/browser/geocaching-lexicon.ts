/**
 * Lexique géocaching partagé par les moteurs IA de GeoApp.
 *
 * Le vocabulaire du géocaching résiste à la traduction automatique : « DNF », « FTF » ou
 * « TFTC » ne doivent jamais être traduits, « container » n'est pas un conteneur de transport,
 * et un « PAT » français devient « FTF » en anglais — sans que l'inverse soit vrai. Ce module
 * porte ce savoir et le met en forme pour un prompt.
 *
 * Trois choix structurants :
 *
 * - **Les règles sont indexées sur le terme source, pas sur un couple de langues.** L'entrée
 *   `PAT` dit « en anglais, écris FTF » ; l'entrée `FTF` dit « ne traduis jamais ». Traduire un
 *   log français vers l'anglais donne donc FTF, et traduire un log anglais vers le français
 *   garde FTF. L'asymétrie voulue tombe toute seule, sans règle inverse à écrire.
 * - **Seuls les termes réellement présents dans le texte partent dans le prompt.** Cinquante
 *   entrées glosées à chaque traduction d'un log de 400 caractères, ce serait payer des tokens
 *   pour noyer la consigne. Même principe que les `@patterns` de `log-translator.ts`.
 * - **Rien n'est réécrit dans le texte.** Le lexique informe le modèle, il ne substitue jamais
 *   de chaîne : le Markdown et les `@patterns` du log restent intacts par construction.
 *
 * Le fond intégré vit dans `shared/lexicons/geocaching-lexicon.json` (versionné, curaté) ; les
 * entrées personnelles vivent dans la préférence `geoApp.logs.translation.lexicon` et
 * surchargent les entrées intégrées terme par terme. Voir `resolveLexicon`.
 */

/** Ce qu'il faut faire du terme quand il est rencontré. */
export type LexiconPolicy = 'keep' | 'map';

/** Une entrée du lexique : un terme, son sens, et la règle qui s'y applique. */
export interface LexiconEntry {
    /** Forme canonique, telle qu'elle s'écrit dans un log. */
    term: string;
    /** Autres formes à détecter : variantes d'orthographe, sigles pointés, synonymes proches. */
    aliases?: string[];
    /** Sens en une ligne. Envoyé au modèle : c'est lui qui évite les contresens sur les sigles. */
    gloss?: string;
    /** `keep` : ne jamais traduire. `map` : utiliser l'équivalent de `translations`. */
    policy: LexiconPolicy;
    /** Équivalents par langue, clé = code renvoyé par `normalizeLanguageKey`. */
    translations?: Record<string, string>;
    /** Entrées personnelles seulement : masque l'entrée intégrée de même terme. */
    disabled?: boolean;
}

/** Forme des fichiers de données de `shared/lexicons/`, vérifiée à la frontière. */
interface LexiconFile { version?: number; entries?: LexiconEntry[] }
interface LanguageKeysFile { keys?: Record<string, string> }

/*
 * Les données sont chargées par `require` et non par `import`.
 *
 * Un `import` ferait entrer ces fichiers dans le graphe du projet TypeScript, où ils tombent
 * hors du `rootDir` de l'extension : TS6059 et TS6307, sur un projet qui compile proprement
 * aujourd'hui. `require` laisse la résolution à webpack, qui trouve exactement le même fichier
 * — `lib/browser` est à la même profondeur que `src/browser`, le chemin relatif est inchangé.
 * Le typage est rétabli ici même, à la frontière.
 */
/* eslint-disable @typescript-eslint/no-var-requires */
const lexiconFile = require('../../../../../shared/lexicons/geocaching-lexicon.json') as LexiconFile;
const languageKeysFile = require('../../../../../shared/lexicons/language-keys.json') as LanguageKeysFile;
/* eslint-enable @typescript-eslint/no-var-requires */

/** Le lexique intégré, curaté et versionné avec l'application. */
export const BUILTIN_GEOCACHING_LEXICON: LexiconEntry[] = lexiconFile.entries ?? [];

// ─────────────────────────────────────────────────────────────────────────────
// Normalisation
// ─────────────────────────────────────────────────────────────────────────────

/** Minuscules sans accents, espaces resserrés : « Point  Favori » et « point favori » sont égaux. */
export function normalizeLexiconText(text: string | undefined): string {
    return (text || '')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Clé d'identité d'une entrée. Deux entrées qui ne diffèrent que par la casse ou les accents
 * sont la même entrée : c'est ce qui permet à une entrée personnelle d'en surcharger une intégrée.
 */
export function lexiconTermKey(term: string | undefined): string {
    return normalizeLexiconText(term);
}

/**
 * Noms de langue reconnus, vers un code ISO 639-1.
 *
 * Les langues de GeoApp sont du texte libre : la liste de l'éditeur de logs contient
 * « Anglais », la préférence de traduction des listings vaut `francais`, et rien n'empêche
 * d'écrire « English ». Sans table, chaque graphie serait une colonne différente du lexique.
 *
 * La table vit dans `shared/` parce que l'éditeur de lexique, dans l'extension des préférences,
 * doit écrire exactement les clés que ce module relit.
 */
const LANGUAGE_KEYS: Record<string, string> = languageKeysFile.keys ?? {};

/**
 * Code de langue d'un nom écrit en clair. Les langues inconnues de la table gardent leur nom
 * normalisé comme clé : « Breton » devient `breton`, stable d'un appel à l'autre, donc
 * utilisable comme colonne d'équivalents.
 */
export function normalizeLanguageKey(language: string | undefined): string {
    const normalized = normalizeLexiconText(language);
    if (!normalized) {
        return '';
    }
    return LANGUAGE_KEYS[normalized] ?? normalized;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fusion intégré + personnel
// ─────────────────────────────────────────────────────────────────────────────

/** Une entrée personnelle exploitable : au minimum un terme non vide. */
function isUsableEntry(entry: unknown): entry is LexiconEntry {
    return Boolean(entry) && typeof (entry as LexiconEntry).term === 'string'
        && (entry as LexiconEntry).term.trim() !== '';
}

const resolveCache = new WeakMap<object, LexiconEntry[]>();

/**
 * Lexique effectif : le fond intégré, corrigé par les entrées personnelles.
 *
 * Une entrée personnelle de même terme **remplace** l'entrée intégrée (elle ne la complète pas :
 * une surcharge partielle laisserait l'utilisateur deviner ce qui reste de l'original) ; avec
 * `disabled: true`, elle la supprime. Les termes inconnus du fond sont ajoutés à la fin.
 *
 * Le fond reste dans le code plutôt que dans la valeur de la préférence : une correction du
 * lexique livrée avec l'application atteint ainsi aussi les utilisateurs qui ont déjà ajouté
 * leurs propres termes.
 */
export function resolveLexicon(userEntries: readonly LexiconEntry[] | undefined): LexiconEntry[] {
    if (!userEntries || userEntries.length === 0) {
        return BUILTIN_GEOCACHING_LEXICON;
    }

    const cached = resolveCache.get(userEntries as unknown as object);
    if (cached) {
        return cached;
    }

    const overrides = new Map<string, LexiconEntry>();
    for (const entry of userEntries) {
        if (isUsableEntry(entry)) {
            overrides.set(lexiconTermKey(entry.term), entry);
        }
    }

    const resolved: LexiconEntry[] = [];
    const consumed = new Set<string>();

    for (const builtin of BUILTIN_GEOCACHING_LEXICON) {
        const key = lexiconTermKey(builtin.term);
        const override = overrides.get(key);
        if (!override) {
            resolved.push(builtin);
            continue;
        }
        consumed.add(key);
        if (!override.disabled) {
            resolved.push(override);
        }
    }

    for (const [key, entry] of overrides) {
        if (!consumed.has(key) && !entry.disabled) {
            resolved.push(entry);
        }
    }

    resolveCache.set(userEntries as unknown as object, resolved);
    return resolved;
}

// ─────────────────────────────────────────────────────────────────────────────
// Détection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Un sigle se reconnaît à sa graphie : tout en capitales, court, sans espace.
 *
 * La distinction n'est pas cosmétique, elle décide de la sensibilité à la casse. « PAT » cherché
 * sans tenir compte de la casse matcherait « pat » dans « n'importe quel pattern », et « CO »
 * matcherait la moitié des mots d'un log une fois les frontières posées sur deux lettres. En
 * capitales strictes, le bruit disparaît. Les termes en minuscules, eux, doivent au contraire
 * matcher « Logbook » comme « logbook ».
 */
function isAcronymForm(form: string): boolean {
    return /^[\p{Lu}\p{N}][\p{Lu}\p{N}.\-/]{0,9}$/u.test(form) && form === form.toUpperCase();
}

/**
 * Les frontières encadrant un terme : ni lettre, ni chiffre, ni souligné de part et d'autre,
 * et jamais un `@` juste avant.
 *
 * Le souligné et le `@` ne sont pas des raffinements : sans eux, le terme « cache » se
 * retrouve **dans** le token `@cache_owner`, et le lexique demande solennellement au modèle de
 * ne pas traduire un mot qui n'existe pas dans le texte. Les noms de `@patterns` sont en
 * snake_case et pleins de mots du jargon (`cache_name`, `gc_code`, `cache_owner`) : c'est le
 * cas courant, pas le cas tordu.
 */
function boundedPattern(body: string, plural: string): string {
    return `(?<![\\p{L}\\p{N}_])(?<!@)(?:${body})${plural}(?![\\p{L}\\p{N}_])`;
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Motifs d'une entrée : un pour les formes en capitales (casse stricte), un pour les autres. */
interface CompiledEntry {
    entry: LexiconEntry;
    /** Cherché dans le texte brut. */
    strict?: RegExp;
    /** Cherché dans le texte normalisé (minuscules, sans accents). */
    loose?: RegExp;
}

function compileEntry(entry: LexiconEntry): CompiledEntry {
    const forms = [entry.term, ...(entry.aliases ?? [])]
        .map(form => (form || '').trim())
        .filter(form => form !== '');

    const strictForms = forms.filter(isAcronymForm).map(escapeRegExp);
    const looseForms = forms
        .filter(form => !isAcronymForm(form))
        .map(form => escapeRegExp(normalizeLexiconText(form)))
        .filter(form => form !== '');

    return {
        entry,
        // Le pluriel « DNFs » s'écrit avec un s minuscule, même quand le sigle est en capitales.
        strict: strictForms.length > 0
            ? new RegExp(boundedPattern(strictForms.join('|'), 's?'), 'u')
            : undefined,
        loose: looseForms.length > 0
            ? new RegExp(boundedPattern(looseForms.join('|'), '(?:s|es|x)?'), 'u')
            : undefined,
    };
}

const compileCache = new WeakMap<object, CompiledEntry[]>();

function compileLexicon(entries: readonly LexiconEntry[]): CompiledEntry[] {
    const cached = compileCache.get(entries as unknown as object);
    if (cached) {
        return cached;
    }
    const compiled = entries.filter(isUsableEntry).map(compileEntry);
    compileCache.set(entries as unknown as object, compiled);
    return compiled;
}

/**
 * Entrées du lexique mentionnées dans un texte, dans l'ordre du lexique.
 *
 * L'ordre vient du lexique et non du texte : il rend le bloc de prompt stable d'un appel à
 * l'autre, donc les tests déterministes et le cache de prompt du fournisseur utile.
 */
export function findLexiconMentions(
    text: string | undefined,
    entries: readonly LexiconEntry[]
): LexiconEntry[] {
    const raw = text || '';
    if (raw.trim() === '') {
        return [];
    }
    const normalized = normalizeLexiconText(raw);

    const found: LexiconEntry[] = [];
    for (const compiled of compileLexicon(entries)) {
        if (compiled.strict?.test(raw) || compiled.loose?.test(normalized)) {
            found.push(compiled.entry);
        }
    }
    return found;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rendu pour le prompt
// ─────────────────────────────────────────────────────────────────────────────

/** Ce que le lexique demande pour une entrée donnée, une fois la langue cible connue. */
interface ResolvedRule {
    entry: LexiconEntry;
    /** Forme attendue en sortie, ou `undefined` si le modèle doit traduire librement. */
    expected?: string;
}

/**
 * Applique la langue cible à une entrée.
 *
 * Une entrée `map` sans équivalent pour la langue demandée n'est pas perdue pour autant : sa
 * glose part quand même dans le prompt, et c'est tout ce qu'il faut au modèle pour traduire le
 * terme correctement plutôt que mot à mot.
 */
function resolveRule(entry: LexiconEntry, languageKey: string): ResolvedRule {
    if (entry.policy === 'keep') {
        return { entry, expected: entry.term };
    }
    const equivalent = (entry.translations ?? {})[languageKey];
    return { entry, expected: equivalent && equivalent.trim() !== '' ? equivalent.trim() : undefined };
}

function glossSuffix(entry: LexiconEntry): string {
    const gloss = (entry.gloss || '').trim();
    return gloss ? ` (${gloss})` : '';
}

/**
 * Bloc de lexique pour un prompt de **traduction**, ou chaîne vide si rien n'a été repéré.
 *
 * `targetLanguage` est repris tel que l'utilisateur l'a écrit : le prompt parle déjà de
 * « traduis en Anglais », le bloc doit dire la même chose avec les mêmes mots.
 */
export function buildLexiconTranslationBlock(mentions: readonly LexiconEntry[], targetLanguage: string): string {
    if (mentions.length === 0) {
        return '';
    }
    const language = (targetLanguage || '').trim();
    const languageKey = normalizeLanguageKey(language);

    const lines = mentions.map(entry => {
        const { expected } = resolveRule(entry, languageKey);
        const head = `- « ${entry.term} »${glossSuffix(entry)}`;
        if (entry.policy === 'keep') {
            return `${head} : terme du jargon géocaching, garde-le tel quel, ne le traduis pas.`;
        }
        if (expected) {
            return `${head} : en ${language}, les géocacheurs écrivent « ${expected} » — emploie cette forme.`;
        }
        return `${head} : aucune forme consacrée en ${language}, traduis-le d'après son sens ci-dessus.`;
    });

    return `**Lexique géocaching — termes repérés dans ce texte, à respecter :**\n${lines.join('\n')}`;
}

/**
 * Bloc de lexique pour un prompt de **rédaction**. Même vocabulaire, autre consigne : il ne
 * s'agit plus de préserver un terme existant mais d'employer le bon dans la langue de sortie.
 */
export function buildLexiconWritingBlock(mentions: readonly LexiconEntry[], targetLanguage: string): string {
    if (mentions.length === 0) {
        return '';
    }
    const language = (targetLanguage || '').trim();
    const languageKey = normalizeLanguageKey(language);

    const lines = mentions.map(entry => {
        const { expected } = resolveRule(entry, languageKey);
        const head = `- « ${entry.term} »${glossSuffix(entry)}`;
        if (entry.policy === 'keep' || !expected) {
            return `${head} : terme du jargon géocaching, écris-le tel quel.`;
        }
        return language
            ? `${head} : s'écrit « ${expected} » en ${language}.`
            : `${head} : s'écrit « ${expected} ».`;
    });

    return `**Vocabulaire géocaching à employer :**\n${lines.join('\n')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Garde-fou
// ─────────────────────────────────────────────────────────────────────────────

/** Un terme du lexique que la traduction n'a pas respecté. */
export interface LexiconDeviation {
    term: string;
    expected: string;
}

/** Vrai si `form` apparaît dans `text`, aux mêmes frontières et à la casse près. */
function containsForm(text: string, form: string): boolean {
    const normalizedForm = normalizeLexiconText(form);
    if (!normalizedForm) {
        return true;
    }
    const pattern = new RegExp(boundedPattern(escapeRegExp(normalizedForm), '(?:s|es|x)?'), 'u');
    return pattern.test(normalizeLexiconText(text));
}

/**
 * Termes du lexique présents à l'entrée dont la forme attendue manque à la sortie.
 *
 * Même rôle que `findLostPatterns` pour les `@patterns` : ça n'empêche rien, ça avertit. Un
 * « DNF » devenu « je n'ai pas trouvé » n'est pas une erreur de syntaxe, seulement une consigne
 * ignorée, et c'est à l'utilisateur — qui a le texte sous les yeux — de trancher.
 *
 * Les entrées `map` sans équivalent dans la langue cible sont ignorées : rien n'était attendu,
 * rien ne peut manquer.
 */
export function findLexiconDeviations(
    source: string,
    translated: string,
    mentions: readonly LexiconEntry[],
    targetLanguage: string
): LexiconDeviation[] {
    const languageKey = normalizeLanguageKey(targetLanguage);
    const deviations: LexiconDeviation[] = [];

    for (const entry of mentions) {
        const { expected } = resolveRule(entry, languageKey);
        if (!expected) {
            continue;
        }
        if (!containsForm(source, entry.term) && !(entry.aliases ?? []).some(alias => containsForm(source, alias))) {
            continue;
        }
        if (!containsForm(translated, expected)) {
            deviations.push({ term: entry.term, expected });
        }
    }

    return deviations;
}
