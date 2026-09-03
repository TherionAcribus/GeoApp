"""
Synchronisation automatique en arrière-plan du flux d'activité des amis.

Le flux distant est plafonné (~100 entrées, fenêtre ~60 j) : pour ne pas perdre
les entrées qui sortent de la fenêtre, il faut synchroniser **régulièrement**,
même quand le widget n'est pas ouvert. Ce module lance un thread daemon qui
vérifie périodiquement si une synchro est nécessaire et la déclenche le cas échéant.

Conditions pour déclencher une synchro :
- l'utilisateur est connecté à Geocaching.com ;
- la préférence ``geoApp.friends.activity.autoSync`` est activée (défaut : oui) ;
- la dernière synchro date de plus que ``autoSyncIntervalHours`` (défaut : 1 h).

Le thread s'exécute dans le contexte d'application Flask (``app.app_context()``)
pour avoir accès à la base et au service d'authentification. Il dort entre les
vérifications (``CHECK_INTERVAL_SECONDS``) et s'arrête proprement quand
``stop()`` est appelé ou quand le processus se termine (thread daemon).
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
from typing import Optional

from flask import Flask

from .geocaching_auth import get_auth_service

logger = logging.getLogger(__name__)

# Intervalle entre deux vérifications (pas entre deux syncs : la sync elle-même
# ne se déclenche que si assez de temps s'est écoulé depuis la dernière).
CHECK_INTERVAL_SECONDS = 5 * 60  # 5 minutes

# Fenêtre de synchro par défaut (en jours) : on synchronise de petites fenêtres
# pour rester sous le plafond serveur (~100 entrées).
DEFAULT_SYNC_DAYS = 7

_scheduler: Optional[FriendActivityScheduler] = None
_scheduler_lock = threading.Lock()


class FriendActivityScheduler:
    """
    Thread daemon qui synchronise périodiquement le flux d'activité des amis.

    Une seule instance par processus, démarrée dans ``create_app()`` via
    ``start_scheduler()``. Les erreurs de synchro sont journalisées et le
    thread continue : une synchro échouée ne doit pas arrêter le service.
    """

    def __init__(self, app: Flask, check_interval: int = CHECK_INTERVAL_SECONDS) -> None:
        self._app = app
        self._check_interval = check_interval
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._last_sync_attempt: Optional[datetime] = None

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return

        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run,
            name="friend_activity_sync",
            daemon=True,
        )
        self._thread.start()
        logger.info("Friend activity scheduler started (check every %ds)", self._check_interval)

    def stop(self, timeout: float = 5.0) -> None:
        self._stop_event.set()
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=timeout)
        logger.info("Friend activity scheduler stopped")

    def _run(self) -> None:
        while not self._stop_event.is_set():
            try:
                self._maybe_sync()
            except Exception:
                # Une erreur inattendue ne doit pas tuer le thread.
                logger.exception("Unexpected error in friend activity scheduler")

            # sleep() retourne immédiatement si l'event est set, ce qui permet
            # un arrêt propre même pendant l'attente.
            self._stop_event.wait(self._check_interval)

    def _maybe_sync(self) -> None:
        """Vérifie les conditions et déclenche une synchro si nécessaire."""
        with self._app.app_context():
            if not self._is_auto_sync_enabled():
                return

            if not get_auth_service().is_logged_in():
                return

            if not self._is_sync_due():
                return

            sync_days = self._get_sync_days()
            self._last_sync_attempt = datetime.now(timezone.utc)

            try:
                from . import friend_activity_store
                report = friend_activity_store.sync(since_days=sync_days)
                logger.info(
                    "Auto-sync of friend activity: %d fetched, %d created, %d updated, %d finds projected",
                    report.fetched, report.created, report.updated, report.finds_projected,
                )
            except Exception as exc:
                # NotAuthenticatedError, FriendActivityError, réseau… : on
                # journalise et on réessaiera au prochain cycle.
                logger.warning("Auto-sync of friend activity failed: %s", exc)

    def _is_auto_sync_enabled(self) -> bool:
        from ..utils.preferences import get_value_or_default
        return bool(get_value_or_default('geoApp.friends.activity.autoSync', True))

    def _get_sync_interval_hours(self) -> int:
        from ..utils.preferences import get_value_or_default
        return int(get_value_or_default('geoApp.friends.activity.autoSyncIntervalHours', 1))

    def _get_sync_days(self) -> int:
        from ..utils.preferences import get_value_or_default
        return int(get_value_or_default('geoApp.friends.activity.autoSyncDays', DEFAULT_SYNC_DAYS))

    def _is_sync_due(self) -> bool:
        """True si la dernière synchro date de plus que l'intervalle configuré."""
        from . import friend_activity_store
        last_sync_str = friend_activity_store.get_last_sync_at()
        if not last_sync_str:
            # Jamais synchronisé : on y va.
            return True

        try:
            last_sync = datetime.fromisoformat(last_sync_str)
        except ValueError:
            logger.debug("Unparsable last_sync_at: %r", last_sync_str)
            return True

        if last_sync.tzinfo is None:
            last_sync = last_sync.replace(tzinfo=timezone.utc)

        elapsed = datetime.now(timezone.utc) - last_sync
        interval_hours = self._get_sync_interval_hours()
        return elapsed.total_seconds() >= interval_hours * 3600


def start_scheduler(app: Flask) -> FriendActivityScheduler:
    """
    Démarre le scheduler global (une seule instance par processus).

    À appeler dans ``create_app()``, hors tests et migrations.
    """
    global _scheduler
    with _scheduler_lock:
        if _scheduler is None:
            _scheduler = FriendActivityScheduler(app)
            _scheduler.start()
        return _scheduler


def stop_scheduler() -> None:
    """Arrête le scheduler global s'il existe (principalement pour les tests)."""
    global _scheduler
    with _scheduler_lock:
        if _scheduler is not None:
            _scheduler.stop()
            _scheduler = None
