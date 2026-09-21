/**
 * Pourcentage de points favoris : quel dénominateur, et quand se taire.
 *
 * Ce qui se teste ici est la règle partagée par le tableau d'une zone et par
 * l'éditeur de logs. Le bug d'origine — diviser par le nombre de logs stockés
 * en local — donnait 200 % sur GC8QY1G ; aucun chemin ne doit y revenir.
 */
import * as assert from 'assert/strict';
import {
    FavoritePercentSource,
    favoritePercent,
    favoritePercentHint,
    formatFavoritePercent,
} from '../favorite-percent';

function testBackendValueWins(): void {
    // Le backend a déjà divisé par `finds_count` : on ne recalcule pas.
    const result = favoritePercent({ favorites_count: 102, favorites_percent: 61.8, finds_count: 165 });
    assert.deepEqual(result, { value: 61.8, approximate: false });
    assert.equal(formatFavoritePercent({ favorites_percent: 61.8 }), '61.8%');
}

function testFallsBackToFindsCount(): void {
    // Payload sans `favorites_percent` (vue plus ancienne) : le calcul local
    // prend le même dénominateur que le backend.
    const result = favoritePercent({ favorites_count: 50, finds_count: 200 });
    assert.deepEqual(result, { value: 25, approximate: false });
}

function testApproximatesOnTheTotalLogs(): void {
    // Cache jamais re-scrapée : pas de `finds_count`. Le total de logs tous
    // types confondus sous-estime le pourcentage, d'où le `~`.
    const gc = { favorites_count: 102, logs_total_available: 171 };
    assert.equal(favoritePercent(gc).approximate, true);
    assert.equal(formatFavoritePercent(gc), '~59.6%');
    assert.notEqual(favoritePercentHint(gc), '');
}

function testNeverDividesByStoredLogs(): void {
    // Le cas GC8QY1G : 102 PF pour 51 logs stockés, qui donnait 200 %.
    // `logs_count` n'entre pas dans le calcul — la fonction ne le lit même pas.
    const gc = { favorites_count: 102, logs_count: 51 } as FavoritePercentSource;
    assert.equal(favoritePercent(gc).value, undefined);
    assert.equal(formatFavoritePercent(gc), '—');
}

function testUnknownWithoutAnyDenominator(): void {
    assert.deepEqual(favoritePercent({ favorites_count: 12 }), { approximate: false });
    assert.equal(formatFavoritePercent({ favorites_count: 12 }), '—');
}

function testUnknownWithoutFavorites(): void {
    // Aucun compteur de favoris : rien à afficher, même avec un dénominateur.
    assert.equal(favoritePercent({ finds_count: 165 }).value, undefined);
}

function testZeroFindsIsNotZeroPercent(): void {
    // Personne n'a trouvé la cache : la division est impossible, et « 0 % »
    // laisserait croire que des trouvailles ont eu lieu sans favori.
    assert.equal(favoritePercent({ favorites_count: 0, finds_count: 0 }).value, undefined);
    assert.equal(favoritePercent({ favorites_count: 0, logs_total_available: 0 }).value, undefined);
}

function testZeroFavoritesIsZeroPercent(): void {
    // En revanche 0 favori sur 40 trouvailles est bien 0 %, pas « inconnu ».
    assert.deepEqual(favoritePercent({ favorites_count: 0, finds_count: 40 }), { value: 0, approximate: false });
    assert.equal(formatFavoritePercent({ favorites_count: 0, finds_count: 40 }), '0.0%');
}

function testExactPercentHasNoHint(): void {
    assert.equal(favoritePercentHint({ favorites_percent: 61.8 }), '');
}

testBackendValueWins();
testFallsBackToFindsCount();
testApproximatesOnTheTotalLogs();
testNeverDividesByStoredLogs();
testUnknownWithoutAnyDenominator();
testUnknownWithoutFavorites();
testZeroFindsIsNotZeroPercent();
testZeroFavoritesIsZeroPercent();
testExactPercentHasNoHint();

console.log('favorite-percent.test.ts OK');
