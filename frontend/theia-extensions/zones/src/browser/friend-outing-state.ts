/**
 * Modèle d'état du mode « sortie entre amis ».
 *
 * Une sortie est un objet : la zone, les amis qu'on emmène, et le périmètre de
 * caches qu'on analyse. Tant qu'il n'existait que `activeFriends` + `outingMode`
 * (deux champs indépendants du widget), rien ne disait si l'utilisateur était en
 * train de préparer une sortie ou avait juste coché un ami au passage — et rien ne
 * survivait à la fermeture de l'onglet. `FriendOuting` est désormais la source de
 * vérité : `null` = pas de sortie en cours, un objet = mode sortie actif.
 *
 * Ce fichier ne contient que des types et des fonctions pures ; la persistance vit
 * dans `friend-outing-store.ts`, l'orchestration dans `ZoneGeocachesWidget`.
 */

/** Une sortie en préparation sur une zone. */
export interface FriendOuting {
    zoneId: number;
    /** Pseudos des amis emmenés (pilotent couleurs, analyse et filtres). */
    friends: string[];
    /** Codes GC du périmètre de l'analyse (vide = toute la zone). */
    gcCodes: string[];
    /** ISO 8601, mis à jour à chaque modification. */
    updatedAt: string;
}

/**
 * Filtre de table appliqué **dans** le mode sortie — un sous-état, pas un état
 * parallèle : sortir du mode le remet à `'none'`.
 *
 * - `'none'` : aucun filtre.
 * - `'missing-for:<ami>'` : caches que cet ami n'a pas trouvées.
 * - `'nobody'` / `'everybody'` : caches trouvées par aucun / tous les amis de la
 *   sortie (branchés sur la table dans la phase suivante).
 */
export type FriendFilter = 'none' | 'nobody' | 'everybody' | `missing-for:${string}`;

/**
 * Résumé de la dernière analyse d'amis terminée sur la zone.
 *
 * Il appartient à la sortie : c'est un compte rendu persistant (pas un toast) que
 * l'utilisateur relit en préparant, et il disparaît avec elle.
 */
export interface FriendAnalysisSummary {
    scanned: number;
    skipped: number;
    withFriends: number;
    rateLimited: boolean;
    cancelled: boolean;
    /** ISO 8601. */
    at: string;
}

/** Préfixe des clés de persistance ; une entrée par zone. */
export const FRIEND_OUTING_STORAGE_PREFIX = 'geoapp.friendOuting.zone.';

/** Clé `StorageService` de la sortie d'une zone. */
export function friendOutingStorageKey(zoneId: number): string {
    return `${FRIEND_OUTING_STORAGE_PREFIX}${zoneId}`;
}

/** Construit une sortie horodatée (dédoublonne et trie amis et codes GC). */
export function createFriendOuting(
    zoneId: number,
    friends: string[] = [],
    gcCodes: string[] = [],
    now: () => string = () => new Date().toISOString()
): FriendOuting {
    return {
        zoneId,
        friends: dedupeSorted(friends),
        gcCodes: dedupeSorted(gcCodes),
        updatedAt: now(),
    };
}

/** Recopie une sortie en remplaçant certains champs, avec un nouvel horodatage. */
export function updateFriendOuting(
    outing: FriendOuting,
    changes: { friends?: string[]; gcCodes?: string[] },
    now: () => string = () => new Date().toISOString()
): FriendOuting {
    return createFriendOuting(
        outing.zoneId,
        changes.friends ?? outing.friends,
        changes.gcCodes ?? outing.gcCodes,
        now
    );
}

/**
 * Valide ce qui sort du stockage.
 *
 * Le `StorageService` est du localStorage partagé avec tout Theia : une entrée
 * peut avoir été écrite par une version antérieure, tronquée, ou concerner une
 * autre zone. Tout ce qui n'est pas une sortie exploitable pour `zoneId` est
 * traité comme une absence de sortie — jamais comme une erreur.
 */
export function normalizeFriendOuting(raw: unknown, zoneId: number): FriendOuting | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return null;
    }
    const candidate = raw as Partial<FriendOuting>;
    if (typeof candidate.zoneId !== 'number' || candidate.zoneId !== zoneId) {
        return null;
    }
    return {
        zoneId,
        friends: dedupeSorted(toStringArray(candidate.friends)),
        gcCodes: dedupeSorted(toStringArray(candidate.gcCodes)),
        updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date().toISOString(),
    };
}

/** Filtre « manquantes pour X » à partir d'un pseudo (null = pas de filtre). */
export function missingForFriendFilter(friend: string | null): FriendFilter {
    return friend ? `missing-for:${friend}` : 'none';
}

/** Pseudo visé par un filtre « manquantes pour X », sinon null. */
export function friendOfFilter(filter: FriendFilter): string | null {
    if (filter.startsWith('missing-for:')) {
        const friend = filter.slice('missing-for:'.length);
        return friend.length > 0 ? friend : null;
    }
    return null;
}

/**
 * Périmètre effectif à envoyer à l'analyse.
 *
 * Une sortie « toute la zone » ne doit pas envoyer la liste complète des codes GC :
 * le backend n'appliquerait alors ni l'estimation préalable ni le skip incrémental
 * des amis récemment scannés. On ne cible que si le périmètre est un vrai
 * sous-ensemble des caches de la zone.
 */
export function outingScopeGcCodes(outing: FriendOuting | null, zoneGcCodes: string[]): string[] | undefined {
    if (!outing || outing.gcCodes.length === 0) {
        return undefined;
    }
    const scope = outing.gcCodes.filter(code => zoneGcCodes.includes(code));
    if (scope.length === 0 || scope.length >= zoneGcCodes.length) {
        return undefined;
    }
    return scope;
}

function toStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

function dedupeSorted(values: string[]): string[] {
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
}
