"""Tests de la fiche synthétique d'un ami (`GET /api/friends/<username>/summary`)."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache
from gc_backend.models import FriendActivity, FriendFind, FriendZoneScan, Zone
from gc_backend.services.geocaching_friend_finds import query_friend_summary


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
        first_seen_at=datetime.now(timezone.utc),
        last_seen_at=datetime.now(timezone.utc),
    )
    db.session.add(row)
    return row


def _activity(username: str, log_code: str, gc_code: str = 'GC11111',
              log_type_id: int = 2, log_date=None) -> FriendActivity:
    row = FriendActivity(
        log_reference_code=log_code,
        activity_type=2,
        author_username=username,
        is_self=False,
        log_type_id=log_type_id,
        log_date=log_date or datetime(2026, 7, 20, 10, 0, 0),
        cache_reference_code=gc_code,
        cache_name=f'Cache {gc_code}',
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


def _scan(friend: str, zone_id: int, truncated: bool = False) -> FriendZoneScan:
    row = FriendZoneScan(
        friend_username=friend,
        zone_id=zone_id,
        box_signature=None,
        baseline_total=10,
        found_count=3,
        zone_matches=3,
        truncated=truncated,
        scanned_at=datetime.now(timezone.utc),
    )
    db.session.add(row)
    return row


# ----------------------------------------------------------- Service

def test_summary_none_when_no_data(app):
    """Un ami sans trace locale retourne None."""
    assert query_friend_summary('inconnu') is None


def test_summary_counts_finds_and_shared(app):
    """Trouvailles connues et caches en commun avec moi."""
    zone = Zone(name='Test')
    db.session.add(zone)
    db.session.flush()

    _geocache('GC11111', zone.id, found=True)
    _geocache('GC22222', zone.id, found=False)

    _find('ami1', 'GC11111')  # en commun
    _find('ami1', 'GC22222')
    _find('ami1', 'GC33333')  # non importée
    db.session.commit()

    summary = query_friend_summary('ami1')
    assert summary['finds_count'] == 3
    assert summary['shared_with_me'] == 1


def test_summary_recent_activity_with_geocache_id(app):
    """L'activité récente expose geocache_id quand la cache est importée."""
    zone = Zone(name='Test')
    db.session.add(zone)
    db.session.flush()

    _geocache('GC11111', zone.id)
    _activity('ami1', 'GL1', gc_code='GC11111')
    _activity('ami1', 'GL2', gc_code='GC99999')  # non importée
    db.session.commit()

    summary = query_friend_summary('ami1')
    assert summary['activity_count'] == 2
    assert summary['last_activity_at'] is not None

    by_code = {a['gc_code']: a for a in summary['recent_activity']}
    assert by_code['GC11111']['geocache_id'] > 0
    assert by_code['GC99999']['geocache_id'] == 0
    assert by_code['GC11111']['log_type_label'] == 'a trouvé'


def test_summary_excludes_self_logs(app):
    """Mes propres logs ne doivent pas apparaître sur la fiche d'un ami."""
    row = FriendActivity(
        log_reference_code='GL1',
        activity_type=2,
        author_username='ami1',
        is_self=True,
        log_type_id=2,
        log_date=datetime(2026, 7, 20, 10, 0, 0),
        cache_reference_code='GC11111',
        last_seen_at=datetime.now(timezone.utc),
    )
    db.session.add(row)
    db.session.commit()

    assert query_friend_summary('ami1') is None


def test_summary_lists_zone_scans(app):
    """Les scans par zone sont listés avec leur couverture."""
    zone = Zone(name='Forêt')
    db.session.add(zone)
    db.session.flush()

    _scan('ami1', zone.id, truncated=True)
    db.session.commit()

    summary = query_friend_summary('ami1')
    assert len(summary['zones']) == 1
    assert summary['zones'][0]['zone_name'] == 'Forêt'
    assert summary['zones'][0]['found_count'] == 3
    assert summary['zones'][0]['truncated'] is True


# ----------------------------------------------------------- Route

def test_route_returns_summary(app):
    """La route retourne la fiche complète avec is_stale par zone."""
    zone = Zone(name='Test')
    db.session.add(zone)
    db.session.flush()

    _find('ami1', 'GC11111')
    _scan('ami1', zone.id, truncated=True)
    db.session.commit()

    client = app.test_client()
    response = client.get('/api/friends/ami1/summary')
    assert response.status_code == 200
    data = response.get_json()
    assert data['success'] is True
    assert data['username'] == 'ami1'
    assert data['finds_count'] == 1
    assert data['zones'][0]['is_stale'] is True  # scan tronqué


def test_route_unknown_friend_returns_empty_summary(app):
    """Un ami inconnu retourne une fiche vide (200), pas une erreur."""
    client = app.test_client()
    response = client.get('/api/friends/personne/summary')
    assert response.status_code == 200
    data = response.get_json()
    assert data['success'] is True
    assert data['finds_count'] == 0
    assert data['zones'] == []
    assert data['recent_activity'] == []
