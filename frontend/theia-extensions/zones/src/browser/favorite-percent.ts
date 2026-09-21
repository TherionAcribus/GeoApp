/**
 * Pourcentage de points favoris d'une géocache.
 *
 * Partagé par le tableau d'une zone et par l'éditeur de logs, qui l'affichaient
 * autrefois chacun avec leur propre calcul — et le même bug : diviser par le
 * nombre de logs stockés en local donnait des valeurs supérieures à 100 %.
 *
 * Voir `documentation/logs-chargement-technique.md`, § « Combien de trouvailles,
 * et le pourcentage de favoris ».
 */

/** Pourcentage de favoris d'une géocache, avec son degré de certitude. */
export interface FavoritePercent {
    /** Valeur en pourcents, `undefined` quand aucun dénominateur n'est connu. */
    value?: number;
    /**
     * Calculé sur le total de logs tous types confondus faute de compteur de
     * trouvailles : la valeur est alors sous-estimée et s'affiche avec un `~`.
     */
    approximate: boolean;
}

/** Les champs dont dérive le pourcentage, tels que le backend les sérialise. */
export interface FavoritePercentSource {
    favorites_count?: number;
    favorites_percent?: number;
    finds_count?: number;
    logs_total_available?: number;
}

/**
 * Pourcentage de favoris d'une géocache.
 *
 * Le dénominateur est le nombre de trouvailles annoncé par Geocaching.com, jamais
 * `logs_count` qui ne compte que les logs rafraîchis en local et produirait des
 * valeurs supérieures à 100 %. Une cache pas encore re-scrapée n'a pas de
 * `finds_count` : on retombe sur le total de logs du site, qui donne un ordre de
 * grandeur sous-estimé plutôt que rien.
 */
export function favoritePercent(gc: FavoritePercentSource): FavoritePercent {
    if (typeof gc.favorites_percent === 'number' && isFinite(gc.favorites_percent)) {
        return { value: gc.favorites_percent, approximate: false };
    }
    if (typeof gc.favorites_count !== 'number') {
        return { approximate: false };
    }
    if (typeof gc.finds_count === 'number' && gc.finds_count > 0) {
        return { value: (gc.favorites_count / gc.finds_count) * 100, approximate: false };
    }
    if (typeof gc.logs_total_available === 'number' && gc.logs_total_available > 0) {
        return { value: (gc.favorites_count / gc.logs_total_available) * 100, approximate: true };
    }
    return { approximate: false };
}

/** Formate un pourcentage de points favoris. */
export function formatFavoritePercent(gc: FavoritePercentSource): string {
    const { value, approximate } = favoritePercent(gc);
    if (typeof value !== 'number' || !isFinite(value)) {
        return '—';
    }
    return `${approximate ? '~' : ''}${value.toFixed(1)}%`;
}

/** Infobulle qui explique un pourcentage estimé ; vide quand il est exact. */
export function favoritePercentHint(gc: FavoritePercentSource): string {
    return favoritePercent(gc).approximate
        ? 'Estimation : le nombre de trouvailles est inconnu, le total de logs sert de dénominateur. Rafraîchir la cache donnera la valeur exacte.'
        : '';
}
