/**
 * Section « Signaler un problème » de l'éditeur de logs : un signalement Needs
 * Maintenance / Needs Archived par cache, envoyé après le log principal.
 *
 * Composant de présentation : l'état et les callbacks viennent du widget.
 * Fonctionne en mode texte commun comme en mode texte par cache.
 */

import * as React from '@theia/core/shared/react';
import { getLogTypeLabel } from './helpers';
import { PROBLEM_CATEGORIES, getProblemCategory, problemCategoryRefusal } from './problem-report';
import { GeocacheListItem, LogTypeValue, ProblemCategory, ProblemReport, ProblemSubmitStatus } from './types';

export interface ProblemReportsSectionProps {
    geocaches: GeocacheListItem[];
    reports: Record<number, ProblemReport>;
    status: Record<number, ProblemSubmitStatus>;
    references: Record<number, string>;
    errors: Record<number, string | undefined>;
    /** Caches dont le type de log proposé par le GPS reste à confirmer. */
    pendingTypeConfirmation: Record<number, true>;
    getLogType: (geocacheId: number) => LogTypeValue;
    disabled: boolean;
    onAdd: (geocacheId: number) => void;
    onRemove: (geocacheId: number) => void;
    onChangeCategory: (geocacheId: number, category: ProblemCategory) => void;
    onChangeText: (geocacheId: number, text: string) => void;
    onConfirmType: (geocacheId: number) => void;
    /** « Vérifié sur Geocaching.com : il n'est pas parti » — autorise un nouvel envoi. */
    onRetryUncertain: (geocacheId: number) => void;
}

const STATUS_LABELS: Record<ProblemSubmitStatus, string> = {
    ok: '✅ Envoyé',
    failed: '⚠️ Échec',
    uncertain: '❓ À vérifier',
};

export const ProblemReportsSection: React.FC<ProblemReportsSectionProps> = props => {
    const {
        geocaches, reports, status, references, errors, pendingTypeConfirmation, getLogType, disabled,
        onAdd, onRemove, onChangeCategory, onChangeText, onConfirmType, onRetryUncertain,
    } = props;
    const [toAdd, setToAdd] = React.useState<string>('');

    const reported = geocaches.filter(gc => reports[gc.id] !== undefined);
    const available = geocaches.filter(gc => reports[gc.id] === undefined);
    const toConfirm = geocaches.filter(gc => pendingTypeConfirmation[gc.id]);

    return (
        <section className='geoapp-log-problems'>
            <div className='geoapp-log-problems__title'>
                ⚠️ Signaler un problème
                <span className='geoapp-log-problems__hint'>
                    Un second log « Needs Maintenance » ou « Needs Archived », public, qui prévient le propriétaire.
                </span>
            </div>

            {toConfirm.map(gc => (
                <div key={`confirm-${gc.id}`} className='geoapp-log-problems__confirm'>
                    <span>
                        <strong>{gc.gc_code}</strong> : le GPS a noté « Needs Maintenance » sans « Found it ».
                        Le log proposé est « {getLogTypeLabel(getLogType(gc.id))} » : vérifie-le dans le tableau.
                    </span>
                    <button className='theia-button secondary' disabled={disabled} onClick={() => onConfirmType(gc.id)}>
                        C'est bien ça
                    </button>
                </div>
            ))}

            {reported.map(gc => {
                const report = reports[gc.id];
                const sent = status[gc.id] === 'ok' || status[gc.id] === 'uncertain';
                const logType = getLogType(gc.id);
                return (
                    <div key={gc.id} className='geoapp-log-problems__row'>
                        <div className='geoapp-log-problems__row-head'>
                            <strong>{gc.gc_code}</strong>
                            <span className='geoapp-log-problems__name'>{gc.name}</span>
                            <select
                                className='theia-select'
                                value={report.category}
                                disabled={disabled || sent}
                                onChange={e => onChangeCategory(gc.id, e.target.value as ProblemCategory)}
                            >
                                {PROBLEM_CATEGORIES.map(category => {
                                    const refusal = problemCategoryRefusal(category.code, logType, gc.cache_type);
                                    return (
                                        <option key={category.code} value={category.code} disabled={!!refusal} title={refusal}>
                                            {category.label}{refusal ? ` (${refusal.toLowerCase()})` : ''}
                                        </option>
                                    );
                                })}
                            </select>
                            <span className='geoapp-log-problems__type'>{getProblemCategory(report.category).logTypeLabel}</span>
                            {status[gc.id] && (
                                <span
                                    className={`geoapp-log-problems__status is-${status[gc.id]}`}
                                    title={errors[gc.id] ?? (references[gc.id] ? `Log ${references[gc.id]}` : undefined)}
                                >
                                    {STATUS_LABELS[status[gc.id]]}
                                </span>
                            )}
                            {status[gc.id] === 'uncertain' && (
                                <button className='theia-button secondary' disabled={disabled}
                                    title={'À utiliser seulement après avoir vérifié sur la page de la cache que le signalement n\'existe pas'}
                                    onClick={() => onRetryUncertain(gc.id)}>
                                    Pas parti, renvoyer
                                </button>
                            )}
                            {!sent && (
                                <button className='theia-button secondary' disabled={disabled} onClick={() => onRemove(gc.id)}>
                                    Retirer
                                </button>
                            )}
                        </div>
                        <textarea
                            className='theia-input geoapp-log-problems__text'
                            rows={2}
                            value={report.text}
                            disabled={disabled || sent}
                            onChange={e => onChangeText(gc.id, e.target.value)}
                        />
                    </div>
                );
            })}

            {available.length > 0 && (
                <div className='geoapp-log-problems__add'>
                    <select className='theia-select' value={toAdd} disabled={disabled} onChange={e => setToAdd(e.target.value)}>
                        <option value=''>Ajouter un signalement pour…</option>
                        {available.map(gc => <option key={gc.id} value={gc.id}>{gc.gc_code} — {gc.name}</option>)}
                    </select>
                    <button
                        className='theia-button secondary'
                        disabled={disabled || !toAdd}
                        onClick={() => { onAdd(Number(toAdd)); setToAdd(''); }}
                    >
                        Ajouter
                    </button>
                </div>
            )}
        </section>
    );
};
