"""Tests des notifications de nouvelles trouvailles d'amis."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache
from gc_backend.models import AppConfig, FriendFind, Zone
from gc_backend.services.geocaching_friend_finds import (
    NOTIFICATIONS_SEEN_KEY,
    mark_notifications_seen,
    query_notifications,
)


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


def _find(friend: str, gc_code: str, first_seen_at: datetime | None = None) -> FriendFind:
    ts = first_seen_at or datetime.now(timezone.utc)
    row = FriendFind(
        friend_username=friend,
        gc_code=gc_code,
        source='activity',
        latitude=48.5,
        longitude=4.5,
        first_seen_at=ts,
        last_seen_at=ts,
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

def test_notifications_empty_when_no_data(app):
    """Sans trouvailles, les notifications sont vides."""
    result = query_notifications()
    assert result['items'] == []
    assert result['count'] == 0
    assert result['total_new_finds'] == 0
    assert result['last_seen_at'] is None


def test_notifications_all_finds_when_no_seen_timestamp(app):
    """Sans timestamp de dernière visite, toutes les trouvailles sont nouvelles."""
    _find('ami1', 'GC11111')
    _find('ami2', 'GC22222')
    db.session.commit()

    result = query_notifications()
    assert result['count'] == 2
    assert result['total_new_finds'] == 2
    assert result['last_seen_at'] is None


def test_notifications_only_new_finds_after_seen(app):
    """Seules les trouvailles postérieures au timestamp sont notifiées."""
    now = datetime.now(timezone.utc)
    old = now - timedelta(hours=2)

    _find('ami1', 'GC11111', first_seen_at=old)
    db.session.commit()

    # Marquer comme vu
    AppConfig.set_value(NOTIFICATIONS_SEEN_KEY, now.isoformat())
    db.session.commit()

    # Ajouter une nouvelle trouvaille après le timestamp
    _find('ami2', 'GC22222', first_seen_at=now + timedelta(minutes=5))
    db.session.commit()

    result = query_notifications()
    assert result['count'] == 1
    assert result['items'][0]['gc_code'] == 'GC22222'
    assert result['items'][0]['friends'] == ['ami2']
    assert result['total_new_finds'] == 1


def test_notifications_grouped_by_cache(app):
    """Plusieurs amis trouvant la même cache donnent une seule notification."""
    now = datetime.now(timezone.utc)
    _find('ami1', 'GC11111', first_seen_at=now)
    _find('ami2', 'GC11111', first_seen_at=now)
    _find('ami3', 'GC11111', first_seen_at=now)
    db.session.commit()

    result = query_notifications()
    assert result['count'] == 1
    assert result['items'][0]['gc_code'] == 'GC11111'
    assert result['items'][0]['friends_count'] == 3
    assert sorted(result['items'][0]['friends']) == ['ami1', 'ami2', 'ami3']
    assert result['total_new_finds'] == 3


def test_notifications_sorted_by_friends_count_desc(app):
    """Les caches avec le plus d'amis apparaissent en premier."""
    now = datetime.now(timezone.utc)
    _find('ami1', 'GC11111', first_seen_at=now)
    _find('ami2', 'GC11111', first_seen_at=now)
    _find('ami3', 'GC11111', first_seen_at=now)
    _find('ami1', 'GC22222', first_seen_at=now)
    db.session.commit()

    result = query_notifications()
    assert result['items'][0]['gc_code'] == 'GC11111'
    assert result['items'][0]['friends_count'] == 3
    assert result['items'][1]['gc_code'] == 'GC22222'
    assert result['items'][1]['friends_count'] == 1


def test_notifications_min_friends_filter(app):
    """Le filtre min_friends exclut les caches avec trop peu d'amis."""
    now = datetime.now(timezone.utc)
    _find('ami1', 'GC11111', first_seen_at=now)
    _find('ami2', 'GC11111', first_seen_at=now)
    _find('ami1', 'GC22222', first_seen_at=now)
    db.session.commit()

    result = query_notifications(min_friends=2)
    assert result['count'] == 1
    assert result['items'][0]['gc_code'] == 'GC11111'


def test_notifications_limit_caps_results(app):
    """Le paramètre limit plafonne le nombre de notifications."""
    now = datetime.now(timezone.utc)
    for i in range(10):
        _find(f'ami{i}', f'GC{i:05d}', first_seen_at=now)
    db.session.commit()

    result = query_notifications(limit=3)
    assert result['count'] == 3
    # total_new_finds compte toutes les lignes, pas seulement les items retournés
    assert result['total_new_finds'] == 10


def test_notifications_includes_geocache_metadata(app):
    """Les notifications incluent les métadonnées de la géocache importée."""
    zone = Zone(name='Test')
    db.session.add(zone)
    db.session.flush()

    _geocache('GC11111', zone.id, found=False)
    _find('ami1', 'GC11111')
    db.session.commit()

    result = query_notifications()
    item = result['items'][0]
    assert item['geocache_id'] > 0
    assert item['name'] == 'Cache GC11111'
    assert item['found'] is False
    assert item['zone_id'] == zone.id


def test_notifications_includes_find_metadata_when_no_geocache(app):
    """Sans géocache importée, les métadonnées viennent du friend_find."""
    _find('ami1', 'GC11111')
    db.session.commit()

    result = query_notifications()
    item = result['items'][0]
    assert item['geocache_id'] == 0
    # Le nom vient du friend_find ou fallback sur gc_code
    assert item['gc_code'] == 'GC11111'


def test_mark_notifications_seen_sets_timestamp(app):
    """mark_notifications_seen pose un timestamp dans AppConfig."""
    _find('ami1', 'GC11111')
    db.session.commit()

    # Avant : pas de timestamp
    assert AppConfig.get_value(NOTIFICATIONS_SEEN_KEY) is None

    seen_at = mark_notifications_seen()
    assert seen_at is not None
    assert AppConfig.get_value(NOTIFICATIONS_SEEN_KEY) == seen_at


def test_mark_notifications_seen_clears_notifications(app):
    """Après mark_notifications_seen, les anciennes trouvailles ne sont plus notifiées."""
    now = datetime.now(timezone.utc)
    _find('ami1', 'GC11111', first_seen_at=now)
    db.session.commit()

    # Avant : 1 notification
    assert query_notifications()['count'] == 1

    mark_notifications_seen()

    # Après : 0 notification (tout est avant le timestamp)
    result = query_notifications()
    assert result['count'] == 0
    assert result['total_new_finds'] == 0


# ----------------------------------------------------------- Tests des routes

def test_route_returns_notifications(app):
    """La route /api/friends/notifications retourne les notifications."""
    _find('ami1', 'GC11111')
    db.session.commit()

    client = app.test_client()
    response = client.get('/api/friends/notifications')
    assert response.status_code == 200
    data = response.get_json()
    assert data['success'] is True
    assert data['count'] == 1
    assert len(data['items']) == 1


def test_route_with_min_friends_param(app):
    """La route respecte le paramètre min_friends."""
    now = datetime.now(timezone.utc)
    _find('ami1', 'GC11111', first_seen_at=now)
    _find('ami2', 'GC11111', first_seen_at=now)
    _find('ami1', 'GC22222', first_seen_at=now)
    db.session.commit()

    client = app.test_client()
    response = client.get('/api/friends/notifications?min_friends=2')
    assert response.status_code == 200
    data = response.get_json()
    assert data['count'] == 1
    assert data['items'][0]['gc_code'] == 'GC11111'


def test_route_empty_notifications(app):
    """La route retourne des notifications vides sans données."""
    client = app.test_client()
    response = client.get('/api/friends/notifications')
    assert response.status_code == 200
    data = response.get_json()
    assert data['success'] is True
    assert data['count'] == 0


def test_route_seen_marks_notifications(app):
    """La route POST /api/friends/notifications/seen marque comme lu."""
    _find('ami1', 'GC11111')
    db.session.commit()

    client = app.test_client()
    response = client.post('/api/friends/notifications/seen')
    assert response.status_code == 200
    data = response.get_json()
    assert data['success'] is True
    assert data['last_seen_at'] is not None

    # Les notifications sont maintenant vides
    response = client.get('/api/friends/notifications')
    data = response.get_json()
    assert data['count'] == 0
