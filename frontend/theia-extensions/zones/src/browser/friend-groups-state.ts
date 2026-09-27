/**
 * Groupes d'amis réutilisables (« Équipe du samedi », « Famille »…).
 *
 * Un groupe n'est qu'un nom + une liste de pseudos : il n'a pas de zone ni de
 * périmètre — c'est la sortie qui les porte. Appliquer un groupe remplace les
 * amis cochés de la sortie courante.
 *
 * Fonctions pures, sans dépendance à Theia : la persistance vit dans
 * `friend-groups-store.ts`, l'orchestration dans `ZoneGeocachesWidget`.
 */

/** Un groupe nommé d'amis. */
export interface FriendGroup {
    name: string;
    /** Pseudos des membres, dédoublonnés et triés. */
    friends: string[];
    /** ISO 8601, mis à jour à chaque modification. */
    updatedAt: string;
}

/** Clé `StorageService` unique : les groupes sont globaux, pas par zone. */
export const FRIEND_GROUPS_STORAGE_KEY = 'geoapp.friendGroups';

/** Nombre maximum de groupes conservés : au-delà, la liste devient inutilisable. */
export const FRIEND_GROUPS_MAX = 50;

/**
 * Valide ce qui sort du stockage : tout ce qui n'est pas une liste de groupes
 * exploitables est traité comme « aucun groupe » — jamais comme une erreur.
 */
export function normalizeFriendGroups(raw: unknown): FriendGroup[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const groups: FriendGroup[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            continue;
        }
        const candidate = item as Partial<FriendGroup>;
        const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
        if (!name || seen.has(name.toLowerCase())) {
            continue;
        }
        seen.add(name.toLowerCase());
        groups.push({
            name,
            friends: dedupeSorted(toStringArray(candidate.friends)),
            updatedAt: typeof candidate.updatedAt === 'string'
                ? candidate.updatedAt
                : new Date().toISOString(),
        });
    }
    return sortFriendGroups(groups);
}

/**
 * Enregistre un groupe : remplace celui du même nom (comparaison insensible à
 * la casse — « samedi » et « Samedi » désignent le même groupe), ou l'ajoute.
 *
 * `null` si le nom est vide ou si la limite `FRIEND_GROUPS_MAX` serait dépassée
 * par une création (le remplacement d'un groupe existant est toujours permis).
 */
export function upsertFriendGroup(
    groups: FriendGroup[],
    name: string,
    friends: string[],
    now: () => string = () => new Date().toISOString()
): FriendGroup[] | null {
    const trimmed = name.trim();
    if (!trimmed) {
        return null;
    }
    const existing = groups.findIndex(g => g.name.toLowerCase() === trimmed.toLowerCase());
    if (existing < 0 && groups.length >= FRIEND_GROUPS_MAX) {
        return null;
    }
    const group: FriendGroup = {
        name: trimmed,
        friends: dedupeSorted(friends),
        updatedAt: now(),
    };
    const next = existing < 0
        ? [...groups, group]
        : groups.map((g, i) => (i === existing ? group : g));
    return sortFriendGroups(next);
}

/** Supprime le groupe de ce nom (insensible à la casse). */
export function removeFriendGroup(groups: FriendGroup[], name: string): FriendGroup[] {
    const needle = name.trim().toLowerCase();
    return groups.filter(g => g.name.toLowerCase() !== needle);
}

/** Recherche insensible à la casse (les actions UI viennent d'un select). */
export function findFriendGroup(groups: FriendGroup[], name: string): FriendGroup | undefined {
    const needle = name.trim().toLowerCase();
    return groups.find(g => g.name.toLowerCase() === needle);
}

function toStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
        : [];
}

function dedupeSorted(values: string[]): string[] {
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
}

function sortFriendGroups(groups: FriendGroup[]): FriendGroup[] {
    return [...groups].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
}
