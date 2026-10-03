"""
Journal des ajouts de caches à une zone depuis les visites GPS, et leur annulation.

Un ajout (« Préparer la sortie ») porte un identifiant fourni par le client. Chaque
cache traitée est notée avec ce qui lui est arrivé (``existing``, ``copied``,
``created``). Annuler — pendant l'ajout ou juste après — retire les seules lignes
copiées ou créées par cet ajout, puis la zone si l'ajout l'a créée et qu'elle est
vide. On ne retire jamais une ligne depuis laquelle un log est parti.

Le drapeau d'annulation vit en mémoire : le backend est un processus unique, et un
ajout interrompu par un redémarrage reste annulable par son journal.
"""
from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from typing import Iterable, Optional

from ..database import db
from ..models import AppConfig, GpsZoneOperation, GpsZoneOperationItem, Zone
from .zone_membership import ACTION_COPIED, ACTION_CREATED, remove_geocache_row

logger = logging.getLogger(__name__)

_cancel_requested: set[str] = set()
_lock = threading.Lock()


def start(operation_id: str, zone_id: int, *, zone_created: bool, days: Iterable[str]) -> GpsZoneOperation:
    operation = GpsZoneOperation(
        id=operation_id, zone_id=zone_id, zone_created=zone_created,
        state='running', days=json.dumps(sorted(set(days))),
    )
    db.session.add(operation)
    db.session.commit()
    return operation


def get(operation_id: str) -> Optional[GpsZoneOperation]:
    return db.session.get(GpsZoneOperation, operation_id)


def request_cancel(operation_id: str) -> None:
    with _lock:
        _cancel_requested.add(operation_id)


def cancel_requested(operation_id: str) -> bool:
    with _lock:
        return operation_id in _cancel_requested


def _forget_cancel(operation_id: str) -> None:
    with _lock:
        _cancel_requested.discard(operation_id)


def record(operation: GpsZoneOperation, gc_code: str, geocache_id: Optional[int], action: str) -> None:
    db.session.add(GpsZoneOperationItem(
        operation_id=operation.id, gc_code=gc_code, geocache_id=geocache_id, action=action,
    ))
    db.session.commit()


def finish(operation: GpsZoneOperation, state: str) -> None:
    operation.state = state
    operation.finished_at = datetime.now(timezone.utc)
    db.session.commit()
    _forget_cancel(operation.id)


def _added_items(operation: GpsZoneOperation) -> list[GpsZoneOperationItem]:
    return [item for item in operation.items if item.action in (ACTION_COPIED, ACTION_CREATED) and item.geocache_id]


def undo_refusal(operation: GpsZoneOperation) -> Optional[str]:
    """Raison de refuser l'annulation, ou ``None`` si elle est possible."""
    from ..geocaches.models import Geocache, GeocacheLog

    if operation.state == 'cancelled':
        return 'Cet ajout est déjà annulé.'
    ids = [item.geocache_id for item in _added_items(operation)]
    if not ids:
        return None
    logged = db.session.query(Geocache.gc_code).join(GeocacheLog, GeocacheLog.geocache_id == Geocache.id).filter(
        Geocache.id.in_(ids), GeocacheLog.is_own_log.is_(True),
    ).distinct().all()
    if logged:
        codes = ', '.join(code for (code,) in logged[:5])
        return f'Un log est déjà parti depuis la zone de la sortie ({codes}) : on ne retire pas une cache loguée.'
    return None


def undo(operation: GpsZoneOperation) -> dict:
    """Retire les lignes copiées ou créées par l'ajout, puis la zone si elle a été créée et qu'elle est vide."""
    from ..geocaches.models import Geocache

    removed = 0
    for item in reversed(_added_items(operation)):
        if remove_geocache_row(item.geocache_id):
            removed += 1
    zone_removed = None
    if operation.zone_created:
        zone = db.session.get(Zone, operation.zone_id)
        if zone is not None and Geocache.query.filter_by(zone_id=zone.id).count() == 0:
            zone_removed = zone.name
            if AppConfig.get_value('active_zone_id') == str(zone.id):
                AppConfig.set_value('active_zone_id', None)
            db.session.delete(zone)
            db.session.commit()
    _forget_day_zones(operation)
    finish(operation, 'cancelled')
    logger.info('Ajout %s annulé : %d ligne(s) retirée(s), zone retirée : %s', operation.id, removed, zone_removed)
    message = f'Annulé : {removed} cache(s) retirée(s) de la zone'
    if zone_removed:
        message += f', zone « {zone_removed} » supprimée'
    return {'removed': removed, 'zone_removed': zone_removed, 'message': message + '.'}


# ------------------------------------------------------------ zone d'un jour

DAY_ZONES_KEY = 'gps_visits.day_zones'


def get_day_zones() -> dict[str, int]:
    raw = AppConfig.get_value(DAY_ZONES_KEY)
    try:
        data = json.loads(raw) if raw else {}
    except ValueError:
        return {}
    return {day: int(zone) for day, zone in data.items() if isinstance(zone, int) or str(zone).isdigit()}


def set_day_zones(days: Iterable[str], zone_id: int) -> None:
    zones = get_day_zones()
    for day in days:
        zones[day] = zone_id
    AppConfig.set_value(DAY_ZONES_KEY, json.dumps(zones))
    db.session.commit()


def _forget_day_zones(operation: GpsZoneOperation) -> None:
    """Un ajout annulé ne laisse pas sa zone comme suggestion pour ses jours."""
    zones = get_day_zones()
    days = json.loads(operation.days) if operation.days else []
    changed = False
    for day in days:
        if zones.get(day) == operation.zone_id:
            del zones[day]
            changed = True
    if changed:
        AppConfig.set_value(DAY_ZONES_KEY, json.dumps(zones))
        db.session.commit()
