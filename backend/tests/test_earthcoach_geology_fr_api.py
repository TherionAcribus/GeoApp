from __future__ import annotations

import json

import pytest
import requests

from gc_backend import create_app
from gc_backend.blueprints import earthcoach_geology_fr


LITHO_RESPONSE = """GetFeatureInfo results:

Layer 'LITHO_1M_SIMPLIFIEE'
  Feature 470:
    OBJECTID = '1248'
    CODE_GEOL = '7'
    DESCR = 'Basaltes et rhyolites'
    TYPE = 'Roches Magmatiques'
    C_FOND = ''
"""

SHEET_RESPONSE = """GetFeatureInfo results:

Layer 'SCAN_F_GEOL50_CATALOG'
  Feature 682:
    numero = '693'
    nom = 'CLERMONT-FERRAND'
"""

BOREHOLE_RESPONSE = """GetFeatureInfo results:

Layer 'BSS_TOTAL_SANS_LABEL'
  Feature 553978:
    bss_id = 'BSS001SVMG'
    bss_id_txt = 'BSS001SVMG (06935X4002/GT)'
    nom_commune = 'ORCINES'
    nom_departement = 'PUY DE DOME'
    latitude = '45.77120930'
    longitude = '2.96392054'
  Feature 553979:
    bss_id = 'BSS001SVGW'
    bss_id_txt = 'BSS001SVGW (06935X0015/S)'
    nom_commune = 'ORCINES'
"""

EMPTY_RESPONSE = """GetFeatureInfo results:

  Search returned no results.
"""

NOT_QUERYABLE_RESPONSE = (
    '<ServiceExceptionReport version="1.1.1">'
    '<ServiceException code="LayerNotQueryable">not queryable</ServiceException>'
    '</ServiceExceptionReport>'
)


class FakeResponse:
    def __init__(self, text, status=200):
        self.text = text
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f'HTTP {self.status_code}')


def make_wms(bodies_by_layer):
    """Renvoie un faux requests.get qui repond selon la couche interrogee."""
    calls = []

    def fake_get(url, params=None, **kwargs):
        layer = (params or {}).get('query_layers')
        calls.append(layer)
        return FakeResponse(bodies_by_layer.get(layer, EMPTY_RESPONSE))

    return fake_get, calls


@pytest.fixture(autouse=True)
def clear_cache():
    earthcoach_geology_fr._cache.clear()
    yield
    earthcoach_geology_fr._cache.clear()


@pytest.fixture
def client():
    app = create_app()
    app.config['TESTING'] = True
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
    return app.test_client()


def test_french_geology_returns_lithology_and_sheet(client, monkeypatch):
    fake_get, calls = make_wms({
        'LITHO_1M_SIMPLIFIEE': LITHO_RESPONSE,
        'SCAN_F_GEOL50_CATALOG': SHEET_RESPONSE,
    })
    monkeypatch.setattr(earthcoach_geology_fr.requests, 'get', fake_get)

    response = client.get('/api/earthcoach/geology/fr?lat=45.7722&lon=2.9644')
    assert response.status_code == 200
    payload = json.loads(response.data)
    assert payload['covered'] is True
    assert payload['lithology']['description'] == 'Basaltes et rhyolites'
    assert payload['lithology']['rock_type'] == 'Roches Magmatiques'
    assert payload['sheet']['number'] == '693'
    assert payload['sheet']['name'] == 'CLERMONT-FERRAND'
    # Numero de feuille normalise sur 4 chiffres dans l'URL de notice.
    assert payload['sheet']['notice_url'] == 'http://ficheinfoterre.brgm.fr/Notices/0693N.pdf'
    # Les forages coutent une requete de plus: pas demandes, pas interroges.
    assert payload['boreholes'] == []
    assert 'BSS_TOTAL_SANS_LABEL' not in calls


def test_french_geology_includes_boreholes_on_demand(client, monkeypatch):
    fake_get, _ = make_wms({
        'LITHO_1M_SIMPLIFIEE': LITHO_RESPONSE,
        'SCAN_F_GEOL50_CATALOG': SHEET_RESPONSE,
        'BSS_TOTAL_SANS_LABEL': BOREHOLE_RESPONSE,
    })
    monkeypatch.setattr(earthcoach_geology_fr.requests, 'get', fake_get)

    payload = json.loads(client.get('/api/earthcoach/geology/fr?lat=45.7722&lon=2.9644&boreholes=1').data)
    assert len(payload['boreholes']) == 2
    first = payload['boreholes'][0]
    assert first['bss_id'] == 'BSS001SVMG'
    assert first['commune'] == 'ORCINES'
    assert first['url'].endswith('indice=BSS001SVMG')


def test_french_geology_tolerates_empty_and_unqueryable_layers(client, monkeypatch):
    fake_get, _ = make_wms({
        'LITHO_1M_SIMPLIFIEE': EMPTY_RESPONSE,
        'SCAN_F_GEOL50_CATALOG': NOT_QUERYABLE_RESPONSE,
    })
    monkeypatch.setattr(earthcoach_geology_fr.requests, 'get', fake_get)

    payload = json.loads(client.get('/api/earthcoach/geology/fr?lat=45.7722&lon=2.9644').data)
    assert payload['covered'] is True
    assert payload['lithology'] is None
    assert payload['sheet'] is None


def test_french_geology_reports_outside_france_without_calling_brgm(client, monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError('BRGM should not be called outside France')

    monkeypatch.setattr(earthcoach_geology_fr.requests, 'get', boom)

    response = client.get('/api/earthcoach/geology/fr?lat=41.9028&lon=12.4964')
    assert response.status_code == 200
    payload = json.loads(response.data)
    assert payload['covered'] is False
    assert payload['lithology'] is None


def test_french_geology_uses_cache(client, monkeypatch):
    fake_get, calls = make_wms({
        'LITHO_1M_SIMPLIFIEE': LITHO_RESPONSE,
        'SCAN_F_GEOL50_CATALOG': SHEET_RESPONSE,
    })
    monkeypatch.setattr(earthcoach_geology_fr.requests, 'get', fake_get)

    client.get('/api/earthcoach/geology/fr?lat=45.7722&lon=2.9644')
    second = client.get('/api/earthcoach/geology/fr?lat=45.7722&lon=2.9644')
    assert json.loads(second.data)['from_cache'] is True
    assert len(calls) == 2  # une seule paire litho + feuille

    # Le drapeau boreholes fait partie de la cle: la reponse en cache ne doit pas
    # etre servie a une requete qui demande plus de donnees.
    third = client.get('/api/earthcoach/geology/fr?lat=45.7722&lon=2.9644&boreholes=1')
    assert json.loads(third.data)['from_cache'] is False


def test_french_geology_rejects_invalid_coordinates(client):
    assert client.get('/api/earthcoach/geology/fr?lat=200&lon=4.87').status_code == 400
    assert client.get('/api/earthcoach/geology/fr?lat=45.78').status_code == 400


def test_french_geology_handles_upstream_failure(client, monkeypatch):
    def boom(*args, **kwargs):
        raise requests.ConnectionError('down')

    monkeypatch.setattr(earthcoach_geology_fr.requests, 'get', boom)
    assert client.get('/api/earthcoach/geology/fr?lat=45.7722&lon=2.9644').status_code == 502
