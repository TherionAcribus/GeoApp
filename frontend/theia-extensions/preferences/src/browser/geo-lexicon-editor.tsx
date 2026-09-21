/**
 * Éditeur du lexique géocaching (`widget: "lexicon"`).
 *
 * Le lexique a deux étages : un fond intégré, curaté et livré avec l'application dans
 * `shared/lexicons/geocaching-lexicon.json`, et les entrées personnelles de l'utilisateur, qui
 * vivent seules dans la préférence. Une entrée personnelle de même terme **remplace** l'entrée
 * intégrée, ou la **supprime** si elle porte `disabled`.
 *
 * Ce découpage est ce qui permet à une correction du lexique livrée avec une mise à jour
 * d'atteindre aussi les utilisateurs qui ont déjà ajouté leurs propres termes — ce qu'un lexique
 * stocké en entier dans la préférence ne permettrait pas. Il a un prix ici : l'éditeur affiche
 * une liste que la préférence ne contient pas, et chaque modification doit décider s'il faut
 * créer une surcharge, la mettre à jour ou la retirer. C'est tout l'objet de `LexiconRow`.
 *
 * Le moteur qui consomme le lexique vit ailleurs (`zones/src/browser/geocaching-lexicon.ts`) :
 * les deux extensions se rejoignent sur les fichiers de `shared/lexicons/`, jamais sur du code.
 */

import * as React from 'react';

/** Ce qu'il faut faire du terme quand l'IA le rencontre. */
export type LexiconPolicy = 'keep' | 'map';

/** Une entrée du lexique, telle qu'elle est stockée dans la préférence et dans le fond intégré. */
export interface LexiconEntry {
    term: string;
    aliases?: string[];
    gloss?: string;
    policy: LexiconPolicy;
    translations?: Record<string, string>;
    disabled?: boolean;
}

/*
 * Données chargées par `require` plutôt que par `import`, pour la même raison que dans
 * `zones/src/browser/geocaching-lexicon.ts` : un `import` ferait entrer ces fichiers dans le
 * graphe TypeScript de l'extension, où ils tombent hors du `rootDir`. La résolution revient à
 * webpack, qui trouve le même fichier depuis `lib/browser` que depuis `src/browser`.
 */
/* eslint-disable @typescript-eslint/no-var-requires */
const lexiconFile = require('../../../../../shared/lexicons/geocaching-lexicon.json') as { entries?: LexiconEntry[] };
const languageKeysFile = require('../../../../../shared/lexicons/language-keys.json') as { keys?: Record<string, string> };
/* eslint-enable @typescript-eslint/no-var-requires */

const BUILTIN_ENTRIES: LexiconEntry[] = lexiconFile.entries ?? [];
const LANGUAGE_KEYS: Record<string, string> = languageKeysFile.keys ?? {};

/**
 * Minuscules sans accents. Duplique volontairement la normalisation de
 * `zones/src/browser/geocaching-lexicon.ts` : trois lignes recopiées valent mieux qu'une
 * dépendance croisée entre deux extensions Theia. La table des langues, elle, est partagée.
 */
function normalize(text: string | undefined): string {
    return (text || '')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/** Clé d'identité d'un terme : c'est elle qui apparie une entrée personnelle et une entrée intégrée. */
function termKey(term: string | undefined): string {
    return normalize(term);
}

/** Clé de colonne d'un nom de langue écrit en clair. Doit rester alignée sur le moteur. */
function languageKey(language: string): string {
    const normalized = normalize(language);
    if (!normalized) {
        return '';
    }
    return LANGUAGE_KEYS[normalized] ?? normalized;
}

/** D'où vient la ligne affichée, ce qui décide des actions offertes. */
type LexiconOrigin = 'builtin' | 'override' | 'custom';

/** Une ligne de l'éditeur : une entrée effective, plus ce qu'il faut pour la modifier. */
interface LexiconRow {
    key: string;
    entry: LexiconEntry;
    origin: LexiconOrigin;
    /** Vrai quand une entrée intégrée a été désactivée : la ligne reste visible, barrée. */
    disabled: boolean;
}

/**
 * Lignes affichées : le fond intégré dans son ordre, corrigé par les entrées personnelles,
 * puis les termes que le fond ne connaît pas.
 *
 * Une entrée intégrée désactivée reste dans la liste — la faire disparaître priverait
 * l'utilisateur du seul endroit d'où la réactiver.
 */
export function buildLexiconRows(userEntries: readonly LexiconEntry[]): LexiconRow[] {
    const overrides = new Map<string, LexiconEntry>();
    for (const entry of userEntries) {
        if (entry && typeof entry.term === 'string' && entry.term.trim() !== '') {
            overrides.set(termKey(entry.term), entry);
        }
    }

    const rows: LexiconRow[] = [];
    const consumed = new Set<string>();

    for (const builtin of BUILTIN_ENTRIES) {
        const key = termKey(builtin.term);
        const override = overrides.get(key);
        if (!override) {
            rows.push({ key, entry: builtin, origin: 'builtin', disabled: false });
            continue;
        }
        consumed.add(key);
        rows.push({
            key,
            // Une entrée désactivée n'a plus de contenu utile : on réaffiche le fond intégré,
            // pour que l'utilisateur voie ce qu'il retrouvera en la réactivant.
            entry: override.disabled ? builtin : override,
            origin: 'override',
            disabled: Boolean(override.disabled),
        });
    }

    for (const [key, entry] of overrides) {
        if (!consumed.has(key)) {
            rows.push({ key, entry, origin: 'custom', disabled: Boolean(entry.disabled) });
        }
    }

    return rows;
}

/** Résumé d'une règle, affiché sur la ligne repliée. */
function summarize(entry: LexiconEntry, languages: readonly string[]): string {
    if (entry.policy === 'keep') {
        return 'ne pas traduire';
    }
    const translations = entry.translations ?? {};
    const shown = languages
        .map(language => ({ language, value: translations[languageKey(language)] }))
        .filter(item => item.value && item.value.trim() !== '')
        .slice(0, 3)
        .map(item => `${item.language} : ${item.value}`);

    if (shown.length === 0) {
        return 'adapter (aucun équivalent saisi)';
    }
    const total = Object.values(translations).filter(value => value && value.trim() !== '').length;
    const more = total > shown.length ? ` +${total - shown.length}` : '';
    return `${shown.join(' · ')}${more}`;
}

/** Texte dans lequel le filtre cherche : terme, alias, sens et équivalents. */
function haystack(entry: LexiconEntry): string {
    return normalize([
        entry.term,
        ...(entry.aliases ?? []),
        entry.gloss ?? '',
        ...Object.values(entry.translations ?? {}),
    ].join(' '));
}

interface LexiconRowEditorProps {
    row: LexiconRow;
    languages: readonly string[];
    onChange(entry: LexiconEntry): void;
}

/**
 * Formulaire d'une ligne dépliée.
 *
 * Chaque champ tient un brouillon local et n'écrit dans la préférence qu'au `blur` : sans ça,
 * chaque frappe déclencherait une écriture de préférence et un rendu de toute la page.
 * Le composant est monté avec une `key` liée au terme, le brouillon repart donc du bon état
 * quand la ligne change d'identité.
 */
const LexiconRowEditor: React.FC<LexiconRowEditorProps> = ({ row, languages, onChange }) => {
    const [draft, setDraft] = React.useState<LexiconEntry>(row.entry);

    const commit = (next: LexiconEntry): void => {
        setDraft(next);
        onChange(next);
    };

    const setTranslation = (language: string, value: string): LexiconEntry => {
        const translations = { ...(draft.translations ?? {}) };
        const key = languageKey(language);
        if (value.trim() === '') {
            delete translations[key];
        } else {
            translations[key] = value.trim();
        }
        return { ...draft, translations };
    };

    return (
        <div className='geo-lexicon-form'>
            <label className='geo-lexicon-field'>
                <span>Sens (envoyé à l'IA)</span>
                <input
                    type='text'
                    value={draft.gloss ?? ''}
                    placeholder='Did Not Find : la cache n’a pas été trouvée'
                    onChange={event => setDraft({ ...draft, gloss: event.currentTarget.value })}
                    onBlur={() => onChange(draft)}
                />
            </label>

            <label className='geo-lexicon-field'>
                <span>Autres formes détectées</span>
                <input
                    type='text'
                    value={(draft.aliases ?? []).join(', ')}
                    placeholder='séparées par des virgules'
                    onChange={event => setDraft({
                        ...draft,
                        aliases: event.currentTarget.value
                            .split(',')
                            .map(alias => alias.trim())
                            .filter(alias => alias !== ''),
                    })}
                    onBlur={() => onChange(draft)}
                />
            </label>

            <label className='geo-lexicon-field'>
                <span>Règle</span>
                <select
                    value={draft.policy}
                    onChange={event => commit({
                        ...draft,
                        policy: event.currentTarget.value === 'map' ? 'map' : 'keep',
                    })}
                >
                    <option value='keep'>Ne pas traduire</option>
                    <option value='map'>Adapter selon la langue</option>
                </select>
            </label>

            {draft.policy === 'map' && (
                <div className='geo-lexicon-translations'>
                    {languages.length === 0 && (
                        <p className='geo-lexicon-hint'>
                            Aucune langue configurée : renseignez d’abord les langues de traduction.
                        </p>
                    )}
                    {languages.map(language => (
                        <label key={language} className='geo-lexicon-field'>
                            <span>{language}</span>
                            <input
                                type='text'
                                value={(draft.translations ?? {})[languageKey(language)] ?? ''}
                                placeholder='laisser vide : traduit d’après le sens'
                                onChange={event => setDraft(setTranslation(language, event.currentTarget.value))}
                                onBlur={() => onChange(draft)}
                            />
                        </label>
                    ))}
                </div>
            )}
        </div>
    );
};

export interface GeoLexiconEditorProps {
    prefKey: string;
    /** Valeur de la préférence : les entrées personnelles seules. */
    entries: LexiconEntry[];
    /** Langues proposées comme colonnes d'équivalents, résolues par `optionsFrom`. */
    languages: string[];
    onChange(next: LexiconEntry[]): void;
}

/** Éditeur complet : filtre, liste des termes, formulaire d'ajout. */
export const GeoLexiconEditor: React.FC<GeoLexiconEditorProps> = ({ prefKey, entries, languages, onChange }) => {
    const [filter, setFilter] = React.useState('');
    const [openKey, setOpenKey] = React.useState<string | undefined>(undefined);
    const [newTerm, setNewTerm] = React.useState('');
    const [error, setError] = React.useState<string | undefined>(undefined);

    const rows = React.useMemo(() => buildLexiconRows(entries), [entries]);
    const needle = normalize(filter);
    const visible = needle === '' ? rows : rows.filter(row => haystack(row.entry).includes(needle));

    /** Écrit une entrée personnelle pour ce terme, en remplaçant celle qui existe déjà. */
    const upsert = (key: string, entry: LexiconEntry): void => {
        const next = entries.filter(candidate => termKey(candidate?.term) !== key);
        next.push(entry);
        onChange(next);
    };

    /** Retire l'entrée personnelle : une surcharge revient au fond intégré, un terme perso disparaît. */
    const dropOverride = (key: string): void => {
        onChange(entries.filter(candidate => termKey(candidate?.term) !== key));
    };

    const toggleDisabled = (row: LexiconRow): void => {
        if (row.disabled) {
            // Réactiver une entrée intégrée, c'est simplement retirer la marque de désactivation ;
            // une éventuelle surcharge de contenu, elle, a déjà été perdue en la désactivant.
            dropOverride(row.key);
            return;
        }
        if (row.origin === 'custom') {
            dropOverride(row.key);
            return;
        }
        upsert(row.key, { term: row.entry.term, policy: row.entry.policy, disabled: true });
    };

    const addTerm = (): void => {
        const trimmed = newTerm.trim();
        if (!trimmed) {
            return;
        }
        const key = termKey(trimmed);
        if (rows.some(row => row.key === key)) {
            setError(`« ${trimmed} » est déjà dans le lexique.`);
            setFilter(trimmed);
            setOpenKey(key);
            return;
        }
        setError(undefined);
        setNewTerm('');
        setOpenKey(key);
        upsert(key, { term: trimmed, policy: 'keep' });
    };

    const customCount = entries.filter(entry => entry && (entry.term || '').trim() !== '').length;

    return (
        <div id={prefKey} className='geo-lexicon'>
            <div className='geo-lexicon-toolbar'>
                <input
                    type='search'
                    className='geo-lexicon-filter'
                    value={filter}
                    placeholder='Filtrer les termes…'
                    aria-label='Filtrer le lexique'
                    onChange={event => setFilter(event.currentTarget.value)}
                />
                <span className='geo-lexicon-count'>
                    {rows.length} terme{rows.length > 1 ? 's' : ''}
                    {customCount > 0 && ` · ${customCount} personnalisé${customCount > 1 ? 's' : ''}`}
                </span>
            </div>

            <div className='geo-lexicon-rows'>
                {visible.length === 0 && (
                    <p className='geo-lexicon-hint'>Aucun terme ne correspond à ce filtre.</p>
                )}
                {visible.map(row => {
                    const open = openKey === row.key;
                    return (
                        <div
                            key={row.key}
                            className={`geo-lexicon-row${row.disabled ? ' disabled' : ''}${open ? ' open' : ''}`}
                        >
                            <div className='geo-lexicon-head'>
                                <button
                                    type='button'
                                    className='geo-lexicon-toggle'
                                    aria-expanded={open}
                                    onClick={() => setOpenKey(open ? undefined : row.key)}
                                >
                                    <span className='geo-lexicon-caret'>{open ? '▾' : '▸'}</span>
                                    <span className='geo-lexicon-term'>{row.entry.term}</span>
                                    <span className='geo-lexicon-summary'>
                                        {row.disabled ? 'désactivé' : summarize(row.entry, languages)}
                                    </span>
                                </button>
                                {row.origin === 'override' && !row.disabled && (
                                    <span className='geo-lexicon-badge modified'>modifié</span>
                                )}
                                {row.origin === 'custom' && (
                                    <span className='geo-lexicon-badge custom'>perso</span>
                                )}
                                {row.origin === 'override' && !row.disabled && (
                                    <button
                                        type='button'
                                        className='geo-lexicon-action'
                                        title='Revenir à la définition livrée avec GeoApp'
                                        onClick={() => dropOverride(row.key)}
                                    >
                                        ↺
                                    </button>
                                )}
                                <button
                                    type='button'
                                    className='geo-lexicon-action remove'
                                    title={row.disabled
                                        ? 'Réactiver ce terme'
                                        : row.origin === 'custom' ? 'Supprimer ce terme' : 'Désactiver ce terme'}
                                    onClick={() => toggleDisabled(row)}
                                >
                                    {row.disabled ? '↺' : '⊘'}
                                </button>
                            </div>
                            {open && !row.disabled && (
                                <LexiconRowEditor
                                    key={`${row.key}:${row.origin}`}
                                    row={row}
                                    languages={languages}
                                    onChange={entry => upsert(row.key, { ...entry, term: row.entry.term })}
                                />
                            )}
                        </div>
                    );
                })}
            </div>

            <div className='geo-lexicon-add'>
                <input
                    type='text'
                    value={newTerm}
                    placeholder='Ajouter un terme…'
                    aria-label='Nouveau terme du lexique'
                    aria-invalid={error !== undefined}
                    onChange={event => { setNewTerm(event.currentTarget.value); setError(undefined); }}
                    onKeyDown={event => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            addTerm();
                        }
                    }}
                />
                <button type='button' onClick={addTerm} disabled={newTerm.trim() === ''}>
                    Ajouter
                </button>
            </div>
            {error && <p className='geo-lexicon-error' role='alert'>{error}</p>}
            <p className='geo-lexicon-hint'>
                Un terme tout en capitales (DNF, FTF) n’est reconnu qu’en capitales ; écrit en
                minuscules, il est reconnu quelles que soient la casse et les accents.
            </p>
        </div>
    );
};
