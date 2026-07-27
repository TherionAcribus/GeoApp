"""
Blueprint pour les amis Geocaching.com.

Routes API :
- GET  /api/friends                 → liste des amis (cache mémoire, ?force=true pour rafraîchir)
- GET  /api/friends/activity        → flux d'activité stocké localement (filtres + pagination)
- POST /api/friends/activity/sync   → récupère le flux distant et l'accumule en base
- POST /api/friends/finds/sync-zone → déduit les trouvailles d'un ami sur une zone
- GET  /api/friends/finds/zone/<id> → « qui a trouvé quoi » pour une zone
- GET  /api/friends/finds/geocache/<id> → amis ayant trouvé une géocache
"""
from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request

from ..database import db
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
    FriendFindsError,
    RateLimitedError,
    ZoneBox,
    get_friend_finds_client,
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
        return jsonify({"success": False, "error": "internal_error", "error_message": str(exc)}), 500

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
        created, known = store_finds(friend, result.found_codes, replace_scope=baseline)
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
        return jsonify({"success": False, "error": "internal_error", "error_message": str(exc)}), 500

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
