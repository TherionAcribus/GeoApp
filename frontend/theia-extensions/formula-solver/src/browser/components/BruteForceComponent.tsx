/**
 * Composant pour le mode brute force
 * Permet de tester plusieurs valeurs pour une ou plusieurs lettres
 */

import * as React from '@theia/core/shared/react';
import { ValueRangeParser, CombinationGenerator } from '../../common/value-range-parser';
import { LetterValue } from '../../common/types';

interface BruteForceComponentProps {
    letters: string[];
    values: Map<string, LetterValue>;
    onBruteForceExecute: (combinations: Array<Record<string, number>>) => void;
}

export const BruteForceComponent: React.FC<BruteForceComponentProps> = ({ 
    letters, 
    values,
    onBruteForceExecute 
}) => {
    const [patterns, setPatterns] = React.useState<Map<string, string>>(new Map());
    const [showHelp, setShowHelp] = React.useState(false);

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
                <button
                    onClick={() => setShowHelp(!showHelp)}
                    style={{
                        marginLeft: 'auto',
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
                    </ul>
                    <div style={{ marginTop: '8px', color: 'var(--theia-descriptionForeground)' }}>
                        💡 Laissez vide pour utiliser la valeur saisie normalement
                    </div>
                </div>
            )}

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
                                    placeholder={currentValue ? `Valeur actuelle: ${currentValue.value}` : 'Pattern (ex: *)'}
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
        </div>
    );
};
