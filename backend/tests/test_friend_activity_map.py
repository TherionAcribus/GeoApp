"""
Tests de l'agrégation cartographique du flux d'activité des amis.

Aucun réseau : on écrit directement des lignes `friend_activity`, comme le ferait
une synchronisation, et on vérifie ce que `query_map_points()` en fait.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache
from gc_backend.models import FriendActivity
from gc_backend.services import friend_activity_store


@pytest.fixture
def app():
    app = create_app()
    app.config['TESTING'] = True
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'

    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()


def _log(
    log_code: str,
    *,
    username: str = 'ami1',
    gc_code: str | None = 'GC11111',
    log_type_id: int = 2,
    log_date: datetime | None = None,
    latitude: float | None = 48.9889,
    longitude: float | None = 4.5657,
    cache_type_id: int | None = 2,
    is_self: bool = False,
) -> FriendActivity:
    row = FriendActivity(
        log_reference_code=log_code,
        activity_type=2,
        author_username=username,
        is_self=is_self,
        log_type_id=log_type_id,
        log_date=log_date or datetime(2026, 7, 20, 10, 0, 0),
        cache_name='Le vieux pont',
        cache_reference_code=gc_code,
        cache_type_id=cache_type_id,
        difficulty=2.0,
        terrain=1.5,
        latitude=latitude,
        longitude=longitude,
    )
    db.session.add(row)
    return row


# ------------------------------------------------------- Dédoublonnage / agrégation

def test_groups_logs_of_the_same_cache_into_one_point(app):
    """Trois amis sur la même cache = un seul point, trois auteurs."""
    _log('GL1', username='ami1', log_date=datetime(2026, 7, 10, 10, 0))
    _log('GL2', username='ami2', log_date=datetime(2026, 7, 20, 10, 0))
    _log('GL3', username='ami3', log_date=datetime(2026, 7, 15, 10, 0))
    db.session.commit()

    result = friend_activity_store.query_map_points()

    assert result['total'] == 1
    point = result['points'][0]
    assert point['gc_code'] == 'GC11111'
    assert [friend['username'] for friend in point['friends']] == ['ami2', 'ami3', 'ami1']
    # Le point porte la date du log le plus récent, pas celle du premier inséré.
    assert point['last_log_date'] == '2026-07-20T10:00:00'


def test_distinct_caches_give_distinct_points(app):
    _log('GL1', gc_code='GC11111')
    _log('GL2', gc_code='GC22222')
    db.session.commit()

    result = friend_activity_store.query_map_points()

    assert result['total'] == 2
    assert {point['gc_code'] for point in result['points']} == {'GC11111', 'GC22222'}


def test_logs_without_gc_code_are_not_merged_together(app):
    """Sans code GC il n'y a pas de clé de regroupement : ne pas tout empiler."""
    _log('GL1', gc_code=None)
    _log('GL2', gc_code=None)
    db.session.commit()

    result = friend_activity_store.query_map_points()

    assert result['total'] == 2


# ------------------------------------------------------------ Jointure GeoApp

def test_imported_cache_carries_its_geocache_id(app):
    db.session.add(Geocache(gc_code='GC11111', name='Le vieux pont', zone_id=1, found=True))
    _log('GL1', gc_code='GC11111')
    _log('GL2', gc_code='GC99999')
    db.session.commit()

    points = {point['gc_code']: point for point in friend_activity_store.query_map_points()['points']}

    assert points['GC11111']['geocache_id'] > 0
    assert points['GC11111']['found'] is True
    # Pas importée : id 0, le frontend lui attribuera un id négatif unique.
    assert points['GC99999']['geocache_id'] == 0
    assert points['GC99999']['found'] is False


# ------------------------------------------------------------ Type de cache

def test_cache_type_id_is_translated(app):
    _log('GL1', gc_code='GC11111', cache_type_id=2)
    _log('GL2', gc_code='GC22222', cache_type_id=8)
    # 453 = Mega-Event : le scraper dit « Mega-Event », la recherche web
    # « MegaEvent » — seul le premier est reconnu par la table d'icônes.
    _log('GL3', gc_code='GC33333', cache_type_id=453)
    # 9 = Project APE : absent du scraper, repli sur la recherche web.
    _log('GL4', gc_code='GC44444', cache_type_id=9)
    db.session.commit()

    points = {point['gc_code']: point for point in friend_activity_store.query_map_points()['points']}

    assert points['GC11111']['cache_type'] == 'Traditional'
    assert points['GC22222']['cache_type'] == 'Mystery'
    assert points['GC33333']['cache_type'] == 'Mega-Event'
    assert points['GC44444']['cache_type'] == 'APE'


def test_unknown_cache_type_is_not_an_error(app):
    """Un type inconnu donne une icône générique, jamais une exception."""
    _log('GL1', cache_type_id=999999)
    db.session.commit()

    assert friend_activity_store.query_map_points()['points'][0]['cache_type'] is None


# --------------------------------------------------- Entrées non plaçables

def test_entries_without_coordinates_are_counted_not_placed(app):
    _log('GL1', gc_code='GC11111')
    _log('GL2', gc_code='GC22222', latitude=None, longitude=None)
    db.session.commit()

    result = friend_activity_store.query_map_points()

    assert result['total'] == 1
    assert result['without_coordinates'] == 1


# ------------------------------------------------------------------ Filtres

def test_filters_match_the_timeline(app):
    _log('GL1', username='ami1', gc_code='GC11111')
    _log('GL2', username='ami2', gc_code='GC22222')
    _log('GL3', username='ami1', gc_code='GC33333', log_type_id=3)
    _log('GL4', username='moi', gc_code='GC44444', is_self=True)
    db.session.commit()

    # Par défaut : mes propres logs exclus.
    assert friend_activity_store.query_map_points()['total'] == 3
    assert friend_activity_store.query_map_points(include_self=True)['total'] == 4

    by_author = friend_activity_store.query_map_points(author='ami1')
    assert {point['gc_code'] for point in by_author['points']} == {'GC11111', 'GC33333'}

    found_only = friend_activity_store.query_map_points(log_type_ids=[2])
    assert {point['gc_code'] for point in found_only['points']} == {'GC11111', 'GC22222'}


def test_days_window_excludes_older_logs(app):
    now = datetime.now()
    _log('GL1', gc_code='GC11111', log_date=now - timedelta(days=2))
    _log('GL2', gc_code='GC22222', log_date=now - timedelta(days=40))
    db.session.commit()

    assert friend_activity_store.query_map_points(days=7)['total'] == 1
    assert friend_activity_store.query_map_points(days=90)['total'] == 2
    assert friend_activity_store.query_map_points()['total'] == 2


# ------------------------------------------------------------- Garde-fou limit

def test_limit_is_a_guard_and_is_signalled(app):
    for index in range(5):
        _log(f'GL{index}', gc_code=f'GC{index:05d}')
    db.session.commit()

    result = friend_activity_store.query_map_points(limit=3)

    assert result['total'] == 5
    assert result['returned'] == 3
    assert len(result['points']) == 3
    assert result['truncated'] is True

    assert friend_activity_store.query_map_points()['truncated'] is False


# ---------------------------------------------------------------------- Route

def test_route_returns_points(app):
    _log('GL1', gc_code='GC11111')
    db.session.commit()

    response = app.test_client().get('/api/friends/activity/map')
    payload = response.get_json()

    assert response.status_code == 200
    assert payload['success'] is True
    assert payload['points'][0]['gc_code'] == 'GC11111'
    assert 'log_type_labels' in payload


def test_route_rejects_invalid_params(app):
    client = app.test_client()

    assert client.get('/api/friends/activity/map?days=beaucoup').status_code == 400
    assert client.get('/api/friends/activity/map?days=-1').status_code == 400
    assert client.get('/api/friends/activity/map?log_types=2,abc').status_code == 400
