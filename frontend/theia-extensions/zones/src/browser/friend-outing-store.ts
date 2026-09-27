/**
 * Persistance des sorties « entre amis », une entrée par zone.
 *
 * Une entrée contient toutes les sorties nommées de la zone et laquelle est
 * active (`ZoneOutings`). L'ancien format « une seule sortie à plat » est
 * migré à la lecture par `normalizeZoneOutings`.
 *
 * Même pattern que `log-editor/log-history-store.ts` : les accès `StorageService`
 * sont isolés ici, le widget ne fait qu'orchestrer. Une sortie survit donc à la
 * fermeture de l'onglet et au redémarrage de l'IDE — préparer une sortie prend
 * plusieurs analyses réseau, la perdre en fermant un onglet coûtait cher.
 *
 * Aucune de ces fonctions ne lève : la sortie est un confort de préparation, pas
 * une donnée critique. Un stockage indisponible dégrade en « pas de sortie ».
 */

import { StorageService } from '@theia/core/lib/browser';
import { ZoneOutings, friendOutingStorageKey, normalizeZoneOutings } from './friend-outing-state';

/** Lit les sorties enregistrées pour une zone (null si aucune, ou si illisible). */
export async function loadZoneOutings(
    storageService: StorageService,
    zoneId: number
): Promise<ZoneOutings | null> {
    try {
        const stored = await storageService.getData<unknown>(friendOutingStorageKey(zoneId));
        return normalizeZoneOutings(stored, zoneId);
    } catch (error) {
        console.debug('[FriendOuting] lecture impossible:', error);
        return null;
    }
}

/** Écrit l'ensemble des sorties d'une zone (écrase l'entrée précédente). */
export async function saveZoneOutings(
    storageService: StorageService,
    outings: ZoneOutings
): Promise<void> {
    try {
        await storageService.setData(friendOutingStorageKey(outings.zoneId), outings);
    } catch (error) {
        console.debug('[FriendOuting] écriture impossible:', error);
    }
}

/** Supprime l'entrée d'une zone (plus aucune sortie enregistrée). */
export async function clearZoneOutings(
    storageService: StorageService,
    zoneId: number
): Promise<void> {
    try {
        // `setData(key, undefined)` supprime la clé côté LocalStorageService.
        await storageService.setData(friendOutingStorageKey(zoneId), undefined);
    } catch (error) {
        console.debug('[FriendOuting] suppression impossible:', error);
    }
}
