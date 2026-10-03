"""Retour d'envoi : un log parti fait passer les visites GPS du jour en « loguée »."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from gc_backend import create_app
from gc_backend.blueprints import logs as logs_bp
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache
from gc_backend.models import GpsVisit, Zone
from gc_backend.services import gps_visit_store

CEST = timezone(timedelta(hours=2))


@pytest.fixture
def app(monkeypatch):
    monkeypatch.setattr(gps_visit_store, 'get_local_tz', lambda: CEST)
    app = create_app()
    app.config['TESTING'] = True
    with app.app_context():
        db.create_all()
        zone = Zone(name='Z1')
        db.session.add(zone)
        db.session.flush()
        geocache = Geocache(gc_code='GC12345', name='Test', type='Traditional', zone_id=zone.id)
        db.session.add(geocache)
        # Deux passages le 27/09 (heure locale), une visite le 28/09 juste après minuit local.
        db.session.add_all([
            GpsVisit(raw_code='GC12345', gc_code='GC12345', visited_at=datetime(2026, 9, 27, 9, 42),
                     status_raw="Didn't find it", status='dnf', state='pending'),
            GpsVisit(raw_code='GC12345', gc_code='GC12345', visited_at=datetime(2026, 9, 27, 9, 45),
                     status_raw='Found it', status='found', state='pending'),
            GpsVisit(raw_code='GC12345', gc_code='GC12345', visited_at=datetime(2026, 9, 27, 22, 30),
                     status_raw='Found it', status='found', state='pending'),
            # Visite sans code rattachée à la cache.
            GpsVisit(raw_code='', gc_code=None, resolved_gc_code='GC12345', visited_at=datetime(2026, 9, 27, 10, 0),
                     status_raw='Found it', status='found', state='pending'),
        ])
        db.session.commit()
        app.geocache_id = geocache.id
        yield app
        db.session.remove()
        db.drop_all()


class _FakeAuthService:
    def get_auth_state(self, force_check: bool = False):
        user = type('User', (), {'username': 'Moi', 'public_guid': None, 'reference_code': None})()
        return type('State', (), {'user_info': user})()

    def apply_submitted_log(self, **kwargs):
        return None


def _client_returning(app, monkeypatch, gc_result):
    class _FakeSubmitClient:
        def submit_geocache_log(self, gc_code, **kwargs):
            return gc_result

    monkeypatch.setattr(logs_bp, 'GeocachingSubmitLogsClient', lambda *a, **k: _FakeSubmitClient())
    monkeypatch.setattr(logs_bp, 'get_auth_service', lambda: _FakeAuthService())
    return app.test_client()


def _states(app):
    with app.app_context():
        return {(v.visited_at.isoformat(), v.state, v.log_reference_code) for v in GpsVisit.query.all()}


def test_successful_log_marks_the_day_visits_logged(app, monkeypatch):
    client = _client_returning(app, monkeypatch, {'logReferenceCode': 'GL0001'})
    response = client.post(f'/api/geocaches/{app.geocache_id}/logs/submit',
                           json={'text': 'Trouvée !', 'date': '2026-09-27', 'logType': 'found'})
    assert response.status_code == 200
    assert _states(app) == {
        ('2026-09-27T09:42:00', 'logged', 'GL0001'),
        ('2026-09-27T09:45:00', 'logged', 'GL0001'),
        ('2026-09-27T10:00:00', 'logged', 'GL0001'),
        # 22h30 UTC = 00h30 le 28/09 en heure locale : pas le même jour.
        ('2026-09-27T22:30:00', 'pending', None),
    }


def test_already_logged_on_geocaching_marks_visits_logged(app, monkeypatch):
    client = _client_returning(app, monkeypatch, {
        'ok': False, 'status': 409, 'error_code': 'CONFLICT', 'error_message': 'déjà consigné',
    })
    response = client.post(f'/api/geocaches/{app.geocache_id}/logs/submit',
                           json={'text': 'Trouvée !', 'date': '2026-09-28', 'logType': 'found'})
    assert response.status_code == 409
    states = _states(app)
    assert ('2026-09-27T22:30:00', 'logged', None) in states
    assert ('2026-09-27T09:45:00', 'pending', None) in states


def test_found_on_another_day_does_not_mark_visits(app, monkeypatch):
    # Même session que la requête de test (le contexte de la fixture est réutilisé).
    geocache = db.session.get(Geocache, app.geocache_id)
    geocache.found = True
    geocache.found_date = datetime(2025, 1, 1)
    db.session.commit()
    client = _client_returning(app, monkeypatch, {'logReferenceCode': 'never'})
    response = client.post(f'/api/geocaches/{app.geocache_id}/logs/submit',
                           json={'text': 'Trouvée !', 'date': '2026-09-27', 'logType': 'found'})
    assert response.status_code == 409
    assert all(state == 'pending' for _, state, _ in _states(app))


def test_a_find_known_only_on_geocaching_is_not_posted_twice(app, monkeypatch):
    from datetime import date

    from gc_backend.services import my_found_dates

    # Loguée depuis le téléphone : la base locale l'ignore, la fiche de la cache le sait.
    monkeypatch.setattr(my_found_dates, 'remote_found_date', lambda gc_code: date(2026, 9, 27))
    posted = []
    client = _client_returning(app, monkeypatch, {'logReferenceCode': 'never'})
    monkeypatch.setattr(logs_bp, 'GeocachingSubmitLogsClient',
                        lambda *a, **k: type('C', (), {'submit_geocache_log': lambda self, *a, **k: posted.append(a)})())
    response = client.post(f'/api/geocaches/{app.geocache_id}/logs/submit',
                           json={'text': 'Trouvée !', 'date': '2026-09-27', 'logType': 'found'})
    assert response.status_code == 409
    assert response.get_json()['error_code'] == 'ALREADY_LOGGED'
    assert posted == []
    geocache = db.session.get(Geocache, app.geocache_id)
    assert geocache.found and geocache.found_date == datetime(2026, 9, 27)
    assert ('2026-09-27T09:45:00', 'logged', None) in _states(app)


def test_a_dnf_is_never_checked_on_geocaching(app, monkeypatch):
    from gc_backend.services import my_found_dates

    def fail(gc_code):
        raise AssertionError('pas de vérification pour un DNF')

    monkeypatch.setattr(my_found_dates, 'remote_found_date', fail)
    client = _client_returning(app, monkeypatch, {'logReferenceCode': 'GL0002'})
    response = client.post(f'/api/geocaches/{app.geocache_id}/logs/submit',
                           json={'text': 'Pas trouvée', 'date': '2026-09-27', 'logType': 'dnf'})
    assert response.status_code == 200
