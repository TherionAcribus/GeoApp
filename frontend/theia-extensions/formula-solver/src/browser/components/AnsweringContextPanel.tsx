import * as React from '@theia/core/shared/react';

interface AnsweringContextPanelProps {
    open: boolean;
    onToggleOpen: () => void;
    loading: boolean;
    /** Construit le contexte IA, ou le relit du cache ; `force` ignore le cache */
    onRefresh: (force: boolean) => void;
    useOverride: boolean;
    onUseOverrideChange: (useOverride: boolean) => void;
    json: string;
    jsonError?: string;
    onJsonChange: (json: string) => void;
    additionalInstructions: string;
    onAdditionalInstructionsChange: (instructions: string) => void;
}

/**
 * Contexte préparé pour les réponses IA (résumé + règles de format), consultable
 * et modifiable, et consignes supplémentaires ajoutées à chaque question.
 */
export const AnsweringContextPanel: React.FC<AnsweringContextPanelProps> = ({
    open, onToggleOpen, loading, onRefresh, useOverride, onUseOverrideChange,
    json, jsonError, onJsonChange, additionalInstructions, onAdditionalInstructionsChange
}) => {
    return (
        <div className="fs-panel" style={{
            padding: '10px',
            borderRadius: '4px',
            marginBottom: '12px'
        }}>
            <button
                style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: 0,
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--theia-foreground)',
                    cursor: 'pointer',
                    fontWeight: 'bold'
                }}
                onClick={() => onToggleOpen()}
                title={open ? 'Replier' : 'Déplier'}
            >
                <span>IA : Contexte & consignes de réponse</span>
                <span className={`codicon ${open ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} />
            </button>

            {open && (
                <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <button
                            className="fs-btn fs-btn--primary"
                            disabled={loading}
                            onClick={() => onRefresh(false)}
                            title="Construit (ou relit du cache) le contexte IA"
                        >
                            Charger / rafraîchir
                        </button>
                        <button
                            className="fs-btn fs-btn--secondary"
                            disabled={loading}
                            onClick={() => onRefresh(true)}
                            title="Force le recalcul du contexte IA (ignore le cache)"
                        >
                            Forcer recalcul
                        </button>

                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                            <input
                                type="checkbox"
                                checked={useOverride}
                                onChange={e => onUseOverrideChange(e.target.checked)}
                            />
                            Utiliser mon contexte (override)
                        </label>
                    </div>

                    <div>
                        <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '6px' }}>
                            Contexte IA (JSON) – modifiable
                        </div>
                        <textarea
                            value={json}
                            onChange={e => onJsonChange(e.target.value)}
                            placeholder='{"geocache_summary":"","global_rules":[],"per_letter_rules":{}}'
                            style={{
                                width: '100%',
                                minHeight: '160px',
                                padding: '8px 10px',
                                fontFamily: 'var(--theia-code-font-family)',
                                backgroundColor: 'var(--theia-input-background)',
                                color: 'var(--theia-input-foreground)',
                                border: `1px solid ${jsonError ? 'var(--theia-errorForeground)' : 'var(--theia-input-border)'}`,
                                borderRadius: '4px'
                            }}
                        />
                        {jsonError && (
                            <div style={{ marginTop: '6px', color: 'var(--theia-errorForeground)', fontSize: '12px' }}>
                                ⚠️ {jsonError}
                            </div>
                        )}
                    </div>

                    <div>
                        <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '6px' }}>
                            Instructions supplémentaires (ajoutées à chaque question)
                        </div>
                        <textarea
                            value={additionalInstructions}
                            onChange={e => onAdditionalInstructionsChange(e.target.value)}
                            placeholder="Ex: Respecte la casse exacte, conserve les accents, ne mets pas d'article, etc."
                            style={{
                                width: '100%',
                                minHeight: '70px',
                                padding: '8px 10px',
                                fontFamily: 'var(--theia-code-font-family)',
                                backgroundColor: 'var(--theia-input-background)',
                                color: 'var(--theia-input-foreground)',
                                border: '1px solid var(--theia-input-border)',
                                borderRadius: '4px'
                            }}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};
