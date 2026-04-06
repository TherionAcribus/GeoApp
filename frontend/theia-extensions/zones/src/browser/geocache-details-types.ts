export interface WaypointPrefillPayload {
    coords?: string;
    title?: string;
    note?: string;
}

export type GeocacheAttribute = { name: string; is_negative?: boolean; base_filename?: string };
export type GeocacheImage = { url: string };
export type GeocacheWaypoint = {
    id?: number;
    prefix?: string;
    lookup?: string;
    name?: string;
    type?: string;
    latitude?: number;
    longitude?: number;
    gc_coords?: string;
    note?: string;
    note_override?: string;
    note_override_updated_at?: string;
};
export type GeocacheChecker = { id?: number; name?: string; url?: string };
export type GeocacheSolvedStatus = 'not_solved' | 'in_progress' | 'solved';
export type DescriptionVariant = 'original' | 'modified';

export type GeocacheDto = {
    id: number;
    gc_code?: string;
    name: string;
    url?: string;
    type?: string;
    size?: string;
    owner?: string;
    difficulty?: number;
    terrain?: number;
    latitude?: number;
    longitude?: number;
    coordinates_raw?: string;
    is_corrected?: boolean;
    original_latitude?: number;
    original_longitude?: number;
    original_coordinates_raw?: string;
    placed_at?: string;
    status?: string;
    zone_id?: number;
    description_html?: string;
    description_raw?: string;
    description_override_html?: string;
    description_override_raw?: string;
    description_override_updated_at?: string;
    hints?: string;
    hints_decoded?: string;
    hints_decoded_override?: string;
    hints_decoded_override_updated_at?: string;
    attributes?: GeocacheAttribute[];
    favorites_count?: number;
    logs_count?: number;
    images?: GeocacheImage[];
    found?: boolean;
    found_date?: string;
    solved?: GeocacheSolvedStatus;
    waypoints?: GeocacheWaypoint[];
    checkers?: GeocacheChecker[];
};
