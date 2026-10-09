import * as React from '@theia/core/shared/react';

interface BulkValuesPanelProps {
    text: string;
    onTextChange: (text: string) => void;
    onApply: () => void;
}

/**
 * Saisie groupée des valeurs ("A=3, B=7") : voir `parseBulkValues`.
 */
export const BulkValuesPanel: React.FC<BulkValuesPanelProps> = ({ text, onTextChange, onApply }) => {
    return (
        <div style={{
            padding: '10px',
            backgroundColor: 'var(--theia-input-background)',
            border: '1px solid var(--theia-panel-border)',
            borderRadius: '4px',
            marginBottom: '12px'
        }}>
            <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '6px' }}>
                Saisie groupée des valeurs
            </div>
            <textarea
                autoFocus
                value={text}
                onChange={e => onTextChange(e.target.value)}
                onKeyDown={e => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        onApply();
                    }
                }}
                placeholder={'A=3, B=7, C=12\nou une lettre par ligne :\nD = Tour Eiffel'}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px' }}>
                <button
                    className="fs-btn fs-btn--primary"
                    onClick={() => onApply()}
                    disabled={!text.trim()}
                    title="Remplace la valeur des lettres citées (Ctrl+Entrée)"
                >
                    Appliquer
                </button>
                <span style={{ fontSize: '11px', color: 'var(--theia-descriptionForeground)' }}>
                    Remplace la valeur des lettres citées ; le type de calcul de chaque lettre est conservé.
                </span>
            </div>
        </div>
    );
};
