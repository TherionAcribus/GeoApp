/**
 * Export CSV de la préparation de sortie : la matrice « qui a trouvé quoi »
 * emmenée hors de GeoApp — partage, impression, tableur.
 *
 * Chaque cellule ami × cache reprend la même sémantique que la matrice :
 * `oui` (trouvaille connue), `non` (analyse complète et à jour, pas de
 * trouvaille), `?` (à vérifier — scan absent, partiel ou obsolète). Mélanger
 * `non` et `?` en un seul « non » exporterait des faux négatifs.
 *
 * Fonctions pures : le téléchargement vit dans le widget, les tests ici.
 */

import type { Geocache } from './geocaches-table';
import type { FriendZoneScanEntry } from './friends-types';
import { friendFindCell, scanCoverage } from './friend-scan-state';

/** Valeurs de cellule exportées (CSV en français, séparateur `;`). */
export const OUTING_CELL_LABELS: Record<string, string> = {
    found: 'oui',
    not_found: 'non',
    unknown: '?',
};

function escapeCell(value: string): string {
    // RFC 4180 : doublement des guillemets, encadrement si séparateur ou saut.
    if (/[";\n\r]/.test(value)) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}

/**
 * Matrice des caches du périmètre × amis de la sortie.
 *
 * En-tête : `gc_code;nom;type;D;T;<ami>…;nouvelle_pour;a_verifier`.
 * `nouvelle_pour` compte les absences **confirmées** (couverture à jour),
 * `a_verifier` les inconnues — la colonne qui évite de conclure « personne ne
 * l'a faite » sur un simple trou de données.
 */
export function outingMatrixCsv(
    rows: Geocache[],
    friendNames: string[],
    friendFinds: Record<string, string[]>,
    friendScans: FriendZoneScanEntry[]
): string {
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

    const header = [
        'gc_code', 'nom', 'type', 'difficulte', 'terrain',
        ...friendNames,
        'nouvelle_pour', 'a_verifier',
    ];
    const lines = [header.map(escapeCell).join(';')];

    for (const gc of rows) {
        const cells: string[] = [];
        let newFor = 0;
        let toCheck = 0;
        for (const name of friendNames) {
            const cell = friendFindCell(
                foundSets.get(name)?.has(gc.gc_code) === true,
                scanCoverage(scanByFriend.get(name)),
            );
            if (cell === 'not_found') {
                newFor += 1;
            } else if (cell === 'unknown') {
                toCheck += 1;
            }
            cells.push(OUTING_CELL_LABELS[cell]);
        }
        lines.push([
            gc.gc_code,
            gc.name,
            gc.cache_type ?? '',
            String(gc.difficulty ?? ''),
            String(gc.terrain ?? ''),
            ...cells,
            String(newFor),
            String(toCheck),
        ].map(escapeCell).join(';'));
    }

    // BOM UTF-8 : Excel ouvre le CSV en Latin-1 sinon, et les accents partent
    // en vrille.
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
