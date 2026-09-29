"""
Tests pour le blueprint /api/preferences.
"""

import json
import sys
import types
import pytest

try:
    import pyproj  # type: ignore
except ModuleNotFoundError:  # pragma: no cover - dépendance optionnelle pour les tests
    class _FakeGeod:
        def __init__(self, **_kwargs):
            pass

        def inv(self, *_args, **_kwargs):
            return 0.0, 0.0, 0.0

    sys.modules['pyproj'] = types.SimpleNamespace(Geod=_FakeGeod)

try:
    import browser_cookie3  # type: ignore
except ModuleNotFoundError:  # pragma: no cover - dependance optionnelle pour les tests
    sys.modules['browser_cookie3'] = types.SimpleNamespace(
        chrome=lambda *args, **kwargs: [],
        edge=lambda *args, **kwargs: [],
        firefox=lambda *args, **kwargs: [],
        load=lambda *args, **kwargs: []
    )

from gc_backend import create_app
from gc_backend.database import db


@pytest.fixture
def app():
    app = create_app()
    app.config['TESTING'] = True
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'

    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()


@pytest.fixture
def client(app):
    return app.test_client()


def test_get_preferences_returns_defaults(client):
    response = client.get('/api/preferences')
    assert response.status_code == 200
    payload = json.loads(response.data)
    assert 'preferences' in payload
    assert payload['preferences']['geoApp.plugins.lazyMode'] is True
    assert payload['preferences']['geoApp.checkers.certitudes.keepPageOpen'] is False
    assert payload['preferences']['geoApp.checkers.geocaching.keepPageOpen'] is False


def test_put_preference_updates_value(client):
    response = client.put('/api/preferences/geoApp.plugins.lazyMode', json={'value': False})
    assert response.status_code == 200

    response = client.get('/api/preferences/geoApp.plugins.lazyMode')
    assert response.status_code == 200
    payload = json.loads(response.data)
    assert payload['value'] is False


def test_put_array_preference_keeps_list_value(client):
    response = client.put('/api/preferences/geoApp.alphabets.favoriteIds', json={'value': ['fremen', 'pigpen', 'fremen']})
    assert response.status_code == 200
    payload = json.loads(response.data)
    assert payload['value'] == ['fremen', 'pigpen']

    response = client.get('/api/preferences/geoApp.alphabets.favoriteIds')
    assert response.status_code == 200
    payload = json.loads(response.data)
    assert payload['value'] == ['fremen', 'pigpen']


def test_put_object_preference_keeps_object_value(client):
    list_preferences = {
        'viewMode': 'compact',
        'familyFilter': 'fiction',
        'showExamples': True,
        'fontSize': 24
    }
    response = client.put('/api/preferences/geoApp.alphabets.listPreferences', json={'value': list_preferences})
    assert response.status_code == 200
    payload = json.loads(response.data)
    assert payload['value'] == list_preferences

    response = client.get('/api/preferences/geoApp.alphabets.listPreferences')
    assert response.status_code == 200
    payload = json.loads(response.data)
    assert payload['value'] == list_preferences


def test_put_unknown_preference_returns_404(client):
    response = client.put('/api/preferences/unknown.key', json={'value': 1})
    assert response.status_code == 404


SENSITIVE_KEY = 'geoApp.ai.openRouter.apiKey'
SECRET_VALUE = 'sk-test-secret-1234567890'


def test_sensitive_value_is_masked_in_get_list(client):
    response = client.put(f'/api/preferences/{SENSITIVE_KEY}', json={'value': SECRET_VALUE})
    assert response.status_code == 200

    response = client.get('/api/preferences')
    assert response.status_code == 200
    payload = json.loads(response.data)
    assert payload['preferences'][SENSITIVE_KEY] is None
    assert SENSITIVE_KEY in payload['sensitiveKeys']
    assert SECRET_VALUE.encode() not in response.data


def test_sensitive_value_is_masked_in_get_single(client):
    client.put(f'/api/preferences/{SENSITIVE_KEY}', json={'value': SECRET_VALUE})

    response = client.get(f'/api/preferences/{SENSITIVE_KEY}')
    assert response.status_code == 200
    payload = json.loads(response.data)
    assert payload['value'] is None
    assert payload['sensitive'] is True
    assert payload['defined'] is True
    assert SECRET_VALUE.encode() not in response.data


def test_sensitive_value_remains_readable_by_backend(app, client):
    from gc_backend.utils.preferences import get_value_or_default

    client.put(f'/api/preferences/{SENSITIVE_KEY}', json={'value': SECRET_VALUE})
    with app.app_context():
        assert get_value_or_default(SENSITIVE_KEY) == SECRET_VALUE


def test_put_sensitive_does_not_log_the_value(client):
    from loguru import logger

    records = []
    sink_id = logger.add(lambda message: records.append(message.record['message']), level='INFO')
    try:
        client.put(f'/api/preferences/{SENSITIVE_KEY}', json={'value': SECRET_VALUE})
    finally:
        logger.remove(sink_id)

    logged = ''.join(records)
    assert SENSITIVE_KEY in logged
    assert SECRET_VALUE not in logged


def test_stored_keys_distinguishes_stored_from_defaults(client):
    response = client.get('/api/preferences')
    payload = json.loads(response.data)
    assert 'storedKeys' in payload
    assert 'geoApp.plugins.lazyMode' not in payload['storedKeys']

    client.put('/api/preferences/geoApp.plugins.lazyMode', json={'value': False})
    response = client.get('/api/preferences')
    payload = json.loads(response.data)
    assert 'geoApp.plugins.lazyMode' in payload['storedKeys']


def test_delete_preference_removes_stored_value(app, client):
    client.put('/api/preferences/geoApp.plugins.lazyMode', json={'value': False})

    response = client.delete('/api/preferences/geoApp.plugins.lazyMode')
    assert response.status_code == 200
    assert json.loads(response.data)['removed'] is True

    # La valeur retombe sur le défaut du schéma (lazyMode = True).
    response = client.get('/api/preferences/geoApp.plugins.lazyMode')
    assert json.loads(response.data)['value'] is True

    response = client.get('/api/preferences')
    assert 'geoApp.plugins.lazyMode' not in json.loads(response.data)['storedKeys']

    # Le modèle n'a plus de ligne AppConfig pour la clé.
    from gc_backend.models import AppConfig
    with app.app_context():
        assert AppConfig.get_value('geoApp.plugins.lazyMode') is None


def test_delete_preference_without_stored_value_is_idempotent(client):
    response = client.delete('/api/preferences/geoApp.plugins.lazyMode')
    assert response.status_code == 200
    assert json.loads(response.data)['removed'] is False


def test_delete_unknown_preference_returns_404(client):
    response = client.delete('/api/preferences/unknown.key')
    assert response.status_code == 404

