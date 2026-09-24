import * as React from 'react';
import { GeocacheDto, GeocacheSolvedStatus } from './geocache-details-types';
import { parseFlexibleGCCoords } from './geocache-details-utils';

export interface CoordinatesEditorProps {
    geocacheData: GeocacheDto;
    gcCode?: string;
    onSaveCoordinates: (coordinatesRaw: string) => Promise<void>;
    onResetCoordinates: () => Promise<void>;
    onPushCorrectedCoordinates: () => Promise<void>;
    onUpdateSolvedStatus: (newStatus: GeocacheSolvedStatus) => Promise<void>;
}

export const CoordinatesEditor: React.FC<CoordinatesEditorProps> = ({
    geocacheData,
    gcCode,
    onSaveCoordinates,
    onResetCoordinates,
    onPushCorrectedCoordinates,
    onUpdateSolvedStatus
}) => {
    const [isEditing, setIsEditing] = React.useState(false);
    const [editedCoords, setEditedCoords] = React.useState('');
    const [isSendingToGC, setIsSendingToGC] = React.useState(false);
    const [solvedStatus, setSolvedStatus] = React.useState<GeocacheSolvedStatus>(
        geocacheData.solved || 'not_solved'
    );

    const displayCoords = geocacheData.coordinates_raw || geocacheData.original_coordinates_raw || '';
    const originalCoords = geocacheData.original_coordinates_raw || '';
    const isCorrected = geocacheData.is_corrected === true;

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
                                    {isSendingToGC ? '⏳ Envoi…' : `📡 Envoyer vers GC.com${gcCode ? ` (${gcCode})` : ''}`}
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
