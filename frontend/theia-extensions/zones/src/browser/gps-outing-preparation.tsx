/**
 * Panneau « Préparer la sortie » du widget Visites GPS : zone de la sortie,
 * récapitulatif de ce qui va se passer, ajout annulable.
 *
 * Composant de présentation : l'état et les appels au backend restent dans
 * `GpsVisitsWidget`. Voir documentation/garmin-visites-ameliorations-spec.md (lot 1).
 */

import * as React from '@theia/core/shared/react';
import { ZoneDto } from './zones-service';
import {
    GpsPreparation,
    GpsPreparationPlan,
    describePreparation,
    formatDayLabel,
    formatShortDay,
} from './gps-visits-model';

export interface OutingRunState {
    operationId: string;
    progress: number;
    message: string;
    counts?: { existing?: number; copied?: number; created?: number; from_gps?: number; errors?: number };
    errors: string[];
    cancelling: boolean;
}

export interface OutingPreparationState {
    visitIds: number[];
    preparation: GpsPreparation | undefined;
    loading: boolean;
    zones: ZoneDto[];
    /** Zone existante, ou 'new' pour en créer une. */
    zoneChoice: number | 'new';
    newZoneName: string;
    showDetail: boolean;
    run: OutingRunState | undefined;
    error: string | undefined;
}

export interface OutingPreparationPanelProps {
    state: OutingPreparationState;
    onZoneChange: (choice: number | 'new') => void;
    onNewZoneName: (name: string) => void;
    onToggleDetail: () => void;
    onConfirm: () => void;
    onCancelRun: () => void;
    onClose: () => void;
}

const PLAN_LABELS: Record<GpsPreparationPlan, string> = {
    existing: 'Déjà dans la zone',
    copy: 'Ajoutée (copie)',
    gps: 'Depuis le GPS',
    download: 'À télécharger',
};

function describeDays(days: string[]): string {
    if (days.length === 0) {
        return '';
    }
    if (days.length === 1) {
        return `du ${formatDayLabel(days[0])}`;
    }
    return `de ${days.length} jours (${days.map(formatShortDay).join(', ')})`;
}

export const OutingPreparationPanel: React.FC<OutingPreparationPanelProps> = props => {
    const { state } = props;
    const { preparation, run } = state;
    const running = run !== undefined;
    const newZone = state.zoneChoice === 'new';
    const lines = preparation ? describePreparation(preparation.counts, newZone) : [];
    const nothing = !!preparation && preparation.entries.length === 0;
    const canConfirm = !!preparation && !state.loading && !running && !nothing
        && (!newZone || state.newZoneName.trim().length > 0);
    const suggested = preparation?.suggested_zone_id ?? null;

    return (
        <div className='geoapp-gps-visits__cutoff geoapp-gps-outing'>
            <div className='geoapp-gps-visits__cutoff-title'>
                Préparer la sortie {preparation ? describeDays(preparation.days) : ''}
            </div>

            <label className='geoapp-gps-visits__cutoff-option'>
                Zone de la sortie :
                <select
                    className='theia-select'
                    value={String(state.zoneChoice)}
                    disabled={running}
                    onChange={e => props.onZoneChange(e.target.value === 'new' ? 'new' : Number(e.target.value))}
                >
                    <option value='new'>Nouvelle zone…</option>
                    {state.zones.map(zone => (
                        <option key={zone.id} value={zone.id}>
                            {zone.name}{zone.id === suggested ? ' (déjà utilisée pour ces jours)' : ''}
                        </option>
                    ))}
                </select>
                {newZone && (
                    <input
                        className='theia-input'
                        value={state.newZoneName}
                        disabled={running}
                        onChange={e => props.onNewZoneName(e.target.value)}
                    />
                )}
            </label>
            <div className='geoapp-gps-visits__cutoff-help'>
                Les caches sont <strong>ajoutées</strong> à cette zone : une cache déjà rangée ailleurs y est copiée
                et reste aussi dans sa zone.
            </div>

            {state.loading && <div className='geoapp-gps-visits__cutoff-help'>⏳ Calcul du récapitulatif…</div>}
            {state.error && <div className='geoapp-gps-visits__errors'>{state.error}</div>}
            {nothing && <div className='geoapp-gps-visits__cutoff-help'>Aucune cache à loguer dans cette sélection.</div>}
            {lines.length > 0 && (
                <ul className='geoapp-gps-outing__summary'>
                    {lines.map(line => <li key={line}>{line}</li>)}
                </ul>
            )}

            {preparation && preparation.entries.length + preparation.excluded.length > 0 && (
                <button className='geoapp-gps-outing__detail-toggle' onClick={props.onToggleDetail}>
                    {state.showDetail ? '▾ Masquer le détail' : '▸ Voir le détail'}
                </button>
            )}
            {preparation && state.showDetail && (
                <div className='geoapp-gps-outing__detail'>
                    {preparation.entries.map(entry => (
                        <div key={entry.key} className='geoapp-gps-outing__detail-row'>
                            <span className='geoapp-gps-visits__time'>{formatShortDay(entry.day)} {entry.time}</span>
                            <span className='geoapp-gps-visits__code'>{entry.gc_code}</span>
                            <span className='geoapp-gps-visits__name'>{entry.name ?? ''}</span>
                            <span className={`geoapp-gps-outing__plan is-${entry.plan}`}>{PLAN_LABELS[entry.plan]}</span>
                        </div>
                    ))}
                    {preparation.excluded.map(entry => (
                        <div key={entry.key} className='geoapp-gps-outing__detail-row is-excluded'>
                            <span className='geoapp-gps-visits__time'>{formatShortDay(entry.day)} {entry.time}</span>
                            <span className='geoapp-gps-visits__code'>{entry.gc_code ?? 'sans code'}</span>
                            <span className='geoapp-gps-visits__name'>{entry.name ?? ''}</span>
                            <span className='geoapp-gps-outing__plan'>
                                {entry.reason === 'without_code' ? 'Sans code : à rattacher' : 'Non tentée'}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {run && (
                <>
                    <div className='geoapp-gps-visits__progress'>
                        <progress max={100} value={run.progress} /> {run.message}
                    </div>
                    {run.counts && (
                        <div className='geoapp-gps-visits__cutoff-help'>
                            {run.counts.existing ?? 0} déjà dans la zone · {run.counts.copied ?? 0} ajoutée(s)
                            · {run.counts.from_gps ?? 0} créée(s) depuis le GPS
                            · {(run.counts.created ?? 0) - (run.counts.from_gps ?? 0)} téléchargée(s)
                            · {run.counts.errors ?? 0} erreur(s)
                        </div>
                    )}
                </>
            )}
            {run && run.errors.length > 0 && (
                <ul className='geoapp-gps-visits__errors'>
                    {run.errors.map(error => <li key={error}>{error}</li>)}
                </ul>
            )}

            <div className='geoapp-gps-visits__actions'>
                {!running && (
                    <button className='theia-button' disabled={!canConfirm} onClick={props.onConfirm}>
                        Ajouter à la zone et ouvrir l'éditeur de logs
                    </button>
                )}
                {running && (
                    <button className='theia-button secondary' disabled={run!.cancelling} onClick={props.onCancelRun}
                        title='Arrête après la cache en cours et retire les caches déjà ajoutées'>
                        {run!.cancelling ? 'Annulation…' : 'Annuler'}
                    </button>
                )}
                {!running && (
                    <button className='theia-button secondary' onClick={props.onClose}>Fermer</button>
                )}
            </div>
        </div>
    );
};
