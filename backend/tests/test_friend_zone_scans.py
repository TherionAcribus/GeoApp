"""Mémoire des analyses « qui a trouvé quoi » par ami et par zone."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache
from gc_backend.models import FriendZoneScan, Zone
from gc_backend.services.geocaching_friend_finds import (
    ZoneBox,
    DEFAULT_SCAN_FRESHNESS_HOURS,
    record_scan,
    get_zone_scans,
    filter_friends_to_scan,
)


BOX = ZoneBox(lat_max=49.3, lon_min=6.0, lat_min=49.2, lon_max=6.2)


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


# ------------------------------------------------------------- record_scan

def test_record_scan_creates_a_new_row(app):
    record_scan('ami', app.zone_id, BOX, found_count=2, baseline_total=5,
                zone_matches=2, truncated=False)

    row = FriendZoneScan.query.one()
    assert row.friend_username == 'ami'
    assert row.zone_id == app.zone_id
    assert row.found_count == 2
    assert row.baseline_total == 5
    assert row.zone_matches == 2
    assert row.truncated is False
    assert row.box_signature == BOX.box_param
    assert row.scanned_at is not None


def test_record_scan_is_an_upsert(app):
    record_scan('ami', app.zone_id, BOX, found_count=0, baseline_total=5,
                zone_matches=0, truncated=False)
    record_scan('ami', app.zone_id, BOX, found_count=3, baseline_total=5,
                zone_matches=2, truncated=True)

    assert FriendZoneScan.query.count() == 1
    row = FriendZoneScan.query.one()
    assert row.found_count == 3
    assert row.truncated is True


def test_record_scan_distinguishes_friends(app):
    record_scan('ami1', app.zone_id, BOX, found_count=1, baseline_total=5,
                zone_matches=1, truncated=False)
    record_scan('ami2', app.zone_id, BOX, found_count=2, baseline_total=5,
                zone_matches=2, truncated=False)

    assert FriendZoneScan.query.count() == 2


# ------------------------------------------------------------- get_zone_scans

def test_get_zone_scans_returns_dict_indexed_by_username(app):
    record_scan('ami1', app.zone_id, BOX, found_count=1, baseline_total=5,
                zone_matches=1, truncated=False)
    record_scan('ami2', app.zone_id, BOX, found_count=0, baseline_total=5,
                zone_matches=0, truncated=False)

    scans = get_zone_scans(app.zone_id)
    assert set(scans) == {'ami1', 'ami2'}
    assert scans['ami1']['found_count'] == 1
    assert scans['ami2']['found_count'] == 0


def test_get_zone_scans_empty_when_no_scans(app):
    assert get_zone_scans(app.zone_id) == {}


def test_get_zone_scans_filters_by_zone(app):
    zone2 = Zone(name='Z2')
    db.session.add(zone2)
    db.session.commit()

    record_scan('ami', app.zone_id, BOX, found_count=1, baseline_total=5,
                zone_matches=1, truncated=False)
    record_scan('ami', zone2.id, BOX, found_count=2, baseline_total=5,
                zone_matches=2, truncated=False)

    scans = get_zone_scans(app.zone_id)
    assert set(scans) == {'ami'}
    assert scans['ami']['found_count'] == 1


# ------------------------------------------------------- filter_friends_to_scan

def test_filter_returns_all_when_no_scans(app):
    to_scan, fresh = filter_friends_to_scan(app.zone_id, ['ami1', 'ami2'], BOX)
    assert to_scan == ['ami1', 'ami2']
    assert fresh == []


def test_filter_skips_fresh_scans(app):
    record_scan('ami1', app.zone_id, BOX, found_count=0, baseline_total=5,
                zone_matches=0, truncated=False)
    record_scan('ami2', app.zone_id, BOX, found_count=1, baseline_total=5,
                zone_matches=1, truncated=False)

    to_scan, fresh = filter_friends_to_scan(app.zone_id, ['ami1', 'ami2', 'ami3'], BOX)
    assert to_scan == ['ami3']  # jamais scanné
    assert fresh == ['ami1', 'ami2']  # scannés récemment, boîte inchangée


def test_filter_rescans_when_box_changed(app):
    record_scan('ami', app.zone_id, BOX, found_count=0, baseline_total=5,
                zone_matches=0, truncated=False)

    new_box = ZoneBox(lat_max=50.0, lon_min=5.0, lat_min=49.0, lon_max=7.0)
    to_scan, fresh = filter_friends_to_scan(app.zone_id, ['ami'], new_box)
    assert to_scan == ['ami']
    assert fresh == []


def test_filter_rescans_when_scan_is_old(app):
    record_scan('ami', app.zone_id, BOX, found_count=0, baseline_total=5,
                zone_matches=0, truncated=False)
    # Vieillir le scan manuellement.
    row = FriendZoneScan.query.one()
    row.scanned_at = datetime.now(timezone.utc) - timedelta(hours=DEFAULT_SCAN_FRESHNESS_HOURS + 1)
    db.session.commit()

    to_scan, fresh = filter_friends_to_scan(app.zone_id, ['ami'], BOX)
    assert to_scan == ['ami']
    assert fresh == []


def test_filter_keeps_fresh_within_threshold(app):
    record_scan('ami', app.zone_id, BOX, found_count=0, baseline_total=5,
                zone_matches=0, truncated=False)
    # Le scan vient d'être enregistré : il est frais.
    to_scan, fresh = filter_friends_to_scan(app.zone_id, ['ami'], BOX)
    assert to_scan == []
    assert fresh == ['ami']


# ----------------------------------------------------------------- Route

def test_zone_scans_route_returns_state(app):
    record_scan('ami1', app.zone_id, BOX, found_count=1, baseline_total=5,
                zone_matches=1, truncated=False)

    payload = app.test_client().get(
        f'/api/friends/finds/zone/{app.zone_id}/scans'
    ).get_json()

    assert payload['success'] is True
    # Pas de liste d'amis en test (pas de mock d'auth) : seuls les scans connus
    # apparaissent dans la section « not_in_friends_list ».
    scans = {s['friend']: s for s in payload['scans']}
    assert 'ami1' in scans
    assert scans['ami1']['scanned'] is True
    assert scans['ami1']['found_count'] == 1
    assert scans['ami1'].get('not_in_friends_list') is True


def test_zone_scans_route_empty_when_no_scans(app):
    payload = app.test_client().get(
        f'/api/friends/finds/zone/{app.zone_id}/scans'
    ).get_json()

    assert payload['success'] is True
    # Aucun scan enregistré : tous les amis sont « jamais analysés ».
    assert payload['scanned_count'] == 0
    assert payload['fresh_count'] == 0
    # Les entrées existent (liste d'amis du cache) mais aucune n'est scannée.
    assert all(not s['scanned'] for s in payload['scans'])


def test_zone_scans_route_handles_naive_datetime_from_sqlite(app):
    """
    SQLite stocke les datetimes sans fuseau horaire (naive).
    La route doit comparer ces datetimes avec le threshold UTC sans lever
    TypeError (cf. bug `can't compare offset-naive and offset-aware`).
    """
    # Enregistrer un scan avec une datetime naive (comme SQLite le ferait).
    scan = FriendZoneScan(
        friend_username='ami1',
        zone_id=app.zone_id,
        box_signature=BOX.box_param,
        baseline_total=2,
        found_count=1,
        zone_matches=1,
        truncated=False,
        scanned_at=datetime.now(),  # naive, comme SQLite
    )
    db.session.add(scan)
    db.session.commit()

    # La route ne doit pas lever d'erreur 500.
    response = app.test_client().get(
        f'/api/friends/finds/zone/{app.zone_id}/scans'
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True
    # Le scan apparaît dans la section « not_in_friends_list » (pas de mock
    # d'auth ici), mais l'important est que la route ne crash pas.
    ami1 = next(s for s in payload['scans'] if s['friend'] == 'ami1')
    assert ami1['scanned'] is True
    assert ami1.get('not_in_friends_list') is True
