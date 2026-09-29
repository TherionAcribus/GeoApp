"""
Persistance locale des trackables.

`geocaching_trackables.py` fait le réseau et le parsing (testable sans base), ce
module fait la base (testable sans réseau).

Règles de fusion :
- un relevé ne vide jamais un champ connu avec une valeur absente : l'inventaire
  d'une cache ne donne ni propriétaire ni code de suivi, et ne doit pas effacer
  ce que mon inventaire en avait appris ;
- le code de suivi n'est remplacé que par un autre code non vide.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, Optional

from ..database import db
from ..models import AppConfig, GeocacheTrackable, Trackable
from .geocaching_trackables import TrackableSummary, normalize_code

logger = logging.getLogger(__name__)

INVENTORY_LAST_SYNC_KEY = 'trackables.inventory.last_sync_at'

# Actions possibles pour un TB de mon inventaire lors d'un log de cache.
CACHE_LOG_ACTIONS = ('none', 'visit', 'drop')

# Champs recopiés du relevé vers la ligne, seulement s'ils sont renseignés.
_OPTIONAL_FIELDS = (
    'name', 'icon_url', 'type_id', 'type_name',
    'owner_username', 'owner_reference_code', 'holder_username',
    'goal_html', 'released_at', 'origin', 'distance_km',
)
# Drapeaux toujours fournis par les API : recopiés tels quels.
_FLAG_FIELDS = ('is_missing', 'is_active', 'is_locked', 'allowed_to_be_collected')


@dataclass
class InventorySyncReport:
    fetched: int
    created: int
    updated: int
    removed: int
    synced_at: datetime

    def to_dict(self) -> dict:
        return {
            'fetched': self.fetched,
            'created': self.created,
            'updated': self.updated,
            'removed': self.removed,
            'synced_at': self.synced_at.isoformat(),
        }


def upsert_trackable(summary: TrackableSummary) -> tuple[Trackable, bool]:
    """Insère ou met à jour un TB. Retourne (ligne, créée ?). Ne commite pas."""
    code = normalize_code(summary.reference_code)
    row = Trackable.query.filter_by(reference_code=code).one_or_none()
    created = row is None
    if created:
        row = Trackable(reference_code=code, brand='gc')
        db.session.add(row)

    for name in _OPTIONAL_FIELDS:
        value = getattr(summary, name)
        if value is not None:
            setattr(row, name, value)
    for name in _FLAG_FIELDS:
        setattr(row, name, bool(getattr(summary, name)))
    if summary.tracking_code:
        row.tracking_code = normalize_code(summary.tracking_code)
    if summary.current_geocache_code:
        row.current_geocache_code = normalize_code(summary.current_geocache_code)
        row.current_geocache_name = summary.current_geocache_name
    return row, created


def save_my_inventory(items: Iterable[TrackableSummary]) -> InventorySyncReport:
    """
    Remplace mon inventaire local par le relevé : les TBs relevés y entrent, ceux qui
    n'y sont plus en sortent (déposés ou pris par quelqu'un d'autre entre-temps).
    """
    items = list(items)
    created = updated = 0
    seen: set[str] = set()
    for summary in items:
        row, is_new = upsert_trackable(summary)
        row.in_my_inventory = True
        # Un TB en main n'est plus dans une cache.
        row.current_geocache_code = None
        row.current_geocache_name = None
        seen.add(row.reference_code)
        created += int(is_new)
        updated += int(not is_new)

    removed = 0
    for row in Trackable.query.filter_by(in_my_inventory=True).all():
        if row.reference_code not in seen:
            row.in_my_inventory = False
            removed += 1

    synced_at = datetime.now(timezone.utc)
    AppConfig.set_value(INVENTORY_LAST_SYNC_KEY, synced_at.isoformat())
    db.session.commit()
    return InventorySyncReport(len(items), created, updated, removed, synced_at)


def list_my_inventory() -> list[Trackable]:
    return (
        Trackable.query.filter_by(in_my_inventory=True)
        .order_by(db.func.lower(Trackable.name), Trackable.reference_code)
        .all()
    )


def inventory_last_sync_at() -> Optional[str]:
    return AppConfig.get_value(INVENTORY_LAST_SYNC_KEY)


def save_cache_inventory(gc_code: str, items: Iterable[TrackableSummary]) -> list[Trackable]:
    """Remplace les TBs connus dans une cache par le relevé. Retourne les lignes, dans l'ordre."""
    gc_code = normalize_code(gc_code)
    now = datetime.now(timezone.utc)
    GeocacheTrackable.query.filter_by(gc_code=gc_code).delete()

    rows: list[Trackable] = []
    for summary in items:
        summary.current_geocache_code = summary.current_geocache_code or gc_code
        row, _ = upsert_trackable(summary)
        row.in_my_inventory = False
        if row.reference_code in {r.reference_code for r in rows}:
            continue
        db.session.add(GeocacheTrackable(gc_code=gc_code, trackable_code=row.reference_code, seen_at=now))
        rows.append(row)
    db.session.commit()
    return rows


def list_cache_inventory(gc_code: str) -> list[Trackable]:
    gc_code = normalize_code(gc_code)
    return (
        Trackable.query.join(GeocacheTrackable, GeocacheTrackable.trackable_code == Trackable.reference_code)
        .filter(GeocacheTrackable.gc_code == gc_code)
        .order_by(db.func.lower(Trackable.name), Trackable.reference_code)
        .all()
    )


def get_tracking_code(tb_code: str) -> Optional[str]:
    row = Trackable.query.filter_by(reference_code=normalize_code(tb_code)).one_or_none()
    return row.tracking_code if row is not None else None


def remember_cache_log_actions(actions: dict[str, str]) -> None:
    """Mémorise l'action choisie par TB au dernier log de cache (défaut du log suivant)."""
    now = datetime.now(timezone.utc)
    for code, action in actions.items():
        if action not in CACHE_LOG_ACTIONS:
            continue
        row = Trackable.query.filter_by(reference_code=normalize_code(code)).one_or_none()
        if row is None:
            continue
        row.last_cache_log_action = action
        row.last_cache_log_action_at = now
    db.session.commit()
