/**
 * Chargement des géocaches et des statistiques utilisateur depuis le backend.
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 4). Les appels HTTP
 * et le parsing sont ici, l'orchestration de l'état du widget reste dans le widget.
 */

import { GeocacheListItem, LogTypeValue, isLogTypeValue } from './types';
import { sanitizeLogTypeForGeocache } from './helpers';

/** URL de base du backend GeoApp. */
export type BackendBaseUrl = string;

/** Convertit une géocache renvoyée par le backend en entrée de liste, ou `undefined`. */
export function toGeocacheListItem(data: unknown): GeocacheListItem | undefined {
    const raw = data as Record<string, unknown> | null;
    if (!raw || typeof raw.id !== 'number') {
        return undefined;
    }
    return {
        id: raw.id,
        gc_code: (raw.gc_code ?? '').toString(),
        name: (raw.name ?? '').toString(),
        owner: (raw.owner ?? '').toString() || undefined,
        favorites_count: typeof raw.favorites_count === 'number' ? raw.favorites_count : undefined,
        logs_count: typeof raw.logs_count === 'number' ? raw.logs_count : undefined,
        placed_at: (raw.placed_at ?? null) as string | null,
        cache_type: (raw.type ?? '').toString(),
        already_found: raw.found === true,
        found_date: (raw.found_date ?? null) as string | null,
    };
}

/** Résultat du chargement par lot des géocaches. */
export interface LoadGeocachesResult {
    /** Géocaches chargées, dans l'ordre demandé. */
    geocaches: GeocacheListItem[];
    /** IDs demandés mais introuvables. */
    missingIds: number[];
    /** Types de log assainis pour chaque géocache chargée. */
    perCacheLogType: Record<number, LogTypeValue>;
    /** Géocaches déjà trouvées (pour avertissement). */
    alreadyFound: GeocacheListItem[];
}

/**
 * Charge les géocaches du contexte en une seule requête (`/api/geocaches/batch`).
 *
 * Retourne les géocaches dans l'ordre demandé, les IDs introuvables, et les types
 * de log assainis. L'appelant gère les messages utilisateur et la mise à jour de l'état.
 */
export async function fetchGeocachesBatch(
    backendBaseUrl: BackendBaseUrl,
    geocacheIds: number[],
    currentPerCacheLogType: Record<number, LogTypeValue>,
    defaultLogType: LogTypeValue
): Promise<LoadGeocachesResult> {
    const query = geocacheIds.join(',');
    const res = await fetch(
        `${backendBaseUrl}/api/geocaches/batch?ids=${encodeURIComponent(query)}`,
        { credentials: 'include' }
    );
    if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
    }
    const body = await res.json();

    const loaded = new Map<number, GeocacheListItem>();
    for (const raw of (Array.isArray(body?.geocaches) ? body.geocaches : [])) {
        const item = toGeocacheListItem(raw);
        if (item) {
            loaded.set(item.id, item);
        }
    }

    // L'ordre demandé est celui de l'envoi des logs et de la numérotation
    // `@cache_count` : on le réimpose plutôt que de faire confiance à la réponse.
    const geocaches = geocacheIds
        .map(id => loaded.get(id))
        .filter((gc): gc is GeocacheListItem => gc !== undefined);

    const missingIds = geocacheIds.filter(id => !loaded.has(id));

    const nextTypes: Record<number, LogTypeValue> = { ...currentPerCacheLogType };
    for (const gc of geocaches) {
        const existing = nextTypes[gc.id];
        const candidate = isLogTypeValue(existing) ? existing : defaultLogType;
        nextTypes[gc.id] = sanitizeLogTypeForGeocache(candidate, gc);
    }

    const alreadyFound = geocaches.filter(gc => gc.already_found === true);

    return { geocaches, missingIds, perCacheLogType: nextTypes, alreadyFound };
}

/** Statistiques utilisateur (points favoris, nombre de trouvailles). */
export interface UserStats {
    awardedFavoritePoints: number;
    findsCount: number;
}

/** Charge les statistiques utilisateur depuis `/api/auth/status`. */
export async function fetchUserStats(backendBaseUrl: BackendBaseUrl): Promise<UserStats> {
    const res = await fetch(`${backendBaseUrl}/api/auth/status`, { credentials: 'include' });
    if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
    }
    const authState = await res.json();
    return {
        awardedFavoritePoints: typeof authState?.user?.awarded_favorite_points === 'number'
            ? authState.user.awarded_favorite_points
            : 0,
        findsCount: typeof authState?.user?.finds_count === 'number'
            ? authState.user.finds_count
            : 0,
    };
}

/** Resynchronise les statistiques depuis Geocaching.com (scraping du profil). */
export async function refreshUserStats(backendBaseUrl: BackendBaseUrl): Promise<Partial<UserStats>> {
    const res = await fetch(`${backendBaseUrl}/api/auth/profile/refresh`, {
        method: 'POST',
        credentials: 'include',
    });
    if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
    }
    const body = await res.json();
    const result: Partial<UserStats> = {};
    const finds = body?.stats?.finds_count;
    if (typeof finds === 'number') {
        result.findsCount = finds;
    }
    const awardedPoints = body?.stats?.awarded_favorite_points;
    if (typeof awardedPoints === 'number') {
        result.awardedFavoritePoints = awardedPoints;
    }
    return result;
}

/** Formate un pourcentage de points favoris. */
export function formatFavoritePercent(
    favoritesCount: number | undefined,
    logsCount: number | undefined
): string {
    if (typeof favoritesCount !== 'number' || typeof logsCount !== 'number' || logsCount <= 0) {
        return '—';
    }
    const pct = (favoritesCount / logsCount) * 100;
    if (!isFinite(pct)) {
        return '—';
    }
    return `${pct.toFixed(1)}%`;
}
