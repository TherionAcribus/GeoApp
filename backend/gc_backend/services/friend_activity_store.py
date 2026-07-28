"""
Persistance incrémentale du flux d'activité des amis.

Le flux distant est plafonné (~100 entrées) : au lieu de le réinterroger sur de
grandes fenêtres, on synchronise régulièrement de petites fenêtres et on
accumule ici. La déduplication se fait sur `log_reference_code` (GLxxxxx), qui
est stable même si l'ami modifie son log.

Séparation volontaire : `geocaching_friend_activity.py` fait le réseau et le
parsing (testable sans base), ce module fait la base (testable sans réseau).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

from ..database import db
from ..geocaches.models import Geocache
from ..models import AppConfig, FriendActivity
from .geocaching_friend_activity import ACTIVITY_TYPE_FRIENDS, FriendActivityItem

logger = logging.getLogger(__name__)


LAST_SYNC_KEY = 'friends.activity.last_sync_at'

# Garde-fou de lecture pour la carte : le flux accumulé reste modeste (quelques
# milliers de lignes), mais on refuse de charger la table entière en mémoire si
# elle venait à grossir.
MAX_SCANNED_ROWS = 20000

# Champs recopiés tels quels de l'item vers la ligne (même nom des deux côtés).
_MIRRORED_FIELDS = (
    'author_username', 'author_reference_code', 'author_avatar_url',
    'log_type_id', 'note',
    'cache_name', 'cache_reference_code', 'cache_type_id', 'container_type_id',
    'difficulty', 'terrain',
    'favorite_points', 'image_count',
    'is_premium', 'is_archived', 'is_favorited',
    'latitude', 'longitude', 'location_name',
    'is_condensed', 'condensed_count', 'action_url',
)


@dataclass
class SyncReport:
    """Bilan d'une synchronisation."""
    fetched: int
    created: int
    updated: int
    since_days: int
    synced_at: datetime

    def to_dict(self) -> dict:
        return {
            'fetched': self.fetched,
            'created': self.created,
            'updated': self.updated,
            'since_days': self.since_days,
            'synced_at': self.synced_at.isoformat(),
        }


def store_items(
    items: Iterable[FriendActivityItem],
    activity_type: int = ACTIVITY_TYPE_FRIENDS,
    self_username: Optional[str] = None,
) -> tuple[int, int]:
    """
    Insère ou met à jour les entrées. Retourne (créées, mises à jour).

    Une entrée déjà connue est rafraîchie (l'ami a pu éditer son log) et son
    `last_seen_at` réarmé ; `first_seen_at` n'est jamais touché.

    `self_username` sert à marquer les logs de l'utilisateur connecté, que le
    flux « communauté » de geocaching.com mélange avec ceux des amis.
    """
    items = list(items)
    if not items:
        return 0, 0

    codes = [item.log_reference_code for item in items]
    existing = {
        row.log_reference_code: row
        for row in FriendActivity.query.filter(FriendActivity.log_reference_code.in_(codes)).all()
    }

    created = 0
    updated = 0
    now = datetime.now(timezone.utc)

    for item in items:
        row = existing.get(item.log_reference_code)
        if row is None:
            row = FriendActivity(
                log_reference_code=item.log_reference_code,
                activity_type=activity_type,
                first_seen_at=now,
            )
            db.session.add(row)
            created += 1
        else:
            updated += 1

        for field in _MIRRORED_FIELDS:
            setattr(row, field, getattr(item, field))
        row.log_date = _parse_iso(item.log_date)
        row.created_date = _parse_iso(item.created_date)
        row.is_self = bool(self_username) and item.author_username == self_username
        row.last_seen_at = now

    db.session.commit()
    logger.info("Friend activity stored: %d created, %d updated", created, updated)
    return created, updated


def sync(
    since_days: int = 7,
    activity_type: int = ACTIVITY_TYPE_FRIENDS,
    client=None,
) -> SyncReport:
    """Récupère le flux distant et l'accumule en base."""
    from .geocaching_friend_activity import get_friend_activity_client

    client = client or get_friend_activity_client()
    self_username = _get_self_username()
    items = client.fetch(since_days=since_days, activity_type=activity_type)
    created, updated = store_items(
        items,
        activity_type=activity_type,
        self_username=self_username,
    )
    _backfill_self_flags(self_username)

    synced_at = datetime.now(timezone.utc)
    AppConfig.set_value(LAST_SYNC_KEY, synced_at.isoformat())
    db.session.commit()

    return SyncReport(
        fetched=len(items),
        created=created,
        updated=updated,
        since_days=since_days,
        synced_at=synced_at,
    )


def query_activities(
    limit: int = 50,
    offset: int = 0,
    author: Optional[str] = None,
    log_type_ids: Optional[Iterable[int]] = None,
    activity_type: int = ACTIVITY_TYPE_FRIENDS,
    include_self: bool = False,
) -> tuple[list[FriendActivity], int]:
    """Lit le flux stocké, du plus récent au plus ancien. Retourne (lignes, total filtré)."""
    query = _filtered_query(
        author=author,
        log_type_ids=log_type_ids,
        activity_type=activity_type,
        include_self=include_self,
    )

    total = query.count()
    rows = (
        query.order_by(FriendActivity.log_date.desc(), FriendActivity.id.desc())
        .limit(max(1, min(limit, 200)))
        .offset(max(0, offset))
        .all()
    )
    return rows, total


def query_map_points(
    author: Optional[str] = None,
    log_type_ids: Optional[Iterable[int]] = None,
    activity_type: int = ACTIVITY_TYPE_FRIENDS,
    include_self: bool = False,
    days: Optional[int] = None,
    limit: int = 2000,
) -> dict:
    """
    Agrège le flux stocké en points cartographiables. Aucune requête réseau.

    Les filtres sont **exactement** ceux de `query_activities()` (via
    `_filtered_query`), pour que la carte montre toujours la même chose que la
    timeline ; s'y ajoute seulement la fenêtre `days`.

    Contrairement à la lecture paginée, on renvoie **tous** les points
    correspondant aux filtres : une carte tronquée à 50 points serait trompeuse.
    `limit` n'est qu'un garde-fou, signalé par `truncated`.

    Trois traitements, dans cet ordre : dédoublonnage par cache (plusieurs amis
    sur la même cache = un point), jointure avec les géocaches importées, et
    traduction de `cache_type_id` en nom lisible.
    """
    query = _filtered_query(
        author=author,
        log_type_ids=log_type_ids,
        activity_type=activity_type,
        include_self=include_self,
    )

    if days is not None:
        since = datetime.now(timezone.utc) - timedelta(days=max(0, days))
        # Les dates sont stockées naïves (cf. _parse_iso) : on compare en naïf.
        query = query.filter(FriendActivity.log_date >= since.replace(tzinfo=None))

    # Une entrée sans coordonnées n'est pas plaçable. C'est censé être rarissime
    # (un log est toujours attaché à une cache) : on la compte plutôt que de la
    # passer sous silence, pour repérer une évolution du flux distant.
    without_coordinates = query.filter(
        db.or_(FriendActivity.latitude.is_(None), FriendActivity.longitude.is_(None))
    ).count()

    rows = (
        query
        .filter(FriendActivity.latitude.isnot(None), FriendActivity.longitude.isnot(None))
        .order_by(FriendActivity.log_date.desc(), FriendActivity.id.desc())
        .limit(MAX_SCANNED_ROWS)
        .all()
    )

    points = _group_rows_by_cache(rows)
    _attach_imported_geocaches(points)

    total = len(points)
    limit = max(1, min(limit, 5000))
    truncated = total > limit

    return {
        'points': points[:limit],
        'total': total,
        'returned': min(total, limit),
        'without_coordinates': without_coordinates,
        'truncated': truncated,
    }


def _group_rows_by_cache(rows: list[FriendActivity]) -> list[dict]:
    """
    Un point par cache, les auteurs agrégés. `rows` est déjà trié du plus récent
    au plus ancien : le premier log rencontré donne les métadonnées du point et
    sa date la plus récente.
    """
    points: dict[str, dict] = {}

    for row in rows:
        # Sans code GC, impossible de dédoublonner ni de rejoindre une cache
        # importée : on retombe sur le code du log, qui est unique par nature.
        key = row.cache_reference_code or f'GL:{row.log_reference_code}'
        point = points.get(key)

        if point is None:
            point = {
                'gc_code': row.cache_reference_code,
                'name': row.cache_name,
                'cache_type': _cache_type_label(row.cache_type_id),
                'latitude': row.latitude,
                'longitude': row.longitude,
                'difficulty': row.difficulty,
                'terrain': row.terrain,
                'geocache_id': 0,
                'found': False,
                'friends': [],
                'last_log_date': None,
            }
            points[key] = point

        point['friends'].append({
            'username': row.author_username,
            'log_type_id': row.log_type_id,
            'log_date': row.log_date.isoformat() if row.log_date else None,
            'is_self': bool(row.is_self),
        })
        if point['last_log_date'] is None and row.log_date:
            point['last_log_date'] = row.log_date.isoformat()

    return list(points.values())


def _cache_type_label(cache_type_id: Optional[int]) -> str | None:
    """
    Traduit un `cacheTypeId` du flux en type lisible.

    On privilégie le vocabulaire du **scraper** (« Mega-Event », « Earthcache »,
    « Letterbox Hybrid »…) : c'est celui que porte `Geocache.type` et sur lequel
    la table d'icônes du frontend est calée. Le vocabulaire de la recherche web
    ne sert que de repli, pour les types que le scraper ne connaît pas (APE,
    GPS Adventures, célébrations HQ…). Un id inconnu donne `None`, ce qui
    déclenche l'icône générique — jamais une erreur.
    """
    if cache_type_id is None:
        return None

    from ..geocaches.scraper import GEOCACHING_CACHE_TYPE_ID_MAP
    from ..geocaches.search_client import GeocachingSearchClient

    return (
        GEOCACHING_CACHE_TYPE_ID_MAP.get(str(cache_type_id))
        or GeocachingSearchClient.GEOCACHE_TYPE_MAP.get(cache_type_id)
    )


def _attach_imported_geocaches(points: list[dict]) -> None:
    """
    Renseigne `geocache_id` et `found` pour les caches déjà importées dans GeoApp.

    C'est ce qui permet à la carte d'ouvrir la fiche d'un clic quand la cache est
    connue, et de distinguer visuellement « déjà chez moi » de « pas encore ».
    Les autres gardent `geocache_id = 0` ; le frontend leur attribue un id
    négatif unique (les features OpenLayers sont indexées par id).
    """
    codes = {point['gc_code'] for point in points if point['gc_code']}
    if not codes:
        return

    known = {
        gc_code: (geocache_id, found)
        for gc_code, geocache_id, found in db.session.query(
            Geocache.gc_code, Geocache.id, Geocache.found
        ).filter(Geocache.gc_code.in_(codes)).all()
    }

    for point in points:
        match = known.get(point['gc_code'])
        if match:
            point['geocache_id'], found = match
            point['found'] = bool(found)


def _filtered_query(
    author: Optional[str] = None,
    log_type_ids: Optional[Iterable[int]] = None,
    activity_type: int = ACTIVITY_TYPE_FRIENDS,
    include_self: bool = False,
):
    """Filtres communs à la timeline et à la carte : les deux doivent coïncider."""
    query = FriendActivity.query.filter(FriendActivity.activity_type == activity_type)

    if not include_self:
        query = query.filter(db.or_(FriendActivity.is_self.is_(False), FriendActivity.is_self.is_(None)))

    if author:
        query = query.filter(FriendActivity.author_username == author)

    log_type_ids = list(log_type_ids or [])
    if log_type_ids:
        query = query.filter(FriendActivity.log_type_id.in_(log_type_ids))

    return query


def list_authors(
    activity_type: int = ACTIVITY_TYPE_FRIENDS,
    include_self: bool = False,
) -> list[dict]:
    """Amis présents dans le flux stocké, avec leur nombre d'entrées (pour le filtre)."""
    query = db.session.query(
        FriendActivity.author_username,
        db.func.count(FriendActivity.id),
    ).filter(FriendActivity.activity_type == activity_type)

    if not include_self:
        query = query.filter(db.or_(FriendActivity.is_self.is_(False), FriendActivity.is_self.is_(None)))

    rows = (
        query
        .group_by(FriendActivity.author_username)
        .order_by(db.func.count(FriendActivity.id).desc())
        .all()
    )
    return [{'username': username, 'count': count} for username, count in rows]


def get_last_sync_at() -> str | None:
    return AppConfig.get_value(LAST_SYNC_KEY)


def _backfill_self_flags(self_username: Optional[str]) -> None:
    """
    Renseigne `is_self` sur les lignes qui l'ignorent encore.

    Concerne les entrées stockées avant l'ajout de la colonne, et celles qui
    sortent de la fenêtre distante (donc jamais réécrites par une synchro).
    """
    if not self_username:
        return

    updated = (
        db.session.query(FriendActivity)
        .filter(FriendActivity.is_self.is_(None))
        .update(
            {'is_self': FriendActivity.author_username == self_username},
            synchronize_session=False,
        )
    )
    if updated:
        db.session.commit()
        logger.info("Backfilled is_self on %d friend activity rows", updated)


def _get_self_username() -> str | None:
    """Pseudo de l'utilisateur connecté, sans requête réseau supplémentaire."""
    from .geocaching_auth import get_auth_service

    user_info = get_auth_service().get_auth_state().user_info
    return getattr(user_info, 'username', None)


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        logger.debug("Unparsable stored date: %r", value)
        return None
