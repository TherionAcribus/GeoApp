/**
 * Bandeau de portée du panneau Logs : quelle géocache il affiche, et comment en
 * changer.
 *
 * Le panneau est un panneau latéral : il survit aux onglets et n'a aucune raison
 * de suivre le premier plan — sauf si l'utilisateur l'a demandé. Les deux modes
 * de `geoApp.logs.panelSyncMode` posent donc la même question de deux façons, et
 * ce bandeau y répond au même endroit :
 *
 * - **sur demande** : les logs affichés peuvent ne pas être ceux de l'onglet
 *   au premier plan. Le dire, et proposer de rattraper ;
 * - **suivre l'onglet actif** : les logs suivent, mais on peut vouloir garder
 *   ceux d'une autre géocache ouverte. Le bandeau la propose, et signale que le
 *   suivi est suspendu tant qu'on y reste.
 */
import * as React from 'react';
import {
    describeGeocacheTab,
    GeocacheTabRef,
    LogsScopeInput,
    resolveLogsScope
} from './geocache-logs-scope';

export interface LogsScopeBannerProps extends LogsScopeInput {
    onShow: (ref: GeocacheTabRef) => void;
    onResumeFollow: () => void;
}

export const LogsScopeBanner: React.FC<LogsScopeBannerProps> = ({
    current, active, openTabs, following, followSuspended, onShow, onResumeFollow
}) => {
    const { mismatch, others, canResumeFollow, visible } = resolveLogsScope({
        current, active, openTabs, following, followSuspended
    });

    if (!visible) {
        return null;
    }

    const modifier = mismatch ? ' geoapp-logs-scope-banner--mismatch' : '';

    return (
        <div className={`geoapp-logs-scope-banner${modifier}`}>
            <div className='geoapp-logs-scope-banner__text'>
                <i className={`fa ${mismatch ? 'fa-exclamation-triangle' : 'fa-link'}`} />
                {mismatch ? (
                    <>
                        {current ? (
                            <>Ces logs sont ceux de <strong>{describeGeocacheTab(current)}</strong>, </>
                        ) : (
                            <>Aucun log affiché, </>
                        )}
                        la géocache au premier plan est <strong>{describeGeocacheTab(active!)}</strong>.
                    </>
                ) : canResumeFollow ? (
                    <>Suivi de l'onglet actif suspendu sur <strong>{describeGeocacheTab(current!)}</strong>.</>
                ) : following ? (
                    <>Le panneau suit l'onglet de géocache au premier plan.</>
                ) : (
                    <>Ces logs restent affichés même si vous changez d'onglet de géocache.</>
                )}
            </div>

            <div className='geoapp-logs-scope-banner__actions'>
                {mismatch && (
                    <button
                        className='geoapp-logs-scope-banner__button geoapp-logs-scope-banner__button--primary'
                        onClick={() => onShow(active!)}
                        title={`Afficher les logs de ${describeGeocacheTab(active!)}`}
                    >
                        <i className='fa fa-sync-alt' />
                        Afficher les logs de {describeGeocacheTab(active!)}
                    </button>
                )}

                {canResumeFollow && (
                    <button
                        className='geoapp-logs-scope-banner__button'
                        onClick={onResumeFollow}
                        title="Revenir au suivi automatique de l'onglet au premier plan"
                    >
                        <i className='fa fa-crosshairs' />
                        Reprendre le suivi
                    </button>
                )}

                {others.length > 0 && (
                    <label className='geoapp-logs-scope-banner__picker'>
                        Autre géocache ouverte
                        <select
                            value=''
                            onChange={event => {
                                const id = Number(event.target.value);
                                const ref = others.find(other => other.geocacheId === id);
                                if (ref) {
                                    onShow(ref);
                                }
                            }}
                        >
                            <option value=''>Choisir…</option>
                            {others.map(ref => (
                                <option key={ref.geocacheId} value={ref.geocacheId}>
                                    {describeGeocacheTab(ref)}
                                    {ref.gcCode && ref.name ? ` — ${ref.name}` : ''}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
            </div>
        </div>
    );
};
