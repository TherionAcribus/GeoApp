/**
 * Composant pour afficher les résultats de calcul
 */

import * as React from '@theia/core/shared/react';
import { CalculationResult } from '../../common/types';

export interface ResultDisplayComponentProps {
    result: CalculationResult;
    onCopy?: (text: string) => void;
    onCreateWaypoint?: () => void;
    onAutoSaveWaypoint?: () => void;
    onProjectOnMap?: () => void;
}

export const ResultDisplayComponent: React.FC<ResultDisplayComponentProps> = ({
    result,
    onCopy,
    onCreateWaypoint,
    onAutoSaveWaypoint,
    onProjectOnMap
}) => {
    if (!result || result.status !== 'success' || !result.coordinates) {
        return null;
    }

    const coords = result.coordinates;
    const [copied, setCopied] = React.useState<string | null>(null);

    const handleCopy = (text: string, label: string) => {
        if (onCopy) {
            onCopy(text);
            setCopied(label);
            setTimeout(() => setCopied(null), 2000);
        } else {
            // Fallback vers clipboard API
            navigator.clipboard.writeText(text).then(() => {
                setCopied(label);
                setTimeout(() => setCopied(null), 2000);
            });
        }
    };

    return (
        <div className='result-display-component' style={{ marginTop: '20px' }}>
            {/* En-tête avec succès */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '15px',
                padding: '10px',
                backgroundColor: 'var(--theia-testing-iconPassed)',
                color: 'white',
                borderRadius: '4px',
                fontWeight: 'bold'
            }}>
                <span className='codicon codicon-check'></span>
                Coordonnées calculées avec succès !
            </div>

            {/* Carte des coordonnées */}
            <div style={{
                padding: '20px',
                backgroundColor: 'var(--theia-editor-background)',
                border: '2px solid var(--theia-focusBorder)',
                borderRadius: '6px',
                marginBottom: '15px'
            }}>
                {/* DDM (principal) */}
                <div style={{ marginBottom: '20px' }}>
                    <div style={{
                        fontSize: '12px',
                        color: 'var(--theia-descriptionForeground)',
                        marginBottom: '6px',
                        fontWeight: 'bold',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                    }}>
                        Degrees Decimal Minutes (DDM)
                    </div>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '10px'
                    }}>
                        <div style={{
                            fontSize: '20px',
                            fontWeight: 'bold',
                            fontFamily: 'var(--theia-code-font-family)',
                            color: 'var(--theia-textLink-activeForeground)',
                            flex: 1
                        }}>
                            {coords.ddm}
                        </div>
                        <button
                            style={{
                                padding: '6px 12px',
                                backgroundColor: copied === 'DDM' 
                                    ? 'var(--theia-testing-iconPassed)' 
                                    : 'var(--theia-button-background)',
                                color: 'var(--theia-button-foreground)',
                                border: 'none',
                                borderRadius: '3px',
                                cursor: 'pointer',
                                fontSize: '12px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                transition: 'background-color 0.2s'
                            }}
                            onClick={() => handleCopy(coords.ddm, 'DDM')}
                        >
                            <span className={copied === 'DDM' ? 'codicon codicon-check' : 'codicon codicon-copy'}></span>
                            {copied === 'DDM' ? 'Copié' : 'Copier'}
                        </button>
                    </div>
                </div>

                {/* DMS */}
                <div style={{ marginBottom: '20px' }}>
                    <div style={{
                        fontSize: '12px',
                        color: 'var(--theia-descriptionForeground)',
                        marginBottom: '6px',
                        fontWeight: 'bold',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                    }}>
                        Degrees Minutes Seconds (DMS)
                    </div>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '10px'
                    }}>
                        <div style={{
                            fontSize: '15px',
                            fontFamily: 'var(--theia-code-font-family)',
                            color: 'var(--theia-foreground)',
                            flex: 1
                        }}>
                            {coords.dms}
                        </div>
                        <button
                            style={{
                                padding: '6px 12px',
                                backgroundColor: copied === 'DMS' 
                                    ? 'var(--theia-testing-iconPassed)' 
                                    : 'var(--theia-button-background)',
                                color: 'var(--theia-button-foreground)',
                                border: 'none',
                                borderRadius: '3px',
                                cursor: 'pointer',
                                fontSize: '12px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                transition: 'background-color 0.2s'
                            }}
                            onClick={() => handleCopy(coords.dms, 'DMS')}
                        >
                            <span className={copied === 'DMS' ? 'codicon codicon-check' : 'codicon codicon-copy'}></span>
                            {copied === 'DMS' ? 'Copié' : 'Copier'}
                        </button>
                    </div>
                </div>

                {/* Décimal */}
                <div style={{ marginBottom: '20px' }}>
                    <div style={{
                        fontSize: '12px',
                        color: 'var(--theia-descriptionForeground)',
                        marginBottom: '6px',
                        fontWeight: 'bold',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                    }}>
                        Coordonnées décimales
                    </div>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '10px'
                    }}>
                        <div style={{
                            fontSize: '14px',
                            fontFamily: 'var(--theia-code-font-family)',
                            color: 'var(--theia-foreground)',
                            flex: 1
                        }}>
                            {coords.decimal}
                        </div>
                        <button
                            style={{
                                padding: '6px 12px',
                                backgroundColor: copied === 'Decimal' 
                                    ? 'var(--theia-testing-iconPassed)' 
                                    : 'var(--theia-button-background)',
                                color: 'var(--theia-button-foreground)',
                                border: 'none',
                                borderRadius: '3px',
                                cursor: 'pointer',
                                fontSize: '12px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                transition: 'background-color 0.2s'
                            }}
                            onClick={() => handleCopy(coords.decimal, 'Decimal')}
                        >
                            <span className={copied === 'Decimal' ? 'codicon codicon-check' : 'codicon codicon-copy'}></span>
                            {copied === 'Decimal' ? 'Copié' : 'Copier'}
                        </button>
                    </div>
                </div>

                {/* Séparateur */}
                <div style={{
                    borderTop: '1px solid var(--theia-panel-border)',
                    margin: '15px 0'
                }} />

                {/* Lat/Lon séparés */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '15px',
                    fontSize: '13px'
                }}>
                    <div>
                        <div style={{
                            fontSize: '11px',
                            color: 'var(--theia-descriptionForeground)',
                            marginBottom: '4px',
                            fontWeight: 'bold'
                        }}>
                            LATITUDE
                        </div>
                        <div style={{
                            fontFamily: 'var(--theia-code-font-family)',
                            color: 'var(--theia-foreground)',
                            padding: '6px 10px',
                            backgroundColor: 'var(--theia-input-background)',
                            borderRadius: '3px'
                        }}>
                            {coords.latitude.toFixed(8)}
                        </div>
                    </div>
                    <div>
                        <div style={{
                            fontSize: '11px',
                            color: 'var(--theia-descriptionForeground)',
                            marginBottom: '4px',
                            fontWeight: 'bold'
                        }}>
                            LONGITUDE
                        </div>
                        <div style={{
                            fontFamily: 'var(--theia-code-font-family)',
                            color: 'var(--theia-foreground)',
                            padding: '6px 10px',
                            backgroundColor: 'var(--theia-input-background)',
                            borderRadius: '3px'
                        }}>
                            {coords.longitude.toFixed(8)}
                        </div>
                    </div>
                </div>
            </div>

            {/* Distance si disponible */}
            {result.distance && (
                <div style={{
                    padding: '12px',
                    backgroundColor: 'var(--theia-editor-background)',
                    border: '1px solid var(--theia-panel-border)',
                    borderRadius: '4px',
                    marginBottom: '15px'
                }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '8px'
                    }}>
                        <span className='codicon codicon-location' style={{ color: 'var(--theia-descriptionForeground)' }}></span>
                        <span style={{ fontWeight: 'bold', fontSize: '13px' }}>Distance depuis l'origine</span>
                    </div>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '10px'
                    }}>
                        <div style={{
                            padding: '8px',
                            backgroundColor: 'var(--theia-input-background)',
                            borderRadius: '3px',
                            textAlign: 'center'
                        }}>
                            <div style={{
                                fontSize: '20px',
                                fontWeight: 'bold',
                                fontFamily: 'var(--theia-code-font-family)',
                                color: 'var(--theia-textLink-activeForeground)'
                            }}>
                                {result.distance.km.toFixed(2)}
                            </div>
                            <div style={{
                                fontSize: '11px',
                                color: 'var(--theia-descriptionForeground)',
                                marginTop: '2px'
                            }}>
                                kilomètres
                            </div>
                        </div>
                        <div style={{
                            padding: '8px',
                            backgroundColor: 'var(--theia-input-background)',
                            borderRadius: '3px',
                            textAlign: 'center'
                        }}>
                            <div style={{
                                fontSize: '20px',
                                fontWeight: 'bold',
                                fontFamily: 'var(--theia-code-font-family)',
                                color: 'var(--theia-textLink-activeForeground)'
                            }}>
                                {result.distance.miles.toFixed(2)}
                            </div>
                            <div style={{
                                fontSize: '11px',
                                color: 'var(--theia-descriptionForeground)',
                                marginTop: '2px'
                            }}>
                                miles
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Étapes de calcul */}
            {result.calculation_steps && (
                <details style={{
                    padding: '12px',
                    backgroundColor: 'var(--theia-editor-background)',
                    border: '1px solid var(--theia-panel-border)',
                    borderRadius: '4px',
                    marginBottom: '15px',
                    cursor: 'pointer'
                }}>
                    <summary style={{
                        fontWeight: 'bold',
                        fontSize: '13px',
                        marginBottom: '10px'
                    }}>
                        <span className='codicon codicon-symbol-method' style={{ marginRight: '6px' }}></span>
                        Étapes de calcul
                    </summary>
                    <div style={{
                        fontSize: '12px',
                        fontFamily: 'var(--theia-code-font-family)',
                        color: 'var(--theia-descriptionForeground)',
                        paddingLeft: '20px'
                    }}>
                        <div style={{ marginBottom: '8px' }}>
                            <strong>Formule Nord originale :</strong>
                            <div style={{
                                padding: '6px',
                                backgroundColor: 'var(--theia-input-background)',
                                borderRadius: '3px',
                                marginTop: '4px'
                            }}>
                                {result.calculation_steps.north_original}
                            </div>
                        </div>
                        <div style={{ marginBottom: '8px' }}>
                            <strong>Formule Nord substituée :</strong>
                            <div style={{
                                padding: '6px',
                                backgroundColor: 'var(--theia-input-background)',
                                borderRadius: '3px',
                                marginTop: '4px'
                            }}>
                                {result.calculation_steps.north_substituted}
                            </div>
                        </div>
                        <div style={{ marginBottom: '8px' }}>
                            <strong>Formule Est originale :</strong>
                            <div style={{
                                padding: '6px',
                                backgroundColor: 'var(--theia-input-background)',
                                borderRadius: '3px',
                                marginTop: '4px'
                            }}>
                                {result.calculation_steps.east_original}
                            </div>
                        </div>
                        <div>
                            <strong>Formule Est substituée :</strong>
                            <div style={{
                                padding: '6px',
                                backgroundColor: 'var(--theia-input-background)',
                                borderRadius: '3px',
                                marginTop: '4px'
                            }}>
                                {result.calculation_steps.east_substituted}
                            </div>
                        </div>
                    </div>
                </details>
            )}

            {/* Actions */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: '10px'
            }}>
                {onProjectOnMap && (
                    <button
                        style={{
                            padding: '10px 14px',
                            backgroundColor: 'var(--theia-button-background)',
                            color: 'var(--theia-button-foreground)',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '13px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px',
                            fontWeight: '500'
                        }}
                        onClick={onProjectOnMap}
                    >
                        <span className='codicon codicon-map'></span>
                        Voir sur la carte
                    </button>
                )}
                
                {onCreateWaypoint && (
                    <button
                        style={{
                            padding: '10px 14px',
                            backgroundColor: 'var(--theia-button-background)',
                            color: 'var(--theia-button-foreground)',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '13px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px',
                            fontWeight: '500'
                        }}
                        onClick={onCreateWaypoint}
                    >
                        <span className='codicon codicon-add'></span>
                        Créer waypoint
                    </button>
                )}

                {onAutoSaveWaypoint && (
                    <button
                        style={{
                            padding: '10px 14px',
                            backgroundColor: 'var(--theia-button-background)',
                            color: 'var(--theia-button-foreground)',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '13px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px',
                            fontWeight: '500'
                        }}
                        onClick={onAutoSaveWaypoint}
                    >
                        <span className='codicon codicon-pass-filled'></span>
                        Ajouter et valider
                    </button>
                )}
            </div>
        </div>
    );
};
