"""
Pourcentage de favoris : dénominateur et stockage.

Le sujet de ces tests est le dénominateur du pourcentage. Il doit être le nombre
de trouvailles annoncé par Geocaching.com (`finds_count`), jamais le nombre de
logs rafraîchis en local (`logs_count`), qui produisait des valeurs supérieures à
100 % tant que le logbook n'était pas entièrement chargé.
"""
from __future__ import annotations

import json

import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache
from gc_backend.models import Zone
from gc_backend.services.geocaching_logs import GeocachingLogsClient


CACHE_PAGE = "<html><script>var userToken = 'TOKEN123';</script></html>"


def _log_entry(log_id: int, log_type: str) -> dict:
    return {
        'LogID': log_id,
        'LogGuid': f'guid-{log_id}',
        'LogType': log_type,
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


class _LogbookSession:
    """Rejoue un logbook dont on choisit la composition par type de log."""

    def __init__(self, log_types: list[str]):
        self.log_types = log_types

    def get(self, url: str, params=None, headers=None, timeout=None):
        if 'geocache/' in url:
            return _FakeResponse(text=CACHE_PAGE)

        params = params or {}
        if params.get('sf') == 'true' or params.get('sp') == 'true':
            return _FakeResponse(payload={'status': 'success', 'data': []})

        size = int(params['num'])
        start = (int(params['idx']) - 1) * size
        window = self.log_types[start:start + size]
        entries = [_log_entry(start + i + 1, log_type) for i, log_type in enumerate(window)]
        return _FakeResponse(payload={
            'status': 'success',
            'data': entries,
            'pageInfo': {
                'idx': params['idx'],
                'size': size,
                'rows': len(entries),
                'totalRows': len(self.log_types),
            },
        })


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


def test_percent_is_computed_on_the_finds_not_on_the_stored_logs():
    """Le cas GC8QY1G : 102 PF pour 51 logs stockés donnait 200 %."""
    geocache = Geocache(gc_code='GC8QY1G', name='Labyrinthe', favorites_count=102,
                        logs_count=51, logs_total_available=171, finds_count=165)

    assert geocache.update_favorites_percent() == 61.8
    assert geocache.favorites_percent == 61.8


def test_percent_stays_unknown_without_a_finds_count():
    """Mieux vaut pas de pourcentage qu'un pourcentage faux."""
    geocache = Geocache(gc_code='GC8QY1G', name='Labyrinthe', favorites_count=102, logs_count=51)

    assert geocache.update_favorites_percent() is None
    assert geocache.favorites_percent is None


def test_percent_stays_unknown_on_a_cache_nobody_found():
    """Zéro trouvaille : division impossible, et 0 PF ne vaut pas 0 %."""
    geocache = Geocache(gc_code='GC8QY1G', name='Labyrinthe', favorites_count=0, finds_count=0)

    assert geocache.update_favorites_percent() is None


def test_percent_is_recomputed_from_a_previous_value():
    """Une valeur devenue incalculable doit être effacée, pas laissée en place."""
    geocache = Geocache(gc_code='GC8QY1G', name='Labyrinthe', favorites_count=10,
                        finds_count=100, favorites_percent=10.0)
    geocache.finds_count = None

    assert geocache.update_favorites_percent() is None


def test_full_logbook_refresh_derives_the_finds_count(app, monkeypatch):
    """
    Logbook entièrement stocké : les « Found » locaux valent ceux du site, et
    valent mieux que des compteurs lus au dernier scrape de la page.
    """
    _patch_client(monkeypatch, _LogbookSession(
        ['Found it'] * 8 + ["Didn't find it", 'Write note']
    ))
    geocache = Geocache.query.get(app.geocache_id)
    geocache.favorites_count = 4
    db.session.commit()

    app.test_client().post(f'/api/geocaches/{app.geocache_id}/logs/refresh?count=100')

    geocache = Geocache.query.get(app.geocache_id)
    assert geocache.logs_count == 10
    assert geocache.finds_count == 8
    assert geocache.favorites_percent == 50.0


def test_partial_logbook_refresh_leaves_the_finds_count_alone(app, monkeypatch):
    """Une page de logs sur dix ne dit rien du nombre total de trouvailles."""
    _patch_client(monkeypatch, _LogbookSession(['Found it'] * 100))
    geocache = Geocache.query.get(app.geocache_id)
    geocache.favorites_count = 20
    geocache.finds_count = 95
    geocache.update_favorites_percent()
    db.session.commit()

    app.test_client().post(f'/api/geocaches/{app.geocache_id}/logs/refresh?count=10')

    geocache = Geocache.query.get(app.geocache_id)
    assert geocache.logs_count == 10
    assert geocache.finds_count == 95
    assert geocache.favorites_percent == 21.1


def test_summary_carries_the_percent_to_the_frontend(app):
    """`/api/geocaches/batch` alimente le tableau de l'éditeur de logs."""
    geocache = Geocache.query.get(app.geocache_id)
    geocache.favorites_count = 102
    geocache.finds_count = 165
    geocache.update_favorites_percent()
    db.session.commit()

    payload = app.test_client().get(
        f'/api/geocaches/batch?ids={app.geocache_id}'
    ).get_json()

    assert payload['geocaches'][0]['finds_count'] == 165
    assert payload['geocaches'][0]['favorites_percent'] == 61.8
