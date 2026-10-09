import * as React from '@theia/core/shared/react';
import { describeDigits, DeductionResult } from '../utils/deduction';

interface DeductionPanelProps {
    deduction: DeductionResult;
    /** Renseigne les lettres déduites (un chiffre déduit est une valeur directe) */
    onApply: (pairs: Array<{ letter: string; value: string }>) => void;
    /** Liste les candidats et les place sur la carte */
    onShowCandidates: () => void;
}

/**
 * Chiffres possibles pour les lettres manquantes (voir `deduceMissingLetters`).
 */
export const DeductionPanel: React.FC<DeductionPanelProps> = ({ deduction, onApply, onShowCandidates }) => {
    const { letters, candidates, possibleByLetter, tested } = deduction;
    const certain = letters.filter(letter => possibleByLetter.get(letter)!.length === 1);
    const formatAssignment = (assignedLetters: string[], source: Record<string, number>): string =>
        assignedLetters.map(letter => `${letter}=${source[letter]}`).join(', ');
    const applyLetters = (assignedLetters: string[], source: Record<string, number>): void => {
        // Un chiffre déduit est une valeur directe, quel que soit le type de la lettre
        onApply(assignedLetters.map(letter => ({ letter, value: String(source[letter]) })));
    };

    return (
        <div className="fs-panel" style={{ padding: '12px', borderRadius: '4px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <span className="codicon codicon-lightbulb" />
                <strong style={{ fontSize: '13px' }}>
                    Déduction {letters.length > 1 ? 'des lettres manquantes' : 'de la lettre manquante'} ({letters.join(', ')})
                </strong>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--theia-descriptionForeground)', marginBottom: '8px' }}>
                Chiffres de 0 à 9 qui donnent une coordonnée valide à moins de 2 miles de l'origine.
            </div>

            {candidates.length === 0 ? (
                <div style={{ fontSize: '12px', color: 'var(--theia-editorWarning-foreground)', display: 'flex', gap: '6px' }}>
                    <span className="codicon codicon-warning" />
                    <span>
                        Aucun chiffre ne convient : une valeur déjà saisie est probablement fausse,
                        ou {letters.length > 1 ? 'une de ces lettres' : 'cette lettre'} vaut plus de 9.
                    </span>
                </div>
            ) : (
                <>
                    <div style={{ fontSize: '12px', fontFamily: 'var(--theia-code-font-family)', marginBottom: '8px' }}>
                        {letters.map(letter => (
                            <div key={letter}>
                                <strong>{letter}</strong> : {describeDigits(possibleByLetter.get(letter)!)}
                            </div>
                        ))}
                    </div>

                    {candidates.length === 1 ? (
                        <div style={{ fontSize: '12px', marginBottom: '8px' }}>
                            Une seule possibilité : <strong>{candidates[0].formatted}</strong>
                            {' '}(à {candidates[0].distanceKm.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} km de l'origine)
                        </div>
                    ) : (
                        <div style={{ fontSize: '12px', marginBottom: '8px' }}>
                            {candidates.length} combinaisons possibles sur {tested}.
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {candidates.length === 1 && (
                            <button
                                className="fs-btn fs-btn--primary"
                                onClick={() => applyLetters(letters, candidates[0].values)}
                                title="Renseigne ces valeurs dans les champs"
                            >
                                Appliquer {formatAssignment(letters, candidates[0].values)}
                            </button>
                        )}
                        {candidates.length > 1 && certain.length > 0 && (
                            <button
                                className="fs-btn fs-btn--primary"
                                onClick={() => applyLetters(certain, candidates[0].values)}
                                title="Seule valeur possible pour cette lettre, quelle que soit l'autre"
                            >
                                Appliquer {formatAssignment(certain, candidates[0].values)}
                            </button>
                        )}
                        {candidates.length > 1 && (
                            <button
                                className="fs-btn fs-btn--secondary"
                                onClick={() => onShowCandidates()}
                                title="Liste les candidats et les place sur la carte"
                            >
                                Afficher les {candidates.length} candidats
                            </button>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};
