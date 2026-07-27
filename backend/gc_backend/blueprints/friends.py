"""
Blueprint pour les amis Geocaching.com.

Routes API :
- GET  /api/friends                 → liste des amis (cache mémoire, ?force=true pour rafraîchir)
- GET  /api/friends/activity        → flux d'activité stocké localement (filtres + pagination)
- POST /api/friends/activity/sync   → récupère le flux distant et l'accumule en base
"""
from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request

from ..services import friend_activity_store
from ..services.geocaching_auth import get_auth_service
from ..services.geocaching_friend_activity import (
    ACTIVITY_TYPE_FRIENDS,
    LOG_TYPE_LABELS,
    FriendActivityError,
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
