/**
 * Suggestions de caches pour une sortie, dérivées de la matrice
 * « qui a trouvé quoi » : les caches **nouvelles pour le plus d'amis
 * emmenés** remontent en tête.
 *
 * Même règle que la matrice et l'export : une absence ne compte que si la
 * couverture de l'ami est à jour (`newFor`). Les absences non vérifiables
 * restent visibles dans `toCheck` — une cache « nouvelle pour tout le monde
 * sauf un scan tronqué » est une bonne suggestion, mais le doute doit rester
 * affiché plutôt que masqué.
 *
 * Fonctions pures : le panneau latéral rend, les tests vérifient.
 */

import type { Geocache } from './geocaches-table';
import type { FriendZoneScanEntry } from './friends-types';
import { friendFindCell, scanCoverage } from './friend-scan-state';

export interface OutingSuggestion {
    geocache: Geocache;
    /** Amis pour qui l'absence est confirmée (analyse à jour). */
    newFor: string[];
    /** Amis dont l'état n'est pas vérifiable (scan absent/partiel/obsolète). */
    toCheck: string[];
    /** Amis ayant déjà trouvé la cache. */
    foundBy: string[];
}

/**
 * Les suggestions de la sortie : caches du périmètre nouvelles pour au moins
 * un ami, triées par nombre d'absences confirmées décroissant — à fiabilité
 * égale, une cache sans doute (`toCheck` vide) passe devant.
 */
export function outingSuggestions(
    rows: Geocache[],
    friendNames: string[],
    friendFinds: Record<string, string[]>,
    friendScans: FriendZoneScanEntry[]
): OutingSuggestion[] {
    const scanByFriend = new Map(friendScans.map(s => [s.friend, s]));
    const foundSets = new Map<string, Set<string>>();
    for (const name of friendNames) {
        const set = new Set<string>();
        for (const [gcCode, finders] of Object.entries(friendFinds)) {
            if (finders.includes(name)) {
                set.add(gcCode);
            }
        }
        foundSets.set(name, set);
    }

    const suggestions: OutingSuggestion[] = [];
    for (const geocache of rows) {
        const suggestion: OutingSuggestion = { geocache, newFor: [], toCheck: [], foundBy: [] };
        for (const name of friendNames) {
            const cell = friendFindCell(
                foundSets.get(name)?.has(geocache.gc_code) === true,
                scanCoverage(scanByFriend.get(name))
            );
            if (cell === 'found') {
                suggestion.foundBy.push(name);
            } else if (cell === 'not_found') {
                suggestion.newFor.push(name);
            } else {
                suggestion.toCheck.push(name);
            }
        }
        if (suggestion.newFor.length > 0) {
            suggestions.push(suggestion);
        }
    }

    suggestions.sort((a, b) =>
        b.newFor.length - a.newFor.length
        || a.toCheck.length - b.toCheck.length
        || a.geocache.name.localeCompare(b.geocache.name)
    );
    return suggestions;
}
