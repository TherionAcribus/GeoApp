import * as React from 'react';
import { MessageService } from '@theia/core';
import { ConfirmDialog, Dialog } from '@theia/core/lib/browser';
import { SaveWaypointInput } from './geocache-details-service';
import {
    GeocacheDto,
    GeocacheWaypoint,
    WaypointPrefillPayload
} from './geocache-details-types';
import {
    calculateAntipode,
    calculateProjection,
    parseFlexibleGCCoords,
    toGCFormat
} from './geocache-details-utils';

interface WaypointsEditorProps {
    waypoints?: GeocacheWaypoint[];
    geocacheData?: GeocacheDto;
    onSaveWaypoint: (waypointId: number | 'new' | undefined, payload: SaveWaypointInput) => Promise<number | undefined>;
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
        onRegisterCallback((prefill?: WaypointPrefillPayload) => {
            if (startEditRef.current) {
                startEditRef.current(undefined, prefill);
            }
        });
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
    const [calculatedCoordsLabel, setCalculatedCoordsLabel] = React.useState<string>('');
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [pendingAction, setPendingAction] = React.useState<{ waypointId: number; action: 'delete' | 'push' | 'correct' } | null>(null);
    const [showCalcTools, setShowCalcTools] = React.useState(false);
    const initialEditFormRef = React.useRef<Partial<GeocacheWaypoint>>({});

    const coordsError = React.useMemo(() => {
        const v = editForm.gc_coords?.trim();
        if (!v) { return null; }
        return parseFlexibleGCCoords(v) ? null : 'Format attendu : N 48° 51.402 E 002° 21.048';
    }, [editForm.gc_coords]);

    const startEdit = React.useCallback((waypoint?: GeocacheWaypoint, prefill?: WaypointPrefillPayload) => {
        let initialForm: Partial<GeocacheWaypoint>;
        if (waypoint) {
            initialForm = { ...waypoint };
            setEditingId(waypoint.id ?? null);
            setEditForm(initialForm);
        } else {
            initialForm = {
                prefix: '',
                lookup: '',
                name: prefill?.title || '',
                type: '',
                latitude: undefined,
                longitude: undefined,
                gc_coords: prefill?.coords || geocacheData?.coordinates_raw || '',
                note: prefill?.note || ''
            };
            setEditingId('new');
            setEditForm(initialForm);
        }
        initialEditFormRef.current = initialForm;
        setCalculatedCoords('');
        setCalculatedCoordsLabel('');
        setShowCalcTools(false);
    }, [geocacheData?.coordinates_raw]);

    React.useEffect(() => {
        onStartEditRef(startEdit);
    }, [startEdit, onStartEditRef]);

    const duplicateWaypoint = React.useCallback((waypoint: GeocacheWaypoint) => {
        const note = waypoint.note_override ?? waypoint.note;
        const initialForm: Partial<GeocacheWaypoint> = {
            prefix: waypoint.prefix,
            lookup: waypoint.lookup,
            name: waypoint.name ? `${waypoint.name} copy` : 'copy',
            type: waypoint.type,
            latitude: undefined,
            longitude: undefined,
            gc_coords: waypoint.gc_coords,
            note_override: note
        };
        initialEditFormRef.current = initialForm;
        setEditingId('new');
        setEditForm(initialForm);
        setCalculatedCoords('');
        setCalculatedCoordsLabel('');
        setShowCalcTools(false);
    }, []);

    const cancelEdit = React.useCallback(async () => {
        const isDirty = JSON.stringify(editForm) !== JSON.stringify(initialEditFormRef.current);
        if (isDirty) {
            const dialog = new ConfirmDialog({
                title: 'Abandonner les modifications',
                msg: 'Des modifications non sauvegardées seront perdues. Continuer ?',
                ok: 'Abandonner',
                cancel: Dialog.CANCEL
            });
            if (!await dialog.open()) {
                return;
            }
        }
        setEditingId(null);
        setEditForm({});
        setCalculatedCoords('');
        setCalculatedCoordsLabel('');
    }, [editForm]);

    const saveWaypoint = async (coordsOverride?: string): Promise<number | undefined> => {
        if (isSubmitting) { return undefined; }
        setIsSubmitting(true);
        try {
            const noteValue = (editForm.note_override ?? editForm.note) || '';
            const isNew = editingId === 'new' || editingId === null;
            const dataToSave: SaveWaypointInput = {
                prefix: editForm.prefix,
                lookup: editForm.lookup,
                name: editForm.name,
                type: editForm.type,
                gc_coords: coordsOverride ?? editForm.gc_coords,
                note_override: noteValue,
                ...(isNew ? { note: noteValue } : {})
            };
            const savedId = await onSaveWaypoint(editingId === null ? undefined : editingId, dataToSave);
            setEditingId(null);
            setEditForm({});
            setCalculatedCoords('');
            setCalculatedCoordsLabel('');
            return savedId;
        } catch (e) {
            console.error('[WaypointsEditor] ❌ Save waypoint error', e);
            return undefined;
        } finally {
            setIsSubmitting(false);
        }
    };

    const deleteWaypoint = React.useCallback(async (waypoint: GeocacheWaypoint) => {
        if (!waypoint.id || pendingAction) { return; }
        setPendingAction({ waypointId: waypoint.id, action: 'delete' });
        try {
            await onDeleteWaypoint(waypoint.id, waypoint.name || 'ce waypoint');
        } finally {
            setPendingAction(null);
        }
    }, [pendingAction, onDeleteWaypoint]);

    const setAsCorrectedCoords = React.useCallback(async (waypoint: GeocacheWaypoint) => {
        if (!waypoint.id || pendingAction) { return; }
        setPendingAction({ waypointId: waypoint.id, action: 'correct' });
        try {
            await onSetAsCorrectedCoords(waypoint.id, waypoint.name || 'ce waypoint');
        } finally {
            setPendingAction(null);
        }
    }, [pendingAction, onSetAsCorrectedCoords]);

    const pushWaypointToGeocaching = React.useCallback(async (waypoint: GeocacheWaypoint) => {
        if (!waypoint.id || pendingAction) { return; }
        setPendingAction({ waypointId: waypoint.id, action: 'push' });
        try {
            await onPushWaypointToGeocaching(waypoint.id, waypoint.name || 'ce waypoint');
        } finally {
            setPendingAction(null);
        }
    }, [pendingAction, onPushWaypointToGeocaching]);

    const setCurrentFormAsCorrectedCoords = async (coordsOverride?: string) => {
        const coords = coordsOverride ?? editForm.gc_coords;
        if (!coords) {
            messages.error('Veuillez saisir des coordonnées');
            return;
        }
        const waypointName = editForm.name || 'ce waypoint';
        const capturedEditingId = editingId;

        if (capturedEditingId === 'new') {
            const newId = await saveWaypoint(coordsOverride);
            if (newId !== undefined) {
                await onSetAsCorrectedCoords(newId, waypointName);
            } else {
                messages.warn('Waypoint sauvegardé. Cliquez sur 🎯 pour définir comme coordonnées corrigées.');
            }
        } else if (capturedEditingId !== null) {
            if (coordsOverride) {
                await saveWaypoint(coordsOverride);
            }
            await onSetAsCorrectedCoords(capturedEditingId as number, waypointName);
        }
    };

    const resolveCurrentCoords = (): { lat: number; lon: number } | null => {
        const parsed = parseFlexibleGCCoords(editForm.gc_coords);
        if (parsed) {
            return parsed;
        }
        if (editForm.latitude !== undefined && editForm.longitude !== undefined) {
            return { lat: editForm.latitude, lon: editForm.longitude };
        }
        return null;
    };

    const handleCalculateAntipode = () => {
        const coords = resolveCurrentCoords();
        if (!coords) {
            messages.error('Coordonnées invalides');
            return;
        }
        const antipode = calculateAntipode(coords.lat, coords.lon);
        const gcFormat = toGCFormat(antipode.lat, antipode.lon);
        setCalculatedCoords(`${gcFormat.gcLat} ${gcFormat.gcLon}`);
        setCalculatedCoordsLabel('Antipode');
    };

    const handleCalculateProjection = () => {
        const coords = resolveCurrentCoords();
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
        setCalculatedCoords(`${gcFormat.gcLat} ${gcFormat.gcLon}`);
        setCalculatedCoordsLabel(`Projection — ${projectionParams.distance} ${projectionParams.unit}, cap ${projectionParams.bearing}°`);
    };

    const applyCalculatedCoords = () => {
        if (!calculatedCoords) {
            return;
        }
        const parsed = parseFlexibleGCCoords(calculatedCoords);
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
                    title={editingId !== null ? 'Fermez le formulaire en cours avant d\'ajouter un waypoint' : undefined}
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
                            <label
                                style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 2 }}
                                title='Identifiant court du waypoint sur Geocaching.com (ex : GC001)'
                            >
                                Lookup
                            </label>
                            <input
                                type='text'
                                className='theia-input'
                                value={editForm.lookup || ''}
                                onChange={e => setEditForm({ ...editForm, lookup: e.target.value })}
                                placeholder='ex : GC001'
                                title='Identifiant court du waypoint sur Geocaching.com (ex : GC001)'
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
                            list='waypoint-type-options'
                            className='theia-input'
                            value={editForm.type || ''}
                            onChange={e => setEditForm({ ...editForm, type: e.target.value })}
                            placeholder='Sélectionner ou saisir un type'
                            style={{ width: '100%' }}
                        />
                        <datalist id='waypoint-type-options'>
                            <option value='Parking Area' />
                            <option value='Virtual Stage' />
                            <option value='Physical Stage' />
                            <option value='Final Location' />
                            <option value='Trailhead' />
                            <option value='Reference Point' />
                            <option value='Question to Answer' />
                        </datalist>
                    </div>
                    <div style={{ marginBottom: 8 }}>
                        <label style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 2 }}>Coordonnées (format GC)</label>
                        <input
                            type='text'
                            className='theia-input'
                            value={editForm.gc_coords || ''}
                            onChange={e => setEditForm({ ...editForm, gc_coords: e.target.value })}
                            placeholder='N 48° 51.402, E 002° 21.048'
                            style={{ width: '100%', borderColor: coordsError ? 'var(--theia-inputValidation-errorBorder)' : undefined }}
                        />
                        {coordsError && (
                            <div style={{ fontSize: 11, color: 'var(--theia-inputValidation-errorForeground)', marginTop: 2 }}>
                                {coordsError}
                            </div>
                        )}
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
                        <button
                            className='theia-button secondary'
                            onClick={() => setShowCalcTools(v => !v)}
                            style={{ fontSize: 12, padding: '2px 8px', marginBottom: showCalcTools ? 8 : 0 }}
                        >
                            {showCalcTools ? '▾' : '▸'} Outils de calcul
                        </button>
                        {showCalcTools && (
                            <>
                                <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 8 }}>
                                    Calcule à partir des coordonnées saisies ci-dessus.
                                </div>

                                {/* Antipode */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                                    <button
                                        className='theia-button secondary'
                                        onClick={handleCalculateAntipode}
                                        disabled={!!coordsError || !editForm.gc_coords}
                                        style={{ minWidth: 110 }}
                                    >
                                        Antipode
                                    </button>
                                    <span style={{ fontSize: 11, opacity: 0.6 }}>Point diamétralement opposé sur le globe</span>
                                </div>

                                {/* Projection */}
                                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 8 }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: 11, opacity: 0.8, marginBottom: 2 }}>Distance</label>
                                        <div style={{ display: 'flex', gap: 4 }}>
                                            <input
                                                type='number'
                                                className='theia-input'
                                                value={projectionParams.distance}
                                                onChange={e => setProjectionParams({ ...projectionParams, distance: Number(e.target.value) })}
                                                style={{ width: 80 }}
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
                                        </div>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: 11, opacity: 0.8, marginBottom: 2 }}>Cap (0–360°)</label>
                                        <input
                                            type='number'
                                            min={0}
                                            max={360}
                                            className='theia-input'
                                            value={projectionParams.bearing}
                                            onChange={e => setProjectionParams({ ...projectionParams, bearing: Number(e.target.value) })}
                                            style={{ width: 90 }}
                                        />
                                    </div>
                                    <button
                                        className='theia-button secondary'
                                        onClick={handleCalculateProjection}
                                        disabled={!!coordsError || !editForm.gc_coords}
                                        style={{ minWidth: 110 }}
                                    >
                                        Projeter
                                    </button>
                                </div>

                                {calculatedCoords && (
                                    <div style={{
                                        border: '1px solid var(--theia-panel-border)',
                                        borderRadius: 4,
                                        padding: 8,
                                        marginTop: 4,
                                        background: 'var(--theia-editorWidget-background)'
                                    }}>
                                        <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>
                                            Résultat du calcul {calculatedCoordsLabel && <strong>— {calculatedCoordsLabel}</strong>}
                                        </div>
                                        <code style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>{calculatedCoords}</code>
                                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                            <button className='theia-button' onClick={applyCalculatedCoords} title='Remplace les coordonnées du waypoint par ce résultat'>
                                                Appliquer au waypoint
                                            </button>
                                            <button className='theia-button secondary' onClick={() => { void setCurrentFormAsCorrectedCoords(calculatedCoords); }} title='Sauvegarde le waypoint et le définit comme coordonnées corrigées de la géocache'>
                                                Définir comme coordonnées corrigées
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                        <button className='theia-button' onClick={() => { void saveWaypoint(); }} disabled={isSubmitting}>
                            {isSubmitting ? 'Sauvegarde...' : 'Sauvegarder'}
                        </button>
                        <button className='theia-button secondary' onClick={() => { void cancelEdit(); }} disabled={isSubmitting}>Annuler</button>
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
                        {waypoints.map((w, i) => {
                            const note = w.note_override ?? w.note ?? '';
                            const noteDisplay = note.length > 80 ? note.slice(0, 80) + '…' : note;
                            const rowPending = w.id ? pendingAction?.waypointId === w.id ? pendingAction.action : null : null;
                            const isRowBusy = rowPending !== null;
                            const isGlobalBusy = editingId !== null || (pendingAction !== null && !isRowBusy);
                            return (
                                <tr key={w.id ?? i}>
                                    <td>{w.prefix || ''}</td>
                                    <td>{w.name || ''}</td>
                                    <td>{w.type || ''}</td>
                                    <td style={{ fontFamily: 'monospace' }}>{w.gc_coords || ''}</td>
                                    <td style={{ whiteSpace: 'pre-wrap', maxWidth: 200 }} title={note.length > 80 ? note : undefined}>{noteDisplay}</td>
                                    <td>
                                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                            <button
                                                className='theia-button secondary'
                                                onClick={() => startEdit(w)}
                                                disabled={editingId !== null || isRowBusy || isGlobalBusy}
                                                style={{ padding: '2px 8px', fontSize: 11 }}
                                                title='Éditer'
                                                aria-label='Éditer'
                                            >
                                                ✏️
                                            </button>
                                            <button
                                                className='theia-button secondary'
                                                onClick={() => duplicateWaypoint(w)}
                                                disabled={editingId !== null || isRowBusy || isGlobalBusy}
                                                style={{ padding: '2px 8px', fontSize: 11 }}
                                                title='Dupliquer'
                                                aria-label='Dupliquer'
                                            >
                                                📄
                                            </button>
                                            <button
                                                className='theia-button secondary'
                                                onClick={() => { void setAsCorrectedCoords(w); }}
                                                disabled={!w.id || isRowBusy || isGlobalBusy}
                                                style={{ padding: '2px 8px', fontSize: 11 }}
                                                title='Utiliser comme coordonnées corrigées'
                                                aria-label='Utiliser comme coordonnées corrigées'
                                            >
                                                {rowPending === 'correct' ? '⏳' : '🎯'}
                                            </button>
                                            <button
                                                className='theia-button secondary'
                                                onClick={() => { void pushWaypointToGeocaching(w); }}
                                                disabled={!w.id || isRowBusy || isGlobalBusy}
                                                style={{ padding: '2px 8px', fontSize: 11 }}
                                                title='Envoyer vers Geocaching.com'
                                                aria-label='Envoyer vers Geocaching.com'
                                            >
                                                {rowPending === 'push' ? '⏳' : '📡'}
                                            </button>
                                            <button
                                                className='theia-button secondary'
                                                onClick={() => { void deleteWaypoint(w); }}
                                                disabled={isRowBusy || isGlobalBusy}
                                                style={{ padding: '2px 8px', fontSize: 11 }}
                                                title='Supprimer'
                                                aria-label='Supprimer'
                                            >
                                                {rowPending === 'delete' ? '⏳' : '🗑️'}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            ) : undefined}
        </div>
    );
};
