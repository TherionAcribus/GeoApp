"""Routes des trackables : actions TB au log de cache, et blueprint /api/trackables."""
from __future__ import annotations

import json
import logging
from time import monotonic

import pytest
import requests
from flask import request

from gc_backend import create_app
from gc_backend.blueprints import logs as logs_bp
from gc_backend.blueprints import trackables as trackables_bp
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache
from gc_backend.models import Trackable, Zone
from gc_backend.services import trackable_store
from gc_backend.services.geocaching_friends import NotAuthenticatedError
from gc_backend.services.geocaching_submit_logs import LogSubmitNetworkError
from gc_backend.services.geocaching_trackables import (
    GeocachingTrackablesClient,
    TrackableDetails,
    TrackableError,
    TrackableLogEntry,
    TrackableLogPageInfo,
    TrackableNotFoundError,
    TrackableSummary,
)


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
        geocache = Geocache(gc_code='GC12345', name='Test', type='Traditional', zone_id=zone.id, logs_count=0)
        db.session.add(geocache)
        db.session.commit()
        app.geocache_id = geocache.id
        yield app
        db.session.remove()
        db.drop_all()


def _mine(code: str, tracking: str = 'SECRET1', name: str | None = None) -> TrackableSummary:
    return TrackableSummary(reference_code=code, name=name or f'TB {code}', tracking_code=tracking,
                            owner_username='AngeEtDemon')


# ------------------------------------------------------ Log de cache + TBs

class _FakeAuthService:
    def get_auth_state(self, force_check: bool = False):
        user = type('User', (), {'username': 'moi', 'public_guid': 'guid'})()
        return type('State', (), {'user_info': user})()

    def apply_submitted_log(self, **kwargs):
        return None


@pytest.fixture
def cache_log_client(app, monkeypatch):
    sent = {}

    class _RecordingSubmitClient:
        def submit_geocache_log(self, gc_code, **kwargs):
            sent.update(kwargs)
            result = sent.get('result', {'logReferenceCode': 'GL7TB'})
            if isinstance(result, Exception):
                raise result
            return result

    monkeypatch.setattr(logs_bp, 'GeocachingSubmitLogsClient', lambda *a, **k: _RecordingSubmitClient())
    monkeypatch.setattr(logs_bp, 'get_auth_service', lambda: _FakeAuthService())
    client = app.test_client()
    client.sent = sent
    return client


def _submit_cache_log(client, geocache_id, trackables):
    return client.post(f'/api/geocaches/{geocache_id}/logs/submit', json={
        'text': 'Merci !', 'date': '2026-09-29', 'logType': 'found', 'trackables': trackables,
    })


def test_cache_log_sends_visit_and_drop_but_not_none(cache_log_client, app):
    trackable_store.save_my_inventory([_mine('TBAAA1'), _mine('TBAAA2'), _mine('TBAAA3')])

    response = _submit_cache_log(cache_log_client, app.geocache_id, [
        {'code': 'tbaaa1', 'action': 'visit'},
        {'code': 'TBAAA2', 'action': 'drop'},
        {'code': 'TBAAA3', 'action': 'none'},
    ])

    assert response.status_code == 200
    assert cache_log_client.sent['trackables'] == [('TBAAA1', 75), ('TBAAA2', 14)]
    assert response.get_json()['trackables'] == [
        {'code': 'TBAAA1', 'action': 'visit'},
        {'code': 'TBAAA2', 'action': 'drop'},
        {'code': 'TBAAA3', 'action': 'none'},
    ]
    # Après envoi : actions mémorisées, TB déposé sorti de l'inventaire vers la cache.
    assert [t.reference_code for t in trackable_store.list_my_inventory()] == ['TBAAA1', 'TBAAA3']
    assert Trackable.query.filter_by(reference_code='TBAAA3').one().last_cache_log_action == 'none'
    assert [t.reference_code for t in trackable_store.list_cache_inventory('GC12345')] == ['TBAAA2']


def test_cache_log_without_trackables_sends_empty_list(cache_log_client, app):
    response = cache_log_client.post(f'/api/geocaches/{app.geocache_id}/logs/submit', json={
        'text': 'Merci !', 'date': '2026-09-29', 'logType': 'found',
    })

    assert response.status_code == 200
    assert cache_log_client.sent['trackables'] == []
    assert response.get_json()['trackables'] == []


@pytest.mark.parametrize('trackables', [
    'TBAAA1',
    [{'code': 'AB12CD', 'action': 'visit'}],            # code de suivi, pas un code public
    [{'code': 'TBAAA1', 'action': 'grab'}],             # action impossible au log de cache
    [{'code': 'TBAAA1', 'action': 'visit'}, {'code': 'tbaaa1', 'action': 'drop'}],
])
def test_cache_log_rejects_invalid_trackables_before_sending(cache_log_client, app, trackables):
    response = _submit_cache_log(cache_log_client, app.geocache_id, trackables)

    assert response.status_code == 400
    assert response.get_json()['error_code'] == 'INVALID_TRACKABLES'
    assert cache_log_client.sent == {}


def test_cache_log_rejects_too_many_trackables(cache_log_client, app):
    response = _submit_cache_log(cache_log_client, app.geocache_id, [
        {'code': f'TB{i:05X}', 'action': 'visit'} for i in range(501)
    ])

    assert response.status_code == 400
    assert response.get_json()['error_code'] == 'INVALID_TRACKABLES'
    assert cache_log_client.sent == {}


# -------------------------------------------------- Règles métier du log

@pytest.mark.parametrize('action', ['visit', 'drop', 'none'])
def test_cache_log_refuses_any_trackable_action_on_dnf(cache_log_client, app, action):
    trackable_store.save_my_inventory([_mine('TBAAA1')])
    response = cache_log_client.post(f'/api/geocaches/{app.geocache_id}/logs/submit', json={
        'text': 'Pas trouvé', 'date': '2026-09-29', 'logType': 'dnf',
        'trackables': [{'code': 'TBAAA1', 'action': action}],
    })

    assert response.status_code == 400
    assert response.get_json()['error_code'] == 'TRACKABLE_ACTION_NOT_ALLOWED'
    assert cache_log_client.sent == {}


def test_cache_log_refuses_drop_on_a_note(cache_log_client, app):
    trackable_store.save_my_inventory([_mine('TBAAA1')])
    response = cache_log_client.post(f'/api/geocaches/{app.geocache_id}/logs/submit', json={
        'text': 'Une note', 'date': '2026-09-29', 'logType': 'note',
        'trackables': [{'code': 'TBAAA1', 'action': 'drop'}],
    })

    assert response.status_code == 400
    assert response.get_json()['error_code'] == 'TRACKABLE_ACTION_NOT_ALLOWED'
    assert cache_log_client.sent == {}


def test_cache_log_allows_visit_on_a_note(cache_log_client, app):
    trackable_store.save_my_inventory([_mine('TBAAA1')])
    response = cache_log_client.post(f'/api/geocaches/{app.geocache_id}/logs/submit', json={
        'text': 'Une note', 'date': '2026-09-29', 'logType': 'note',
        'trackables': [{'code': 'TBAAA1', 'action': 'visit'}],
    })

    assert response.status_code == 200
    assert cache_log_client.sent['trackables'] == [('TBAAA1', 75)]


@pytest.mark.parametrize('action', ['visit', 'drop'])
def test_cache_log_requires_the_trackable_in_local_inventory(cache_log_client, app, action):
    # TBAAA1 connu en base mais PAS en main (p. ex. déposé ailleurs).
    trackable_store.save_cache_inventory('GC99999', [TrackableSummary(reference_code='TBAAA1')])
    response = _submit_cache_log(cache_log_client, app.geocache_id, [
        {'code': 'TBAAA1', 'action': action},
    ])

    assert response.status_code == 409
    assert response.get_json()['error_code'] == 'TRACKABLE_NOT_IN_INVENTORY'
    assert cache_log_client.sent == {}


def test_cache_log_none_does_not_require_inventory(cache_log_client, app):
    response = _submit_cache_log(cache_log_client, app.geocache_id, [
        {'code': 'TBAAA9', 'action': 'none'},
    ])

    assert response.status_code == 200
    assert cache_log_client.sent['trackables'] == []


# ---------------------------------------------------------- /api/trackables

class _FakeTrackablesClient:
    """Client réseau simulé ; chaque attribut peut être une valeur ou une exception à lever."""

    def __init__(self, **behaviour):
        self.behaviour = behaviour
        self.calls = []

    def _answer(self, name, *args):
        self.calls.append((name, args))
        value = self.behaviour[name]
        if isinstance(value, Exception):
            raise value
        return value

    def fetch_my_inventory(self):
        return self._answer('inventory')

    def fetch_cache_inventory(self, gc_code):
        return self._answer('cache', gc_code)

    def lookup(self, code):
        return self._answer('lookup', code)

    def fetch_trackable(self, code):
        return self._answer('trackable', code)

    def fetch_details(self, code):
        return self._answer('details', code)

    def fetch_log_page_info(self, code):
        return self._answer('log_info', code)


@pytest.fixture
def fake_network(monkeypatch):
    holder = {}

    def install(**behaviour):
        fake = _FakeTrackablesClient(**behaviour)
        monkeypatch.setattr(trackables_bp, 'GeocachingTrackablesClient', lambda *a, **k: fake)
        holder['fake'] = fake
        return fake

    return install


def test_inventory_is_fetched_on_first_call_then_served_locally(app, fake_network):
    fake = fake_network(inventory=[_mine('TBAAA2', name='Zèbre'), _mine('TBAAA1', name='abeille')])
    client = app.test_client()

    first = client.get('/api/trackables/inventory').get_json()
    second = client.get('/api/trackables/inventory').get_json()

    assert [t['reference_code'] for t in first['trackables']] == ['TBAAA1', 'TBAAA2']
    assert first['sync']['created'] == 2
    assert second['sync'] is None
    assert len(fake.calls) == 1
    # Le code de suivi ne quitte pas le backend.
    assert 'SECRET1' not in json.dumps(first)
    assert first['trackables'][0]['has_tracking_code'] is True


def test_inventory_refresh_and_errors(app, fake_network):
    client = app.test_client()
    fake_network(inventory=NotAuthenticatedError('reconnectez-vous'))
    response = client.get('/api/trackables/inventory?refresh=1')
    assert response.status_code == 401
    assert response.get_json()['error'] == 'not_authenticated'

    fake_network(inventory=TrackableError('HTTP 429'))
    response = client.get('/api/trackables/inventory?refresh=1')
    assert response.status_code == 502


def test_geocache_inventory(app, fake_network):
    fake_network(cache=[TrackableSummary(reference_code='TBBAQ0Z', name='30 LIRE')])
    client = app.test_client()

    body = client.get('/api/trackables/geocache/gc1e51').get_json()

    assert body['gc_code'] == 'GC1E51'
    assert body['refreshed'] is True
    assert [t['reference_code'] for t in body['trackables']] == ['TBBAQ0Z']
    assert body['trackables'][0]['current_geocache_code'] == 'GC1E51'
    assert client.get('/api/trackables/geocache/NOPE').status_code == 400


def test_lookup_post_keeps_tracking_code_server_side(app, fake_network):
    fake_network(lookup=TrackableSummary(reference_code='TBBAQ0Z', name='30 LIRE', tracking_code='AB12CD'))
    client = app.test_client()

    seen_urls = []
    app.before_request(lambda: seen_urls.append(request.url))
    response = client.post('/api/trackables/lookup', json={'code': 'ab12cd'})
    body = response.get_json()

    assert response.status_code == 200
    assert body['trackable']['reference_code'] == 'TBBAQ0Z'
    assert body['tracking_code_matched'] is True
    # Le code de suivi n'est ni dans l'URL, ni dans la réponse.
    assert 'AB12CD' not in seen_urls[0]
    assert 'AB12CD' not in response.get_data(as_text=True)
    assert trackable_store.get_tracking_code('TBBAQ0Z') == 'AB12CD'


def test_lookup_post_by_public_code(app, fake_network):
    fake_network(lookup=TrackableSummary(reference_code='TBBAQ0Z', name='30 LIRE'))
    client = app.test_client()

    body = client.post('/api/trackables/lookup', json={'code': 'TBBAQ0Z'}).get_json()

    assert body['success'] is True
    assert body['tracking_code_matched'] is False


def test_lookup_post_requires_a_code(app, fake_network):
    client = app.test_client()

    assert client.post('/api/trackables/lookup', json={}).status_code == 400
    assert client.post('/api/trackables/lookup', json={'code': '  '}).status_code == 400
    response = client.post('/api/trackables/lookup', data='nope', content_type='text/plain')
    assert response.status_code == 400


def test_lookup_get_rejects_a_possible_tracking_code(app, fake_network):
    """GET déprécié : un code qui n'est pas public peut être un code de suivi."""
    fake = fake_network(lookup=TrackableSummary(reference_code='TBBAQ0Z'))
    client = app.test_client()

    response = client.get('/api/trackables/lookup?code=AB12CD')

    assert response.status_code == 400
    assert response.get_json()['error'] == 'use_post_lookup'
    # Ni répété dans la réponse, ni envoyé au site.
    assert 'AB12CD' not in response.get_data(as_text=True)
    assert fake.calls == []


def test_lookup_get_public_code_is_deprecated_but_works(app, fake_network):
    fake_network(lookup=TrackableSummary(reference_code='TBBAQ0Z', name='30 LIRE'))
    client = app.test_client()

    response = client.get('/api/trackables/lookup?code=tbbaq0z')

    assert response.status_code == 200
    assert response.headers.get('Deprecation') == 'true'
    assert response.get_json()['trackable']['reference_code'] == 'TBBAQ0Z'


def test_lookup_unknown_code_is_404(app, fake_network):
    fake_network(lookup=TrackableNotFoundError('inconnu'))
    response = app.test_client().post('/api/trackables/lookup', json={'code': 'ZZZZZZ'})
    assert response.status_code == 404


@pytest.mark.parametrize('mode', ['timeout', 'http_404', 'http_429', 'not_json'])
def test_lookup_failures_never_leak_the_tracking_code(app, monkeypatch, caplog, mode):
    """
    Timeout, 404, 429 ou réponse inattendue : le code de suivi saisi n'apparaît
    ni dans la réponse de la route ni dans les logs applicatifs.
    """
    secret = 'AF12CD'

    class _Response:
        def __init__(self, status_code, text='', payload=None):
            self.status_code = status_code
            self.text = text
            self._payload = payload

        def json(self):
            if self._payload is None:
                raise ValueError('not json')
            return self._payload

    class _Session:
        def get(self, url, params=None, **kwargs):
            if mode == 'timeout':
                # Comme `requests`, l'exception cite l'URL complète, query comprise.
                qs = '&'.join(f'{k}={v}' for k, v in (params or {}).items())
                raise requests.ConnectTimeout(
                    f"HTTPSConnectionPool(host='www.geocaching.com'): "
                    f'Max retries exceeded with url: {url}?{qs}'
                )
            if mode == 'http_404':
                return _Response(404, text='not found')
            if mode == 'http_429':
                return _Response(429, text='too many requests')
            if 'details.aspx' in url:
                return _Response(200, text='<span class="CoordInfoCode">TBBAQ0Z</span>')
            return _Response(200, text='<html>Oops</html>')  # JSON attendu, HTML reçu

    monkeypatch.setattr(
        trackables_bp, 'GeocachingTrackablesClient',
        lambda *a, **k: GeocachingTrackablesClient(_Session()),
    )
    client = app.test_client()

    with caplog.at_level(logging.WARNING):
        response = client.post('/api/trackables/lookup', json={'code': secret})

    assert response.status_code in (404, 502)
    assert response.get_json()['success'] is False
    assert secret not in response.get_data(as_text=True)
    assert secret not in caplog.text


def test_trackable_details_and_log_info(app, fake_network):
    from gc_backend.services.geocaching_trackables import TrackableDetails

    fake_network(
        trackable=TrackableSummary(reference_code='TBBAQ0Z', name='30 LIRE',
                                   current_geocache_code='GC1E51', location_known=True),
        details=TrackableDetails(reference_code='TBBAQ0Z', goal_html='<p>Voyager</p>'),
        log_info=TrackableLogPageInfo(reference_code='TBBAQ0Z', allowed_log_type_ids=[4, 48, 13, 19],
                                      current_geocache_code='GC1E51'),
    )
    client = app.test_client()

    body = client.get('/api/trackables/TBBAQ0Z').get_json()
    assert body['trackable']['current_geocache_code'] == 'GC1E51'
    assert body['details']['goal_html'] == '<p>Voyager</p>'

    info = client.get('/api/trackables/TBBAQ0Z/log-info').get_json()
    assert [t['id'] for t in info['allowed_log_types']] == [4, 48, 13, 19]
    assert info['has_tracking_code'] is False
    assert client.get('/api/trackables/AB12CD/log-info').status_code == 400


# ------------------------------------------------------- Log de TB autonome

@pytest.fixture
def trackable_log_client(app, fake_network, monkeypatch):
    sent = {}

    class _RecordingSubmitClient:
        def submit_trackable_log(self, tb_code, **kwargs):
            sent['tb_code'] = tb_code
            sent['count'] = sent.get('count', 0) + 1
            sent.update(kwargs)
            result = sent.get('result', {'logReferenceCode': 'TL1ABC', 'ok': True})
            if isinstance(result, Exception):
                raise result
            return result

    monkeypatch.setattr(trackables_bp, 'GeocachingSubmitLogsClient', lambda *a, **k: _RecordingSubmitClient())
    fake_network(log_info=TrackableLogPageInfo(reference_code='TBBAQ0Z', allowed_log_type_ids=[4, 13, 19, 48],
                                               current_geocache_code='GC1E51'))
    client = app.test_client()
    client.sent = sent
    return client


def _post_tb_log(client, code='TBBAQ0Z', **overrides):
    payload = {'logType': 13, 'text': 'Je le prends', 'date': '2026-09-29', 'trackingCode': 'ab12cd'}
    payload.update(overrides)
    return client.post(f'/api/trackables/{code}/logs', json=payload)


def test_retrieve_uses_current_cache_and_moves_trackable_to_inventory(trackable_log_client):
    trackable_store.save_cache_inventory('GC1E51', [TrackableSummary(reference_code='TBBAQ0Z')])

    response = _post_tb_log(trackable_log_client)

    assert response.status_code == 200
    body = response.get_json()
    assert body['log_reference_code'] == 'TL1ABC'
    assert body['geocache_code'] == 'GC1E51'
    assert trackable_log_client.sent['geocache_code'] == 'GC1E51'
    assert trackable_log_client.sent['tracking_code'] == 'AB12CD'
    assert body['trackable']['in_my_inventory'] is True
    assert trackable_store.list_cache_inventory('GC1E51') == []
    assert 'AB12CD' not in json.dumps(body)


def test_tracking_code_falls_back_on_the_stored_one(trackable_log_client):
    trackable_store.save_my_inventory([_mine('TB6Q3ER', tracking='SECRET1')])

    response = _post_tb_log(trackable_log_client, code='TB6Q3ER', logType=4, trackingCode=None)

    assert response.status_code == 200
    assert trackable_log_client.sent['tracking_code'] == 'SECRET1'


def test_discover_without_tracking_code_is_refused(trackable_log_client):
    response = _post_tb_log(trackable_log_client, logType=48, trackingCode=None)

    assert response.status_code == 400
    assert response.get_json()['error'] == 'missing_tracking_code'
    assert 'tb_code' not in trackable_log_client.sent


@pytest.mark.parametrize('overrides, error', [
    ({'logType': 2}, 'invalid_log_type'),
    ({'logType': True}, 'invalid_log_type'),
    ({'text': '  '}, 'missing_text'),
    ({'date': '29/09/2026'}, 'invalid_date'),
])
def test_trackable_log_validation(trackable_log_client, overrides, error):
    response = _post_tb_log(trackable_log_client, **overrides)

    assert response.status_code == 400
    assert response.get_json()['error'] == error


def test_rejected_trackable_log_is_reported(trackable_log_client):
    trackable_log_client.sent['result'] = {'ok': False, 'status': 200, 'error_message': 'Nope'}

    response = _post_tb_log(trackable_log_client, geocacheCode='GC1E51')

    assert response.status_code == 502
    assert response.get_json()['error_message'] == 'Nope'


# --------------------------------------------- Règles métier du log autonome

def test_log_type_not_allowed_for_this_trackable_is_refused(trackable_log_client):
    # « Marqué manquant » (16) n'est pas dans les types autorisés de la page de log.
    response = _post_tb_log(trackable_log_client, logType=16)

    assert response.status_code == 400
    assert response.get_json()['error'] == 'trackable_action_not_allowed'
    assert 'tb_code' not in trackable_log_client.sent


def test_retrieve_in_another_cache_is_a_location_conflict(trackable_log_client):
    response = _post_tb_log(trackable_log_client, geocacheCode='GCOTHER')

    assert response.status_code == 409
    body = response.get_json()
    assert body['error'] == 'trackable_location_conflict'
    assert body['current_geocache_code'] == 'GC1E51'
    assert 'tb_code' not in trackable_log_client.sent


def test_retrieve_with_confirmed_conflict_is_sent(trackable_log_client):
    trackable_store.save_cache_inventory('GC1E51', [TrackableSummary(reference_code='TBBAQ0Z')])
    response = _post_tb_log(trackable_log_client, geocacheCode='GCOTHER', locationConflictConfirmed=True)

    assert response.status_code == 200
    assert trackable_log_client.sent['geocache_code'] == 'GCOTHER'


@pytest.mark.parametrize('overrides, error', [
    ({'text': 'x' * 10_001}, 'text_too_long'),
    ({'trackingCode': 'X' * 65}, 'invalid_tracking_code'),
    ({'geocacheCode': 'PASGC'}, 'invalid_geocache'),
])
def test_trackable_log_field_bounds(trackable_log_client, overrides, error):
    response = _post_tb_log(trackable_log_client, **overrides)

    assert response.status_code == 400
    assert response.get_json()['error'] == error
    assert 'tb_code' not in trackable_log_client.sent


# ------------------------------------- Résultat distant incertain (timeout…)

def _log_entry(**overrides):
    """Un log de la fiche du TB, tel que `fetch_details` le parserait."""
    base = dict(
        log_reference_code='TL9XYZ', log_type_id=13, log_type_label='Retiré de la cache',
        log_date='2026-09-29', log_date_raw='09/29/2026',
        author_username='moi', author_guid='g',
        geocache_code='GC1E51', geocache_name=None,
        text_html='<p>Je le <strong>prends</strong></p>',
    )
    base.update(overrides)
    return TrackableLogEntry(**base)


def _unknown_outcome(trackable_log_client, fake_network, monkeypatch, *, details):
    """Simule un POST interrompu : erreur réseau au résultat distant inconnu."""
    monkeypatch.setattr(trackables_bp, 'get_auth_service', lambda: _FakeAuthService())
    fake = fake_network(
        log_info=TrackableLogPageInfo(reference_code='TBBAQ0Z', allowed_log_type_ids=[4, 13, 19, 48],
                                      current_geocache_code='GC1E51'),
        details=details,
    )
    trackable_log_client.sent['result'] = LogSubmitNetworkError(
        'read timeout', outcome='unknown_remote_outcome')
    return fake


def test_timeout_reconciles_a_log_that_actually_landed(app, trackable_log_client, fake_network, monkeypatch):
    """Le log a été enregistré malgré le timeout : réconcilié, sans second POST."""
    _unknown_outcome(trackable_log_client, fake_network, monkeypatch,
                     details=TrackableDetails(reference_code='TBBAQ0Z', logs=[_log_entry()]))
    trackable_store.save_cache_inventory('GC1E51', [TrackableSummary(reference_code='TBBAQ0Z')])

    response = _post_tb_log(trackable_log_client)

    assert response.status_code == 200
    body = response.get_json()
    assert body['reconciled'] == 'confirmed'
    assert body['log_reference_code'] == 'TL9XYZ'
    assert trackable_log_client.sent['count'] == 1
    # Le retrait est reporté localement comme pour un succès direct.
    assert trackable_store.list_cache_inventory('GC1E51') == []


def test_timeout_without_matching_log_reports_absent(app, trackable_log_client, fake_network, monkeypatch):
    _unknown_outcome(trackable_log_client, fake_network, monkeypatch,
                     details=TrackableDetails(reference_code='TBBAQ0Z', logs=[]))

    response = _post_tb_log(trackable_log_client)

    assert response.status_code == 502
    body = response.get_json()
    assert body['error'] == 'submit_failed'
    assert body['reconciled'] == 'absent'
    assert trackable_log_client.sent['count'] == 1


def test_timeout_with_unreadable_details_is_ambiguous(app, trackable_log_client, fake_network, monkeypatch):
    """Impossible de relire la fiche : on ne marque ni succès ni échec certain."""
    fake = _unknown_outcome(trackable_log_client, fake_network, monkeypatch,
                            details=TrackableError('boom'))

    response = _post_tb_log(trackable_log_client)

    assert response.status_code == 502
    body = response.get_json()
    assert body['error'] == 'unknown_remote_outcome'
    assert body['reconciled'] == 'ambiguous'
    assert body['trackable_url'].endswith('tracker=TBBAQ0Z')
    assert 'AB12CD' not in response.get_data(as_text=True)
    assert trackable_log_client.sent['count'] == 1


def test_connection_failure_needs_no_reconciliation(app, trackable_log_client, fake_network, monkeypatch):
    """Coupé avant réponse : la requête n'est pas partie, pas besoin de relire la fiche."""
    monkeypatch.setattr(trackables_bp, 'get_auth_service', lambda: _FakeAuthService())
    fake = fake_network(
        log_info=TrackableLogPageInfo(reference_code='TBBAQ0Z', allowed_log_type_ids=[4, 13, 19, 48],
                                      current_geocache_code='GC1E51'),
        details=TrackableError('ne doit pas être appelé'),
    )
    trackable_log_client.sent['result'] = LogSubmitNetworkError(
        'conn refused', outcome='network_failed_before_response')

    response = _post_tb_log(trackable_log_client)

    assert response.status_code == 502
    assert response.get_json()['error'] == 'network_failed_before_response'
    assert 'fetch_details' not in [name for name, _ in fake.calls]


# ---------------------------------- Log de cache : coupure réseau classifiée

def test_cache_log_unknown_remote_outcome_is_flagged(app, cache_log_client):
    """Timeout côté site après envoi : la réponse dit que le log a pu être créé."""
    trackable_store.save_my_inventory([_mine('TBAAA1')])
    cache_log_client.sent['result'] = LogSubmitNetworkError('read timeout', outcome='unknown_remote_outcome')

    response = _submit_cache_log(cache_log_client, app.geocache_id, [{'code': 'TBAAA1', 'action': 'visit'}])

    assert response.status_code == 502
    body = response.get_json()
    assert body['error_code'] == 'UNKNOWN_REMOTE_OUTCOME'


def test_cache_log_connection_failure_is_before_response(app, cache_log_client):
    trackable_store.save_my_inventory([_mine('TBAAA1')])
    cache_log_client.sent['result'] = LogSubmitNetworkError('conn refused', outcome='network_failed_before_response')

    response = _submit_cache_log(cache_log_client, app.geocache_id, [{'code': 'TBAAA1', 'action': 'visit'}])

    assert response.status_code == 502
    assert response.get_json()['error_code'] == 'NETWORK_FAILED_BEFORE_RESPONSE'


# ---------------------------------------------------------- Clé d'opération

def test_operation_id_prevents_double_submit(trackable_log_client):
    trackable_store.save_cache_inventory('GC1E51', [TrackableSummary(reference_code='TBBAQ0Z')])

    first = _post_tb_log(trackable_log_client, operationId='op-1')
    second = _post_tb_log(trackable_log_client, operationId='op-1')

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.get_json() == first.get_json()   # réponse rejouée, pas renvoyée
    assert trackable_log_client.sent['count'] == 1


def test_in_flight_operation_is_refused(trackable_log_client):
    trackables_bp._log_operations['op-stuck'] = {'state': 'in_flight', 'expires_at': monotonic() + 600}
    try:
        response = _post_tb_log(trackable_log_client, operationId='op-stuck')
    finally:
        trackables_bp._log_operations.pop('op-stuck', None)

    assert response.status_code == 409
    assert response.get_json()['error'] == 'operation_in_flight'
    assert 'count' not in trackable_log_client.sent


def test_inventory_is_refetched_when_older_than_max_age(app, fake_network):
    from datetime import datetime, timedelta, timezone

    from gc_backend.models import AppConfig

    fake = fake_network(inventory=[_mine('TBAAA1')])
    client = app.test_client()
    client.get('/api/trackables/inventory')
    assert len(fake.calls) == 1

    # Relevé récent : max_age ne relit pas le site.
    client.get('/api/trackables/inventory?max_age=900')
    assert len(fake.calls) == 1

    old = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    AppConfig.set_value(trackable_store.INVENTORY_LAST_SYNC_KEY, old)
    db.session.commit()
    body = client.get('/api/trackables/inventory?max_age=900').get_json()
    assert len(fake.calls) == 2
    assert body['sync']['fetched'] == 1


def test_automatic_refresh_failure_still_serves_local_copy(app, fake_network):
    from datetime import datetime, timedelta, timezone

    from gc_backend.models import AppConfig

    fake_network(inventory=[_mine('TBAAA1')])
    client = app.test_client()
    client.get('/api/trackables/inventory')
    old = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    AppConfig.set_value(trackable_store.INVENTORY_LAST_SYNC_KEY, old)
    db.session.commit()

    fake_network(inventory=TrackableError('HTTP 429'))
    response = client.get('/api/trackables/inventory?max_age=900')
    assert response.status_code == 200
    body = response.get_json()
    assert [t['reference_code'] for t in body['trackables']] == ['TBAAA1']
    assert 'HTTP 429' in body['sync_error']
    # Un rafraîchissement explicite, lui, signale l'échec.
    assert client.get('/api/trackables/inventory?refresh=1').status_code == 502
