from __future__ import annotations

import json

import pytest
import requests

from gc_backend import create_app
from gc_backend.blueprints import earthcoach_elevation


class FakeResponse:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f'HTTP {self.status_code}')

    def json(self):
        return self._payload


def ign_payload(*values):
    return {'elevations': [{'z': value, 'acc': 'x'} for value in values]}


def make_backends(ign=None, open_meteo=None):
    """Faux requests.get qui aiguille selon l'URL, et journal des appels."""
    calls = {'ign': 0, 'open_meteo': 0, 'open_meteo_params': None}

    def fake_get(url, params=None, **kwargs):
        if url == earthcoach_elevation.IGN_URL:
            calls['ign'] += 1
            if isinstance(ign, Exception):
                raise ign
            return FakeResponse(ign)
        calls['open_meteo'] += 1
        calls['open_meteo_params'] = params
        if isinstance(open_meteo, Exception):
            raise open_meteo
        return FakeResponse(open_meteo)

    return fake_get, calls


@pytest.fixture(autouse=True)
def clear_cache():
    earthcoach_elevation._cache.clear()
    yield
    earthcoach_elevation._cache.clear()


@pytest.fixture
def client():
    app = create_app()
    app.config['TESTING'] = True
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
    return app.test_client()


def test_elevation_single_point_uses_ign(client, monkeypatch):
    fake_get, calls = make_backends(ign=ign_payload(1454.41))
    monkeypatch.setattr(earthcoach_elevation.requests, 'get', fake_get)

    response = client.get('/api/earthcoach/elevation?lat=45.7722&lon=2.9644')
    assert response.status_code == 200
    payload = json.loads(response.data)
    assert payload['points'] == [{
        'lat': 45.7722, 'lon': 2.9644, 'elevation_m': 1454.41, 'source': 'ign_rge_alti',
    }]
    # Un seul point: pas de denivele a annoncer.
    assert 'difference_m' not in payload
    assert calls['open_meteo'] == 0


def test_elevation_falls_back_to_open_meteo_outside_ign_coverage(client, monkeypatch):
    # -99999 est la sentinelle IGN hors couverture RGE ALTI.
    fake_get, calls = make_backends(
        ign=ign_payload(1454.41, -99999.0),
        open_meteo={'elevation': [58.0]},
    )
    monkeypatch.setattr(earthcoach_elevation.requests, 'get', fake_get)

    payload = json.loads(client.get('/api/earthcoach/elevation?points=45.7722,2.9644|41.9028,12.4964').data)
    assert [point['source'] for point in payload['points']] == ['ign_rge_alti', 'open-meteo']
    assert [point['elevation_m'] for point in payload['points']] == [1454.41, 58.0]
    assert payload['difference_m'] == 1396.41
    assert payload['min_m'] == 58.0
    assert payload['max_m'] == 1454.41
    # Seul le point non couvert est renvoye au service de repli.
    assert calls['open_meteo_params']['latitude'] == '41.9028'


def test_elevation_falls_back_when_ign_is_down(client, monkeypatch):
    fake_get, calls = make_backends(
        ign=requests.ConnectionError('down'),
        open_meteo={'elevation': [173.0]},
    )
    monkeypatch.setattr(earthcoach_elevation.requests, 'get', fake_get)

    payload = json.loads(client.get('/api/earthcoach/elevation?lat=45.78&lon=4.87').data)
    assert payload['points'][0]['source'] == 'open-meteo'
    assert payload['points'][0]['elevation_m'] == 173.0
    assert calls['ign'] == 1


def test_elevation_fails_when_both_services_are_down(client, monkeypatch):
    fake_get, _ = make_backends(
        ign=requests.ConnectionError('down'),
        open_meteo=requests.ConnectionError('down'),
    )
    monkeypatch.setattr(earthcoach_elevation.requests, 'get', fake_get)

    assert client.get('/api/earthcoach/elevation?lat=45.78&lon=4.87').status_code == 502


def test_elevation_keeps_ign_points_when_fallback_fails(client, monkeypatch):
    fake_get, _ = make_backends(
        ign=ign_payload(1454.41, -99999.0),
        open_meteo=requests.ConnectionError('down'),
    )
    monkeypatch.setattr(earthcoach_elevation.requests, 'get', fake_get)

    response = client.get('/api/earthcoach/elevation?points=45.7722,2.9644|41.9028,12.4964')
    assert response.status_code == 200
    payload = json.loads(response.data)
    assert payload['points'][0]['elevation_m'] == 1454.41
    assert payload['points'][1]['elevation_m'] is None
    assert payload['points'][1]['source'] is None


def test_elevation_uses_cache(client, monkeypatch):
    fake_get, calls = make_backends(ign=ign_payload(1454.41))
    monkeypatch.setattr(earthcoach_elevation.requests, 'get', fake_get)

    client.get('/api/earthcoach/elevation?lat=45.7722&lon=2.9644')
    second = client.get('/api/earthcoach/elevation?lat=45.7722&lon=2.9644')
    assert json.loads(second.data)['from_cache'] is True
    assert calls['ign'] == 1


def test_elevation_rejects_invalid_input(client):
    assert client.get('/api/earthcoach/elevation').status_code == 400
    assert client.get('/api/earthcoach/elevation?lat=200&lon=4.87').status_code == 400
    assert client.get('/api/earthcoach/elevation?points=45.7722').status_code == 400
    assert client.get('/api/earthcoach/elevation?points=45.7722,abc').status_code == 400

    too_many = '|'.join(['45.0,4.0'] * (earthcoach_elevation.MAX_POINTS + 1))
    assert client.get(f'/api/earthcoach/elevation?points={too_many}').status_code == 400
