"""
Blueprint pour les amis Geocaching.com.

Routes API :
- GET /api/friends            → liste des amis (cache mémoire, ?force=true pour rafraîchir)
"""
from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request

from ..services.geocaching_auth import get_auth_service
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
