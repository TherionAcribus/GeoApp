import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell } from '@theia/core/lib/browser';

interface GeocacheLogTarget {
    geocacheId: number;
    gcCode?: string;
    name: string;
}

interface GeocacheLogEditorTarget {
    geocacheId: number;
    gcCode?: string;
}

@injectable()
export class GeocacheDetailsNavigationController {
    constructor(
        @inject(ApplicationShell) protected readonly shell: ApplicationShell
    ) {}

    closeAssociatedMap(geocacheId?: number): void {
        if (!geocacheId) {
            return;
        }

        const mapId = this.getMapId(geocacheId);
        const existingMap = this.shell.getWidgets('bottom').find(widget => widget.id === mapId);
        if (existingMap) {
            existingMap.close();
        }
    }

    reactivateAssociatedMap(geocacheId?: number): void {
        if (!geocacheId) {
            return;
        }

        const mapId = this.getMapId(geocacheId);
        const existingMap = this.shell.getWidgets('bottom').find(widget => widget.id === mapId);
        if (existingMap) {
            this.shell.activateWidget(mapId);
        }
    }

    openLogs(target: GeocacheLogTarget): void {
        window.dispatchEvent(new CustomEvent('open-geocache-logs', {
            detail: {
                geocacheId: target.geocacheId,
                gcCode: target.gcCode,
                name: target.name
            }
        }));
    }

    openLogEditor(target: GeocacheLogEditorTarget): void {
        window.dispatchEvent(new CustomEvent('open-geocache-log-editor', {
            detail: {
                geocacheIds: [target.geocacheId],
                title: target.gcCode ? `Log - ${target.gcCode}` : 'Log - 1 géocache',
            }
        }));
    }

    openNotes(target: GeocacheLogTarget): void {
        window.dispatchEvent(new CustomEvent('open-geocache-notes', {
            detail: {
                geocacheId: target.geocacheId,
                gcCode: target.gcCode,
                name: target.name
            }
        }));
    }

    private getMapId(geocacheId: number): string {
        return `geoapp-map-geocache-${geocacheId}`;
    }
}
