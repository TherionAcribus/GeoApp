/**
 * Déclarations type-safe pour interagir avec MapService de theia-ide-zones-ext
 * sans compiler les fichiers sources de l'autre extension.
 */

declare module 'theia-ide-zones-ext/lib/browser/map/map-service' {
    export interface DetectedCoordinateHighlight {
        latitude: number;
        longitude: number;
        formatted?: string;
        gcCode?: string;
        pluginName?: string;
        autoSaved?: boolean;
        replaceExisting?: boolean;
        waypointTitle?: string;
        waypointNote?: string;
        sourceResultText?: string;
        interactionType?: string;
        interactionData?: unknown;
    }

    export class MapService {
        highlightDetectedCoordinate(coordinate: DetectedCoordinateHighlight | undefined): void;
        getLastHighlightedCoordinate(): DetectedCoordinateHighlight | undefined;
    }
}
