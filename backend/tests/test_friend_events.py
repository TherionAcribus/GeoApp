"""Tests des events (log types 9/10) du flux d'activité des amis."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.models import FriendActivity
from gc_backend.services.friend_activity_store import query_events


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


def _activity(
    username: str,
    log_code: str,
    log_type_id: int,
    cache_code: str = 'GC11111',
    cache_name: str = 'Test Event',
    log_date: datetime | None = None,
    latitude: float = 48.5,
    longitude: float = 4.5,
) -> FriendActivity:
    row = FriendActivity(
        log_reference_code=log_code,
        activity_type=2,
        author_username=username,
        is_self=False,
        log_type_id=log_type_id,
        log_date=log_date or datetime(2026, 7, 20, 10, 0, 0),
        cache_reference_code=cache_code,
        cache_name=cache_name,
        cache_type_id=13,  # Event cache type
        latitude=latitude,
        longitude=longitude,
        last_seen_at=datetime.now(timezone.utc),
    )
    db.session.add(row)
    return row


# ----------------------------------------------------------- Tests de base

def test_events_empty_when_no_data(app):
    """Sans données, les events sont vides."""
    result = query_events()
    assert result['items'] == []
    assert result['count'] == 0
    assert result['upcoming_count'] == 0
    assert result['past_count'] == 0


def test_events_excludes_non_event_log_types(app):
    """Les log types non-event (2, 3, 4) sont exclus."""
    _activity('ami1', 'GL1', log_type_id=2, cache_name='Found cache')
    _activity('ami1', 'GL2', log_type_id=3, cache_name='DNF cache')
    db.session.commit()

    result = query_events()
    assert result['count'] == 0


def test_events_includes_will_attend(app):
    """Le log type 9 (participera à) est inclus comme event à venir."""
    future = datetime.now(timezone.utc) + timedelta(days=30)
    _activity('ami1', 'GL1', log_type_id=9, cache_name='Future Event', log_date=future)
    db.session.commit()

    result = query_events()
    assert result['count'] == 1
    assert result['upcoming_count'] == 1
    assert result['past_count'] == 0
    assert result['items'][0]['name'] == 'Future Event'
    assert result['items'][0]['is_upcoming'] is True


def test_events_includes_attended(app):
    """Le log type 10 (a participé à) est inclus comme event passé."""
    past = datetime.now(timezone.utc) - timedelta(days=30)
    _activity('ami1', 'GL1', log_type_id=10, cache_name='Past Event', log_date=past)
    db.session.commit()

    result = query_events()
    assert result['count'] == 1
    assert result['upcoming_count'] == 0
    assert result['past_count'] == 1
    assert result['items'][0]['name'] == 'Past Event'
    assert result['items'][0]['is_upcoming'] is False


def test_events_grouped_by_cache(app):
    """Plusieurs amis participant au même event sont regroupés."""
    future = datetime.now(timezone.utc) + timedelta(days=30)
    _activity('ami1', 'GL1', log_type_id=9, cache_code='GC11111', cache_name='Mega Event', log_date=future)
    _activity('ami2', 'GL2', log_type_id=9, cache_code='GC11111', cache_name='Mega Event', log_date=future)
    _activity('ami3', 'GL3', log_type_id=10, cache_code='GC11111', cache_name='Mega Event', log_date=future)
    db.session.commit()

    result = query_events()
    assert result['count'] == 1
    item = result['items'][0]
    assert item['friends_count'] == 3
    assert sorted(item['friends']) == ['ami1', 'ami2', 'ami3']


def test_events_sorted_upcoming_first(app):
    """Les events à venir apparaissent avant les events passés."""
    future = datetime.now(timezone.utc) + timedelta(days=30)
    past = datetime.now(timezone.utc) - timedelta(days=30)
    _activity('ami1', 'GL1', log_type_id=10, cache_code='GC22222', cache_name='Past Event', log_date=past)
    _activity('ami1', 'GL2', log_type_id=9, cache_code='GC11111', cache_name='Future Event', log_date=future)
    db.session.commit()

    result = query_events()
    assert result['items'][0]['name'] == 'Future Event'
    assert result['items'][1]['name'] == 'Past Event'


def test_events_upcoming_sorted_by_proximity(app):
    """Les events à venir sont triés du plus proche au plus lointain."""
    now = datetime.now(timezone.utc)
    near = now + timedelta(days=5)
    far = now + timedelta(days=60)
    _activity('ami1', 'GL1', log_type_id=9, cache_code='GC22222', cache_name='Far Event', log_date=far)
    _activity('ami1', 'GL2', log_type_id=9, cache_code='GC11111', cache_name='Near Event', log_date=near)
    db.session.commit()

    result = query_events()
    assert result['items'][0]['name'] == 'Near Event'
    assert result['items'][1]['name'] == 'Far Event'


def test_events_past_sorted_by_recency(app):
    """Les events passés sont triés du plus récent au plus ancien."""
    now = datetime.now(timezone.utc)
    recent = now - timedelta(days=5)
    old = now - timedelta(days=60)
    _activity('ami1', 'GL1', log_type_id=10, cache_code='GC22222', cache_name='Old Event', log_date=old)
    _activity('ami1', 'GL2', log_type_id=10, cache_code='GC11111', cache_name='Recent Event', log_date=recent)
    db.session.commit()

    result = query_events()
    assert result['items'][0]['name'] == 'Recent Event'
    assert result['items'][1]['name'] == 'Old Event'


def test_events_filter_upcoming_only(app):
    """Le filtre upcoming=False exclut les events à venir."""
    future = datetime.now(timezone.utc) + timedelta(days=30)
    past = datetime.now(timezone.utc) - timedelta(days=30)
    _activity('ami1', 'GL1', log_type_id=9, cache_code='GC11111', cache_name='Future', log_date=future)
    _activity('ami1', 'GL2', log_type_id=10, cache_code='GC22222', cache_name='Past', log_date=past)
    db.session.commit()

    result = query_events(upcoming=False, past=True)
    assert result['count'] == 1
    assert result['items'][0]['name'] == 'Past'


def test_events_filter_past_only(app):
    """Le filtre past=False exclut les events passés."""
    future = datetime.now(timezone.utc) + timedelta(days=30)
    past = datetime.now(timezone.utc) - timedelta(days=30)
    _activity('ami1', 'GL1', log_type_id=9, cache_code='GC11111', cache_name='Future', log_date=future)
    _activity('ami1', 'GL2', log_type_id=10, cache_code='GC22222', cache_name='Past', log_date=past)
    db.session.commit()

    result = query_events(upcoming=True, past=False)
    assert result['count'] == 1
    assert result['items'][0]['name'] == 'Future'


def test_events_filter_by_author(app):
    """Le filtre author ne retourne que les events d'un ami."""
    future = datetime.now(timezone.utc) + timedelta(days=30)
    _activity('ami1', 'GL1', log_type_id=9, cache_code='GC11111', cache_name='Event 1', log_date=future)
    _activity('ami2', 'GL2', log_type_id=9, cache_code='GC22222', cache_name='Event 2', log_date=future)
    db.session.commit()

    result = query_events(author='ami1')
    assert result['count'] == 1
    assert result['items'][0]['friends'] == ['ami1']


def test_events_excludes_self(app):
    """Mes propres logs d'event sont exclus par défaut."""
    future = datetime.now(timezone.utc) + timedelta(days=30)
    _activity('moi', 'GL1', log_type_id=9, cache_name='My Event', log_date=future)
    # Marquer comme self
    db.session.query(FriendActivity).filter_by(log_reference_code='GL1').update({'is_self': True})
    db.session.commit()

    result = query_events()
    assert result['count'] == 0


def test_events_include_self(app):
    """include_self=True inclut mes propres logs."""
    future = datetime.now(timezone.utc) + timedelta(days=30)
    _activity('moi', 'GL1', log_type_id=9, cache_name='My Event', log_date=future)
    db.session.query(FriendActivity).filter_by(log_reference_code='GL1').update({'is_self': True})
    db.session.commit()

    result = query_events(include_self=True)
    assert result['count'] == 1


def test_events_limit_caps_results(app):
    """Le paramètre limit plafonne le nombre d'events."""
    future = datetime.now(timezone.utc) + timedelta(days=30)
    for i in range(10):
        _activity('ami1', f'GL{i}', log_type_id=9, cache_code=f'GC{i:05d}', cache_name=f'Event {i}', log_date=future)
    db.session.commit()

    result = query_events(limit=3)
    assert result['count'] == 3


def test_events_includes_metadata(app):
    """Les events incluent les métadonnées (coordonnées, location, D/T)."""
    future = datetime.now(timezone.utc) + timedelta(days=30)
    _activity('ami1', 'GL1', log_type_id=9, cache_name='Mega Event', log_date=future, latitude=48.5, longitude=4.5)
    db.session.commit()

    result = query_events()
    item = result['items'][0]
    assert item['latitude'] == 48.5
    assert item['longitude'] == 4.5
    assert item['cache_type_id'] == 13


# ----------------------------------------------------------- Tests des routes

def test_route_returns_events(app):
    """La route /api/friends/events retourne les events."""
    future = datetime.now(timezone.utc) + timedelta(days=30)
    _activity('ami1', 'GL1', log_type_id=9, cache_name='Future Event', log_date=future)
    db.session.commit()

    client = app.test_client()
    response = client.get('/api/friends/events')
    assert response.status_code == 200
    data = response.get_json()
    assert data['success'] is True
    assert data['count'] == 1
    assert data['items'][0]['name'] == 'Future Event'


def test_route_empty_events(app):
    """La route retourne des events vides sans données."""
    client = app.test_client()
    response = client.get('/api/friends/events')
    assert response.status_code == 200
    data = response.get_json()
    assert data['success'] is True
    assert data['count'] == 0


def test_route_with_upcoming_false(app):
    """La route respecte le paramètre upcoming=false."""
    future = datetime.now(timezone.utc) + timedelta(days=30)
    past = datetime.now(timezone.utc) - timedelta(days=30)
    _activity('ami1', 'GL1', log_type_id=9, cache_code='GC11111', cache_name='Future', log_date=future)
    _activity('ami1', 'GL2', log_type_id=10, cache_code='GC22222', cache_name='Past', log_date=past)
    db.session.commit()

    client = app.test_client()
    response = client.get('/api/friends/events?upcoming=false')
    assert response.status_code == 200
    data = response.get_json()
    assert data['count'] == 1
    assert data['items'][0]['name'] == 'Past'


def test_route_with_author_param(app):
    """La route respecte le paramètre author."""
    future = datetime.now(timezone.utc) + timedelta(days=30)
    _activity('ami1', 'GL1', log_type_id=9, cache_code='GC11111', cache_name='Event 1', log_date=future)
    _activity('ami2', 'GL2', log_type_id=9, cache_code='GC22222', cache_name='Event 2', log_date=future)
    db.session.commit()

    client = app.test_client()
    response = client.get('/api/friends/events?author=ami1')
    assert response.status_code == 200
    data = response.get_json()
    assert data['count'] == 1
    assert data['items'][0]['friends'] == ['ami1']
