export type EarthCoachObservationType = 'observation' | 'hypothesis' | 'interpretation';

export interface EarthCoachObservationImageDto {
    id?: number;
    url?: string;
    source_url?: string;
    image_type?: string;
    title?: string;
    note?: string;
    created_at?: string | null;
    updated_at?: string | null;
}

export interface EarthCoachObservationDto {
    id: number;
    geocache_id?: number;
    cache_id?: string;
    user_id?: string;
    observation_type?: EarthCoachObservationType;
    content?: string;
    note?: string;
    observed_at?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
    waypoint_id?: number | null;
    coordinates_raw?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    images?: EarthCoachObservationImageDto[];
}

export interface EarthCoachObservationsApiResponse {
    geocache_id: number;
    gc_code?: string;
    name?: string;
    observations: EarthCoachObservationDto[];
}

export interface EarthCoachObservationInput {
    content: string;
    observation_type: EarthCoachObservationType;
    observed_at?: string | null;
    waypoint_id?: number | null;
    latitude?: number | null;
    longitude?: number | null;
    coordinates_raw?: string | null;
    image_ids?: number[];
}

export interface EarthCoachObservationDraft {
    content: string;
    observationType: EarthCoachObservationType;
    observedAt: string;
    waypointId: string;
    coordinatesRaw: string;
    latitude: string;
    longitude: string;
    selectedImageIds: number[];
}

export function toDateTimeLocalValue(value?: string | Date | null): string {
    if (!value) {
        return '';
    }
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) {
        const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
        return local.toISOString().slice(0, 16);
    }
    const raw = String(value).trim();
    const match = raw.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
    return match ? match[1] : raw;
}

export function dateTimeLocalToIso(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    const date = new Date(trimmed);
    if (!Number.isNaN(date.getTime())) {
        return date.toISOString();
    }
    return trimmed;
}

export function createEarthCoachObservationDraft(now: Date = new Date()): EarthCoachObservationDraft {
    return {
        content: '',
        observationType: 'observation',
        observedAt: toDateTimeLocalValue(now),
        waypointId: '',
        coordinatesRaw: '',
        latitude: '',
        longitude: '',
        selectedImageIds: [],
    };
}

export function createEarthCoachObservationDraftFromDto(observation: EarthCoachObservationDto): EarthCoachObservationDraft {
    return {
        content: observation.content || observation.note || '',
        observationType: observation.observation_type || 'observation',
        observedAt: toDateTimeLocalValue(observation.observed_at || observation.created_at),
        waypointId: observation.waypoint_id != null ? String(observation.waypoint_id) : '',
        coordinatesRaw: observation.coordinates_raw || '',
        latitude: observation.latitude != null ? String(observation.latitude) : '',
        longitude: observation.longitude != null ? String(observation.longitude) : '',
        selectedImageIds: (observation.images || [])
            .map(image => image.id)
            .filter((id): id is number => typeof id === 'number'),
    };
}

export function parseOptionalObservationNumber(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    const parsed = Number(trimmed.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
}

export function parseOptionalObservationInteger(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    const parsed = Number(trimmed);
    return Number.isInteger(parsed) ? parsed : null;
}

export function buildEarthCoachObservationInput(draft: EarthCoachObservationDraft): EarthCoachObservationInput {
    return {
        content: draft.content.trim(),
        observation_type: draft.observationType,
        observed_at: dateTimeLocalToIso(draft.observedAt),
        waypoint_id: parseOptionalObservationInteger(draft.waypointId),
        latitude: parseOptionalObservationNumber(draft.latitude),
        longitude: parseOptionalObservationNumber(draft.longitude),
        coordinates_raw: draft.coordinatesRaw.trim() || null,
        image_ids: [...draft.selectedImageIds],
    };
}

export function toggleObservationImageId(selectedImageIds: number[], imageId: number): number[] {
    if (selectedImageIds.includes(imageId)) {
        return selectedImageIds.filter(id => id !== imageId);
    }
    return [...selectedImageIds, imageId];
}
