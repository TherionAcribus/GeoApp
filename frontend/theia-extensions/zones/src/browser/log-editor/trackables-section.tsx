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
    TRACKABLE_QUICK_FILTERS,
    TrackableAction,
    TrackableDropResult,
    TrackableQuickFilter,
    TrackableSelectionSummary,
    filterTrackables,
    quickFilterTrackables,
    trackableUrl,
} from './trackables';
import { GeocacheListItem } from './types';

export interface TrackablesSectionProps {
    inventory: InventoryTrackable[];
    actions: Record<string, TrackableAction>;
    /** Cible de dépôt effective par TB (déjà résolue par le widget). */
    dropTargets: Record<string, number | undefined>;
    /** Résultat des dépôts déjà partis (confirmed/uncertain) : filtre « En erreur » et badge. */
    dropResults: Record<string, TrackableDropResult>;
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
    quickFilter: TrackableQuickFilter;
    /** Bilan de la dernière action de masse, annulable tant qu'aucun autre choix n'a suivi. */
    bulkChange?: { count: number; action: TrackableAction };
    disabled: boolean;
    onToggleOpen: () => void;
    onFilterChange: (value: string) => void;
    onQuickFilterChange: (value: TrackableQuickFilter) => void;
    onActionChange: (code: string, action: TrackableAction) => void;
    onSetAll: (action: TrackableAction, codes: string[]) => void;
    onUndoBulk: () => void;
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
        inventory, actions, dropTargets, dropResults, dropCandidates, summary, isOpen, isLoading, error, notice,
        lastSyncAt, filter, quickFilter, bulkChange, disabled,
    } = props;
    const visible = filterTrackables(quickFilterTrackables(inventory, quickFilter, actions, dropResults), filter);
    const headline = buildHeadline(inventory.length, summary, isLoading);
    const isFiltered = quickFilter !== 'all' || filter.trim() !== '';

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

            {/* Bloquant : alerte immédiate. Le reste est annoncé poliment. */}
            {error && <div className='geoapp-log-trackables__error' role='alert'>{error}</div>}
            {!error && notice && <div className='geoapp-log-trackables__notice' role='status'>{notice}</div>}
            {!error && bulkChange && (
                <div className='geoapp-log-trackables__notice geoapp-log-trackables__notice--bulk' role='status'>
                    <span>
                        {bulkChange.count} ligne{bulkChange.count > 1 ? 's' : ''} mise{bulkChange.count > 1 ? 's' : ''}
                        {' '}à « {TRACKABLE_ACTION_LABELS[bulkChange.action]} »
                    </span>
                    <button
                        type='button'
                        className='theia-button secondary geoapp-log-button--small'
                        onClick={props.onUndoBulk}
                    >
                        Annuler
                    </button>
                </div>
            )}
            {/* Région live : le relevé en cours puis le bilan annoncent synchro et résultat. */}
            <span className='geoapp-visually-hidden' role='status'>
                {isLoading ? 'Relecture de l’inventaire en cours…' : headline}
            </span>

            {isOpen && !error && inventory.length === 0 && !isLoading && (
                <div className='geoapp-log-trackables__empty'>Aucun trackable dans votre inventaire.</div>
            )}

            {isOpen && inventory.length > 0 && (
                <>
                    <div className='geoapp-log-trackables__toolbar'>
                        <div className='geoapp-log-trackables__quick-filters' role='group' aria-label='Filtres rapides'>
                            {TRACKABLE_QUICK_FILTERS.map(qf => (
                                <button
                                    key={qf.value}
                                    type='button'
                                    className={'geoapp-log-trackables__chip'
                                        + (quickFilter === qf.value ? ' is-active' : '')}
                                    aria-pressed={quickFilter === qf.value}
                                    onClick={() => props.onQuickFilterChange(qf.value)}
                                >
                                    {qf.label}
                                </button>
                            ))}
                            {isFiltered && (
                                <span className='geoapp-log-trackables__count' aria-live='polite'>
                                    {visible.length} sur {inventory.length}
                                </span>
                            )}
                        </div>
                        {inventory.length > FILTER_THRESHOLD && (
                            <input
                                className='theia-input geoapp-log-trackables__filter'
                                type='search'
                                placeholder='Filtrer (code, nom, type)…'
                                aria-label='Filtrer les trackables'
                                value={filter}
                                onChange={e => props.onFilterChange(e.currentTarget.value)}
                            />
                        )}
                        <label className='geoapp-log-trackables__set-all'>
                            {isFiltered ? `Mettre les ${visible.length} affichés à` : 'Tout mettre à'}
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
                                dropResult={dropResults[tb.reference_code]}
                                dropTarget={dropTargets[tb.reference_code]}
                                dropCandidates={dropCandidates}
                                disabled={disabled}
                                onActionChange={action => props.onActionChange(tb.reference_code, action)}
                                onDropTargetChange={id => props.onDropTargetChange(tb.reference_code, id)}
                            />
                        ))}
                        {visible.length === 0 && (
                            <div className='geoapp-log-trackables__empty'>Aucun trackable ne correspond aux filtres.</div>
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
    dropResult: TrackableDropResult | undefined;
    dropTarget: number | undefined;
    dropCandidates: GeocacheListItem[];
    disabled: boolean;
    onActionChange: (action: TrackableAction) => void;
    onDropTargetChange: (geocacheId: number) => void;
}> = ({ trackable, action, dropResult, dropTarget, dropCandidates, disabled, onActionChange, onDropTargetChange }) => {
    const canDrop = dropCandidates.length > 0;
    const label = trackable.name || trackable.reference_code;
    /**
     * Clavier attendu d'un groupe radio : les flèches (et Home/End) déplacent le
     * choix *et* le focus, un seul bouton du groupe est atteignable par Tab
     * (roving tabindex sur le bouton coché).
     */
    const onActionsKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
        const enabled = TRACKABLE_ACTION_ORDER.filter(v => !(v === 'drop' && !canDrop && action !== 'drop'));
        const current = enabled.indexOf(action);
        let next: TrackableAction | undefined;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            next = enabled[(current + 1) % enabled.length];
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            next = enabled[(current - 1 + enabled.length) % enabled.length];
        } else if (e.key === 'Home') {
            next = enabled[0];
        } else if (e.key === 'End') {
            next = enabled[enabled.length - 1];
        } else {
            return;
        }
        e.preventDefault();
        if (next !== action) {
            onActionChange(next);
        }
        // Les boutons survivent au re-rendu (même key React) : le focus peut être
        // déplacé tout de suite, le roving tabindex suivra.
        e.currentTarget.querySelector<HTMLElement>(`[data-action="${next}"]`)?.focus();
    };
    return (
        <div className={`geoapp-log-trackables__row geoapp-log-trackables__row--${action}`} role='listitem'>
            {/*
              L'action est en tête de ligne, collée au nom : un menu déroulant rejeté à droite
              d'une ligne large ne se rattachait plus à son TB à l'œil.
            */}
            <div
                className='geoapp-log-trackables__actions'
                role='radiogroup'
                aria-label={`Action pour ${label}`}
                onKeyDown={onActionsKeyDown}
            >
                {TRACKABLE_ACTION_ORDER.map(value => {
                    const unavailable = value === 'drop' && !canDrop && action !== 'drop';
                    return (
                        <button
                            key={value}
                            type='button'
                            role='radio'
                            aria-checked={action === value}
                            data-action={value}
                            tabIndex={disabled || unavailable ? undefined : (action === value ? 0 : -1)}
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
            <TrackableIcon url={trackable.icon_url} />
            <div className='geoapp-log-trackables__label'>
                {/* Le nom peut être ellipsé : l'infobulle le restitue en entier, avec son type. */}
                <span
                    className='geoapp-log-trackables__name'
                    title={[trackable.name, trackable.type_name].filter(Boolean).join(' — ') || undefined}
                >
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
                {dropResult === 'uncertain' && (
                    <span
                        className='geoapp-log-trackables__row-badge'
                        title='Le site n’a pas confirmé ce dépôt : vérifiez la fiche du trackable sur Geocaching.com'
                    >
                        dépôt à vérifier
                    </span>
                )}
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

/**
 * Icône distante d'une ligne : chargée à la demande (`lazy`), décodée hors
 * thread, dimensions fixes pour ne pas faire sauter la liste, et repli sur la
 * case vide si l'image est injoignable.
 */
const TrackableIcon: React.FC<{ url: string | null | undefined }> = ({ url }) => {
    const [failed, setFailed] = React.useState(false);
    if (!url || failed) {
        return <span className='geoapp-log-trackables__icon' />;
    }
    return (
        <img
            className='geoapp-log-trackables__icon'
            src={url}
            alt=''
            loading='lazy'
            decoding='async'
            width={16}
            height={16}
            onError={() => setFailed(true)}
        />
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
