/**
 * Persistance du mode « sortie entre amis », une entrée par zone.
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
import { FriendOuting, friendOutingStorageKey, normalizeFriendOuting } from './friend-outing-state';

/** Lit la sortie enregistrée pour une zone (null si aucune, ou si illisible). */
export async function loadFriendOuting(
    storageService: StorageService,
    zoneId: number
): Promise<FriendOuting | null> {
    try {
        const stored = await storageService.getData<unknown>(friendOutingStorageKey(zoneId));
        return normalizeFriendOuting(stored, zoneId);
    } catch (error) {
        console.debug('[FriendOuting] lecture impossible:', error);
        return null;
    }
}

/** Écrit la sortie d'une zone (écrase l'entrée précédente). */
export async function saveFriendOuting(
    storageService: StorageService,
    outing: FriendOuting
): Promise<void> {
    try {
        await storageService.setData(friendOutingStorageKey(outing.zoneId), outing);
    } catch (error) {
        console.debug('[FriendOuting] écriture impossible:', error);
    }
}

/** Supprime l'entrée d'une zone (sortie terminée). */
export async function clearFriendOuting(
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
