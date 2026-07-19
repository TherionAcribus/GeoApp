/**
 * Composant pour le mode brute force
 * Permet de tester plusieurs valeurs pour une ou plusieurs lettres
 * Avec onglets pour basculer entre les entrées et les résultats
 */

import * as React from '@theia/core/shared/react';
import { ValueRangeParser, CombinationGenerator } from '../../common/value-range-parser';
import { LetterValue } from '../../common/types';

export interface BruteForceResult {
    id: string;
    label: string;
    values: Record<string, number>;
    coordinates?: {
        ddm: string;
        decimal: { lat: number; lon: number };
    };
}

interface BruteForceComponentProps {
    letters: string[];
    values: Map<string, LetterValue>;
    results: BruteForceResult[];
    onBruteForceExecute: (combinations: Array<Record<string, number>>) => void;
    onCreateWaypoint: (resultId: string, autoSave: boolean) => void;
    onRemoveResult: (resultId: string) => void;
    onClearAll: () => void;
}

type BruteForceTab = 'inputs' | 'results';

export const BruteForceComponent: React.FC<BruteForceComponentProps> = ({
    letters,
    values,
    results,
    onBruteForceExecute,
    onCreateWaypoint,
    onRemoveResult,
    onClearAll
}) => {
    const [patterns, setPatterns] = React.useState<Map<string, string>>(new Map());
    const [showHelp, setShowHelp] = React.useState(false);
    const [activeTab, setActiveTab] = React.useState<BruteForceTab>('inputs');

    // Basculer automatiquement vers l'onglet résultats quand des résultats arrivent (une seule fois)
    const previousResultsLength = React.useRef(0);
    React.useEffect(() => {
        if (results.length > 0 && previousResultsLength.current === 0) {
            setActiveTab('results');
        }
        previousResultsLength.current = results.length;
    }, [results.length]);

    /**
     * Met à jour le pattern d'une lettre
     */
    const updatePattern = (letter: string, pattern: string) => {
        const newPatterns = new Map(patterns);
        if (pattern.trim() === '') {
            newPatterns.delete(letter);
        } else {
            newPatterns.set(letter, pattern);
        }
        setPatterns(newPatterns);
    };

    /**
     * Génère toutes les combinaisons
     */
    const generateCombinations = () => {
        const ranges = new Map<string, number[]>();
        
        // Pour chaque lettre, déterminer les valeurs possibles
        for (const letter of letters) {
            const pattern = patterns.get(letter);
            
            if (pattern) {
                // Pattern défini → parser
                const parsedValues = ValueRangeParser.parsePattern(pattern);
                if (parsedValues.length > 0) {
                    ranges.set(letter, parsedValues);
                } else {
                    // Pattern invalide → utiliser valeur actuelle si disponible
                    const currentValue = values.get(letter);
                    if (currentValue) {
                        ranges.set(letter, [currentValue.value]);
                    }
                }
            } else {
                // Pas de pattern → utiliser valeur actuelle
                const currentValue = values.get(letter);
                if (currentValue) {
                    ranges.set(letter, [currentValue.value]);
                } else {
                    // Pas de valeur → ignorer cette lettre (erreur)
                    return;
                }
            }
        }
        
        const combinations = CombinationGenerator.generateCombinations(ranges);
        onBruteForceExecute(combinations);
    };

    /**
     * Calcule le nombre de combinaisons
     */
    const getCombinationCount = (): number => {
        const ranges = new Map<string, number[]>();
        
        for (const letter of letters) {
            const pattern = patterns.get(letter);
            
            if (pattern) {
                const parsedValues = ValueRangeParser.parsePattern(pattern);
                if (parsedValues.length > 0) {
                    ranges.set(letter, parsedValues);
                } else {
                    ranges.set(letter, [0]); // Valeur par défaut
                }
            } else {
                const currentValue = values.get(letter);
                ranges.set(letter, currentValue ? [currentValue.value] : [0]);
            }
        }
        
        return CombinationGenerator.countCombinations(ranges);
    };

    const combinationCount = getCombinationCount();
    const maxCombinations = CombinationGenerator.getMaxCombinations();
    const tooManyCombinations = combinationCount > maxCombinations;

    return (
        <div style={{
            border: '1px solid var(--theia-panel-border)',
            borderRadius: '6px',
            padding: '16px',
            marginBottom: '20px',
            backgroundColor: 'var(--theia-editor-background)'
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span className="codicon codicon-rocket" style={{ fontSize: '16px' }} />
                <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 'bold' }}>
                    Mode Brute Force
                </h4>
                {results.length > 0 && (
                    <div role='tablist' aria-label='Mode Brute Force' style={{
                        display: 'flex',
                        gap: '4px',
                        marginLeft: 'auto'
                    }}>
                        <button
                            role='tab'
                            aria-selected={activeTab === 'inputs'}
                            onClick={() => setActiveTab('inputs')}
                            style={{
                                padding: '4px 12px',
                                fontSize: '11px',
                                backgroundColor: activeTab === 'inputs'
                                    ? 'var(--theia-button-background)'
                                    : 'var(--theia-button-secondaryBackground)',
                                color: activeTab === 'inputs'
                                    ? 'var(--theia-button-foreground)'
                                    : 'var(--theia-button-secondaryForeground)',
                                border: 'none',
                                borderRadius: '3px',
                                cursor: 'pointer'
                            }}
                        >
                            <span className="codicon codicon-edit" style={{ marginRight: '4px' }} aria-hidden='true' />
                            Entrées
                        </button>
                        <button
                            role='tab'
                            aria-selected={activeTab === 'results'}
                            onClick={() => setActiveTab('results')}
                            style={{
                                padding: '4px 12px',
                                fontSize: '11px',
                                backgroundColor: activeTab === 'results'
                                    ? 'var(--theia-button-background)'
                                    : 'var(--theia-button-secondaryBackground)',
                                color: activeTab === 'results'
                                    ? 'var(--theia-button-foreground)'
                                    : 'var(--theia-button-secondaryForeground)',
                                border: 'none',
                                borderRadius: '3px',
                                cursor: 'pointer'
                            }}
                        >
                            <span className="codicon codicon-checklist" style={{ marginRight: '4px' }} aria-hidden='true' />
                            Résultats ({results.length})
                        </button>
                    </div>
                )}

                <button
                    onClick={() => setShowHelp(!showHelp)}
                    style={{
                        marginLeft: results.length > 0 ? '8px' : 'auto',
                        padding: '4px 8px',
                        fontSize: '11px',
                        backgroundColor: 'var(--theia-button-secondaryBackground)',
                        color: 'var(--theia-button-secondaryForeground)',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: 'pointer'
                    }}
                >
                    {showHelp ? 'Masquer l\'aide' : 'Afficher l\'aide'}
                </button>
            </div>

            {showHelp && (
                <div style={{
                    padding: '12px',
                    backgroundColor: 'var(--theia-input-background)',
                    borderRadius: '4px',
                    marginBottom: '12px',
                    fontSize: '12px',
                    fontFamily: 'var(--theia-code-font-family)'
                }}>
                    <strong>Patterns disponibles :</strong>
                    <ul style={{ marginTop: '8px', paddingLeft: '20px' }}>
                        <li><code>*</code> : Toutes les valeurs de 0 à 9</li>
                        <li><code>&lt;X</code> : Valeurs strictement inférieures à X</li>
                        <li><code>&lt;=X</code> : Valeurs inférieures ou égales à X</li>
                        <li><code>&gt;X</code> : Valeurs strictement supérieures à X</li>
                        <li><code>&gt;=X</code> : Valeurs supérieures ou égales à X</li>
                        <li><code>X&lt;&gt;Y</code> : Valeurs strictement entre X et Y</li>
                        <li><code>X&lt;==&gt;Y</code> : Valeurs entre X et Y inclus</li>
                        <li><code>10,20,25</code> : Liste de valeurs spécifiques (virgule ou point-virgule)</li>
                    </ul>
                    <div style={{ marginTop: '8px', color: 'var(--theia-descriptionForeground)' }}>
                        💡 Laissez vide pour utiliser la valeur saisie normalement
                    </div>
                </div>
            )}

            {/* Onglet Entrées */}
            {activeTab === 'inputs' && (
                <>
            <div style={{ marginBottom: '12px' }}>
                {letters.map(letter => {
                    const pattern = patterns.get(letter) || '';
                    const isValid = pattern === '' || ValueRangeParser.isValidPattern(pattern);
                    const description = pattern ? ValueRangeParser.getPatternDescription(pattern) : '';
                    const currentValue = values.get(letter);

                    return (
                        <div key={letter} style={{ marginBottom: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <strong style={{ minWidth: '20px' }}>{letter}:</strong>
                                <input
                                    type="text"
                                    value={pattern}
                                    onChange={(e) => updatePattern(letter, e.target.value)}
                                    placeholder={currentValue ? `Valeur actuelle: ${currentValue.value}` : 'Pattern (ex: 10,20,25 ou *)'}
                                    style={{
                                        flex: 1,
                                        padding: '6px 8px',
                                        backgroundColor: 'var(--theia-input-background)',
                                        color: 'var(--theia-input-foreground)',
                                        border: `1px solid ${isValid ? 'var(--theia-input-border)' : 'var(--theia-errorText)'}`,
                                        borderRadius: '3px',
                                        fontSize: '12px',
                                        fontFamily: 'var(--theia-code-font-family)'
                                    }}
                                />
                            </div>
                            {pattern && (
                                <div style={{
                                    marginLeft: '28px',
                                    fontSize: '11px',
                                    color: isValid ? 'var(--theia-descriptionForeground)' : 'var(--theia-errorText)',
                                    marginTop: '2px'
                                }}>
                                    {description}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <div style={{
                padding: '12px',
                backgroundColor: tooManyCombinations 
                    ? 'var(--theia-inputValidation-errorBackground)' 
                    : 'var(--theia-input-background)',
                borderRadius: '4px',
                marginBottom: '12px'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className={`codicon ${tooManyCombinations ? 'codicon-warning' : 'codicon-info'}`} />
                    <span style={{ fontSize: '12px' }}>
                        <strong>{combinationCount.toLocaleString()}</strong> combinaison{combinationCount > 1 ? 's' : ''} 
                        {tooManyCombinations && (
                            <span style={{ color: 'var(--theia-errorText)', marginLeft: '8px' }}>
                                (Maximum : {maxCombinations})
                            </span>
                        )}
                    </span>
                </div>
            </div>

            <button
                onClick={generateCombinations}
                disabled={tooManyCombinations || combinationCount === 0}
                style={{
                    width: '100%',
                    padding: '10px',
                    backgroundColor: tooManyCombinations
                        ? 'var(--theia-button-background)'
                        : 'var(--theia-button-background)',
                    color: 'var(--theia-button-foreground)',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: tooManyCombinations ? 'not-allowed' : 'pointer',
                    fontSize: '13px',
                    fontWeight: 'bold',
                    opacity: tooManyCombinations ? 0.5 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px'
                }}
            >
                <span className="codicon codicon-run-all" />
                Calculer toutes les combinaisons
            </button>
                </>
            )}

            {/* Onglet Résultats */}
            {activeTab === 'results' && results.length > 0 && (
                <div style={{
                    maxHeight: '400px',
                    overflowY: 'auto',
                    fontSize: '12px'
                }}>
                    {results.map((result) => {
                        const hasCoordinates = Boolean(result.coordinates);
                        return (
                            <div key={result.id} style={{
                                padding: '8px',
                                marginBottom: '8px',
                                backgroundColor: 'var(--theia-input-background)',
                                borderRadius: '4px',
                                borderLeft: '3px solid var(--theia-successText)',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'flex-start',
                                gap: '12px'
                            }}>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                                        {result.label}
                                    </div>
                                    <div style={{ fontFamily: 'var(--theia-code-font-family)' }}>
                                        Valeurs: {Object.entries(result.values)
                                            .map(([letter, value]) => `${letter}=${value}`)
                                            .join(', ')}
                                    </div>
                                    <div style={{ fontFamily: 'var(--theia-code-font-family)', color: 'var(--theia-descriptionForeground)' }}>
                                        {result.coordinates?.ddm || '—'}
                                    </div>
                                </div>
                                <div style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '6px',
                                    alignItems: 'flex-end'
                                }}>
                                    <button
                                        className='theia-button'
                                        style={{
                                            padding: '6px 10px',
                                            fontSize: '11px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '4px'
                                        }}
                                        disabled={!hasCoordinates}
                                        title={hasCoordinates ? 'Ouvrir le formulaire de waypoint prérempli' : 'Aucune coordonnée pour ce résultat'}
                                        onClick={() => hasCoordinates && onCreateWaypoint(result.id, false)}
                                    >
                                        <span className='codicon codicon-add' />
                                        Créer waypoint
                                    </button>
                                    <button
                                        className='theia-button'
                                        style={{
                                            padding: '6px 10px',
                                            fontSize: '11px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '4px'
                                        }}
                                        disabled={!hasCoordinates}
                                        title={hasCoordinates ? 'Créer et valider immédiatement le waypoint' : 'Aucune coordonnée pour ce résultat'}
                                        onClick={() => hasCoordinates && onCreateWaypoint(result.id, true)}
                                    >
                                        <span className='codicon codicon-pass-filled' />
                                        Ajouter & valider
                                    </button>
                                    <button
                                        onClick={() => onRemoveResult(result.id)}
                                        title="Supprimer cette solution"
                                        style={{
                                            padding: '4px 8px',
                                            backgroundColor: 'transparent',
                                            color: 'var(--theia-errorForeground)',
                                            border: '1px solid var(--theia-errorForeground)',
                                            borderRadius: '3px',
                                            cursor: 'pointer',
                                            fontSize: '11px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '4px'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.backgroundColor = 'var(--theia-errorForeground)';
                                            e.currentTarget.style.color = 'var(--theia-editor-background)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.backgroundColor = 'transparent';
                                            e.currentTarget.style.color = 'var(--theia-errorForeground)';
                                        }}
                                    >
                                        <span className="codicon codicon-trash" />
                                        Supprimer
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                    <button
                        onClick={() => {
                            onClearAll();
                            setActiveTab('inputs');
                        }}
                        style={{
                            marginTop: '12px',
                            padding: '8px 16px',
                            backgroundColor: 'var(--theia-button-secondaryBackground)',
                            color: 'var(--theia-button-secondaryForeground)',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '12px',
                            width: '100%'
                        }}
                    >
                        <span className="codicon codicon-trash" style={{ marginRight: '4px' }} />
                        Effacer tous les résultats
                    </button>
                </div>
            )}
        </div>
    );
};
