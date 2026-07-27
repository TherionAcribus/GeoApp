from __future__ import annotations

import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.models import FriendActivity
from gc_backend.services import friend_activity_store
from gc_backend.services.geocaching_friend_activity import (
    FriendActivityError,
    GeocachingFriendActivityClient,
)


def _raw_item(
    log_code: str = 'GL1H0HF4N',
    *,
    username: str = 'Les petits Poucets',
    log_type_id: int = 2,
    log_date: str = '2026-07-26T14:52:47.741',
    note: str = 'Parfaitement parfait\n+1',
    condensed: bool = False,
) -> dict:
    return {
        'type': 'activity',
        'data': {
            'logReferenceCode': log_code,
            'id': 1374309135,
            'attributes': {
                'logTypeId': log_type_id,
                'createdDateTime': '2026-07-26T12:52:52.4075283',  # 7 décimales
                'logDateTime': log_date,
                'name': '2026 célébrons la rentrée',
                'note': note,
                'cacheTypeId': 6,
                'favoritePoints': 0,
                'difficultyLevel': 1.0,
                'terrainLevel': 1.5,
                'containerTypeId': 6,
                'parentReferenceCode': 'GCBV38P',
                'isPremium': False,
                'isArchived': False,
                'isPublished': True,
                'imageCount': 0,
                'location': {'name': 'Grand-Est, France', 'latitude': 48.9889, 'longitude': 4.5657},
                'isCondensed': condensed,
                'condensedCount': 26 if condensed else 0,
                'isFavorited': False,
            },
        },
        'relationships': {
            'author': {
                'username': username,
                'accountId': 1319883,
                'profileImageUrl': 'https://img.geocaching.com/avatar/abc.png',
                'links': {'profile': 'https://coord.info/PR1W37T'},
            }
        },
        'links': {'action': f'https://coord.info/{log_code}'},
    }


# --------------------------------------------------------------------- Parsing

def test_parses_activity_item():
    items = GeocachingFriendActivityClient.parse_items({'data': [_raw_item()]})

    assert len(items) == 1
    item = items[0]
    assert item.log_reference_code == 'GL1H0HF4N'
    assert item.author_username == 'Les petits Poucets'
    assert item.author_reference_code == 'PR1W37T'     # extrait de coord.info/PRxxxxx
    assert item.log_type_id == 2
    assert item.log_type_label == 'a trouvé'
    assert item.log_date == '2026-07-26T14:52:47.741000'
    assert item.created_date == '2026-07-26T12:52:52.407528'  # 7 décimales tronquées à 6
    assert item.note.startswith('Parfaitement parfait')
    assert item.cache_reference_code == 'GCBV38P'
    assert item.cache_type_id == 6
    assert item.difficulty == 1.0 and item.terrain == 1.5
    assert item.latitude == 48.9889 and item.longitude == 4.5657
    assert item.location_name == 'Grand-Est, France'
    assert item.is_condensed is False
    assert item.is_trackable_log is False


def test_parses_bare_list_payload_and_condensed_entry():
    items = GeocachingFriendActivityClient.parse_items([_raw_item(condensed=True)])

    assert items[0].is_condensed is True
    assert items[0].condensed_count == 26


def test_skips_entry_without_log_reference_code():
    broken = _raw_item()
    del broken['data']['logReferenceCode']

    assert GeocachingFriendActivityClient.parse_items({'data': [broken, _raw_item('GLOK')]}) != []
    assert len(GeocachingFriendActivityClient.parse_items({'data': [broken]})) == 0


def test_unknown_log_type_has_no_label_but_is_kept():
    items = GeocachingFriendActivityClient.parse_items({'data': [_raw_item(log_type_id=9999)]})

    assert items[0].log_type_id == 9999
    assert items[0].log_type_label is None


def test_unexpected_payload_raises():
    with pytest.raises(FriendActivityError):
        GeocachingFriendActivityClient.parse_items('nope')


# ------------------------------------------------------------------- Stockage

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


class _FakeClient:
    """Client réseau simulé : renvoie les items fournis, sans toucher au réseau."""

    def __init__(self, items):
        self.items = items
        self.calls = []

    def fetch(self, since_days, activity_type):
        self.calls.append((since_days, activity_type))
        return self.items


def test_sync_stores_items_and_is_idempotent(app):
    items = GeocachingFriendActivityClient.parse_items(
        {'data': [_raw_item('GL111'), _raw_item('GL222', username='necrolink')]}
    )
    client = _FakeClient(items)

    first = friend_activity_store.sync(since_days=7, client=client)
    assert (first.fetched, first.created, first.updated) == (2, 2, 0)

    # Deuxième passe sur les mêmes logs : rien de neuf, pas de doublon.
    second = friend_activity_store.sync(since_days=7, client=client)
    assert (second.fetched, second.created, second.updated) == (2, 0, 2)
    assert FriendActivity.query.count() == 2

    assert friend_activity_store.get_last_sync_at() is not None


def test_sync_refreshes_edited_log_without_touching_first_seen(app):
    original = GeocachingFriendActivityClient.parse_items({'data': [_raw_item('GL111', note='avant')]})
    friend_activity_store.sync(client=_FakeClient(original))
    first_seen = FriendActivity.query.one().first_seen_at

    edited = GeocachingFriendActivityClient.parse_items({'data': [_raw_item('GL111', note='après édition')]})
    friend_activity_store.sync(client=_FakeClient(edited))

    row = FriendActivity.query.one()
    assert row.note == 'après édition'
    assert row.first_seen_at == first_seen


def test_query_filters_and_orders_by_date(app):
    items = GeocachingFriendActivityClient.parse_items({'data': [
        _raw_item('GL_OLD', username='ami1', log_date='2026-07-01T10:00:00'),
        _raw_item('GL_NEW', username='ami2', log_date='2026-07-20T10:00:00'),
        _raw_item('GL_DNF', username='ami1', log_type_id=3, log_date='2026-07-10T10:00:00'),
    ]})
    friend_activity_store.sync(client=_FakeClient(items))

    rows, total = friend_activity_store.query_activities()
    assert total == 3
    assert [r.log_reference_code for r in rows] == ['GL_NEW', 'GL_DNF', 'GL_OLD']

    rows, total = friend_activity_store.query_activities(author='ami1')
    assert total == 2 and {r.author_username for r in rows} == {'ami1'}

    rows, total = friend_activity_store.query_activities(log_type_ids=[3])
    assert total == 1 and rows[0].log_reference_code == 'GL_DNF'

    rows, _ = friend_activity_store.query_activities(limit=1, offset=1)
    assert [r.log_reference_code for r in rows] == ['GL_DNF']

    assert friend_activity_store.list_authors() == [
        {'username': 'ami1', 'count': 2},
        {'username': 'ami2', 'count': 1},
    ]


def test_own_logs_are_flagged_and_excluded_by_default(app):
    """Le flux « communauté » de GC mélange mes logs et ceux de mes amis."""
    items = GeocachingFriendActivityClient.parse_items({'data': [
        _raw_item('GL_MINE', username='AngeEtDemon'),
        _raw_item('GL_FRIEND', username='necrolink'),
    ]})
    friend_activity_store.store_items(items, self_username='AngeEtDemon')

    rows, total = friend_activity_store.query_activities()
    assert total == 1 and rows[0].log_reference_code == 'GL_FRIEND'
    assert [a['username'] for a in friend_activity_store.list_authors()] == ['necrolink']

    rows, total = friend_activity_store.query_activities(include_self=True)
    assert total == 2
    assert {r.log_reference_code: r.is_self for r in rows} == {'GL_MINE': True, 'GL_FRIEND': False}


def test_sync_backfills_self_flag_on_legacy_rows(app, monkeypatch):
    """Les lignes stockées sans le drapeau (ou hors fenêtre distante) sont réparées."""
    legacy = GeocachingFriendActivityClient.parse_items({'data': [
        _raw_item('GL_LEGACY_MINE', username='AngeEtDemon'),
        _raw_item('GL_LEGACY_FRIEND', username='necrolink'),
    ]})
    friend_activity_store.store_items(legacy)  # sans self_username -> is_self à False/None
    for row in FriendActivity.query.all():
        row.is_self = None
    db.session.commit()

    monkeypatch.setattr(friend_activity_store, '_get_self_username', lambda: 'AngeEtDemon')
    friend_activity_store.sync(client=_FakeClient([]))

    flags = {row.log_reference_code: row.is_self for row in FriendActivity.query.all()}
    assert flags == {'GL_LEGACY_MINE': True, 'GL_LEGACY_FRIEND': False}


# ----------------------------------------------------------------------- API

def test_activity_endpoint_returns_stored_feed(app):
    items = GeocachingFriendActivityClient.parse_items({'data': [_raw_item('GL111')]})
    friend_activity_store.sync(client=_FakeClient(items))

    response = app.test_client().get('/api/friends/activity?limit=10')
    payload = response.get_json()

    assert response.status_code == 200
    assert payload['success'] is True
    assert payload['total'] == 1
    assert payload['activities'][0]['log_reference_code'] == 'GL111'
    assert payload['log_type_labels']['2'] == 'a trouvé'
    assert payload['authors'] == [{'username': 'Les petits Poucets', 'count': 1}]


def test_activity_endpoint_rejects_invalid_params(app):
    response = app.test_client().get('/api/friends/activity?limit=beaucoup')

    assert response.status_code == 400
    assert response.get_json()['error'] == 'invalid_params'
