"""Tests du tableau de bord de fraîcheur des données amis."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache
from gc_backend.models import AppConfig, FriendActivity, FriendFind, Zone
from gc_backend.services.geocaching_friend_finds import query_freshness


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


def _find(friend: str, gc_code: str) -> FriendFind:
    row = FriendFind(
        friend_username=friend,
        gc_code=gc_code,
        source='zone_search',
        latitude=48.5,
        longitude=4.5,
        first_seen_at=datetime.now(timezone.utc),
        last_seen_at=datetime.now(timezone.utc),
    )
    db.session.add(row)
    return row


def _activity(username: str, log_code: str) -> FriendActivity:
    row = FriendActivity(
        log_reference_code=log_code,
        activity_type=2,
        author_username=username,
        is_self=False,
        log_type_id=2,
        log_date=datetime(2026, 7, 20, 10, 0, 0),
        cache_reference_code='GC11111',
        cache_name='Test',
        cache_type_id=2,
        latitude=48.5,
        longitude=4.5,
        last_seen_at=datetime.now(timezone.utc),
    )
    db.session.add(row)
    return row


def _geocache(gc_code: str, zone_id: int, found: bool = False) -> Geocache:
    row = Geocache(
        gc_code=gc_code,
        name=f'Cache {gc_code}',
        type='Traditional',
        difficulty=2.0,
        terrain=1.5,
        latitude=48.5,
        longitude=4.5,
        zone_id=zone_id,
        found=found,
    )
    db.session.add(row)
    return row


# ----------------------------------------------------------- Tests de base

def test_freshness_empty_when_no_data(app):
    """Sans aucune donnée, tous les compteurs sont à 0 et les timestamps à None."""
    result = query_freshness()

    assert result['activity']['last_sync_at'] is None
    assert result['activity']['last_projection_at'] is None
    assert result['activity']['logs_stored'] == 0
    assert result['activity']['authors_in_feed'] == 0
    assert result['activity']['latest_log_date'] is None
    assert result['activity']['is_stale'] is True

    assert result['finds']['total_rows'] == 0
    assert result['finds']['distinct_caches'] == 0
    assert result['finds']['distinct_friends'] == 0
    assert result['finds']['is_stale'] is True

    assert result['geocaches']['total'] == 0
    assert result['geocaches']['found'] == 0


def test_freshness_counts_activity(app):
    """Le nombre de logs et d'auteurs dans le flux est correct."""
    _activity('ami1', 'GL1')
    _activity('ami1', 'GL2')
    _activity('ami2', 'GL3')
    db.session.commit()

    result = query_freshness()
    assert result['activity']['logs_stored'] == 3
    assert result['activity']['authors_in_feed'] == 2


def test_freshness_latest_log_date(app):
    """La date du log le plus récent est retournée."""
    _activity('ami1', 'GL1')
    db.session.commit()

    result = query_freshness()
    assert result['activity']['latest_log_date'] is not None


def test_freshness_counts_finds(app):
    """Les compteurs de trouvailles déduites sont corrects."""
    _find('ami1', 'GC11111')
    _find('ami1', 'GC22222')
    _find('ami2', 'GC11111')
    db.session.commit()

    result = query_freshness()
    assert result['finds']['total_rows'] == 3
    assert result['finds']['distinct_caches'] == 2  # GC11111, GC22222
    assert result['finds']['distinct_friends'] == 2  # ami1, ami2


def test_freshness_counts_geocaches(app):
    """Les compteurs de géocaches sont corrects."""
    zone = Zone(name='Test')
    db.session.add(zone)
    db.session.flush()

    _geocache('GC11111', zone.id, found=True)
    _geocache('GC22222', zone.id, found=False)
    db.session.commit()

    result = query_freshness()
    assert result['geocaches']['total'] == 2
    assert result['geocaches']['found'] == 1


def test_freshness_last_sync_at(app):
    """Le timestamp de dernière synchro est lu depuis AppConfig."""
    now = datetime.now(timezone.utc).isoformat()
    AppConfig.set_value('friends.activity.last_sync_at', now)
    db.session.commit()

    result = query_freshness()
    assert result['activity']['last_sync_at'] is not None


def test_freshness_is_stale_when_old_sync(app):
    """is_stale=True si la dernière synchro date de plus d'une heure."""
    old = (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat()
    AppConfig.set_value('friends.activity.last_sync_at', old)
    db.session.commit()

    result = query_freshness()
    assert result['activity']['is_stale'] is True


def test_freshness_not_stale_when_recent_sync(app):
    """is_stale=False si la dernière synchro est récente."""
    recent = datetime.now(timezone.utc).isoformat()
    AppConfig.set_value('friends.activity.last_sync_at', recent)
    db.session.commit()

    result = query_freshness()
    assert result['activity']['is_stale'] is False


def test_freshness_last_projection_at(app):
    """Le timestamp de dernière projection est lu depuis AppConfig."""
    now = datetime.now(timezone.utc).isoformat()
    AppConfig.set_value('friends.activity.last_projection_at', now)
    db.session.commit()

    result = query_freshness()
    assert result['activity']['last_projection_at'] is not None
    assert result['finds']['is_stale'] is False


def test_freshness_checked_at_present(app):
    """Le timestamp de vérification est toujours présent."""
    result = query_freshness()
    assert result['checked_at'] is not None


# ----------------------------------------------------------- Tests de la route

def test_route_returns_freshness(app):
    """La route /api/friends/freshness retourne l'état de fraîcheur."""
    _find('ami1', 'GC11111')
    db.session.commit()

    client = app.test_client()
    response = client.get('/api/friends/freshness')
    assert response.status_code == 200
    data = response.get_json()
    assert data['success'] is True
    assert data['finds']['total_rows'] == 1
    assert data['checked_at'] is not None


def test_route_freshness_empty(app):
    """La route retourne un état vide sans données."""
    client = app.test_client()
    response = client.get('/api/friends/freshness')
    assert response.status_code == 200
    data = response.get_json()
    assert data['success'] is True
    assert data['activity']['logs_stored'] == 0
    assert data['finds']['total_rows'] == 0
