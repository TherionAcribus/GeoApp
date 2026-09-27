/**
 * État de couverture d'un ami sur une zone, et état d'une cellule ami × cache.
 *
 * Le point de vigilance du panneau d'analyse : « pas de trouvaille enregistrée »
 * n'est pas « n'a pas trouvé ». Sans scan complet et récent sur la zone,
 * l'absence dans `friend_find` veut seulement dire « on n'a pas vérifié » —
 * présenter une croix à la place transformerait une lacune de données en
 * affirmation fausse.
 *
 * Fonctions pures, sans dépendance à React : le widget, le panneau latéral et
 * les tests les partagent.
 */

import type { FriendZoneScanEntry } from './friends-types';

/**
 * Couverture de l'analyse d'un ami sur une zone :
 *
 * - `unscanned` : jamais analysé sur cette zone ;
 * - `partial`   : analysé, mais le scan était tronqué (pagination plafonnée,
 *   throttling 429, caches en échec) — couverture incomplète ;
 * - `stale`     : analysé, mais obsolète (zone modifiée ou scan ancien) ;
 * - `fresh`     : analysé récemment, boîte inchangée, scan complet.
 */
export type FriendScanCoverage = 'unscanned' | 'partial' | 'stale' | 'fresh';

export function scanCoverage(scan: FriendZoneScanEntry | undefined): FriendScanCoverage {
    if (!scan || !scan.scanned) {
        return 'unscanned';
    }
    if (scan.truncated) {
        return 'partial';
    }
    if (scan.is_stale) {
        return 'stale';
    }
    return 'fresh';
}

/**
 * L'absence de trouvaille n'est une information fiable que sur une couverture
 * complète et à jour. Sur toute autre couverture, elle reste une inconnue.
 */
export function coverageReliable(coverage: FriendScanCoverage): boolean {
    return coverage === 'fresh';
}

/**
 * État d'une cellule ami × cache de la matrice :
 *
 * - `found`     : trouvaille connue (preuve dans `friend_find`) ;
 * - `not_found` : pas de trouvaille **et** couverture fiable ;
 * - `unknown`   : pas de trouvaille, couverture insuffisante — à vérifier.
 */
export type FriendFindCell = 'found' | 'not_found' | 'unknown';

export function friendFindCell(found: boolean, coverage: FriendScanCoverage): FriendFindCell {
    if (found) {
        return 'found';
    }
    return coverageReliable(coverage) ? 'not_found' : 'unknown';
}

/** Libellé court du statut d'analyse, pour les listes d'amis. */
export function coverageLabel(coverage: FriendScanCoverage): string {
    switch (coverage) {
        case 'unscanned': return 'non analysé';
        case 'partial': return 'partielle';
        case 'stale': return 'obsolète';
        default: return 'à jour';
    }
}
