"""Signalement d'un problème (Needs Maintenance / Needs Archived) : un second log, comme c:geo."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from gc_backend import create_app
from gc_backend.blueprints import logs as logs_bp
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache, GeocacheLog
from gc_backend.models import GpsVisit, Zone
from gc_backend.services import gps_visit_store
from gc_backend.services.geocaching_submit_logs import LogSubmitNetworkError
from gc_backend.services.log_problems import validate_problem

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
        trad = Geocache(gc_code='GC12345', name='Trad', type='Traditional Cache', zone_id=zone.id)
        virtual = Geocache(gc_code='GC99999', name='Virtuelle', type='Virtual Cache', zone_id=zone.id)
        db.session.add_all([trad, virtual])
        db.session.add(GpsVisit(raw_code='GC12345', gc_code='GC12345', visited_at=datetime(2026, 9, 27, 10, 0),
                                status_raw='Needs Maintenance', status='needs_maintenance', state='pending'))
        db.session.commit()
        app.trad_id, app.virtual_id = trad.id, virtual.id
        yield app
        db.session.remove()
        db.drop_all()


class _FakeAuthService:
    def get_auth_state(self, force_check: bool = False):
        user = type('User', (), {'username': 'Moi', 'public_guid': None, 'reference_code': None})()
        return type('State', (), {'user_info': user})()

    def apply_submitted_log(self, **kwargs):
        return None


def _client(app, monkeypatch, result=None, raises=None):
    calls = []

    class _FakeSubmitClient:
        def submit_geocache_log(self, gc_code, **kwargs):
            calls.append((gc_code, kwargs))
            if raises:
                raise raises
            return result

    monkeypatch.setattr(logs_bp, 'GeocachingSubmitLogsClient', lambda *a, **k: _FakeSubmitClient())
    monkeypatch.setattr(logs_bp, 'get_auth_service', lambda: _FakeAuthService())
    return app.test_client(), calls


def _report(client, geocache_id, **body):
    payload = {'category': 'needsMaintenance', 'text': 'Le couvercle est cassé.', 'date': '2026-09-27',
               'main_log_type': 'found', **body}
    return client.post(f'/api/geocaches/{geocache_id}/logs/report-problem', json=payload)


def test_sends_a_needs_maintenance_log(app, monkeypatch):
    client, calls = _client(app, monkeypatch, {'logReferenceCode': 'GLNM001'})
    response = _report(client, app.trad_id)
    assert response.status_code == 200
    body = response.get_json()
    assert body['log_type_id'] == 45
    assert body['log_reference_code'] == 'GLNM001'
    gc_code, kwargs = calls[0]
    assert gc_code == 'GC12345'
    assert kwargs['log_type_id'] == 45
    assert kwargs['log_text'] == 'Le couvercle est cassé.'
    assert kwargs['visited_date'].isoformat() == '2026-09-27'
    # Ni photos, ni TBs, ni point favori dans un signalement.
    assert 'images' not in kwargs and 'trackables' not in kwargs and 'used_favorite_point' not in kwargs
    with app.app_context():
        stored = GeocacheLog.query.filter_by(external_id='GLNM001').one()
        assert stored.log_type == 'Needs Maintenance'
        assert GpsVisit.query.one().nm_log_reference_code == 'GLNM001'


def test_archive_category_sends_needs_archived(app, monkeypatch):
    client, calls = _client(app, monkeypatch, {'logReferenceCode': 'GLNA001'})
    assert _report(client, app.trad_id, category='archive').status_code == 200
    assert calls[0][1]['log_type_id'] == 7


@pytest.mark.parametrize('category,main_log_type', [('missing', 'found'), ('logFull', 'dnf'), ('damaged', 'dnf')])
def test_incoherent_combinations_are_refused_without_calling_geocaching(app, monkeypatch, category, main_log_type):
    client, calls = _client(app, monkeypatch, {'logReferenceCode': 'never'})
    response = _report(client, app.trad_id, category=category, main_log_type=main_log_type)
    assert response.status_code == 400
    assert response.get_json()['error_code'] == 'INVALID_PROBLEM'
    assert calls == []


def test_container_categories_are_refused_on_a_virtual(app, monkeypatch):
    client, calls = _client(app, monkeypatch, {'logReferenceCode': 'never'})
    assert _report(client, app.virtual_id, category='logFull').status_code == 400
    assert _report(client, app.virtual_id, category='other').status_code == 200


def test_unknown_category_and_empty_text_are_refused(app, monkeypatch):
    client, calls = _client(app, monkeypatch, {'logReferenceCode': 'never'})
    assert _report(client, app.trad_id, category='nope').status_code == 400
    assert _report(client, app.trad_id, text='  ').status_code == 400
    assert calls == []


def test_network_cut_after_sending_is_reported_as_uncertain(app, monkeypatch):
    client, _ = _client(app, monkeypatch, raises=LogSubmitNetworkError('timeout', outcome='unknown_remote_outcome'))
    response = _report(client, app.trad_id)
    assert response.status_code == 502
    assert response.get_json()['error_code'] == 'UNKNOWN_REMOTE_OUTCOME'


def test_validate_problem_rules():
    assert validate_problem('needsMaintenance', 'skip', 'Traditional Cache') is None
    assert validate_problem('missing', 'dnf', 'Traditional Cache') is None
    assert validate_problem('missing', 'found', None) is not None
    assert validate_problem('logWet', None, 'Webcam Cache') is not None
