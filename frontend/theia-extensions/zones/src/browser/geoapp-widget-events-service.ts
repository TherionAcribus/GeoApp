import { injectable } from '@theia/core/shared/inversify';
import { Emitter, Event as TheiaEvent } from '@theia/core/lib/common/event';

export interface GeocacheChangedEvent {
    geocacheId: number;
    reason:
        | 'waypoint-created'
        | 'waypoint-deleted'
        | 'corrected-coordinates-updated'
        | 'solved-status-updated'
        | 'note-created';
    source: 'map' | 'details' | 'zones' | 'chat';
}

export interface OpenZoneRequest {
    zoneId: number;
    zoneName?: string;
}

@injectable()
export class GeoAppWidgetEventsService {
    protected readonly onDidRequestZonesRefreshEmitter = new Emitter<void>();
    readonly onDidRequestZonesRefresh: TheiaEvent<void> = this.onDidRequestZonesRefreshEmitter.event;

    /**
     * Demande l'ouverture de la table des géocaches d'une zone. Passe par ce service
     * afin que les widgets (carte…) n'aient pas à dépendre de ZoneTabsManager, qui
     * dépend lui-même de la fabrique de cartes.
     */
    protected readonly onDidRequestOpenZoneEmitter = new Emitter<OpenZoneRequest>();
    readonly onDidRequestOpenZone: TheiaEvent<OpenZoneRequest> = this.onDidRequestOpenZoneEmitter.event;

    protected readonly onDidChangeGeocacheEmitter = new Emitter<GeocacheChangedEvent>();
    readonly onDidChangeGeocache: TheiaEvent<GeocacheChangedEvent> = this.onDidChangeGeocacheEmitter.event;

    /** Émis quand la liste des zones elle-même change (création, suppression, renommage…). */
    protected readonly onDidChangeZoneListEmitter = new Emitter<void>();
    readonly onDidChangeZoneList: TheiaEvent<void> = this.onDidChangeZoneListEmitter.event;

    requestZonesRefresh(): void {
        this.onDidRequestZonesRefreshEmitter.fire();
    }

    requestOpenZone(request: OpenZoneRequest): void {
        this.onDidRequestOpenZoneEmitter.fire(request);
    }

    notifyGeocacheChanged(event: GeocacheChangedEvent): void {
        this.onDidChangeGeocacheEmitter.fire(event);
    }

    notifyZoneListChanged(): void {
        this.onDidChangeZoneListEmitter.fire();
    }

    dispose(): void {
        this.onDidRequestZonesRefreshEmitter.dispose();
        this.onDidRequestOpenZoneEmitter.dispose();
        this.onDidChangeGeocacheEmitter.dispose();
        this.onDidChangeZoneListEmitter.dispose();
    }
}
