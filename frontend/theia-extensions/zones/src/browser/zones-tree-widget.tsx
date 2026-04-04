import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ApplicationShell, WidgetManager, ConfirmDialog, Dialog } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core';
import { ContextMenu, ContextMenuItem } from './context-menu';
import { MoveGeocacheDialog } from './move-geocache-dialog';
import { GeocacheIcon } from './geocache-icon';
import { GeocacheTabsManager } from './geocache-tabs-manager';
import { ZoneTabsManager } from './zone-tabs-manager';

import '../../src/browser/style/zones-tree.css';

type ZoneDto = { 
    id: number; 
    name: string; 
    description?: string; 
    created_at?: string; 
    geocaches_count: number 
};

type GeocacheDto = {
    id: number;
    gc_code: string;
    name: string;
    cache_type: string;
    difficulty: number;
    terrain: number;
    found: boolean;
};

@injectable()
export class ZonesTreeWidget extends ReactWidget {
    static readonly ID = 'zones.tree.widget';

    protected zones: ZoneDto[] = [];
    protected activeZoneId: number | undefined;
    protected backendBaseUrl = 'http://localhost:8000';
    protected expandedZones: Set<number> = new Set();
    protected zoneGeocaches: Map<number, GeocacheDto[]> = new Map();
    protected loadingZones: Set<number> = new Set();
    protected contextMenu: { items: ContextMenuItem[]; x: number; y: number } | null = null;
    protected moveDialog: { geocache: GeocacheDto; zoneId: number } | null = null;
    protected copyDialog: { geocache: GeocacheDto; zoneId: number } | null = null;

    protected readonly handleGeocacheLogSubmitted = (event: CustomEvent<{ geocacheId: number; found?: boolean }>): void => {
        const detail = event?.detail;
        const geocacheId = detail?.geocacheId;
        const found = detail?.found;
        if (typeof geocacheId !== 'number' || found !== true) {
            return;
        }

        let changed = false;
        for (const [zoneId, geocaches] of this.zoneGeocaches.entries()) {
            if (!geocaches || geocaches.length === 0) {
                continue;
            }
            const idx = geocaches.findIndex(g => g.id === geocacheId);
            if (idx < 0) {
                continue;
            }
            const current = geocaches[idx];
            if (current?.found === true) {
                continue;
            }
            const next = { ...current, found: true };
            this.zoneGeocaches.set(zoneId, [...geocaches.slice(0, idx), next, ...geocaches.slice(idx + 1)]);
            changed = true;
        }

        if (changed) {
            this.update();
        }
    };

    constructor(
        @inject(ApplicationShell) protected readonly shell: ApplicationShell,
        @inject(WidgetManager) protected readonly widgetManager: WidgetManager,
        @inject(GeocacheTabsManager) protected readonly geocacheTabsManager: GeocacheTabsManager,
        @inject(ZoneTabsManager) protected readonly zoneTabsManager: ZoneTabsManager,
        @inject(MessageService) protected readonly messages: MessageService,
    ) {
        super();
        this.id = ZonesTreeWidget.ID;
        this.title.closable = true;
        this.title.label = 'Zones';
        this.title.caption = 'Zones';
        this.title.iconClass = 'fa fa-map-marker';
        this.addClass('theia-zones-tree-widget');
        console.log('[ZonesTreeWidget] constructed');
    }

    onAfterAttach(msg: any): void {
        super.onAfterAttach(msg);
        console.log('[ZonesTreeWidget] onAfterAttach');
        if (typeof window !== 'undefined') {
            window.addEventListener('geoapp-geocache-log-submitted', this.handleGeocacheLogSubmitted as EventListener);
        }
        this.refresh();
    }

    protected onBeforeDetach(msg: any): void {
        if (typeof window !== 'undefined') {
            window.removeEventListener('geoapp-geocache-log-submitted', this.handleGeocacheLogSubmitted as EventListener);
        }
        super.onBeforeDetach(msg);
    }

    public async refresh(): Promise<void> {
        try {
            const res = await fetch(`${this.backendBaseUrl}/api/zones`, { credentials: 'include' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.zones = await res.json();
            
            const act = await fetch(`${this.backendBaseUrl}/api/active-zone`, { credentials: 'include' });
            this.activeZoneId = act.ok ? (await act.json())?.id : undefined;
            
            console.log('[ZonesTreeWidget] refresh -> zones:', this.zones.length, 'active:', this.activeZoneId);
            this.update();
        } catch (e) {
            console.error('Zones: fetch error', e);
        }
    }

    protected async loadGeocachesForZone(zoneId: number): Promise<void> {
        if (this.zoneGeocaches.has(zoneId)) {
            return; // Déjà chargé
        }
        
        this.loadingZones.add(zoneId);
        this.update();
        
        try {
            const res = await fetch(`${this.backendBaseUrl}/api/zones/${zoneId}/geocaches`, { 
                credentials: 'include' 
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const geocaches = await res.json();
            this.zoneGeocaches.set(zoneId, geocaches);
        } catch (e) {
            console.error('Failed to load geocaches for zone', zoneId, e);
            this.messages.error('Erreur lors du chargement des géocaches');
        } finally {
            this.loadingZones.delete(zoneId);
            this.update();
        }
    }

    protected async toggleZone(zoneId: number): Promise<void> {
        if (this.expandedZones.has(zoneId)) {
            this.expandedZones.delete(zoneId);
        } else {
            this.expandedZones.add(zoneId);
            await this.loadGeocachesForZone(zoneId);
        }
        this.update();
    }

    protected async openZoneTable(zone: ZoneDto): Promise<void> {
        try {
            await fetch(`${this.backendBaseUrl}/api/active-zone`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ zone_id: zone.id })
            });
            this.activeZoneId = zone.id;
            this.update();
            await this.zoneTabsManager.openZone({ zoneId: zone.id, zoneName: zone.name });
        } catch (error) {
            console.error('Failed to open ZoneGeocachesWidget:', error);
            this.messages.error('Impossible d\'ouvrir le tableau de la zone');
        }
    }

    protected async openGeocacheDetails(geocache: GeocacheDto): Promise<void> {
        try {
            await this.geocacheTabsManager.openGeocacheDetails({
                geocacheId: geocache.id,
                name: geocache.name
            });
        } catch (error) {
            console.error('Failed to open GeocacheDetailsWidget:', error);
            this.messages.error('Impossible d\'ouvrir les détails de la géocache');
        }
    }

    protected async deleteZone(zone: ZoneDto): Promise<void> {
        const dialog = new ConfirmDialog({
            title: 'Supprimer la zone',
            msg: `Voulez-vous vraiment supprimer la zone "${zone.name}" ?`,
            ok: Dialog.OK,
            cancel: Dialog.CANCEL
        });
        
        const confirmed = await dialog.open();
        if (!confirmed) {
            return;
        }

        try {
            const res = await fetch(`${this.backendBaseUrl}/api/zones/${zone.id}`, {
                method: 'DELETE',
                credentials: 'include'
            });

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}: ${await res.text()}`);
            }

            if (this.activeZoneId === zone.id) {
                await fetch(`${this.backendBaseUrl}/api/active-zone`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ zone_id: null })
                });
                this.activeZoneId = undefined;
            }

            // Nettoyer les données de la zone supprimée
            this.expandedZones.delete(zone.id);
            this.zoneGeocaches.delete(zone.id);
            
            await this.refresh();
            this.messages.info(`Zone "${zone.name}" supprimée`);
        } catch (e) {
            console.error('Zones: delete error', e);
            this.messages.error(`Erreur lors de la suppression: ${e}`);
        }
    }

    protected async moveGeocache(geocache: GeocacheDto, targetZoneId: number): Promise<void> {
        try {
            const res = await fetch(`${this.backendBaseUrl}/api/geocaches/${geocache.id}/move`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ target_zone_id: targetZoneId })
            });

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}: ${await res.text()}`);
            }

            // Sauvegarder les zones actuellement dépliées
            const expandedZoneIds = Array.from(this.expandedZones);
            
            // Invalider le cache des géocaches
            this.zoneGeocaches.clear();
            
            // Recharger les zones pour mettre à jour les compteurs
            await this.refresh();
            
            // Recharger les géocaches des zones qui étaient dépliées
            for (const zoneId of expandedZoneIds) {
                if (this.expandedZones.has(zoneId)) {
                    await this.loadGeocachesForZone(zoneId);
                }
            }
            
            this.messages.info(`Géocache ${geocache.gc_code} déplacée`);
        } catch (e) {
            console.error('Move geocache error', e);
            this.messages.error(`Erreur lors du déplacement: ${e}`);
        }
    }

    protected async copyGeocache(geocache: GeocacheDto, targetZoneId: number): Promise<void> {
        try {
            const res = await fetch(`${this.backendBaseUrl}/api/geocaches/${geocache.id}/copy`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ target_zone_id: targetZoneId })
            });

            if (!res.ok) {
                const errorText = await res.text();
                let errorMsg = 'Erreur lors de la copie';
                try {
                    const errorJson = JSON.parse(errorText);
                    if (errorJson.error) {
                        errorMsg = errorJson.error;
                    }
                } catch {
                    errorMsg = errorText || errorMsg;
                }
                throw new Error(errorMsg);
            }

            // Sauvegarder les zones actuellement dépliées
            const expandedZoneIds = Array.from(this.expandedZones);
            
            // Invalider le cache des géocaches
            this.zoneGeocaches.clear();
            
            // Recharger les zones pour mettre à jour les compteurs
            await this.refresh();
            
            // Recharger les géocaches des zones qui étaient dépliées
            for (const zoneId of expandedZoneIds) {
                if (this.expandedZones.has(zoneId)) {
                    await this.loadGeocachesForZone(zoneId);
                }
            }
            
            this.messages.info(`Géocache ${geocache.gc_code} copiée vers la zone cible`);
        } catch (e) {
            console.error('Copy geocache error', e);
            this.messages.error(`Erreur lors de la copie: ${e}`);
        }
    }

    protected showZoneContextMenu(zone: ZoneDto, event: React.MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();

        const items: ContextMenuItem[] = [
            {
                label: 'Ouvrir',
                icon: '📂',
                action: () => this.openZoneTable(zone)
            },
            {
                separator: true
            },
            {
                label: 'Supprimer',
                icon: '🗑️',
                danger: true,
                action: () => this.deleteZone(zone)
            }
        ];

        this.contextMenu = {
            items,
            x: event.clientX,
            y: event.clientY
        };
        this.update();
    }

    protected showGeocacheContextMenu(geocache: GeocacheDto, zoneId: number, event: React.MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();

        const items: ContextMenuItem[] = [
            {
                label: 'Ouvrir',
                icon: '📖',
                action: () => this.openGeocacheDetails(geocache)
            },
            {
                label: 'Déplacer vers...',
                icon: '📦',
                action: () => {
                    this.moveDialog = { geocache, zoneId };
                    this.update();
                },
                disabled: this.zones.length <= 1
            },
            {
                label: 'Copier vers...',
                icon: '📋',
                action: () => {
                    this.copyDialog = { geocache, zoneId };
                    this.update();
                },
                disabled: this.zones.length <= 1
            },
            {
                separator: true
            },
            {
                label: 'Supprimer',
                icon: '🗑️',
                danger: true,
                action: async () => {
                    const dialog = new ConfirmDialog({
                        title: 'Supprimer la géocache',
                        msg: `Voulez-vous vraiment supprimer ${geocache.gc_code} ?`,
                        ok: Dialog.OK,
                        cancel: Dialog.CANCEL
                    });
                    
                    const confirmed = await dialog.open();
                    if (!confirmed) {
                        return;
                    }

                    try {
                        const res = await fetch(`${this.backendBaseUrl}/api/geocaches/${geocache.id}`, {
                            method: 'DELETE',
                            credentials: 'include'
                        });

                        if (!res.ok) {
                            throw new Error(`HTTP ${res.status}`);
                        }

                        // Invalider le cache
                        this.zoneGeocaches.delete(zoneId);
                        await this.loadGeocachesForZone(zoneId);
                        await this.refresh();
                        
                        this.messages.info(`Géocache ${geocache.gc_code} supprimée`);
                    } catch (e) {
                        console.error('Delete geocache error', e);
                        this.messages.error('Erreur lors de la suppression');
                    }
                }
            }
        ];

        this.contextMenu = {
            items,
            x: event.clientX,
            y: event.clientY
        };
        this.update();
    }

    protected closeContextMenu(): void {
        this.contextMenu = null;
        this.update();
    }

    protected closeMoveDialog(): void {
        this.moveDialog = null;
        this.update();
    }

    protected closeCopyDialog(): void {
        this.copyDialog = null;
        this.update();
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
            this.messages.info(`Zone "${name}" créée`);
        } catch (e) {
            console.error('Zones: create error', e);
            this.messages.error('Erreur lors de la création de la zone');
        }
    }

    // Méthode supprimée - on utilise maintenant le composant GeocacheIcon directement

    protected render(): React.ReactNode {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '8px' }}>
                {/* Formulaire d'ajout de zone */}
                <form 
                    onSubmit={e => this.onAddZoneSubmit(e)} 
                    style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}
                >
                    <input 
                        name='name' 
                        placeholder='Nouvelle zone' 
                        style={{
                            padding: '4px 8px',
                            border: '1px solid var(--theia-input-border)',
                            background: 'var(--theia-input-background)',
                            color: 'var(--theia-input-foreground)',
                            borderRadius: 3,
                        }}
                    />
                    <input 
                        name='description' 
                        placeholder='Description (optionnel)'
                        style={{
                            padding: '4px 8px',
                            border: '1px solid var(--theia-input-border)',
                            background: 'var(--theia-input-background)',
                            color: 'var(--theia-input-foreground)',
                            borderRadius: 3,
                        }}
                    />
                    <button 
                        type='submit'
                        className='theia-button'
                        style={{ padding: '4px 8px' }}
                    >
                        ➕ Ajouter Zone
                    </button>
                </form>

                {/* Arbre de navigation */}
                <div style={{ flex: 1, overflow: 'auto' }}>
                    {this.zones.length === 0 ? (
                        <div style={{ textAlign: 'center', opacity: 0.6, padding: '20px 10px' }}>
                            <p style={{ fontSize: '0.9em' }}>Aucune zone</p>
                            <p style={{ fontSize: '0.85em' }}>Créez une zone pour commencer</p>
                        </div>
                    ) : (
                        <div>
                            {this.zones.map(zone => this.renderZoneNode(zone))}
                        </div>
                    )}
                </div>

                {/* Menu contextuel */}
                {this.contextMenu && (
                    <ContextMenu
                        items={this.contextMenu.items}
                        x={this.contextMenu.x}
                        y={this.contextMenu.y}
                        onClose={() => this.closeContextMenu()}
                    />
                )}

                {/* Dialog de déplacement */}
                {this.moveDialog && (
                    <MoveGeocacheDialog
                        geocacheName={`${this.moveDialog.geocache.gc_code} - ${this.moveDialog.geocache.name}`}
                        currentZoneId={this.moveDialog.zoneId}
                        zones={this.zones}
                        onMove={async (targetZoneId) => {
                            await this.moveGeocache(this.moveDialog!.geocache, targetZoneId);
                            this.closeMoveDialog();
                        }}
                        onCancel={() => this.closeMoveDialog()}
                    />
                )}

                {/* Dialog de copie */}
                {this.copyDialog && (
                    <MoveGeocacheDialog
                        geocacheName={`${this.copyDialog.geocache.gc_code} - ${this.copyDialog.geocache.name}`}
                        currentZoneId={this.copyDialog.zoneId}
                        zones={this.zones}
                        onMove={async (targetZoneId) => {
                            await this.copyGeocache(this.copyDialog!.geocache, targetZoneId);
                            this.closeCopyDialog();
                        }}
                        onCancel={() => this.closeCopyDialog()}
                        title="Copier vers une zone"
                        actionLabel="Copier"
                    />
                )}
            </div>
        );
    }

    protected renderZoneNode(zone: ZoneDto): React.ReactNode {
        const isExpanded = this.expandedZones.has(zone.id);
        const isActive = this.activeZoneId === zone.id;
        const isLoading = this.loadingZones.has(zone.id);
        const geocaches = this.zoneGeocaches.get(zone.id) || [];

        return (
            <div key={zone.id} style={{ marginBottom: 4 }}>
                {/* Ligne de la zone */}
                <div 
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '4px 6px',
                        borderRadius: 3,
                        background: isActive ? 'var(--theia-list-activeSelectionBackground)' : 'transparent',
                        cursor: 'pointer',
                    }}
                    onContextMenu={(e) => this.showZoneContextMenu(zone, e)}
                    onMouseEnter={(e) => {
                        if (!isActive) {
                            (e.currentTarget as HTMLElement).style.background = 'var(--theia-list-hoverBackground)';
                        }
                    }}
                    onMouseLeave={(e) => {
                        if (!isActive) {
                            (e.currentTarget as HTMLElement).style.background = 'transparent';
                        }
                    }}
                >
                    {/* Icône expand/collapse */}
                    <span
                        onClick={(e) => {
                            e.stopPropagation();
                            this.toggleZone(zone.id);
                        }}
                        style={{
                            width: 16,
                            display: 'inline-block',
                            cursor: 'pointer',
                            userSelect: 'none',
                        }}
                    >
                        {zone.geocaches_count > 0 ? (isExpanded ? '▼' : '▶') : ''}
                    </span>

                    {/* Icône dossier */}
                    <span style={{ marginRight: 6 }}>
                        {isExpanded ? '📂' : '📁'}
                    </span>

                    {/* Nom de la zone */}
                    <span
                        onClick={() => this.openZoneTable(zone)}
                        style={{
                            flex: 1,
                            fontSize: '0.9em',
                            fontWeight: isActive ? 600 : 400,
                        }}
                        title={zone.description || zone.name}
                    >
                        {zone.name}
                        <span style={{ opacity: 0.6, marginLeft: 4, fontSize: '0.85em' }}>
                            ({zone.geocaches_count})
                        </span>
                    </span>
                </div>

                {/* Géocaches (si la zone est dépliée) */}
                {isExpanded && (
                    <div style={{ marginLeft: 20, marginTop: 2 }}>
                        {isLoading ? (
                            <div style={{ padding: '4px 6px', fontSize: '0.85em', opacity: 0.6 }}>
                                Chargement...
                            </div>
                        ) : geocaches.length === 0 ? (
                            <div style={{ padding: '4px 6px', fontSize: '0.85em', opacity: 0.6 }}>
                                Aucune géocache
                            </div>
                        ) : (
                            geocaches.map(gc => this.renderGeocacheNode(gc, zone.id))
                        )}
                    </div>
                )}
            </div>
        );
    }

    protected renderGeocacheNode(geocache: GeocacheDto, zoneId: number): React.ReactNode {
        return (
            <div
                key={geocache.id}
                onClick={() => this.openGeocacheDetails(geocache)}
                onContextMenu={(e) => this.showGeocacheContextMenu(geocache, zoneId, e)}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '3px 6px',
                    marginBottom: 2,
                    borderRadius: 3,
                    cursor: 'pointer',
                    fontSize: '0.85em',
                }}
                onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'var(--theia-list-hoverBackground)';
                }}
                onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                }}
                title={`${geocache.gc_code} - ${geocache.name}\nD${geocache.difficulty} T${geocache.terrain}`}
            >
                {/* Icône type de cache */}
                <span style={{ marginRight: 6, display: 'inline-flex', alignItems: 'center' }}>
                    <GeocacheIcon type={geocache.cache_type} size={16} />
                </span>

                {/* Code GC */}
                <span style={{ fontWeight: 600, marginRight: 6, color: 'var(--theia-textLink-foreground)' }}>
                    {geocache.gc_code}
                </span>

                {/* Nom de la cache */}
                <span style={{ 
                    flex: 1, 
                    overflow: 'hidden', 
                    textOverflow: 'ellipsis', 
                    whiteSpace: 'nowrap',
                    opacity: 0.9,
                }}>
                    {geocache.name}
                </span>

                {/* Indicateur "trouvée" */}
                {geocache.found && (
                    <span style={{ marginLeft: 4, fontSize: '0.9em' }} title="Trouvée">
                        ✓
                    </span>
                )}
            </div>
        );
    }
}

