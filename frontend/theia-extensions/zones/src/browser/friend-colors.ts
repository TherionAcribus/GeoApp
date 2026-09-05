/**
 * Couleur stable par ami.
 *
 * La même couleur identifie un ami partout : puce du panneau de sortie, colonne
 * « 👥 » du tableau, code couleur des lignes. Elle est dérivée du pseudo par un
 * hash, sans état ni ordre d'affichage — deux vues rendues séparément tombent
 * donc sur la même couleur pour le même ami, et l'ordre des cases cochées ne la
 * fait pas changer sous les yeux de l'utilisateur.
 *
 * Extrait de `friend-chips-bar.tsx`, qui disparaît avec la barre de puces.
 */

/** Palette : teintes distinctes, lisibles sur fond clair comme sur fond sombre. */
const FRIEND_PALETTE = [
    '#4caf50', // vert
    '#2196f3', // bleu
    '#9c27b0', // violet
    '#ff5722', // orange foncé
    '#00bcd4', // cyan
    '#e91e63', // rose
    '#8bc34a', // vert clair
    '#ffc107', // ambre
];

/** Couleur stable pour un pseudo (hash → palette). */
export function friendColor(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
    }
    return FRIEND_PALETTE[Math.abs(hash) % FRIEND_PALETTE.length];
}
