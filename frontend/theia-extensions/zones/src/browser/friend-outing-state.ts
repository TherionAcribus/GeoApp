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
    /** Nom affiché (« Samedi avec les anciens ») ; identité dans la zone. */
    name: string;
    /** Pseudos des amis emmenés (pilotent couleurs, analyse et filtres). */
    friends: string[];
    /** Codes GC du périmètre de l'analyse (vide = toute la zone). */
    gcCodes: string[];
    /** ISO 8601, mis à jour à chaque modification. */
    updatedAt: string;
}

/**
 * Les sorties enregistrées d'une zone : plusieurs préparations nommées, une
 * seule active à la fois — celle dont le mode est en cours. `activeName`
 * `null` = sorties conservées mais mode quitté : rouvrir la zone ne doit pas
 * ressusciter le mode sans que l'utilisateur l'ait demandé.
 */
export interface ZoneOutings {
    zoneId: number;
    outings: FriendOuting[];
    /** Nom de la sortie active (orthographe stockée, comparaison sans casse). */
    activeName: string | null;
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
    /** Scan logbook : caches parcourues / en échec (absent en zone search). */
    cachesScanned?: number;
    cacheErrors?: number;
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
    name: string,
    friends: string[] = [],
    gcCodes: string[] = [],
    now: () => string = () => new Date().toISOString()
): FriendOuting {
    return {
        zoneId,
        name: name.trim() || DEFAULT_OUTING_NAME,
        friends: dedupeSorted(friends),
        gcCodes: dedupeSorted(gcCodes),
        updatedAt: now(),
    };
}

export const DEFAULT_OUTING_NAME = 'Sortie';

/** Nombre maximal de sorties nommées par zone (comme les groupes : borne anti-accumulation). */
export const MAX_ZONE_OUTINGS = 20;

/** Recopie une sortie en remplaçant certains champs, avec un nouvel horodatage. */
export function updateFriendOuting(
    outing: FriendOuting,
    changes: { name?: string; friends?: string[]; gcCodes?: string[] },
    now: () => string = () => new Date().toISOString()
): FriendOuting {
    return createFriendOuting(
        outing.zoneId,
        changes.name ?? outing.name,
        changes.friends ?? outing.friends,
        changes.gcCodes ?? outing.gcCodes,
        now
    );
}

/**
 * Premier nom libre « Sortie », « Sortie 2 »… pour une nouvelle sortie.
 * La comparaison ignore la casse, comme l'identité des groupes.
 */
export function nextOutingName(outings: FriendOuting[], base: string = DEFAULT_OUTING_NAME): string {
    const taken = new Set(outings.map(o => o.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) {
        return base;
    }
    for (let index = 2; ; index++) {
        const candidate = `${base} ${index}`;
        if (!taken.has(candidate.toLowerCase())) {
            return candidate;
        }
    }
}

/** La sortie de `set` nommée `name`, insensible à la casse. */
export function findZoneOuting(set: ZoneOutings, name: string): FriendOuting | undefined {
    const needle = name.trim().toLowerCase();
    return set.outings.find(o => o.name.toLowerCase() === needle);
}

/**
 * Ajoute ou remplace une sortie dans l'ensemble (même nom, casse ignorée) et
 * la rend active. `null` si la limite est atteinte pour une nouvelle entrée.
 */
export function upsertZoneOuting(set: ZoneOutings, outing: FriendOuting): ZoneOutings | null {
    const existing = set.outings.findIndex(o => o.name.toLowerCase() === outing.name.toLowerCase());
    if (existing < 0 && set.outings.length >= MAX_ZONE_OUTINGS) {
        return null;
    }
    const outings = existing >= 0
        ? [...set.outings.slice(0, existing), outing, ...set.outings.slice(existing + 1)]
        : [...set.outings, outing];
    return { zoneId: set.zoneId, outings, activeName: outing.name };
}

/**
 * Retire une sortie de l'ensemble ; si c'était l'active, le mode est quitté
 * (`activeName` repasse à `null`) plutôt que basculé sur une autre sortie —
 * l'utilisateur vient de la supprimer, pas de changer d'avis.
 */
export function removeZoneOuting(set: ZoneOutings, name: string): ZoneOutings {
    const needle = name.trim().toLowerCase();
    const outings = set.outings.filter(o => o.name.toLowerCase() !== needle);
    const activeName = set.activeName?.toLowerCase() === needle ? null : set.activeName ?? null;
    return { zoneId: set.zoneId, outings, activeName };
}

/** Désactive la sortie courante sans la supprimer (« quitter le mode »). */
export function deactivateZoneOutings(set: ZoneOutings): ZoneOutings {
    return { ...set, activeName: null };
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
        name: typeof candidate.name === 'string' ? candidate.name : '',
        friends: dedupeSorted(toStringArray(candidate.friends)),
        gcCodes: dedupeSorted(toStringArray(candidate.gcCodes)),
        updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date().toISOString(),
    };
}

/**
 * Valide l'ensemble des sorties d'une zone lu dans le stockage.
 *
 * Deux formats coexistent sur la même clé : le format courant
 * (`{ zoneId, outings, activeName }`) et l'ancien format « une seule sortie »
 * (`FriendOuting` à plat, sans nom). Une sortie anonyme restaurée devient
 * « Sortie », active puisque c'est ce qu'elle était avant.
 */
export function normalizeZoneOutings(raw: unknown, zoneId: number): ZoneOutings | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return null;
    }
    const candidate = raw as { zoneId?: unknown; outings?: unknown; activeName?: unknown };
    if (candidate.zoneId !== zoneId) {
        return null;
    }
    if (Array.isArray(candidate.outings)) {
        const outings = candidate.outings
            .map(entry => normalizeFriendOuting(entry, zoneId))
            // Une sortie sans nom est inadressable (l'identité est le nom) :
            // elle ne peut venir que d'un stockage corrompu — écartée.
            .filter((o): o is FriendOuting => o !== null && o.name.length > 0)
            .slice(0, MAX_ZONE_OUTINGS);
        const activeName = typeof candidate.activeName === 'string' ? candidate.activeName : null;
        return {
            zoneId,
            outings,
            activeName: activeName && outings.some(o => o.name.toLowerCase() === activeName.toLowerCase())
                ? activeName
                : null,
        };
    }
    // Ancien format : la sortie elle-même, sans nom.
    const legacy = normalizeFriendOuting(raw, zoneId);
    if (!legacy) {
        return null;
    }
    const migrated = { ...legacy, name: legacy.name || DEFAULT_OUTING_NAME };
    return { zoneId, outings: [migrated], activeName: migrated.name };
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
