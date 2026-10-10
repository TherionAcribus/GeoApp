/**
 * Section « Trackables » de la fiche de géocache : les TBs annoncés dans cette
 * cache (`GET /api/trackables/geocache/<GC>`).
 *
 * Affichage compact et repliable : icône, nom, code public (lien vers la fiche
 * du site), type et propriétaire. Le relevé automatique ne repart au site que
 * si la copie locale a plus de 15 minutes (`max_age`) ; « Rafraîchir » force la
 * relecture. Un relevé périmé ou servi en repli est toujours signalé.
 *
 * « Retirer / Découvrir » ouvrent le widget Trackables (lot 5) prérempli via
 * l'événement `open-trackables` — le formulaire demande alors le code de suivi.
 */

import * as React from 'react';
import '../../src/browser/style/geocache-trackables.css';
import { CollapsibleSectionProps, SectionTitle } from './geocache-section';
import { formatIsoDateTimeFr } from './log-editor/helpers';
import { InventoryTrackable, trackableUrl } from './log-editor/trackables';

export interface GeocacheTrackablesSectionProps extends CollapsibleSectionProps {
    gcCode: string;
    apiBaseUrl: string;
    /** Adopte la carte commune des sections de la fiche ; sinon, cadre compact (éditeur de logs). */
    card?: boolean;
}

interface CacheTrackablesState {
    loaded: boolean;
    loading: boolean;
    trackables: InventoryTrackable[];
    syncedAt: string | null;
    stale: boolean;
    error?: string;
    notice?: string;
}

const EMPTY_STATE: CacheTrackablesState = {
    loaded: false, loading: false, trackables: [], syncedAt: null, stale: false,
};

/** La copie locale est réinterrogée au-delà de cet âge — même politique que l'éditeur de logs. */
const CACHE_TRACKABLES_MAX_AGE_SECONDS = 900;

/** Ouvre le widget Trackables prérempli (écouté par ZonesFrontendContribution). */
function openTrackablesFor(action: 'retrieve' | 'discover', trackableCode: string, geocacheCode: string): void {
    window.dispatchEvent(new CustomEvent('open-trackables', {
        detail: { tab: 'log', action, trackableCode, geocacheCode },
    }));
}

export const GeocacheTrackablesSection: React.FC<GeocacheTrackablesSectionProps> = ({
    gcCode,
    apiBaseUrl,
    card,
    collapsed,
    onSectionCollapsedChange,
}) => {
    const [state, setState] = React.useState<CacheTrackablesState>(EMPTY_STATE);
    /** 0 = relevé automatique à l'ouverture ; >0 = « Rafraîchir » cliqué. */
    const [reloadToken, setReloadToken] = React.useState(0);

    React.useEffect(() => {
        let cancelled = false;
        // On conserve la liste affichée pendant une relecture : elle ne clignote pas.
        setState(prev => ({ ...prev, loading: true, error: undefined }));
        const query = reloadToken > 0 ? '?refresh=1' : `?max_age=${CACHE_TRACKABLES_MAX_AGE_SECONDS}`;
        fetch(`${apiBaseUrl}/api/trackables/geocache/${encodeURIComponent(gcCode)}${query}`, {
            credentials: 'include',
        })
            .then(async res => {
                const body = await res.json().catch(() => undefined);
                if (cancelled) {
                    return;
                }
                if (!res.ok || !body?.success) {
                    setState({
                        ...EMPTY_STATE,
                        loaded: true,
                        error: `Inventaire des trackables indisponible${body?.error_message ? ` : ${body.error_message}` : ''}.`,
                    });
                    return;
                }
                const trackables: InventoryTrackable[] = Array.isArray(body.trackables)
                    ? body.trackables.filter((tb: unknown): tb is InventoryTrackable =>
                        !!tb && typeof (tb as InventoryTrackable).reference_code === 'string')
                    : [];
                let notice: string | undefined;
                if (body.empty_remote_guarded === true) {
                    notice = 'Geocaching.com renvoie un relevé vide : la copie locale est conservée. '
                        + 'Cliquez « Rafraîchir » pour confirmer un relevé réellement vide.';
                } else if (typeof body.sync_error === 'string' && body.sync_error) {
                    notice = `Relecture impossible (${body.sync_error}) : copie locale affichée.`;
                }
                setState({
                    loaded: true,
                    loading: false,
                    trackables,
                    syncedAt: typeof body.synced_at === 'string' ? body.synced_at : null,
                    stale: body.stale === true,
                    notice,
                });
            })
            .catch(() => {
                if (!cancelled) {
                    setState({ ...EMPTY_STATE, loaded: true, error: 'Backend injoignable : relevé non chargé.' });
                }
            });
        return () => { cancelled = true; };
    }, [gcCode, apiBaseUrl, reloadToken]);

    const headline = state.loading && state.trackables.length === 0
        ? 'relevé en cours…'
        : state.trackables.length === 0
            ? 'aucun annoncé'
            : `${state.trackables.length} présent${state.trackables.length > 1 ? 's' : ''}`;

    return (
        <div className={card ? 'geoapp-gcd-section geoapp-gc-trackables' : 'geoapp-gc-trackables geoapp-gc-trackables--compact'}>
            <div className='geoapp-gc-trackables__header'>
                <SectionTitle
                    title='Trackables dans cette cache'
                    sectionId='trackables'
                    collapsed={collapsed}
                    onSectionCollapsedChange={onSectionCollapsedChange}
                />
                <span className='geoapp-gc-trackables__headline'>{headline}</span>
                {state.syncedAt && (
                    <span
                        className='geoapp-gc-trackables__sync'
                        title='Dernier relevé des trackables de cette cache sur Geocaching.com'
                    >
                        relevé le {formatIsoDateTimeFr(state.syncedAt)}{state.stale ? ' (périmé)' : ''}
                    </span>
                )}
                <button
                    type='button'
                    className='theia-button secondary geoapp-gc-trackables__refresh'
                    disabled={state.loading}
                    title='Relire les trackables de cette cache sur Geocaching.com'
                    onClick={() => setReloadToken(token => token + 1)}
                >
                    <span
                        className={state.loading ? 'codicon codicon-loading codicon-modifier-spin' : 'codicon codicon-refresh'}
                        aria-hidden='true'
                    />
                    {state.loading ? 'Relecture…' : 'Rafraîchir'}
                </button>
            </div>

            {state.error && <div className='geoapp-gc-trackables__error' role='alert'>{state.error}</div>}
            {!state.error && state.notice && (
                <div className='geoapp-gc-trackables__notice' role='status'>{state.notice}</div>
            )}
            {/* Région live : la fin du relevé annonce le résultat sans bruit visuel. */}
            <span className='geoapp-gc-visually-hidden' role='status'>
                {state.loading ? 'Relevé des trackables en cours…' : headline}
            </span>

            {!collapsed && !state.error && (
                state.trackables.length === 0
                    ? (state.loaded && !state.loading && (
                        <div className='geoapp-gc-trackables__empty'>
                            Aucun trackable annoncé dans cette cache.
                        </div>
                    ))
                    : (
                        <div className='geoapp-gc-trackables__list' role='list'>
                            {state.trackables.map(tb => (
                                <div key={tb.reference_code} className='geoapp-gc-trackables__row' role='listitem'>
                                    <TrackableIcon url={tb.icon_url} />
                                    <span
                                        className='geoapp-gc-trackables__name'
                                        title={[tb.name, tb.type_name].filter(Boolean).join(' — ') || undefined}
                                    >
                                        {tb.name || tb.reference_code}
                                    </span>
                                    <a
                                        className='geoapp-gc-trackables__code'
                                        href={trackableUrl(tb.reference_code)}
                                        target='_blank'
                                        rel='noopener noreferrer'
                                        title='Ouvrir la fiche sur Geocaching.com'
                                    >
                                        {tb.reference_code}
                                    </a>
                                    <span className='geoapp-gc-trackables__meta'>
                                        {[tb.type_name, tb.owner_username].filter(Boolean).join(' · ')}
                                    </span>
                                    <span className='geoapp-gc-trackables__row-actions'>
                                        <button
                                            type='button'
                                            className='theia-button secondary geoapp-gc-trackables__row-btn'
                                            title='Retirer ce trackable de la cache (widget Trackables)'
                                            onClick={() => openTrackablesFor('retrieve', tb.reference_code, gcCode)}
                                        >
                                            Retirer
                                        </button>
                                        <button
                                            type='button'
                                            className='theia-button secondary geoapp-gc-trackables__row-btn'
                                            title='Découvrir ce trackable (widget Trackables)'
                                            onClick={() => openTrackablesFor('discover', tb.reference_code, gcCode)}
                                        >
                                            Découvrir
                                        </button>
                                    </span>
                                </div>
                            ))}
                        </div>
                    )
            )}
        </div>
    );
};

/** Icône distante : chargée à la demande, dimensions fixes, repli sur la case vide. */
const TrackableIcon: React.FC<{ url: string | null | undefined }> = ({ url }) => {
    const [failed, setFailed] = React.useState(false);
    if (!url || failed) {
        return <span className='geoapp-gc-trackables__icon' />;
    }
    return (
        <img
            className='geoapp-gc-trackables__icon'
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
