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
    <details className='geoapp-log-details'>
        <summary className='geoapp-log-details__summary'>
            📝 Patterns de texte ({allPatternsCount}) - Tapez @ dans le texte pour les utiliser
        </summary>
        <div className='geoapp-log-details__body geoapp-log-details__body--tight'>
            <div className='geoapp-log-patterns__group'>
                <div className='geoapp-log-patterns__group-title'>Patterns intégrés</div>
                <div className='geoapp-log-patterns__builtins'>
                    {builtinPatterns.map(p => (
                        <span key={p.id} className='geoapp-log-patterns__chip'>
                            @{p.name} → {resolvePatternValue(p.name, firstGeocacheId)}
                        </span>
                    ))}
                </div>
            </div>

            <div className='geoapp-log-patterns__group'>
                <div className='geoapp-log-patterns__group-title'>Patterns personnalisés</div>
                {customPatterns.length === 0 && (
                    <div className='geoapp-log-patterns__empty'>Aucun pattern personnalisé</div>
                )}
                {customPatterns.length > 0 && (
                    <div className='geoapp-log-patterns__list'>
                        {customPatterns.map(p => (
                            <div key={p.id} className='geoapp-log-patterns__row'>
                                <span className='geoapp-log-patterns__chip geoapp-log-patterns__chip--name'>
                                    @{p.name}
                                </span>
                                <span className='geoapp-log-patterns__content'>
                                    {p.content}
                                </span>
                                <button
                                    className='theia-button secondary geoapp-log-button--tiny'
                                    onClick={() => onEditPattern(p)}
                                >
                                    ✏️
                                </button>
                                <button
                                    className='theia-button secondary geoapp-log-button--tiny'
                                    onClick={() => onDeletePattern(p.id)}
                                >
                                    🗑️
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className='geoapp-log-patterns__form'>
                <div className='geoapp-log-patterns__group-title'>
                    {editingPattern ? 'Modifier le pattern' : 'Ajouter un pattern'}
                </div>
                <div className='geoapp-log-patterns__form-grid'>
                    <div>
                        <label className='geoapp-log-patterns__form-label'>Nom (sans @)</label>
                        <input
                            className='theia-input geoapp-log-patterns__form-input'
                            value={patternNameInput}
                            onChange={e => onPatternNameInputChange(e.target.value)}
                            placeholder='mon_pattern'
                        />
                    </div>
                    <div>
                        <label className='geoapp-log-patterns__form-label'>Contenu</label>
                        <input
                            className='theia-input geoapp-log-patterns__form-input'
                            value={patternContentInput}
                            onChange={e => onPatternContentInputChange(e.target.value)}
                            placeholder='Texte à insérer...'
                        />
                    </div>
                    <div className='geoapp-log-patterns__form-actions'>
                        {editingPattern ? (
                            <>
                                <button
                                    className='theia-button primary geoapp-log-button--form'
                                    onClick={onUpdatePattern}
                                    disabled={!patternNameInput.trim() || !patternContentInput.trim()}
                                >
                                    Enregistrer
                                </button>
                                <button
                                    className='theia-button secondary geoapp-log-button--form'
                                    onClick={onCancelEditPattern}
                                >
                                    Annuler
                                </button>
                            </>
                        ) : (
                            <button
                                className='theia-button primary geoapp-log-button--form'
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
