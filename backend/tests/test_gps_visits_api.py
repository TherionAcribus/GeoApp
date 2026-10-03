"""API des visites GPS Garmin : import idempotent, point de départ, états, liste groupée."""
from __future__ import annotations

import io
from datetime import timedelta, timezone

import pytest

from gc_backend import create_app
from gc_backend.blueprints import gps_visits as gps_visits_bp
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache
from gc_backend.models import GpsVisit, Zone
from gc_backend.services import gps_visit_store

CEST = timezone(timedelta(hours=2))

VISITS = (
    'GC1AAAA,2026-08-20T08:00Z,Found it,""\r\n'
    'GC4NKAY,2026-09-27T09:38Z,Unattempted,""\r\n'
    'GC4NKAY,2026-09-27T09:42Z,Didn\'t find it,""\r\n'
    'GC4NKAY,2026-09-27T09:45Z,Found it,"Horse"\r\n'
    'GC2BBBB,2026-09-27T10:00Z,Needs Maintenance,""\r\n'
    ',2026-09-27T10:10Z,Found it,""\r\n'
    ',2026-09-27T10:10Z,Found it,""\r\n'
)


@pytest.fixture
def app(monkeypatch):
    monkeypatch.setattr(gps_visit_store, 'get_local_tz', lambda: CEST)
    app = create_app()
    app.config['TESTING'] = True
    with app.app_context():
        db.create_all()
        zone = Zone(name='Sorties')
        db.session.add(zone)
        db.session.flush()
        db.session.add(Geocache(gc_code='GC4NKAY', name='La cache du cheval', type='Traditional', zone_id=zone.id))
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def _upload(client, text=VISITS):
    data = {'visitsFile': (io.BytesIO(text.encode('utf-16-le')), 'geocache_visits.txt')}
    return client.post('/api/gps-visits/import', data=data, content_type='multipart/form-data')


def test_first_import_asks_for_a_cutoff(app):
    client = app.test_client()
    body = _upload(client).get_json()
    assert body['new'] == 7
    assert body['without_code'] == 2
    assert body['needs_cutoff'] is True
    assert body['landmarks']['last_visit_day'] == '2026-09-27'


def test_reimport_is_idempotent(app):
    client = app.test_client()
    _upload(client)
    body = _upload(client).get_json()
    assert body['new'] == 0
    assert body['known'] == 7
    with app.app_context():
        assert GpsVisit.query.count() == 7


def test_cutoff_moves_older_visits_to_history(app):
    client = app.test_client()
    _upload(client)
    result = client.post('/api/gps-visits/cutoff', json={'since': '2026-09-01'}).get_json()
    assert result['to_history'] == 1
    assert _upload(client).get_json()['needs_cutoff'] is False

    listing = client.get('/api/gps-visits').get_json()
    assert [d['day'] for d in listing['days']] == ['2026-09-27']
    entries = listing['days'][0]['entries']
    # GC4NKAY réduit à une trouvaille, GC2BBBB en NM, deux visites sans code distinctes.
    assert len(entries) == 4
    nkay = entries[0]
    assert nkay['gc_code'] == 'GC4NKAY'
    assert nkay['status'] == 'found'
    assert nkay['time'] == '11:45'
    assert nkay['raw_count'] == 3
    assert nkay['comment'] == 'Horse'
    assert nkay['name'] == 'La cache du cheval'
    assert nkay['geocaches'][0]['zone_name'] == 'Sorties'
    nm = entries[1]
    assert nm['needs_confirmation'] is True
    assert nm['geocaches'] == []
    assert listing['counts']['pending'] == 4


def test_new_visits_older_than_cutoff_arrive_in_history(app):
    client = app.test_client()
    _upload(client, 'GC1AAAA,2026-09-27T08:00Z,Found it,""\r\n')
    client.post('/api/gps-visits/cutoff', json={'since': '2026-09-01'})
    _upload(client, 'GC9ZZZZ,2026-08-01T08:00Z,Found it,""\r\n')
    with app.app_context():
        assert GpsVisit.query.filter_by(gc_code='GC9ZZZZ').one().state == 'history'


def test_ignore_and_restore(app):
    client = app.test_client()
    _upload(client)
    client.post('/api/gps-visits/cutoff', json={'since': '2026-09-01'})
    entry = client.get('/api/gps-visits').get_json()['days'][0]['entries'][0]
    assert client.post('/api/gps-visits/state', json={'ids': entry['visit_ids'], 'state': 'ignored'}).status_code == 200

    pending = client.get('/api/gps-visits').get_json()
    assert all(e['gc_code'] != 'GC4NKAY' for d in pending['days'] for e in d['entries'])
    ignored = client.get('/api/gps-visits?state=ignored').get_json()
    assert ignored['days'][0]['entries'][0]['gc_code'] == 'GC4NKAY'


def test_history_cannot_be_set_by_hand(app):
    client = app.test_client()
    response = client.post('/api/gps-visits/state', json={'ids': [1], 'state': 'history'})
    assert response.status_code == 400


def test_path_must_come_from_detect(app, monkeypatch, tmp_path):
    visits_file = tmp_path / 'geocache_visits.txt'
    visits_file.write_bytes(VISITS.encode('utf-16-le'))
    client = app.test_client()

    monkeypatch.setattr(gps_visits_bp, 'detect_visit_files', lambda: [])
    refused = client.post('/api/gps-visits/import', json={'path': str(visits_file)})
    assert refused.status_code == 400
    assert refused.get_json()['error'] == 'path_not_detected'

    monkeypatch.setattr(gps_visits_bp, 'detect_visit_files', lambda: [{'path': str(visits_file)}])
    accepted = client.post('/api/gps-visits/import', json={'path': str(visits_file)})
    assert accepted.status_code == 200
    assert accepted.get_json()['new'] == 7


def test_rejects_a_file_that_is_not_a_visits_file(app):
    client = app.test_client()
    response = _upload(client, 'ceci,n\'est,pas,un fichier de visites\r\n')
    assert response.status_code == 400
    assert response.get_json()['error'] == 'not_a_visits_file'



def test_each_day_carries_its_track_summary(app):
    from datetime import datetime

    from gc_backend.models import GpsTrackDay

    client = app.test_client()
    _upload(client)
    client.post('/api/gps-visits/cutoff', json={'since': '2026-09-01'})
    db.session.add(GpsTrackDay(day='2026-09-27', points='[]', distance_m=42300,
                               started_at=datetime(2026, 9, 27, 6, 55), ended_at=datetime(2026, 9, 27, 16, 3)))
    db.session.commit()
    day = client.get('/api/gps-visits').get_json()['days'][0]
    # Heures locales (CEST), durée en minutes, distance de la trace (voiture comprise).
    assert day['track'] == {'start': '08:55', 'end': '18:03', 'minutes': 548, 'distance_m': 42300}
