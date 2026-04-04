import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ZoneTabsManager } from './zone-tabs-manager';

type ZoneDto = { id: number; name: string; description?: string; created_at?: string; geocaches_count: number };

@injectable()
export class ZonesWidget extends ReactWidget {
    static readonly ID = 'zones.widget';

    protected zones: ZoneDto[] = [];
    protected activeZoneId: number | undefined;
    protected backendBaseUrl = 'http://localhost:8000';
    protected readonly versionStamp = 'zones-widget@' + new Date().toISOString();

    constructor(
        @inject(ZoneTabsManager) protected readonly zoneTabsManager: ZoneTabsManager,
    ) {
        super();
        this.id = ZonesWidget.ID;
        this.title.closable = true;
        this.title.label = 'Zones';
        this.title.caption = 'Zones';
        this.title.iconClass = 'fa fa-map-marker';
        this.addClass('theia-zones-widget');
        // Logs init
        // eslint-disable-next-line no-console
        console.log('[ZonesWidget] constructed', this.versionStamp);
    }

    onAfterAttach(msg: any): void {
        super.onAfterAttach(msg);
        // eslint-disable-next-line no-console
        console.log('[ZonesWidget] onAfterAttach');
        this.refresh();
    }

    protected async refresh(): Promise<void> {
        try {
            const res = await fetch(`${this.backendBaseUrl}/api/zones`, { credentials: 'include' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.zones = await res.json();
            // Charger la zone active
            const act = await fetch(`${this.backendBaseUrl}/api/active-zone`, { credentials: 'include' });
            this.activeZoneId = act.ok ? (await act.json())?.id : undefined;
            // eslint-disable-next-line no-console
            console.log('[ZonesWidget] refresh -> zones:', this.zones.length, 'active:', this.activeZoneId);
            this.update();
        } catch (e) {
            console.error('Zones: fetch error', e);
        }
    }

    protected async deleteZone(zoneId: number, zoneName: string): Promise<void> {
        try {
            // eslint-disable-next-line no-console
            console.log('[ZonesWidget] deleting zone', zoneId, zoneName);
            const res = await fetch(`${this.backendBaseUrl}/api/zones/${zoneId}`, {
                method: 'DELETE',
                credentials: 'include'
            });

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}: ${await res.text()}`);
            }

            // Si la zone supprimée était active, désactiver
            if (this.activeZoneId === zoneId) {
                await fetch(`${this.backendBaseUrl}/api/active-zone`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ zone_id: null })
                });
                this.activeZoneId = undefined;
            }

            // Rafraîchir la liste
            await this.refresh();
            // eslint-disable-next-line no-console
            console.log('[ZonesWidget] zone deleted successfully');
        } catch (e) {
            console.error('Zones: delete error', e);
            alert(`Erreur lors de la suppression: ${e}`);
        }
    }

    protected async onAddZoneSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(form);
        const name = (formData.get('name') as string || '').trim();
        const description = (formData.get('description') as string || '').trim();
        if (!name) { return; }
        try {
            const res = await fetch(`${this.backendBaseUrl}/api/zones`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ name, description })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            form.reset();
            await this.refresh();
        } catch (e) {
            console.error('Zones: create error', e);
        }
    }

    protected render(): React.ReactNode {
        return (
            <div className='p-2'>
                <form onSubmit={e => this.onAddZoneSubmit(e)} style={{ display: 'grid', gap: 6 }}>
                    <input name='name' placeholder='Nouvelle zone' />
                    <input name='description' placeholder='Description (optionnel)' />
                    <button type='submit'>Ajouter</button>
                </form>
                <ul style={{ marginTop: 8, listStyle: 'none', padding: 0 }}>
                    {this.zones.map(z => (
                        <li key={z.id} style={{ padding: '4px 0' }}>
                            <button
                                onClick={async () => {
                                    // eslint-disable-next-line no-console
                                    console.log('[ZonesWidget] click zone', z.id, z.name);
                                    await fetch(`${this.backendBaseUrl}/api/active-zone`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        credentials: 'include',
                                        body: JSON.stringify({ zone_id: z.id })
                                    });
                                    this.activeZoneId = z.id;
                                    this.update();
                                    // Ouvrir l'onglet central via le gestionnaire d'onglets de zones
                                    try {
                                        // eslint-disable-next-line no-console
                                        console.log('[ZonesWidget] opening ZoneGeocachesWidget via ZoneTabsManager');
                                        await this.zoneTabsManager.openZone({ zoneId: z.id, zoneName: z.name });
                                    } catch (error) {
                                        console.error('Failed to open ZoneGeocachesWidget via ZoneTabsManager:', error);
                                        // Fallback: événement personnalisé
                                        try {
                                            // eslint-disable-next-line no-console
                                            console.log('[ZonesWidget] fallback dispatch event open-zone-geocaches');
                                            const event = new CustomEvent('open-zone-geocaches', { detail: { zoneId: z.id, zoneName: z.name } });
                                            window.dispatchEvent(event);
                                        } catch {}
                                    }
                                    // eslint-disable-next-line no-console
                                    console.trace('[ZonesWidget] click trace');
                                }}
                                style={{
                                    width: '100%',
                                    textAlign: 'left',
                                    background: this.activeZoneId === z.id ? 'var(--theia-editor-selectionBackground)' : 'transparent',
                                    border: 0,
                                    color: 'inherit',
                                    padding: '4px 6px',
                                    borderRadius: 3,
                                    cursor: 'pointer'
                                }}
                                title={z.description || ''}
                            >
                                {z.name}
                                <span style={{ opacity: 0.7, marginLeft: 6 }}>({z.geocaches_count})</span>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation(); // Empêcher l'ouverture de l'onglet
                                        if (window.confirm(`Supprimer la zone "${z.name}" ?`)) {
                                            this.deleteZone(z.id, z.name);
                                        }
                                    }}
                                    style={{
                                        marginLeft: 8,
                                        padding: '2px 6px',
                                        background: 'transparent',
                                        color: '#ef4444',
                                        border: '1px solid #ef4444',
                                        borderRadius: 3,
                                        cursor: 'pointer',
                                        fontSize: '12px'
                                    }}
                                    title="Supprimer cette zone"
                                >
                                    ✕
                                </button>
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
        );
    }
}


