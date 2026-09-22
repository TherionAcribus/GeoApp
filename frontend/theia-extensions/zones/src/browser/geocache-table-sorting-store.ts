/**
 * Persistance du tri du tableau des géocaches, une entrée par zone.
 *
 * Même pattern que `friend-outing-store.ts` : les accès `StorageService` sont
 * isolés ici, le widget ne fait qu'orchestrer. Un tri enregistré survit au
 * changement de zone et au redémarrage de l'IDE — chaque zone retrouve son
 * propre tri.
 *
 * Aucune de ces fonctions ne lève : le tri est un confort de lecture, pas une
 * donnée critique. Un stockage indisponible ou une entrée d'une ancienne
 * version dégradent en « pas de tri ».
 */

import { StorageService } from '@theia/core/lib/browser';
import { SortingState } from '@tanstack/react-table';
import { ALL_GEOCACHES_TABLE_COLUMN_IDS } from './geocaches-table';

/** Préfixe des clés de persistance ; une entrée par zone. */
export const GEOCACHE_SORTING_STORAGE_PREFIX = 'geoapp.geocacheSorting.zone.';

/** Clé `StorageService` du tri d'une zone. */
export function geocacheSortingStorageKey(zoneId: number): string {
    return `${GEOCACHE_SORTING_STORAGE_PREFIX}${zoneId}`;
}

/** Colonnes dynamiques hors du menu Colonnes mais triables (mode sortie). */
const SORTABLE_COLUMN_IDS_OUTSIDE_MENU = new Set(['friends_found']);

/**
 * Valide ce qui sort du stockage : une liste de `{ id, desc }` dont les ids
 * désignent des colonnes connues. Les entrées d'une version antérieure ou d'une
 * colonne renommée sont ignorées — jamais une erreur.
 */
export function normalizeGeocacheSorting(raw: unknown): SortingState {
    if (!Array.isArray(raw)) {
        return [];
    }
    const valid = new Set<string>([
        ...ALL_GEOCACHES_TABLE_COLUMN_IDS,
        ...SORTABLE_COLUMN_IDS_OUTSIDE_MENU,
    ]);
    return raw
        .filter((entry): entry is { id: string; desc: boolean } =>
            Boolean(entry) && typeof entry === 'object'
            && typeof (entry as { id?: unknown }).id === 'string'
            && valid.has((entry as { id: string }).id)
            && typeof (entry as { desc?: unknown }).desc === 'boolean')
        .map(entry => ({ id: entry.id, desc: entry.desc }));
}

/** Lit le tri enregistré pour une zone ([] si aucun, ou si illisible). */
export async function loadGeocacheSorting(
    storageService: StorageService,
    zoneId: number
): Promise<SortingState> {
    try {
        const stored = await storageService.getData<unknown>(geocacheSortingStorageKey(zoneId));
        return normalizeGeocacheSorting(stored);
    } catch (error) {
        console.debug('[GeocacheSorting] lecture impossible:', error);
        return [];
    }
}

/**
 * Écrit le tri d'une zone. Un tri vide supprime l'entrée plutôt que d'écrire
 * `[]` — `setData(key, undefined)` efface la clé côté LocalStorageService.
 */
export async function saveGeocacheSorting(
    storageService: StorageService,
    zoneId: number,
    sorting: SortingState
): Promise<void> {
    try {
        await storageService.setData(
            geocacheSortingStorageKey(zoneId),
            sorting.length > 0 ? sorting : undefined
        );
    } catch (error) {
        console.debug('[GeocacheSorting] écriture impossible:', error);
    }
}
