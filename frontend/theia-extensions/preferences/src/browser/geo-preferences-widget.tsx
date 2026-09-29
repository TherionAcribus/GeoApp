import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { CommandService } from '@theia/core';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { StatefulWidget, Message } from '@theia/core/lib/browser';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';

import { GeoPreferenceStore, GeoPreferenceSnapshot } from './geo-preference-store';
import {
    GeoPreferenceDefinition,
    GeoPreferenceKey,
    GEO_PREFERENCE_CATEGORIES,
} from './geo-preferences-schema';
import { GeoLexiconEditor, LexiconEntry } from './geo-lexicon-editor';

export interface GeoPreferencesOpenOptions {
    category?: string;
    key?: string;
    query?: string;
}

type GeoPreferenceTargetFilter = 'all' | 'frontend' | 'backend';
type GeoPreferenceValueFilter = 'all' | 'modified';

/** Défilement différé, exécuté après le rendu effectif du DOM (voir PendingRevealEffect). */
interface PendingReveal {
    kind: 'preference' | 'category';
    id: string;
    /** Incrémenté à chaque demande : re-déclenche l'effet même pour la même cible. */
    token: number;
}

/** Groupe de la barre latérale : un guide `x-guides` et les catégories qu'il cite. */
interface GeoPreferenceSidebarGroup {
    id: string;
    label: string;
    description?: string;
    sections: GeoPreferenceSection[];
}

interface GeoPreferenceSection {
    category: string;
    label: string;
    entries: Array<{ key: GeoPreferenceKey; definition: GeoPreferenceDefinition }>;
    filteredEntries: Array<{ key: GeoPreferenceKey; definition: GeoPreferenceDefinition }>;
    subsections: GeoPreferenceSubsection[];
}

interface GeoPreferenceSubsection {
    id: string;
    label: string;
    /** Plus petit `x-ui.order` des entrées : détermine l'ordre des sous-sections. */
    minOrder: number;
    entries: Array<{ key: GeoPreferenceKey; definition: GeoPreferenceDefinition }>;
}

// Libellés et ordre des catégories lus dans le schéma partagé (`x-categories`).
const CATEGORY_LABELS = new Map(GEO_PREFERENCE_CATEGORIES.map(category => [category.id, category.label]));
const CATEGORY_ORDERS = new Map(GEO_PREFERENCE_CATEGORIES.map((category, index) => [category.id, category.order ?? index]));

const ENUM_VALUE_LABELS: Record<string, string> = {
    true: 'Activé',
    false: 'Désactivé',
    local: 'Local',
    fast: 'Rapide',
    strong: 'Raisonnement renforcé',
    web: 'Web',
    default: 'Par défaut',
    guided: 'Guidé',
    safe: 'Prudent',
    offline: 'Hors ligne',
    automation: 'Automatisation',
    debug: 'Diagnostic',
    workflow: 'Selon le workflow',
    minimal: 'Minimal',
    full: 'Complet',
    disabled: 'Désactivé',
    manual: 'Manuel',
    confident: 'Si confiance suffisante',
    algorithm: 'Algorithme',
    ai: 'IA',
    none: 'Aucun',
    'ai-bulk': 'IA en masse',
    'ai-per-question': 'IA question par question',
    'smart-replace': 'Remplacement intelligent',
    'always-new-tab': 'Toujours nouvel onglet',
    'always-replace': 'Toujours remplacer',
    'same-group': 'Même groupe',
    'new-group': 'Nouveau groupe',
    'external-window': 'Fenêtre externe',
    'new-tab': 'Nouvel onglet',
    'new-window': 'Nouvelle fenêtre',
    transparent: 'Transparent',
    hidden: 'Masqué',
    'found-icon': 'Icône trouvée',
    osm: 'OpenStreetMap',
    satellite: 'Satellite',
    topographic: 'Topographique',
    credentials: 'Identifiants',
    browser_cookies: 'Cookies navigateur',
    auto: 'Automatique',
    original: 'Originale',
    modified: 'Modifiée',
    logs: 'Logs',
    listing: 'Listing',
    fr: 'Français',
    en: 'Anglais'
};

// --- Fonctions pures partagées entre le widget et le composant PreferenceItem ---

function humanSegment(value: string): string {
    return value
        .replace(/([A-Z])/g, ' $1')
        .replace(/-/g, ' ')
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^\w/, char => char.toUpperCase());
}

function preferenceLabel(key: string): string {
    return key
        .replace(/^geoApp\./, '')
        .split('.')
        .map(part => humanSegment(part))
        .join(' / ');
}

function categoryLabel(category: string): string {
    return CATEGORY_LABELS.get(category) ?? category;
}

function enumOptionLabel(option: string | number, definition?: GeoPreferenceDefinition, showRaw = false): string {
    const raw = String(option);
    const contextualLabel = definition?.['x-ui']?.enumLabels?.[raw];
    if (contextualLabel) {
        return showRaw ? `${contextualLabel} (${raw})` : contextualLabel;
    }
    const label = ENUM_VALUE_LABELS[raw] ?? humanSegment(raw);
    if (!showRaw || label === raw) {
        return label;
    }
    return `${label} (${raw})`;
}

/**
 * Contrôles « larges » : rendus sous la description sur toute la largeur de la ligne
 * plutôt que dans la colonne étroite à droite. Tout le reste est « compact ».
 */
function isWideControl(definition: GeoPreferenceDefinition): boolean {
    const widget = definition['x-ui']?.widget;
    if (widget === 'lexicon' || widget === 'string-list') {
        return true;
    }
    // `select-from` reste compact : c'est un menu déroulant comme les enums.
    return definition.type === 'array' || definition.type === 'object';
}

/** Défaut lisible pour l'info-bulle du bouton de réinitialisation. */
function defaultHint(definition: GeoPreferenceDefinition): string {
    const value = definition.default;
    if (typeof value === 'boolean') {
        return value ? 'Activé' : 'Désactivé';
    }
    if (Array.isArray(definition.enum) && (typeof value === 'string' || typeof value === 'number')) {
        return enumOptionLabel(value, definition);
    }
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
        return 'vide';
    }
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

function arrayValue(value: unknown, fallback: unknown): Array<string | number> {
    const source = Array.isArray(value) ? value : fallback;
    if (!Array.isArray(source)) {
        return [];
    }
    return source.filter((entry): entry is string | number => typeof entry === 'string' || typeof entry === 'number');
}

function formatJson(value: unknown, fallback: unknown): string {
    const source = value ?? fallback ?? {};
    try {
        return JSON.stringify(source, null, 2);
    } catch {
        return '{}';
    }
}

/** Valeurs d'une préférence rendue en liste de chaînes libres (les non-chaînes sont ignorées). */
function stringListValue(value: unknown, fallback: unknown): string[] {
    return arrayValue(value, fallback).map(entry => String(entry));
}

/**
 * Forme comparable d'une entrée de liste libre : deux langues qui ne diffèrent que par la casse
 * ou les accents sont le même doublon pour l'utilisateur.
 */
function stringListKey(entry: string): string {
    return entry.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/**
 * Liste de chaînes libres, éditable ligne à ligne. Servie aux `array` dont le schéma déclare
 * `x-ui.widget: "string-list"`, là où le rendu par défaut serait une textarea JSON brute.
 *
 * Le champ de saisie tient son propre état : la préférence n'est écrite qu'à la validation,
 * et `React.memo` sur `PreferenceItem` reste efficace pendant la frappe.
 */
/**
 * Champ de saisie d'une valeur `x-sensitive` : mot de passe avec bouton œil pour
 * révéler temporairement la valeur et indicateur « Clé définie » / « Aucune clé »
 * qui ne révèle rien du secret.
 */
const SensitiveInput: React.FC<{
    prefKey: string;
    value: string;
    draft: string | undefined;
    onDraftChange: (value: string) => void;
    onCommit: () => void;
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}> = ({ prefKey, value, draft, onDraftChange, onCommit, onKeyDown }) => {
    const [visible, setVisible] = React.useState(false);
    const display = draft !== undefined ? draft : value;
    const defined = display.trim() !== '';
    return (
        <div className='geo-preference-sensitive'>
            <input
                id={prefKey}
                type={visible ? 'text' : 'password'}
                value={display}
                autoComplete='off'
                onChange={event => onDraftChange(event.currentTarget.value)}
                onBlur={onCommit}
                onKeyDown={onKeyDown}
            />
            <button
                type='button'
                className='geo-preference-sensitive-toggle'
                title={visible ? 'Masquer la valeur' : 'Afficher la valeur'}
                aria-label={visible ? 'Masquer la valeur' : 'Afficher la valeur'}
                onClick={() => setVisible(!visible)}
            >
                <span className={`codicon ${visible ? 'codicon-eye-closed' : 'codicon-eye'}`} />
            </button>
            <span className={`geo-preference-sensitive-status${defined ? ' set' : ''}`}>
                {defined ? 'Clé définie' : 'Aucune clé'}
            </span>
        </div>
    );
};

const StringListEditor: React.FC<{
    prefKey: string;
    entries: string[];
    onChange: (next: string[]) => void;
}> = ({ prefKey, entries, onChange }) => {
    const [draft, setDraft] = React.useState('');
    const [error, setError] = React.useState<string | undefined>(undefined);

    const add = (): void => {
        const trimmed = draft.trim();
        if (!trimmed) {
            return;
        }
        const key = stringListKey(trimmed);
        if (entries.some(entry => stringListKey(entry) === key)) {
            setError(`« ${trimmed} » est déjà dans la liste.`);
            return;
        }
        setError(undefined);
        setDraft('');
        onChange([...entries, trimmed]);
    };

    const remove = (index: number): void => {
        setError(undefined);
        onChange(entries.filter((_, position) => position !== index));
    };

    const move = (index: number, delta: number): void => {
        const target = index + delta;
        if (target < 0 || target >= entries.length) {
            return;
        }
        const next = [...entries];
        [next[index], next[target]] = [next[target], next[index]];
        setError(undefined);
        onChange(next);
    };

    return (
        <div id={prefKey} className='geo-preference-string-list'>
            {entries.length === 0 && (
                <p className='geo-preference-string-list-empty'>Aucune entrée.</p>
            )}
            {entries.map((entry, index) => (
                <div key={`${entry}:${index}`} className='geo-preference-string-list-row'>
                    <span className='geo-preference-string-list-value'>{entry}</span>
                    <button
                        type='button'
                        className='geo-preference-string-list-move'
                        onClick={() => move(index, -1)}
                        disabled={index === 0}
                        title='Monter'
                        aria-label={`Monter ${entry}`}
                    >
                        ▲
                    </button>
                    <button
                        type='button'
                        className='geo-preference-string-list-move'
                        onClick={() => move(index, +1)}
                        disabled={index === entries.length - 1}
                        title='Descendre'
                        aria-label={`Descendre ${entry}`}
                    >
                        ▼
                    </button>
                    <button
                        type='button'
                        className='geo-preference-string-list-remove'
                        onClick={() => remove(index)}
                        title='Supprimer'
                        aria-label={`Supprimer ${entry}`}
                    >
                        ✕
                    </button>
                </div>
            ))}
            <div className='geo-preference-string-list-add'>
                <input
                    type='text'
                    value={draft}
                    placeholder='Ajouter une entrée…'
                    aria-label='Nouvelle entrée'
                    aria-invalid={error !== undefined}
                    onChange={event => { setDraft(event.currentTarget.value); setError(undefined); }}
                    onKeyDown={event => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            add();
                        }
                    }}
                />
                <button type='button' onClick={add} disabled={draft.trim() === ''}>
                    Ajouter
                </button>
            </div>
            {error && (
                <p className='geo-preference-string-list-error' role='alert'>{error}</p>
            )}
        </div>
    );
};

/**
 * Callbacks stables (référence constante) fournis à chaque PreferenceItem : indispensables
 * pour que React.memo puisse ignorer les items inchangés lors d'un re-render.
 */
interface PreferenceItemHandlers {
    onBoolean(key: string, checked: boolean): void;
    onSelect(key: string, rawValue: string, definition: GeoPreferenceDefinition): void;
    onDraftChange(key: string, value: string): void;
    onCommitText(key: string): void;
    onCommitNumeric(key: string, definition: GeoPreferenceDefinition): void;
    onDraftKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void;
    onArrayToggle(key: string, option: string | number, checked: boolean, definition: GeoPreferenceDefinition): void;
    /** Liste complète après ajout, suppression ou déplacement : le calcul reste dans l'éditeur. */
    onStringListChange(key: string, next: string[]): void;
    /** Entrées personnelles du lexique après modification, fond intégré exclu. */
    onLexiconChange(key: string, next: LexiconEntry[]): void;
    onArrayJsonBlur(key: string, rawValue: string): void;
    onObjectJsonBlur(key: string, rawValue: string): void;
    onReset(key: string, definition: GeoPreferenceDefinition): void;
    onJsonFocus(key: string, jsonValue: string): void;
    onJsonBlurClear(key: string): void;
}

interface PreferenceItemProps {
    prefKey: string;
    definition: GeoPreferenceDefinition;
    value: unknown;
    draft: string | undefined;
    hasJsonError: boolean;
    frozenJson: string | undefined;
    modified: boolean;
    highlighted: boolean;
    advanced: boolean;
    /** Mode développeur : clé, cibles Theia/Flask et tags affichés, valeur brute des enums. */
    devMode: boolean;
    /** Message temporaire après clamp/refus d'une saisie numérique. */
    numericFeedback: string | undefined;
    /** Options resolues pour un `widget: 'select-from'` ; `undefined` pour tous les autres rendus. */
    dynamicOptions: string[] | undefined;
    handlers: PreferenceItemHandlers;
}

/**
 * Rend une préférence isolée. Mémoïsé : ne se re-rend que si l'une de ses props change
 * (valeur, brouillon, erreur JSON, surlignage…), pas à chaque frappe dans un autre champ.
 */
const PreferenceItem = React.memo(function PreferenceItem(props: PreferenceItemProps): React.ReactElement {
    const { prefKey, definition, value, draft, hasJsonError, frozenJson, modified, highlighted, advanced, devMode, numericFeedback, dynamicOptions, handlers } = props;
    const description = definition['x-ui']?.shortDescription ?? definition.description;
    const label = definition['x-ui']?.label ?? definition.title ?? preferenceLabel(prefKey);
    const targets = definition['x-targets'] ?? ['frontend'];
    const backend = targets.includes('backend');
    const tags = definition['x-tags'] ?? [];
    const wide = isWideControl(definition);

    const renderJson = (kind: 'array' | 'object'): React.ReactNode => {
        const jsonValue = formatJson(value, definition.default);
        // La valeur du `key` React est figée pendant l'édition pour ne pas remonter le textarea.
        const reactKey = `${prefKey}:${frozenJson ?? jsonValue}`;
        return (
            <div className='geo-preference-json-wrapper'>
                <textarea
                    key={reactKey}
                    id={prefKey}
                    className={`geo-preference-json${hasJsonError ? ' invalid' : ''}`}
                    rows={8}
                    defaultValue={jsonValue}
                    spellCheck={false}
                    aria-invalid={hasJsonError}
                    onFocus={() => handlers.onJsonFocus(prefKey, jsonValue)}
                    onBlur={event => {
                        const raw = event.currentTarget.value;
                        handlers.onJsonBlurClear(prefKey);
                        if (kind === 'object') {
                            handlers.onObjectJsonBlur(prefKey, raw);
                        } else {
                            handlers.onArrayJsonBlur(prefKey, raw);
                        }
                    }}
                />
                {hasJsonError && (
                    <p className='geo-preference-json-error' role='alert'>
                        JSON invalide : la valeur n’a pas été enregistrée.
                    </p>
                )}
            </div>
        );
    };

    const renderControl = (): React.ReactNode => {
        if (definition.type === 'boolean') {
            return (
                <input
                    id={prefKey}
                    type='checkbox'
                    checked={Boolean(value)}
                    onChange={event => handlers.onBoolean(prefKey, event.currentTarget.checked)}
                />
            );
        }

        if ((definition.type === 'string' || definition.type === 'number' || definition.type === 'integer') && Array.isArray(definition.enum)) {
            return (
                <select
                    id={prefKey}
                    value={String(value ?? definition.default ?? '')}
                    onChange={event => handlers.onSelect(prefKey, event.currentTarget.value, definition)}
                >
                    {/* `enum` est typé `string[] | number[]` : l'union n'est pas
                        appelable telle quelle depuis que le schéma déclare des
                        enums numériques (geoApp.logs.initialFetchCount). */}
                    {(definition.enum as Array<string | number>).map(option => (
                        <option key={option} value={option}>
                            {enumOptionLabel(option, definition, devMode)}
                        </option>
                    ))}
                </select>
            );
        }

        if (definition.type === 'number' || definition.type === 'integer') {
            const displayValue = draft !== undefined ? draft : String(value ?? definition.default ?? 0);
            const bounds = [
                definition.minimum !== undefined ? String(definition.minimum) : undefined,
                definition.maximum !== undefined ? String(definition.maximum) : undefined
            ].filter((bound): bound is string => bound !== undefined);
            return (
                <div className='geo-preference-number'>
                    <input
                        id={prefKey}
                        type='number'
                        value={displayValue}
                        min={definition.minimum as number | undefined}
                        max={definition.maximum as number | undefined}
                        step={definition.type === 'integer' ? 1 : 0.1}
                        onChange={event => handlers.onDraftChange(prefKey, event.currentTarget.value)}
                        onBlur={() => handlers.onCommitNumeric(prefKey, definition)}
                        onKeyDown={event => handlers.onDraftKeyDown(event)}
                    />
                    {bounds.length > 0 && (
                        <span className='geo-preference-bounds'>{bounds.join(' – ')}</span>
                    )}
                    {numericFeedback && (
                        <p className='geo-preference-number-feedback' role='status'>{numericFeedback}</p>
                    )}
                </div>
            );
        }

        if (definition.type === 'array') {
            if (definition['x-ui']?.widget === 'lexicon') {
                // La valeur ne contient que les entrées personnelles : l'éditeur y ajoute lui-même
                // le fond intégré, qu'il lit dans `shared/lexicons/`.
                const entries = Array.isArray(value) ? (value as LexiconEntry[]) : [];
                return (
                    <GeoLexiconEditor
                        prefKey={prefKey}
                        entries={entries}
                        languages={dynamicOptions ?? []}
                        onChange={next => handlers.onLexiconChange(prefKey, next)}
                    />
                );
            }
            if (definition['x-ui']?.widget === 'string-list') {
                return (
                    <StringListEditor
                        prefKey={prefKey}
                        entries={stringListValue(value, definition.default)}
                        onChange={next => handlers.onStringListChange(prefKey, next)}
                    />
                );
            }
            const options = definition.items?.enum;
            if (Array.isArray(options)) {
                const values = arrayValue(value, definition.default);
                return (
                    <div id={prefKey} className='geo-preference-array'>
                        {options.map(option => (
                            <label key={option} className='geo-preference-array-option'>
                                <input
                                    type='checkbox'
                                    checked={values.includes(option)}
                                    onChange={event => handlers.onArrayToggle(prefKey, option, event.currentTarget.checked, definition)}
                                />
                                <span>{enumOptionLabel(option, definition, devMode)}</span>
                            </label>
                        ))}
                    </div>
                );
            }
            return renderJson('array');
        }

        if (definition.type === 'object') {
            return renderJson('object');
        }

        if (definition['x-ui']?.widget === 'select-from') {
            const options = dynamicOptions ?? [];
            const current = String(value ?? definition.default ?? '');
            // La valeur courante peut avoir disparu de la liste source : la garder en tête evite
            // que le simple affichage de la page ne la remplace en silence.
            const isOrphan = current !== '' && !options.includes(current);
            return (
                <div className='geo-preference-select-from'>
                    <select
                        id={prefKey}
                        value={current}
                        disabled={options.length === 0 && !isOrphan}
                        onChange={event => handlers.onSelect(prefKey, event.currentTarget.value, definition)}
                    >
                        {isOrphan && <option value={current}>{`${current} (absent de la liste)`}</option>}
                        {options.map(option => (
                            <option key={option} value={option}>{option}</option>
                        ))}
                    </select>
                    {options.length === 0 && (
                        <p className='geo-preference-select-from-empty'>
                            La liste source est vide : ajoutez d'abord une entrée ci-dessus.
                        </p>
                    )}
                </div>
            );
        }

        if (definition['x-sensitive']) {
            return (
                <SensitiveInput
                    prefKey={prefKey}
                    value={String(value ?? definition.default ?? '')}
                    draft={draft}
                    onDraftChange={next => handlers.onDraftChange(prefKey, next)}
                    onCommit={() => handlers.onCommitText(prefKey)}
                    onKeyDown={event => handlers.onDraftKeyDown(event)}
                />
            );
        }

        const textValue = draft !== undefined ? draft : String(value ?? definition.default ?? '');
        return (
            <input
                id={prefKey}
                type='text'
                value={textValue}
                onChange={event => handlers.onDraftChange(prefKey, event.currentTarget.value)}
                onBlur={() => handlers.onCommitText(prefKey)}
                onKeyDown={event => handlers.onDraftKeyDown(event)}
            />
        );
    };

    const resetButton = modified ? (
        <button
            className='theia-button secondary geo-preference-reset'
            type='button'
            onClick={() => handlers.onReset(prefKey, definition)}
            title={`Revenir à la valeur par défaut (${defaultHint(definition)})`}
            aria-label='Réinitialiser'
        >
            <span className='codicon codicon-discard' />
        </button>
    ) : undefined;

    return (
        <div
            className={`geo-preference-item${modified ? ' modified' : ''}${highlighted ? ' highlighted' : ''}${wide ? ' wide' : ''}`}
            data-geo-preference-key={prefKey}
        >
            <div className='geo-preference-main'>
                <div className='geo-preference-title'>
                    <label htmlFor={prefKey} title={prefKey}>{label}</label>
                    <button
                        className='geo-preference-copy-key'
                        type='button'
                        title='Copier la clé'
                        aria-label={`Copier la clé ${prefKey}`}
                        onClick={() => { void navigator.clipboard?.writeText(prefKey); }}
                    >
                        <span className='codicon codicon-copy' />
                    </button>
                    {devMode && <code>{prefKey}</code>}
                </div>
                <div className='geo-preference-control'>
                    {!wide && renderControl()}
                    {resetButton}
                </div>
            </div>
            <div className='geo-preference-meta'>
                {description && <p>{description}</p>}
                {(advanced || definition['x-sensitive'] || devMode) && (
                    <div className='geo-preference-tags'>
                        {advanced && <span className='geo-preference-tag advanced'>Avancé</span>}
                        {definition['x-sensitive'] && <span className='geo-preference-tag sensitive'>Sensible</span>}
                        {devMode && (
                            <>
                                <span className='geo-preference-tag'>{definition['x-category'] || 'général'}</span>
                                {modified
                                    ? <span className='geo-preference-tag modified'>Modifiée</span>
                                    : <span className='geo-preference-tag default'>Défaut</span>}
                                {backend && <span className='geo-preference-tag backend'>Flask</span>}
                                {targets.includes('frontend') && <span className='geo-preference-tag frontend'>Theia</span>}
                                {tags.map(tag => (
                                    <span key={tag} className='geo-preference-tag muted'>{tag}</span>
                                ))}
                            </>
                        )}
                    </div>
                )}
            </div>
            {wide && (
                <div className='geo-preference-wide'>{renderControl()}</div>
            )}
        </div>
    );
});

/**
 * Exécute un défilement différé une fois le DOM réellement rendu : `update()` passe par la
 * file de messages Lumino puis React, donc un `setTimeout(0)` peut partir avant que le nœud
 * cible existe (catégorie repliée, filtre levé à l'instant). `useLayoutEffect` garantit
 * l'exécution après le commit ; si le nœud n'est pas encore là, on réessaie quelques frames.
 */
const PendingRevealEffect: React.FC<{
    reveal: PendingReveal | undefined;
    findElement: (reveal: PendingReveal) => HTMLElement | null;
    onDone: () => void;
}> = ({ reveal, findElement, onDone }) => {
    const token = reveal?.token;
    React.useLayoutEffect(() => {
        if (!reveal) {
            return;
        }
        let cancelled = false;
        let raf: number | undefined;
        let attempts = 0;
        const attempt = (): void => {
            if (cancelled) {
                return;
            }
            const element = findElement(reveal);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: reveal.kind === 'preference' ? 'center' : 'start' });
                onDone();
                return;
            }
            if (++attempts >= 12) {
                onDone();
                return;
            }
            raf = window.requestAnimationFrame(attempt);
        };
        attempt();
        return () => {
            cancelled = true;
            if (raf !== undefined) {
                window.cancelAnimationFrame(raf);
            }
        };
    }, [token]);
    return null;
};

@injectable()
export class GeoPreferencesWidget extends ReactWidget implements StatefulWidget {

    static readonly ID = 'geo-preferences-widget';
    static readonly LABEL = 'Préférences GeoApp';

    protected snapshot: GeoPreferenceSnapshot = {};
    protected highlightedCategory: string | undefined;
    protected highlightedPreferenceKey: string | undefined;
    /** Catégorie actuellement en tête de la zone de contenu (scroll-spy) : pilote la sidebar. */
    protected spyCategory: string | undefined;
    private spyRaf?: number;
    private highlightClearTimer?: number;
    protected expandedCategories = new Set<string>();
    protected expandedCategoriesInitialized = false;
    protected searchQuery = '';
    protected targetFilter: GeoPreferenceTargetFilter = 'all';
    protected valueFilter: GeoPreferenceValueFilter = 'all';
    /** Réglages avancés affichés par défaut (décision produit) ; décoché = masqués hors recherche. */
    protected showAdvanced = true;
    /** Mode développeur : clés, cibles et tags par ligne, filtres Theia/Flask dans la barre d'outils. */
    protected devMode = false;
    /** Défilement différé en attente, consommé par PendingRevealEffect après le rendu. */
    private pendingReveal?: PendingReveal;
    private revealToken = 0;

    /** Version incrémentée à chaque changement de valeur : sert à invalider les caches dérivés. */
    private snapshotVersion = 0;
    /** Cache des textes de recherche normalisés par clé (invalidé à chaque changement de valeur). */
    private readonly haystackCache = new Map<string, string>();
    /**
     * Options de `widget: 'select-from'`, par cle source. Recalculees seulement quand la valeur
     * de la preference source change : un tableau neuf a chaque rendu casserait le `React.memo`
     * de l'item.
     */
    private readonly dynamicOptionsCache = new Map<string, { signature: string; options: string[] }>();
    /** Brouillons des champs texte/nombre en cours d'édition (commit au blur). */
    private readonly textDrafts = new Map<string, string>();
    /** Feedback temporaire après clamp ou refus d'une saisie numérique. */
    private readonly numericFeedback = new Map<string, string>();
    private readonly numericFeedbackTimers = new Map<string, number>();
    /** Clés dont le dernier JSON saisi était invalide (feedback inline). */
    private readonly jsonErrors = new Set<string>();
    /** Valeur JSON figée pendant l'édition d'un textarea, pour éviter tout remount qui écraserait la saisie. */
    private readonly jsonEditingSnapshot = new Map<string, string>();

    /** Callbacks stables passés à chaque PreferenceItem (référence constante → React.memo efficace). */
    private readonly itemHandlers: PreferenceItemHandlers = {
        onBoolean: (key, checked) => { void this.handleBooleanChange(key, checked); },
        onSelect: (key, rawValue, definition) => { void this.handleSelectChange(key, rawValue, definition); },
        onDraftChange: (key, value) => this.handleDraftChange(key, value),
        onCommitText: key => { void this.commitTextDraft(key); },
        onCommitNumeric: (key, definition) => { void this.commitNumericDraft(key, definition); },
        onDraftKeyDown: event => this.handleDraftKeyDown(event),
        onArrayToggle: (key, option, checked, definition) => { void this.handleArrayToggle(key, option, checked, definition); },
        onStringListChange: (key, next) => { void this.store.setValue(key, next, PreferenceScope.User); },
        onLexiconChange: (key, next) => { void this.store.setValue(key, next, PreferenceScope.User); },
        onArrayJsonBlur: (key, rawValue) => { void this.handleArrayJsonBlur(key, rawValue); },
        onObjectJsonBlur: (key, rawValue) => { void this.handleObjectJsonBlur(key, rawValue); },
        onReset: (key, definition) => { void this.handleResetPreference(key, definition); },
        onJsonFocus: (key, jsonValue) => { this.jsonEditingSnapshot.set(key, jsonValue); },
        onJsonBlurClear: key => { this.jsonEditingSnapshot.delete(key); }
    };

    constructor(
        @inject(GeoPreferenceStore) private readonly store: GeoPreferenceStore,
        @inject(CommandService) private readonly commandService: CommandService,
    ) {
        super();
        this.id = GeoPreferencesWidget.ID;
        this.title.label = GeoPreferencesWidget.LABEL;
        this.title.caption = GeoPreferencesWidget.LABEL;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-settings-gear';
        this.addClass('geo-preferences-widget');

        this.snapshot = this.store.getSnapshot();
        this.toDispose.push(this.store.onDidChange(change => {
            this.snapshot = {
                ...this.snapshot,
                [change.key]: change.value
            };
            this.haystackCache.delete(change.key);
            this.snapshotVersion++;
            this.scheduleUpdate();
        }));

        this.update();
    }

    /**
     * Regroupe les rafraîchissements rapprochés (ex. pull initial du backend qui
     * applique les préférences une par une) en un seul render via microtask.
     */
    private updateScheduled = false;
    private scheduleUpdate(): void {
        if (this.updateScheduled) {
            return;
        }
        this.updateScheduled = true;
        Promise.resolve().then(() => {
            this.updateScheduled = false;
            this.update();
        });
    }

    protected onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        // Écoute en phase de capture : l'événement scroll ne remonte pas depuis le conteneur interne.
        this.node.addEventListener('scroll', this.handleContentScroll, true);
        this.handleContentScroll();
    }

    protected onBeforeDetach(msg: Message): void {
        this.node.removeEventListener('scroll', this.handleContentScroll, true);
        if (this.spyRaf !== undefined) {
            window.cancelAnimationFrame(this.spyRaf);
            this.spyRaf = undefined;
        }
        if (this.highlightClearTimer !== undefined) {
            window.clearTimeout(this.highlightClearTimer);
            this.highlightClearTimer = undefined;
        }
        for (const timer of this.numericFeedbackTimers.values()) {
            window.clearTimeout(timer);
        }
        this.numericFeedbackTimers.clear();
        super.onBeforeDetach(msg);
    }

    /** Scroll-spy : throttlé via requestAnimationFrame pour ne pas re-render à chaque pixel. */
    private handleContentScroll = (): void => {
        if (this.spyRaf !== undefined) {
            return;
        }
        this.spyRaf = window.requestAnimationFrame(() => {
            this.spyRaf = undefined;
            this.updateScrollSpy();
        });
    };

    private updateScrollSpy(): void {
        const content = this.node.querySelector<HTMLElement>('.geo-preferences-content');
        if (!content) {
            return;
        }
        const contentTop = content.getBoundingClientRect().top;
        const sections = Array.from(content.querySelectorAll<HTMLElement>('[data-geo-preference-category]'));
        let current: string | undefined;
        for (const section of sections) {
            // La dernière section dont le haut a franchi (ou effleure) le haut du conteneur est active.
            if (section.getBoundingClientRect().top - contentTop <= 8) {
                current = section.dataset.geoPreferenceCategory;
            } else {
                break;
            }
        }
        if (current === undefined && sections.length > 0) {
            current = sections[0].dataset.geoPreferenceCategory;
        }
        if (current !== this.spyCategory) {
            this.spyCategory = current;
            this.update();
        }
    }

    storeState(): object {
        return {
            // searchQuery volontairement non persistée : une recherche d'une session
            // précédente masquerait la cible des liens profonds à la réouverture.
            targetFilter: this.targetFilter,
            valueFilter: this.valueFilter,
            showAdvanced: this.showAdvanced,
            devMode: this.devMode,
            expandedCategories: Array.from(this.expandedCategories)
        };
    }

    restoreState(state: object): void {
        const restored = state as Partial<{
            /** Anciens champs tolérés mais ignorés : searchQuery, selectedGuideId. */
            searchQuery: string;
            targetFilter: GeoPreferenceTargetFilter;
            valueFilter: GeoPreferenceValueFilter;
            /** Ancien axe simple/avancé, converti en showAdvanced si ce champ manque. */
            complexityFilter: 'all' | 'simple' | 'advanced';
            selectedGuideId: string;
            showAdvanced: boolean;
            devMode: boolean;
            expandedCategories: string[];
        }>;
        if (restored.targetFilter) {
            this.targetFilter = restored.targetFilter;
        }
        if (restored.valueFilter) {
            this.valueFilter = restored.valueFilter;
        }
        if (typeof restored.showAdvanced === 'boolean') {
            this.showAdvanced = restored.showAdvanced;
        } else if (restored.complexityFilter) {
            this.showAdvanced = restored.complexityFilter !== 'simple';
        }
        if (typeof restored.devMode === 'boolean') {
            this.devMode = restored.devMode;
        }
        if (Array.isArray(restored.expandedCategories)) {
            this.expandedCategories = new Set(restored.expandedCategories);
            // On a un état explicite : ne pas ré-déplier toutes les catégories au premier render.
            this.expandedCategoriesInitialized = true;
        }
        this.update();
    }

    revealCategory(category?: string): void {
        if (!category) {
            this.highlightedCategory = undefined;
            this.highlightedPreferenceKey = undefined;
            this.update();
            return;
        }
        const entries = this.store.definitionsByCategory.get(category);
        if (!entries) {
            return;
        }
        // Si les filtres masquent toute la catégorie ciblée, les lever : un lien profond
        // qui n'affiche rien est pire que des filtres oubliés.
        if (!entries.some(({ key, definition }) => this.shouldShowPreference(key, definition))) {
            this.resetFilters();
        }
        this.focusCategory(category);
    }

    revealPreference(key?: string): void {
        if (!key) {
            return;
        }
        const definition = this.store.getDefinition(key);
        if (!definition) {
            return;
        }
        // Lever uniquement les filtres qui masqueraient la cible.
        if (!this.matchesSearchQuery(key as GeoPreferenceKey, definition)) {
            this.searchQuery = '';
        }
        if (!this.showAdvanced && this.isAdvancedPreference(definition)) {
            this.showAdvanced = true;
        }
        if (this.valueFilter === 'modified' && !this.isModified(key, definition)) {
            this.valueFilter = 'all';
        }
        const targets = definition['x-targets'] ?? ['frontend'];
        if (this.targetFilter !== 'all' && !targets.includes(this.targetFilter)) {
            this.targetFilter = 'all';
        }
        const category = definition['x-category'] || 'generic';
        this.expandedCategories.add(category);
        this.highlightedCategory = category;
        this.highlightedPreferenceKey = key;
        this.scheduleHighlightClear();
        this.requestReveal({ kind: 'preference', id: key });
        this.update();
    }

    /** Arme un défilement différé : PendingRevealEffect l'exécute après le rendu réel. */
    private requestReveal(reveal: Omit<PendingReveal, 'token'>): void {
        this.pendingReveal = { ...reveal, token: ++this.revealToken };
    }

    private findRevealElement(reveal: PendingReveal): HTMLElement | null {
        const selector = reveal.kind === 'preference'
            ? `[data-geo-preference-key="${CSS.escape(reveal.id)}"]`
            : `[data-geo-preference-category="${CSS.escape(reveal.id)}"]`;
        return this.node.querySelector<HTMLElement>(selector);
    }

    /** Efface recherche et filtres ; utilisé par l'état vide et avant un reveal masqué. */
    private resetFilters(): void {
        this.searchQuery = '';
        this.valueFilter = 'all';
        this.targetFilter = 'all';
        this.showAdvanced = true;
        this.update();
    }

    /** Le surlignage d'une préférence ciblée s'estompe automatiquement après quelques secondes. */
    private scheduleHighlightClear(): void {
        if (this.highlightClearTimer !== undefined) {
            window.clearTimeout(this.highlightClearTimer);
        }
        this.highlightClearTimer = window.setTimeout(() => {
            this.highlightClearTimer = undefined;
            this.highlightedPreferenceKey = undefined;
            this.update();
        }, 2600);
    }

    setSearchQuery(query?: string): void {
        this.searchQuery = query ?? '';
        this.update();
    }

    private openAiConfiguration = async (): Promise<void> => {
        try {
            await this.commandService.executeCommand('aiConfiguration:open');
        } catch (error) {
            console.error('[GeoPreferencesWidget] Failed to open AI Configuration view', error);
        }
    };

    private openChatPolicy = async (): Promise<void> => {
        try {
            await this.commandService.executeCommand('geoapp.chat.policy.open');
        } catch (error) {
            console.error('[GeoPreferencesWidget] Failed to open Chat IA policy view', error);
        }
    };

    protected render(): React.ReactNode {
        const sections = this.buildSections();
        this.initializeExpandedCategories(sections.map(section => section.category));

        const visibleSections = sections.filter(section => section.filteredEntries.length > 0);
        const totalCount = sections.reduce((sum, section) => sum + section.entries.length, 0);
        const visibleCount = visibleSections.reduce((sum, section) => sum + section.filteredEntries.length, 0);
        const modifiedCount = this.store.definitions
            .filter(({ key, definition }) => this.isModified(key, definition))
            .length;
        // Réglages avancés réellement masqués (une recherche les réaffiche quand ils matchent).
        const hiddenAdvancedCount = !this.showAdvanced && !this.searchQuery.trim()
            ? this.store.definitions.filter(({ definition }) => this.isAdvancedPreference(definition)).length
            : 0;

        return <div className='geo-preferences-root'>
            <div className='geo-preferences-toolbar'>
                <div className='geo-preferences-search-row'>
                    <input
                        type='search'
                        value={this.searchQuery}
                        placeholder='Rechercher une préférence, une valeur, un tag...'
                        onChange={event => this.handleSearchChange(event.currentTarget.value)}
                    />
                    {this.searchQuery && (
                        <button
                            className='theia-button secondary'
                            type='button'
                            onClick={() => this.handleSearchChange('')}
                            title='Effacer la recherche'
                        >
                            Effacer
                        </button>
                    )}
                </div>
                <div className='geo-preferences-filter-row'>
                    <button
                        className={`theia-button secondary geo-preferences-filter-button${this.valueFilter === 'modified' ? ' active' : ''}`}
                        type='button'
                        aria-pressed={this.valueFilter === 'modified'}
                        onClick={() => {
                            this.valueFilter = this.valueFilter === 'modified' ? 'all' : 'modified';
                            this.update();
                        }}
                    >
                        Modifiées ({modifiedCount})
                    </button>
                    <label className='geo-preferences-advanced-toggle'>
                        <input
                            type='checkbox'
                            checked={this.showAdvanced}
                            onChange={event => {
                                this.showAdvanced = event.currentTarget.checked;
                                this.update();
                            }}
                        />
                        <span>Afficher les réglages avancés</span>
                    </label>
                    {hiddenAdvancedCount > 0 && (
                        <span className='geo-preferences-advanced-count'>
                            {hiddenAdvancedCount} réglages avancés masqués
                        </span>
                    )}
                    {this.devMode && (
                        <>
                            <button
                                className={`theia-button secondary geo-preferences-filter-button${this.targetFilter === 'frontend' ? ' active' : ''}`}
                                type='button'
                                aria-pressed={this.targetFilter === 'frontend'}
                                onClick={() => {
                                    this.targetFilter = this.targetFilter === 'frontend' ? 'all' : 'frontend';
                                    this.update();
                                }}
                            >
                                Theia
                            </button>
                            <button
                                className={`theia-button secondary geo-preferences-filter-button${this.targetFilter === 'backend' ? ' active' : ''}`}
                                type='button'
                                aria-pressed={this.targetFilter === 'backend'}
                                onClick={() => {
                                    this.targetFilter = this.targetFilter === 'backend' ? 'all' : 'backend';
                                    this.update();
                                }}
                            >
                                Flask
                            </button>
                        </>
                    )}
                </div>
            </div>

            <div className='geo-preferences-layout'>
                <aside className='geo-preferences-sidebar'>
                    {this.buildSidebarGroups(sections).map(group => this.renderSidebarGroup(group))}
                    <div className='geo-preferences-sidebar-footer'>
                        <div>{visibleCount} / {totalCount} préférences affichées</div>
                        <label className='geo-preferences-dev-toggle'>
                            <input
                                type='checkbox'
                                checked={this.devMode}
                                onChange={event => {
                                    this.devMode = event.currentTarget.checked;
                                    this.update();
                                }}
                            />
                            <span>Mode développeur</span>
                        </label>
                    </div>
                </aside>
                <div className='geo-preferences-content'>
                    {visibleSections.length === 0 && this.renderEmptyState()}
                    {visibleSections.map(section => this.renderSection(section))}
                </div>
            </div>
            <PendingRevealEffect
                reveal={this.pendingReveal}
                findElement={reveal => this.findRevealElement(reveal)}
                onDone={() => { this.pendingReveal = undefined; }}
            />
        </div>;
    }

    private renderEmptyState(): React.ReactNode {
        const query = this.searchQuery.trim();
        return (
            <div className='geo-preferences-empty'>
                {query
                    ? <p>Aucune préférence ne correspond à « {query} » ni aux filtres actifs.</p>
                    : <p>Aucune préférence ne correspond aux filtres actifs.</p>}
                <button
                    className='theia-button secondary'
                    type='button'
                    onClick={() => this.resetFilters()}
                >
                    Réinitialiser les filtres
                </button>
            </div>
        );
    }

    /**
     * Regroupe les catégories sous les guides de `x-guides` : chaque catégorie appartient
     * au premier guide qui la cite, les non citées terminent dans « Autres ».
     */
    private buildSidebarGroups(sections: GeoPreferenceSection[]): GeoPreferenceSidebarGroup[] {
        const groups: GeoPreferenceSidebarGroup[] = this.store.guides.map(guide => ({
            id: guide.id,
            label: guide.label,
            description: guide.description,
            sections: []
        }));
        const other: GeoPreferenceSidebarGroup = { id: 'other', label: 'Autres', sections: [] };
        for (const section of sections) {
            const groupIndex = this.store.guides.findIndex(guide => guide.categories?.includes(section.category));
            (groupIndex >= 0 ? groups[groupIndex] : other).sections.push(section);
        }
        return [...groups, other].filter(group => group.sections.length > 0);
    }

    private renderSidebarGroup(group: GeoPreferenceSidebarGroup): React.ReactNode {
        // Un en-tête de guide défile jusqu'à sa première catégorie visible.
        const firstVisible = group.sections.find(section => section.filteredEntries.length > 0) ?? group.sections[0];
        return (
            <div key={group.id} className='geo-preferences-sidebar-group'>
                <button
                    type='button'
                    className='geo-preferences-sidebar-guide'
                    title={group.description ?? group.label}
                    onClick={() => this.focusCategory(firstVisible.category)}
                >
                    {group.label}
                </button>
                {group.sections.map(section => this.renderSidebarEntry(section))}
            </div>
        );
    }

    private renderSidebarEntry(section: GeoPreferenceSection): React.ReactNode {
        const total = section.entries.length;
        const visible = section.filteredEntries.length;
        // Une fois qu'un défilement a eu lieu, la sidebar suit la section visible (spy) ;
        // avant tout scroll, elle reflète la dernière catégorie ciblée explicitement.
        const active = section.category === (this.spyCategory ?? this.highlightedCategory);
        return (
            <button
                key={section.category}
                type='button'
                className={`geo-preferences-sidebar-entry${active ? ' active' : ''}${visible === 0 ? ' empty' : ''}`}
                aria-current={active ? 'true' : undefined}
                onClick={() => this.focusCategory(section.category)}
                title={section.label}
            >
                <span>{section.label}</span>
                <span className='geo-preferences-sidebar-count'>{visible}/{total}</span>
            </button>
        );
    }

    private renderSection(section: GeoPreferenceSection): React.ReactNode {
        const expanded = this.searchQuery.trim()
            ? true
            : this.expandedCategories.has(section.category);
        return (
            <section
                key={section.category}
                className={`geo-preferences-section${this.highlightedCategory === section.category ? ' highlighted' : ''}`}
                data-geo-preference-category={section.category}
            >
                <header>
                    <button
                        className='geo-preferences-section-toggle'
                        type='button'
                        aria-expanded={expanded}
                        onClick={() => this.toggleCategory(section.category)}
                        title={expanded ? 'Replier la section' : 'Déplier la section'}
                    >
                        <span className={`codicon ${expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} />
                        <h2>{section.label}</h2>
                        <span className='geo-preferences-section-count'>{section.filteredEntries.length}</span>
                    </button>
                    {this.renderSectionActions(section.category)}
                </header>
                {expanded && (
                    <div className='geo-preferences-items'>
                        {section.subsections.map(subsection => this.renderSubsection(section, subsection))}
                    </div>
                )}
            </section>
        );
    }

    private renderSubsection(section: GeoPreferenceSection, subsection: GeoPreferenceSubsection): React.ReactNode {
        const showHeading = section.subsections.length > 1 || subsection.label !== section.label;
        return (
            <div key={subsection.id} className='geo-preferences-subsection'>
                {showHeading && (
                    <h3>
                        <span>{subsection.label}</span>
                        <span>{subsection.entries.length}</span>
                    </h3>
                )}
                <div className='geo-preferences-subsection-items'>
                    {subsection.entries.map(({ key, definition }) => this.renderPreference(key, definition))}
                </div>
            </div>
        );
    }

    private renderSectionActions(category: string): React.ReactNode {
        if (category === 'ocr') {
            return (
                <button
                    className='theia-button secondary'
                    type='button'
                    onClick={() => { void this.openAiConfiguration(); }}
                    title='Ouvrir la configuration IA pour choisir le modèle utilisé par GeoApp OCR (Cloud)'
                >
                    Configurer OCR (IA)
                </button>
            );
        }

        if (category === 'ai') {
            return (
                <button
                    className='theia-button secondary'
                    type='button'
                    onClick={() => { void this.openAiConfiguration(); }}
                    title='Ouvrir la configuration IA pour choisir le modèle utilisé par les agents Theia'
                >
                    Configurer Agent Theia (IA)
                </button>
            );
        }

        if (category === 'chat') {
            return (
                <div className='geo-preferences-header-actions'>
                    <button
                        className='theia-button secondary'
                        type='button'
                        onClick={() => { void this.openChatPolicy(); }}
                        title='Voir la policy effective et la matrice des tools GeoApp'
                    >
                        Policy tools
                    </button>
                    <button
                        className='theia-button secondary'
                        type='button'
                        onClick={() => { void this.openAiConfiguration(); }}
                        title='Ouvrir la configuration IA Theia pour les agents, prompts et tools du chat'
                    >
                        Configurer IA Theia
                    </button>
                </div>
            );
        }

        return undefined;
    }

    /**
     * Options d'un `widget: 'select-from'` ou `'lexicon'`, lues dans la ou les preferences
     * designees par `optionsFrom`.
     *
     * Plusieurs sources sont reunies sans doublon : les langues d'equivalents du lexique viennent
     * a la fois de la liste de l'editeur de logs et de la langue cible des listings, et rien ne
     * garantit que la seconde figure dans la premiere. Une preference scalaire contribue sa propre
     * valeur, une preference `array` ses entrees.
     */
    private resolveDynamicOptions(definition: GeoPreferenceDefinition): string[] | undefined {
        const ui = definition['x-ui'];
        if (ui?.widget !== 'select-from' && ui?.widget !== 'lexicon') {
            return undefined;
        }
        const sourceKeys = ui.optionsFrom === undefined
            ? []
            : (Array.isArray(ui.optionsFrom) ? ui.optionsFrom : [ui.optionsFrom]);
        if (sourceKeys.length === 0) {
            return [];
        }

        const seen = new Set<string>();
        const options: string[] = [];
        for (const sourceKey of sourceKeys) {
            const sourceDefinition = this.store.definitions.find(entry => entry.key === sourceKey)?.definition;
            const raw = this.snapshot[sourceKey] ?? sourceDefinition?.default;
            const values = Array.isArray(raw) || Array.isArray(sourceDefinition?.default)
                ? stringListValue(this.snapshot[sourceKey], sourceDefinition?.default)
                : [String(raw ?? '')];
            for (const value of values) {
                const trimmed = value.trim();
                const key = stringListKey(trimmed);
                if (trimmed !== '' && !seen.has(key)) {
                    seen.add(key);
                    options.push(trimmed);
                }
            }
        }

        const cacheKey = sourceKeys.join('|');
        const signature = JSON.stringify(options);
        const cached = this.dynamicOptionsCache.get(cacheKey);
        if (cached?.signature === signature) {
            return cached.options;
        }
        this.dynamicOptionsCache.set(cacheKey, { signature, options });
        return options;
    }

    private renderPreference(key: GeoPreferenceKey, definition: GeoPreferenceDefinition): React.ReactNode {
        return (
            <PreferenceItem
                key={key}
                prefKey={key}
                definition={definition}
                value={this.snapshot[key]}
                dynamicOptions={this.resolveDynamicOptions(definition)}
                draft={this.textDrafts.get(key)}
                hasJsonError={this.jsonErrors.has(key)}
                frozenJson={this.jsonEditingSnapshot.get(key)}
                modified={this.isModified(key, definition)}
                highlighted={this.highlightedPreferenceKey === key}
                advanced={this.isAdvancedPreference(definition)}
                devMode={this.devMode}
                numericFeedback={this.numericFeedback.get(key)}
                handlers={this.itemHandlers}
            />
        );
    }

    private async handleBooleanChange(key: string, value: boolean): Promise<void> {
        await this.store.setValue(key, value, PreferenceScope.User);
    }

    /** Met à jour le brouillon local sans écrire dans les préférences (ni sync réseau). */
    private handleDraftChange(key: string, value: string): void {
        this.textDrafts.set(key, value);
        this.update();
    }

    /** Enter valide immédiatement (via blur), Échap annule le brouillon. */
    private handleDraftKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
        if (event.key === 'Enter') {
            event.currentTarget.blur();
        } else if (event.key === 'Escape') {
            const key = event.currentTarget.id;
            this.textDrafts.delete(key);
            this.update();
        }
    }

    private async commitTextDraft(key: string): Promise<void> {
        const draft = this.textDrafts.get(key);
        this.textDrafts.delete(key);
        if (draft === undefined) {
            return;
        }
        await this.store.setValue(key, draft, PreferenceScope.User);
    }

    private async commitNumericDraft(key: string, definition: GeoPreferenceDefinition): Promise<void> {
        const draft = this.textDrafts.get(key);
        this.textDrafts.delete(key);
        if (draft === undefined || draft.trim() === '') {
            this.update();
            return;
        }
        const trimmed = draft.trim();
        // Un entier refuse une saisie décimale plutôt que de la tronquer en silence.
        if (definition.type === 'integer' && !/^-?\d+$/.test(trimmed)) {
            this.setNumericFeedback(key, 'Un nombre entier est attendu');
            return;
        }
        let parsed = parseFloat(trimmed);
        if (Number.isNaN(parsed)) {
            // Saisie invalide (ex. « - ») : on rétablit l'affichage de la valeur courante.
            this.update();
            return;
        }
        // Theia borne silencieusement à la lecture : on borne avant l'écriture et on
        // le dit à l'utilisateur, sinon 500 serait enregistré et 18 affiché sans explication.
        if (typeof definition.maximum === 'number' && parsed > definition.maximum) {
            parsed = definition.maximum;
            this.setNumericFeedback(key, `Valeur ramenée à ${definition.maximum} (maximum)`);
        } else if (typeof definition.minimum === 'number' && parsed < definition.minimum) {
            parsed = definition.minimum;
            this.setNumericFeedback(key, `Valeur ramenée à ${definition.minimum} (minimum)`);
        }
        await this.store.setValue(key, parsed, PreferenceScope.User);
    }

    private setNumericFeedback(key: string, message: string): void {
        const existing = this.numericFeedbackTimers.get(key);
        if (existing !== undefined) {
            window.clearTimeout(existing);
        }
        this.numericFeedback.set(key, message);
        this.numericFeedbackTimers.set(key, window.setTimeout(() => {
            this.numericFeedbackTimers.delete(key);
            this.numericFeedback.delete(key);
            this.update();
        }, 4000));
        this.update();
    }

    private async handleSelectChange(key: string, rawValue: string, definition: GeoPreferenceDefinition): Promise<void> {
        let value: string | number = rawValue;
        if ((definition.type === 'number' || definition.type === 'integer') && rawValue !== '') {
            value = definition.type === 'integer' ? parseInt(rawValue, 10) : parseFloat(rawValue);
        }
        await this.store.setValue(key, value, PreferenceScope.User);
    }

    private async handleArrayToggle(
        key: string,
        option: string | number,
        checked: boolean,
        definition: GeoPreferenceDefinition
    ): Promise<void> {
        const current = arrayValue(this.snapshot[key], definition.default);
        const next = checked
            ? [...current.filter(value => value !== option), option]
            : current.filter(value => value !== option);
        await this.store.setValue(key, next, PreferenceScope.User);
    }

    private async handleObjectJsonBlur(key: string, rawValue: string): Promise<void> {
        const trimmed = rawValue.trim();
        if (!trimmed) {
            this.clearJsonError(key);
            await this.store.setValue(key, {}, PreferenceScope.User);
            return;
        }
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                this.clearJsonError(key);
                await this.store.setValue(key, parsed, PreferenceScope.User);
            } else {
                this.setJsonError(key, 'Un objet JSON est attendu');
            }
        } catch (error) {
            this.setJsonError(key, error);
        }
    }

    private async handleArrayJsonBlur(key: string, rawValue: string): Promise<void> {
        const trimmed = rawValue.trim();
        if (!trimmed) {
            this.clearJsonError(key);
            await this.store.setValue(key, [], PreferenceScope.User);
            return;
        }
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                this.clearJsonError(key);
                await this.store.setValue(key, parsed, PreferenceScope.User);
            } else {
                this.setJsonError(key, 'Un tableau JSON est attendu');
            }
        } catch (error) {
            this.setJsonError(key, error);
        }
    }

    private setJsonError(key: string, error: unknown): void {
        console.warn(`[GeoPreferencesWidget] Invalid JSON preference for ${key}`, error);
        if (!this.jsonErrors.has(key)) {
            this.jsonErrors.add(key);
            this.update();
        }
    }

    private clearJsonError(key: string): void {
        if (this.jsonErrors.delete(key)) {
            this.update();
        }
    }

    private async handleResetPreference(key: string, definition: GeoPreferenceDefinition): Promise<void> {
        this.textDrafts.delete(key);
        this.jsonErrors.delete(key);
        this.numericFeedback.delete(key);
        // Retirer la clé du scope utilisateur plutôt que d'y copier le défaut :
        // une copie figerait l'ancien défaut si une mise à jour le changeait.
        await this.store.reset(key, PreferenceScope.User);
    }

    private handleSearchChange(value: string): void {
        this.searchQuery = value;
        this.highlightedPreferenceKey = undefined;
        this.update();
    }

    private toggleCategory(category: string): void {
        if (this.expandedCategories.has(category)) {
            this.expandedCategories.delete(category);
        } else {
            this.expandedCategories.add(category);
        }
        this.update();
    }

    private focusCategory(category: string): void {
        this.expandedCategories.add(category);
        this.highlightedCategory = category;
        this.highlightedPreferenceKey = undefined;
        // Reflète immédiatement la sélection dans la sidebar, même sans événement de scroll.
        this.spyCategory = category;
        this.requestReveal({ kind: 'category', id: category });
        this.update();
    }

    private buildSections(): GeoPreferenceSection[] {
        return Array.from(this.store.definitionsByCategory.entries())
            .sort(([a], [b]) => this.compareCategories(a, b))
            .map(([category, entries]) => {
                const filteredEntries = entries
                    .filter(({ key, definition }) => this.shouldShowPreference(key, definition))
                    .sort((left, right) => this.comparePreferences(left.key, left.definition, right.key, right.definition));
                return {
                    category,
                    label: categoryLabel(category),
                    entries,
                    filteredEntries,
                    subsections: this.buildSubsections(filteredEntries)
                };
            });
    }

    private buildSubsections(
        entries: Array<{ key: GeoPreferenceKey; definition: GeoPreferenceDefinition }>
    ): GeoPreferenceSubsection[] {
        const map = new Map<string, GeoPreferenceSubsection>();
        for (const entry of entries) {
            const label = this.toPreferenceSectionLabel(entry.definition);
            const id = this.toSubsectionId(label);
            const order = entry.definition['x-ui']?.order ?? Number.MAX_SAFE_INTEGER;
            if (!map.has(id)) {
                map.set(id, { id, label, minOrder: order, entries: [] });
            }
            const subsection = map.get(id)!;
            subsection.minOrder = Math.min(subsection.minOrder, order);
            subsection.entries.push(entry);
        }
        return Array.from(map.values()).sort((left, right) =>
            left.minOrder - right.minOrder || left.label.localeCompare(right.label));
    }

    private initializeExpandedCategories(categories: string[]): void {
        if (this.expandedCategoriesInitialized) {
            return;
        }
        categories.forEach(category => this.expandedCategories.add(category));
        this.expandedCategoriesInitialized = true;
    }

    private shouldShowPreference(key: GeoPreferenceKey, definition: GeoPreferenceDefinition): boolean {
        return this.matchesBaseFilters(key, definition) && this.matchesSearchQuery(key, definition);
    }

    private matchesBaseFilters(key: GeoPreferenceKey, definition: GeoPreferenceDefinition): boolean {
        if (this.valueFilter === 'modified' && !this.isModified(key, definition)) {
            return false;
        }

        // Les réglages avancés ne sont masqués que si la case est décochée et qu'aucune
        // recherche n'est active : une recherche montre toujours ses correspondances.
        if (!this.showAdvanced && this.isAdvancedPreference(definition) && !this.searchQuery.trim()) {
            return false;
        }

        const targets = definition['x-targets'] ?? ['frontend'];
        if (this.targetFilter !== 'all' && !targets.includes(this.targetFilter)) {
            return false;
        }

        return true;
    }

    private matchesSearchQuery(key: GeoPreferenceKey, definition: GeoPreferenceDefinition): boolean {
        const query = this.normalizeSearchText(this.searchQuery);
        if (!query) {
            return true;
        }
        return this.getHaystack(key, definition).includes(query);
    }

    /** Texte de recherche normalisé pour une préférence, mémoïsé jusqu'au prochain changement de valeur. */
    private getHaystack(key: GeoPreferenceKey, definition: GeoPreferenceDefinition): string {
        const cached = this.haystackCache.get(key);
        if (cached !== undefined) {
            return cached;
        }
        const value = this.snapshot[key];
        const haystack = this.normalizeSearchText([
            key,
            definition.title,
            preferenceLabel(key),
            definition.description,
            definition['x-category'],
            categoryLabel(definition['x-category'] || 'generic'),
            definition['x-ui']?.label,
            definition['x-ui']?.section,
            definition['x-ui']?.shortDescription,
            ...(definition['x-tags'] ?? []),
            ...(definition['x-ui']?.keywords ?? []),
            ...(definition.enum ?? []).map(String),
            ...(definition.items?.enum ?? []).map(String),
            this.stringifyForSearch(value)
        ]
            .filter(Boolean)
            .join(' '));
        this.haystackCache.set(key, haystack);
        return haystack;
    }

    private isModified(key: GeoPreferenceKey | string, definition: GeoPreferenceDefinition): boolean {
        if (!('default' in definition)) {
            return false;
        }
        const current = this.snapshot[key] ?? definition.default;
        return !this.areValuesEqual(current, definition.default);
    }

    private areValuesEqual(left: unknown, right: unknown): boolean {
        if (left === right) {
            return true;
        }
        try {
            return JSON.stringify(left) === JSON.stringify(right);
        } catch {
            return false;
        }
    }

    private cloneValue<T>(value: T): T {
        if (value === undefined || value === null) {
            return value;
        }
        try {
            return JSON.parse(JSON.stringify(value)) as T;
        } catch {
            return value;
        }
    }

    private stringifyForSearch(value: unknown): string {
        if (value === undefined || value === null) {
            return '';
        }
        if (typeof value === 'string') {
            return value;
        }
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }

    private normalizeSearchText(value: string | undefined): string {
        return (value ?? '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim();
    }

    private compareCategories(a: string, b: string): number {
        const aOrder = CATEGORY_ORDERS.get(a);
        const bOrder = CATEGORY_ORDERS.get(b);
        if (aOrder !== undefined || bOrder !== undefined) {
            return (aOrder ?? Number.MAX_SAFE_INTEGER) - (bOrder ?? Number.MAX_SAFE_INTEGER);
        }
        return a.localeCompare(b);
    }

    private comparePreferences(
        leftKey: GeoPreferenceKey,
        leftDefinition: GeoPreferenceDefinition,
        rightKey: GeoPreferenceKey,
        rightDefinition: GeoPreferenceDefinition
    ): number {
        const leftOrder = leftDefinition['x-ui']?.order;
        const rightOrder = rightDefinition['x-ui']?.order;
        if (leftOrder !== undefined || rightOrder !== undefined) {
            return (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER);
        }
        return String(leftKey).localeCompare(String(rightKey));
    }

    /** Toutes les clés du schéma déclarent `x-ui.section` : simple repli sur « Général ». */
    private toPreferenceSectionLabel(definition: GeoPreferenceDefinition): string {
        return definition['x-ui']?.section ?? 'Général';
    }

    private toSubsectionId(label: string): string {
        return this.normalizeSearchText(label).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'general';
    }

    private isAdvancedPreference(definition: GeoPreferenceDefinition): boolean {
        return Boolean(definition['x-ui']?.advanced);
    }

}
