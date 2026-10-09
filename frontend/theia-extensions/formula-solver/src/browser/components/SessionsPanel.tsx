import * as React from '@theia/core/shared/react';
import { FormulaSessionManager, SessionIndex } from '../formula-solver-session-manager';
import { EmptyState } from '../state-views';

interface SessionsPanelProps {
    sessions: SessionIndex[];
    onRestore: (geocacheId: number) => void;
    onDelete: (geocacheId: number) => void;
}

/**
 * Panneau listant toutes les sessions sauvegardées
 */
export const SessionsPanel: React.FC<SessionsPanelProps> = ({ sessions, onRestore, onDelete }) => {
    return (
        <div className="fs-panel" style={{
            marginBottom: '16px',
            padding: '12px 16px',
            borderRadius: '6px'
        }}>
            <h4 style={{ margin: '0 0 10px 0', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                <span className="codicon codicon-history" />
                Sessions sauvegardées
            </h4>
            {sessions.length === 0 ? (
                <EmptyState icon='codicon-save' title='Aucune session sauvegardée' />
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {sessions.map(session => (
                        <div key={session.geocacheId} style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '6px 10px',
                            backgroundColor: 'var(--theia-input-background)',
                            borderRadius: '4px',
                            fontSize: '12px',
                            gap: '12px'
                        }}>
                            <div>
                                <strong>{session.gcCode}</strong>
                                {session.geocacheName && (
                                    <span style={{ color: 'var(--theia-descriptionForeground)', marginLeft: '6px' }}>
                                        {session.geocacheName}
                                    </span>
                                )}
                                <div style={{ color: 'var(--theia-descriptionForeground)', fontSize: '11px', marginTop: '2px' }}>
                                    Sauvegardé le {FormulaSessionManager.formatDate(session.savedAt)}
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                                <button
                                    className="theia-button"
                                    onClick={() => onRestore(session.geocacheId)}
                                    style={{ fontSize: '11px', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '4px' }}
                                    title="Restaurer cette session"
                                >
                                    <span className="codicon codicon-history" />
                                    Restaurer
                                </button>
                                <button
                                    onClick={() => onDelete(session.geocacheId)}
                                    title="Supprimer cette session"
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
                                >
                                    <span className="codicon codicon-trash" />
                                    Supprimer
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
