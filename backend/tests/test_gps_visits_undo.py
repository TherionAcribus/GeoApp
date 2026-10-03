"""Annulations immédiates de la liste (Ignorer, Rattacher, point de départ) et « Vérifier sur Geocaching.com »."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from gc_backend import create_app
from gc_backend.blueprints import gps_visits as gps_visits_bp
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache
from gc_backend.models import GpsVisit, Zone
from gc_backend.services import geocaching_auth, gps_visit_store, my_found_dates

CEST = timezone(timedelta(hours=2))


@pytest.fixture
def app(monkeypatch):
    monkeypatch.setattr(gps_visit_store, 'get_local_tz', lambda: CEST)
    monkeypatch.setattr(my_found_dates, 'CHECK_INTERVAL_SECONDS', 0)
    app = create_app()
    app.config['TESTING'] = True
    with app.app_context():
        db.create_all()
        zone = Zone(name='Z1')
        db.session.add(zone)
        db.session.flush()
        db.session.add(Geocache(gc_code='GCAAA', name='Dans l\'App', type='Traditional', zone_id=zone.id))
        db.session.add_all([
            GpsVisit(raw_code='GCAAA', gc_code='GCAAA', visited_at=datetime(2026, 9, 27, 9, 0),
                     status_raw='Found it', status='found', state='pending'),
            GpsVisit(raw_code='GCBBB', gc_code='GCBBB', visited_at=datetime(2026, 9, 27, 10, 0),
                     status_raw='Found it', status='found', state='pending'),
            GpsVisit(raw_code='GCCCC', gc_code='GCCCC', visited_at=datetime(2026, 9, 27, 11, 0),
                     status_raw='Found it', status='found', state='logged'),
            GpsVisit(raw_code='', gc_code=None, visited_at=datetime(2026, 9, 27, 12, 0),
                     status_raw='Found it', status='found', state='pending'),
            GpsVisit(raw_code='GCOLD', gc_code='GCOLD', visited_at=datetime(2026, 8, 1, 9, 0),
                     status_raw='Found it', status='found', state='pending'),
        ])
        db.session.commit()
        app.ids = {v.raw_code or 'nocode': v.id for v in GpsVisit.query.all()}
        yield app
        db.session.remove()
        db.drop_all()


def _states():
    return {v.raw_code or 'nocode': v.state for v in GpsVisit.query.all()}


def test_ignoring_returns_what_undo_puts_back(app):
    client = app.test_client()
    ids = [app.ids['GCAAA'], app.ids['GCCCC']]
    body = client.post('/api/gps-visits/state', json={'ids': ids, 'state': 'ignored'}).get_json()
    assert body['updated'] == 2
    # Seules les visites changées, avec leur état d'avant.
    assert {(p['id'], p['state']) for p in body['previous']} == {(app.ids['GCAAA'], 'pending'), (app.ids['GCCCC'], 'logged')}

    restored = client.post('/api/gps-visits/restore', json={'items': body['previous']}).get_json()
    assert restored['restored'] == 2
    states = _states()
    assert states['GCAAA'] == 'pending' and states['GCCCC'] == 'logged'


def test_attaching_and_detaching_can_be_undone(app):
    client = app.test_client()
    visit_id = app.ids['nocode']
    attached = client.post(f'/api/gps-visits/{visit_id}/resolve', json={'gc_code': 'GCNEW', 'source': 'track'}).get_json()
    assert attached['resolved_gc_code'] == 'GCNEW'
    assert attached['previous'] == [{'id': visit_id, 'state': 'pending', 'resolved_gc_code': None, 'resolution_source': None}]
    client.post('/api/gps-visits/restore', json={'items': attached['previous']})
    assert db.session.get(GpsVisit, visit_id).resolved_gc_code is None

    batch = client.post('/api/gps-visits/resolve-batch',
                        json={'items': [{'visit_id': visit_id, 'gc_code': 'GCNEW', 'source': 'track'}]}).get_json()
    detached = client.post(f'/api/gps-visits/{visit_id}/resolve', json={'gc_code': None}).get_json()
    # Annuler le détachement remet le rattachement et sa source.
    client.post('/api/gps-visits/restore', json={'items': detached['previous']})
    visit = db.session.get(GpsVisit, visit_id)
    assert (visit.resolved_gc_code, visit.resolution_source) == ('GCNEW', 'track')
    client.post('/api/gps-visits/restore', json={'items': batch['previous']})
    assert db.session.get(GpsVisit, visit_id).resolved_gc_code is None


def test_restore_never_attaches_a_visit_with_a_code(app):
    client = app.test_client()
    client.post('/api/gps-visits/restore', json={'items': [
        {'id': app.ids['GCAAA'], 'state': 'pending', 'resolved_gc_code': 'GCZZZ', 'resolution_source': 'manual'},
    ]})
    assert db.session.get(GpsVisit, app.ids['GCAAA']).resolved_gc_code is None


def test_changing_the_cutoff_can_be_undone(app):
    client = app.test_client()
    first = client.post('/api/gps-visits/cutoff', json={'since': '2026-09-01'}).get_json()
    assert first['previous_cutoff'] is None
    assert _states()['GCOLD'] == 'history'

    second = client.post('/api/gps-visits/cutoff', json={'since': '2026-07-01'}).get_json()
    assert second['previous_cutoff'] == '2026-09-01'
    assert _states()['GCOLD'] == 'pending'
    client.post('/api/gps-visits/restore', json={'cutoff': second['previous_cutoff']})
    assert _states()['GCOLD'] == 'history'

    # Annuler le tout premier point de départ : plus de point de départ, rien en historique.
    client.post('/api/gps-visits/restore', json={'cutoff': None})
    assert _states()['GCOLD'] == 'pending'
    assert gps_visit_store.get_cutoff() is None


class _FakeAuth:
    def __init__(self, logged_in=True):
        self.logged_in = logged_in

    def get_auth_state(self, force_check=False):
        user = type('User', (), {'username': 'Moi'})() if self.logged_in else None
        return type('State', (), {'user_info': user})()

    def get_session(self):
        return object()


def _sheet(found=None):
    return {'name': 'x', 'callerSpecific': {'found': found} if found else {}}


def test_check_found_marks_what_geocaching_knows(app, monkeypatch):
    sheets = {'GCAAA': _sheet('2026-09-27T00:00:00'), 'GCBBB': _sheet('2025-05-01T00:00:00'), 'GCOLD': _sheet()}
    monkeypatch.setattr(geocaching_auth, 'get_auth_service', lambda: _FakeAuth())
    monkeypatch.setattr(gps_visits_bp, '_geocache_sheet_lookup', lambda session: sheets.get)
    client = app.test_client()
    body = client.post('/api/gps-visits/check-found', json={'visit_ids': list(app.ids.values())}).get_json()
    # GCCCC (déjà loguée dans la liste) n'est pas lue ; la visite sans code non plus.
    assert body['checked'] == 3
    assert [(i['gc_code'], i['found_on']) for i in body['same_day']] == [('GCAAA', '2026-09-27')]
    assert [(i['gc_code'], i['found_on']) for i in body['other_day']] == [('GCBBB', '2025-05-01')]
    assert body['not_found'] == 1

    # Gardé sur les visites, et la géocache de l'App passe trouvée.
    assert db.session.get(GpsVisit, app.ids['GCAAA']).remote_found_on == date(2026, 9, 27)
    assert db.session.get(GpsVisit, app.ids['GCOLD']).remote_checked_at is not None
    assert Geocache.query.filter_by(gc_code='GCAAA').one().found is True
    listing = client.get('/api/gps-visits?max_days=3650').get_json()
    entries = {e['gc_code']: e for day in listing['days'] for e in day['entries']}
    assert entries['GCAAA']['found'] and entries['GCAAA']['found_date'].startswith('2026-09-27')
    # Absente de l'App : la date lue sur Geocaching.com suffit.
    assert entries['GCBBB']['found_date'] == '2025-05-01'
    assert entries['GCOLD']['found'] is False and entries['GCOLD']['remote_checked_at']


def test_check_found_needs_a_geocaching_session(app, monkeypatch):
    monkeypatch.setattr(geocaching_auth, 'get_auth_service', lambda: _FakeAuth(logged_in=False))
    response = app.test_client().post('/api/gps-visits/check-found', json={'day': '2026-09-27'})
    assert response.status_code == 401


def test_check_codes_stops_at_the_limit_and_reports_unreadable_sheets():
    sheets = {'GC1': _sheet('2026-09-27T10:00:00'), 'GC2': None}
    found, unknown, skipped = my_found_dates.check_codes(
        ['GC1', 'GC2', 'GC1', 'GC3'], sheets.get, max_checks=2, sleep=lambda s: None)
    assert found == {'GC1': date(2026, 9, 27)}
    assert unknown == ['GC2']
    assert skipped == ['GC3']
