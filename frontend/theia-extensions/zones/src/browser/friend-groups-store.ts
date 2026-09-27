/**
 * Persistance des groupes d'amis (clé unique `geoapp.friendGroups`).
 *
 * Même pattern que `friend-outing-store.ts` : les accès `StorageService` sont
 * isolés ici, et aucune fonction ne lève — un stockage indisponible dégrade en
 * « pas de groupes », les groupes sont un confort de préparation.
 */

import { StorageService } from '@theia/core/lib/browser';
import {
    FRIEND_GROUPS_STORAGE_KEY,
    FriendGroup,
    normalizeFriendGroups,
} from './friend-groups-state';

/** Lit les groupes enregistrés ([] si aucun, ou si illisible). */
export async function loadFriendGroups(
    storageService: StorageService
): Promise<FriendGroup[]> {
    try {
        const stored = await storageService.getData<unknown>(FRIEND_GROUPS_STORAGE_KEY);
        return normalizeFriendGroups(stored);
    } catch (error) {
        console.debug('[FriendGroups] lecture impossible:', error);
        return [];
    }
}

/** Écrit la liste complète des groupes (écrase l'entrée précédente). */
export async function saveFriendGroups(
    storageService: StorageService,
    groups: FriendGroup[]
): Promise<void> {
    try {
        await storageService.setData(FRIEND_GROUPS_STORAGE_KEY, groups);
    } catch (error) {
        console.debug('[FriendGroups] écriture impossible:', error);
    }
}
