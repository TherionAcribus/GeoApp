"""Logs d'amis sur une géocache : détection côté client et exposition par l'API."""
from __future__ import annotations

import json
from datetime import datetime

import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache, GeocacheLog
from gc_backend.models import Zone
from gc_backend.services.geocaching_logs import GeocachingLogsClient


CACHE_PAGE = "<html><script>var userToken = 'TOKEN123';</script></html>"


def _log_entry(log_id: int, username: str, visited: str = '07/26/2026') -> dict:
    return {
        'LogID': log_id,
        'LogGuid': f'guid-{log_id}',
        'LogType': 'Found it',
        'LogText': f'<p>Log de {username}</p>',
        'Created': visited,
        'Visited': visited,
        'UserName': username,
        'AccountGuid': f'acc-{log_id}',
        'FavoritePointUsed': False,
        'Images': [],
    }


class _FakeResponse:
    def __init__(self, *, text: str = '', payload: dict | None = None, status_code: int = 200):
        self.text = text if payload is None else json.dumps(payload)
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self) -> None:
        return None

    def json(self):
        return self._payload


class _FakeSession:
    """Rejoue la page de la cache puis le logbook, avec ou sans `sf=true`."""

    def __init__(self, all_logs: list[dict], friend_logs: list[dict]):
        self.all_logs = all_logs
        self.friend_logs = friend_logs
        self.logbook_calls: list[dict] = []
        self.page_calls = 0

    def get(self, url: str, params=None, headers=None, timeout=None):
        if 'geocache/' in url:
            self.page_calls += 1
            return _FakeResponse(text=CACHE_PAGE)

        self.logbook_calls.append(params or {})
        is_friends = (params or {}).get('sf') == 'true'
        data = self.friend_logs if is_friends else self.all_logs
        return _FakeResponse(payload={'status': 'success', 'data': data})


def test_friend_logs_are_identified_with_a_single_token_fetch():
    session = _FakeSession(
        all_logs=[_log_entry(1, 'inconnu'), _log_entry(2, 'mon_ami')],
        friend_logs=[_log_entry(2, 'mon_ami')],
    )

    logs, friend_ids = GeocachingLogsClient(session=session).get_logs_with_friends('GC12345', count=25)

    assert len(logs) == 2
    assert len(friend_ids) == 1
    friend_log = next(log for log in logs if log.external_id in friend_ids)
    assert friend_log.author == 'mon_ami'

    # Une seule extraction du userToken, deux appels au logbook (dont un avec sf=true).
    assert session.page_calls == 1
    assert len(session.logbook_calls) == 2
    assert [call.get('sf') for call in session.logbook_calls] == [None, 'true']


def test_friend_log_outside_the_window_is_added_to_the_result():
    """`sf=true` filtre tous les logs de la cache, pas seulement les plus récents."""
    session = _FakeSession(
        all_logs=[_log_entry(1, 'inconnu')],
        friend_logs=[_log_entry(99, 'mon_ami', visited='01/02/2019')],
    )

    logs, friend_ids = GeocachingLogsClient(session=session).get_logs_with_friends('GC12345', count=1)

    assert [log.author for log in logs] == ['inconnu', 'mon_ami']
    assert len(friend_ids) == 1


def test_no_friend_logs_returns_empty_set():
    session = _FakeSession(all_logs=[_log_entry(1, 'inconnu')], friend_logs=[])

    logs, friend_ids = GeocachingLogsClient(session=session).get_logs_with_friends('GC12345')

    assert len(logs) == 1
    assert friend_ids == set()


def test_missing_user_token_degrades_gracefully():
    class _NoTokenSession(_FakeSession):
        def get(self, url: str, params=None, headers=None, timeout=None):
            if 'geocache/' in url:
                return _FakeResponse(text='<html>pas de token</html>')
            return super().get(url, params, headers, timeout)

    logs, friend_ids = GeocachingLogsClient(
        session=_NoTokenSession([], [])
    ).get_logs_with_friends('GC12345')

    assert logs == [] and friend_ids == set()


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
        db.session.add_all([
            GeocacheLog(geocache_id=geocache.id, external_id='1', author='inconnu',
                        text='a', date=datetime(2026, 7, 1), log_type='Found', is_friend_log=False),
            GeocacheLog(geocache_id=geocache.id, external_id='2', author='mon_ami',
                        text='b', date=datetime(2026, 7, 2), log_type='Found', is_friend_log=True),
        ])
        db.session.commit()
        app.geocache_id = geocache.id
        yield app
        db.session.remove()
        db.drop_all()


def test_logs_endpoint_exposes_and_filters_friend_logs(app):
    client = app.test_client()

    payload = client.get(f'/api/geocaches/{app.geocache_id}/logs').get_json()
    assert payload['total_count'] == 2
    assert payload['friends_count'] == 1
    assert {log['author']: log['is_friend_log'] for log in payload['logs']} == {
        'inconnu': False, 'mon_ami': True
    }

    filtered = client.get(f'/api/geocaches/{app.geocache_id}/logs?friends_only=true').get_json()
    assert filtered['total_count'] == 1
    assert filtered['friends_count'] == 1        # compteur indépendant du filtre courant
    assert [log['author'] for log in filtered['logs']] == ['mon_ami']
