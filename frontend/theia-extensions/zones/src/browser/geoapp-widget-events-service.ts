import { injectable } from '@theia/core/shared/inversify';
import { Emitter, Event as TheiaEvent } from '@theia/core/lib/common/event';

export interface GeocacheChangedEvent {
    geocacheId: number;
    reason:
        | 'waypoint-created'
        | 'waypoint-deleted'
        | 'corrected-coordinates-updated';
    source: 'map' | 'details' | 'zones';
}

@injectable()
export class GeoAppWidgetEventsService {
    protected readonly onDidRequestZonesRefreshEmitter = new Emitter<void>();
    readonly onDidRequestZonesRefresh: TheiaEvent<void> = this.onDidRequestZonesRefreshEmitter.event;

    protected readonly onDidChangeGeocacheEmitter = new Emitter<GeocacheChangedEvent>();
    readonly onDidChangeGeocache: TheiaEvent<GeocacheChangedEvent> = this.onDidChangeGeocacheEmitter.event;

    requestZonesRefresh(): void {
        this.onDidRequestZonesRefreshEmitter.fire();
    }

    notifyGeocacheChanged(event: GeocacheChangedEvent): void {
        this.onDidChangeGeocacheEmitter.fire(event);
    }

    dispose(): void {
        this.onDidRequestZonesRefreshEmitter.dispose();
        this.onDidChangeGeocacheEmitter.dispose();
    }
}
