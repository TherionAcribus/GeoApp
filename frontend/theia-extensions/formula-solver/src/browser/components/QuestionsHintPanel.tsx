import * as React from '@theia/core/shared/react';

interface QuestionsHintPanelProps {
    value: string;
    onChange: (value: string) => void;
}

/**
 * Indice libre transmis à l'IA lors de l'extraction des questions.
 */
export const QuestionsHintPanel: React.FC<QuestionsHintPanelProps> = ({ value, onChange }) => {
    return (
        <div style={{
            padding: '10px',
            backgroundColor: 'var(--theia-input-background)',
            border: '1px solid var(--theia-panel-border)',
            borderRadius: '4px',
            marginBottom: '12px'
        }}>
            <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '6px' }}>
                Indice (optionnel) pour l’IA lors de l’extraction des questions
            </div>
            <textarea
                value={value}
                onChange={e => onChange(e.target.value)}
                placeholder="Ex: Le listing est sous la forme 'A = ...' / 'B = ...'. Ne renvoie pas des numéros, renvoie la consigne textuelle."
                style={{
                    width: '100%',
                    minHeight: '70px',
                    padding: '8px 10px',
                    fontFamily: 'var(--theia-code-font-family)',
                    backgroundColor: 'var(--theia-editor-background)',
                    color: 'var(--theia-foreground)',
                    border: '1px solid var(--theia-input-border)',
                    borderRadius: '4px'
                }}
            />
        </div>
    );
};
