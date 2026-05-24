import * as React from 'react';
import {
    AdvancedFilterClause,
    AdvancedOperator,
    AutocompleteSuggestion,
    FieldDefinition,
    STANDARD_GEOCACHE_FIELD_DEFINITIONS,
    findAutocompleteTokenStart,
    getDefaultOperatorForKind,
    getOperatorOptionsForKind,
    normalizeFieldAlias,
} from './geocache-filter-shared';

export interface GeocacheFilterBarProps {
    searchQuery: string;
    advancedClauses: AdvancedFilterClause[];
    onSearchQueryChange: (query: string) => void;
    onAdvancedClausesChange: (clauses: AdvancedFilterClause[]) => void;
    fieldDefinitions?: FieldDefinition[];
    enumOptionsByField?: Map<string, string[]>;
    placeholder?: string;
    resultCount?: number;
    disabled?: boolean;
}

const INPUT_STYLE: React.CSSProperties = {
    padding: '4px 6px',
    border: '1px solid var(--theia-input-border)',
    background: 'var(--theia-input-background)',
    color: 'var(--theia-input-foreground)',
    borderRadius: 3,
};

export const GeocacheFilterBar: React.FC<GeocacheFilterBarProps> = ({
    searchQuery,
    advancedClauses,
    onSearchQueryChange,
    onAdvancedClausesChange,
    fieldDefinitions = STANDARD_GEOCACHE_FIELD_DEFINITIONS,
    enumOptionsByField = new Map(),
    placeholder = 'Rechercher... (@champ:valeur)',
    resultCount,
    disabled = false,
}) => {
    const [advancedFiltersOpen, setAdvancedFiltersOpen] = React.useState(false);
    const [autocompleteOpen, setAutocompleteOpen] = React.useState(false);
    const [autocompleteSuggestions, setAutocompleteSuggestions] = React.useState<AutocompleteSuggestion[]>([]);
    const [autocompleteActiveIndex, setAutocompleteActiveIndex] = React.useState(0);
    const searchInputRef = React.useRef<HTMLInputElement>(null);
    const autocompleteReplaceRangeRef = React.useRef<{ start: number; end: number } | null>(null);

    const fieldKindById = React.useMemo(() => {
        const map = new Map<string, 'text' | 'number' | 'enum' | 'boolean'>();
        for (const def of fieldDefinitions) {
            map.set(def.field, def.kind);
        }
        return map;
    }, [fieldDefinitions]);

    const fieldLabelById = React.useMemo(() => {
        const map = new Map<string, string>();
        for (const def of fieldDefinitions) {
            map.set(def.field, def.label);
        }
        return map;
    }, [fieldDefinitions]);

    const refreshAutocomplete = React.useCallback(
        (value: string) => {
            const input = searchInputRef.current;
            if (!input) {
                setAutocompleteOpen(false);
                return;
            }
            const caret = input.selectionStart ?? value.length;
            const before = value.slice(0, caret);
            const tokenStart = findAutocompleteTokenStart(before);
            if (tokenStart === null) {
                setAutocompleteOpen(false);
                return;
            }

            const fragment = before.slice(tokenStart + 1);
            if (fragment.includes(' ')) {
                setAutocompleteOpen(false);
                return;
            }

            const colonIndex = fragment.indexOf(':');
            const suggestions: AutocompleteSuggestion[] = [];
            if (colonIndex === -1) {
                const prefix = fragment.trim().toLowerCase();
                for (const def of fieldDefinitions) {
                    if (!prefix || def.field.startsWith(prefix) || def.label.toLowerCase().includes(prefix)) {
                        suggestions.push({
                            id: def.field,
                            label: `${def.field} — ${def.label}`,
                            insertText: `@${def.field}:`,
                        });
                    }
                }
            } else {
                const fieldPart = fragment.slice(0, colonIndex).trim().toLowerCase();
                const field = normalizeFieldAlias(fieldPart);
                if (field) {
                    const kind = fieldKindById.get(field);
                    if (kind === 'number') {
                        suggestions.push(
                            { id: `${field}-gte`, label: `${field}:>=…`, insertText: `@${field}:>=` },
                            { id: `${field}-lte`, label: `${field}:<=…`, insertText: `@${field}:<=` },
                            { id: `${field}-gt`, label: `${field}:>…`, insertText: `@${field}:>` },
                            { id: `${field}-lt`, label: `${field}:<…`, insertText: `@${field}:<` },
                            { id: `${field}-between`, label: `${field}:x<>y`, insertText: `@${field}:1<>5` },
                        );
                    } else if (kind === 'boolean') {
                        suggestions.push(
                            { id: `${field}-true`, label: `${field}:true`, insertText: `@${field}:true` },
                            { id: `${field}-false`, label: `${field}:false`, insertText: `@${field}:false` },
                        );
                    } else if (kind === 'enum') {
                        const options = enumOptionsByField.get(field) ?? [];
                        for (const opt of options.slice(0, 12)) {
                            suggestions.push({
                                id: `${field}-${opt}`,
                                label: `${field}:${opt}`,
                                insertText: `@${field}:${opt}`,
                            });
                        }
                    } else {
                        suggestions.push({
                            id: `${field}-contains`,
                            label: `${field}:…`,
                            insertText: `@${field}:`,
                        });
                    }
                }
            }

            if (suggestions.length === 0) {
                setAutocompleteOpen(false);
                return;
            }
            autocompleteReplaceRangeRef.current = { start: tokenStart, end: caret };
            setAutocompleteSuggestions(suggestions);
            setAutocompleteActiveIndex(0);
            setAutocompleteOpen(true);
        },
        [fieldDefinitions, fieldKindById, enumOptionsByField]
    );

    const applyAutocompleteSuggestion = React.useCallback(
        (suggestion: AutocompleteSuggestion) => {
            const input = searchInputRef.current;
            const range = autocompleteReplaceRangeRef.current;
            if (!input || !range) {
                return;
            }
            const current = searchQuery ?? '';
            const next = current.slice(0, range.start) + suggestion.insertText + current.slice(range.end);
            onSearchQueryChange(next);
            requestAnimationFrame(() => {
                const newPos = range.start + suggestion.insertText.length;
                input.focus();
                input.setSelectionRange(newPos, newPos);
            });
            setAutocompleteOpen(false);
        },
        [searchQuery, onSearchQueryChange]
    );

    const addClause = React.useCallback(() => {
        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const firstDef = fieldDefinitions[0];
        const kind = firstDef ? fieldKindById.get(firstDef.field) : undefined;
        const defaultOp = getDefaultOperatorForKind(kind);
        const newClause: AdvancedFilterClause = {
            id,
            field: firstDef?.field ?? 'difficulty',
            operator: defaultOp,
            value: defaultOp === 'between' ? '1' : '',
            value2: defaultOp === 'between' ? '5' : undefined,
        };
        onAdvancedClausesChange([...advancedClauses, newClause]);
        setAdvancedFiltersOpen(true);
    }, [fieldDefinitions, fieldKindById, advancedClauses, onAdvancedClausesChange]);

    const removeClause = React.useCallback(
        (id: string) => {
            onAdvancedClausesChange(advancedClauses.filter(c => c.id !== id));
        },
        [advancedClauses, onAdvancedClausesChange]
    );

    const updateClause = React.useCallback(
        (id: string, patch: Partial<AdvancedFilterClause>) => {
            onAdvancedClausesChange(advancedClauses.map(c => (c.id === id ? { ...c, ...patch } : c)));
        },
        [advancedClauses, onAdvancedClausesChange]
    );

    const clearAllClauses = React.useCallback(() => {
        onAdvancedClausesChange([]);
    }, [onAdvancedClausesChange]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative' }}>
                    <input
                        ref={searchInputRef}
                        type="text"
                        value={searchQuery ?? ''}
                        disabled={disabled}
                        onChange={e => {
                            const v = e.target.value;
                            onSearchQueryChange(v);
                            refreshAutocomplete(v);
                        }}
                        onKeyDown={e => {
                            if (!autocompleteOpen) {
                                return;
                            }
                            if (e.key === 'ArrowDown') {
                                e.preventDefault();
                                setAutocompleteActiveIndex(i => Math.min(i + 1, autocompleteSuggestions.length - 1));
                            } else if (e.key === 'ArrowUp') {
                                e.preventDefault();
                                setAutocompleteActiveIndex(i => Math.max(i - 1, 0));
                            } else if (e.key === 'Enter' || e.key === 'Tab') {
                                e.preventDefault();
                                const suggestion = autocompleteSuggestions[autocompleteActiveIndex];
                                if (suggestion) {
                                    applyAutocompleteSuggestion(suggestion);
                                }
                            } else if (e.key === 'Escape') {
                                e.preventDefault();
                                setAutocompleteOpen(false);
                            }
                        }}
                        onBlur={() => {
                            window.setTimeout(() => setAutocompleteOpen(false), 150);
                        }}
                        placeholder={placeholder}
                        style={{ ...INPUT_STYLE, width: 280 }}
                    />

                    {autocompleteOpen && autocompleteSuggestions.length > 0 && (
                        <div
                            style={{
                                position: 'absolute',
                                top: '100%',
                                left: 0,
                                marginTop: 4,
                                width: 360,
                                maxHeight: 220,
                                overflowY: 'auto',
                                border: '1px solid var(--theia-panel-border)',
                                background: 'var(--theia-editor-background)',
                                borderRadius: 3,
                                zIndex: 10001,
                                boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
                            }}
                            onMouseDown={e => e.preventDefault()}
                        >
                            {autocompleteSuggestions.map((s, idx) => (
                                <div
                                    key={s.id}
                                    style={{
                                        padding: '6px 8px',
                                        cursor: 'pointer',
                                        background:
                                            idx === autocompleteActiveIndex
                                                ? 'var(--theia-list-activeSelectionBackground)'
                                                : 'transparent',
                                    }}
                                    onMouseEnter={() => setAutocompleteActiveIndex(idx)}
                                    onClick={() => applyAutocompleteSuggestion(s)}
                                >
                                    <div style={{ fontSize: '0.9em' }}>{s.label}</div>
                                    <div style={{ fontSize: '0.8em', opacity: 0.7, fontFamily: 'monospace' }}>
                                        {s.insertText}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {resultCount !== undefined && (
                    <span style={{ fontSize: '0.9em', opacity: 0.7 }}>{resultCount} géocache(s)</span>
                )}

                <button
                    type="button"
                    onClick={() => setAdvancedFiltersOpen(o => !o)}
                    className="theia-button secondary"
                    disabled={disabled}
                    title="Afficher / masquer les filtres supplémentaires"
                >
                    {advancedFiltersOpen ? 'Masquer les filtres' : 'Filtres supplémentaires'}
                    {advancedClauses.length > 0 && ` (${advancedClauses.length})`}
                </button>
            </div>

            {advancedFiltersOpen && (
                <div
                    style={{
                        border: '1px solid var(--theia-panel-border)',
                        borderRadius: 3,
                        padding: 8,
                        background: 'var(--theia-editor-background)',
                    }}
                >
                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 8,
                            marginBottom: 8,
                        }}
                    >
                        <div style={{ fontWeight: 600, opacity: 0.9 }}>Filtres supplémentaires</div>
                        <div style={{ display: 'flex', gap: 8 }}>
                            {advancedClauses.length > 0 && (
                                <button
                                    type="button"
                                    onClick={clearAllClauses}
                                    className="theia-button secondary"
                                    disabled={disabled}
                                    style={{ color: 'var(--theia-errorForeground)' }}
                                >
                                    Supprimer tous les filtres
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={addClause}
                                className="theia-button primary"
                                disabled={disabled}
                            >
                                Ajouter un filtre
                            </button>
                        </div>
                    </div>

                    {advancedClauses.length === 0 ? (
                        <div style={{ opacity: 0.7, fontSize: '0.9em' }}>Aucun filtre supplémentaire.</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {advancedClauses.map(clause => {
                                const kind = fieldKindById.get(clause.field);
                                const enumOptions = enumOptionsByField.get(clause.field) ?? [];
                                const operatorOptions = getOperatorOptionsForKind(kind);

                                return (
                                    <div
                                        key={clause.id}
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: '160px 150px 1fr 40px',
                                            gap: 8,
                                            alignItems: 'center',
                                        }}
                                    >
                                        <select
                                            value={clause.field}
                                            disabled={disabled}
                                            onChange={e => {
                                                const newField = e.target.value;
                                                const newKind = fieldKindById.get(newField);
                                                const defaultOp = getDefaultOperatorForKind(newKind);
                                                const patch: Partial<AdvancedFilterClause> = {
                                                    field: newField,
                                                    operator: defaultOp,
                                                    value: '',
                                                    value2: undefined,
                                                    values: undefined,
                                                };
                                                if (defaultOp === 'between') {
                                                    patch.value = '1';
                                                    patch.value2 = '5';
                                                }
                                                updateClause(clause.id, patch);
                                            }}
                                            style={INPUT_STYLE}
                                        >
                                            {fieldDefinitions.map(def => (
                                                <option key={def.field} value={def.field}>
                                                    {def.label}
                                                </option>
                                            ))}
                                        </select>

                                        <select
                                            value={clause.operator}
                                            disabled={disabled}
                                            onChange={e => {
                                                const op = e.target.value as AdvancedOperator;
                                                const patch: Partial<AdvancedFilterClause> = { operator: op };
                                                if (op === 'between') {
                                                    patch.value2 = clause.value2 ?? '';
                                                } else {
                                                    patch.value2 = undefined;
                                                }
                                                if (op === 'in' || op === 'not_in') {
                                                    patch.values = clause.values ?? [];
                                                } else {
                                                    patch.values = undefined;
                                                }
                                                updateClause(clause.id, patch);
                                            }}
                                            style={INPUT_STYLE}
                                        >
                                            {operatorOptions.map(o => (
                                                <option key={o.operator} value={o.operator}>
                                                    {o.label}
                                                </option>
                                            ))}
                                        </select>

                                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                            {kind === 'enum' &&
                                            (clause.operator === 'in' || clause.operator === 'not_in') ? (
                                                <select
                                                    multiple
                                                    value={clause.values ?? []}
                                                    disabled={disabled}
                                                    onChange={e => {
                                                        const selected = Array.from(e.target.selectedOptions).map(
                                                            o => o.value
                                                        );
                                                        updateClause(clause.id, { values: selected });
                                                    }}
                                                    style={{ ...INPUT_STYLE, width: '100%', minHeight: 70 }}
                                                >
                                                    {enumOptions.map(opt => (
                                                        <option key={opt} value={opt}>
                                                            {opt}
                                                        </option>
                                                    ))}
                                                </select>
                                            ) : kind === 'enum' ? (
                                                <select
                                                    value={clause.value}
                                                    disabled={disabled}
                                                    onChange={e =>
                                                        updateClause(clause.id, { value: e.target.value })
                                                    }
                                                    style={{ ...INPUT_STYLE, width: '100%' }}
                                                >
                                                    <option value="">—</option>
                                                    {enumOptions.map(opt => (
                                                        <option key={opt} value={opt}>
                                                            {opt}
                                                        </option>
                                                    ))}
                                                </select>
                                            ) : kind === 'boolean' ? (
                                                <select
                                                    value={clause.value}
                                                    disabled={disabled}
                                                    onChange={e =>
                                                        updateClause(clause.id, { value: e.target.value })
                                                    }
                                                    style={{ ...INPUT_STYLE, width: '100%' }}
                                                >
                                                    <option value="">—</option>
                                                    <option value="true">Oui</option>
                                                    <option value="false">Non</option>
                                                </select>
                                            ) : clause.operator === 'between' ? (
                                                <>
                                                    <input
                                                        type="number"
                                                        step={
                                                            clause.field === 'difficulty' ||
                                                            clause.field === 'terrain'
                                                                ? 0.5
                                                                : 1
                                                        }
                                                        value={clause.value}
                                                        disabled={disabled}
                                                        onChange={e =>
                                                            updateClause(clause.id, { value: e.target.value })
                                                        }
                                                        style={{ ...INPUT_STYLE, width: 100 }}
                                                    />
                                                    <span style={{ opacity: 0.7 }}>et</span>
                                                    <input
                                                        type="number"
                                                        step={
                                                            clause.field === 'difficulty' ||
                                                            clause.field === 'terrain'
                                                                ? 0.5
                                                                : 1
                                                        }
                                                        value={clause.value2 ?? ''}
                                                        disabled={disabled}
                                                        onChange={e =>
                                                            updateClause(clause.id, { value2: e.target.value })
                                                        }
                                                        style={{ ...INPUT_STYLE, width: 100 }}
                                                    />
                                                </>
                                            ) : (
                                                <input
                                                    type={kind === 'number' ? 'number' : 'text'}
                                                    step={
                                                        clause.field === 'difficulty' ||
                                                        clause.field === 'terrain'
                                                            ? 0.5
                                                            : 1
                                                    }
                                                    value={clause.value}
                                                    disabled={disabled}
                                                    onChange={e =>
                                                        updateClause(clause.id, { value: e.target.value })
                                                    }
                                                    placeholder={fieldLabelById.get(clause.field) ?? ''}
                                                    style={{ ...INPUT_STYLE, width: '100%' }}
                                                />
                                            )}
                                        </div>

                                        <button
                                            type="button"
                                            onClick={() => removeClause(clause.id)}
                                            disabled={disabled}
                                            className="theia-button secondary"
                                            style={{ padding: '2px 6px', color: 'var(--theia-errorForeground)' }}
                                            title="Supprimer ce filtre"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
