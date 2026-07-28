"""
Carte des trouvailles d'amis : coordonnées relevées à la déduction, zone « Amis »
masquée, et liste des caches à importer.

Aucun réseau : la session de recherche est simulée, l'import n'est pas déclenché
(seule la liste de ce qu'il aurait à faire est vérifiée).
"""
from __future__ import annotations

import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache
from gc_backend.models import FriendFind, Zone
from gc_backend.services.geocaching_friend_finds import (
    CacheSummary,
    GeocachingFriendFindsClient,
    ZoneBox,
    get_or_create_friends_zone,
    list_codes_to_import,
    store_finds,
)


BOX = ZoneBox(lat_max=49.3, lon_min=6.0, lat_min=49.2, lon_max=6.2)


class _FakeResponse:
    def __init__(self, payload, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code

    def json(self):
        return self._payload


class _RichSearchSession:
    """Recherche renvoyant des enregistrements complets, comme le vrai serveur."""

    def __init__(self, records: list[dict], found_by: dict[str, list[str]] | None = None):
        self.records = records
        self.found_by = found_by or {}

    def get(self, url, params=None, headers=None, timeout=None):
        records = self.records
        nfb = (params or {}).get('nfb')
        if nfb:
            found = set(self.found_by.get(nfb, []))
            records = [record for record in records if record['code'] not in found]

        skip = int((params or {}).get('skip', 0))
        take = int((params or {}).get('take', 100))
        return _FakeResponse({'total': len(records), 'results': records[skip:skip + take]})


def _record(code: str, name: str, type_id: int, lat: float, lon: float) -> dict:
    return {
        'code': code,
        'name': name,
        'geocacheType': {'id': type_id},
        'postedCoordinates': {'latitude': lat, 'longitude': lon},
    }


def _client(session):
    return GeocachingFriendFindsClient(
        session=session, min_interval=0, retry_delays=(), sleep=lambda _s: None
    )


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
        db.session.add(Geocache(gc_code='GC1', name='Un', type='Mystery', zone_id=zone.id,
                                latitude=49.21, longitude=6.11))
        db.session.commit()
        app.zone_id = zone.id
        yield app
        db.session.remove()
        db.drop_all()


# ------------------------------------------- Coordonnées relevées à la déduction

def test_deduction_keeps_the_metadata_of_the_reference(app):
    """
    La référence contient déjà coordonnées, nom et type : les jeter obligerait à
    importer chaque cache juste pour pouvoir la placer sur une carte.
    """
    session = _RichSearchSession(
        records=[
            _record('GC1', 'Un', 8, 49.21, 6.11),
            _record('GC2', 'Deux', 2, 49.22, 6.12),
            _record('GC3', 'Trois', 2, 49.23, 6.13),
        ],
        found_by={'ami1': ['GC1', 'GC3']},
    )

    result = _client(session).find_codes_found_by('ami1', BOX)

    assert result.found_codes == {'GC1', 'GC3'}
    assert set(result.summaries) == {'GC1', 'GC3'}
    assert result.summaries['GC3'] == CacheSummary(
        gc_code='GC3', name='Trois', cache_type='Traditional', latitude=49.23, longitude=6.13
    )


def test_search_codes_still_returns_plain_codes(app):
    """La signature historique reste disponible pour le complément `nfb`."""
    session = _RichSearchSession(records=[_record('GC1', 'Un', 2, 49.21, 6.11)])

    codes, truncated = _client(session).search_codes(BOX)

    assert (codes, truncated) == (['GC1'], False)


def test_records_without_coordinates_are_tolerated(app):
    """Un enregistrement réduit à son code ne doit pas faire échouer la passe."""
    session = _RichSearchSession(records=[{'code': 'GC9'}])

    summaries, _ = _client(session).search_summaries(BOX)

    assert summaries[0].gc_code == 'GC9'
    assert summaries[0].latitude is None


# ------------------------------------------------------------ store_finds

def test_store_finds_persists_summaries(app):
    store_finds('ami1', ['GC7'], summaries={
        'GC7': CacheSummary('GC7', name='Sept', cache_type='Multi', latitude=49.27, longitude=6.17)
    })

    row = FriendFind.query.filter_by(gc_code='GC7').one()
    assert (row.latitude, row.longitude) == (49.27, 6.17)
    assert (row.cache_name, row.cache_type) == ('Sept', 'Multi')


def test_store_finds_backfills_rows_created_before_the_columns(app):
    """Une ligne sans coordonnées est réparée à la resynchronisation, sans requête."""
    store_finds('ami1', ['GC7'])
    assert FriendFind.query.filter_by(gc_code='GC7').one().latitude is None

    store_finds('ami1', ['GC7'], summaries={
        'GC7': CacheSummary('GC7', name='Sept', cache_type='Multi', latitude=49.27, longitude=6.17)
    })

    row = FriendFind.query.filter_by(gc_code='GC7').one()
    assert row.latitude == 49.27
    assert row.cache_name == 'Sept'


# ------------------------------------------------------------ Zone « Amis »

def test_friends_zone_exists_from_startup(app):
    """
    Elle est créée à l'initialisation, comme la zone « default ».

    Sans ça, activer la préférence « Zone « Amis » visible » ne montrait rien
    tant qu'aucun import n'avait été lancé — l'utilisateur croyait la préférence
    cassée.
    """
    zone = Zone.query.filter_by(name='Amis').one()
    assert zone.is_hidden is True


def test_friends_zone_is_created_hidden_and_reused(app):
    zone = get_or_create_friends_zone()

    assert zone.name == 'Amis'
    assert zone.is_hidden is True
    # Deuxième appel : la même zone, pas un doublon (le nom est unique).
    assert get_or_create_friends_zone().id == zone.id


def test_hidden_zone_is_excluded_from_the_zone_list(app):
    get_or_create_friends_zone()
    client = app.test_client()

    visible = [zone['name'] for zone in client.get('/api/zones').get_json()]
    assert 'Amis' not in visible
    assert 'Z1' in visible

    with_hidden = [zone['name'] for zone in client.get('/api/zones?include_hidden=true').get_json()]
    assert 'Amis' in with_hidden


# --------------------------------------------------------- Liste à importer

def test_only_missing_caches_are_listed_for_import(app):
    # GC1 est déjà dans GeoApp (fixture), GC2 et GC3 non.
    store_finds('ami1', ['GC1', 'GC2'])
    store_finds('ami2', ['GC2', 'GC3'])

    assert list_codes_to_import() == ['GC2', 'GC3']


def test_nothing_to_import_when_everything_is_known(app):
    store_finds('ami1', ['GC1'])

    assert list_codes_to_import() == []


# ---------------------------------------------------------------- Route carte

def test_finds_map_uses_deduction_coordinates(app):
    store_finds('ami1', ['GC5'], summaries={
        'GC5': CacheSummary('GC5', name='Cinq', cache_type='Traditional', latitude=49.25, longitude=6.15)
    })

    payload = app.test_client().get('/api/friends/finds/map').get_json()

    assert payload['total'] == 1
    point = payload['points'][0]
    assert (point['gc_code'], point['latitude'], point['name']) == ('GC5', 49.25, 'Cinq')
    # Cache non importée : le frontend lui donnera un id négatif unique.
    assert point['geocache_id'] == 0
    assert payload['importable'] == 0


def test_finds_map_falls_back_on_the_imported_geocache(app):
    """`source='cache_logs'` n'apporte pas de coordonnées : la jointure les donne."""
    store_finds('ami1', ['GC1'], source='cache_logs')

    point = app.test_client().get('/api/friends/finds/map').get_json()['points'][0]

    assert point['latitude'] == 49.21
    assert point['geocache_id'] > 0


def test_finds_map_counts_what_an_import_would_fix(app):
    store_finds('ami1', ['GC404'])

    payload = app.test_client().get('/api/friends/finds/map').get_json()

    assert payload['total'] == 0
    assert payload['without_coordinates'] == 1
    assert payload['importable'] == 1


def test_finds_map_groups_friends_and_filters_by_friend(app):
    summaries = {'GC5': CacheSummary('GC5', latitude=49.25, longitude=6.15)}
    store_finds('ami1', ['GC5'], summaries=summaries)
    store_finds('ami2', ['GC5'], summaries=summaries)

    client = app.test_client()

    point = client.get('/api/friends/finds/map').get_json()['points'][0]
    assert [friend['username'] for friend in point['friends']] == ['ami1', 'ami2']

    filtered = client.get('/api/friends/finds/map?friend=ami2').get_json()['points'][0]
    assert [friend['username'] for friend in filtered['friends']] == ['ami2']
