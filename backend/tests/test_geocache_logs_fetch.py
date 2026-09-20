"""
Récupération des logs d'une géocache : pagination du logbook et total disponible.

Le sujet de ces tests est la distinction entre « combien de logs on a chargés »
et « combien la cache en compte sur Geocaching.com » : c'est elle qui permet de
plafonner le chargement par défaut tout en sachant proposer la suite.
"""
from __future__ import annotations

import json

import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache, GeocacheLog
from gc_backend.models import Zone
from gc_backend.services.geocaching_logs import (
    MAX_LOGS_FETCH_ALL,
    GeocachingLogsClient,
)


CACHE_PAGE = "<html><script>var userToken = 'TOKEN123';</script></html>"


def _log_entry(log_id: int) -> dict:
    return {
        'LogID': log_id,
        'LogGuid': f'guid-{log_id}',
        'LogType': 'Found it',
        'LogText': f'<p>Log {log_id}</p>',
        'Created': '07/26/2026',
        'Visited': '07/26/2026',
        'UserName': f'joueur{log_id}',
        'AccountGuid': f'acc-{log_id}',
        'FavoritePointUsed': False,
        'Images': [],
    }


class _FakeResponse:
    def __init__(self, *, text: str = '', payload: dict | None = None):
        self.text = text if payload is None else json.dumps(payload)
        self._payload = payload
        self.status_code = 200

    def raise_for_status(self) -> None:
        return None

    def json(self):
        return self._payload


class _PaginatedSession:
    """
    Rejoue un logbook de `total` logs, servi par pages `idx`/`num`.

    C'est la forme de l'API interne de Geocaching.com : `idx` est un numéro de
    page 1-based, pas un offset en nombre de logs.
    """

    def __init__(self, total: int, *, with_page_info: bool = True, friend_logs: list[dict] | None = None):
        self.total = total
        self.with_page_info = with_page_info
        self.friend_logs = friend_logs or []
        self.logbook_calls: list[dict] = []
        self.page_calls = 0

    def get(self, url: str, params=None, headers=None, timeout=None):
        if 'geocache/' in url:
            self.page_calls += 1
            return _FakeResponse(text=CACHE_PAGE)

        params = params or {}
        self.logbook_calls.append(params)

        if params.get('sf') == 'true':
            return _FakeResponse(payload={'status': 'success', 'data': self.friend_logs})

        size = int(params['num'])
        start = (int(params['idx']) - 1) * size
        entries = [_log_entry(i) for i in range(start + 1, min(start + size, self.total) + 1)]

        payload = {'status': 'success', 'data': entries}
        if self.with_page_info:
            payload['pageInfo'] = {
                'idx': params['idx'],
                'size': size,
                'rows': len(entries),
                'totalRows': self.total,
            }
        return _FakeResponse(payload=payload)


def test_total_available_comes_from_the_logbook_page_info():
    """Une page de 20 logs doit quand même révéler que la cache en compte 137."""
    session = _PaginatedSession(total=137)

    result = GeocachingLogsClient(session=session).fetch_logbook('GC12345', count=20)

    assert len(result.logs) == 20
    assert result.total_available == 137
    assert result.truncated is False


def test_total_available_is_none_when_the_logbook_stays_silent():
    """
    `pageInfo` n'est pas contractuel : son absence ne doit pas casser la
    récupération, seulement rendre le total inconnu.
    """
    session = _PaginatedSession(total=137, with_page_info=False)

    result = GeocachingLogsClient(session=session).fetch_logbook('GC12345', count=20)

    assert len(result.logs) == 20
    assert result.total_available is None


def test_page_parameter_maps_to_the_logbook_index():
    session = _PaginatedSession(total=137)

    result = GeocachingLogsClient(session=session).fetch_logbook('GC12345', count=100, page=2)

    # Page 2 sur des pages de 100 : les logs 101 à 137.
    assert [log.external_id for log in result.logs] == [str(i) for i in range(101, 138)]
    assert [call['idx'] for call in session.logbook_calls if call.get('sf') != 'true'] == [2]


def test_fetch_all_chains_pages_until_the_logbook_is_exhausted():
    session = _PaginatedSession(total=250)

    result = GeocachingLogsClient(session=session).fetch_logbook('GC12345', count=100, fetch_all=True)

    assert len(result.logs) == 250
    assert result.total_available == 250
    assert result.truncated is False
    # Trois pages de logs, plus l'unique requête `sf=true` du filtre amis.
    assert [call['idx'] for call in session.logbook_calls if call.get('sf') != 'true'] == [1, 2, 3]
    assert sum(1 for call in session.logbook_calls if call.get('sf') == 'true') == 1


def test_fetch_all_stops_on_the_safety_cap():
    """Sans plafond, une cache à plusieurs milliers de logs bloquerait l'appel."""
    session = _PaginatedSession(total=MAX_LOGS_FETCH_ALL + 500)

    result = GeocachingLogsClient(session=session).fetch_logbook('GC12345', count=100, fetch_all=True)

    assert len(result.logs) == MAX_LOGS_FETCH_ALL
    assert result.truncated is True


def test_page_size_is_capped_even_when_more_is_asked():
    session = _PaginatedSession(total=500)

    GeocachingLogsClient(session=session).fetch_logbook('GC12345', count=5000)

    assert [call['num'] for call in session.logbook_calls] == [100, 100]


# ----------------------------------------------------------------------- API

@pytest.fixture
def app():
    app = create_app()
    app.config['TESTING'] = True
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'

    with app.app_context():
        db.create_all()
        zone = Zone(name='Z1')
        db.session.add(zone)
        db.session.flush()
        geocache = Geocache(gc_code='GC12345', name='Test', type='Traditional', zone_id=zone.id)
        db.session.add(geocache)
        db.session.flush()
        app.geocache_id = geocache.id
        yield app
        db.session.remove()
        db.drop_all()


def _patch_client(monkeypatch, session):
    import gc_backend.blueprints.logs as logs_blueprint
    monkeypatch.setattr(
        logs_blueprint, 'GeocachingLogsClient',
        lambda: GeocachingLogsClient(session=session)
    )


def test_refresh_route_records_and_exposes_the_total_available(app, monkeypatch):
    _patch_client(monkeypatch, _PaginatedSession(total=137))
    client = app.test_client()

    payload = client.post(f'/api/geocaches/{app.geocache_id}/logs/refresh?count=50').get_json()

    assert payload['added'] == 50
    assert payload['total'] == 50            # ce qui est stocké
    assert payload['total_available'] == 137  # ce que la cache compte vraiment

    # Le panneau Logs doit pouvoir proposer la suite sans re-scraper d'abord :
    # la lecture des logs stockés porte elle aussi le total.
    listed = client.get(f'/api/geocaches/{app.geocache_id}/logs').get_json()
    assert listed['total_count'] == 50
    assert listed['total_available'] == 137


def test_refresh_route_loads_the_next_page_without_losing_the_previous_one(app, monkeypatch):
    _patch_client(monkeypatch, _PaginatedSession(total=137))
    client = app.test_client()

    client.post(f'/api/geocaches/{app.geocache_id}/logs/refresh?count=100')
    payload = client.post(f'/api/geocaches/{app.geocache_id}/logs/refresh?count=100&page=2').get_json()

    assert payload['added'] == 37
    assert payload['total'] == 137
    assert GeocacheLog.query.filter_by(geocache_id=app.geocache_id).count() == 137


def test_refresh_route_can_fetch_everything_on_demand(app, monkeypatch):
    _patch_client(monkeypatch, _PaginatedSession(total=250))
    client = app.test_client()

    payload = client.post(f'/api/geocaches/{app.geocache_id}/logs/refresh?count=100&all=true').get_json()

    assert payload['total'] == 250
    assert payload['truncated'] is False


def test_refresh_route_survives_a_page_past_the_end(app, monkeypatch):
    """Demander la suite d'un logbook déjà épuisé n'est pas une erreur."""
    _patch_client(monkeypatch, _PaginatedSession(total=30))
    client = app.test_client()

    response = client.post(f'/api/geocaches/{app.geocache_id}/logs/refresh?count=100&page=2')
    payload = response.get_json()

    assert response.status_code == 200
    assert payload['added'] == 0
    assert payload['total_available'] == 30
