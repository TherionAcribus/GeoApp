export interface DocActionUiContext {
    activeWidget?: {
        id: string;
        kind: 'geocache-details' | 'zone-geocaches' | 'zones-list' | 'documentation' | 'other';
        geocacheId?: number;
        gcCode?: string;
        geocacheName?: string;
        zoneId?: number;
        zoneName?: string;
    };
    activeZone?: {
        id: number | null;
        name?: string;
    };
    openTabs: Array<{
        id: string;
        kind: string;
        geocacheId?: number;
        gcCode?: string;
        zoneId?: number;
        zoneName?: string;
    }>;
}
