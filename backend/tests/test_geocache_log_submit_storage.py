"""Le log qu'on envoie est stocké localement, puis remplacé par sa version officielle.

Sans ça, la liste des logs d'une géocache reste muette sur sa propre contribution
jusqu'au prochain `/logs/refresh` — alors que le backend dispose déjà de tout
(texte, date de visite, type, `logReferenceCode`) au moment de la soumission.
"""
from __future__ import annotations

from datetime import datetime

import pytest

from gc_backend import create_app
from gc_backend.blueprints import logs as logs_bp
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache, GeocacheLog
from gc_backend.models import Zone
from gc_backend.services.geocaching_logs import GeocacheLogData


ME = 'therion'


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
        geocache = Geocache(gc_code='GC12345', name='Test', type='Traditional',
                            zone_id=zone.id, logs_count=7)
        db.session.add(geocache)
        db.session.commit()
        app.geocache_id = geocache.id
        yield app
        db.session.remove()
        db.drop_all()


class _FakeUserInfo:
    username = ME
    public_guid = 'guid-moi'


class _FakeAuthService:
    """`get_auth_state().user_info` pour l'auteur, `apply_submitted_log` pour les stats."""

    def get_auth_state(self, force_check: bool = False):
        return type('State', (), {'user_info': _FakeUserInfo()})()

    def apply_submitted_log(self, **kwargs):
        return None


@pytest.fixture
def submitting_client(app, monkeypatch):
    class _FakeSubmitClient:
        def submit_geocache_log(self, gc_code, **kwargs):
            return {'logReferenceCode': 'GL7ABCDEF', 'ok': True}

    monkeypatch.setattr(logs_bp, 'GeocachingSubmitLogsClient', lambda *a, **k: _FakeSubmitClient())
    monkeypatch.setattr(logs_bp, 'get_auth_service', lambda: _FakeAuthService())
    return app.test_client()


def _submit(client, geocache_id, **overrides):
    payload = {'text': 'Trouvée sans souci, merci !', 'date': '2026-07-26', 'logType': 'found'}
    payload.update(overrides)
    return client.post(f'/api/geocaches/{geocache_id}/logs/submit', json=payload)


def test_submitted_log_is_stored_locally(submitting_client, app):
    response = _submit(submitting_client, app.geocache_id, favorite=True)

    assert response.status_code == 200
    body = response.get_json()
    assert body['log_reference_code'] == 'GL7ABCDEF'
    assert body['log']['author'] == ME
    assert body['log']['log_type'] == 'Found'

    stored = GeocacheLog.query.filter_by(geocache_id=app.geocache_id).all()
    assert len(stored) == 1
    log = stored[0]
    assert log.external_id == 'GL7ABCDEF'
    assert log.author == ME
    assert log.text == 'Trouvée sans souci, merci !'
    # Date de visite, pas date de soumission : c'est elle qui classe le log.
    assert log.date == datetime(2026, 7, 26)
    assert log.is_favorite is True
    assert log.is_friend_log is False

    # Un log de plus sur la cache, comme après un rafraîchissement.
    assert Geocache.query.get(app.geocache_id).logs_count == 8


def test_dnf_is_stored_with_its_own_type(submitting_client, app):
    _submit(submitting_client, app.geocache_id, logType='dnf', text='Bredouille…')

    log = GeocacheLog.query.filter_by(geocache_id=app.geocache_id).one()
    assert log.log_type == 'Did Not Find'
    assert log.is_favorite is False


def _fetched(external_id: str, author: str, log_type: str = 'Found it',
             date: datetime | None = None) -> GeocacheLogData:
    return GeocacheLogData(
        external_id=external_id,
        author=author,
        author_guid=f'acc-{external_id}',
        text=f'Log de {author}',
        date=date or datetime(2026, 7, 26),
        log_type=log_type,
        is_favorite=False,
    )


def _patch_refresh(monkeypatch, fetched):
    class _FakeLogsClient:
        def get_logs_with_friends(self, gc_code, count=25):
            return fetched, set()

    monkeypatch.setattr(logs_bp, 'GeocachingLogsClient', lambda *a, **k: _FakeLogsClient())


def test_refresh_replaces_the_locally_stored_log(submitting_client, app, monkeypatch):
    _submit(submitting_client, app.geocache_id)

    # Geocaching.com renvoie le même log, mais identifié par son LogID numérique.
    _patch_refresh(monkeypatch, [_fetched('1336648432', ME)])

    body = submitting_client.post(f'/api/geocaches/{app.geocache_id}/logs/refresh').get_json()

    assert body['replaced_local'] == 1
    assert body['added'] == 1
    logs = GeocacheLog.query.filter_by(geocache_id=app.geocache_id).all()
    assert [log.external_id for log in logs] == ['1336648432']


def test_refresh_keeps_the_local_log_until_geocaching_returns_it(submitting_client, app, monkeypatch):
    """Log pas encore visible dans le logbook : on garde la ligne locale."""
    _submit(submitting_client, app.geocache_id)

    _patch_refresh(monkeypatch, [_fetched('42', 'quelquun_dautre')])

    body = submitting_client.post(f'/api/geocaches/{app.geocache_id}/logs/refresh').get_json()

    assert body['replaced_local'] == 0
    externals = {log.external_id for log in GeocacheLog.query.filter_by(geocache_id=app.geocache_id)}
    assert externals == {'GL7ABCDEF', '42'}


def test_resubmitting_the_same_log_reference_does_not_duplicate(submitting_client, app):
    _submit(submitting_client, app.geocache_id, logType='note')
    _submit(submitting_client, app.geocache_id, logType='note')

    assert GeocacheLog.query.filter_by(geocache_id=app.geocache_id).count() == 1
