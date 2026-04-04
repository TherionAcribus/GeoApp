/**
 * Composant de détection de coordonnées GPS.
 * Détecte automatiquement les coordonnées dans le texte décodé.
 */
import * as React from '@theia/core/shared/react';
import { DetectedCoordinates, DistanceInfo, AssociatedGeocache } from '../../common/alphabet-protocol';

export interface CoordinatesDetectorProps {
    text: string;
    alphabetsService: any;
    originCoords?: { ddm_lat: string; ddm_lon: string };
    associatedGeocache?: AssociatedGeocache;
    onDistanceCalculated?: (distance: DistanceInfo) => void;
    onCoordinatesDetected?: (coordinates: DetectedCoordinates | null) => void;
}

export const CoordinatesDetector: React.FC<CoordinatesDetectorProps> = ({
    text,
    alphabetsService,
    originCoords,
    associatedGeocache,
    onDistanceCalculated,
    onCoordinatesDetected
}) => {
    const [coordinates, setCoordinates] = React.useState<DetectedCoordinates | null>(null);
    const [distance, setDistance] = React.useState<DistanceInfo | null>(null);
    const [detecting, setDetecting] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const timerRef = React.useRef<NodeJS.Timeout | null>(null);
    const lastAnalyzedTextRef = React.useRef<string>('');
    const lastAnalyzedOriginRef = React.useRef<string>('');

    // Détection automatique avec debouncing intelligent
    React.useEffect(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
        }

        // Créer des clés pour comparer les changements
        const currentTextKey = text?.trim() || '';
        const currentOriginKey = JSON.stringify(originCoords) || '';

        // Ne déclencher l'analyse que si le texte ou l'origine ont changé
        const shouldAnalyze = currentTextKey !== lastAnalyzedTextRef.current ||
                             (currentTextKey && currentOriginKey !== lastAnalyzedOriginRef.current);

        if (!currentTextKey) {
            // Texte vide : réinitialiser tout
            setCoordinates(null);
            setDistance(null);
            setError(null);
            lastAnalyzedTextRef.current = '';
            lastAnalyzedOriginRef.current = '';
            if (onCoordinatesDetected) {
                onCoordinatesDetected(null);
            }
            return;
        }

        if (!shouldAnalyze) {
            // Rien n'a changé, ne pas relancer l'analyse
            return;
        }

        // Mettre à jour les références pour éviter les analyses répétées
        lastAnalyzedTextRef.current = currentTextKey;
        lastAnalyzedOriginRef.current = currentOriginKey;

        timerRef.current = setTimeout(async () => {
            try {
                setDetecting(true);
                setError(null);

                console.log('[CoordinatesDetector] Analyse du texte:', currentTextKey.substring(0, 50) + '...');

                const detected = await alphabetsService.detectCoordinates(text, originCoords);
                setCoordinates(detected);
                if (onCoordinatesDetected) {
                    onCoordinatesDetected(detected && detected.exist ? detected : null);
                }

                // Si des coordonnées sont détectées ET qu'on a une origine, calculer la distance
                if (detected.exist && originCoords && detected.ddm_lat && detected.ddm_lon) {
                    try {
                        const dist = await alphabetsService.calculateDistance(
                            originCoords.ddm_lat,
                            originCoords.ddm_lon,
                            detected.ddm_lat,
                            detected.ddm_lon
                        );
                        setDistance(dist);
                        if (onDistanceCalculated) {
                            onDistanceCalculated(dist);
                        }
                    } catch (distError) {
                        console.error('Error calculating distance:', distError);
                        setDistance(null);
                    }
                } else {
                    setDistance(null);
                }

                setDetecting(false);
                console.log('[CoordinatesDetector] Analyse terminée:', detected.exist ? 'Coordonnées trouvées' : 'Aucune coordonnée');
            } catch (err: any) {
                console.error('[CoordinatesDetector] Error detecting coordinates:', err);
                setError(err.message || 'Erreur lors de la détection');
                setCoordinates(null);
                setDistance(null);
                if (onCoordinatesDetected) {
                    onCoordinatesDetected(null);
                }
                setDetecting(false);
            }
        }, 1000); // 1 seconde de debounce

        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
            }
        };
    }, [text, originCoords, alphabetsService, onCoordinatesDetected]);

    // Rendu du status
    const renderStatus = () => {
        if (detecting) {
            return (
                <span className='coordinates-status analyzing' style={{
                    backgroundColor: 'var(--theia-statusBar-debuggingBackground)',
                    color: 'var(--theia-statusBar-debuggingForeground)',
                    padding: '4px 8px',
                    borderRadius: '3px',
                    fontSize: '11px',
                    fontWeight: 'bold'
                }}>
                    <i className='fa fa-spinner fa-spin' style={{ marginRight: '4px' }}></i>
                    Analyse...
                </span>
            );
        }

        if (error) {
            return (
                <span className='coordinates-status error' style={{
                    backgroundColor: 'var(--theia-statusBar-noFolderBackground)',
                    color: 'var(--theia-statusBar-noFolderForeground)',
                    padding: '4px 8px',
                    borderRadius: '3px',
                    fontSize: '11px',
                    fontWeight: 'bold'
                }}>
                    <i className='fa fa-exclamation-triangle' style={{ marginRight: '4px' }}></i>
                    Erreur
                </span>
            );
        }

        if (coordinates && coordinates.exist) {
            return (
                <span className='coordinates-status found' style={{
                    backgroundColor: 'var(--theia-statusBar-background)',
                    color: 'var(--theia-statusBar-foreground)',
                    padding: '4px 8px',
                    borderRadius: '3px',
                    fontSize: '11px',
                    fontWeight: 'bold'
                }}>
                    <i className='fa fa-check-circle' style={{ marginRight: '4px', color: '#00ff00' }}></i>
                    Coordonnées trouvées
                </span>
            );
        }

        return (
            <span className='coordinates-status not-found' style={{
                backgroundColor: 'var(--theia-list-inactiveSelectionBackground)',
                color: 'var(--theia-descriptionForeground)',
                padding: '4px 8px',
                borderRadius: '3px',
                fontSize: '11px'
            }}>
                <i className='fa fa-info-circle' style={{ marginRight: '4px' }}></i>
                Aucune coordonnée détectée
            </span>
        );
    };

    return (
        <div className='coordinates-container' style={{
            backgroundColor: 'var(--theia-list-activeSelectionBackground)',
            border: '1px solid var(--theia-list-inactiveSelectionBackground)',
            borderRadius: '4px',
            padding: '16px',
            marginTop: '16px'
        }}>
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '12px'
            }}>
                <h3 style={{ margin: 0, fontSize: '16px' }}>Coordonnées détectées</h3>
                {renderStatus()}
            </div>

            {error && (
                <div style={{
                    padding: '8px',
                    backgroundColor: 'rgba(255, 0, 0, 0.1)',
                    border: '1px solid rgba(255, 0, 0, 0.3)',
                    borderRadius: '3px',
                    color: 'var(--theia-errorForeground)',
                    fontSize: '12px',
                    marginTop: '8px'
                }}>
                    {error}
                </div>
            )}

            {coordinates && coordinates.exist && (
                <div style={{ marginTop: '12px' }}>
                    {/* Affichage DDM */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '12px',
                        marginBottom: '12px'
                    }}>
                        <div>
                            <div style={{
                                fontSize: '11px',
                                color: 'var(--theia-descriptionForeground)',
                                marginBottom: '4px'
                            }}>
                                Latitude DDM
                            </div>
                            <div style={{
                                padding: '8px',
                                backgroundColor: 'var(--theia-input-background)',
                                border: '1px solid var(--theia-input-border)',
                                borderRadius: '3px',
                                fontFamily: 'monospace',
                                fontSize: '13px'
                            }}>
                                {coordinates.ddm_lat}
                            </div>
                        </div>
                        <div>
                            <div style={{
                                fontSize: '11px',
                                color: 'var(--theia-descriptionForeground)',
                                marginBottom: '4px'
                            }}>
                                Longitude DDM
                            </div>
                            <div style={{
                                padding: '8px',
                                backgroundColor: 'var(--theia-input-background)',
                                border: '1px solid var(--theia-input-border)',
                                borderRadius: '3px',
                                fontFamily: 'monospace',
                                fontSize: '13px'
                            }}>
                                {coordinates.ddm_lon}
                            </div>
                        </div>
                    </div>

                    {/* Coordonnées complètes */}
                    {coordinates.ddm && (
                        <div style={{ marginBottom: '12px' }}>
                            <div style={{
                                fontSize: '11px',
                                color: 'var(--theia-descriptionForeground)',
                                marginBottom: '4px'
                            }}>
                                Coordonnées complètes
                            </div>
                            <div style={{
                                padding: '8px',
                                backgroundColor: 'var(--theia-input-background)',
                                border: '1px solid var(--theia-input-border)',
                                borderRadius: '3px',
                                fontFamily: 'monospace',
                                fontSize: '13px'
                            }}>
                                {coordinates.ddm}
                            </div>
                        </div>
                    )}

                    {/* Affichage de la distance si disponible */}
                    {distance && associatedGeocache && (
                        <div className={`distance-info ${distance.status}`} style={{
                            padding: '12px',
                            borderRadius: '4px',
                            marginTop: '12px',
                            backgroundColor: 
                                distance.status === 'ok' ? 'rgba(0, 255, 0, 0.1)' :
                                distance.status === 'warning' ? 'rgba(255, 255, 0, 0.1)' :
                                'rgba(255, 0, 0, 0.1)',
                            border: 
                                distance.status === 'ok' ? '1px solid rgba(0, 255, 0, 0.3)' :
                                distance.status === 'warning' ? '1px solid rgba(255, 255, 0, 0.3)' :
                                '1px solid rgba(255, 0, 0, 0.3)'
                        }}>
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                marginBottom: '8px',
                                fontSize: '13px',
                                fontWeight: 'bold'
                            }}>
                                <i className={
                                    distance.status === 'ok' ? 'fa fa-check-circle' :
                                    distance.status === 'warning' ? 'fa fa-exclamation-triangle' :
                                    'fa fa-times-circle'
                                } style={{
                                    marginRight: '8px',
                                    color: 
                                        distance.status === 'ok' ? '#00ff00' :
                                        distance.status === 'warning' ? '#ffff00' :
                                        '#ff0000'
                                }}></i>
                                Distance depuis {associatedGeocache.name}
                            </div>
                            <div style={{ fontSize: '12px', marginLeft: '24px' }}>
                                <div>{distance.meters.toFixed(0)} mètres ({distance.miles.toFixed(2)} miles)</div>
                                {distance.status === 'ok' && (
                                    <div style={{ marginTop: '4px', color: '#00ff00' }}>
                                        ✓ Point dans la limite de 2 miles
                                    </div>
                                )}
                                {distance.status === 'warning' && (
                                    <div style={{ marginTop: '4px', color: '#ffff00' }}>
                                        ⚠ Attention : Proche de la limite de 2 miles
                                    </div>
                                )}
                                {distance.status === 'far' && (
                                    <div style={{ marginTop: '4px', color: '#ff0000' }}>
                                        ✗ Trop éloigné ! Plus de 2.5 miles de l'origine
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Info si pas de géocache associée */}
                    {!associatedGeocache && (
                        <div style={{
                            padding: '8px',
                            backgroundColor: 'var(--theia-badge-background)',
                            borderRadius: '3px',
                            fontSize: '11px',
                            color: 'var(--theia-descriptionForeground)',
                            marginTop: '12px'
                        }}>
                            💡 Associez une géocache pour calculer la distance et utiliser les fonctionnalités avancées
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

