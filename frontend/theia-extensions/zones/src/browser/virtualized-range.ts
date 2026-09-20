/**
 * Calcul de fenêtre pour `virtualized-list.tsx`.
 *
 * Pur — sans DOM ni React — pour être testé hors du navigateur.
 */

export interface VirtualWindowRange {
    /** Premier élément à monter ; `count` quand la fenêtre est sous la liste. */
    startIndex: number;
    /** Dernier élément à monter, inclus ; `startIndex - 1` quand rien ne l'est. */
    endIndex: number;
}

/**
 * Fenêtre `[startIndex, endIndex]` des éléments à monter pour couvrir
 * `[visibleTop, visibleBottom]`, exprimés dans le repère de la liste (overscan
 * déjà inclus par l'appelant).
 *
 * `offsets[i]` est la position du haut de l'élément `i` ; l'espacement `gap` est
 * rattaché à l'empreinte de l'élément qui le précède.
 */
export function computeWindowRange(
    offsets: readonly number[],
    heightAt: (index: number) => number,
    gap: number,
    visibleTop: number,
    visibleBottom: number,
): VirtualWindowRange {
    const count = offsets.length;
    let startIndex = count;
    for (let i = 0; i < count; i++) {
        if (offsets[i] + heightAt(i) + gap > visibleTop) {
            startIndex = i;
            break;
        }
    }
    let endIndex = startIndex - 1;
    for (let i = Math.max(0, startIndex); i < count; i++) {
        if (offsets[i] >= visibleBottom) {
            break;
        }
        endIndex = i;
    }
    return { startIndex, endIndex };
}
