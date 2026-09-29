"""
Tests de cohérence du schéma partagé des préférences GeoApp.

Verrouillent les invariants audités (voir documentation/preferences-ameliorations-spec.md,
lot 2.5) : métadonnées obligatoires, défauts valides pour leur propre type, libellés
d'enum complets, catégories et guides déclarés, sources `optionsFrom` existantes et
clés sensibles marquées avancées.
"""

import json
from pathlib import Path

import pytest

from gc_backend.utils.preferences import _normalize_value

SCHEMA_PATH = (
    Path(__file__).resolve().parents[2]
    / 'shared' / 'preferences' / 'geo-preferences-schema.json'
)


@pytest.fixture(scope='module')
def schema():
    with SCHEMA_PATH.open(encoding='utf-8') as handle:
        return json.load(handle)


@pytest.fixture(scope='module')
def properties(schema):
    return schema['properties']


def test_every_key_is_geoapp_prefixed(properties):
    assert all(key.startswith('geoApp.') for key in properties)


def test_required_metadata_is_present(properties):
    for key, definition in properties.items():
        ui = definition.get('x-ui') or {}
        for field in ('title', 'description', 'default', 'x-category', 'x-targets'):
            assert field in definition, f'{key}: champ manquant {field}'
        for field in ('section', 'label'):
            assert field in ui, f'{key}: champ manquant x-ui.{field}'


def test_defaults_are_valid_for_their_type(properties):
    for key, definition in properties.items():
        try:
            _normalize_value(definition, definition['default'])
        except Exception as error:  # noqa: BLE001 - on veut le détail dans l'échec
            pytest.fail(f'{key}: default invalide ({error})')


def test_enum_labels_cover_every_value(properties):
    for key, definition in properties.items():
        labels = definition.get('x-ui', {}).get('enumLabels') or {}
        enum = definition.get('enum')
        if enum:
            missing = [value for value in enum if value not in labels and str(value) not in labels]
            assert not missing, f'{key}: enum sans enumLabels pour {missing}'
        item_enum = (definition.get('items') or {}).get('enum')
        if item_enum:
            missing = [value for value in item_enum if value not in labels and str(value) not in labels]
            assert not missing, f'{key}: items.enum sans enumLabels pour {missing}'


def test_categories_are_declared_and_guided(schema, properties):
    declared = {category['id'] for category in schema.get('x-categories', [])}
    for key, definition in properties.items():
        assert definition['x-category'] in declared, (
            f"{key}: x-category '{definition['x-category']}' absente de x-categories"
        )
    guided = {
        category
        for guide in schema.get('x-guides', [])
        for category in (guide.get('categories') or [])
    }
    uncovered = declared - guided
    assert not uncovered, f'catégories couvertes par aucun guide: {sorted(uncovered)}'


def test_options_from_sources_exist_and_order(properties):
    for key, definition in properties.items():
        ui = definition.get('x-ui') or {}
        sources = ui.get('optionsFrom')
        if not sources:
            continue
        for source in ([sources] if isinstance(sources, str) else sources):
            assert source in properties, f'{key}: optionsFrom inconnu {source}'
            if ui.get('widget') == 'select-from':
                source_ui = properties[source].get('x-ui') or {}
                if source_ui.get('section') == ui.get('section'):
                    assert (ui.get('order') or 0) > (source_ui.get('order') or 0), (
                        f'{key}: order <= source {source} dans la même section'
                    )


def test_sensitive_keys_are_advanced(properties):
    for key, definition in properties.items():
        if definition.get('x-sensitive'):
            assert (definition.get('x-ui') or {}).get('advanced') is True, (
                f'{key}: x-sensitive sans x-ui.advanced'
            )
