import * as React from 'react';

import { GeoPreferenceDefinition } from './geo-preferences-schema';
import { GeoLexiconEditor, LexiconEntry } from './geo-lexicon-editor';
import { humanSegment, preferenceLabel } from './geo-preference-filters';

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

export function enumOptionLabel(option: string | number, definition?: GeoPreferenceDefinition, showRaw = false): string {
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
export function isWideControl(definition: GeoPreferenceDefinition): boolean {
    const widget = definition['x-ui']?.widget;
    if (widget === 'lexicon' || widget === 'string-list') {
        return true;
    }
    // `select-from` reste compact : c'est un menu déroulant comme les enums.
    return definition.type === 'array' || definition.type === 'object';
}

/** Défaut lisible pour l'info-bulle du bouton de réinitialisation. */
export function defaultHint(definition: GeoPreferenceDefinition): string {
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

export function arrayValue(value: unknown, fallback: unknown): Array<string | number> {
    const source = Array.isArray(value) ? value : fallback;
    if (!Array.isArray(source)) {
        return [];
    }
    return source.filter((entry): entry is string | number => typeof entry === 'string' || typeof entry === 'number');
}

export function formatJson(value: unknown, fallback: unknown): string {
    const source = value ?? fallback ?? {};
    try {
        return JSON.stringify(source, null, 2);
    } catch {
        return '{}';
    }
}

/** Valeurs d'une préférence rendue en liste de chaînes libres (les non-chaînes sont ignorées). */
export function stringListValue(value: unknown, fallback: unknown): string[] {
    return arrayValue(value, fallback).map(entry => String(entry));
}

/**
 * Forme comparable d'une entrée de liste libre : deux langues qui ne diffèrent que par la casse
 * ou les accents sont le même doublon pour l'utilisateur.
 */
export function stringListKey(entry: string): string {
    return entry.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/**
 * Champ de saisie d'une valeur `x-sensitive` : mot de passe avec bouton œil pour
 * révéler temporairement la valeur et indicateur « Clé définie » / « Aucune clé »
 * qui ne révèle rien du secret. Le brouillon vit dans PreferenceItem comme les
 * autres champs texte.
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

/**
 * Liste de chaînes libres, éditable ligne à ligne. Servie aux `array` dont le schéma déclare
 * `x-ui.widget: "string-list"`, là où le rendu par défaut serait une textarea JSON brute.
 *
 * Le champ de saisie tient son propre état : la préférence n'est écrite qu'à la validation,
 * et `React.memo` sur `PreferenceItem` reste efficace pendant la frappe.
 */
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
export interface PreferenceItemHandlers {
    onBoolean(key: string, checked: boolean): void;
    onSelect(key: string, rawValue: string, definition: GeoPreferenceDefinition): void;
    /** Brouillon texte validé au blur : le widget n'écrit que la valeur finale. */
    onTextCommit(key: string, value: string): void;
    /** Brouillon numérique brut (parse, clamp et feedback restent côté widget). */
    onNumericCommit(key: string, rawValue: string, definition: GeoPreferenceDefinition): void;
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

export interface PreferenceItemProps {
    prefKey: string;
    definition: GeoPreferenceDefinition;
    value: unknown;
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
 * (valeur, erreur JSON, surlignage…). Le brouillon des champs texte/nombre est un état
 * local : une frappe ne re-rend que cet item, plus toute la page.
 */
export const PreferenceItem = React.memo(function PreferenceItem(props: PreferenceItemProps): React.ReactElement {
    const { prefKey, definition, value, hasJsonError, frozenJson, modified, highlighted, advanced, devMode, numericFeedback, dynamicOptions, handlers } = props;
    const description = definition['x-ui']?.shortDescription ?? definition.description;
    const label = definition['x-ui']?.label ?? definition.title ?? preferenceLabel(prefKey);
    const targets = definition['x-targets'] ?? ['frontend'];
    const backend = targets.includes('backend');
    const tags = definition['x-tags'] ?? [];
    const wide = isWideControl(definition);

    // Brouillon local des champs texte/nombre : validé au blur, annulé par Échap.
    const [draft, setDraft] = React.useState<string | undefined>(undefined);
    const cancelDraftRef = React.useRef(false);
    // Une valeur changée de l'extérieur (reset, pull backend) abandonne le brouillon.
    React.useEffect(() => { setDraft(undefined); }, [value]);

    const draftKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
        if (event.key === 'Enter') {
            event.currentTarget.blur();
        } else if (event.key === 'Escape') {
            // Marquer avant le blur : le commit au blur doit être ignoré.
            cancelDraftRef.current = true;
            event.currentTarget.blur();
        }
    };

    const commitTextDraft = (): void => {
        if (cancelDraftRef.current) {
            cancelDraftRef.current = false;
            setDraft(undefined);
            return;
        }
        if (draft === undefined) {
            return;
        }
        setDraft(undefined);
        handlers.onTextCommit(prefKey, draft);
    };

    const commitNumericDraft = (): void => {
        if (cancelDraftRef.current) {
            cancelDraftRef.current = false;
            setDraft(undefined);
            return;
        }
        if (draft === undefined) {
            return;
        }
        setDraft(undefined);
        handlers.onNumericCommit(prefKey, draft, definition);
    };

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
                        onChange={event => setDraft(event.currentTarget.value)}
                        onBlur={commitNumericDraft}
                        onKeyDown={draftKeyDown}
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
                    onDraftChange={setDraft}
                    onCommit={commitTextDraft}
                    onKeyDown={draftKeyDown}
                />
            );
        }

        const textValue = draft !== undefined ? draft : String(value ?? definition.default ?? '');
        return (
            <input
                id={prefKey}
                type='text'
                value={textValue}
                onChange={event => setDraft(event.currentTarget.value)}
                onBlur={commitTextDraft}
                onKeyDown={draftKeyDown}
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
