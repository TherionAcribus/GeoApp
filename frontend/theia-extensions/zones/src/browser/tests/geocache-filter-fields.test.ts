/**
 * Champs filtrables d'une géocache : alias saisis et champs proposés.
 *
 * Ce qui se teste ici est la frontière entre les deux listes de champs. Les
 * résultats de recherche Geocaching.com n'ont ni pourcentage de favoris ni
 * compteur de trouvailles : proposer ces filtres dans « importer autour »
 * donnerait un filtre qui ne trouve jamais rien.
 */
import * as assert from 'assert/strict';
import {
    STANDARD_GEOCACHE_FIELD_DEFINITIONS,
    ZONE_GEOCACHE_FIELD_DEFINITIONS,
    matchesSearchPattern,
    normalizeFieldAlias,
    parseTokenExpression,
} from '../geocache-filter-shared';

function fields(definitions: typeof STANDARD_GEOCACHE_FIELD_DEFINITIONS): string[] {
    return definitions.map(def => def.field);
}

function testZoneFieldsExtendTheStandardOnes(): void {
    assert.equal(fields(STANDARD_GEOCACHE_FIELD_DEFINITIONS).includes('favorites_percent'), false);
    assert.equal(fields(STANDARD_GEOCACHE_FIELD_DEFINITIONS).includes('finds_count'), false);
    // La liste de la zone garde les champs standards dans leur ordre et ajoute
    // les siens : le sélecteur de champ ne change pas de tête pour l'utilisateur.
    assert.deepEqual(
        fields(ZONE_GEOCACHE_FIELD_DEFINITIONS),
        [...fields(STANDARD_GEOCACHE_FIELD_DEFINITIONS), 'favorites_percent', 'finds_count']
    );
}

function testNewFieldsAreNumeric(): void {
    const byField = new Map(ZONE_GEOCACHE_FIELD_DEFINITIONS.map(def => [def.field, def]));
    assert.equal(byField.get('favorites_percent')?.kind, 'number');
    assert.equal(byField.get('finds_count')?.kind, 'number');
}

function testFavoriteCountAndPercentHaveDistinctTokens(): void {
    // `@fav` compte les points favoris, `@pf` en donne la part.
    assert.equal(normalizeFieldAlias('fav'), 'favorites_count');
    assert.equal(normalizeFieldAlias('favorites'), 'favorites_count');
    assert.equal(normalizeFieldAlias('pf'), 'favorites_percent');
    assert.equal(normalizeFieldAlias('fav_percent'), 'favorites_percent');
    assert.equal(normalizeFieldAlias('favorites_percent'), 'favorites_percent');
}

function testFindsAliases(): void {
    assert.equal(normalizeFieldAlias('finds'), 'finds_count');
    assert.equal(normalizeFieldAlias('trouvailles'), 'finds_count');
    assert.equal(normalizeFieldAlias('finds_count'), 'finds_count');
    assert.equal(normalizeFieldAlias('FINDS'), 'finds_count');
}

function testUnknownAliasStaysUnknown(): void {
    assert.equal(normalizeFieldAlias('logs'), null);
    assert.equal(normalizeFieldAlias('logs_count'), null);
}

function testPercentParsesAsANumericExpression(): void {
    assert.deepEqual(
        parseTokenExpression('favorites_percent', '>50'),
        { field: 'favorites_percent', operator: 'gt', value: '50' }
    );
    assert.deepEqual(
        parseTokenExpression('favorites_percent', '10<>25'),
        { field: 'favorites_percent', operator: 'between', value: '10', value2: '25' }
    );
    // Sans opérateur, une valeur nue vaut égalité — comme pour `@fav`.
    assert.deepEqual(
        parseTokenExpression('favorites_percent', '61.8'),
        { field: 'favorites_percent', operator: 'eq', value: '61.8' }
    );
}

function testFindsParsesAsANumericExpression(): void {
    assert.deepEqual(
        parseTokenExpression('finds_count', '>=100'),
        { field: 'finds_count', operator: 'gte', value: '100' }
    );
    // Un texte là où on attend un nombre ne produit pas de clause « contient ».
    assert.equal(parseTokenExpression('finds_count', 'beaucoup'), null);
}

function testWildcardCacheSeparatesTheModes(): void {
    // Le cache des expressions régulières indexe `mode` + motif, séparés par
    // U+0000. Sans séparateur intact, la seconde question reprendrait l'entrée
    // de la première et répondrait « oui ».
    assert.equal(matchesSearchPattern('xabcx', 'abc', 'contains'), true);
    assert.equal(matchesSearchPattern('xabcx', 'abc', 'equals'), false);
    // Même chose avec un joker, qui passe par la branche compilée du cache.
    assert.equal(matchesSearchPattern('grande grotte', 'gr*tte', 'contains'), true);
    assert.equal(matchesSearchPattern('xgr grotte y', 'gr*tte', 'equals'), false);
}

testZoneFieldsExtendTheStandardOnes();
testNewFieldsAreNumeric();
testFavoriteCountAndPercentHaveDistinctTokens();
testFindsAliases();
testUnknownAliasStaysUnknown();
testPercentParsesAsANumericExpression();
testFindsParsesAsANumericExpression();
testWildcardCacheSeparatesTheModes();

console.log('geocache-filter-fields.test.ts OK');
