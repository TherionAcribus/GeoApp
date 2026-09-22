/**
 * Persistance de l'origine des distances du tableau des géocaches, une entrée
 * par zone.
 *
 * Même pattern que `geocache-table-sorting-store.ts` : les accès
 * `StorageService` sont isolés ici, le widget ne fait qu'orchestrer. L'origine
 * (point depuis lequel la colonne « Distance » et le filtre `@distance:` sont
 * calculés) est définie par clic droit sur une ligne ; elle survit au
 * changement de zone et au redémarrage de l'IDE.
 *
 * Aucune de ces fonctions ne lève : c'est un repère de lecture, pas une donnée
 * critique. Un stockage indisponible ou une entrée dégradée deviennent « pas
 * d'origine ».
 */

import { StorageService } from '@theia/core/lib/browser';

/** Point de référence des distances affichées dans le tableau d'une zone. */
export interface DistanceOrigin {
    lat: number;
    lon: number;
    /** Libellé affiché (code GC de la cache d'origine, le plus souvent). */
    label?: string;
}

/** Préfixe des clés de persistance ; une entrée par zone. */
export const DISTANCE_ORIGIN_STORAGE_PREFIX = 'geoapp.distanceOrigin.zone.';

/** Clé `StorageService` de l'origine des distances d'une zone. */
export function distanceOriginStorageKey(zoneId: number): string {
    return `${DISTANCE_ORIGIN_STORAGE_PREFIX}${zoneId}`;
}

/**
 * Valide ce qui sort du stockage : un `{ lat, lon, label? }` avec des
 * coordonnées finies dans leurs bornes. Tout le reste devient « pas
 * d'origine » — jamais une erreur.
 */
export function normalizeDistanceOrigin(raw: unknown): DistanceOrigin | undefined {
    if (!raw || typeof raw !== 'object') {
        return undefined;
    }
    const { lat, lon, label } = raw as { lat?: unknown; lon?: unknown; label?: unknown };
    if (typeof lat !== 'number' || typeof lon !== 'number'
        || !Number.isFinite(lat) || !Number.isFinite(lon)
        || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        return undefined;
    }
    return { lat, lon, label: typeof label === 'string' ? label : undefined };
}

/** Lit l'origine des distances d'une zone (undefined si aucune, ou illisible). */
export async function loadDistanceOrigin(
    storageService: StorageService,
    zoneId: number
): Promise<DistanceOrigin | undefined> {
    try {
        const stored = await storageService.getData<unknown>(distanceOriginStorageKey(zoneId));
        return normalizeDistanceOrigin(stored);
    } catch (error) {
        console.debug('[DistanceOrigin] lecture impossible:', error);
        return undefined;
    }
}

/**
 * Écrit l'origine des distances d'une zone. `undefined` supprime l'entrée —
 * `setData(key, undefined)` efface la clé côté LocalStorageService.
 */
export async function saveDistanceOrigin(
    storageService: StorageService,
    zoneId: number,
    origin: DistanceOrigin | undefined
): Promise<void> {
    try {
        await storageService.setData(distanceOriginStorageKey(zoneId), origin);
    } catch (error) {
        console.debug('[DistanceOrigin] écriture impossible:', error);
    }
}
