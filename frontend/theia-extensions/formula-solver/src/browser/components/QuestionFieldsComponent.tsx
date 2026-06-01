/**
 * Composant React pour afficher une question/variable du Formula Solver.
 * Contient : lettre, question éditable, profil IA, boutons IA/Internet, détails, valeur.
 */

import * as React from '@theia/core/shared/react';
import { Question, LetterValue } from '../../common/types';
import { FormulaSolverAiProfile } from '../geoapp-formula-solver-agents';
import { AnswerDetail } from '../strategies/types';

export interface QuestionFieldProps {
    question: Question;
    value?: LetterValue;
    hasValue: boolean;
    isSuspect: boolean;
    isLetterLoading: boolean;
    perQuestionProfile: FormulaSolverAiProfile;
    detail?: AnswerDetail;
    isDetailExpanded: boolean;
    showAdvancedAnswerFields: boolean;
    perLetterExtraInfo: string;
    loading: boolean;

    onProfileChange: (letter: string, profile: FormulaSolverAiProfile) => void;
    onAnswerIA: (letter: string) => void;
    onAnswerInternet: (letter: string) => void;
    onToggleDetail: (letter: string) => void;
    onValueChange: (letter: string, rawValue: string, type: string) => void;
    onQuestionChange: (letter: string, newQuestion: string) => void;
    onExtraInfoChange: (letter: string, value: string) => void;
}

/** Construit une URL Google Search en retirant les instructions de calcul de la question. */
const buildGoogleSearchUrl = (questionText: string): string => {
    const q = questionText
        .replace(/[?!]?\s*(?:nombre\s+de\s+lettres?|checksum\s*r[e\u00e9]duit|checksum|valeur\s+d[eu]\s+\S+\s+lettre?|de\s+ce\s+(?:nom|groupe|mot|r[e\u00e9]sultat)|son\s+pr[e\u00e9]nom(?:\s+et\s+\w+)?|son\s+nom|le\s+jour|le\s+mois|l.ann[e\u00e9]e|en\s+km|en\s+m[e\u00e8]tres?)\s*\.?$/gi, '')
        .replace(/[!?;.,\s]+$/, '')
        .replace(/\s+/g, ' ')
        .trim();
    return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
};

export const QuestionFieldCard: React.FC<QuestionFieldProps> = (props) => {
    const {
        question, value, hasValue, isSuspect, isLetterLoading,
        perQuestionProfile, detail, isDetailExpanded,
        showAdvancedAnswerFields, perLetterExtraInfo, loading,
        onProfileChange, onAnswerIA, onAnswerInternet, onToggleDetail,
        onValueChange, onQuestionChange, onExtraInfoChange
    } = props;

    return (
        <div style={{
            padding: '12px',
            backgroundColor: isSuspect
                ? 'var(--theia-inputValidation-errorBackground)'
                : (hasValue ? 'var(--theia-list-hoverBackground)' : 'var(--theia-input-background)'),
            border: isSuspect
                ? '1px solid var(--theia-errorText)'
                : (hasValue ? '1px solid var(--theia-focusBorder)' : '1px solid var(--theia-input-border)'),
            borderRadius: '4px'
        }} title={isSuspect ? 'Valeur suspecte (incohérence détectée par la preview)' : undefined}>
            {/* Header: lettre + question + boutons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <div style={{
                    width: '30px',
                    height: '30px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: isSuspect
                        ? 'var(--theia-errorText)'
                        : (hasValue ? 'var(--theia-button-background)' : 'var(--theia-input-background)'),
                    color: isSuspect
                        ? 'var(--theia-button-foreground)'
                        : (hasValue ? 'var(--theia-button-foreground)' : 'var(--theia-foreground)'),
                    borderRadius: '4px',
                    fontWeight: 'bold',
                    fontSize: '16px'
                }}>
                    {question.letter}
                </div>
                <div style={{ flex: 1 }}>
                    <input
                        type="text"
                        defaultValue={question.question || ''}
                        key={`q-${question.letter}`}
                        onChange={e => onQuestionChange(question.letter, e.target.value)}
                        placeholder="Question inconnue"
                        title="Modifier la question (pour affiner la recherche Internet ou IA). Ctrl+Z pour annuler."
                        style={{
                            width: '100%',
                            padding: '4px 6px',
                            fontSize: '13px',
                            fontWeight: 'bold',
                            border: '1px solid transparent',
                            borderRadius: '3px',
                            backgroundColor: 'transparent',
                            color: 'var(--theia-foreground)',
                            outline: 'none',
                            transition: 'border-color 0.2s, background-color 0.2s'
                        }}
                        onFocus={e => {
                            e.currentTarget.style.borderColor = 'var(--theia-focusBorder)';
                            e.currentTarget.style.backgroundColor = 'var(--theia-input-background)';
                        }}
                        onBlur={e => {
                            e.currentTarget.style.borderColor = 'transparent';
                            e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                    />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <select
                        value={perQuestionProfile}
                        onChange={e => onProfileChange(question.letter, e.target.value as FormulaSolverAiProfile)}
                        disabled={isLetterLoading}
                        title="Profil IA pour cette question (Local/Fast/Strong/Web)"
                        style={{
                            padding: '6px 8px',
                            border: '1px solid var(--theia-dropdown-border)',
                            borderRadius: '3px',
                            backgroundColor: 'var(--theia-dropdown-background)',
                            color: 'var(--theia-dropdown-foreground)',
                            fontSize: '12px'
                        }}
                    >
                        <option value="local">Local</option>
                        <option value="fast">Fast</option>
                        <option value="strong">Strong</option>
                        <option value="web">Web</option>
                    </select>
                    {isLetterLoading ? (
                        <span
                            className="formula-solver-spinner"
                            title="Recherche en cours..."
                        />
                    ) : (
                        <>
                            <button
                                style={{
                                    padding: '6px 10px',
                                    backgroundColor: 'var(--theia-button-background)',
                                    color: 'var(--theia-button-foreground)',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '12px'
                                }}
                                onClick={() => onAnswerIA(question.letter)}
                                disabled={loading}
                                title="Résout cette question via IA"
                            >
                                IA
                            </button>
                            <button
                                style={{
                                    padding: '6px 10px',
                                    backgroundColor: 'var(--theia-button-secondaryBackground)',
                                    color: 'var(--theia-button-secondaryForeground)',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '12px'
                                }}
                                onClick={() => onAnswerInternet(question.letter)}
                                disabled={loading}
                                title="Recherche la réponse sur Internet (automatique)"
                            >
                                Internet
                            </button>
                            <button
                                style={{
                                    padding: '6px 8px',
                                    backgroundColor: 'transparent',
                                    color: 'var(--theia-descriptionForeground)',
                                    border: '1px solid var(--theia-panel-border)',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '12px'
                                }}
                                onClick={() => window.open(buildGoogleSearchUrl(question.question), '_blank')}
                                title="Ouvrir dans Google (navigateur externe)"
                            >
                                <span className="codicon codicon-link-external" />
                            </button>
                        </>
                    )}
                    {detail && !isLetterLoading && (
                        <button
                            style={{
                                padding: '4px 8px',
                                backgroundColor: 'transparent',
                                color: 'var(--theia-descriptionForeground)',
                                border: '1px solid var(--theia-panel-border)',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '11px'
                            }}
                            onClick={() => onToggleDetail(question.letter)}
                            title={isDetailExpanded ? 'Masquer les détails' : 'Voir les détails de la réponse'}
                        >
                            <span className={`codicon ${isDetailExpanded ? 'codicon-chevron-up' : 'codicon-info'}`} />
                        </button>
                    )}
                </div>
            </div>

            {/* Expandable answer detail bubble */}
            {detail && isDetailExpanded && (
                <div style={{
                    marginBottom: '8px',
                    padding: '8px 10px',
                    backgroundColor: 'var(--theia-editor-background)',
                    border: '1px solid var(--theia-panel-border)',
                    borderRadius: '4px',
                    fontSize: '12px',
                    lineHeight: '1.5'
                }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{
                            padding: '2px 6px',
                            borderRadius: '3px',
                            fontSize: '11px',
                            fontWeight: 'bold',
                            backgroundColor: detail.source === 'ai' ? 'var(--theia-button-background)' : 'var(--theia-button-secondaryBackground)',
                            color: detail.source === 'ai' ? 'var(--theia-button-foreground)' : 'var(--theia-button-secondaryForeground)'
                        }}>
                            {detail.source === 'ai' ? `IA (${detail.profile || '?'})` : 'Internet'}
                        </span>
                        {detail.valueType && detail.valueType !== 'value' && (
                            <span style={{
                                padding: '2px 6px',
                                borderRadius: '3px',
                                fontSize: '11px',
                                backgroundColor: 'var(--theia-editor-background)',
                                border: '1px solid var(--theia-panel-border)'
                            }}>
                                {detail.valueType === 'checksum' ? 'Checksum' :
                                 detail.valueType === 'reduced' ? 'Checksum réduit' :
                                 detail.valueType === 'length' ? 'Longueur' : detail.valueType}
                            </span>
                        )}
                        <span style={{ color: 'var(--theia-descriptionForeground)' }}>
                            {new Date(detail.timestampMs).toLocaleTimeString()}
                        </span>
                    </div>
                    {detail.explanation && (
                        <div style={{ color: 'var(--theia-foreground)', whiteSpace: 'pre-wrap', marginBottom: '4px' }}>
                            {detail.explanation}
                        </div>
                    )}
                    {detail.webResults && detail.webResults.length > 0 && (
                        <div style={{ marginTop: '4px' }}>
                            <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Sources web :</div>
                            {detail.webResults.map((wr: any, idx: number) => (
                                <div key={idx} style={{
                                    padding: '4px 6px',
                                    marginBottom: '3px',
                                    backgroundColor: 'var(--theia-input-background)',
                                    borderRadius: '3px'
                                }}>
                                    {wr.text && <div>{wr.text}</div>}
                                    {wr.source && (
                                        <div style={{ fontSize: '11px', wordBreak: 'break-all' }}>
                                            <a
                                                href={wr.source}
                                                style={{
                                                    color: 'var(--theia-textLink-foreground)',
                                                    textDecoration: 'underline',
                                                    cursor: 'pointer'
                                                }}
                                                title={wr.source}
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    window.open(wr.source, '_blank');
                                                }}
                                            >
                                                {wr.source!.length > 60 ? wr.source!.substring(0, 60) + '…' : wr.source}
                                            </a>
                                        </div>
                                    )}
                                    {wr.score !== undefined && (
                                        <div style={{ fontSize: '10px', color: 'var(--theia-descriptionForeground)' }}>
                                            Score: {(wr.score * 100).toFixed(0)}%
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Champ info complémentaire IA */}
            {showAdvancedAnswerFields && (
                <div style={{ marginBottom: '8px' }}>
                    <textarea
                        value={perLetterExtraInfo}
                        onChange={e => onExtraInfoChange(question.letter, e.target.value)}
                        placeholder="Info complémentaire (optionnel) pour aider l'IA à répondre à cette lettre (ex: consignes, détails, observation sur place...)"
                        style={{
                            width: '100%',
                            minHeight: '44px',
                            padding: '6px 8px',
                            fontFamily: 'var(--theia-code-font-family)',
                            fontSize: '12px',
                            backgroundColor: 'var(--theia-input-background)',
                            color: 'var(--theia-input-foreground)',
                            border: '1px solid var(--theia-input-border)',
                            borderRadius: '4px'
                        }}
                    />
                </div>
            )}

            {/* Valeur + type */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input
                    type="text"
                    placeholder="Valeur"
                    value={value?.rawValue || ''}
                    onChange={e => onValueChange(question.letter, e.target.value, value?.type || 'value')}
                    style={{
                        flex: 1,
                        padding: '6px 10px',
                        border: '1px solid var(--theia-input-border)',
                        borderRadius: '3px',
                        backgroundColor: 'var(--theia-input-background)',
                        color: 'var(--theia-input-foreground)'
                    }}
                />

                <select
                    value={value?.type || 'value'}
                    onChange={e => onValueChange(question.letter, value?.rawValue || '', e.target.value)}
                    style={{
                        padding: '6px 8px',
                        border: '1px solid var(--theia-dropdown-border)',
                        borderRadius: '3px',
                        backgroundColor: 'var(--theia-dropdown-background)',
                        color: 'var(--theia-dropdown-foreground)'
                    }}
                >
                    <option value="value">Valeur</option>
                    <option value="checksum">Checksum</option>
                    <option value="reduced">Checksum réduit</option>
                    <option value="length">Longueur</option>
                </select>

                <div style={{ minWidth: '60px', textAlign: 'right', fontWeight: 'bold' }}>
                    = {value?.value || '-'}
                </div>
            </div>
        </div>
    );
};
