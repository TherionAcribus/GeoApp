"""
Blueprint pour les amis Geocaching.com.

Routes API :
- GET  /api/friends                 → liste des amis (cache mémoire, ?force=true pour rafraîchir)
- GET  /api/friends/activity        → flux d'activité stocké localement (filtres + pagination)
- GET  /api/friends/activity/map    → mêmes filtres, agrégés en points pour la carte
- POST /api/friends/activity/sync   → récupère le flux distant et l'accumule en base
- POST /api/friends/finds/sync-zone → déduit les trouvailles d'un ami sur une zone
- POST /api/friends/finds/sync-friend → trouvailles d'un ami depuis son profil (sans zone)
- GET  /api/friends/finds/zone/<id> → « qui a trouvé quoi » pour une zone
- GET  /api/friends/finds/map       → toutes les trouvailles cartographiables
- POST /api/friends/finds/import    → importe les caches manquantes dans la zone « Amis »
- GET  /api/friends/finds/geocache/<id> → amis ayant trouvé une géocache
- GET  /api/friends/finds/suggestions → caches trouvées par ≥N amis mais pas par moi
- GET  /api/friends/stats             → statistiques croisées par ami (trouvailles, activité, commun)
- GET  /api/friends/freshness          → état de fraîcheur de toutes les sources (timestamps + compteurs)
- GET  /api/friends/notifications      → nouvelles trouvailles d'amis depuis la dernière visite
- POST /api/friends/notifications/seen → marque les notifications comme lues
"""
from __future__ import annotations

import json
import logging
import time

from flask import Blueprint, Response, jsonify, request, stream_with_context

from ..blueprints.geocaches import (
    _bulk_import_summary,
    _import_item_label,
    _import_stats,
    _new_import_counts,
)
from ..database import db
from ..geocaches.importer import GeocacheImporter
from ..geocaches.models import Geocache
from ..models import FriendFind
from ..services import friend_activity_store
from ..services.geocaching_auth import get_auth_service
from ..services.geocaching_friend_activity import (
    ACTIVITY_TYPE_FRIENDS,
    LOG_TYPE_LABELS,
    FriendActivityError,
)
from ..services.geocaching_friend_finds import (
    FRIENDS_ZONE_NAME,
    FilterIgnoredError,
    FriendFindsError,
    RateLimitedError,
    ZoneBox,
    get_friend_finds_client,
    get_or_create_friends_zone,
    list_codes_to_import,
    mark_notifications_seen,
    query_freshness,
    query_friend_stats,
    query_notifications,
    query_suggestions,
    store_finds,
)
from ..services.geocaching_friends import (
    GeocachingFriendsError,
    NotAuthenticatedError,
    get_friends_client,
)

logger = logging.getLogger(__name__)

bp = Blueprint("friends", __name__, url_prefix="/api/friends")


@bp.get("")
def list_friends():
    """
    Retourne la liste des amis du compte Geocaching.com connecté.

    Query params:
        force: 'true' pour ignorer le cache mémoire (15 min par défaut)
    """
    force = request.args.get("force", "false").lower() in ("true", "1", "yes")

    if not get_auth_service().is_logged_in():
        return jsonify({
            "success": False,
            "error": "not_authenticated",
            "error_message": "Vous devez être connecté à Geocaching.com pour voir vos amis.",
        }), 401

    try:
        result = get_friends_client().get_friends(force_refresh=force)
    except NotAuthenticatedError as exc:
        return jsonify({
            "success": False,
            "error": "not_authenticated",
            "error_message": str(exc),
        }), 401
    except GeocachingFriendsError as exc:
        logger.error("Failed to fetch friends list: %s", exc)
        return jsonify({
            "success": False,
            "error": "fetch_failed",
            "error_message": str(exc),
        }), 502
    except Exception as exc:  # pragma: no cover - garde-fou
        logger.exception("Unexpected error while fetching friends list")
        return jsonify({
            "success": False,
            "error": "internal_error",
            "error_message": str(exc),
        }), 500

    return jsonify({"success": True, **result.to_dict()})


@bp.get("/activity")
def list_activity():
    """
    Retourne le flux d'activité des amis **stocké localement**.

    Aucune requête vers geocaching.com : la collecte se fait via /activity/sync.

    Query params:
        limit  : nombre d'entrées (défaut 50, max 200)
        offset : décalage pour la pagination
        author : filtre sur le pseudo exact d'un ami
        log_types : ids de types de log séparés par des virgules (ex. "2,3")
        include_self : 'true' pour inclure mes propres logs (le flux « communauté »
                       de geocaching.com les mélange avec ceux des amis)
    """
    try:
        limit = int(request.args.get("limit", 50))
        offset = int(request.args.get("offset", 0))
    except ValueError:
        return jsonify({"success": False, "error": "invalid_params",
                        "error_message": "limit et offset doivent être des entiers."}), 400

    raw_types = (request.args.get("log_types") or "").strip()
    try:
        log_type_ids = [int(part) for part in raw_types.split(",") if part.strip()]
    except ValueError:
        return jsonify({"success": False, "error": "invalid_params",
                        "error_message": "log_types doit être une liste d'entiers séparés par des virgules."}), 400

    include_self = request.args.get("include_self", "false").lower() in ("true", "1", "yes")

    rows, total = friend_activity_store.query_activities(
        limit=limit,
        offset=offset,
        author=(request.args.get("author") or "").strip() or None,
        log_type_ids=log_type_ids,
        include_self=include_self,
    )

    return jsonify({
        "success": True,
        "activities": [row.to_dict() for row in rows],
        "count": len(rows),
        "total": total,
        "offset": offset,
        "limit": limit,
        "authors": friend_activity_store.list_authors(include_self=include_self),
        "log_type_labels": {str(key): value for key, value in LOG_TYPE_LABELS.items()},
        "last_sync_at": friend_activity_store.get_last_sync_at(),
        # Trouvailles regroupées par geocaching.com sans être détaillées : elles
        # n'existent nulle part dans la réponse distante (voir §13.2 de la doc).
        "condensed_hidden": friend_activity_store.count_hidden_condensed(
            author=(request.args.get("author") or "").strip() or None,
            log_type_ids=log_type_ids,
            include_self=include_self,
        ),
    })


@bp.get("/activity/map")
def activity_map():
    """
    Points cartographiables du flux d'activité **stocké localement**.

    Sœur de /activity, taillée pour la carte : pas de pagination (une carte
    tronquée serait trompeuse), pas de `note` ni d'`action_url`, et un point par
    cache plutôt qu'un par log.

    Query params:
        author, log_types, include_self : identiques à /activity
        days  : fenêtre glissante sur la date du log
        limit : garde-fou (défaut 2000, plafonné à 5000)
    """
    try:
        limit = int(request.args.get("limit", 2000))
        raw_days = (request.args.get("days") or "").strip()
        days = int(raw_days) if raw_days else None
    except ValueError:
        return jsonify({"success": False, "error": "invalid_params",
                        "error_message": "days et limit doivent être des entiers."}), 400

    if days is not None and days < 0:
        return jsonify({"success": False, "error": "invalid_params",
                        "error_message": "days doit être positif."}), 400

    raw_types = (request.args.get("log_types") or "").strip()
    try:
        log_type_ids = [int(part) for part in raw_types.split(",") if part.strip()]
    except ValueError:
        return jsonify({"success": False, "error": "invalid_params",
                        "error_message": "log_types doit être une liste d'entiers séparés par des virgules."}), 400

    include_self = request.args.get("include_self", "false").lower() in ("true", "1", "yes")

    result = friend_activity_store.query_map_points(
        author=(request.args.get("author") or "").strip() or None,
        log_type_ids=log_type_ids,
        include_self=include_self,
        days=days,
        limit=limit,
    )

    return jsonify({
        "success": True,
        **result,
        "log_type_labels": {str(key): value for key, value in LOG_TYPE_LABELS.items()},
    })


@bp.post("/activity/sync")
def sync_activity():
    """
    Récupère le flux distant et l'accumule en base (déduplication sur le code du log).

    Body JSON optionnel : { "days": 7 }
    """
    data = request.get_json(silent=True) or {}
    try:
        days = int(data.get("days", 7))
    except (TypeError, ValueError):
        return jsonify({"success": False, "error": "invalid_params",
                        "error_message": "days doit être un entier."}), 400

    if not get_auth_service().is_logged_in():
        return jsonify({
            "success": False,
            "error": "not_authenticated",
            "error_message": "Vous devez être connecté à Geocaching.com pour synchroniser l'activité.",
        }), 401

    try:
        report = friend_activity_store.sync(
            since_days=days,
            activity_type=ACTIVITY_TYPE_FRIENDS,
        )
    except NotAuthenticatedError as exc:
        return jsonify({"success": False, "error": "not_authenticated", "error_message": str(exc)}), 401
    except FriendActivityError as exc:
        logger.error("Failed to sync friend activity: %s", exc)
        return jsonify({"success": False, "error": "fetch_failed", "error_message": str(exc)}), 502
    except Exception as exc:  # pragma: no cover - garde-fou
        logger.exception("Unexpected error while syncing friend activity")
        raise

    return jsonify({"success": True, **report.to_dict()})


def _zone_box(zone_id: int):
    """Boîte englobante des géocaches d'une zone, ou None si aucune coordonnée."""
    rows = (
        db.session.query(Geocache.latitude, Geocache.longitude)
        .filter(Geocache.zone_id == zone_id)
        .filter(Geocache.latitude.isnot(None), Geocache.longitude.isnot(None))
        .all()
    )
    return ZoneBox.from_coordinates(rows)


@bp.post("/finds/sync-zone")
def sync_zone_finds():
    """
    Déduit les trouvailles d'un ami sur une zone (complément du filtre `nfb`).

    Body JSON : { "zone_id": 1, "friend": "pseudo" }

    Un seul ami par appel : la référence de zone est mise en cache côté service,
    donc appeler cette route ami par ami coûte à peine plus cher qu'une passe
    globale, tout en donnant une progression réelle à l'interface.
    """
    data = request.get_json(silent=True) or {}
    zone_id = data.get("zone_id")
    friend = (data.get("friend") or "").strip()

    if not isinstance(zone_id, int) or not friend:
        return jsonify({"success": False, "error": "invalid_params",
                        "error_message": "zone_id (entier) et friend (pseudo) sont requis."}), 400

    if not get_auth_service().is_logged_in():
        return jsonify({
            "success": False,
            "error": "not_authenticated",
            "error_message": "Vous devez être connecté à Geocaching.com pour cette recherche.",
        }), 401

    box = _zone_box(zone_id)
    if box is None:
        return jsonify({"success": False, "error": "empty_zone",
                        "error_message": "Cette zone ne contient aucune géocache géolocalisée."}), 400

    try:
        result = get_friend_finds_client().find_codes_found_by(friend, box)
        baseline, _ = get_friend_finds_client().get_zone_baseline(box)
        created, known = store_finds(
            friend,
            result.found_codes,
            replace_scope=baseline,
            summaries=result.summaries,
        )
    except NotAuthenticatedError as exc:
        return jsonify({"success": False, "error": "not_authenticated", "error_message": str(exc)}), 401
    except RateLimitedError as exc:
        # 429 : l'appelant doit lever le pied, pas réessayer en boucle.
        logger.warning("Friend finds rate limited: %s", exc)
        return jsonify({"success": False, "error": "rate_limited", "error_message": str(exc)}), 429
    except FriendFindsError as exc:
        logger.error("Failed to compute friend finds: %s", exc)
        return jsonify({"success": False, "error": "fetch_failed", "error_message": str(exc)}), 502
    except Exception as exc:  # pragma: no cover - garde-fou
        logger.exception("Unexpected error while computing friend finds")
        db.session.rollback()
        raise

    # La boîte englobante déborde largement la zone quand ses caches sont
    # dispersées : on distingue ce qui a été balayé de ce qui concerne vraiment
    # la zone, sinon les chiffres retournés sont incompréhensibles.
    zone_codes = {
        code for (code,) in db.session.query(Geocache.gc_code)
        .filter(Geocache.zone_id == zone_id).all()
    }
    zone_matches = len(zone_codes & result.found_codes)

    return jsonify({
        "success": True,
        "friend": friend,
        "zone_id": zone_id,
        "searched_caches": result.zone_codes_count,
        "zone_caches": len(zone_codes),
        "found": len(result.found_codes),
        "zone_matches": zone_matches,
        "created": created,
        "known": known,
        "truncated": result.truncated,
    })


@bp.get("/finds/friend/<path:username>/estimate")
def estimate_friend_finds(username: str):
    """Nombre de trouvailles annoncées pour cet ami, en une requête."""
    if not get_auth_service().is_logged_in():
        return jsonify({"success": False, "error": "not_authenticated",
                        "error_message": "Vous devez être connecté à Geocaching.com."}), 401

    try:
        total = get_friend_finds_client().estimate_finds_count(username)
    except FilterIgnoredError as exc:
        return jsonify({"success": False, "error": "filter_ignored", "error_message": str(exc)}), 502
    except RateLimitedError as exc:
        return jsonify({"success": False, "error": "rate_limited", "error_message": str(exc)}), 429
    except FriendFindsError as exc:
        return jsonify({"success": False, "error": "fetch_failed", "error_message": str(exc)}), 502

    reachable = min(total, get_friend_finds_client().MAX_SKIP)
    pages = max(1, -(-reachable // get_friend_finds_client().PAGE_SIZE))

    return jsonify({
        "success": True,
        "friend": username,
        "total": total,
        # Le serveur refuse skip+take au-delà de ~10 000 : au-delà, seules les
        # trouvailles les plus récentes sont atteignables.
        "reachable": reachable,
        "seconds": round(pages * get_friend_finds_client().MIN_INTERVAL_SECONDS),
    })


@bp.post("/finds/sync-friend")
def sync_friend_finds():
    """
    Récupère les trouvailles d'un ami depuis son profil, sans borne géographique.

    C'est la réponse à la condensation du flux d'activité (§9.2) : le flux
    regroupe les trouvailles d'affilée sans les nommer, cette recherche les
    donne une par une, de la plus récente à la plus ancienne.

    Body JSON : { "friend": "pseudo", "max_results": 1000 }
    """
    data = request.get_json(silent=True) or {}
    friend = (data.get("friend") or "").strip()
    max_results = data.get("max_results")

    if not friend:
        return jsonify({"success": False, "error": "invalid_params",
                        "error_message": "friend (pseudo) est requis."}), 400
    if max_results is not None:
        try:
            max_results = int(max_results)
        except (TypeError, ValueError):
            return jsonify({"success": False, "error": "invalid_params",
                            "error_message": "max_results doit être un entier."}), 400

    if not get_auth_service().is_logged_in():
        return jsonify({
            "success": False,
            "error": "not_authenticated",
            "error_message": "Vous devez être connecté à Geocaching.com pour cette recherche.",
        }), 401

    try:
        summaries, total, truncated = get_friend_finds_client().search_finds_by(
            friend, max_results=max_results
        )
        # Pas de `replace_scope` : cette recherche n'est pas exhaustive (plafond
        # de pagination, caches archivées absentes). Elle n'a donc aucune
        # autorité pour supprimer une trouvaille connue par une autre source.
        created, known = store_finds(
            friend,
            [summary.gc_code for summary in summaries],
            source='profile_search',
            summaries={summary.gc_code: summary for summary in summaries},
        )
    except NotAuthenticatedError as exc:
        return jsonify({"success": False, "error": "not_authenticated", "error_message": str(exc)}), 401
    except FilterIgnoredError as exc:
        logger.error("Player filter ignored by geocaching.com: %s", exc)
        return jsonify({"success": False, "error": "filter_ignored", "error_message": str(exc)}), 502
    except RateLimitedError as exc:
        logger.warning("Friend finds rate limited: %s", exc)
        return jsonify({"success": False, "error": "rate_limited", "error_message": str(exc)}), 429
    except FriendFindsError as exc:
        logger.error("Failed to fetch friend finds: %s", exc)
        return jsonify({"success": False, "error": "fetch_failed", "error_message": str(exc)}), 502
    except Exception as exc:  # pragma: no cover - garde-fou
        logger.exception("Unexpected error while fetching friend finds")
        db.session.rollback()
        raise

    return jsonify({
        "success": True,
        "friend": friend,
        "announced": total,
        "fetched": len(summaries),
        "created": created,
        "known": known,
        "truncated": truncated,
    })


@bp.get("/finds/zone/<int:zone_id>/estimate")
def estimate_zone_finds(zone_id: int):
    """
    Coût prévisible d'une analyse : nombre de caches à balayer et durée estimée.

    Une seule requête vers geocaching.com, pour éviter de lancer à l'aveugle une
    analyse de vingt minutes sur une zone géographiquement dispersée.
    """
    if not get_auth_service().is_logged_in():
        return jsonify({"success": False, "error": "not_authenticated",
                        "error_message": "Vous devez être connecté à Geocaching.com."}), 401

    box = _zone_box(zone_id)
    if box is None:
        return jsonify({"success": False, "error": "empty_zone",
                        "error_message": "Cette zone ne contient aucune géocache géolocalisée."}), 400

    try:
        searched = get_friend_finds_client().estimate_box_size(box)
    except RateLimitedError as exc:
        return jsonify({"success": False, "error": "rate_limited", "error_message": str(exc)}), 429
    except FriendFindsError as exc:
        return jsonify({"success": False, "error": "fetch_failed", "error_message": str(exc)}), 502

    zone_caches = Geocache.query.filter_by(zone_id=zone_id).count()
    pages = max(1, -(-searched // get_friend_finds_client().PAGE_SIZE))

    return jsonify({
        "success": True,
        "zone_id": zone_id,
        "zone_caches": zone_caches,
        "searched_caches": searched,
        # Une pagination par ami, au débit auto-limité du client.
        "seconds_per_friend": round(pages * get_friend_finds_client().MIN_INTERVAL_SECONDS),
    })


@bp.get("/finds/zone/<int:zone_id>")
def zone_finds(zone_id: int):
    """
    « Qui a trouvé quoi » sur une zone : { gc_code: [pseudos] }.

    Lecture purement locale, destinée à la colonne « Amis » du tableau.
    """
    rows = (
        db.session.query(Geocache.gc_code, FriendFind.friend_username)
        .join(FriendFind, FriendFind.gc_code == Geocache.gc_code)
        .filter(Geocache.zone_id == zone_id)
        .all()
    )

    finds: dict[str, list[str]] = {}
    for gc_code, username in rows:
        finds.setdefault(gc_code, []).append(username)
    for usernames in finds.values():
        usernames.sort(key=str.casefold)

    return jsonify({
        "success": True,
        "zone_id": zone_id,
        "finds": finds,
        "caches_with_friend_finds": len(finds),
    })


@bp.get("/finds/map")
def finds_map():
    """
    Trouvailles d'amis cartographiables, toutes zones confondues.

    Lecture **purement locale**, sans limite de date : contrairement au flux
    d'activité (§9), cette table remonte à la première trouvaille de l'ami.

    Les coordonnées viennent de deux endroits, dans cet ordre : celles relevées
    à la déduction (`friend_find.latitude`), sinon la géocache importée. Ce qui
    n'a ni l'une ni l'autre est compté dans `without_coordinates` : ce sont les
    caches qu'un import rendrait plaçables.

    Query params:
        friend : filtre sur le pseudo exact d'un ami
    """
    friend = (request.args.get("friend") or "").strip() or None

    query = db.session.query(FriendFind, Geocache).outerjoin(
        Geocache, Geocache.gc_code == FriendFind.gc_code
    )
    if friend:
        query = query.filter(FriendFind.friend_username == friend)

    points: dict[str, dict] = {}
    without_coordinates = 0
    missing_codes: set[str] = set()

    for find, geocache in query.all():
        latitude = find.latitude if find.latitude is not None else (
            geocache.latitude if geocache else None
        )
        longitude = find.longitude if find.longitude is not None else (
            geocache.longitude if geocache else None
        )

        if latitude is None or longitude is None:
            without_coordinates += 1
            missing_codes.add(find.gc_code)
            continue

        point = points.get(find.gc_code)
        if point is None:
            point = {
                'gc_code': find.gc_code,
                'name': (geocache.name if geocache else None) or find.cache_name,
                'cache_type': (geocache.type if geocache else None) or find.cache_type,
                'latitude': latitude,
                'longitude': longitude,
                'difficulty': geocache.difficulty if geocache else None,
                'terrain': geocache.terrain if geocache else None,
                'geocache_id': geocache.id if geocache else 0,
                'found': bool(geocache.found) if geocache else False,
                'friends': [],
            }
            points[find.gc_code] = point
        point['friends'].append({'username': find.friend_username, 'source': find.source})

    for point in points.values():
        point['friends'].sort(key=lambda friend_entry: friend_entry['username'].casefold())

    return jsonify({
        "success": True,
        "points": list(points.values()),
        "total": len(points),
        "without_coordinates": without_coordinates,
        # Le nombre de **caches** non plaçables, pas de lignes : c'est ce qu'un
        # import aurait à télécharger.
        "importable": len(missing_codes),
    })


@bp.post("/finds/import")
def import_finds():
    """
    Importe dans la zone « Amis » les caches trouvées par vos amis mais absentes
    de GeoApp — celles que la déduction n'a pas su géolocaliser.

    Réponse en **streaming JSON** (une ligne = un objet), comme `import-around` :
    le frontend sait déjà consommer ce format, et l'opération peut durer
    plusieurs minutes (une requête par cache, au débit du scraper).
    """
    if not get_auth_service().is_logged_in():
        return jsonify({
            "success": False,
            "error": "not_authenticated",
            "error_message": "Vous devez être connecté à Geocaching.com pour importer des géocaches.",
        }), 401

    codes = list_codes_to_import()
    zone = get_or_create_friends_zone()
    zone_id = zone.id

    def generate():
        try:
            total = len(codes)
            if total == 0:
                yield json.dumps({
                    'progress': 100,
                    'message': 'Toutes les trouvailles de vos amis sont déjà dans GeoApp.',
                    'final_summary': True,
                    'stats': _import_stats(_new_import_counts(), 0),
                    'zone_id': zone_id,
                }) + '\n'
                return

            yield json.dumps({
                'message': f'{total} géocache(s) à importer dans « {FRIENDS_ZONE_NAME} »',
                'progress': 2,
            }) + '\n'

            importer = GeocacheImporter()
            counts = _new_import_counts()

            for index, code in enumerate(codes, start=1):
                try:
                    _, outcome = importer.import_by_code(zone_id, code, return_outcome=True)
                    counts[outcome] += 1
                    message = f'{_import_item_label(outcome)}: {code} ({index}/{total})'
                except Exception as exc:
                    counts['errors'] += 1
                    message = f'Erreur {code}: {exc}'

                yield json.dumps({
                    'message': message,
                    'progress': 2 + int(index / total * 98),
                    'imported': index,
                    'total': total,
                }) + '\n'

                # Même respiration que l'import autour : le scraper interroge
                # geocaching.com une fois par cache.
                time.sleep(0.2)

            yield json.dumps({
                'progress': 100,
                'message': _bulk_import_summary(counts),
                'final_summary': True,
                'stats': _import_stats(counts, total),
                'zone_id': zone_id,
            }) + '\n'

        except Exception as exc:  # pragma: no cover - garde-fou du streaming
            logger.error("Friend finds import failed: %s", exc, exc_info=True)
            yield json.dumps({'error': True, 'message': f'Erreur: {exc}'}) + '\n'

    return Response(stream_with_context(generate()), content_type='application/json')


@bp.get("/finds/geocache/<int:geocache_id>")
def geocache_finds(geocache_id: int):
    """
    Amis ayant trouvé cette géocache, avec de quoi les contacter.

    Le lien Message Center vient du GUID de profil de la liste d'amis ; si
    celle-ci n'est pas joignable (hors ligne), on retourne quand même les
    pseudos, sans lien.
    """
    geocache = Geocache.query.get(geocache_id)
    if not geocache:
        return jsonify({"success": False, "error": "not_found",
                        "error_message": "Géocache introuvable."}), 404

    usernames = [
        row.friend_username
        for row in FriendFind.query.filter_by(gc_code=geocache.gc_code)
        .order_by(FriendFind.friend_username)
        .all()
    ]

    profiles: dict[str, dict] = {}
    try:
        for friend in get_friends_client().get_friends().friends:
            profiles[friend.username] = {
                "profile_url": friend.profile_url,
                "avatar_url": friend.avatar_url,
                "message_url": (
                    f"https://www.geocaching.com/account/messagecenter?recipientId={friend.profile_guid}"
                    if friend.profile_guid else None
                ),
            }
    except Exception as exc:
        # L'enrichissement est un bonus : sans lui on affiche quand même les pseudos.
        logger.info("Friends list unavailable while enriching finds: %s", exc)

    return jsonify({
        "success": True,
        "geocache_id": geocache_id,
        "gc_code": geocache.gc_code,
        "friends": [
            {"username": username, **profiles.get(username, {})}
            for username in usernames
        ],
        "count": len(usernames),
    })


@bp.get("/finds/suggestions")
def finds_suggestions():
    """
    Caches trouvées par vos amis mais pas (encore) par vous.

    Croise ``friend_find`` et ``Geocache`` : regroupe les trouvailles d'amis par
    code GC, joint les caches importées pour les métadonnées, et exclut celles
    que vous avez déjà trouvées. Tri par popularité (nombre d'amis) décroissant.

    Query params:
        zone_id : restreint à une zone donnée (défaut : toutes zones)
        min_friends : nombre minimum d'amis (défaut : 1)
        limit : nombre maximum de suggestions (défaut : 50, max : 200)
        include_found : inclure les caches déjà trouvées (défaut : false)
    """
    zone_id = request.args.get("zone_id", type=int)
    min_friends = request.args.get("min_friends", default=1, type=int)
    limit = request.args.get("limit", default=50, type=int)
    include_found = request.args.get("include_found", "false").lower() in ("true", "1", "yes")

    suggestions = query_suggestions(
        zone_id=zone_id,
        min_friends=max(1, min(min_friends, 50)),
        limit=limit,
        include_found=include_found,
    )

    return jsonify({
        "success": True,
        "suggestions": suggestions,
        "count": len(suggestions),
    })


@bp.get("/stats")
def friend_stats():
    """
    Statistiques croisées sur les amis.

    Pour chaque ami : nombre de trouvailles connues (``friend_find``), nombre de
    logs dans le flux d'activité (``FriendActivity``), et nombre de caches en
    commun avec moi (caches que j'ai trouvées et que cet ami a aussi trouvées).

    Résumé global : nombre d'amis, total de trouvailles distinctes, total de
    caches en commun, ami le plus actif.
    """
    stats = query_friend_stats()
    return jsonify({"success": True, **stats})


@bp.get("/freshness")
def friend_freshness():
    """
    État de fraîcheur de toutes les sources de données « amis ».

    Retourne en une seule lecture (sans réseau) les timestamps et compteurs
    clés : dernière synchro du flux, dernière projection de trouvailles, nombre
    de logs stockés, nombre de trouvailles déduites, nombre d'amis, nombre de
    géocaches, etc. Avec des indicateurs ``is_stale`` pour repérer d'un coup
    d'œil si une synchro est nécessaire.
    """
    return jsonify({"success": True, **query_freshness()})


@bp.get("/notifications")
def friend_notifications():
    """
    Notifications de nouvelles trouvailles d'amis depuis la dernière visite.

    Query params : ``min_friends`` (défaut lu depuis les préférences, sinon 1),
    ``limit`` (défaut 50, max 200).

    Les notifications sont désactivées par défaut : le frontend ne consulte
    cette route que si ``geoApp.friends.notifications.enabled`` est vrai.
    """
    from ..utils.preferences import get_value_or_default

    default_min = int(get_value_or_default('geoApp.friends.notifications.minFriends', 1))
    min_friends = request.args.get('min_friends', default=default_min, type=int)
    min_friends = max(1, min(50, min_friends))
    limit = request.args.get('limit', 50, type=int)
    limit = max(1, min(200, limit))

    result = query_notifications(min_friends=min_friends, limit=limit)
    return jsonify({"success": True, **result})


@bp.post("/notifications/seen")
def friend_notifications_seen():
    """Marque toutes les notifications actuelles comme lues."""
    seen_at = mark_notifications_seen()
    return jsonify({"success": True, "last_seen_at": seen_at})



