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
    /** Avertissement non bloquant (relevé automatique raté, liste locale affichée). */
    notice?: string;
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

/** Ordre des boutons d'action d'une ligne. */
const TRACKABLE_ACTION_ORDER: readonly TrackableAction[] = ['none', 'visit', 'drop'];

/** Libellés courts des boutons : la ligne doit rester lisible sur un panneau étroit. */
const TRACKABLE_ACTION_SHORT_LABELS: Record<TrackableAction, string> = {
    none: 'Rien',
    visit: 'Visité',
    drop: 'Déposé',
};

/** Au-delà, le filtre apparaît : 70 TBs en main n'est pas rare. */
const FILTER_THRESHOLD = 8;

export const TrackablesSection: React.FC<TrackablesSectionProps> = props => {
    const {
        inventory, actions, dropTargets, dropCandidates, summary, isOpen, isLoading, error, notice,
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
                {lastSyncAt && (
                    <span className='geoapp-log-trackables__sync' title='Dernier relevé de l’inventaire sur Geocaching.com'>
                        relevé le {formatIsoDateTimeFr(lastSyncAt)}
                    </span>
                )}
                {/* Jamais grisé par l'envoi : c'est après un lot qu'on a besoin de relire. */}
                <button
                    className='theia-button secondary geoapp-log-button--small'
                    onClick={props.onRefresh}
                    disabled={isLoading}
                    title='Relire mon inventaire sur Geocaching.com (TB pris ou déposé ailleurs, sur le site ou dans une appli)'
                >
                    {isLoading ? '⏳ Relecture…' : '⟳ Rafraîchir'}
                </button>
            </div>

            {error && <div className='geoapp-log-trackables__error'>{error}</div>}
            {!error && notice && <div className='geoapp-log-trackables__notice'>{notice}</div>}

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
                                {/* Dépôt groupé : chacun part dans la dernière cache trouvée, modifiable ligne par ligne. */}
                                <option value='drop' disabled={dropCandidates.length === 0}>
                                    {dropCandidates.length === 0
                                        ? `${TRACKABLE_ACTION_LABELS.drop} (aucune cache en « Found it »)`
                                        : dropCandidates.length === 1
                                            ? `${TRACKABLE_ACTION_LABELS.drop} dans ${dropCandidates[0].gc_code}`
                                            : `${TRACKABLE_ACTION_LABELS.drop} (dans ${dropCandidates[dropCandidates.length - 1].gc_code} par défaut)`}
                                </option>
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
    const label = trackable.name || trackable.reference_code;
    return (
        <div className={`geoapp-log-trackables__row geoapp-log-trackables__row--${action}`} role='listitem'>
            {/*
              L'action est en tête de ligne, collée au nom : un menu déroulant rejeté à droite
              d'une ligne large ne se rattachait plus à son TB à l'œil.
            */}
            <div className='geoapp-log-trackables__actions' role='radiogroup' aria-label={`Action pour ${label}`}>
                {TRACKABLE_ACTION_ORDER.map(value => {
                    const unavailable = value === 'drop' && !canDrop && action !== 'drop';
                    return (
                        <button
                            key={value}
                            type='button'
                            role='radio'
                            aria-checked={action === value}
                            className={`geoapp-log-trackables__action-btn geoapp-log-trackables__action-btn--${value}`
                                + (action === value ? ' is-active' : '')}
                            disabled={disabled || unavailable}
                            title={unavailable
                                ? 'Aucune géocache du lot en « Found it » pour recevoir ce trackable'
                                : `${TRACKABLE_ACTION_LABELS[value]} : ${label} (${trackable.reference_code})`}
                            onClick={() => onActionChange(value)}
                        >
                            {TRACKABLE_ACTION_SHORT_LABELS[value]}
                        </button>
                    );
                })}
            </div>
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
