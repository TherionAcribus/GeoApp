"""
Préparer la sortie : récapitulatif, ajout des caches à la zone (copie, jamais
déplacement), annulation pendant et après l'ajout, statut « trouvée » des copies.
"""
from __future__ import annotations

import io
import json
from datetime import date, timedelta, timezone

import pytest

from gc_backend import create_app
from gc_backend.blueprints import gps_visits as gps_visits_bp
from gc_backend.blueprints import logs as logs_bp
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache, GeocacheLog
from gc_backend.models import GpsVisit, GpsZoneOperation, Zone
from gc_backend.services import gps_visit_store
from gc_backend.services import gps_zone_operations as operations

CEST = timezone(timedelta(hours=2))

DAY_VISITS = (
    'GC4NKAY,2026-09-27T09:45Z,Found it,""\r\n'
    'GC2BBBB,2026-09-27T10:00Z,Didn\'t find it,""\r\n'
    'GC3CCCC,2026-09-27T10:05Z,Unattempted,""\r\n'
    ',2026-09-27T10:10Z,Found it,""\r\n'
    'GC5EEEE,2026-09-27T10:20Z,Found it,""\r\n'
)


@pytest.fixture
def app(monkeypatch):
    monkeypatch.setattr(gps_visit_store, 'get_local_tz', lambda: CEST)
    monkeypatch.setattr(gps_visits_bp, 'DOWNLOAD_INTERVAL_SECONDS', 0)
    app = create_app()
    app.config['TESTING'] = True
    with app.app_context():
        db.create_all()
        slovenie = Zone(name='Slovénie')
        db.session.add(slovenie)
        db.session.flush()
        db.session.add(Geocache(gc_code='GC4NKAY', name='La cache du cheval', type='Traditional',
                                zone_id=slovenie.id, latitude=46.0, longitude=14.5))
        db.session.commit()
        app.slovenie_id = slovenie.id
        client = app.test_client()
        data = {'visitsFile': (io.BytesIO(DAY_VISITS.encode('utf-16-le')), 'geocache_visits.txt')}
        client.post('/api/gps-visits/import', data=data, content_type='multipart/form-data')
        client.post('/api/gps-visits/cutoff', json={'since': '2026-09-01'})
        yield app
        db.session.remove()
        db.drop_all()


class _FakeImporter:
    calls: list = []

    def import_by_code(self, zone_id, code, return_outcome=False, update_existing=False):
        if code == 'GC9DEAD':
            raise LookupError('gc_not_found')
        _FakeImporter.calls.append(code)
        geocache = Geocache(gc_code=code, name=f'Cache {code}', type='Traditional', zone_id=zone_id)
        db.session.add(geocache)
        db.session.commit()
        return (geocache, 'created') if return_outcome else geocache


@pytest.fixture(autouse=True)
def _fake_importer(monkeypatch):
    from gc_backend.geocaches import importer as importer_module

    _FakeImporter.calls = []
    monkeypatch.setattr(importer_module, 'GeocacheImporter', _FakeImporter)


def _lines(response):
    return [json.loads(line) for line in response.get_data(as_text=True).splitlines() if line.strip()]


def _start(client, **body):
    payload = {'operation_id': 'op-12345678', 'day': '2026-09-27', **body}
    return client.post('/api/gps-visits/zone-operations', json=payload)


def test_prepare_summarizes_what_will_happen(app):
    body = app.test_client().post('/api/gps-visits/prepare',
                                  json={'day': '2026-09-27', 'zone_id': app.slovenie_id}).get_json()
    plans = {e['gc_code']: e['plan'] for e in body['entries']}
    assert plans == {'GC4NKAY': 'existing', 'GC2BBBB': 'download', 'GC5EEEE': 'download'}
    assert body['counts'] == {'existing': 1, 'copy': 0, 'download': 2, 'without_code': 1, 'unattempted': 1}
    assert body['days'] == ['2026-09-27']
    # Ordre de visite gardé (il numérote @cache_count dans l'éditeur).
    assert [e['gc_code'] for e in body['entries']] == ['GC4NKAY', 'GC2BBBB', 'GC5EEEE']


def test_prepare_for_another_zone_plans_a_copy(app):
    with app.app_context():
        sortie = Zone(name='Sortie')
        db.session.add(sortie)
        db.session.commit()
        sortie_id = sortie.id
    body = app.test_client().post('/api/gps-visits/prepare',
                                  json={'day': '2026-09-27', 'zone_id': sortie_id}).get_json()
    assert body['entries'][0]['plan'] == 'copy'
    assert body['entries'][0]['target_geocache_id'] is None


def test_adding_to_a_new_zone_copies_and_never_moves(app):
    client = app.test_client()
    lines = _lines(_start(client, new_zone_name='Sortie du 27/09/2026'))
    final = lines[-1]
    assert final['final_summary'] is True
    assert final['operation']['counts'] == {'existing': 0, 'copied': 1, 'created': 2}
    assert _FakeImporter.calls == ['GC2BBBB', 'GC5EEEE']
    with app.app_context():
        sortie = Zone.query.filter_by(name='Sortie du 27/09/2026').one()
        assert {g.gc_code for g in Geocache.query.filter_by(zone_id=sortie.id)} == {'GC4NKAY', 'GC2BBBB', 'GC5EEEE'}
        # La cache connue reste aussi dans sa zone d'origine.
        assert Geocache.query.filter_by(gc_code='GC4NKAY', zone_id=app.slovenie_id).count() == 1
        assert operations.get_day_zones() == {'2026-09-27': sortie.id}
        assert gps_visit_store.get_last_zone_id() == sortie.id
    # Le récapitulatif suivant propose la zone de ce jour.
    suggested = client.post('/api/gps-visits/prepare', json={'day': '2026-09-27'}).get_json()['suggested_zone_id']
    assert suggested == lines[0]['zone_id']


def test_refuses_an_existing_zone_name(app):
    response = _start(app.test_client(), new_zone_name='Slovénie')
    assert response.status_code == 409
    assert response.get_json()['error'] == 'zone_exists'


def test_cancel_during_the_addition_removes_what_was_added(app, monkeypatch):
    # Annulation demandée après la première cache traitée.
    original_record = operations.record

    def record_then_cancel(operation, gc_code, geocache_id, action):
        original_record(operation, gc_code, geocache_id, action)
        operations.request_cancel(operation.id)

    monkeypatch.setattr(operations, 'record', record_then_cancel)
    lines = _lines(_start(app.test_client(), new_zone_name='Sortie du 27/09/2026'))
    final = lines[-1]
    assert final['cancelled'] is True
    assert 'zone « Sortie du 27/09/2026 » supprimée' in final['message']
    with app.app_context():
        assert Zone.query.filter_by(name='Sortie du 27/09/2026').first() is None
        assert Geocache.query.filter_by(gc_code='GC4NKAY').count() == 1
        assert db.session.get(GpsZoneOperation, 'op-12345678').state == 'cancelled'
        assert operations.get_day_zones() == {}


def test_undo_after_the_addition_keeps_the_existing_zone(app):
    client = app.test_client()
    _lines(_start(client, zone_id=app.slovenie_id))
    response = client.post('/api/gps-visits/zone-operations/op-12345678/cancel')
    assert response.status_code == 200
    assert response.get_json()['removed'] == 2
    with app.app_context():
        # Zone existante : jamais supprimée ; la cache qui y était déjà reste.
        assert db.session.get(Zone, app.slovenie_id) is not None
        assert {g.gc_code for g in Geocache.query.filter_by(zone_id=app.slovenie_id)} == {'GC4NKAY'}
    assert client.post('/api/gps-visits/zone-operations/op-12345678/cancel').status_code == 409


def test_undo_is_refused_once_a_log_was_sent(app):
    client = app.test_client()
    _lines(_start(client, new_zone_name='Sortie'))
    with app.app_context():
        copy = Geocache.query.filter(Geocache.gc_code == 'GC2BBBB').one()
        db.session.add(GeocacheLog(geocache_id=copy.id, external_id='GL1', is_own_log=True, log_type='Did Not Find'))
        db.session.commit()
    response = client.post('/api/gps-visits/zone-operations/op-12345678/cancel')
    assert response.status_code == 409
    assert response.get_json()['error'] == 'undo_refused'


def test_a_download_error_does_not_stop_the_others(app):
    client = app.test_client()
    with app.app_context():
        db.session.add(GpsVisit(raw_code='GC9DEAD', gc_code='GC9DEAD', visited_at=gps_visit_store.local_midnight_utc(
            date(2026, 9, 27), CEST) + timedelta(hours=13), status_raw='Found it',
            status='found', state='pending'))
        db.session.commit()
    final = _lines(_start(client, new_zone_name='Sortie'))[-1]
    assert '1 erreur' in final['message']
    assert final['operation']['counts']['created'] == 2


def test_a_found_log_marks_every_copy_found(app, monkeypatch):
    client = app.test_client()
    _lines(_start(client, new_zone_name='Sortie'))

    class _FakeSubmitClient:
        def submit_geocache_log(self, gc_code, **kwargs):
            return {'logReferenceCode': 'GL42'}

    class _FakeAuth:
        def get_auth_state(self, force_check=False):
            return type('S', (), {'user_info': None})()

        def apply_submitted_log(self, **kwargs):
            return None

    monkeypatch.setattr(logs_bp, 'GeocachingSubmitLogsClient', lambda *a, **k: _FakeSubmitClient())
    monkeypatch.setattr(logs_bp, 'get_auth_service', lambda: _FakeAuth())
    with app.app_context():
        copy_id = Geocache.query.join(Zone).filter(Zone.name == 'Sortie', Geocache.gc_code == 'GC4NKAY').one().id
    response = client.post(f'/api/geocaches/{copy_id}/logs/submit',
                           json={'text': 'Merci !', 'date': '2026-09-27', 'logType': 'found'})
    assert response.status_code == 200
    with app.app_context():
        assert all(g.found for g in Geocache.query.filter_by(gc_code='GC4NKAY'))
        original_id = Geocache.query.filter_by(gc_code='GC4NKAY', zone_id=app.slovenie_id).one().id
    # Un second « Found it » depuis l'autre zone est refusé.
    again = client.post(f'/api/geocaches/{original_id}/logs/submit',
                        json={'text': 'Encore', 'date': '2026-09-27', 'logType': 'found'})
    assert again.status_code == 409
