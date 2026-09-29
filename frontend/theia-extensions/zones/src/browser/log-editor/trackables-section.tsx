/**
 * Section « Trackables » de l'éditeur de logs : les TBs de mon inventaire et ce
 * que chaque log du lot en fait (rien, visite, dépôt).
 *
 * Composant de présentation : l'état vit dans le widget, la logique de lot dans
 * `trackables.ts`. Repliée par défaut, elle annonce son bilan dans l'en-tête pour
 * qu'on n'ait pas à l'ouvrir quand rien n'est prévu.
 */

import * as React from '@theia/core/shared/react';
import { formatIsoDateTimeFr } from './helpers';
import {
    InventoryTrackable,
    TRACKABLE_ACTION_LABELS,
    TrackableAction,
    TrackableSelectionSummary,
    filterTrackables,
    trackableUrl,
} from './trackables';
import { GeocacheListItem } from './types';

export interface TrackablesSectionProps {
    inventory: InventoryTrackable[];
    actions: Record<string, TrackableAction>;
    /** Cible de dépôt effective par TB (déjà résolue par le widget). */
    dropTargets: Record<string, number | undefined>;
    /** Géocaches du lot qui peuvent recevoir un dépôt. */
    dropCandidates: GeocacheListItem[];
    summary: TrackableSelectionSummary;
    isOpen: boolean;
    isLoading: boolean;
    error?: string;
    lastSyncAt?: string | null;
    filter: string;
    disabled: boolean;
    onToggleOpen: () => void;
    onFilterChange: (value: string) => void;
    onActionChange: (code: string, action: TrackableAction) => void;
    onSetAll: (action: TrackableAction, codes: string[]) => void;
    onDropTargetChange: (code: string, geocacheId: number) => void;
    onRefresh: () => void;
}

/** Au-delà, le filtre apparaît : 70 TBs en main n'est pas rare. */
const FILTER_THRESHOLD = 8;

export const TrackablesSection: React.FC<TrackablesSectionProps> = props => {
    const {
        inventory, actions, dropTargets, dropCandidates, summary, isOpen, isLoading, error,
        lastSyncAt, filter, disabled,
    } = props;
    const visible = filterTrackables(inventory, filter);
    const headline = buildHeadline(inventory.length, summary, isLoading);

    return (
        <div className='geoapp-log-trackables'>
            <div className='geoapp-log-trackables__header'>
                <button
                    className='geoapp-log-trackables__toggle'
                    onClick={props.onToggleOpen}
                    aria-expanded={isOpen}
                    title={isOpen ? 'Replier les trackables' : 'Afficher les trackables de mon inventaire'}
                >
                    <i className={isOpen ? 'fa fa-chevron-down' : 'fa fa-chevron-right'} />
                    <strong>Trackables</strong>
                    <span className='geoapp-log-trackables__headline'>{headline}</span>
                </button>
                <button
                    className='theia-button secondary geoapp-log-button--icon'
                    onClick={props.onRefresh}
                    disabled={isLoading || disabled}
                    title={lastSyncAt
                        ? `Relire mon inventaire sur Geocaching.com (dernier relevé : ${formatIsoDateTimeFr(lastSyncAt)})`
                        : 'Relire mon inventaire sur Geocaching.com'}
                >
                    {isLoading ? '⏳' : '⟳'}
                </button>
            </div>

            {error && <div className='geoapp-log-trackables__error'>{error}</div>}

            {isOpen && !error && inventory.length === 0 && !isLoading && (
                <div className='geoapp-log-trackables__empty'>Aucun trackable dans votre inventaire.</div>
            )}

            {isOpen && inventory.length > 0 && (
                <>
                    <div className='geoapp-log-trackables__toolbar'>
                        {inventory.length > FILTER_THRESHOLD && (
                            <input
                                className='theia-input geoapp-log-trackables__filter'
                                type='search'
                                placeholder='Filtrer (code, nom, type)…'
                                value={filter}
                                onChange={e => props.onFilterChange(e.currentTarget.value)}
                            />
                        )}
                        <label className='geoapp-log-trackables__set-all'>
                            {filter ? `Mettre les ${visible.length} affichés à` : 'Tout mettre à'}
                            <select
                                className='theia-select'
                                value=''
                                disabled={disabled || visible.length === 0}
                                onChange={e => {
                                    const value = e.currentTarget.value as TrackableAction;
                                    if (value) {
                                        props.onSetAll(value, visible.map(tb => tb.reference_code));
                                    }
                                }}
                            >
                                <option value='' disabled>…</option>
                                <option value='none'>{TRACKABLE_ACTION_LABELS.none}</option>
                                <option value='visit'>{TRACKABLE_ACTION_LABELS.visit}</option>
                            </select>
                        </label>
                    </div>

                    <div className='geoapp-log-trackables__list' role='list'>
                        {visible.map(tb => (
                            <TrackableRow
                                key={tb.reference_code}
                                trackable={tb}
                                action={actions[tb.reference_code] ?? 'none'}
                                dropTarget={dropTargets[tb.reference_code]}
                                dropCandidates={dropCandidates}
                                disabled={disabled}
                                onActionChange={action => props.onActionChange(tb.reference_code, action)}
                                onDropTargetChange={id => props.onDropTargetChange(tb.reference_code, id)}
                            />
                        ))}
                        {visible.length === 0 && (
                            <div className='geoapp-log-trackables__empty'>Aucun trackable ne correspond au filtre.</div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

const TrackableRow: React.FC<{
    trackable: InventoryTrackable;
    action: TrackableAction;
    dropTarget: number | undefined;
    dropCandidates: GeocacheListItem[];
    disabled: boolean;
    onActionChange: (action: TrackableAction) => void;
    onDropTargetChange: (geocacheId: number) => void;
}> = ({ trackable, action, dropTarget, dropCandidates, disabled, onActionChange, onDropTargetChange }) => {
    const canDrop = dropCandidates.length > 0;
    return (
        <div className={`geoapp-log-trackables__row geoapp-log-trackables__row--${action}`} role='listitem'>
            {trackable.icon_url
                ? <img className='geoapp-log-trackables__icon' src={trackable.icon_url} alt='' />
                : <span className='geoapp-log-trackables__icon' />}
            <div className='geoapp-log-trackables__label'>
                <span className='geoapp-log-trackables__name' title={trackable.type_name ?? undefined}>
                    {trackable.name || trackable.reference_code}
                </span>
                <a
                    className='geoapp-log-trackables__code'
                    href={trackableUrl(trackable.reference_code)}
                    target='_blank'
                    rel='noopener noreferrer'
                    title='Ouvrir la fiche sur Geocaching.com'
                >
                    {trackable.reference_code}
                </a>
            </div>
            <select
                className='theia-select geoapp-log-trackables__action'
                value={action}
                disabled={disabled}
                onChange={e => onActionChange(e.currentTarget.value as TrackableAction)}
            >
                <option value='none'>{TRACKABLE_ACTION_LABELS.none}</option>
                <option value='visit'>{TRACKABLE_ACTION_LABELS.visit}</option>
                <option value='drop' disabled={!canDrop && action !== 'drop'}>
                    {TRACKABLE_ACTION_LABELS.drop}{canDrop ? '' : ' (aucune cache trouvée)'}
                </option>
            </select>
            {action === 'drop' && dropCandidates.length > 1 && (
                <select
                    className='theia-select geoapp-log-trackables__target'
                    value={dropTarget ?? ''}
                    disabled={disabled}
                    title='Géocache où déposer ce trackable'
                    onChange={e => onDropTargetChange(Number(e.currentTarget.value))}
                >
                    {dropCandidates.map(gc => (
                        <option key={gc.id} value={gc.id}>dans {gc.gc_code} — {gc.name}</option>
                    ))}
                </select>
            )}
            {action === 'drop' && dropCandidates.length === 1 && (
                <span className='geoapp-log-trackables__target-label'>dans {dropCandidates[0].gc_code}</span>
            )}
            {action === 'drop' && dropCandidates.length === 0 && (
                <span className='geoapp-log-trackables__target-label geoapp-log-trackables__target-label--error'>
                    aucune cache en « Found it » pour le recevoir
                </span>
            )}
        </div>
    );
};

function buildHeadline(total: number, summary: TrackableSelectionSummary, isLoading: boolean): string {
    if (isLoading && total === 0) {
        return 'chargement de l’inventaire…';
    }
    const parts = [`${total} en main`];
    if (summary.visitCount > 0) {
        parts.push(`${summary.visitCount} visité${summary.visitCount > 1 ? 's' : ''}`);
    }
    if (summary.drops.length > 0) {
        parts.push(`${summary.drops.length} déposé${summary.drops.length > 1 ? 's' : ''}`);
    }
    if (summary.visitCount === 0 && summary.drops.length === 0 && total > 0) {
        parts.push('aucune action');
    }
    return parts.join(' · ');
}
