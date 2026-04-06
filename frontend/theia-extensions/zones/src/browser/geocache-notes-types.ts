export type GeocacheNoteType = 'user' | 'system';

export interface GeocacheNoteDto {
    id: number;
    content: string;
    note_type: string;
    source: string;
    source_plugin?: string | null;
    created_at: string | null;
    updated_at: string | null;
}

export interface GeocacheNotesApiResponse {
    geocache_id: number;
    gc_code: string;
    name: string;
    gc_personal_note: string | null;
    gc_personal_note_synced_at: string | null;
    gc_personal_note_last_pushed_at: string | null;
    notes: GeocacheNoteDto[];
}

export interface SyncFromGeocachingResponse {
    geocache_id: number;
    gc_code: string;
    gc_personal_note: string | null;
    gc_personal_note_synced_at: string | null;
}

export interface SyncNoteToGeocachingResponse {
    geocache_id: number;
    gc_code: string;
    gc_personal_note: string | null;
    gc_personal_note_last_pushed_at: string | null;
}

export interface CreateGeocacheNoteInput {
    content: string;
    note_type: GeocacheNoteType;
    source?: string;
    source_plugin?: string | null;
}

export interface UpdateGeocacheNoteInput {
    content: string;
    note_type?: GeocacheNoteType;
}
