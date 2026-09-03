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
LAST_PROJECTION_KEY = 'friends.activity.last_projection_at'

# « a trouvé » dans window.logFormats. Seul ce type alimente `friend_find`.
FOUND_LOG_TYPE_ID = 2

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
    #  Trouvailles du flux reportées dans `friend_find` (voir project_finds()).
    finds_projected: int = 0

    def to_dict(self) -> dict:
        return {
            'fetched': self.fetched,
            'created': self.created,
            'updated': self.updated,
            'since_days': self.since_days,
            'synced_at': self.synced_at.isoformat(),
            'finds_projected': self.finds_projected,
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
    finds_projected = project_finds()

    synced_at = datetime.now(timezone.utc)
    AppConfig.set_value(LAST_SYNC_KEY, synced_at.isoformat())
    db.session.commit()

    return SyncReport(
        fetched=len(items),
        created=created,
        updated=updated,
        since_days=since_days,
        synced_at=synced_at,
        finds_projected=finds_projected,
    )


def project_finds() -> int:
    """
    Reporte les trouvailles du flux dans `friend_find`. Retourne le nombre créé.

    Une trouvaille reste une trouvaille, qu'elle vienne de la déduction par zone
    (§11) ou du flux d'activité (§9) : sans ce pont, une cache vue passer dans
    « Activité des amis » n'apparaissait ni dans la colonne « 👥 » du tableau, ni
    sur la carte des trouvailles, ni dans l'import vers la zone « Amis ». Les deux
    tables ne se parlaient tout simplement pas.

    Trois restrictions :

    - **`log_type_id == 2` uniquement.** « Trouvée » ≠ « loguée » : un DNF ou une
      note d'ami n'est pas une trouvaille, et l'y verser fausserait le « qui a
      trouvé quoi » du tableau de zone.
    - **`is_self` exclu.** Le flux « communauté » mélange mes propres logs.
    - **`source='activity'`**, donc jamais effacé par une resynchronisation de
      zone : la déduction `nfb` est aveugle aux caches archivées, elle ne doit
      pas supprimer une trouvaille avérée (cf. `replace_scope`).

    **Incremental** : ne balaie que les lignes dont ``last_seen_at`` est plus
    récent que la dernière projection (``LAST_PROJECTION_KEY``). Au premier
    appel (pas de timestamp), balaie toute la table pour rattraper l'historique.
    ``store_finds()`` étant idempotent (upsert), projeter deux fois la même
    trouvaille est inoffensif — l'incrémental ne sert qu'à éviter de re-scanner
    des milliers de lignes à chaque synchro.
    """
    from .geocaching_friend_finds import CacheSummary, store_finds

    last_projection_str = AppConfig.get_value(LAST_PROJECTION_KEY)
    last_projection = _parse_iso(last_projection_str) if last_projection_str else None

    query = (
        FriendActivity.query
        .filter(FriendActivity.log_type_id == FOUND_LOG_TYPE_ID)
        .filter(db.or_(FriendActivity.is_self.is_(False), FriendActivity.is_self.is_(None)))
        .filter(FriendActivity.cache_reference_code.isnot(None))
    )
    if last_projection is not None:
        query = query.filter(FriendActivity.last_seen_at > last_projection)

    rows = query.all()

    # Pas de lignes nouvelles : on ne met pas à jour le timestamp de projection,
    # pour ne pas rater des lignes qui arriveraient entre-temps avec un
    # last_seen_at antérieur (cas d'une horloge skew ou d'un log édité).
    if not rows:
        logger.debug("project_finds: no new rows since last projection")
        return 0

    by_friend: dict[str, dict[str, CacheSummary]] = {}
    for row in rows:
        code = row.cache_reference_code.upper()
        by_friend.setdefault(row.author_username, {})[code] = CacheSummary(
            gc_code=code,
            name=row.cache_name,
            cache_type=_cache_type_label(row.cache_type_id),
            latitude=row.latitude,
            longitude=row.longitude,
        )

    created = 0
    for friend, summaries in by_friend.items():
        # Pas de `replace_scope` : le flux est un flux, pas la vue exhaustive
        # d'une zone. Il n'a aucune autorité pour supprimer quoi que ce soit.
        friend_created, _ = store_finds(
            friend,
            summaries.keys(),
            source='activity',
            summaries=summaries,
        )
        created += friend_created

    # On enregistre le timestamp de projection après le traitement, pour ne
    # marquer comme « projetées » que les lignes effectivement vues.
    now = datetime.now(timezone.utc)
    AppConfig.set_value(LAST_PROJECTION_KEY, now.isoformat())
    db.session.commit()

    if created:
        logger.info("Projected %d friend finds from the activity feed", created)
    return created


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


def count_hidden_condensed(
    author: Optional[str] = None,
    log_type_ids: Optional[Iterable[int]] = None,
    activity_type: int = ACTIVITY_TYPE_FRIENDS,
    include_self: bool = False,
) -> int:
    """
    Nombre de trouvailles que geocaching.com a **regroupées sans les détailler**.

    Quand un ami logue plusieurs caches d'affilée, le flux ne renvoie qu'une
    entrée portant `isCondensed` et `condensedCount` : une seule cache est
    nommée, les autres n'existent nulle part dans la réponse. Les DNF, eux, sont
    presque toujours isolés — d'où l'impression trompeuse d'avoir « tous les DNF
    mais pas toutes les trouvailles ».

    Ce compteur mesure ce qui manque, pour que l'interface puisse le dire au lieu
    de laisser croire que le flux est exhaustif. Il n'y a aucun moyen connu de
    déplier ces entrées : la source complète est la déduction par zone (§11).
    """
    query = _filtered_query(
        author=author,
        log_type_ids=log_type_ids,
        activity_type=activity_type,
        include_self=include_self,
    ).filter(FriendActivity.is_condensed.is_(True))

    total = query.with_entities(db.func.sum(FriendActivity.condensed_count)).scalar()
    return int(total or 0)


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


# ---------------------------------------------------------- Events

# Log types pour les events geocaching.com :
# 9 = "participera à" (will attend), 10 = "a participé à" (attended)
EVENT_LOG_TYPE_IDS = (9, 10)


def query_events(
    upcoming: bool = True,
    past: bool = True,
    author: Optional[str] = None,
    include_self: bool = False,
    limit: int = 100,
) -> dict:
    """
    Liste les events (log types 9 et 10) du flux d'activité des amis.

    Les events sont agrégés par cache (un event = une cache de type Event),
    avec la liste des amis qui y participent et la date de l'event (log_date).

    - ``upcoming`` : inclure les events à venir (log_type_id = 9, "participera à") ;
    - ``past`` : inclure les events passés (log_type_id = 10, "a participé à") ;
    - ``author`` : filtrer par ami ;
    - ``include_self`` : inclure mes propres logs ;
    - ``limit`` : nombre maximum d'events retournés.

    Retourne un dict avec :

    - ``items`` : liste d'events triés par date d'event (les à venir en premier,
      du plus proche au plus lointain, puis les passés du plus récent au plus
      ancien) ;
    - ``count`` : nombre d'events retournés ;
    - ``upcoming_count`` : nombre d'events à venir ;
    - ``past_count`` : nombre d'events passés.
    """
    from datetime import datetime as _dt, timezone as _tz

    type_ids: list[int] = []
    if upcoming:
        type_ids.append(9)
    if past:
        type_ids.append(10)
    if not type_ids:
        return {'items': [], 'count': 0, 'upcoming_count': 0, 'past_count': 0}

    query = (
        FriendActivity.query
        .filter(FriendActivity.activity_type == ACTIVITY_TYPE_FRIENDS)
        .filter(FriendActivity.log_type_id.in_(type_ids))
    )

    if author:
        query = query.filter(FriendActivity.author_username == author)

    if not include_self:
        query = query.filter(db.or_(FriendActivity.is_self.is_(False), FriendActivity.is_self.is_(None)))

    rows = query.order_by(FriendActivity.log_date.desc()).all()

    # Regroupement par cache_reference_code (ou cache_name si pas de code)
    by_cache: dict[str, dict] = {}
    for row in rows:
        key = row.cache_reference_code or row.cache_name or f'unknown-{row.id}'
        entry = by_cache.get(key)
        if entry is None:
            entry = {
                'gc_code': row.cache_reference_code,
                'name': row.cache_name or row.cache_reference_code or 'Event',
                'cache_type_id': row.cache_type_id,
                'latitude': row.latitude,
                'longitude': row.longitude,
                'location_name': row.location_name,
                'difficulty': row.difficulty,
                'terrain': row.terrain,
                'is_archived': row.is_archived,
                'action_url': row.action_url,
                'friends': set(),
                'log_dates': [],
                'log_types': set(),
            }
            by_cache[key] = entry
        entry['friends'].add(row.author_username)
        if row.log_date:
            entry['log_dates'].append(row.log_date)
        if row.log_type_id:
            entry['log_types'].add(row.log_type_id)

    # Détermine la date de l'event (la plus pertinente parmi les logs)
    items = []
    for entry in by_cache.values():
        entry['friends'] = sorted(entry['friends'], key=str.casefold)
        entry['friends_count'] = len(entry['friends'])
        entry['is_upcoming'] = 9 in entry['log_types']
        # Date de l'event : le log_date le plus récent
        entry['event_date'] = max(entry['log_dates']) if entry['log_dates'] else None
        # Convertir le set en liste pour la sérialisation JSON
        entry['log_types'] = sorted(entry['log_types'])
        items.append(entry)

    # Tri : à venir d'abord (date croissante = du plus proche au plus lointain),
    # puis passés (date décroissante = du plus récent au plus ancien)
    def sort_key(item: dict) -> tuple:
        event_date = item.get('event_date')
        if event_date is None:
            return (1, _dt.min.replace(tzinfo=_tz.utc).isoformat())
        if item['is_upcoming']:
            # À venir : tri croissant (plus proche en premier)
            return (0, event_date.isoformat() if isinstance(event_date, str) else event_date.isoformat())
        # Passé : tri décroissant (plus récent en premier)
        return (1, '' )  # placeholder, on trie différemment

    # Tri manuel pour gérer à venir vs passé
    upcoming_items = [i for i in items if i['is_upcoming']]
    past_items = [i for i in items if not i['is_upcoming']]

    upcoming_items.sort(key=lambda i: i['event_date'] or _dt.max.replace(tzinfo=_tz.utc))
    past_items.sort(key=lambda i: i['event_date'] or _dt.min.replace(tzinfo=_tz.utc), reverse=True)

    items = upcoming_items + past_items
    items = items[:limit]

    return {
        'items': items,
        'count': len(items),
        'upcoming_count': len(upcoming_items),
        'past_count': len(past_items),
    }

