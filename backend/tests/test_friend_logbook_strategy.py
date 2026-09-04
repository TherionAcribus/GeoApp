"""Heuristique logbook vs zone search, et scan via sf=true."""
from __future__ import annotations

from datetime import datetime
from dataclasses import dataclass

import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache
from gc_backend.models import FriendFind, Zone
from gc_backend.services.geocaching_friend_finds import (
    estimate_logbook_cost,
    estimate_zone_search_cost,
    should_use_logbook,
    scan_finds_via_logbook,
)


# ------------------------------------------------------- Tests heuristique

def test_logbook_cost_independent_of_friends():
    """Le coût logbook ne dépend que du nombre de caches, pas d'amis."""
    assert estimate_logbook_cost(10) == 30
    assert estimate_logbook_cost(20) == 60
    assert estimate_logbook_cost(0) == 0


def test_zone_search_cost_scales_with_friends():
    """Le coût zone search dépend du nombre d'amis et de la pagination."""
    # 16 amis, 100 caches balayées, 100 par page → 1 page/ami → 16 requêtes
    assert estimate_zone_search_cost(16, 100) == 16
    # 16 amis, 1400 caches balayées → 14 pages/ami → 224 requêtes
    assert estimate_zone_search_cost(16, 1400) == 224
    # 0 amis → 0
    assert estimate_zone_search_cost(0, 1000) == 0


def test_should_use_logbook_few_caches_many_friends():
    """5 caches, 16 amis, 1400 balayées → logbook (15 < 224)."""
    assert should_use_logbook(5, 16, 1400) is True


def test_should_use_logbook_many_caches_few_friends():
    """100 caches, 2 amis, 200 balayées → zone search (6 < 2)."""
    # logbook = 300, zone = 2 * 2 = 4 → zone gagne
    assert should_use_logbook(100, 2, 200) is False


def test_should_use_logbook_balanced_case():
    """20 caches, 16 amis, 100 balayées → zone search (60 > 16)."""
    # logbook = 60, zone = 16 * 1 = 16 → zone gagne
    assert should_use_logbook(20, 16, 100) is False


def test_should_use_logbook_zero_friends():
    """0 amis → logbook inutile (coût zone = 0)."""
    assert should_use_logbook(10, 0, 100) is False


def test_should_use_logbook_zero_caches():
    """0 caches → logbook gratuit (0 < coût zone)."""
    assert should_use_logbook(0, 16, 100) is True


# ------------------------------------------------------- Tests scan_finds_via_logbook

@dataclass
class _FakeLogData:
    external_id: str
    author: str
    author_guid: str | None
    text: str
    date: datetime | None
    log_type: str
    is_favorite: bool


class _FakeLogsClient:
    """Simule GeocachingLogsClient.get_logs_with_friends."""

    # Les pseudos considérés comme « amis » par le fake.
    FRIEND_USERNAMES = {'ami1', 'ami2', 'ami3'}

    def __init__(self, cache_friends: dict[str, list[tuple[str, str]]]):
        """
        cache_friends : {gc_code: [(author, log_type), ...]}
        """
        self.cache_friends = cache_friends
        self.calls: list[str] = []

    def get_logs_with_friends(self, gc_code: str, count: int = 25):
        self.calls.append(gc_code)
        entries = self.cache_friends.get(gc_code, [])
        logs = [
            _FakeLogData(
                external_id=f"log-{gc_code}-{i}",
                author=author,
                author_guid=None,
                text="",
                date=datetime(2024, 1, 1),
                log_type=log_type,
                is_favorite=False,
            )
            for i, (author, log_type) in enumerate(entries)
        ]
        # Les « amis » sont ceux dont l'auteur est dans FRIEND_USERNAMES
        # ET le log_type est "Found" (le filtre sf=true ne renvoie que les
        # logs d'amis, mais on simule ici le comportement complet).
        friend_ids = {
            log.external_id for log in logs
            if log.log_type == "Found" and log.author in self.FRIEND_USERNAMES
        }
        return logs, friend_ids


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
            Geocache(gc_code='GC1', name='Un', type='Traditional',
                     zone_id=zone.id, latitude=49.21, longitude=6.11),
            Geocache(gc_code='GC2', name='Deux', type='Multi',
                     zone_id=zone.id, latitude=49.22, longitude=6.12),
        ])
        db.session.commit()
        app.zone_id = zone.id
        yield app
        db.session.remove()
        db.drop_all()


def test_scan_logbook_stores_friend_finds(app, monkeypatch):
    """Le scan logbook enregistre les Found d'amis dans FriendFind."""
    fake = _FakeLogsClient({
        'GC1': [('ami1', 'Found'), ('ami2', 'Found'), ('stranger', 'Found')],
        'GC2': [('ami1', 'Found'), ('ami2', "Didn't find it")],
    })
    monkeypatch.setattr(
        'gc_backend.services.geocaching_logs.GeocachingLogsClient',
        lambda: fake,
    )

    result = scan_finds_via_logbook(app.zone_id, ['GC1', 'GC2'])

    assert result['scanned'] == 2
    assert result['errors'] == []
    assert result['rate_limited'] is False

    # ami1 a trouvé GC1 et GC2, ami2 n'a trouvé que GC1 (DNF sur GC2).
    assert set(result['friend_finds']['ami1']) == {'GC1', 'GC2'}
    assert set(result['friend_finds']['ami2']) == {'GC1'}

    # Les trouvailles sont en base avec source='cache_logs'.
    rows = {(r.friend_username, r.gc_code) for r in FriendFind.query.all()}
    assert ('ami1', 'GC1') in rows
    assert ('ami1', 'GC2') in rows
    assert ('ami2', 'GC1') in rows
    # stranger n'est pas un ami : pas de FriendFind.
    assert not any(r.friend_username == 'stranger' for r in FriendFind.query.all())

    for row in FriendFind.query.all():
        assert 'cache_logs' in row.source


def test_scan_logbook_empty_zone(app, monkeypatch):
    """Une zone sans caches à scanner retourne un résultat vide."""
    fake = _FakeLogsClient({})
    monkeypatch.setattr(
        'gc_backend.services.geocaching_logs.GeocachingLogsClient',
        lambda: fake,
    )

    result = scan_finds_via_logbook(app.zone_id, [])

    assert result['scanned'] == 0
    assert result['friend_finds'] == {}
    assert result['errors'] == []


def test_scan_logbook_no_friends_found(app, monkeypatch):
    """Aucun ami n'a loggué : pas de FriendFind, mais le scan compte."""
    fake = _FakeLogsClient({
        'GC1': [('stranger', 'Found')],
        'GC2': [],
    })
    monkeypatch.setattr(
        'gc_backend.services.geocaching_logs.GeocachingLogsClient',
        lambda: fake,
    )

    result = scan_finds_via_logbook(app.zone_id, ['GC1', 'GC2'])

    assert result['scanned'] == 2
    assert result['friend_finds'] == {}
    assert FriendFind.query.count() == 0


def test_scan_logbook_handles_errors(app, monkeypatch):
    """Une cache en erreur ne stoppe pas le scan des autres."""

    class _ErrorClient:
        def __init__(self):
            self.calls = []

        def get_logs_with_friends(self, gc_code: str, count: int = 25):
            self.calls.append(gc_code)
            if gc_code == 'GC1':
                from gc_backend.services.geocaching_logs import GeocachingLogsError
                raise GeocachingLogsError("Network error")
            return [], set()

    monkeypatch.setattr(
        'gc_backend.services.geocaching_logs.GeocachingLogsClient',
        lambda: _ErrorClient(),
    )

    result = scan_finds_via_logbook(app.zone_id, ['GC1', 'GC2'])

    assert result['scanned'] == 1  # GC2 seulement
    assert 'GC1' in result['errors']
    assert result['friend_finds'] == {}


def test_scan_logbook_progress_callback(app, monkeypatch):
    """Le callback on_progress est appelé pour chaque cache."""
    fake = _FakeLogsClient({
        'GC1': [('ami1', 'Found')],
        'GC2': [('ami1', 'Found')],
    })
    monkeypatch.setattr(
        'gc_backend.services.geocaching_logs.GeocachingLogsClient',
        lambda: fake,
    )

    progress_calls = []
    scan_finds_via_logbook(
        app.zone_id, ['GC1', 'GC2'],
        on_progress=lambda done, total, gc_code: progress_calls.append((done, total, gc_code)),
    )

    assert progress_calls == [
        (1, 2, 'GC1'),
        (2, 2, 'GC2'),
    ]


# ------------------------------------------------------- Tests route streaming avec stratégie

class _FakeSearchSession:
    class _Resp:
        def __init__(self, payload):
            self._payload = payload
            self.status_code = 200
            self.text = str(payload)

        def json(self):
            return self._payload

    def __init__(self, total: int = 100):
        self._total = total

    def get(self, url, params=None, headers=None, timeout=None):
        return self._Resp({'total': self._total, 'results': [{'code': 'GC1'}]})


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
            fetched_at=datetime.now(),
        )


def _parse_ndjson(response) -> list[dict]:
    import json
    lines = response.data.decode('utf-8').strip().split('\n')
    return [json.loads(line) for line in lines if line.strip()]


def test_stream_chooses_logbook_when_cheaper(app, monkeypatch):
    """Zone avec 2 caches et 16 amis, balayage 1400 → logbook."""
    import gc_backend.blueprints.friends as blueprint
    import gc_backend.services.geocaching_friend_finds as finds_module
    import gc_backend.services.geocaching_friends as friends_module

    monkeypatch.setattr(blueprint, 'get_auth_service', lambda: _LoggedInAuth())

    # 16 amis, 1400 caches balayées → logbook (6 < 224).
    session = _FakeSearchSession(total=1400)
    from gc_backend.services.geocaching_friend_finds import GeocachingFriendFindsClient
    monkeypatch.setattr(finds_module, '_client', GeocachingFriendFindsClient(
        session=session, min_interval=0, retry_delays=(), sleep=lambda _s: None
    ))
    monkeypatch.setattr(friends_module, 'get_friends_client',
                        lambda: _FakeFriendsClient([f'ami{i}' for i in range(16)]))

    # Mocker le logbook pour éviter les requêtes réseau.
    fake_logs = _FakeLogsClient({
        'GC1': [('ami1', 'Found')],
        'GC2': [('ami2', 'Found')],
    })
    monkeypatch.setattr(
        'gc_backend.services.geocaching_logs.GeocachingLogsClient',
        lambda: fake_logs,
    )

    response = app.test_client().post(
        '/api/friends/finds/sync-zone-stream',
        json={'zone_id': app.zone_id},
    )

    events = _parse_ndjson(response)
    start = events[0]
    assert start['strategy'] == 'logbook'
    assert start['clusters'] == 1

    # Le done doit indiquer la stratégie logbook.
    done = events[-1]
    assert done['phase'] == 'done'
    assert done['strategy'] == 'logbook'
    assert done['caches_scanned'] == 2


def test_stream_chooses_zone_search_when_cheaper(app, monkeypatch):
    """Zone avec 2 caches et 2 amis, balayage 4 → zone search (6 > 2)."""
    import gc_backend.blueprints.friends as blueprint
    import gc_backend.services.geocaching_friend_finds as finds_module
    import gc_backend.services.geocaching_friends as friends_module

    monkeypatch.setattr(blueprint, 'get_auth_service', lambda: _LoggedInAuth())

    # 2 amis, 4 caches balayées → zone search (6 > 2*1=2).
    session = _FakeSearchSession(total=4)
    from gc_backend.services.geocaching_friend_finds import GeocachingFriendFindsClient
    monkeypatch.setattr(finds_module, '_client', GeocachingFriendFindsClient(
        session=session, min_interval=0, retry_delays=(), sleep=lambda _s: None
    ))
    monkeypatch.setattr(friends_module, 'get_friends_client',
                        lambda: _FakeFriendsClient(['ami1', 'ami2']))

    response = app.test_client().post(
        '/api/friends/finds/sync-zone-stream',
        json={'zone_id': app.zone_id},
    )

    events = _parse_ndjson(response)
    start = events[0]
    assert start['strategy'] == 'zone_search'
