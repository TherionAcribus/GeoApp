"""Tests des suggestions « caches à faire » basées sur les trouvailles d'amis."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache
from gc_backend.models import FriendFind, Zone
from gc_backend.services.geocaching_friend_finds import query_suggestions, store_finds


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


def _find(friend: str, gc_code: str, **kwargs) -> FriendFind:
    """Crée une trouvaille d'ami."""
    row = FriendFind(
        friend_username=friend,
        gc_code=gc_code,
        source=kwargs.get('source', 'zone_search'),
        latitude=kwargs.get('latitude', 48.5),
        longitude=kwargs.get('longitude', 4.5),
        cache_name=kwargs.get('cache_name', f'Cache {gc_code}'),
        cache_type=kwargs.get('cache_type', 'Traditional'),
        first_seen_at=datetime.now(timezone.utc),
        last_seen_at=datetime.now(timezone.utc),
    )
    db.session.add(row)
    return row


def _geocache(gc_code: str, zone_id: int, **kwargs) -> Geocache:
    """Crée une géocache importée."""
    row = Geocache(
        gc_code=gc_code,
        name=kwargs.get('name', f'Cache {gc_code}'),
        type=kwargs.get('type', 'Traditional'),
        difficulty=kwargs.get('difficulty', 2.0),
        terrain=kwargs.get('terrain', 1.5),
        latitude=kwargs.get('latitude', 48.5),
        longitude=kwargs.get('longitude', 4.5),
        zone_id=zone_id,
        found=kwargs.get('found', False),
        status=kwargs.get('status', 'active'),
        favorites_count=kwargs.get('favorites_count', 0),
    )
    db.session.add(row)
    return row


# ----------------------------------------------------------- Tests de base

def test_suggestion_excludes_already_found(app):
    """Une cache que j'ai déjà trouvée ne doit pas apparaître."""
    zone = Zone(name='Test')
    db.session.add(zone)
    db.session.flush()

    _find('ami1', 'GC11111')
    _geocache('GC11111', zone.id, found=True)
    db.session.commit()

    suggestions = query_suggestions()
    assert len(suggestions) == 0


def test_suggestion_includes_not_found(app):
    """Une cache trouvée par un ami mais pas par moi apparaît."""
    zone = Zone(name='Test')
    db.session.add(zone)
    db.session.flush()

    _find('ami1', 'GC11111')
    _geocache('GC11111', zone.id, found=False)
    db.session.commit()

    suggestions = query_suggestions()
    assert len(suggestions) == 1
    assert suggestions[0]['gc_code'] == 'GC11111'
    assert suggestions[0]['friends'] == ['ami1']
    assert suggestions[0]['friends_count'] == 1
    assert suggestions[0]['found'] is False


def test_suggestion_includes_unimported_cache(app):
    """Une cache trouvée par un ami mais non importée apparaît avec les métadonnées du flux."""
    _find('ami1', 'GC11111', cache_name='Le vieux pont', cache_type='Multi')
    db.session.commit()

    suggestions = query_suggestions()
    assert len(suggestions) == 1
    assert suggestions[0]['gc_code'] == 'GC11111'
    assert suggestions[0]['name'] == 'Le vieux pont'
    assert suggestions[0]['cache_type'] == 'Multi'
    assert suggestions[0]['geocache_id'] == 0
    assert suggestions[0]['found'] is False


def test_suggestions_sorted_by_friends_count_desc(app):
    """Les caches avec le plus d'amis apparaissent en premier."""
    _find('ami1', 'GC11111')
    _find('ami2', 'GC11111')
    _find('ami3', 'GC11111')
    _find('ami1', 'GC22222')
    db.session.commit()

    suggestions = query_suggestions()
    assert len(suggestions) == 2
    assert suggestions[0]['gc_code'] == 'GC11111'
    assert suggestions[0]['friends_count'] == 3
    assert suggestions[1]['gc_code'] == 'GC22222'
    assert suggestions[1]['friends_count'] == 1


def test_suggestions_deduplicate_friends(app):
    """Un ami qui a trouvé une cache via deux sources ne compte qu'une fois."""
    # store_finds déduplique : on l'utilise pour simuler deux sources.
    store_finds('ami1', ['GC11111'], source='zone_search')
    store_finds('ami1', ['GC11111'], source='activity')

    suggestions = query_suggestions()
    assert len(suggestions) == 1
    assert suggestions[0]['friends_count'] == 1
    assert suggestions[0]['friends'] == ['ami1']


def test_min_friends_filter(app):
    """min_friends=2 exclut les caches trouvées par un seul ami."""
    _find('ami1', 'GC11111')
    _find('ami2', 'GC11111')
    _find('ami1', 'GC22222')
    db.session.commit()

    suggestions = query_suggestions(min_friends=2)
    assert len(suggestions) == 1
    assert suggestions[0]['gc_code'] == 'GC11111'
    assert suggestions[0]['friends_count'] == 2


def test_zone_filter(app):
    """zone_id restreint aux caches d'une zone donnée."""
    zone1 = Zone(name='Zone 1')
    zone2 = Zone(name='Zone 2')
    db.session.add_all([zone1, zone2])
    db.session.flush()

    _find('ami1', 'GC11111')
    _find('ami1', 'GC22222')
    _geocache('GC11111', zone1.id)
    _geocache('GC22222', zone2.id)
    db.session.commit()

    suggestions = query_suggestions(zone_id=zone1.id)
    assert len(suggestions) == 1
    assert suggestions[0]['gc_code'] == 'GC11111'


def test_zone_filter_excludes_unimported(app):
    """Une cache non importée (pas de zone) est exclue par zone_id."""
    zone = Zone(name='Test')
    db.session.add(zone)
    db.session.flush()

    _find('ami1', 'GC11111')  # non importée
    _find('ami1', 'GC22222')
    _geocache('GC22222', zone.id)
    db.session.commit()

    suggestions = query_suggestions(zone_id=zone.id)
    assert len(suggestions) == 1
    assert suggestions[0]['gc_code'] == 'GC22222'


def test_limit_caps_results(app):
    """limit plafonne le nombre de suggestions."""
    for i in range(10):
        _find('ami1', f'GC{i:05d}')
    db.session.commit()

    suggestions = query_suggestions(limit=3)
    assert len(suggestions) == 3


def test_include_found(app):
    """include_found=True inclut les caches déjà trouvées par moi."""
    zone = Zone(name='Test')
    db.session.add(zone)
    db.session.flush()

    _find('ami1', 'GC11111')
    _geocache('GC11111', zone.id, found=True)
    db.session.commit()

    suggestions = query_suggestions(include_found=True)
    assert len(suggestions) == 1
    assert suggestions[0]['found'] is True


def test_empty_when_no_friend_finds(app):
    """Sans aucune trouvaille d'ami, retourne une liste vide."""
    suggestions = query_suggestions()
    assert suggestions == []


def test_coordinates_from_geocache_preferred(app):
    """Les coordonnées de la géocache importée sont préférées à celles du flux."""
    zone = Zone(name='Test')
    db.session.add(zone)
    db.session.flush()

    _find('ami1', 'GC11111', latitude=40.0, longitude=3.0)
    _geocache('GC11111', zone.id, latitude=48.5, longitude=4.5)
    db.session.commit()

    suggestions = query_suggestions()
    assert suggestions[0]['latitude'] == 48.5
    assert suggestions[0]['longitude'] == 4.5


def test_coordinates_from_find_when_no_geocache(app):
    """Sans géocache importée, les coordonnées du flux sont utilisées."""
    _find('ami1', 'GC11111', latitude=40.0, longitude=3.0)
    db.session.commit()

    suggestions = query_suggestions()
    assert suggestions[0]['latitude'] == 40.0
    assert suggestions[0]['longitude'] == 3.0


# ----------------------------------------------------------- Tests de la route

def test_route_returns_suggestions(app):
    """La route /api/friends/finds/suggestions retourne les suggestions."""
    _find('ami1', 'GC11111')
    db.session.commit()

    client = app.test_client()
    response = client.get('/api/friends/finds/suggestions')
    assert response.status_code == 200
    data = response.get_json()
    assert data['success'] is True
    assert data['count'] == 1
    assert data['suggestions'][0]['gc_code'] == 'GC11111'


def test_route_with_query_params(app):
    """La route accepte min_friends et limit."""
    _find('ami1', 'GC11111')
    _find('ami2', 'GC11111')
    _find('ami1', 'GC22222')
    db.session.commit()

    client = app.test_client()
    response = client.get('/api/friends/finds/suggestions?min_friends=2&limit=10')
    assert response.status_code == 200
    data = response.get_json()
    assert data['count'] == 1
    assert data['suggestions'][0]['gc_code'] == 'GC11111'


def test_route_empty_when_no_finds(app):
    """La route retourne une liste vide sans trouvailles."""
    client = app.test_client()
    response = client.get('/api/friends/finds/suggestions')
    assert response.status_code == 200
    data = response.get_json()
    assert data['success'] is True
    assert data['count'] == 0
    assert data['suggestions'] == []
