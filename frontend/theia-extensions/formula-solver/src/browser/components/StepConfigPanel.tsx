import * as React from '@theia/core/shared/react';
import { AnswersEngine } from '../formula-solver-pipeline';
import { AnswersMode, FormulaDetectionMethod, FormulaSolverStepConfig, QuestionsMethod } from '../formula-solver-config';
import { FormulaSolverAiProfile } from '../geoapp-formula-solver-agents';

interface StepConfigPanelProps {
    open: boolean;
    onToggleOpen: (open: boolean) => void;
    stepConfig: FormulaSolverStepConfig;
    onStepConfigChange: (partial: Partial<FormulaSolverStepConfig>) => void;
    answersEngine: AnswersEngine;
    onAnswersEngineChange: (engine: AnswersEngine) => void;
    webSearchEnabled: boolean;
    onWebSearchEnabledChange: (enabled: boolean) => void;
    webMaxResults: number;
    onWebMaxResultsChange: (maxResults: number) => void;
}

/**
 * Panneau de configuration des étapes (méthodes + profils IA), replié par défaut
 */
export const StepConfigPanel: React.FC<StepConfigPanelProps> = ({
    open, onToggleOpen, stepConfig, onStepConfigChange, answersEngine, onAnswersEngineChange,
    webSearchEnabled, onWebSearchEnabledChange, webMaxResults, onWebMaxResultsChange
}) => {
    const profileOptions: Array<{ id: FormulaSolverAiProfile; label: string }> = [
        { id: 'local', label: 'Local (vérifié)' },
        { id: 'fast', label: 'Fast' },
        { id: 'strong', label: 'Strong' },
        { id: 'web', label: 'Web' }
    ];

    const selectStyle: React.CSSProperties = {
        padding: '6px 8px',
        border: '1px solid var(--theia-dropdown-border)',
        borderRadius: '3px',
        backgroundColor: 'var(--theia-dropdown-background)',
        color: 'var(--theia-dropdown-foreground)',
        fontSize: '12px'
    };

    if (!open) {
        return (
            <button
                className="fs-btn fs-btn--icon fs-btn--secondary"
                onClick={() => onToggleOpen(true)}
                title="Afficher les options (méthodes / profils IA). Ces réglages sont sauvegardés automatiquement comme valeurs par défaut."
            >
                <span className="codicon codicon-settings-gear" />
                Options IA
            </button>
        );
    }

    return (
        <div style={{
            display: 'flex',
            alignItems: 'stretch',
            gap: '10px',
            flexWrap: 'wrap'
        }}>
            <button
                className="fs-btn fs-btn--icon fs-btn--outline"
                onClick={() => onToggleOpen(false)}
                title="Replier les options"
            >
                <span className="codicon codicon-chevron-up" />
                Replier
            </button>

            <div className="fs-panel" style={{
                display: 'flex',
                gap: '10px',
                padding: '10px',
                borderRadius: '6px',
                alignItems: 'center',
                flexWrap: 'wrap'
            }}>
                <strong style={{ fontSize: '12px' }}>Formule</strong>
                <select
                    style={selectStyle}
                    value={stepConfig.formulaDetectionMethod}
                    onChange={e => onStepConfigChange({ formulaDetectionMethod: e.target.value as FormulaDetectionMethod })}
                    title="Méthode de l'étape Formule"
                >
                    <option value="algorithm">Algorithme</option>
                    <option value="ai">IA</option>
                    <option value="manual">Manuel</option>
                </select>
                <select
                    style={selectStyle}
                    value={stepConfig.aiProfileForFormula}
                    onChange={e => onStepConfigChange({ aiProfileForFormula: e.target.value as FormulaSolverAiProfile })}
                    disabled={stepConfig.formulaDetectionMethod !== 'ai'}
                    title="Profil IA pour l'étape Formule"
                >
                    {profileOptions.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
            </div>

            <div className="fs-panel" style={{
                display: 'flex',
                gap: '10px',
                padding: '10px',
                borderRadius: '6px',
                alignItems: 'center',
                flexWrap: 'wrap'
            }}>
                <strong style={{ fontSize: '12px' }}>Questions</strong>
                <select
                    style={selectStyle}
                    value={stepConfig.questionsMethod}
                    onChange={e => onStepConfigChange({ questionsMethod: e.target.value as QuestionsMethod })}
                    title="Méthode de l'étape Questions"
                >
                    <option value="algorithm">Algorithme</option>
                    <option value="ai">IA</option>
                    <option value="none">Aucune</option>
                </select>
                <select
                    style={selectStyle}
                    value={stepConfig.aiProfileForQuestions}
                    onChange={e => onStepConfigChange({ aiProfileForQuestions: e.target.value as FormulaSolverAiProfile })}
                    disabled={stepConfig.questionsMethod !== 'ai'}
                    title="Profil IA pour l'étape Questions"
                >
                    {profileOptions.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
            </div>

            <div className="fs-panel" style={{
                display: 'flex',
                gap: '10px',
                padding: '10px',
                borderRadius: '6px',
                alignItems: 'center',
                flexWrap: 'wrap'
            }}>
                <strong style={{ fontSize: '12px' }}>Réponses</strong>
                <select
                    style={selectStyle}
                    value={stepConfig.answersMode}
                    onChange={e => onStepConfigChange({ answersMode: e.target.value as AnswersMode })}
                    title="Mode de l'étape Réponses"
                >
                    <option value="manual">Manuel</option>
                    <option value="ai-bulk">IA (en masse)</option>
                    <option value="ai-per-question">IA (par question)</option>
                </select>
                <select
                    style={selectStyle}
                    value={answersEngine}
                    // Volontairement non persisté par le widget : ce choix dépend souvent de la
                    // géocache en cours, pas d'une préférence globale par défaut.
                    onChange={e => onAnswersEngineChange(e.target.value as AnswersEngine)}
                    disabled={stepConfig.answersMode === 'manual'}
                    title="Moteur de réponse (IA ou recherche web backend) — choix pour la session en cours, non mémorisé"
                >
                    <option value="ai">IA</option>
                    <option value="backend-web-search">Recherche web (backend)</option>
                </select>
                <select
                    style={selectStyle}
                    value={stepConfig.aiProfileForAnswers}
                    onChange={e => onStepConfigChange({ aiProfileForAnswers: e.target.value as FormulaSolverAiProfile })}
                    disabled={stepConfig.answersMode === 'manual' || answersEngine !== 'ai'}
                    title="Profil IA pour l'étape Réponses"
                >
                    {profileOptions.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>

                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                    <input
                        type="checkbox"
                        checked={webSearchEnabled}
                        onChange={e => onWebSearchEnabledChange(e.target.checked)}
                    />
                    Web
                </label>
                <input
                    type="number"
                    min={1}
                    max={10}
                    value={webMaxResults}
                    onChange={e => {
                        const parsed = parseInt(e.target.value, 10);
                        onWebMaxResultsChange(isNaN(parsed) ? 5 : Math.max(1, Math.min(10, parsed)));
                    }}
                    style={{ ...selectStyle, width: '70px' }}
                    title="Nombre max de résultats web"
                    disabled={!webSearchEnabled}
                />
            </div>
        </div>
    );
};
