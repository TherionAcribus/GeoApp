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

@injectable()
export class GeoAppWidgetEventsService {
    protected readonly onDidRequestZonesRefreshEmitter = new Emitter<void>();
    readonly onDidRequestZonesRefresh: TheiaEvent<void> = this.onDidRequestZonesRefreshEmitter.event;

    protected readonly onDidChangeGeocacheEmitter = new Emitter<GeocacheChangedEvent>();
    readonly onDidChangeGeocache: TheiaEvent<GeocacheChangedEvent> = this.onDidChangeGeocacheEmitter.event;

    /** Émis quand la liste des zones elle-même change (création, suppression, renommage…). */
    protected readonly onDidChangeZoneListEmitter = new Emitter<void>();
    readonly onDidChangeZoneList: TheiaEvent<void> = this.onDidChangeZoneListEmitter.event;

    requestZonesRefresh(): void {
        this.onDidRequestZonesRefreshEmitter.fire();
    }

    notifyGeocacheChanged(event: GeocacheChangedEvent): void {
        this.onDidChangeGeocacheEmitter.fire(event);
    }

    notifyZoneListChanged(): void {
        this.onDidChangeZoneListEmitter.fire();
    }

    dispose(): void {
        this.onDidRequestZonesRefreshEmitter.dispose();
        this.onDidChangeGeocacheEmitter.dispose();
        this.onDidChangeZoneListEmitter.dispose();
    }
}
