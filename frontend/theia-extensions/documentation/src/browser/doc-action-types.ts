export type DocActionWidgetKind =
    | 'geocache-details'
    | 'zone-geocaches'
    | 'zones-list'
    | 'map'
    | 'log-editor'
    | 'logs'
    | 'notes'
    | 'image-editor'
    | 'plugin-executor'
    | 'alphabets'
    | 'friends'
    | 'friend-activity'
    | 'auth'
    | 'archive'
    | 'outing-plan'
    | 'server-logs'
    | 'documentation'
    | 'other';

interface DocActionWidgetInfo {
    geocacheId?: number;
    gcCode?: string;
    geocacheName?: string;
    zoneId?: number;
    zoneName?: string;
    /** IDs des geocaches cochees dans une table de zone (kind 'zone-geocaches'). */
    selection?: number[];
    /** Plugin selectionne dans l'executor (kind 'plugin-executor'). */
    pluginName?: string;
}

export interface DocActionUiContext {
    activeWidget?: DocActionWidgetInfo & {
        id: string;
        kind: DocActionWidgetKind;
    };
    lastGeoAppWidget?: DocActionWidgetInfo & {
        widgetId: string;
        kind: string;
    };
    activeZone?: {
        id: number | null;
        name?: string;
    };
    openTabs: Array<DocActionWidgetInfo & {
        id: string;
        kind: string;
    }>;
}
