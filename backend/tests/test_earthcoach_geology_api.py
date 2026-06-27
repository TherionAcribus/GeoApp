from __future__ import annotations

import json

import pytest
import requests

from gc_backend import create_app
from gc_backend.blueprints import earthcoach_geology


SAMPLE_PAYLOAD = {
    'success': {
        'data': [
            {
                'source_id': 123,
                'name': 'Calcaires du Bajocien',
                'strat_name': 'Bajocien',
                'lith': 'limestone',
                'descrip': 'Calcaires a entroques.',
                'comments': 'Plateau calcaire.',
                'b_int_name': 'Bajocian',
                't_int_name': 'Bathonian',
                'b_int_age': 170.3,
                't_int_age': 168.2,
                'scale': 'medium',
                'color': '#4ba37f',
            },
            {
                # Unite vide a ignorer
                'source_id': 999,
                'name': '',
                'lith': '',
            },
        ],
    },
}


class FakeResponse:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f'HTTP {self.status_code}')

    def json(self):
        return self._payload


@pytest.fixture(autouse=True)
def clear_cache():
    earthcoach_geology._cache.clear()
    yield
    earthcoach_geology._cache.clear()


@pytest.fixture
def app():
    app = create_app()
    app.config['TESTING'] = True
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
    return app


@pytest.fixture
def client(app):
    return app.test_client()


def test_geology_normalizes_units(client, monkeypatch):
    monkeypatch.setattr(earthcoach_geology.requests, 'get', lambda *a, **k: FakeResponse(SAMPLE_PAYLOAD))

    response = client.get('/api/earthcoach/geology?lat=45.78&lon=4.87')
    assert response.status_code == 200
    payload = json.loads(response.data)
    assert payload['source'] == 'macrostrat'
    assert payload['from_cache'] is False
    assert len(payload['units']) == 1
    unit = payload['units'][0]
    assert unit['name'] == 'Calcaires du Bajocien'
    assert unit['lithology'] == 'limestone'
    assert unit['age_text'] == 'Bajocian - Bathonian'
    assert unit['b_age'] == 170.3


def test_geology_uses_cache(client, monkeypatch):
    calls = {'n': 0}

    def fake_get(*args, **kwargs):
        calls['n'] += 1
        return FakeResponse(SAMPLE_PAYLOAD)

    monkeypatch.setattr(earthcoach_geology.requests, 'get', fake_get)

    first = client.get('/api/earthcoach/geology?lat=45.78&lon=4.87')
    second = client.get('/api/earthcoach/geology?lat=45.78&lon=4.87')
    assert first.status_code == 200
    assert second.status_code == 200
    assert json.loads(second.data)['from_cache'] is True
    assert calls['n'] == 1


def test_geology_rejects_invalid_coordinates(client):
    response = client.get('/api/earthcoach/geology?lat=200&lon=4.87')
    assert response.status_code == 400
    assert 'lat' in json.loads(response.data)['error']

    missing = client.get('/api/earthcoach/geology?lat=45.78')
    assert missing.status_code == 400


def test_geology_handles_upstream_failure(client, monkeypatch):
    def boom(*args, **kwargs):
        raise requests.ConnectionError('down')

    monkeypatch.setattr(earthcoach_geology.requests, 'get', boom)
    response = client.get('/api/earthcoach/geology?lat=45.78&lon=4.87')
    assert response.status_code == 502
