"""Route streaming NDJSON pour l'analyse « qui a trouvé quoi » d'une zone."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache
from gc_backend.models import FriendFind, FriendZoneScan, Zone
from gc_backend.services.geocaching_friend_finds import (
    GeocachingFriendFindsClient,
    ZoneBox,
)


# ------------------------------------------------------------------ Fakes

class _FakeResponse:
    def __init__(self, payload=None, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code
        self.text = str(payload)

    def json(self):
        if self._payload is None:
            raise ValueError('no json')
        return self._payload


class _FakeSearchSession:
    """Renvoie tout le catalogue, filtré par nfb ou fb selon les params."""

    def __init__(self, catalogue: dict[str, list[str]]):
        self.catalogue = catalogue
        self.calls: list[dict] = []

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append(dict(params or {}))
        codes = list(self.catalogue['*'])
        nfb = (params or {}).get('nfb')
        if nfb:
            codes = [c for c in codes if c not in self.catalogue.get(nfb, [])]
        fb = (params or {}).get('fb')
        if fb:
            codes = [c for c in codes if c in self.catalogue.get(fb, [])]
        skip = int((params or {}).get('skip', 0))
        take = int((params or {}).get('take', 100))
        page = codes[skip:skip + take]
        return _FakeResponse({'total': len(codes), 'results': [{'code': c} for c in page]})


def _client(session):
    return GeocachingFriendFindsClient(
        session=session, min_interval=0, retry_delays=(), sleep=lambda _s: None
    )


class _LoggedInAuth:
    def is_logged_in(self) -> bool:
        return True


@dataclass
class _FakeFriend:
    username: str


@dataclass
class _FakeFriendsResult:
    friends: list[_FakeFriend]
    fetched_at: datetime
    reported_count: int | None = None
    pending_requests: int | None = None


class _FakeFriendsClient:
    def __init__(self, usernames: list[str]):
        self._usernames = usernames

    def get_friends(self, force_refresh: bool = False):
        return _FakeFriendsResult(
            friends=[_FakeFriend(u) for u in self._usernames],
            fetched_at=datetime.now(timezone.utc),
        )


# ------------------------------------------------------------------ Fixture

BOX = ZoneBox(lat_max=49.3, lon_min=6.0, lat_min=49.2, lon_max=6.2)


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
        db.session.add_all([
            Geocache(gc_code='GC1', name='Un', type='Mystery', zone_id=zone.id,
                     latitude=49.21, longitude=6.11),
            Geocache(gc_code='GC2', name='Deux', type='Traditional', zone_id=zone.id,
                     latitude=49.22, longitude=6.12),
        ])
        db.session.commit()
        app.zone_id = zone.id
        yield app
        db.session.remove()
        db.drop_all()


# ------------------------------------------------------------------ Tests

def _parse_ndjson(response) -> list[dict]:
    """Découpe une réponse streaming en liste d'objets JSON."""
    lines = response.data.decode('utf-8').strip().split('\n')
    return [__import__('json').loads(line) for line in lines if line.strip()]


def test_stream_rejects_invalid_payload(app):
    response = app.test_client().post('/api/friends/finds/sync-zone-stream', json={'zone_id': 'x'})
    assert response.status_code == 400
    assert response.get_json()['error'] == 'invalid_params'


def test_stream_rejects_missing_zone_id(app):
    response = app.test_client().post('/api/friends/finds/sync-zone-stream', json={})
    assert response.status_code == 400


def test_stream_rejects_when_not_authenticated(app, monkeypatch):
    import gc_backend.blueprints.friends as blueprint

    class _LoggedOutAuth:
        def is_logged_in(self) -> bool:
            return False

    monkeypatch.setattr(blueprint, 'get_auth_service', lambda: _LoggedOutAuth())

    response = app.test_client().post(
        '/api/friends/finds/sync-zone-stream', json={'zone_id': app.zone_id}
    )
    assert response.status_code == 401


def _zone_box_for(app):
    """Calcule la vraie box de la zone (avec marge) pour matcher la route."""
    import gc_backend.blueprints.friends as blueprint
    return blueprint._zone_box(app.zone_id)


def test_stream_scans_all_friends(app, monkeypatch):
    import gc_backend.blueprints.friends as blueprint
    import gc_backend.services.geocaching_friend_finds as finds_module
    import gc_backend.services.geocaching_friends as friends_module

    monkeypatch.setattr(blueprint, 'get_auth_service', lambda: _LoggedInAuth())

    session = _FakeSearchSession({
        '*': ['GC1', 'GC2'],
        'ami1': ['GC1'],
        'ami2': [],
    })
    monkeypatch.setattr(finds_module, '_client', _client(session))
    monkeypatch.setattr(friends_module, 'get_friends_client',
                        lambda: _FakeFriendsClient(['ami1', 'ami2']))

    response = app.test_client().post(
        '/api/friends/finds/sync-zone-stream',
        json={'zone_id': app.zone_id},
    )

    assert response.status_code == 200
    events = _parse_ndjson(response)

    phases = [e['phase'] for e in events]
    assert phases[0] == 'start'
    assert phases[-1] == 'done'
    assert 'progress' in phases

    start = events[0]
    assert start['total'] == 2
    assert start['to_scan'] == 2
    assert start['skipped'] == 0

    done = events[-1]
    assert done['scanned'] == 2
    assert done['with_friends'] >= 1  # GC1 trouvé par ami1

    # Les scans sont enregistrés en base.
    scans = FriendZoneScan.query.all()
    assert len(scans) == 2
    assert {s.friend_username for s in scans} == {'ami1', 'ami2'}

    # Les trouvailles sont stockées.
    finds = FriendFind.query.all()
    assert {f.gc_code for f in finds} == {'GC1'}


def test_stream_skips_fresh_scans(app, monkeypatch):
    import gc_backend.blueprints.friends as blueprint
    import gc_backend.services.geocaching_friend_finds as finds_module
    import gc_backend.services.geocaching_friends as friends_module

    monkeypatch.setattr(blueprint, 'get_auth_service', lambda: _LoggedInAuth())

    # Pré-enregistrer un scan frais pour ami1, avec la VRAIE box de la zone.
    from gc_backend.services.geocaching_friend_finds import record_scan
    real_box = _zone_box_for(app)
    record_scan('ami1', app.zone_id, real_box, found_count=1, baseline_total=2,
                zone_matches=1, truncated=False)

    session = _FakeSearchSession({
        '*': ['GC1', 'GC2'],
        'ami1': ['GC1'],
        'ami2': ['GC2'],
    })
    monkeypatch.setattr(finds_module, '_client', _client(session))
    monkeypatch.setattr(friends_module, 'get_friends_client',
                        lambda: _FakeFriendsClient(['ami1', 'ami2']))

    response = app.test_client().post(
        '/api/friends/finds/sync-zone-stream',
        json={'zone_id': app.zone_id},
    )

    events = _parse_ndjson(response)
    start = events[0]
    assert start['total'] == 2
    assert start['skipped'] == 1  # ami1 est frais
    assert start['to_scan'] == 1  # seul ami2 reste

    done = events[-1]
    assert done['scanned'] == 1
    assert done['skipped'] == 1


def test_stream_force_all_ignores_fresh_scans(app, monkeypatch):
    import gc_backend.blueprints.friends as blueprint
    import gc_backend.services.geocaching_friend_finds as finds_module
    import gc_backend.services.geocaching_friends as friends_module

    monkeypatch.setattr(blueprint, 'get_auth_service', lambda: _LoggedInAuth())

    from gc_backend.services.geocaching_friend_finds import record_scan
    real_box = _zone_box_for(app)
    record_scan('ami1', app.zone_id, real_box, found_count=1, baseline_total=2,
                zone_matches=1, truncated=False)

    session = _FakeSearchSession({
        '*': ['GC1', 'GC2'],
        'ami1': ['GC1'],
        'ami2': [],
    })
    monkeypatch.setattr(finds_module, '_client', _client(session))
    monkeypatch.setattr(friends_module, 'get_friends_client',
                        lambda: _FakeFriendsClient(['ami1', 'ami2']))

    response = app.test_client().post(
        '/api/friends/finds/sync-zone-stream',
        json={'zone_id': app.zone_id, 'force_all': True},
    )

    events = _parse_ndjson(response)
    start = events[0]
    assert start['skipped'] == 0
    assert start['to_scan'] == 2


def test_stream_empty_friends_list(app, monkeypatch):
    import gc_backend.blueprints.friends as blueprint
    import gc_backend.services.geocaching_friend_finds as finds_module
    import gc_backend.services.geocaching_friends as friends_module

    monkeypatch.setattr(blueprint, 'get_auth_service', lambda: _LoggedInAuth())
    session = _FakeSearchSession({'*': ['GC1', 'GC2']})
    monkeypatch.setattr(finds_module, '_client', _client(session))
    monkeypatch.setattr(friends_module, 'get_friends_client',
                        lambda: _FakeFriendsClient([]))

    response = app.test_client().post(
        '/api/friends/finds/sync-zone-stream',
        json={'zone_id': app.zone_id},
    )

    events = _parse_ndjson(response)
    assert len(events) == 1
    assert events[0]['phase'] == 'done'
    assert events[0]['scanned'] == 0


def test_stream_all_fresh_emits_done(app, monkeypatch):
    import gc_backend.blueprints.friends as blueprint
    import gc_backend.services.geocaching_friend_finds as finds_module
    import gc_backend.services.geocaching_friends as friends_module

    monkeypatch.setattr(blueprint, 'get_auth_service', lambda: _LoggedInAuth())

    from gc_backend.services.geocaching_friend_finds import record_scan
    real_box = _zone_box_for(app)
    record_scan('ami1', app.zone_id, real_box, found_count=0, baseline_total=2,
                zone_matches=0, truncated=False)
    record_scan('ami2', app.zone_id, real_box, found_count=0, baseline_total=2,
                zone_matches=0, truncated=False)

    session = _FakeSearchSession({'*': ['GC1', 'GC2']})
    monkeypatch.setattr(finds_module, '_client', _client(session))
    monkeypatch.setattr(friends_module, 'get_friends_client',
                        lambda: _FakeFriendsClient(['ami1', 'ami2']))

    response = app.test_client().post(
        '/api/friends/finds/sync-zone-stream',
        json={'zone_id': app.zone_id},
    )

    events = _parse_ndjson(response)
    # start + done, aucun progress.
    phases = [e['phase'] for e in events]
    assert phases == ['start', 'done']
    assert events[0]['skipped'] == 2
    assert events[0]['to_scan'] == 0
    assert events[-1]['scanned'] == 0


def test_stream_filters_selected_friends(app, monkeypatch):
    """Le paramètre friends[] filtre la liste d'amis à scanner."""
    import gc_backend.blueprints.friends as blueprint
    import gc_backend.services.geocaching_friend_finds as finds_module
    import gc_backend.services.geocaching_friends as friends_module

    monkeypatch.setattr(blueprint, 'get_auth_service', lambda: _LoggedInAuth())

    session = _FakeSearchSession({
        '*': ['GC1', 'GC2'],
        'ami1': ['GC1'],
        'ami2': ['GC2'],
        'ami3': [],
    })
    monkeypatch.setattr(finds_module, '_client', _client(session))
    monkeypatch.setattr(friends_module, 'get_friends_client',
                        lambda: _FakeFriendsClient(['ami1', 'ami2', 'ami3']))

    # Ne scanner que ami1 et ami3 (pas ami2).
    response = app.test_client().post(
        '/api/friends/finds/sync-zone-stream',
        json={'zone_id': app.zone_id, 'friends': ['ami1', 'ami3']},
    )

    events = _parse_ndjson(response)
    start = events[0]
    assert start['total'] == 2  # 2 amis dans le sous-ensemble
    assert start['to_scan'] == 2
    assert start['skipped'] == 0

    done = events[-1]
    assert done['scanned'] == 2

    # Seuls ami1 et ami3 ont un scan enregistré.
    scans = {s.friend_username for s in FriendZoneScan.query.all()}
    assert scans == {'ami1', 'ami3'}


def test_stream_rejects_invalid_friends_param(app, monkeypatch):
    """friends doit être une liste, pas une chaîne."""
    import gc_backend.blueprints.friends as blueprint

    monkeypatch.setattr(blueprint, 'get_auth_service', lambda: _LoggedInAuth())

    response = app.test_client().post(
        '/api/friends/finds/sync-zone-stream',
        json={'zone_id': app.zone_id, 'friends': 'ami1'},
    )
    assert response.status_code == 400
    assert response.get_json()['error'] == 'invalid_params'


def test_stream_empty_friends_subset_emits_done(app, monkeypatch):
    """Une liste friends vide → 0 amis à scanner, done immédiat."""
    import gc_backend.blueprints.friends as blueprint
    import gc_backend.services.geocaching_friend_finds as finds_module
    import gc_backend.services.geocaching_friends as friends_module

    monkeypatch.setattr(blueprint, 'get_auth_service', lambda: _LoggedInAuth())
    session = _FakeSearchSession({'*': ['GC1', 'GC2']})
    monkeypatch.setattr(finds_module, '_client', _client(session))
    monkeypatch.setattr(friends_module, 'get_friends_client',
                        lambda: _FakeFriendsClient(['ami1', 'ami2']))

    response = app.test_client().post(
        '/api/friends/finds/sync-zone-stream',
        json={'zone_id': app.zone_id, 'friends': []},
    )

    events = _parse_ndjson(response)
    assert len(events) == 1
    assert events[0]['phase'] == 'done'
    assert events[0]['scanned'] == 0
