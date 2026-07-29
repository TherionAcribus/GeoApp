"""Déduction « trouvées par un ami » via le complément du filtre `nfb`."""
from __future__ import annotations

import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache
from gc_backend.models import FriendFind, Zone
from gc_backend.services.geocaching_friend_finds import (
    FriendFindsError,
    GeocachingFriendFindsClient,
    RateLimitedError,
    ZoneBox,
    store_finds,
)


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
    """Renvoie tout le catalogue, moins les caches trouvées par l'ami filtré."""

    def __init__(self, catalogue: dict[str, list[str]], status_codes: list[int] | None = None):
        self.catalogue = catalogue          # {pseudo: codes trouvés} + clé '*' = toutes
        self.calls: list[dict] = []
        self.status_codes = status_codes or []

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append(dict(params or {}))

        if self.status_codes:
            code = self.status_codes.pop(0)
            if code != 200:
                return _FakeResponse({'statusCode': code}, status_code=code)

        codes = list(self.catalogue['*'])
        nfb = (params or {}).get('nfb')
        if nfb:
            codes = [c for c in codes if c not in self.catalogue.get(nfb, [])]

        skip = int((params or {}).get('skip', 0))
        take = int((params or {}).get('take', 100))
        page = codes[skip:skip + take]
        return _FakeResponse({'total': len(codes), 'results': [{'code': c} for c in page]})


def _client(session, **kwargs):
    # min_interval/retry_delays à zéro : aucun test ne doit attendre réellement.
    kwargs.setdefault('min_interval', 0)
    kwargs.setdefault('retry_delays', ())
    kwargs.setdefault('sleep', lambda _seconds: None)
    return GeocachingFriendFindsClient(session=session, **kwargs)


BOX = ZoneBox(lat_max=49.3, lon_min=6.0, lat_min=49.2, lon_max=6.2)


# ------------------------------------------------------------------ ZoneBox

def test_zone_box_from_coordinates_adds_a_margin():
    box = ZoneBox.from_coordinates([(49.2, 6.1), (49.25, 6.15)], margin=0.01)

    assert box.lat_max == pytest.approx(49.26)
    assert box.lat_min == pytest.approx(49.19)
    assert box.lon_min == pytest.approx(6.09)
    assert box.lon_max == pytest.approx(6.16)
    assert box.box_param.startswith('49.26,6.09,')


def test_zone_box_ignores_missing_coordinates_and_empty_zones():
    assert ZoneBox.from_coordinates([(None, None), (49.2, 6.1)]) is not None
    assert ZoneBox.from_coordinates([]) is None
    assert ZoneBox.from_coordinates([(None, 6.1)]) is None


# ------------------------------------------------------------- Déduction nfb

def test_friend_finds_are_the_complement_of_not_found_by():
    session = _FakeSearchSession({
        '*': ['GC1', 'GC2', 'GC3', 'GC4'],
        'ami': ['GC2', 'GC4'],
    })

    result = _client(session).find_codes_found_by('ami', BOX)

    assert result.found_codes == {'GC2', 'GC4'}
    assert result.zone_codes_count == 4
    assert result.truncated is False


def test_baseline_is_fetched_once_for_several_friends():
    session = _FakeSearchSession({
        '*': ['GC1', 'GC2', 'GC3'],
        'ami1': ['GC1'],
        'ami2': ['GC3'],
    })
    client = _client(session)

    client.find_codes_found_by('ami1', BOX)
    client.find_codes_found_by('ami2', BOX)

    # 1 référence + 1 requête nfb par ami (et non 2 références).
    assert len(session.calls) == 3
    assert [call.get('nfb') for call in session.calls] == [None, 'ami1', 'ami2']


def test_pagination_collects_every_page():
    session = _FakeSearchSession({'*': [f'GC{i}' for i in range(250)], 'ami': ['GC7']})
    client = _client(session)
    client.PAGE_SIZE = 100

    codes, truncated = client.search_codes(BOX)

    assert len(codes) == 250
    assert truncated is False


def test_pagination_guard_flags_oversized_zones():
    session = _FakeSearchSession({'*': [f'GC{i}' for i in range(1000)]})
    client = _client(session)
    client.PAGE_SIZE = 10
    client.MAX_PAGES = 3

    codes, truncated = client.search_codes(BOX)

    assert truncated is True
    assert len(codes) == 30


def test_truncated_baseline_stays_truncated_when_served_from_cache():
    """
    Un hit du cache mémoire de la référence de zone ne doit pas faire
    disparaître le drapeau `truncated` : sinon une zone démesurée redevient
    silencieusement « complète » pendant les 10 minutes du TTL.
    """
    session = _FakeSearchSession({'*': [f'GC{i}' for i in range(1000)]})
    client = _client(session)
    client.PAGE_SIZE = 10
    client.MAX_PAGES = 3

    _, truncated_first = client.get_zone_baseline_summaries(BOX)
    assert truncated_first is True

    calls_before = len(session.calls)
    _, truncated_cached = client.get_zone_baseline_summaries(BOX)

    assert len(session.calls) == calls_before  # servi depuis le cache
    assert truncated_cached is True


# --------------------------------------------------------------- Rate limit

def test_rate_limit_is_retried_then_surfaced():
    delays: list[float] = []
    session = _FakeSearchSession({'*': ['GC1']}, status_codes=[429, 200])
    client = _client(session, retry_delays=(1.0, 2.0), sleep=delays.append)

    codes, _ = client.search_codes(BOX)
    assert codes == ['GC1']
    assert delays == [1.0]          # une seule temporisation, puis succès

    session = _FakeSearchSession({'*': ['GC1']}, status_codes=[429, 429, 429])
    client = _client(session, retry_delays=(1.0, 2.0), sleep=lambda _s: None)
    with pytest.raises(RateLimitedError):
        client.search_codes(BOX)


def test_unexpected_status_raises():
    session = _FakeSearchSession({'*': []}, status_codes=[500])
    with pytest.raises(FriendFindsError):
        _client(session).search_codes(BOX)


def test_throttle_waits_between_requests():
    waited: list[float] = []
    session = _FakeSearchSession({'*': ['GC1'], 'ami': []})
    client = GeocachingFriendFindsClient(
        session=session, min_interval=6.0, retry_delays=(), sleep=waited.append
    )

    client.search_codes(BOX)
    client.search_codes(BOX, {'nfb': 'ami'})

    # La deuxième requête attend le délai minimal (la première part aussitôt).
    assert len(waited) == 1 and 0 < waited[0] <= 6.0


# --------------------------------------------------------------- Persistance

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


def test_store_finds_is_idempotent(app):
    assert store_finds('ami', ['GC1', 'GC2']) == (2, 0)
    assert store_finds('ami', ['GC1', 'GC2']) == (0, 2)
    assert FriendFind.query.count() == 2


def test_store_finds_normalizes_codes_and_removes_stale_ones(app):
    store_finds('ami', ['gc1', 'GC2'])
    assert {row.gc_code for row in FriendFind.query.all()} == {'GC1', 'GC2'}

    # Resynchronisation de la zone : GC2 n'est plus trouvée -> la ligne disparaît.
    store_finds('ami', ['GC1'], replace_scope=['GC1', 'GC2'])
    assert {row.gc_code for row in FriendFind.query.all()} == {'GC1'}


def test_stale_removal_only_touches_the_same_source(app):
    store_finds('ami', ['GC2'], source='cache_logs')

    store_finds('ami', ['GC1'], source='zone_search', replace_scope=['GC1', 'GC2'])

    # GC2 vient des logs (donc d'un log d'ami avéré) : la déduction de zone,
    # aveugle aux caches archivées, ne doit pas l'effacer.
    assert {row.gc_code for row in FriendFind.query.all()} == {'GC1', 'GC2'}


def test_a_find_confirmed_by_two_sources_survives_a_single_source_resync(app):
    """
    Une trouvaille créée par zone_search puis reconfirmée par le flux
    d'activité doit survivre à une resynchronisation de zone qui ne la
    retrouve plus (faux-négatif de `nfb`, cache momentanément hors boîte...) :
    seule la preuve `zone_search` doit disparaître, pas la trouvaille.
    """
    store_finds('ami', ['GC1'], source='zone_search')
    store_finds('ami', ['GC1'], source='activity')

    row = FriendFind.query.filter_by(friend_username='ami', gc_code='GC1').one()
    assert set(row.source.split(',')) == {'zone_search', 'activity'}

    store_finds('ami', [], source='zone_search', replace_scope=['GC1'])

    row = FriendFind.query.filter_by(friend_username='ami', gc_code='GC1').one()
    assert row.source == 'activity'
    assert FriendFind.query.count() == 1


def test_find_is_deleted_once_no_source_confirms_it_anymore(app):
    store_finds('ami', ['GC1'], source='zone_search')
    store_finds('ami', [], source='zone_search', replace_scope=['GC1'])
    assert FriendFind.query.count() == 0


# ----------------------------------------------------------------------- API

def test_zone_finds_endpoint_groups_by_cache(app):
    store_finds('ami1', ['GC1', 'GC2'])
    store_finds('ami2', ['GC1'])

    payload = app.test_client().get(f'/api/friends/finds/zone/{app.zone_id}').get_json()

    assert payload['success'] is True
    assert payload['caches_with_friend_finds'] == 2
    assert payload['finds']['GC1'] == ['ami1', 'ami2']
    assert payload['finds']['GC2'] == ['ami1']


def test_geocache_finds_endpoint_lists_friends(app):
    geocache = Geocache.query.filter_by(gc_code='GC1').first()
    store_finds('ami1', ['GC1'])

    payload = app.test_client().get(f'/api/friends/finds/geocache/{geocache.id}').get_json()

    assert payload['count'] == 1
    assert payload['friends'][0]['username'] == 'ami1'


def test_sync_zone_rejects_invalid_payload(app):
    response = app.test_client().post('/api/friends/finds/sync-zone', json={'zone_id': 'x'})

    assert response.status_code == 400
    assert response.get_json()['error'] == 'invalid_params'
