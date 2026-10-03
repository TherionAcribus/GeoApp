/**
 * Panneau « Rattacher les visites sans code du jour » du widget Visites GPS.
 *
 * Le backend propose une cache par visite d'après sa position sur la trace
 * (`POST /api/gps-visits/day-resolution`). Une proposition trouvée ce jour-là est
 * cochée d'office ; les autres (jour proche, autre jour) attendent un choix explicite.
 * Composant de présentation : l'état et les appels restent dans `GpsVisitsWidget`.
 */

import * as React from '@theia/core/shared/react';
import {
    GpsDayResolution,
    GpsResolutionCandidate,
    describeCandidateDay,
    defaultDayChoices,
    formatDayLabel,
    formatDistance,
    summarizeDayResolution,
} from './gps-visits-model';

export interface DayResolutionState {
    day: string;
    loading: boolean;
    result: GpsDayResolution | undefined;
    error: string | undefined;
    /** Visite → code GC choisi ('' : ne pas rattacher). */
    choices: Record<number, string>;
    applying: boolean;
}

export { defaultDayChoices };

export interface DayResolutionPanelProps {
    state: DayResolutionState;
    onChoose: (visitId: number, gcCode: string) => void;
    onApply: () => void;
    onClose: () => void;
}

function optionLabel(candidate: GpsResolutionCandidate, proposed: boolean): string {
    const distance = formatDistance(candidate.distance_m);
    return `${proposed ? '★ ' : ''}${candidate.gc_code} — ${candidate.name ?? ''}${distance ? ` — ${distance}` : ''}`
        + ` — ${describeCandidateDay(candidate).label}`;
}

export const DayResolutionPanel: React.FC<DayResolutionPanelProps> = ({ state, onChoose, onApply, onClose }) => {
    const { result } = state;
    const chosen = result ? result.visits.filter(visit => state.choices[visit.visit_id]).length : 0;
    return (
        <div className='geoapp-gps-visits__cutoff geoapp-gps-day-resolution'>
            <div className='geoapp-gps-visits__cutoff-title'>
                Rattacher les visites sans code du {formatDayLabel(state.day)}
            </div>
            {state.loading && (
                <div className='geoapp-gps-visits__cutoff-help'>
                    ⏳ Recherche des caches autour de la trace du jour… (jusqu'à une minute : Geocaching.com limite le rythme)
                </div>
            )}
            {state.error && <div className='geoapp-gps-visits__errors'>{state.error}</div>}
            {result && (
                <>
                    <div className='geoapp-gps-visits__cutoff-help'>
                        {summarizeDayResolution(result)}. {result.candidates} cache(s) examinée(s) autour de la trace.
                        {result.unpositioned ? ` ${result.unpositioned} visite(s) sans position (pas de trace) : à rattacher une par une.` : ''}
                        {' '}★ : proposition. Les caches trouvées un autre jour ne sont pas cochées d'office.
                    </div>
                    <div className='geoapp-gps-day-resolution__rows'>
                        {result.visits.map(visit => {
                            const options = [visit.proposal, ...visit.alternatives].filter((c): c is GpsResolutionCandidate => !!c);
                            const current = state.choices[visit.visit_id] ?? '';
                            const selected = options.find(option => option.gc_code === current);
                            return (
                                <div key={visit.visit_id} className='geoapp-gps-day-resolution__row'>
                                    <span className='geoapp-gps-visits__time'>{visit.time}</span>
                                    <select
                                        className='theia-select'
                                        value={current}
                                        disabled={state.applying || options.length === 0}
                                        onChange={e => onChoose(visit.visit_id, e.target.value)}
                                    >
                                        <option value=''>{options.length === 0 ? '— aucune cache trouvée autour —' : '— ne pas rattacher —'}</option>
                                        {options.map(option => (
                                            <option key={option.gc_code} value={option.gc_code}>
                                                {optionLabel(option, option === visit.proposal)}
                                            </option>
                                        ))}
                                    </select>
                                    {selected && (
                                        <span className={`geoapp-gps-visits__day-badge is-${describeCandidateDay(selected).kind}`}>
                                            {describeCandidateDay(selected).label}
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </>
            )}
            <div className='geoapp-gps-visits__actions'>
                <button className='theia-button' disabled={!result || chosen === 0 || state.applying} onClick={onApply}>
                    {state.applying ? 'Rattachement…' : `Rattacher ${chosen} visite${chosen > 1 ? 's' : ''}`}
                </button>
                <button className='theia-button secondary' disabled={state.applying} onClick={onClose}>Fermer</button>
            </div>
        </div>
    );
};
