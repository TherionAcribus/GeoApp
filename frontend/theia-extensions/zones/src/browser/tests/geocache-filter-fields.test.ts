/**
 * Champs filtrables d'une géocache : alias saisis et champs proposés.
 *
 * Ce qui se teste ici est la frontière entre les deux listes de champs : la
 * liste standard couvre les champs que l'import « autour » sait appliquer sur
 * les résultats de l'API ; la liste « zone » l'étend avec les champs locaux
 * (logs, waypoints, dates, statut…).
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

function testZoneFieldsCoverTheStandardOnes(): void {
    // La liste « zone » reprend tous les champs standard, sans doublon.
    const zoneFields = fields(ZONE_GEOCACHE_FIELD_DEFINITIONS);
    for (const field of fields(STANDARD_GEOCACHE_FIELD_DEFINITIONS)) {
        assert.equal(zoneFields.includes(field), true, `champ standard absent de la zone : ${field}`);
    }
    assert.equal(new Set(zoneFields).size, zoneFields.length);
}

function testLocalOnlyFieldsStayOutOfTheStandardList(): void {
    // L'import « autour » applique les filtres par `getattr` sur les résultats
    // de l'API : un champ local (notes, logs, dates…) y renverrait '' et
    // exclurait silencieusement toutes les candidates.
    const standardFields = fields(STANDARD_GEOCACHE_FIELD_DEFINITIONS);
    for (const field of [
        'status', 'is_corrected', 'has_notes', 'need_maintenance',
        'placed_at', 'found_date', 'created_at',
        'logs_count', 'logs_total_available', 'waypoints_count',
        'finds_count', 'favorites_percent',
    ]) {
        assert.equal(standardFields.includes(field), false, `champ local dans la liste standard : ${field}`);
    }
}

function testExtendedFieldKinds(): void {
    const byField = new Map(ZONE_GEOCACHE_FIELD_DEFINITIONS.map(def => [def.field, def]));
    assert.equal(byField.get('status')?.kind, 'enum');
    assert.equal(byField.get('is_corrected')?.kind, 'boolean');
    assert.equal(byField.get('has_notes')?.kind, 'boolean');
    assert.equal(byField.get('need_maintenance')?.kind, 'boolean');
    assert.equal(byField.get('placed_at')?.kind, 'date');
    assert.equal(byField.get('found_date')?.kind, 'date');
    assert.equal(byField.get('created_at')?.kind, 'date');
    assert.equal(byField.get('logs_count')?.kind, 'number');
    assert.equal(byField.get('logs_total_available')?.kind, 'number');
    assert.equal(byField.get('waypoints_count')?.kind, 'number');
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

function testStatusAliasTargetsStatusNotSolved(): void {
    // `@status` filtrait autrefois sur `solved` : le statut a son propre champ.
    assert.equal(normalizeFieldAlias('status'), 'status');
    assert.equal(normalizeFieldAlias('statut'), 'status');
    // Les accents sont ignorés : « état » se saisit comme il s'écrit.
    assert.equal(normalizeFieldAlias('état'), 'status');
    assert.equal(normalizeFieldAlias('solved'), 'solved');
}

function testExtendedFieldAliases(): void {
    assert.equal(normalizeFieldAlias('corrigée'), 'is_corrected');
    assert.equal(normalizeFieldAlias('notes'), 'has_notes');
    assert.equal(normalizeFieldAlias('maintenance'), 'need_maintenance');
    assert.equal(normalizeFieldAlias('logs'), 'logs_count');
    assert.equal(normalizeFieldAlias('logs_total'), 'logs_total_available');
    assert.equal(normalizeFieldAlias('wp'), 'waypoints_count');
    assert.equal(normalizeFieldAlias('posée'), 'placed_at');
    assert.equal(normalizeFieldAlias('hidden'), 'placed_at');
    assert.equal(normalizeFieldAlias('ajoutee'), 'created_at');
    assert.equal(normalizeFieldAlias('decouverte'), 'found_date');
    assert.equal(normalizeFieldAlias('found_date'), 'found_date');
}

function testUnknownAliasStaysUnknown(): void {
    assert.equal(normalizeFieldAlias('bidule'), null);
    assert.equal(normalizeFieldAlias('xyzzy'), null);
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

function testDatesParseAsDateExpressions(): void {
    // Année, année-mois ou date ISO complète : la valeur est gardée telle
    // quelle, la comparaison par préfixe se fait dans `matchesClause`.
    assert.deepEqual(
        parseTokenExpression('placed_at', '>=2020'),
        { field: 'placed_at', operator: 'gte', value: '2020' }
    );
    assert.deepEqual(
        parseTokenExpression('placed_at', '2020<>2024'),
        { field: 'placed_at', operator: 'between', value: '2020', value2: '2024' }
    );
    assert.deepEqual(
        parseTokenExpression('found_date', '2023-05-17'),
        { field: 'found_date', operator: 'eq', value: '2023-05-17' }
    );
    // Ni texte libre ni opérande invalide : pas de clause « contient ».
    assert.equal(parseTokenExpression('placed_at', 'avant-hier'), null);
    assert.equal(parseTokenExpression('placed_at', '>=17-05-2023'), null);
}

function testBooleanFieldsAcceptFrenchValues(): void {
    assert.deepEqual(
        parseTokenExpression('has_notes', 'oui'),
        { field: 'has_notes', operator: 'is', value: 'true' }
    );
    assert.deepEqual(
        parseTokenExpression('need_maintenance', 'non'),
        { field: 'need_maintenance', operator: 'is', value: 'false' }
    );
    assert.equal(parseTokenExpression('is_corrected', 'peut-etre'), null);
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

testZoneFieldsCoverTheStandardOnes();
testLocalOnlyFieldsStayOutOfTheStandardList();
testNewFieldsAreNumeric();
testExtendedFieldKinds();
testFavoriteCountAndPercentHaveDistinctTokens();
testFindsAliases();
testStatusAliasTargetsStatusNotSolved();
testExtendedFieldAliases();
testUnknownAliasStaysUnknown();
testPercentParsesAsANumericExpression();
testFindsParsesAsANumericExpression();
testDatesParseAsDateExpressions();
testBooleanFieldsAcceptFrenchValues();
testWildcardCacheSeparatesTheModes();

console.log('geocache-filter-fields.test.ts OK');
