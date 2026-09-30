/**
 * Widget « Trackables » (lot 5 de la spec) : trois onglets.
 *
 * - **Inventaire** : mon inventaire (`GET /api/trackables/inventory`), recherche,
 *   date du relevé, état périmé, « Rafraîchir », ouverture de la fiche et action
 *   rapide « Loguer » (qui préremplit l'onglet Loguer).
 * - **Loguer / Découvrir** : prévu pour le collage multi-codes, l'aperçu par
 *   lookup et la file d'envoi — arrive avec la suite du lot.
 * - **Fiche** : détails assainis du TB et logs paginés — arrive avec la suite.
 *
 * Ouverture : commande `geoapp.trackables.open` ou événement `open-trackables`
 * avec `{ tab, trackableCode, action, geocacheCode }` — la fiche de cache du
 * lot 4 préremplira l'onglet Loguer (« Retirer » / « Découvrir »).
 */

import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core';
import '../../src/browser/style/trackables-widget.css';
import { formatIsoDateTimeFr } from './log-editor/helpers';
import {
    InventoryTrackable,
    describeInventorySync,
    filterTrackables,
    trackableUrl,
} from './log-editor/trackables';

export type TrackablesWidgetTab = 'inventory' | 'log' | 'detail';

/** Préremplissage à l'ouverture : l'onglet visé, le TB, l'action et la cache d'origine. */
export interface TrackablesWidgetContext {
    tab?: TrackablesWidgetTab;
    /** Code public TB… (ou code de suivi, transmis tel quel au backend, jamais affiché). */
    trackableCode?: string;
    /** Action du lot 4 : retirer ou découvrir le TB dans une cache. */
    action?: 'retrieve' | 'discover' | 'log';
    geocacheCode?: string;
}

const TRACKABLES_WIDGET_TABS: readonly { id: TrackablesWidgetTab; label: string }[] = [
    { id: 'inventory', label: 'Inventaire' },
    { id: 'log', label: 'Loguer / Découvrir' },
    { id: 'detail', label: 'Fiche' },
];

/** La copie locale est réinterrogée au-delà de cet âge — même politique que l'éditeur. */
const TRACKABLE_INVENTORY_MAX_AGE_SECONDS = 900;

interface InventoryState {
    loading: boolean;
    loaded: boolean;
    trackables: InventoryTrackable[];
    lastSyncAt: string | null;
    stale: boolean;
    error?: string;
    notice?: string;
}

const EMPTY_INVENTORY: InventoryState = {
    loading: false, loaded: false, trackables: [], lastSyncAt: null, stale: false,
};

@injectable()
export class TrackablesWidget extends ReactWidget {
    static readonly ID = 'geoapp-trackables-widget';

    protected backendBaseUrl = 'http://localhost:8000';
    protected activeTab: TrackablesWidgetTab = 'inventory';
    protected inventory: InventoryState = { ...EMPTY_INVENTORY };
    protected inventoryFilter = '';
    /** Préremplissage des onglets à venir (lot 5.2 / 5.3 et actions du lot 4). */
    protected pendingLogContext: { code: string; action?: string; geocacheCode?: string } | undefined;
    protected pendingDetailCode: string | undefined;

    constructor(
        @inject(MessageService) protected readonly messages: MessageService,
    ) {
        super();
        this.id = TrackablesWidget.ID;
        this.title.label = 'Trackables';
        this.title.caption = 'Trackables (travel bugs)';
        this.title.closable = true;
        this.title.iconClass = 'fa fa-bug';
        this.addClass('theia-trackables-widget');
    }

    /** Contexte d'ouverture : onglet + préremplissage (fiche cache du lot 4, file externe). */
    setContext(ctx: TrackablesWidgetContext): void {
        if (ctx.trackableCode && (ctx.tab === 'log' || ctx.tab === 'detail')) {
            if (ctx.tab === 'log') {
                this.pendingLogContext = { code: ctx.trackableCode, action: ctx.action, geocacheCode: ctx.geocacheCode };
            } else {
                this.pendingDetailCode = ctx.trackableCode;
            }
        }
        if (ctx.tab) {
            this.activeTab = ctx.tab;
        }
        if (!this.inventory.loaded && !this.inventory.loading) {
            void this.loadInventory('auto');
        }
        this.update();
    }

    showTab(tab: TrackablesWidgetTab): void {
        this.activeTab = tab;
        if (tab === 'inventory' && !this.inventory.loaded && !this.inventory.loading) {
            void this.loadInventory('auto');
        }
        this.update();
    }

    protected async loadInventory(mode: 'auto' | 'refresh'): Promise<void> {
        if (this.inventory.loading) {
            return;
        }
        this.inventory = { ...this.inventory, loading: true, error: undefined };
        this.update();
        const query = mode === 'refresh' ? '?refresh=1' : `?max_age=${TRACKABLE_INVENTORY_MAX_AGE_SECONDS}`;
        try {
            const res = await fetch(`${this.backendBaseUrl}/api/trackables/inventory${query}`, {
                credentials: 'include',
            });
            const body = await res.json().catch(() => undefined);
            if (!res.ok || !body?.success) {
                this.inventory = {
                    ...EMPTY_INVENTORY,
                    loaded: true,
                    error: res.status === 401
                        ? 'Connectez-vous à Geocaching.com pour charger votre inventaire.'
                        : `Inventaire indisponible${body?.error_message ? ` : ${body.error_message}` : ''}.`,
                };
            } else {
                const trackables: InventoryTrackable[] = Array.isArray(body.trackables)
                    ? body.trackables.filter((tb: unknown): tb is InventoryTrackable =>
                        !!tb && typeof (tb as InventoryTrackable).reference_code === 'string')
                    : [];
                let notice: string | undefined;
                if (body.empty_remote_guarded === true) {
                    notice = 'Geocaching.com renvoie un inventaire vide : la copie locale est conservée. '
                        + 'Cliquez « Rafraîchir » pour confirmer un inventaire réellement vide.';
                } else if (typeof body.sync_error === 'string' && body.sync_error) {
                    notice = `Relecture impossible (${body.sync_error}) : copie locale affichée.`;
                }
                this.inventory = {
                    loading: false,
                    loaded: true,
                    trackables,
                    lastSyncAt: typeof body.last_sync_at === 'string' ? body.last_sync_at : null,
                    stale: body.stale === true,
                    notice,
                };
                if (mode === 'refresh') {
                    this.messages.info(describeInventorySync(body.sync));
                }
            }
        } catch (e) {
            console.error('[TrackablesWidget] loadInventory error', e);
            this.inventory = { ...EMPTY_INVENTORY, loaded: true, error: 'Backend injoignable : inventaire non chargé.' };
        } finally {
            this.inventory.loading = false;
            this.update();
        }
    }

    protected render(): React.ReactNode {
        return (
            <div className='geoapp-trackables-widget'>
                <div className='geoapp-trackables-widget__tabs' role='tablist'>
                    {TRACKABLES_WIDGET_TABS.map(tab => (
                        <button
                            key={tab.id}
                            type='button'
                            role='tab'
                            aria-selected={this.activeTab === tab.id}
                            className={'geoapp-trackables-widget__tab'
                                + (this.activeTab === tab.id ? ' is-active' : '')}
                            onClick={() => this.showTab(tab.id)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
                {this.activeTab === 'inventory' && this.renderInventoryTab()}
                {this.activeTab === 'log' && this.renderLogTab()}
                {this.activeTab === 'detail' && this.renderDetailTab()}
            </div>
        );
    }

    protected renderInventoryTab(): React.ReactNode {
        const inv = this.inventory;
        const visible = filterTrackables(inv.trackables, this.inventoryFilter);
        return (
            <div className='geoapp-trackables-widget__panel' role='tabpanel'>
                <div className='geoapp-trackables-widget__toolbar'>
                    <input
                        className='theia-input geoapp-trackables-widget__filter'
                        type='search'
                        placeholder='Rechercher (code, nom, type, propriétaire)…'
                        aria-label='Rechercher un trackable'
                        value={this.inventoryFilter}
                        onChange={e => { this.inventoryFilter = e.currentTarget.value; this.update(); }}
                    />
                    {inv.lastSyncAt && (
                        <span
                            className='geoapp-trackables-widget__sync'
                            title='Dernier relevé de l’inventaire sur Geocaching.com'
                        >
                            relevé le {formatIsoDateTimeFr(inv.lastSyncAt)}{inv.stale ? ' (périmé)' : ''}
                        </span>
                    )}
                    <button
                        type='button'
                        className='theia-button secondary'
                        disabled={inv.loading}
                        title='Relire mon inventaire sur Geocaching.com'
                        onClick={() => { void this.loadInventory('refresh'); }}
                    >
                        {inv.loading ? '⏳ Relecture…' : '⟳ Rafraîchir'}
                    </button>
                </div>

                {inv.error && <div className='geoapp-trackables-widget__error' role='alert'>{inv.error}</div>}
                {!inv.error && inv.notice && (
                    <div className='geoapp-trackables-widget__notice' role='status'>{inv.notice}</div>
                )}
                <span className='geoapp-trackables-widget__visually-hidden' role='status'>
                    {inv.loading ? 'Relecture de l’inventaire en cours…'
                        : `${inv.trackables.length} trackable(s) dans l’inventaire`}
                </span>

                {!inv.error && inv.loaded && !inv.loading && inv.trackables.length === 0 && (
                    <div className='geoapp-trackables-widget__empty'>Aucun trackable dans votre inventaire.</div>
                )}

                {inv.trackables.length > 0 && (
                    <>
                        {this.inventoryFilter && (
                            <div className='geoapp-trackables-widget__count' aria-live='polite'>
                                {visible.length} sur {inv.trackables.length}
                            </div>
                        )}
                        <div className='geoapp-trackables-widget__list' role='list'>
                            {visible.map(tb => (
                                <TrackableInventoryRow
                                    key={tb.reference_code}
                                    trackable={tb}
                                    onShowDetail={code => {
                                        this.pendingDetailCode = code;
                                        this.showTab('detail');
                                    }}
                                    onLog={code => {
                                        this.pendingLogContext = { code, action: 'log' };
                                        this.showTab('log');
                                    }}
                                />
                            ))}
                            {visible.length === 0 && (
                                <div className='geoapp-trackables-widget__empty'>
                                    Aucun trackable ne correspond à la recherche.
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        );
    }

    /** Onglet « Loguer / Découvrir » : la file arrive avec le lot 5.2 — le contexte prérempli est déjà honoré. */
    protected renderLogTab(): React.ReactNode {
        const ctx = this.pendingLogContext;
        return (
            <div className='geoapp-trackables-widget__panel' role='tabpanel'>
                {ctx && (
                    <div className='geoapp-trackables-widget__notice' role='status'>
                        Prérempli : {ctx.action === 'retrieve' ? 'retirer' : ctx.action === 'discover' ? 'découvrir' : 'loguer'}
                        {' '}le trackable {ctx.code}
                        {ctx.geocacheCode ? ` depuis ${ctx.geocacheCode}` : ''}.
                    </div>
                )}
                <div className='geoapp-trackables-widget__empty'>
                    La saisie multi-codes, l’aperçu par lookup et la file d’envoi arrivent avec la suite du lot.
                </div>
            </div>
        );
    }

    /** Onglet « Fiche » : détails assainis + logs paginés au lot 5.3. */
    protected renderDetailTab(): React.ReactNode {
        const code = this.pendingDetailCode;
        return (
            <div className='geoapp-trackables-widget__panel' role='tabpanel'>
                {code
                    ? (
                        <div className='geoapp-trackables-widget__notice' role='status'>
                            Fiche {code} —{' '}
                            <a href={trackableUrl(code)} target='_blank' rel='noopener noreferrer'>
                                ouvrir sur Geocaching.com
                            </a>
                            . Le détail assaini arrive avec la suite du lot.
                        </div>
                    )
                    : (
                        <div className='geoapp-trackables-widget__empty'>
                            Ouvrez une fiche depuis l’inventaire (bouton « Fiche » d’une ligne).
                        </div>
                    )}
            </div>
        );
    }
}

/** Ligne d'inventaire : identité compacte + actions « Fiche » et « Loguer ». */
const TrackableInventoryRow: React.FC<{
    trackable: InventoryTrackable;
    onShowDetail: (code: string) => void;
    onLog: (code: string) => void;
}> = ({ trackable, onShowDetail, onLog }) => {
    const [iconFailed, setIconFailed] = React.useState(false);
    return (
        <div className='geoapp-trackables-widget__row' role='listitem'>
            {trackable.icon_url && !iconFailed ? (
                <img
                    className='geoapp-trackables-widget__icon'
                    src={trackable.icon_url}
                    alt=''
                    loading='lazy'
                    decoding='async'
                    width={16}
                    height={16}
                    onError={() => setIconFailed(true)}
                />
            ) : (
                <span className='geoapp-trackables-widget__icon' />
            )}
            <span
                className='geoapp-trackables-widget__name'
                title={[trackable.name, trackable.type_name].filter(Boolean).join(' — ') || undefined}
            >
                {trackable.name || trackable.reference_code}
            </span>
            <a
                className='geoapp-trackables-widget__code'
                href={trackableUrl(trackable.reference_code)}
                target='_blank'
                rel='noopener noreferrer'
                title='Ouvrir la fiche sur Geocaching.com'
            >
                {trackable.reference_code}
            </a>
            <span className='geoapp-trackables-widget__meta'>
                {[trackable.type_name, trackable.owner_username].filter(Boolean).join(' · ')}
            </span>
            <span className='geoapp-trackables-widget__row-actions'>
                <button
                    type='button'
                    className='theia-button secondary'
                    title='Ouvrir la fiche dans l’onglet Fiche'
                    onClick={() => onShowDetail(trackable.reference_code)}
                >
                    Fiche
                </button>
                <button
                    type='button'
                    className='theia-button secondary'
                    title='Loguer ce trackable (onglet Loguer)'
                    onClick={() => onLog(trackable.reference_code)}
                >
                    Loguer
                </button>
            </span>
        </div>
    );
};
