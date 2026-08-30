/**
 * Section de gestion des @patterns (intégrés + personnalisés + CRUD).
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 5). Composant de
 * présentation : tout l'état et les callbacks sont passés via props.
 */

import * as React from '@theia/core/shared/react';
import { LogTextPattern } from './types';

export interface PatternsSectionProps {
    allPatternsCount: number;
    builtinPatterns: LogTextPattern[];
    customPatterns: LogTextPattern[];
    resolvePatternValue: (patternName: string, geocacheId: number | null) => string;
    firstGeocacheId: number | null;
    editingPattern: LogTextPattern | null;
    patternNameInput: string;
    patternContentInput: string;
    onPatternNameInputChange: (value: string) => void;
    onPatternContentInputChange: (value: string) => void;
    onEditPattern: (pattern: LogTextPattern) => void;
    onDeletePattern: (patternId: string) => void;
    onAddPattern: () => void;
    onUpdatePattern: () => void;
    onCancelEditPattern: () => void;
}

export const PatternsSection: React.FC<PatternsSectionProps> = ({
    allPatternsCount, builtinPatterns, customPatterns, resolvePatternValue, firstGeocacheId,
    editingPattern, patternNameInput, patternContentInput,
    onPatternNameInputChange, onPatternContentInputChange,
    onEditPattern, onDeletePattern, onAddPattern, onUpdatePattern, onCancelEditPattern,
}) => (
    <details style={{ marginBottom: 8 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
            📝 Patterns de texte ({allPatternsCount}) - Tapez @ dans le texte pour les utiliser
        </summary>
        <div style={{ marginTop: 8, padding: 10, background: 'var(--theia-editor-background)', border: '1px solid var(--theia-panel-border)', borderRadius: 6 }}>
            <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Patterns intégrés</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11 }}>
                    {builtinPatterns.map(p => (
                        <span key={p.id} style={{ padding: '2px 6px', background: 'var(--theia-badge-background)', borderRadius: 3 }}>
                            @{p.name} → {resolvePatternValue(p.name, firstGeocacheId)}
                        </span>
                    ))}
                </div>
            </div>

            <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Patterns personnalisés</div>
                {customPatterns.length === 0 && (
                    <div style={{ fontSize: 11, opacity: 0.7 }}>Aucun pattern personnalisé</div>
                )}
                {customPatterns.length > 0 && (
                    <div style={{ display: 'grid', gap: 6 }}>
                        {customPatterns.map(p => (
                            <div key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11 }}>
                                <span style={{ padding: '2px 6px', background: 'var(--theia-badge-background)', borderRadius: 3, fontWeight: 600 }}>
                                    @{p.name}
                                </span>
                                <span style={{ opacity: 0.8, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {p.content}
                                </span>
                                <button
                                    className='theia-button secondary'
                                    style={{ fontSize: 10, padding: '2px 6px' }}
                                    onClick={() => onEditPattern(p)}
                                >
                                    ✏️
                                </button>
                                <button
                                    className='theia-button secondary'
                                    style={{ fontSize: 10, padding: '2px 6px' }}
                                    onClick={() => onDeletePattern(p.id)}
                                >
                                    🗑️
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div style={{ borderTop: '1px solid var(--theia-panel-border)', paddingTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                    {editingPattern ? 'Modifier le pattern' : 'Ajouter un pattern'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr auto', gap: 8, alignItems: 'end' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: 10, opacity: 0.8, marginBottom: 2 }}>Nom (sans @)</label>
                        <input
                            className='theia-input'
                            value={patternNameInput}
                            onChange={e => onPatternNameInputChange(e.target.value)}
                            placeholder='mon_pattern'
                            style={{ width: '100%', fontSize: 11 }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: 10, opacity: 0.8, marginBottom: 2 }}>Contenu</label>
                        <input
                            className='theia-input'
                            value={patternContentInput}
                            onChange={e => onPatternContentInputChange(e.target.value)}
                            placeholder='Texte à insérer...'
                            style={{ width: '100%', fontSize: 11 }}
                        />
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                        {editingPattern ? (
                            <>
                                <button
                                    className='theia-button primary'
                                    style={{ fontSize: 11, padding: '4px 8px' }}
                                    onClick={onUpdatePattern}
                                    disabled={!patternNameInput.trim() || !patternContentInput.trim()}
                                >
                                    Enregistrer
                                </button>
                                <button
                                    className='theia-button secondary'
                                    style={{ fontSize: 11, padding: '4px 8px' }}
                                    onClick={onCancelEditPattern}
                                >
                                    Annuler
                                </button>
                            </>
                        ) : (
                            <button
                                className='theia-button primary'
                                style={{ fontSize: 11, padding: '4px 8px' }}
                                onClick={onAddPattern}
                                disabled={!patternNameInput.trim() || !patternContentInput.trim()}
                            >
                                Ajouter
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    </details>
);
