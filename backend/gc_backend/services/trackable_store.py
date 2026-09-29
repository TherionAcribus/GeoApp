"""
Persistance locale des trackables.

`geocaching_trackables.py` fait le réseau et le parsing (testable sans base), ce
module fait la base (testable sans réseau).

Règles de fusion :
- un relevé ne vide jamais un champ connu avec une valeur absente : l'inventaire
  d'une cache ne donne ni propriétaire ni code de suivi, et ne doit pas effacer
  ce que mon inventaire en avait appris ;
- le code de suivi n'est remplacé que par un autre code non vide ;
- la localisation suit un tri-état (`TrackableSummary.location_known`) : une source
  qui ne dit rien la laisse intacte, une source affirmative peut la vider
  (p. ex. fiche complète avec `currentGeocache: null`, ou relevé d'une cache où
  le TB a disparu).
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
    created: int      # lignes nouvelles en base
    updated: int
    removed: int      # TBs sortis de l'inventaire
    synced_at: datetime
    # TBs entrés dans l'inventaire, nouveaux en base ou non (un TB déposé puis repris
    # existe déjà : il n'est pas « créé », mais il revient bien dans la liste).
    added: int = 0

    def to_dict(self) -> dict:
        return {
            'fetched': self.fetched,
            'created': self.created,
            'updated': self.updated,
            'added': self.added,
            'removed': self.removed,
            'synced_at': self.synced_at.isoformat(),
        }


def _merge_summary(row: Trackable, summary: TrackableSummary) -> None:
    """Recopie un résumé dans une ligne selon les règles de fusion. Aucune requête."""
    values: dict = {}
    _merge_into_values(values, summary)
    for name, value in values.items():
        setattr(row, name, value)


def _merge_into_values(values: dict, summary: TrackableSummary) -> None:
    """Mêmes règles de fusion, sur un dictionnaire de colonnes (voie bulk)."""
    for name in _OPTIONAL_FIELDS:
        value = getattr(summary, name)
        if value is not None:
            values[name] = value
    for name in _FLAG_FIELDS:
        values[name] = bool(getattr(summary, name))
    if summary.tracking_code:
        values['tracking_code'] = normalize_code(summary.tracking_code)
    if summary.location_known:
        # La source affirme la localisation : une valeur vide veut dire « plus
        # dans une cache », pas « champ inconnu ».
        values['current_geocache_code'] = normalize_code(summary.current_geocache_code) or None
        values['current_geocache_name'] = summary.current_geocache_name if values['current_geocache_code'] else None


def _new_row_values(code: str, now: datetime) -> dict:
    """Base d'une ligne nouvelle : les défauts ORM ne jouent pas en insert groupé."""
    return {
        'reference_code': code,
        'brand': 'gc',
        'in_my_inventory': False,
        'is_missing': False,
        'is_active': True,
        'is_locked': False,
        'allowed_to_be_collected': False,
        'created_at': now,
        'updated_at': now,
    }


def _get_or_create(code: str, by_code: dict[str, Trackable]) -> tuple[Trackable, bool]:
    """Ligne du dictionnaire préchargé, ou nouvelle ligne ajoutée. Aucune requête."""
    row = by_code.get(code)
    if row is not None:
        return row, False
    row = Trackable(reference_code=code, brand='gc')
    db.session.add(row)
    by_code[code] = row
    return row, True


# Sous la limite SQLITE_MAX_VARIABLE_NUMBER des vieilles bases : les codes sont
# préchargés par paquets — le nombre de requêtes reste borné, jamais par TB.
_PRELOAD_CHUNK = 500


def _preload_trackables(codes: Iterable[str]) -> dict[str, Trackable]:
    """Toutes les lignes déjà en base pour ces codes, en quelques requêtes fixes."""
    codes = list(dict.fromkeys(codes))
    by_code: dict[str, Trackable] = {}
    for start in range(0, len(codes), _PRELOAD_CHUNK):
        chunk = codes[start:start + _PRELOAD_CHUNK]
        for row in Trackable.query.filter(Trackable.reference_code.in_(chunk)).all():
            by_code[row.reference_code] = row
    return by_code


def upsert_trackable(summary: TrackableSummary) -> tuple[Trackable, bool]:
    """Insère ou met à jour un TB. Retourne (ligne, créée ?). Ne commite pas."""
    code = normalize_code(summary.reference_code)
    row, created = _get_or_create(code, _preload_trackables([code]))
    _merge_summary(row, summary)
    return row, created


def save_my_inventory(items: Iterable[TrackableSummary]) -> InventorySyncReport:
    """
    Remplace mon inventaire local par le relevé : les TBs relevés y entrent, ceux qui
    n'y sont plus en sortent (déposés ou pris par quelqu'un d'autre entre-temps).

    Une seule transaction, un coût borné en requêtes : préchargement par paquets,
    fusion en mémoire sur dictionnaires, puis INSERT/UPDATE groupés (`executemany`)
    — le nombre d'ordres SQL ne dépend pas du nombre de TBs.
    """
    items = list(items)
    try:
        now = datetime.now(timezone.utc)
        by_code = _preload_trackables(normalize_code(s.reference_code) for s in items)

        inserts: dict[str, dict] = {}
        updates: dict[str, dict] = {}
        created = updated = added = 0
        for summary in items:
            code = normalize_code(summary.reference_code)
            row = by_code.get(code)
            if code in inserts or code in updates:
                values = inserts.get(code) or updates[code]
                is_new = False
            elif row is not None:
                values = updates[code] = {'id': row.id}
                is_new = False
            else:
                values = inserts[code] = _new_row_values(code, now)
                is_new = True

            # « Entré » = la ligne n'était pas en inventaire avant ce relevé
            # (un doublon dans le relevé ne compte qu'une fois).
            in_before = values.get('in_my_inventory', row.in_my_inventory if row else False)
            added += int(not in_before)
            created += int(is_new)
            updated += int(not is_new)

            _merge_into_values(values, summary)
            values['updated_at'] = now
            values['in_my_inventory'] = True
            # Un TB en main n'est plus dans une cache.
            values['current_geocache_code'] = None
            values['current_geocache_name'] = None

        if inserts:
            db.session.execute(Trackable.__table__.insert(), list(inserts.values()))
        if updates:
            db.session.bulk_update_mappings(Trackable, list(updates.values()))

        # Sortie d'inventaire des absents du relevé : un UPDATE groupé. Les codes
        # sont paquetés en filtres `NOT IN` combinés par AND (limite de variables).
        seen = list(dict.fromkeys(normalize_code(s.reference_code) for s in items))
        stale = Trackable.query.filter_by(in_my_inventory=True)
        for start in range(0, len(seen), _PRELOAD_CHUNK):
            stale = stale.filter(~Trackable.reference_code.in_(seen[start:start + _PRELOAD_CHUNK]))
        removed = stale.update({'in_my_inventory': False}, synchronize_session=False)

        synced_at = datetime.now(timezone.utc)
        AppConfig.set_value(INVENTORY_LAST_SYNC_KEY, synced_at.isoformat())
        db.session.commit()
        return InventorySyncReport(len(items), created, updated, removed, synced_at, added)
    except Exception:
        db.session.rollback()
        raise


def list_my_inventory() -> list[Trackable]:
    return (
        Trackable.query.filter_by(in_my_inventory=True)
        .order_by(db.func.lower(Trackable.name), Trackable.reference_code)
        .all()
    )


def inventory_codes() -> set[str]:
    """Codes publics des TBs actuellement marqués « en main » dans la base locale."""
    return {
        code for (code,) in
        Trackable.query.with_entities(Trackable.reference_code).filter_by(in_my_inventory=True).all()
    }


def inventory_last_sync_at() -> Optional[str]:
    return AppConfig.get_value(INVENTORY_LAST_SYNC_KEY)


def save_cache_inventory(gc_code: str, items: Iterable[TrackableSummary]) -> list[Trackable]:
    """
    Remplace les TBs connus dans une cache par le relevé. Retourne les lignes, dans l'ordre.

    Le relevé fait foi pour la localisation : un TB qui n'y figure plus perd la
    cache comme localisation courante, même sans relation `GeocacheTrackable`
    restante (p. ex. position apprise par une fiche complète).

    Une seule transaction, un coût borné en requêtes : préchargement par paquets,
    fusion en mémoire, INSERT/UPDATE groupés, relations recréées en un seul
    `executemany`.
    """
    gc_code = normalize_code(gc_code)
    now = datetime.now(timezone.utc)
    items = list(items)
    try:
        GeocacheTrackable.query.filter_by(gc_code=gc_code).delete()
        by_code = _preload_trackables(normalize_code(s.reference_code) for s in items)

        inserts: dict[str, dict] = {}
        updates: dict[str, dict] = {}
        seen: list[str] = []
        seen_set: set[str] = set()
        for summary in items:
            code = normalize_code(summary.reference_code)
            row = by_code.get(code)
            # Le relevé affirme la localisation : le TB est dans cette cache.
            summary.current_geocache_code = summary.current_geocache_code or gc_code
            summary.location_known = True
            if code in inserts or code in updates:
                values = inserts.get(code) or updates[code]
            elif row is not None:
                values = updates[code] = {'id': row.id}
            else:
                values = inserts[code] = _new_row_values(code, now)
            _merge_into_values(values, summary)
            values['updated_at'] = now
            values['in_my_inventory'] = False
            if code not in seen_set:
                seen_set.add(code)
                seen.append(code)

        if inserts:
            db.session.execute(Trackable.__table__.insert(), list(inserts.values()))
        if updates:
            db.session.bulk_update_mappings(Trackable, list(updates.values()))
        if seen:
            db.session.execute(
                GeocacheTrackable.__table__.insert(),
                [{'gc_code': gc_code, 'trackable_code': code, 'seen_at': now} for code in seen],
            )

        # TBs partis de la cache : localisation vidée en un UPDATE groupé
        # (`NOT IN` paqueté en filtres AND, comme pour l'inventaire).
        departed = Trackable.query.filter_by(current_geocache_code=gc_code)
        for start in range(0, len(seen), _PRELOAD_CHUNK):
            departed = departed.filter(~Trackable.reference_code.in_(seen[start:start + _PRELOAD_CHUNK]))
        departed.update(
            {'current_geocache_code': None, 'current_geocache_name': None},
            synchronize_session=False,
        )

        AppConfig.set_value(_cache_sync_key(gc_code), now.isoformat())
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise

    # Les lignes sont relues après commit : la voie bulk ne peuple pas l'ORM.
    order = {code: index for index, code in enumerate(seen)}
    rows = [by_code.get(code) for code in seen]
    missing = [code for code, row in zip(seen, rows) if row is None]
    if missing:
        fresh = _preload_trackables(missing)
        for index, code in enumerate(seen):
            if rows[index] is None:
                rows[index] = fresh[code]
    return sorted((row for row in rows if row is not None), key=lambda row: order[row.reference_code])


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


def apply_cache_log_trackable_actions(gc_code: str, actions: dict[str, str]) -> None:
    """
    Reporte en base un log de cache accepté par Geocaching.com : l'action de chaque TB
    est mémorisée, et un TB déposé quitte mon inventaire pour la cache.
    """
    gc_code = normalize_code(gc_code)
    now = datetime.now(timezone.utc)
    valid = {normalize_code(code): action for code, action in actions.items() if action in CACHE_LOG_ACTIONS}
    if not valid:
        return
    try:
        by_code = _preload_trackables(valid.keys())
        inserts: list[dict] = []
        updates: list[dict] = []
        dropped: list[str] = []
        for code, action in valid.items():
            row = by_code.get(code)
            if row is None:
                values = _new_row_values(code, now)
                values['last_cache_log_action'] = action
                values['last_cache_log_action_at'] = now
            else:
                values = {
                    'id': row.id,
                    'last_cache_log_action': action,
                    'last_cache_log_action_at': now,
                    'updated_at': now,
                }
            if action == 'drop':
                values['in_my_inventory'] = False
                values['current_geocache_code'] = gc_code
                values['current_geocache_name'] = None
                dropped.append(code)
            (inserts if row is None else updates).append(values)

        if inserts:
            db.session.execute(Trackable.__table__.insert(), inserts)
        if updates:
            db.session.bulk_update_mappings(Trackable, updates)
        if dropped:
            _place_all_in_geocache(dropped, gc_code, now)
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise


def apply_trackable_log(
    tb_code: str,
    log_type_id: int,
    *,
    tracking_code: Optional[str] = None,
) -> Trackable:
    """
    Reporte en base un log de trackable accepté par Geocaching.com.

    Retiré (13) ou pris ailleurs (19) : le TB entre dans mon inventaire et sort de sa
    cache. Déplacé vers la collection (69) : il sort de l'inventaire. Un code de suivi
    accepté par le site est gardé, pour les logs suivants.
    """
    from .geocaching_trackables import TrackableLogType

    code = normalize_code(tb_code)
    row = Trackable.query.filter_by(reference_code=code).one_or_none()
    if row is None:
        row = Trackable(reference_code=code, brand='gc')
        db.session.add(row)
    if tracking_code:
        row.tracking_code = normalize_code(tracking_code)

    if log_type_id in (TrackableLogType.RETRIEVED, TrackableLogType.GRABBED, TrackableLogType.MOVE_TO_INVENTORY):
        row.in_my_inventory = True
        row.current_geocache_code = None
        row.current_geocache_name = None
        GeocacheTrackable.query.filter_by(trackable_code=code).delete()
    elif log_type_id == TrackableLogType.MOVE_TO_COLLECTION:
        row.in_my_inventory = False
    db.session.commit()
    return row


def _place_all_in_geocache(tb_codes: list[str], gc_code: str, now: datetime) -> None:
    """
    Des TBs déposés dans cette cache : un TB n'est que dans une cache à la fois,
    on efface leur présence ailleurs puis on insère les relations manquantes —
    deux requêtes quel que soit le nombre de TBs.
    """
    # Paqueté sous la limite de variables : chaque paquet supprime sa propre part.
    for start in range(0, len(tb_codes), _PRELOAD_CHUNK):
        chunk = tb_codes[start:start + _PRELOAD_CHUNK]
        GeocacheTrackable.query.filter(
            GeocacheTrackable.trackable_code.in_(chunk),
            GeocacheTrackable.gc_code != gc_code,
        ).delete(synchronize_session=False)
    already = {
        code for (code,) in GeocacheTrackable.query
        .with_entities(GeocacheTrackable.trackable_code)
        .filter_by(gc_code=gc_code)
        .filter(GeocacheTrackable.trackable_code.in_(tb_codes))
        .all()
    }
    missing = [{'gc_code': gc_code, 'trackable_code': code, 'seen_at': now}
               for code in tb_codes if code not in already]
    if missing:
        db.session.execute(GeocacheTrackable.__table__.insert(), missing)


def cache_inventory_synced_at(gc_code: str) -> Optional[str]:
    return AppConfig.get_value(_cache_sync_key(gc_code))


def _cache_sync_key(gc_code: str) -> str:
    return f'trackables.cache.{normalize_code(gc_code)}.synced_at'
