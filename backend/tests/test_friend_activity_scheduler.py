"""Tests du scheduler de synchronisation automatique et de la projection incrémentale."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.models import AppConfig, FriendActivity, FriendFind
from gc_backend.services import friend_activity_store
from gc_backend.services.friend_activity_scheduler import FriendActivityScheduler


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


def _log(
    log_code: str,
    *,
    username: str = 'ami1',
    gc_code: str | None = 'GC11111',
    log_type_id: int = 2,
    last_seen_at: datetime | None = None,
) -> FriendActivity:
    """Crée une ligne d'activité avec un ``last_seen_at`` explicite."""
    row = FriendActivity(
        log_reference_code=log_code,
        activity_type=2,
        author_username=username,
        is_self=False,
        log_type_id=log_type_id,
        log_date=datetime(2026, 7, 20, 10, 0, 0),
        cache_name='Le vieux pont',
        cache_reference_code=gc_code,
        cache_type_id=2,
        difficulty=2.0,
        terrain=1.5,
        latitude=48.1,
        longitude=4.1,
        last_seen_at=last_seen_at or datetime.now(timezone.utc),
    )
    db.session.add(row)
    return row


# ============================================================
#  Projection incrémentale
# ============================================================

def test_projection_is_incremental_after_first_run(app):
    """La première projection balaie tout ; la seconde ne balaie que les nouvelles lignes."""
    # Lignes anciennes
    old_time = datetime(2026, 7, 1, tzinfo=timezone.utc)
    _log('GL1', username='ami1', gc_code='GC11111', last_seen_at=old_time)
    db.session.commit()

    # Première projection : pas de timestamp -> balaie tout
    assert friend_activity_store.project_finds() == 1
    assert FriendFind.query.count() == 1

    # Une nouvelle ligne arrive (last_seen_at après la première projection)
    new_time = datetime.now(timezone.utc) + timedelta(seconds=1)
    _log('GL2', username='ami1', gc_code='GC22222', last_seen_at=new_time)
    db.session.commit()

    # Deuxième projection : ne doit voir que la nouvelle ligne
    assert friend_activity_store.project_finds() == 1
    assert FriendFind.query.count() == 2


def test_projection_returns_zero_when_no_new_rows(app):
    """Sans nouvelles lignes depuis la dernière projection, retourne 0 sans toucher au timestamp."""
    _log('GL1', username='ami1', gc_code='GC11111')
    db.session.commit()

    # Première projection
    assert friend_activity_store.project_finds() == 1

    # Pas de nouvelles lignes
    assert friend_activity_store.project_finds() == 0
    assert FriendFind.query.count() == 1


def test_projection_first_run_scans_all_rows(app):
    """Au premier appel (pas de LAST_PROJECTION_KEY), balaie toute la table."""
    old_time = datetime(2020, 1, 1, tzinfo=timezone.utc)
    _log('GL1', username='ami1', gc_code='GC11111', last_seen_at=old_time)
    _log('GL2', username='ami2', gc_code='GC22222', last_seen_at=old_time)
    db.session.commit()

    assert friend_activity_store.project_finds() == 2
    assert FriendFind.query.count() == 2


def test_projection_timestamp_is_persisted(app):
    """La projection enregistre son timestamp dans AppConfig."""
    _log('GL1', username='ami1', gc_code='GC11111')
    db.session.commit()

    assert AppConfig.get_value(friend_activity_store.LAST_PROJECTION_KEY) is None

    friend_activity_store.project_finds()

    assert AppConfig.get_value(friend_activity_store.LAST_PROJECTION_KEY) is not None


# ============================================================
#  Scheduler
# ============================================================

def test_scheduler_does_not_sync_when_not_logged_in(app):
    """Pas de synchro si l'utilisateur n'est pas connecté."""
    scheduler = FriendActivityScheduler(app, check_interval=1)

    with app.app_context():
        with patch('gc_backend.services.friend_activity_scheduler.get_auth_service') as mock_auth:
            mock_auth.return_value.is_logged_in.return_value = False
            with patch('gc_backend.services.friend_activity_store.sync') as mock_sync:
                scheduler._maybe_sync()
                mock_sync.assert_not_called()


def test_scheduler_does_not_sync_when_disabled(app):
    """Pas de synchro si la préférence autoSync est désactivée."""
    scheduler = FriendActivityScheduler(app, check_interval=1)

    with app.app_context():
        with patch('gc_backend.utils.preferences.get_value_or_default', return_value=False):
            with patch('gc_backend.services.friend_activity_scheduler.get_auth_service') as mock_auth:
                mock_auth.return_value.is_logged_in.return_value = True
                with patch('gc_backend.services.friend_activity_store.sync') as mock_sync:
                    scheduler._maybe_sync()
                    mock_sync.assert_not_called()


def test_scheduler_syncs_when_logged_in_and_stale(app):
    """Synchro déclenchée si connecté + jamais synchronisé."""
    scheduler = FriendActivityScheduler(app, check_interval=1)

    with app.app_context():
        with patch('gc_backend.utils.preferences.get_value_or_default', return_value=True):
            with patch('gc_backend.services.friend_activity_scheduler.get_auth_service') as mock_auth:
                mock_auth.return_value.is_logged_in.return_value = True
                with patch('gc_backend.services.friend_activity_store.sync') as mock_sync:
                    mock_sync.return_value = type('R', (), {
                        'fetched': 5, 'created': 3, 'updated': 2, 'finds_projected': 1
                    })()
                    scheduler._maybe_sync()
                    mock_sync.assert_called_once()


def test_scheduler_does_not_sync_when_recently_synced(app):
    """Pas de synchro si la dernière date de moins d'une heure."""
    scheduler = FriendActivityScheduler(app, check_interval=1)

    # Enregistrer une synchro récente
    recent = datetime.now(timezone.utc).isoformat()
    AppConfig.set_value(friend_activity_store.LAST_SYNC_KEY, recent)
    db.session.commit()

    with app.app_context():
        with patch('gc_backend.utils.preferences.get_value_or_default', return_value=True):
            with patch('gc_backend.services.friend_activity_scheduler.get_auth_service') as mock_auth:
                mock_auth.return_value.is_logged_in.return_value = True
                with patch('gc_backend.services.friend_activity_store.sync') as mock_sync:
                    scheduler._maybe_sync()
                    mock_sync.assert_not_called()


def test_scheduler_syncs_when_old_sync(app):
    """Synchro déclenchée si la dernière date de plus que l'intervalle."""
    scheduler = FriendActivityScheduler(app, check_interval=1)

    # Enregistrer une synchro ancienne (3 heures)
    old = (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat()
    AppConfig.set_value(friend_activity_store.LAST_SYNC_KEY, old)
    db.session.commit()

    with app.app_context():
        with patch('gc_backend.utils.preferences.get_value_or_default', return_value=True):
            with patch('gc_backend.services.friend_activity_scheduler.get_auth_service') as mock_auth:
                mock_auth.return_value.is_logged_in.return_value = True
                with patch('gc_backend.services.friend_activity_store.sync') as mock_sync:
                    mock_sync.return_value = type('R', (), {
                        'fetched': 0, 'created': 0, 'updated': 0, 'finds_projected': 0
                    })()
                    scheduler._maybe_sync()
                    mock_sync.assert_called_once()


def test_scheduler_continues_after_sync_error(app):
    """Une erreur de synchro ne doit pas empêcher les cycles suivants."""
    scheduler = FriendActivityScheduler(app, check_interval=1)

    with app.app_context():
        with patch('gc_backend.utils.preferences.get_value_or_default', return_value=True):
            with patch('gc_backend.services.friend_activity_scheduler.get_auth_service') as mock_auth:
                mock_auth.return_value.is_logged_in.return_value = True
                with patch('gc_backend.services.friend_activity_store.sync', side_effect=RuntimeError("boom")):
                    # Ne doit pas lever
                    scheduler._maybe_sync()

                # Le cycle suivant doit pouvoir fonctionner
                with patch('gc_backend.services.friend_activity_store.sync') as mock_sync:
                    mock_sync.return_value = type('R', (), {
                        'fetched': 1, 'created': 1, 'updated': 0, 'finds_projected': 0
                    })()
                    scheduler._maybe_sync()
                    mock_sync.assert_called_once()


def test_scheduler_start_and_stop(app):
    """Le scheduler démarre et s'arrête proprement."""
    scheduler = FriendActivityScheduler(app, check_interval=1)
    scheduler.start()
    assert scheduler._thread is not None
    assert scheduler._thread.is_alive()

    scheduler.stop(timeout=2)
    assert not scheduler._thread.is_alive()


def test_scheduler_start_is_idempotent(app):
    """Un double start ne crée pas un second thread."""
    scheduler = FriendActivityScheduler(app, check_interval=60)
    scheduler.start()
    thread1 = scheduler._thread

    scheduler.start()
    thread2 = scheduler._thread

    assert thread1 is thread2

    scheduler.stop(timeout=2)
