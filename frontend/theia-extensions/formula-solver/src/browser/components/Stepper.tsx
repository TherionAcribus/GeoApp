import * as React from '@theia/core/shared/react';

interface StepperProps {
    currentStep: 'detect' | 'questions' | 'values' | 'calculate';
    questionsCount: number;
    bruteForceResultsCount: number;
}

/**
 * Fil d'Ariane visuel : 3 étapes (Détecter / Questions / Calculer) avec statut
 * (pending/current/done) dérivé des mêmes conditions que celles qui affichent
 * réellement chaque section dans le widget, pour ne jamais afficher une étape
 * "faite" ou "accessible" qui ne le serait pas dans le rendu en dessous.
 * Cliquer sur une étape accessible fait défiler jusqu'à sa section (les 3
 * sections restent visibles simultanément : ce n'est pas un wizard).
 */
export const Stepper: React.FC<StepperProps> = ({ currentStep, questionsCount, bruteForceResultsCount }) => {
    type StepStatus = 'pending' | 'current' | 'done';

    // Mêmes conditions que les guards de render() pour detectionStep/questionsStep/calculateStep.
    const reachableQuestions = currentStep !== 'detect';
    const reachableCalculate = questionsCount > 0;
    // Le mode brute force ne fait jamais passer currentStep à 'calculate' (voir
    // executeBruteForceFromCombinations) : on le traite aussi comme un succès.
    const hasSuccessfulResult = currentStep === 'calculate' || bruteForceResultsCount > 0;

    const detectStatus: StepStatus = currentStep === 'detect' ? 'current' : 'done';
    const questionsStatus: StepStatus = !reachableQuestions ? 'pending' : (hasSuccessfulResult ? 'done' : 'current');
    const calculateStatus: StepStatus = !reachableCalculate ? 'pending' : (hasSuccessfulResult ? 'done' : 'current');

    const steps: Array<{ label: string; status: StepStatus; reachable: boolean; anchorId: string }> = [
        { label: 'Détecter', status: detectStatus, reachable: true, anchorId: 'formula-solver-step-detect' },
        { label: 'Questions', status: questionsStatus, reachable: reachableQuestions, anchorId: 'formula-solver-step-questions' },
        { label: 'Calculer', status: calculateStatus, reachable: reachableCalculate, anchorId: 'formula-solver-step-calculate' }
    ];

    const scrollToStep = (anchorId: string): void => {
        if (typeof document === 'undefined') {
            return;
        }
        document.getElementById(anchorId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const colorsFor = (status: StepStatus, reachable: boolean): { circleBg: string; circleColor: string; circleBorder: string; labelColor: string } => {
        if (!reachable) {
            return {
                circleBg: 'transparent',
                circleColor: 'var(--theia-descriptionForeground)',
                circleBorder: 'var(--theia-panel-border)',
                labelColor: 'var(--theia-descriptionForeground)'
            };
        }
        if (status === 'done') {
            return {
                circleBg: 'var(--theia-successText)',
                circleColor: 'var(--theia-editor-background)',
                circleBorder: 'var(--theia-successText)',
                labelColor: 'var(--theia-foreground)'
            };
        }
        if (status === 'current') {
            return {
                circleBg: 'var(--theia-focusBorder)',
                circleColor: 'var(--theia-editor-background)',
                circleBorder: 'var(--theia-focusBorder)',
                labelColor: 'var(--theia-foreground)'
            };
        }
        return {
            circleBg: 'transparent',
            circleColor: 'var(--theia-descriptionForeground)',
            circleBorder: 'var(--theia-panel-border)',
            labelColor: 'var(--theia-descriptionForeground)'
        };
    };

    return (
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
            {steps.map((step, idx) => {
                const colors = colorsFor(step.status, step.reachable);
                const isLast = idx === steps.length - 1;
                const nextStepConnected = !isLast && steps[idx + 1].status !== 'pending';

                return (
                    <React.Fragment key={step.anchorId}>
                        <button
                            onClick={() => step.reachable && scrollToStep(step.anchorId)}
                            disabled={!step.reachable}
                            title={step.reachable ? `Aller à l'étape « ${step.label} »` : `Étape « ${step.label} » pas encore accessible`}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                background: 'transparent',
                                border: 'none',
                                padding: '4px 6px',
                                cursor: step.reachable ? 'pointer' : 'default',
                                borderRadius: '4px'
                            }}
                        >
                            <span style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '22px',
                                height: '22px',
                                borderRadius: '50%',
                                border: `2px solid ${colors.circleBorder}`,
                                backgroundColor: colors.circleBg,
                                color: colors.circleColor,
                                fontSize: '12px',
                                fontWeight: 'bold',
                                flexShrink: 0
                            }}>
                                {step.status === 'done'
                                    ? <span className="codicon codicon-check" style={{ fontSize: '12px' }} />
                                    : idx + 1}
                            </span>
                            <span style={{
                                fontSize: '12px',
                                fontWeight: step.status === 'current' ? 'bold' : 'normal',
                                color: colors.labelColor
                            }}>
                                {step.label}
                            </span>
                        </button>
                        {!isLast && (
                            <div style={{
                                flex: 1,
                                height: '2px',
                                backgroundColor: nextStepConnected ? 'var(--theia-successText)' : 'var(--theia-panel-border)',
                                margin: '0 6px',
                                minWidth: '16px'
                            }} />
                        )}
                    </React.Fragment>
                );
            })}
        </div>
    );
};
