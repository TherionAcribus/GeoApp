import * as React from 'react';
import { GeocacheDto, GeocacheSolvedStatus } from './geocache-details-types';
import { parseFlexibleGCCoords } from './geocache-details-utils';
import { calculateDistance } from './map/map-utils';
import { handleMenuArrowKeys } from './context-menu';
import '../../src/browser/style/geocache-details-header.css';

export interface CoordinatesEditorProps {
    geocacheData: GeocacheDto;
    gcCode?: string;
    onSaveCoordinates: (coordinatesRaw: string) => Promise<void>;
    onResetCoordinates: () => Promise<void>;
    onPushCorrectedCoordinates: () => Promise<void>;
    onUpdateSolvedStatus: (newStatus: GeocacheSolvedStatus) => Promise<void>;
    /** Ouverture des liens externes (les cartes en ligne sont forcées en fenêtre externe). */
    onOpenExternalUrl?: (url: string) => void;
}

const mapMenuStyle: React.CSSProperties = {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 4,
    minWidth: 220,
    background: 'var(--theia-menu-background)',
    border: '1px solid var(--theia-menu-border)',
    borderRadius: 4,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
    zIndex: 100,
    padding: '4px 0'
};
const mapMenuItemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    textAlign: 'left',
    border: 'none',
    cursor: 'pointer',
    padding: '6px 12px',
    fontSize: '0.9em'
};

/** Copie `text` dans le presse-papiers (fallback execCommand hors contexte sécurisé). */
async function copyTextToClipboard(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            return ok;
        } catch {
            return false;
        }
    }
}

export const CoordinatesEditor: React.FC<CoordinatesEditorProps> = ({
    geocacheData,
    gcCode,
    onSaveCoordinates,
    onResetCoordinates,
    onPushCorrectedCoordinates,
    onUpdateSolvedStatus,
    onOpenExternalUrl
}) => {
    const [isEditing, setIsEditing] = React.useState(false);
    const [editedCoords, setEditedCoords] = React.useState('');
    const [isSendingToGC, setIsSendingToGC] = React.useState(false);
    const [isMapMenuOpen, setIsMapMenuOpen] = React.useState(false);
    const [copiedFeedback, setCopiedFeedback] = React.useState(false);
    const mapMenuRef = React.useRef<HTMLDivElement | null>(null);
    const [solvedStatus, setSolvedStatus] = React.useState<GeocacheSolvedStatus>(
        geocacheData.solved || 'not_solved'
    );

    const displayCoords = geocacheData.coordinates_raw || geocacheData.original_coordinates_raw || '';
    const originalCoords = geocacheData.original_coordinates_raw || '';
    const isCorrected = geocacheData.is_corrected === true;

    // Coordonnées décimales des coordonnées affichées (corrigées si présentes) :
    // champs numériques du DTO en priorité, sinon parsing du format GC affiché.
    const decimalCoords = React.useMemo(() => {
        if (typeof geocacheData.latitude === 'number' && typeof geocacheData.longitude === 'number') {
            return { lat: geocacheData.latitude, lon: geocacheData.longitude };
        }
        return parseFlexibleGCCoords(displayCoords);
    }, [geocacheData.latitude, geocacheData.longitude, displayCoords]);

    // Distance originales → corrigées (règle GC : pour les mysteries, les
    // coordonnées affichées doivent rester à moins de 3,2 km de la finale).
    const originalDecimalCoords = React.useMemo(() => {
        if (typeof geocacheData.original_latitude === 'number' && typeof geocacheData.original_longitude === 'number') {
            return { lat: geocacheData.original_latitude, lon: geocacheData.original_longitude };
        }
        return parseFlexibleGCCoords(originalCoords);
    }, [geocacheData.original_latitude, geocacheData.original_longitude, originalCoords]);

    const correctedDistanceKm = React.useMemo(() => {
        if (!isCorrected || !decimalCoords || !originalDecimalCoords) {
            return undefined;
        }
        const km = calculateDistance(originalDecimalCoords.lon, originalDecimalCoords.lat, decimalCoords.lon, decimalCoords.lat);
        return km > 0.005 ? km : undefined; // < 5 m : déplacement non significatif
    }, [isCorrected, decimalCoords, originalDecimalCoords]);

    const formatDistance = (km: number): string =>
        km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(2).replace('.', ',')} km`;

    const coordActions = React.useMemo(() => {
        if (!decimalCoords) {
            return [];
        }
        const lat = decimalCoords.lat.toFixed(6);
        const lon = decimalCoords.lon.toFixed(6);
        return [
            { label: 'Google Maps', iconClass: 'codicon codicon-map', url: `https://www.google.com/maps?q=${lat},${lon}` },
            { label: 'OpenStreetMap', iconClass: 'codicon codicon-globe', url: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}` },
            { label: 'Waze', iconClass: 'codicon codicon-compass', url: `https://www.waze.com/ul?ll=${lat},${lon}&navigate=yes` },
        ];
    }, [decimalCoords]);

    React.useEffect(() => {
        if (!isMapMenuOpen) {
            return;
        }
        const handleClickOutside = (event: MouseEvent) => {
            if (mapMenuRef.current && !mapMenuRef.current.contains(event.target as Node)) {
                setIsMapMenuOpen(false);
            }
        };
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsMapMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [isMapMenuOpen]);

    const copyCoordinates = (text: string) => {
        void copyTextToClipboard(text).then(ok => {
            if (ok) {
                setCopiedFeedback(true);
                setTimeout(() => setCopiedFeedback(false), 1500);
            }
        });
    };

    const openMap = (url: string) => {
        setIsMapMenuOpen(false);
        if (onOpenExternalUrl) {
            onOpenExternalUrl(url);
        } else {
            window.open(url, '_blank', 'noopener,noreferrer');
        }
    };

    const coordsError = React.useMemo(() => {
        const v = editedCoords.trim();
        if (!v) { return null; }
        return parseFlexibleGCCoords(v) ? null : 'Format attendu : N 48° 51.402 E 002° 21.048';
    }, [editedCoords]);
    const canSave = editedCoords.trim().length > 0 && !coordsError;

    React.useEffect(() => {
        setSolvedStatus(geocacheData.solved || 'not_solved');
    }, [geocacheData.solved]);

    const startEdit = () => {
        setEditedCoords(displayCoords);
        setIsEditing(true);
    };

    const cancelEdit = () => {
        setIsEditing(false);
        setEditedCoords('');
    };

    const saveCoordinates = async () => {
        try {
            await onSaveCoordinates(editedCoords);
            setIsEditing(false);
        } catch (e) {
            console.error('Save coordinates error', e);
        }
    };

    const resetToOriginal = async () => {
        try {
            await onResetCoordinates();
            setIsEditing(false);
        } catch (e) {
            console.error('Reset coordinates error', e);
        }
    };

    const sendToGeocaching = async () => {
        setIsSendingToGC(true);
        try {
            await onPushCorrectedCoordinates();
        } catch (e) {
            console.error('sendToGeocaching error', e);
        } finally {
            setIsSendingToGC(false);
        }
    };

    const updateSolvedStatus = async (newStatus: GeocacheSolvedStatus) => {
        try {
            await onUpdateSolvedStatus(newStatus);
            setSolvedStatus(newStatus);
        } catch (e) {
            console.error('Update solved status error', e);
        }
    };

    return (
        <div style={{ display: 'grid', gap: 12 }}>
            {!isEditing && (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <strong>Coordonnées {isCorrected && '(corrigées)'}</strong>
                        <div style={{ display: 'flex', gap: 6 }}>
                            {isCorrected && (
                                <button
                                    onClick={sendToGeocaching}
                                    disabled={isSendingToGC}
                                    title='Envoyer les coordonnées corrigées vers Geocaching.com'
                                    style={{
                                        padding: '4px 10px',
                                        backgroundColor: 'var(--theia-button-secondaryBackground)',
                                        color: 'var(--theia-button-secondaryForeground)',
                                        border: '1px solid var(--theia-button-border)',
                                        borderRadius: 4,
                                        cursor: isSendingToGC ? 'wait' : 'pointer',
                                        fontSize: 12,
                                        opacity: isSendingToGC ? 0.6 : 1
                                    }}
                                >
                                    {isSendingToGC ? (
                                        <>
                                            <span className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true' />
                                            {' Envoi…'}
                                        </>
                                    ) : (
                                        <>
                                            <span className='codicon codicon-cloud-upload' aria-hidden='true' />
                                            {` Envoyer vers GC.com${gcCode ? ` (${gcCode})` : ''}`}
                                        </>
                                    )}
                                </button>
                            )}
                            <button
                                onClick={startEdit}
                                style={{
                                    padding: '4px 12px',
                                    backgroundColor: 'var(--theia-button-background)',
                                    color: 'var(--theia-button-foreground)',
                                    border: 'none',
                                    borderRadius: 4,
                                    cursor: 'pointer'
                                }}
                            >
                                {isCorrected ? 'Modifier' : 'Corriger les coordonnées'}
                            </button>
                        </div>
                    </div>
                    <div style={{
                        padding: 8,
                        backgroundColor: 'var(--theia-editor-background)',
                        borderRadius: 4,
                        fontFamily: 'monospace',
                        fontSize: 14
                    }}>
                        {displayCoords || 'Aucune coordonnée'}
                    </div>

                    {isCorrected && originalCoords && originalCoords !== displayCoords && (
                        <div style={{ marginTop: 8 }}>
                            <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 4 }}>Coordonnées originales</div>
                            <div style={{
                                padding: 8,
                                backgroundColor: 'var(--theia-editor-background)',
                                borderRadius: 4,
                                fontFamily: 'monospace',
                                fontSize: 13,
                                opacity: 0.8
                            }}>
                                {originalCoords}
                            </div>
                        </div>
                    )}

                    {correctedDistanceKm !== undefined ? (
                        <div
                            style={{
                                display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12,
                                color: correctedDistanceKm > 3.2 ? 'var(--theia-editorWarning-foreground)' : 'var(--theia-descriptionForeground)'
                            }}
                            title={correctedDistanceKm > 3.2
                                ? 'Attention : Geocaching.com exige que les coordonnées affichées d\'une mystery soient à moins de 3,2 km de la position finale'
                                : 'Distance entre les coordonnées affichées et les coordonnées corrigées'}
                        >
                            <span className='codicon codicon-arrow-right' aria-hidden='true' />
                            <span>
                                Distance : <strong>{formatDistance(correctedDistanceKm)}</strong>
                                {correctedDistanceKm > 3.2 ? ' — au-delà de la limite des 3,2 km' : ''}
                            </span>
                        </div>
                    ) : undefined}

                    {displayCoords ? (
                        <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                            <button
                                className='theia-button secondary'
                                onClick={() => copyCoordinates(displayCoords)}
                                title={`Copier « ${displayCoords} » dans le presse-papiers`}
                                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                            >
                                <span className={`codicon ${copiedFeedback ? 'codicon-check' : 'codicon-copy'}`} aria-hidden='true' />
                                {copiedFeedback ? 'Copié !' : 'Copier'}
                            </button>
                            {coordActions.length > 0 ? (
                                <div ref={mapMenuRef} style={{ position: 'relative' }}>
                                    <button
                                        className='theia-button secondary'
                                        onClick={() => setIsMapMenuOpen(open => !open)}
                                        aria-haspopup='menu'
                                        aria-expanded={isMapMenuOpen}
                                        title='Ouvrir ces coordonnées dans une carte en ligne'
                                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                                    >
                                        <span className='codicon codicon-location' aria-hidden='true' />
                                        <span>Ouvrir dans</span>
                                        <span className='codicon codicon-chevron-down' aria-hidden='true' style={{ fontSize: 10 }} />
                                    </button>
                                    {isMapMenuOpen && (
                                        <div role='menu' aria-label='Ouvrir les coordonnées dans…' onKeyDown={(e) => handleMenuArrowKeys(e, e.currentTarget)} style={mapMenuStyle}>
                                            {coordActions.map(target => (
                                                <button
                                                    key={target.label}
                                                    type='button'
                                                    role='menuitem'
                                                    className='geoapp-menu-item'
                                                    onClick={() => openMap(target.url)}
                                                    style={mapMenuItemStyle}
                                                >
                                                    <span className={target.iconClass} aria-hidden='true' />
                                                    <span>{target.label}</span>
                                                </button>
                                            ))}
                                            <div style={{ height: 1, background: 'var(--theia-menu-separatorBackground)', margin: '4px 0' }} />
                                            <button
                                                type='button'
                                                role='menuitem'
                                                className='geoapp-menu-item'
                                                onClick={() => { setIsMapMenuOpen(false); copyCoordinates(`${decimalCoords!.lat.toFixed(6)}, ${decimalCoords!.lon.toFixed(6)}`); }}
                                                style={mapMenuItemStyle}
                                            >
                                                <span className='codicon codicon-copy' aria-hidden='true' />
                                                <span>Copier en décimal</span>
                                            </button>
                                            {isCorrected && originalCoords ? (
                                                <button
                                                    type='button'
                                                    role='menuitem'
                                                    className='geoapp-menu-item'
                                                    onClick={() => { setIsMapMenuOpen(false); copyCoordinates(originalCoords); }}
                                                    style={mapMenuItemStyle}
                                                >
                                                    <span className='codicon codicon-copy' aria-hidden='true' />
                                                    <span>Copier les originales</span>
                                                </button>
                                            ) : undefined}
                                        </div>
                                    )}
                                </div>
                            ) : undefined}
                        </div>
                    ) : undefined}
                </div>
            )}

            {isEditing && (
                <div>
                    <div style={{ marginBottom: 8 }}>
                        <strong>Modifier les coordonnées</strong>
                    </div>
                    <input
                        type="text"
                        value={editedCoords}
                        onChange={(e) => setEditedCoords(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && canSave) {
                                void saveCoordinates();
                            } else if (e.key === 'Escape') {
                                cancelEdit();
                            }
                        }}
                        placeholder="N 48° 51.402 E 002° 21.048"
                        style={{
                            width: '100%',
                            padding: 8,
                            backgroundColor: 'var(--theia-input-background)',
                            color: 'var(--theia-input-foreground)',
                            border: `1px solid ${coordsError ? 'var(--theia-inputValidation-errorBorder)' : 'var(--theia-input-border)'}`,
                            borderRadius: 4,
                            fontFamily: 'monospace',
                            fontSize: 14
                        }}
                    />
                    {coordsError && (
                        <div style={{ fontSize: 11, color: 'var(--theia-inputValidation-errorForeground)', marginTop: 2 }}>
                            {coordsError}
                        </div>
                    )}

                    {originalCoords && (
                        <div style={{ marginTop: 8 }}>
                            <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 4 }}>Coordonnées originales (référence)</div>
                            <div style={{
                                padding: 8,
                                backgroundColor: 'var(--theia-editor-background)',
                                borderRadius: 4,
                                fontFamily: 'monospace',
                                fontSize: 13,
                                opacity: 0.8
                            }}>
                                {originalCoords}
                            </div>
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                        <button
                            onClick={saveCoordinates}
                            disabled={!canSave}
                            style={{
                                padding: '6px 16px',
                                backgroundColor: 'var(--theia-button-background)',
                                color: 'var(--theia-button-foreground)',
                                border: 'none',
                                borderRadius: 4,
                                cursor: canSave ? 'pointer' : 'not-allowed',
                                opacity: canSave ? 1 : 0.5
                            }}
                        >
                            Enregistrer
                        </button>
                        <button
                            onClick={cancelEdit}
                            style={{
                                padding: '6px 16px',
                                backgroundColor: 'var(--theia-secondaryButton-background)',
                                color: 'var(--theia-secondaryButton-foreground)',
                                border: 'none',
                                borderRadius: 4,
                                cursor: 'pointer'
                            }}
                        >
                            Annuler
                        </button>
                        {isCorrected && originalCoords && (
                            <button
                                onClick={resetToOriginal}
                                style={{
                                    padding: '6px 16px',
                                    backgroundColor: 'var(--theia-editorWarning-foreground)',
                                    color: 'var(--theia-editor-background)',
                                    border: 'none',
                                    borderRadius: 4,
                                    cursor: 'pointer',
                                    marginLeft: 'auto'
                                }}
                            >
                                Revenir aux coordonnées originales
                            </button>
                        )}
                    </div>
                </div>
            )}

            <div>
                <div style={{ marginBottom: 8 }}>
                    <strong>Statut de résolution</strong>
                </div>
                <select
                    value={solvedStatus}
                    onChange={(e) => updateSolvedStatus(e.target.value as GeocacheSolvedStatus)}
                    style={{
                        width: '100%',
                        padding: 8,
                        backgroundColor: 'var(--theia-input-background)',
                        color: 'var(--theia-input-foreground)',
                        border: '1px solid var(--theia-input-border)',
                        borderRadius: 4
                    }}
                >
                    <option value="not_solved">Non résolu</option>
                    <option value="in_progress">En cours</option>
                    <option value="solved">Résolu</option>
                </select>
            </div>
        </div>
    );
};
