/**
 * Composant d'association avec une géocache.
 * Permet de sélectionner une géocache pour récupérer les coordonnées d'origine.
 */
import * as React from '@theia/core/shared/react';
import { AssociatedGeocache, DistanceInfo } from '../../common/alphabet-protocol';

export interface GeocacheAssociationProps {
    associatedGeocache?: AssociatedGeocache;
    onAssociate: (geocache: AssociatedGeocache) => void;
    onClear: () => void;
    onShowMap?: (geocache: AssociatedGeocache) => void;
    distanceInfo?: DistanceInfo;
}

export const GeocacheAssociation: React.FC<GeocacheAssociationProps> = ({
    associatedGeocache,
    onAssociate,
    onClear,
    onShowMap,
    distanceInfo
}) => {
    const [gcCode, setGcCode] = React.useState('');
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const handleAssociate = async () => {
        if (!gcCode || gcCode.trim() === '') {
            setError('Veuillez entrer un code géocache');
            return;
        }

        try {
            setLoading(true);
            setError(null);

            // Appeler l'API pour récupérer les infos de la géocache
            const response = await fetch(`http://127.0.0.1:8000/api/geocaches/by-code/${gcCode.toUpperCase()}`);
            
            if (!response.ok) {
                throw new Error('Géocache non trouvée');
            }

            const data = await response.json();
            
            const geocacheData = {
                id: data.id,
                databaseId: data.database_id,
                code: data.gc_code,
                name: data.name,
                gc_lat: data.gc_lat,
                gc_lon: data.gc_lon
            };

            onAssociate(geocacheData);

            // Ouvrir automatiquement la carte après l'association
            if (onShowMap) {
                console.log('[GeocacheAssociation] Ouverture automatique de la carte pour la nouvelle géocache associée');
                onShowMap(geocacheData);
            }

            setGcCode('');
            setLoading(false);
        } catch (err: any) {
            console.error('Error associating geocache:', err);
            setError(err.message || 'Erreur lors de l\'association');
            setLoading(false);
        }
    };

    return (
        <div style={{
            padding: '16px',
            backgroundColor: 'var(--theia-list-activeSelectionBackground)',
            border: '1px solid var(--theia-list-inactiveSelectionBackground)',
            borderRadius: '4px'
        }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '16px' }}>
                <i className='fa fa-map-marker' style={{ marginRight: '8px' }}></i>
                Géocache associée
            </h3>

            {!associatedGeocache ? (
                <div>
                    <p style={{
                        fontSize: '12px',
                        color: 'var(--theia-descriptionForeground)',
                        marginBottom: '12px'
                    }}>
                        Associez une géocache pour calculer automatiquement la distance des coordonnées détectées.
                    </p>

                    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                        <input
                            type='text'
                            placeholder='Code géocache (ex: GC12345)'
                            value={gcCode}
                            onChange={e => setGcCode(e.target.value)}
                            onKeyPress={e => e.key === 'Enter' && handleAssociate()}
                            disabled={loading}
                            style={{
                                flex: 1,
                                padding: '6px 10px',
                                backgroundColor: 'var(--theia-input-background)',
                                color: 'var(--theia-input-foreground)',
                                border: '1px solid var(--theia-input-border)',
                                borderRadius: '3px'
                            }}
                        />
                        <button
                            onClick={handleAssociate}
                            disabled={loading || !gcCode}
                            style={{
                                padding: '6px 12px',
                                backgroundColor: 'var(--theia-button-background)',
                                color: 'var(--theia-button-foreground)',
                                border: 'none',
                                borderRadius: '3px',
                                cursor: loading ? 'wait' : 'pointer',
                                opacity: (loading || !gcCode) ? 0.5 : 1
                            }}
                        >
                            {loading ? <i className='fa fa-spinner fa-spin'></i> : 'Associer'}
                        </button>
                    </div>

                    {error && (
                        <div style={{
                            padding: '8px',
                            backgroundColor: 'rgba(255, 0, 0, 0.1)',
                            border: '1px solid rgba(255, 0, 0, 0.3)',
                            borderRadius: '3px',
                            color: 'var(--theia-errorForeground)',
                            fontSize: '12px'
                        }}>
                            {error}
                        </div>
                    )}
                </div>
            ) : (
                <div>
                    <div style={{
                        padding: '12px',
                        backgroundColor: 'var(--theia-input-background)',
                        border: '1px solid var(--theia-input-border)',
                        borderRadius: '4px',
                        marginBottom: '12px'
                    }}>
                        <div style={{
                            fontSize: '14px',
                            fontWeight: 'bold',
                            marginBottom: '8px'
                        }}>
                            <i className='fa fa-check-circle' style={{ marginRight: '8px', color: '#00ff00' }}></i>
                            {associatedGeocache.code} - {associatedGeocache.name}
                        </div>

                        <div style={{
                            fontSize: '12px',
                            fontFamily: 'monospace',
                            color: 'var(--theia-descriptionForeground)'
                        }}>
                            {associatedGeocache.gc_lat && associatedGeocache.gc_lon && (
                                <>
                                    <div>Latitude: {associatedGeocache.gc_lat}</div>
                                    <div>Longitude: {associatedGeocache.gc_lon}</div>
                                </>
                            )}

                            {distanceInfo && (
                                <div style={{
                                    marginTop: '4px',
                                    color: distanceInfo.status === 'far' ? 'var(--theia-errorForeground)' :
                                           distanceInfo.status === 'warning' ? 'var(--theia-textLink-foreground)' :
                                           'var(--theia-textLink-activeForeground)',
                                    fontWeight: 'bold'
                                }}>
                                    <i className='fa fa-route' style={{ marginRight: '4px' }}></i>
                                    Distance: {distanceInfo.meters < 1000 ?
                                        `${Math.round(distanceInfo.meters)} m` :
                                        `${(distanceInfo.meters / 1000).toFixed(1)} km`}
                                </div>
                            )}
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                        {onShowMap && (
                            <button
                                onClick={() => onShowMap(associatedGeocache)}
                                style={{
                                    padding: '6px 12px',
                                    backgroundColor: 'var(--theia-button-background)',
                                    color: 'var(--theia-button-foreground)',
                                    border: 'none',
                                    borderRadius: '3px',
                                    cursor: 'pointer',
                                    fontSize: '12px'
                                }}
                            >
                                <i className='fa fa-map' style={{ marginRight: '6px' }}></i>
                                Afficher sur la carte !
                            </button>
                        )}

                        <button
                            onClick={onClear}
                            style={{
                                padding: '6px 12px',
                                backgroundColor: 'var(--theia-button-secondary-background)',
                                color: 'var(--theia-button-secondary-foreground)',
                                border: '1px solid var(--theia-button-border)',
                                borderRadius: '3px',
                                cursor: 'pointer',
                                fontSize: '12px'
                            }}
                        >
                            <i className='fa fa-times' style={{ marginRight: '6px' }}></i>
                            Supprimer l'association
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

