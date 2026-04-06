import * as React from 'react';
import { MessageService } from '@theia/core';
import { SaveWaypointInput } from './geocache-details-service';
import {
    GeocacheDto,
    GeocacheWaypoint,
    WaypointPrefillPayload
} from './geocache-details-types';
import {
    calculateAntipode,
    calculateProjection,
    parseGCCoords,
    toGCFormat
} from './geocache-details-utils';

interface WaypointsEditorProps {
    waypoints?: GeocacheWaypoint[];
    geocacheData?: GeocacheDto;
    onSaveWaypoint: (waypointId: number | 'new' | undefined, payload: SaveWaypointInput) => Promise<void>;
    messages: MessageService;
    onDeleteWaypoint: (id: number, name: string) => Promise<void>;
    onSetAsCorrectedCoords: (waypointId: number, waypointName: string) => Promise<void>;
    onPushWaypointToGeocaching: (waypointId: number, waypointName: string) => Promise<void>;
}

interface WaypointsEditorWrapperProps extends WaypointsEditorProps {
    onRegisterCallback: (callback: (prefill?: WaypointPrefillPayload) => void) => void;
}

export const WaypointsEditorWrapper: React.FC<WaypointsEditorWrapperProps> = (props) => {
    const { onRegisterCallback, onPushWaypointToGeocaching, ...editorProps } = props;
    const startEditRef = React.useRef<((waypoint?: GeocacheWaypoint, prefill?: WaypointPrefillPayload) => void) | null>(null);

    React.useEffect(() => {
        if (startEditRef.current) {
            onRegisterCallback((prefill?: WaypointPrefillPayload) => {
                if (startEditRef.current) {
                    startEditRef.current(undefined, prefill);
                }
            });
        }
    }, [onRegisterCallback]);

    return (
        <WaypointsEditorWithRef
            {...editorProps}
            onPushWaypointToGeocaching={onPushWaypointToGeocaching}
            onStartEditRef={(fn) => { startEditRef.current = fn; }}
        />
    );
};

interface WaypointsEditorWithRefProps extends WaypointsEditorProps {
    onStartEditRef: (fn: (waypoint?: GeocacheWaypoint, prefill?: WaypointPrefillPayload) => void) => void;
    onPushWaypointToGeocaching: (waypointId: number, waypointName: string) => Promise<void>;
}

const WaypointsEditorWithRef: React.FC<WaypointsEditorWithRefProps> = ({ onStartEditRef, onPushWaypointToGeocaching, ...props }) => {
    const { waypoints, geocacheData, onSaveWaypoint, messages, onDeleteWaypoint, onSetAsCorrectedCoords } = props;
    const [editingId, setEditingId] = React.useState<number | 'new' | null>(null);
    const [editForm, setEditForm] = React.useState<Partial<GeocacheWaypoint>>({});
    const [projectionParams, setProjectionParams] = React.useState({ distance: 100, unit: 'm', bearing: 0 });
    const [calculatedCoords, setCalculatedCoords] = React.useState<string>('');

    const startEdit = React.useCallback((waypoint?: GeocacheWaypoint, prefill?: WaypointPrefillPayload) => {
        if (waypoint) {
            setEditingId(waypoint.id ?? null);
            setEditForm({ ...waypoint });
        } else {
            setEditingId('new');
            setEditForm({
                prefix: '',
                lookup: '',
                name: prefill?.title || '',
                type: '',
                latitude: undefined,
                longitude: undefined,
                gc_coords: prefill?.coords || geocacheData?.coordinates_raw || '',
                note: prefill?.note || ''
            });
        }
        setCalculatedCoords('');
    }, [geocacheData?.coordinates_raw]);

    React.useEffect(() => {
        onStartEditRef(startEdit);
    }, [startEdit, onStartEditRef]);

    const duplicateWaypoint = (waypoint: GeocacheWaypoint) => {
        const note = waypoint.note_override ?? waypoint.note;
        setEditingId('new');
        setEditForm({
            prefix: waypoint.prefix,
            lookup: waypoint.lookup,
            name: waypoint.name ? `${waypoint.name} copy` : 'copy',
            type: waypoint.type,
            latitude: undefined,
            longitude: undefined,
            gc_coords: waypoint.gc_coords,
            note_override: note
        });
        setCalculatedCoords('');
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditForm({});
        setCalculatedCoords('');
    };

    const saveWaypoint = async () => {
        try {
            const noteToSave = (editForm.note_override ?? editForm.note) || '';
            const dataToSave = {
                prefix: editForm.prefix,
                lookup: editForm.lookup,
                name: editForm.name,
                type: editForm.type,
                gc_coords: editForm.gc_coords,
                note: noteToSave,
                note_override: noteToSave
            };

            console.log('[WaypointsEditor] 💾 SAVE WAYPOINT');
            console.log('[WaypointsEditor] Données à envoyer:', dataToSave);
            console.log('[WaypointsEditor] gc_coords:', dataToSave.gc_coords);

            await onSaveWaypoint(
                editingId === null ? undefined : editingId,
                dataToSave
            );
            cancelEdit();
        } catch (e) {
            console.error('[WaypointsEditor] ❌ Save waypoint error', e);
        }
    };

    const deleteWaypoint = async (waypoint: GeocacheWaypoint) => {
        if (!waypoint.id) {
            return;
        }
        await onDeleteWaypoint(waypoint.id, waypoint.name || 'ce waypoint');
    };

    const setAsCorrectedCoords = async (waypoint: GeocacheWaypoint) => {
        if (!waypoint.id) {
            return;
        }
        await onSetAsCorrectedCoords(waypoint.id, waypoint.name || 'ce waypoint');
    };

    const pushWaypointToGeocaching = async (waypoint: GeocacheWaypoint) => {
        if (!waypoint.id) {
            return;
        }
        await onPushWaypointToGeocaching(waypoint.id, waypoint.name || 'ce waypoint');
    };

    const setCurrentFormAsCorrectedCoords = async () => {
        if (!editForm.gc_coords) {
            messages.error('Veuillez saisir des coordonnées');
            return;
        }
        const tempWaypoint: GeocacheWaypoint = {
            id: editingId === 'new' ? undefined : editingId as number,
            gc_coords: editForm.gc_coords,
            name: editForm.name
        };

        if (editingId === 'new') {
            messages.info('Sauvegarde du waypoint en cours...');
            await saveWaypoint();
            messages.info('Veuillez maintenant cliquer sur le bouton &#x1F3AF; du waypoint créé');
        } else if (tempWaypoint.id) {
            await onSetAsCorrectedCoords(tempWaypoint.id, tempWaypoint.name || 'ce waypoint');
        }
    };

    const handleCalculateAntipode = () => {
        const coords = editForm.gc_coords ? (() => {
            const parts = editForm.gc_coords.split(',').map(s => s.trim());
            return parseGCCoords(parts[0] || '', parts[1] || '');
        })() : (editForm.latitude !== undefined && editForm.longitude !== undefined
            ? { lat: editForm.latitude, lon: editForm.longitude }
            : null);
        if (!coords) {
            messages.error('Coordonnées invalides');
            return;
        }
        const antipode = calculateAntipode(coords.lat, coords.lon);
        const gcFormat = toGCFormat(antipode.lat, antipode.lon);
        setCalculatedCoords(`${gcFormat.gcLat}, ${gcFormat.gcLon}`);
    };

    const handleCalculateProjection = () => {
        const coords = editForm.gc_coords ? parseGCCoords(
            editForm.gc_coords.split(',')[0]?.trim() || '',
            editForm.gc_coords.split(',')[1]?.trim() || ''
        ) : (editForm.latitude !== undefined && editForm.longitude !== undefined
            ? { lat: editForm.latitude, lon: editForm.longitude }
            : null);
        if (!coords) {
            messages.error('Coordonnées invalides');
            return;
        }
        let distanceInMeters = projectionParams.distance;
        if (projectionParams.unit === 'km') {
            distanceInMeters *= 1000;
        } else if (projectionParams.unit === 'miles') {
            distanceInMeters *= 1609.34;
        }
        const projected = calculateProjection(coords.lat, coords.lon, distanceInMeters, projectionParams.bearing);
        const gcFormat = toGCFormat(projected.lat, projected.lon);
        setCalculatedCoords(`${gcFormat.gcLat}, ${gcFormat.gcLon}`);
    };

    const applyCalculatedCoords = () => {
        if (!calculatedCoords) {
            return;
        }
        const parsed = parseGCCoords(
            calculatedCoords.split(',')[0]?.trim() || '',
            calculatedCoords.split(',')[1]?.trim() || ''
        );
        if (parsed) {
            setEditForm({ ...editForm, gc_coords: calculatedCoords, latitude: parsed.lat, longitude: parsed.lon });
        }
    };

    return (
        <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4 style={{ margin: 0 }}>Waypoints</h4>
                <button
                    className='theia-button'
                    onClick={() => startEdit()}
                    disabled={editingId !== null}
                    style={{ padding: '4px 12px', fontSize: 13 }}
                >
                    + Ajouter un waypoint
                </button>
            </div>

            {editingId !== null && (
                <div style={{
                    border: '1px solid var(--theia-foreground)',
                    borderRadius: 4,
                    padding: 12,
                    background: 'var(--theia-editor-background)'
                }}>
                    <h5 style={{ marginTop: 0 }}>{editingId === 'new' ? 'Nouveau Waypoint' : 'Éditer Waypoint'}</h5>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                        <div>
                            <label style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 2 }}>Préfixe</label>
                            <input
                                type='text'
                                className='theia-input'
                                value={editForm.prefix || ''}
                                onChange={e => setEditForm({ ...editForm, prefix: e.target.value })}
                                style={{ width: '100%' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 2 }}>Lookup</label>
                            <input
                                type='text'
                                className='theia-input'
                                value={editForm.lookup || ''}
                                onChange={e => setEditForm({ ...editForm, lookup: e.target.value })}
                                style={{ width: '100%' }}
                            />
                        </div>
                    </div>
                    <div style={{ marginBottom: 8 }}>
                        <label style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 2 }}>Nom</label>
                        <input
                            type='text'
                            className='theia-input'
                            value={editForm.name || ''}
                            onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                            style={{ width: '100%' }}
                        />
                    </div>
                    <div style={{ marginBottom: 8 }}>
                        <label style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 2 }}>Type</label>
                        <input
                            type='text'
                            className='theia-input'
                            value={editForm.type || ''}
                            onChange={e => setEditForm({ ...editForm, type: e.target.value })}
                            style={{ width: '100%' }}
                        />
                    </div>
                    <div style={{ marginBottom: 8 }}>
                        <label style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 2 }}>Coordonnées (format GC)</label>
                        <input
                            type='text'
                            className='theia-input'
                            value={editForm.gc_coords || ''}
                            onChange={e => setEditForm({ ...editForm, gc_coords: e.target.value })}
                            placeholder='N 48° 51.402, E 002° 21.048'
                            style={{ width: '100%' }}
                        />
                    </div>
                    <div style={{ marginBottom: 8 }}>
                        <label style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 2 }}>Note</label>
                        <textarea
                            className='theia-input'
                            value={editForm.note_override ?? editForm.note ?? ''}
                            onChange={e => setEditForm({ ...editForm, note_override: e.target.value })}
                            rows={3}
                            style={{ width: '100%', resize: 'vertical' }}
                        />
                    </div>

                    <div style={{ borderTop: '1px solid var(--theia-panel-border)', paddingTop: 10, marginTop: 10 }}>
                        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Outils de calcul</div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                            <button className='theia-button secondary' onClick={handleCalculateAntipode}>Antipode</button>
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                <input
                                    type='number'
                                    className='theia-input'
                                    value={projectionParams.distance}
                                    onChange={e => setProjectionParams({ ...projectionParams, distance: Number(e.target.value) })}
                                    style={{ width: 90 }}
                                />
                                <select
                                    className='theia-input'
                                    value={projectionParams.unit}
                                    onChange={e => setProjectionParams({ ...projectionParams, unit: e.target.value })}
                                >
                                    <option value='m'>m</option>
                                    <option value='km'>km</option>
                                    <option value='miles'>miles</option>
                                </select>
                                <input
                                    type='number'
                                    className='theia-input'
                                    value={projectionParams.bearing}
                                    onChange={e => setProjectionParams({ ...projectionParams, bearing: Number(e.target.value) })}
                                    style={{ width: 90 }}
                                />
                                <button className='theia-button secondary' onClick={handleCalculateProjection}>Projection</button>
                            </div>
                        </div>
                        {calculatedCoords && (
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                <code>{calculatedCoords}</code>
                                <button className='theia-button secondary' onClick={applyCalculatedCoords}>Appliquer</button>
                                <button className='theia-button secondary' onClick={setCurrentFormAsCorrectedCoords}>Définir comme coordonnées corrigées</button>
                            </div>
                        )}
                    </div>

                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                        <button className='theia-button' onClick={() => { void saveWaypoint(); }}>Sauvegarder</button>
                        <button className='theia-button secondary' onClick={cancelEdit}>Annuler</button>
                    </div>
                </div>
            )}

            {(!waypoints || waypoints.length === 0) && editingId === null ? (
                <div style={{ opacity: 0.6, fontStyle: 'italic' }}>Aucun waypoint</div>
            ) : undefined}

            {waypoints && waypoints.length > 0 ? (
                <table className='theia-table' style={{ width: '100%' }}>
                    <thead>
                        <tr>
                            <th>Préfixe</th>
                            <th>Nom</th>
                            <th>Type</th>
                            <th>Coordonnées</th>
                            <th>Note</th>
                            <th style={{ width: 220 }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {waypoints.map((w, i) => (
                            <tr key={w.id ?? i}>
                                <td>{w.prefix || ''}</td>
                                <td>{w.name || ''}</td>
                                <td>{w.type || ''}</td>
                                <td style={{ fontFamily: 'monospace' }}>{w.gc_coords || ''}</td>
                                <td style={{ whiteSpace: 'pre-wrap' }}>{w.note_override ?? w.note ?? ''}</td>
                                <td>
                                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                        <button
                                            className='theia-button secondary'
                                            onClick={() => startEdit(w)}
                                            disabled={editingId !== null}
                                            style={{ padding: '2px 8px', fontSize: 11 }}
                                            title='Éditer'
                                        >
                                            ✏️
                                        </button>
                                        <button
                                            className='theia-button secondary'
                                            onClick={() => duplicateWaypoint(w)}
                                            disabled={editingId !== null}
                                            style={{ padding: '2px 8px', fontSize: 11 }}
                                            title='Dupliquer'
                                        >
                                            📄
                                        </button>
                                        <button
                                            className='theia-button secondary'
                                            onClick={() => { void setAsCorrectedCoords(w); }}
                                            disabled={editingId !== null || !w.id}
                                            style={{ padding: '2px 8px', fontSize: 11 }}
                                            title='Utiliser comme coordonnées corrigées'
                                        >
                                            🎯
                                        </button>
                                        <button
                                            className='theia-button secondary'
                                            onClick={() => { void pushWaypointToGeocaching(w); }}
                                            disabled={editingId !== null || !w.id}
                                            style={{ padding: '2px 8px', fontSize: 11 }}
                                            title='Envoyer vers Geocaching.com'
                                        >
                                            📡
                                        </button>
                                        <button
                                            className='theia-button secondary'
                                            onClick={() => { void deleteWaypoint(w); }}
                                            disabled={editingId !== null}
                                            style={{ padding: '2px 8px', fontSize: 11 }}
                                            title='Supprimer'
                                        >
                                            🗑️
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            ) : undefined}
        </div>
    );
};
