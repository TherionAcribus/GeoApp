"""Tests des statistiques croisées entre amis."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache
from gc_backend.models import FriendActivity, FriendFind, Zone
from gc_backend.services.geocaching_friend_finds import query_friend_stats


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


def _activity(username: str, log_code: str, log_type_id: int = 2) -> FriendActivity:
    row = FriendActivity(
        log_reference_code=log_code,
        activity_type=2,
        author_username=username,
        is_self=False,
        log_type_id=log_type_id,
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

def test_stats_empty_when_no_data(app):
    """Sans aucune donnée, retourne un résumé vide."""
    stats = query_friend_stats()
    assert stats['friends'] == []
    assert stats['summary']['friends_count'] == 0
    assert stats['summary']['total_distinct_finds'] == 0
    assert stats['summary']['total_shared_with_me'] == 0
    assert stats['summary']['most_active_friend'] is None


def test_stats_counts_finds_per_friend(app):
    """Le nombre de trouvailles connues est compté par ami."""
    _find('ami1', 'GC11111')
    _find('ami1', 'GC22222')
    _find('ami1', 'GC33333')
    _find('ami2', 'GC11111')
    db.session.commit()

    stats = query_friend_stats()
    by_friend = {f['username']: f for f in stats['friends']}
    assert by_friend['ami1']['finds_count'] == 3
    assert by_friend['ami2']['finds_count'] == 1


def test_stats_counts_activity_per_friend(app):
    """Le nombre de logs dans le flux d'activité est compté par ami."""
    _activity('ami1', 'GL1')
    _activity('ami1', 'GL2')
    _activity('ami2', 'GL3')
    db.session.commit()

    stats = query_friend_stats()
    by_friend = {f['username']: f for f in stats['friends']}
    assert by_friend['ami1']['activity_count'] == 2
    assert by_friend['ami2']['activity_count'] == 1


def test_stats_excludes_self_from_activity(app):
    """Mes propres logs ne sont pas comptés dans l'activité des amis."""
    _activity('moi', 'GL1', is_self=True) if False else None  # is_self n'est pas un param de _activity
    # On insère directement avec is_self=True
    row = FriendActivity(
        log_reference_code='GL1',
        activity_type=2,
        author_username='moi',
        is_self=True,
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
    db.session.commit()

    stats = query_friend_stats()
    usernames = {f['username'] for f in stats['friends']}
    assert 'moi' not in usernames


def test_stats_shared_with_me(app):
    """Le nombre de caches en commun avec moi est compté."""
    zone = Zone(name='Test')
    db.session.add(zone)
    db.session.flush()

    # J'ai trouvé GC11111 et GC22222
    _geocache('GC11111', zone.id, found=True)
    _geocache('GC22222', zone.id, found=True)
    _geocache('GC33333', zone.id, found=False)

    # ami1 a trouvé GC11111 et GC33333 → 1 en commun (GC11111)
    _find('ami1', 'GC11111')
    _find('ami1', 'GC33333')
    # ami2 a trouvé GC22222 → 1 en commun
    _find('ami2', 'GC22222')
    # ami3 a trouvé GC33333 → 0 en commun
    _find('ami3', 'GC33333')
    db.session.commit()

    stats = query_friend_stats()
    by_friend = {f['username']: f for f in stats['friends']}
    assert by_friend['ami1']['shared_with_me'] == 1
    assert by_friend['ami2']['shared_with_me'] == 1
    assert by_friend['ami3']['shared_with_me'] == 0


def test_stats_sorted_by_finds_count_desc(app):
    """Les amis sont triés par nombre de trouvailles décroissant."""
    _find('ami1', 'GC11111')
    _find('ami2', 'GC11111')
    _find('ami2', 'GC22222')
    _find('ami2', 'GC33333')
    db.session.commit()

    stats = query_friend_stats()
    assert stats['friends'][0]['username'] == 'ami2'
    assert stats['friends'][0]['finds_count'] == 3
    assert stats['friends'][1]['username'] == 'ami1'
    assert stats['friends'][1]['finds_count'] == 1


def test_stats_summary_totals(app):
    """Le résumé global contient les totaux corrects."""
    zone = Zone(name='Test')
    db.session.add(zone)
    db.session.flush()

    _geocache('GC11111', zone.id, found=True)
    _geocache('GC22222', zone.id, found=True)

    _find('ami1', 'GC11111')
    _find('ami1', 'GC22222')
    _find('ami2', 'GC11111')
    db.session.commit()

    stats = query_friend_stats()
    summary = stats['summary']
    assert summary['friends_count'] == 2
    # 2 caches distinctes trouvées par au moins un ami
    assert summary['total_distinct_finds'] == 2
    # ami1 a 2 en commun, ami2 a 1 → total 3
    assert summary['total_shared_with_me'] == 3
    assert summary['most_active_friend'] == 'ami1'


def test_stats_merges_friends_from_all_sources(app):
    """Un ami présent dans le flux mais sans trouvaille déduite apparaît quand même."""
    _activity('ami1', 'GL1')
    db.session.commit()

    stats = query_friend_stats()
    by_friend = {f['username']: f for f in stats['friends']}
    assert 'ami1' in by_friend
    assert by_friend['ami1']['finds_count'] == 0
    assert by_friend['ami1']['activity_count'] == 1


# ----------------------------------------------------------- Tests de la route

def test_route_returns_stats(app):
    """La route /api/friends/stats retourne les statistiques."""
    _find('ami1', 'GC11111')
    db.session.commit()

    client = app.test_client()
    response = client.get('/api/friends/stats')
    assert response.status_code == 200
    data = response.get_json()
    assert data['success'] is True
    assert data['summary']['friends_count'] == 1
    assert len(data['friends']) == 1
    assert data['friends'][0]['username'] == 'ami1'


def test_route_empty_stats(app):
    """La route retourne un résumé vide sans données."""
    client = app.test_client()
    response = client.get('/api/friends/stats')
    assert response.status_code == 200
    data = response.get_json()
    assert data['success'] is True
    assert data['summary']['friends_count'] == 0
    assert data['friends'] == []
