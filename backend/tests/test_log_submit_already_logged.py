"""Détection du refus « cache déjà loguée » renvoyé par Geocaching.com.

Le repère fiable est le code d'erreur structuré de l'enveloppe tRPC (ou le statut
HTTP 409) : le message, lui, est un texte d'interface. La recherche textuelle ne
sert donc plus qu'en dernier recours, et seulement sur `error_message` — la faire
sur la réponse entière transformait n'importe quel log parlant de cache et de
logs en faux « déjà logué ».
"""
from __future__ import annotations

import pytest

from gc_backend import create_app
from gc_backend.blueprints import logs as logs_bp
from gc_backend.blueprints.logs import _looks_like_already_logged
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache
from gc_backend.models import Zone


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
        geocache = Geocache(gc_code='GC12345', name='Test', type='Traditional', zone_id=zone.id)
        db.session.add(geocache)
        db.session.commit()
        app.geocache_id = geocache.id
        yield app
        db.session.remove()
        db.drop_all()


def _client_returning(app, monkeypatch, gc_result):
    class _FakeSubmitClient:
        def submit_geocache_log(self, gc_code, **kwargs):
            return gc_result

    monkeypatch.setattr(logs_bp, 'GeocachingSubmitLogsClient', lambda *a, **k: _FakeSubmitClient())
    return app.test_client()


def _submit(client, geocache_id):
    return client.post(f'/api/geocaches/{geocache_id}/logs/submit',
                       json={'text': 'Trouvée !', 'date': '2026-07-26', 'logType': 'found'})


def test_trpc_conflict_code_is_reported_as_already_logged(app, monkeypatch):
    client = _client_returning(app, monkeypatch, {
        'ok': False, 'status': 400, 'error_code': 'CONFLICT',
        'error_message': 'Vous avez déjà consigné cette géocache',
    })

    response = _submit(client, app.geocache_id)

    assert response.status_code == 409
    assert response.get_json()['error_code'] == 'ALREADY_LOGGED'


def test_error_http_status_409_is_enough_when_the_batch_answers_200(app, monkeypatch):
    # Le lot tRPC répond 200 et porte l'échec dans l'enveloppe : le seul statut
    # qui décrit le refus est celui de l'erreur.
    client = _client_returning(app, monkeypatch, {
        'ok': False, 'status': 200, 'error_http_status': 409,
        'error_message': 'Ya has registrado este geocaché',
    })

    response = _submit(client, app.geocache_id)

    assert response.status_code == 409
    assert response.get_json()['error_code'] == 'ALREADY_LOGGED'


def test_english_message_still_works_without_a_structured_code(app, monkeypatch):
    client = _client_returning(app, monkeypatch, {
        'ok': False, 'status': 400,
        'error_message': 'You have already logged this cache',
    })

    assert _submit(client, app.geocache_id).status_code == 409


def test_a_log_talking_about_logs_and_caches_is_not_a_conflict(app, monkeypatch):
    # Régression : le corps renvoyé contient le log qu'on vient d'envoyer. Chercher
    # « already » + « log » + « cache » dedans faisait passer une panne serveur pour
    # un doublon, et l'utilisateur croyait son log parti.
    client = _client_returning(app, monkeypatch, {
        'ok': False, 'status': 500,
        'error_message': 'Internal server error',
        'body': '{"logText": "Already dark when I got to the cache, logged from the car."}',
    })

    response = _submit(client, app.geocache_id)

    assert response.status_code == 502
    assert response.get_json()['error_code'] == 'GC_MISSING_LOG_REFERENCE'


@pytest.mark.parametrize('result', [
    None,
    'already logged this cache',
    {'ok': False, 'status': 500, 'body': 'already logged this cache'},
    {'logReferenceCode': 'GL1', 'logText': 'already logged the cache next door'},
])
def test_only_structured_fields_and_the_error_message_are_examined(result):
    assert _looks_like_already_logged(result) is False


@pytest.mark.parametrize('result', [
    {'error_code': 'conflict'},
    {'error_code': 'ALREADY_LOGGED'},
    {'status': 409},
    {'error_http_status': 409},
    {'error_message': 'Duplicate log for this geocache'},
])
def test_conflicts_are_recognised(result):
    assert _looks_like_already_logged(result) is True
