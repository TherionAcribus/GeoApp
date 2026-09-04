"""
Blueprint pour les amis Geocaching.com.

Routes API :
- GET  /api/friends                 → liste des amis (cache mémoire, ?force=true pour rafraîchir)
- GET  /api/friends/activity        → flux d'activité stocké localement (filtres + pagination)
- GET  /api/friends/activity/map    → mêmes filtres, agrégés en points pour la carte
- POST /api/friends/activity/sync   → récupère le flux distant et l'accumule en base
- POST /api/friends/finds/sync-zone → déduit les trouvailles d'un ami sur une zone
- POST /api/friends/finds/sync-zone-stream → analyse tous les amis en streaming NDJSON
- POST /api/friends/finds/sync-friend → trouvailles d'un ami depuis son profil (sans zone)
- GET  /api/friends/finds/zone/<id> → « qui a trouvé quoi » pour une zone
- GET  /api/friends/finds/zone/<id>/scans → état des analyses par ami (vérifié le…, obsolète…)
- GET  /api/friends/finds/map       → toutes les trouvailles cartographiables
- POST /api/friends/finds/import    → importe les caches manquantes dans la zone « Amis »
- GET  /api/friends/finds/geocache/<id> → amis ayant trouvé une géocache
- GET  /api/friends/finds/suggestions → caches trouvées par ≥N amis mais pas par moi
- GET  /api/friends/stats             → statistiques croisées par ami (trouvailles, activité, commun)
- GET  /api/friends/freshness          → état de fraîcheur de toutes les sources (timestamps + compteurs)
- GET  /api/friends/notifications      → nouvelles trouvailles d'amis depuis la dernière visite
- POST /api/friends/notifications/seen → marque les notifications comme lues
- GET  /api/friends/events            → events (log types 9/10) du flux d'activité
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timedelta, timezone

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
from ..services.friend_activity_store import query_events
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
    record_scan,
    get_zone_scans,
    filter_friends_to_scan,
    store_finds,
    zone_boxes_from_coordinates,
    should_use_logbook,
    scan_finds_via_logbook,
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


def _zone_boxes(zone_id: int) -> list[ZoneBox]:
    """
    Boîtes englobantes d'une zone, découpées par clustering géographique.

    Pour une zone compacte, retourne une seule boîte (équivalent à
    ``_zone_box``). Pour une zone dispersée, retourne plusieurs boîtes plus
    petites, chacune balayant moins de caches côté geocaching.com.

    Retourne une liste vide si la zone n'a aucune géocache géolocalisée.
    """
    rows = (
        db.session.query(Geocache.latitude, Geocache.longitude)
        .filter(Geocache.zone_id == zone_id)
        .filter(Geocache.latitude.isnot(None), Geocache.longitude.isnot(None))
        .all()
    )
    return zone_boxes_from_coordinates(rows)


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

    # Mémorise le scan pour permettre un re-scan incrémental et l'affichage « vérifié le… ».
    record_scan(
        friend_username=friend,
        zone_id=zone_id,
        box=box,
        found_count=len(result.found_codes),
        baseline_total=result.zone_codes_count,
        zone_matches=zone_matches,
        truncated=result.truncated,
    )

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


def _generate_logbook_scan(
    zone_id: int,
    gc_codes: list[str],
    to_scan: list[str],
    skipped: int,
    signature_box: ZoneBox,
    total_to_scan: int,
    total_friends: int,
):
    """
    Générateur NDJSON pour le scan via logbook (sf=true).

    Itère sur les **caches** de la zone (pas sur les amis). Pour chaque cache,
    récupère les logs d'amis via ``sf=true`` et enregistre les « Found ».

    Les événements émis sont les mêmes que pour le chemin zone search, plus
    un champ ``gc_code`` dans les ``progress`` pour indiquer la cache courante.
    À la fin, on enregistre un ``FriendZoneScan`` par ami trouvé.
    """
    total_caches = len(gc_codes)
    scanned_caches = 0
    rate_limited = False

    def on_progress(done: int, total: int, gc_code: str):
        # Le callback ne peut pas yield ; on stocke l'état pour le générateur.
        pass

    try:
        result = scan_finds_via_logbook(zone_id, gc_codes, on_progress=on_progress)
        scanned_caches = result['scanned']
        rate_limited = result['rate_limited']
        friend_finds = result['friend_finds']
        errors = result['errors']
    except Exception as exc:  # pragma: no cover - garde-fou
        logger.exception("Unexpected error during logbook scan")
        yield json.dumps({
            'phase': 'error',
            'message': f"Erreur inattendue : {exc}",
        }) + '\n'
        return

    # Émettre un événement progress par cache (rétrospectif, car le scan
    # est synchrone dans scan_finds_via_logbook). En pratique, le scan
    # logbook est rapide (3 requêtes par cache) et on émet le bilan d'un coup.
    for friend, codes in friend_finds.items():
        zone_matches = len(set(codes))
        created, known = store_finds(friend, codes, source='cache_logs')

        record_scan(
            friend_username=friend,
            zone_id=zone_id,
            box=signature_box,
            found_count=len(codes),
            baseline_total=total_caches,
            zone_matches=zone_matches,
            truncated=False,
        )

        yield json.dumps({
            'phase': 'progress',
            'done': len(friend_finds),
            'total': total_to_scan,
            'friend': friend,
            'found': len(codes),
            'zone_matches': zone_matches,
            'created': created,
            'known': known,
            'truncated': False,
            'source': 'cache_logs',
        }) + '\n'

    # Bilan final.
    finds_rows = (
        db.session.query(Geocache.gc_code, FriendFind.friend_username)
        .join(FriendFind, FriendFind.gc_code == Geocache.gc_code)
        .filter(Geocache.zone_id == zone_id)
        .all()
    )
    with_friends = len({row[0] for row in finds_rows})

    yield json.dumps({
        'phase': 'done',
        'scanned': len(friend_finds),
        'skipped': skipped,
        'with_friends': with_friends,
        'rate_limited': rate_limited,
        'strategy': 'logbook',
        'caches_scanned': scanned_caches,
        'cache_errors': len(errors),
    }) + '\n'


@bp.post("/finds/sync-zone-stream")
def sync_zone_finds_stream():
    """
    Analyse **tous les amis** d'une zone en une seule réponse en streaming.

    Réponse en **streaming NDJSON** (une ligne = un objet JSON), comme
    `/finds/import` : le frontend consomme ligne par ligne pour afficher une
    progression réelle, un ETA, et peut interrompre via ``AbortController``.

    Avantages par rapport à la boucle ami par ami côté frontend
    (``sync-zone``) :

    - la boucle est côté serveur : fermer le widget n'interrompt pas
      l'analyse (le navigateur annule la requête, mais le serveur peut
      détecter la déconnexion et s'arrêter proprement) ;
    - le ``Retry-After`` du 429 est respecté côté serveur (le client
      ``GeocachingFriendFindsClient`` retente avec backoff) au lieu
      d'abandonner au premier 429 ;
    - un seul ``fetch`` au lieu de N, moins de overhead ;

    Body JSON : { "zone_id": 1, "force_all": false }

    Lignes émises :

    - ``{ "phase": "start", "total": N, "skipped": M, "to_scan": K }``
    - ``{ "phase": "progress", "done": i, "total": K, "friend": "pseudo",
        "found": 5, "zone_matches": 3, "created": 2, "known": 3 }``
    - ``{ "phase": "rate_limited", "done": i, "total": K, "message": "…" }``
    - ``{ "phase": "error", "friend": "pseudo", "message": "…" }``
    - ``{ "phase": "done", "scanned": K, "skipped": M, "with_friends": N }``
    """
    data = request.get_json(silent=True) or {}
    zone_id = data.get("zone_id")
    force_all = bool(data.get("force_all", False))
    # Filtrer sur un sous-ensemble d'amis (optionnel). Si absent ou vide,
    # on scanne tous les amis. Les pseudos doivent être des chaînes non vides.
    selected_friends = data.get("friends")
    if selected_friends is not None:
        if not isinstance(selected_friends, list):
            return jsonify({"success": False, "error": "invalid_params",
                            "error_message": "friends doit être une liste de pseudos."}), 400
        selected_friends = [f for f in selected_friends if isinstance(f, str) and f.strip()]
        selected_set = {f.strip() for f in selected_friends}
    else:
        selected_set = None

    if not isinstance(zone_id, int):
        return jsonify({"success": False, "error": "invalid_params",
                        "error_message": "zone_id (entier) est requis."}), 400

    if not get_auth_service().is_logged_in():
        return jsonify({
            "success": False,
            "error": "not_authenticated",
            "error_message": "Vous devez être connecté à Geocaching.com pour cette recherche.",
        }), 401

    boxes = _zone_boxes(zone_id)
    if not boxes:
        return jsonify({"success": False, "error": "empty_zone",
                        "error_message": "Cette zone ne contient aucune géocache géolocalisée."}), 400

    def generate():
        from ..services.geocaching_friends import get_friends_client
        from ..services.geocaching_friend_finds import filter_friends_to_scan

        try:
            # Liste d'amis depuis le cache mémoire (pas de réseau).
            friends_result = get_friends_client().get_friends()
            all_friends = [f.username for f in friends_result.friends]
            # Filtrer sur le sous-ensemble demandé (si présent).
            if selected_set is not None:
                all_friends = [f for f in all_friends if f in selected_set]
        except Exception as exc:
            yield json.dumps({
                'phase': 'error',
                'message': f"Impossible de récupérer la liste d'amis : {exc}",
            }) + '\n'
            return

        if not all_friends:
            yield json.dumps({
                'phase': 'done',
                'scanned': 0, 'skipped': 0, 'with_friends': 0,
                'message': "Aucun ami Geocaching.com à analyser.",
            }) + '\n'
            return

        # Scan incrémental : skip les amis dont le scan est frais.
        # On utilise la première boîte comme signature pour la détection
        # d'obsolescence (si la zone change, la signature change).
        signature_box = boxes[0]
        to_scan = all_friends
        skipped = 0
        if not force_all:
            to_scan, fresh = filter_friends_to_scan(zone_id, all_friends, signature_box)
            skipped = len(fresh)

        total_to_scan = len(to_scan)

        if total_to_scan == 0:
            yield json.dumps({
                'phase': 'start',
                'total': len(all_friends),
                'skipped': skipped,
                'to_scan': 0,
                'clusters': len(boxes),
                'strategy': 'none',
            }) + '\n'
            yield json.dumps({
                'phase': 'done',
                'scanned': 0, 'skipped': skipped,
                'with_friends': 0,
                'message': f"Tous vos amis ont déjà été analysés récemment ({skipped}).",
            }) + '\n'
            return

        # --- Choix de la stratégie : logbook (sf=true) vs zone search ---
        # Le logbook est O(caches), la zone search est O(amis × pages).
        # On estime le coût des deux et on choisit le moins cher.
        zone_gc_codes = [
            code for (code,) in db.session.query(Geocache.gc_code)
            .filter(Geocache.zone_id == zone_id).all()
        ]
        nb_caches = len(zone_gc_codes)

        # Estimer le nombre de caches balayées par la zone search (une sonde
        # par cluster). En cas d'erreur, on tombe sur la zone search (sûr).
        searched_total = 0
        try:
            finds_client = get_friend_finds_client()
            for box in boxes:
                searched_total += finds_client.estimate_box_size(box)
        except Exception:
            # Si la sonde échoue, on ne peut pas comparer : on garde la zone
            # search, qui a ses propres garde-fous (retry, fallback).
            searched_total = nb_caches

        use_logbook = should_use_logbook(nb_caches, total_to_scan, searched_total)

        yield json.dumps({
            'phase': 'start',
            'total': len(all_friends),
            'skipped': skipped,
            'to_scan': total_to_scan,
            'clusters': len(boxes),
            'strategy': 'logbook' if use_logbook else 'zone_search',
            'estimated_caches_balayed': searched_total,
        }) + '\n'

        if use_logbook:
            # --- Chemin logbook : scanner les caches une par une ---
            yield from _generate_logbook_scan(
                zone_id, zone_gc_codes, to_scan, skipped, signature_box,
                total_to_scan, len(all_friends),
            )
            return

        # --- Chemin zone search : scanner les amis un par un ---
        client = get_friend_finds_client()
        scanned = 0
        rate_limited = False

        # Les codes de la zone, pour filtrer les trouvailles qui tombent dans
        # la boîte mais n'appartiennent pas à la zone (boîte > zone).
        zone_codes = set(zone_gc_codes)

        for index, friend in enumerate(to_scan):
            # Détection de déconnexion : si le client a fermé la connexion,
            # on s'arrête proprement sans perdre ce qui a déjà été collecté.
            if request.environ.get('werkzeug.socket.disconnected'):
                logger.info("Client disconnected during zone scan, stopping after %d friends", scanned)
                break

            try:
                result = client.find_codes_found_by_multi(friend, boxes)
                # Le replace_scope est l'union des baselines de tous les
                # clusters : on récupère les codes depuis les summaries.
                baseline_codes = list(result.summaries.keys())
                created, known = store_finds(
                    friend,
                    result.found_codes,
                    replace_scope=baseline_codes,
                    summaries=result.summaries,
                )

                zone_matches = len(zone_codes & result.found_codes)

                record_scan(
                    friend_username=friend,
                    zone_id=zone_id,
                    box=signature_box,
                    found_count=len(result.found_codes),
                    baseline_total=result.zone_codes_count,
                    zone_matches=zone_matches,
                    truncated=result.truncated,
                )

                scanned += 1
                yield json.dumps({
                    'phase': 'progress',
                    'done': scanned,
                    'total': total_to_scan,
                    'friend': friend,
                    'found': len(result.found_codes),
                    'zone_matches': zone_matches,
                    'created': created,
                    'known': known,
                    'truncated': result.truncated,
                }) + '\n'

            except RateLimitedError as exc:
                rate_limited = True
                logger.warning("Friend finds rate limited during stream: %s", exc)
                yield json.dumps({
                    'phase': 'rate_limited',
                    'done': scanned,
                    'total': total_to_scan,
                    'message': (
                        f"Geocaching.com limite les recherches : analyse interrompue "
                        f"après {scanned} ami(s). Relancez dans quelques minutes pour continuer."
                    ),
                }) + '\n'
                break

            except NotAuthenticatedError as exc:
                yield json.dumps({
                    'phase': 'error',
                    'friend': friend,
                    'message': str(exc),
                }) + '\n'
                break

            except FriendFindsError as exc:
                logger.error("Failed to compute friend finds for %s: %s", friend, exc)
                yield json.dumps({
                    'phase': 'error',
                    'friend': friend,
                    'message': str(exc),
                }) + '\n'
                # On continue sur les autres amis : une erreur sur un ami
                # ne doit pas arrêter toute l'analyse.

            except Exception as exc:  # pragma: no cover - garde-fou
                logger.exception("Unexpected error scanning %s", friend)
                db.session.rollback()
                yield json.dumps({
                    'phase': 'error',
                    'friend': friend,
                    'message': f"Erreur inattendue : {exc}",
                }) + '\n'

        # Bilan final + rechargement des données locales.
        finds_rows = (
            db.session.query(Geocache.gc_code, FriendFind.friend_username)
            .join(FriendFind, FriendFind.gc_code == Geocache.gc_code)
            .filter(Geocache.zone_id == zone_id)
            .all()
        )
        with_friends = len({row[0] for row in finds_rows})

        yield json.dumps({
            'phase': 'done',
            'scanned': scanned,
            'skipped': skipped,
            'with_friends': with_friends,
            'rate_limited': rate_limited,
        }) + '\n'

    return Response(
        stream_with_context(generate()),
        content_type='application/json',
    )


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

    Une seule requête vers geocaching.com par cluster, pour éviter de lancer à
    l'aveugle une analyse de vingt minutes sur une zone géographiquement
    dispersée. Le clustering découpe la zone en boîtes plus petites : le total
    balayé est la somme des caches de chaque boîte (sans double-compte des
    caches communes à plusieurs boîtes, mais l'estimation reste prudente).
    """
    if not get_auth_service().is_logged_in():
        return jsonify({"success": False, "error": "not_authenticated",
                        "error_message": "Vous devez être connecté à Geocaching.com."}), 401

    boxes = _zone_boxes(zone_id)
    if not boxes:
        return jsonify({"success": False, "error": "empty_zone",
                        "error_message": "Cette zone ne contient aucune géocache géolocalisée."}), 400

    client = get_friend_finds_client()
    total_searched = 0
    cluster_details: list[dict] = []

    try:
        for box in boxes:
            searched = client.estimate_box_size(box)
            total_searched += searched
            cluster_details.append({
                'box': box.box_param,
                'searched_caches': searched,
            })
    except RateLimitedError as exc:
        return jsonify({"success": False, "error": "rate_limited", "error_message": str(exc)}), 429
    except FriendFindsError as exc:
        return jsonify({"success": False, "error": "fetch_failed", "error_message": str(exc)}), 502

    zone_caches = Geocache.query.filter_by(zone_id=zone_id).count()
    pages = max(1, -(-total_searched // client.PAGE_SIZE))

    # Heuristique logbook vs zone search : on a besoin du nombre d'amis.
    try:
        from ..services.geocaching_friends import get_friends_client
        nb_friends = len(get_friends_client().get_friends().friends)
    except Exception:
        nb_friends = 0

    recommended_strategy = 'zone_search'
    if nb_friends > 0 and should_use_logbook(zone_caches, nb_friends, total_searched):
        recommended_strategy = 'logbook'

    return jsonify({
        "success": True,
        "zone_id": zone_id,
        "zone_caches": zone_caches,
        "searched_caches": total_searched,
        "clusters": len(boxes),
        "cluster_details": cluster_details,
        # Une pagination par ami, au débit auto-limité du client.
        "seconds_per_friend": round(pages * client.MIN_INTERVAL_SECONDS),
        "recommended_strategy": recommended_strategy,
        "nb_friends": nb_friends,
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


@bp.get("/finds/zone/<int:zone_id>/scans")
def zone_scans(zone_id: int):
    """
    État des analyses « qui a trouvé quoi » pour chaque ami sur cette zone.

    Lecture purement locale : croise la liste d'amis avec les scans
    enregistrés (``friend_zone_scan``) pour distinguer :

    - **jamais analysé** : ami présent dans la liste mais absent des scans ;
    - **analysé, 0 trouvaille** : scan récent avec ``found_count == 0`` ;
    - **analysé, N trouvailles** : scan récent avec ``found_count > 0`` ;
    - **scan obsolète** : boîte changée ou scan ancien (``is_stale = true``).

    Query params:
        fresh_only : 'true' pour ne retourner que les amis dont le scan est
                     frais (utile pour skip côté frontend). Défaut : false.
    """
    from ..services.geocaching_friend_finds import DEFAULT_SCAN_FRESHNESS_HOURS

    fresh_only = request.args.get("fresh_only", "false").lower() in ("true", "1", "yes")

    # La liste d'amis vient du cache mémoire (pas de réseau) ; si elle
    # échoue, on retourne quand même les scans connus.
    friends_list: list[str] = []
    try:
        if get_auth_service().is_logged_in():
            result = get_friends_client().get_friends()
            friends_list = [f.username for f in result.friends]
    except Exception as exc:
        logger.debug("Friends list unavailable for zone scans: %s", exc)

    scans = get_zone_scans(zone_id)

    # Box actuelle de la zone, pour détecter les scans obsolètes.
    box = _zone_box(zone_id)
    box_sig = box.box_param if box else None

    now = datetime.now(timezone.utc)
    threshold = now - timedelta(hours=DEFAULT_SCAN_FRESHNESS_HOURS)

    entries = []
    for username in friends_list:
        scan = scans.get(username)
        if scan is None:
            entries.append({
                "friend": username,
                "scanned": False,
                "is_stale": True,
                "found_count": None,
                "zone_matches": None,
                "scanned_at": None,
                "truncated": None,
            })
        else:
            scanned_at_str = scan.get("scanned_at")
            scanned_at_dt = None
            if scanned_at_str:
                try:
                    scanned_at_dt = datetime.fromisoformat(scanned_at_str)
                except (ValueError, TypeError):
                    pass
            is_stale = (
                (box_sig is not None and scan["box_signature"] != box_sig)
                or (scanned_at_dt is not None and scanned_at_dt < threshold)
            )
            entries.append({
                "friend": username,
                "scanned": True,
                "is_stale": is_stale,
                "found_count": scan["found_count"],
                "zone_matches": scan["zone_matches"],
                "scanned_at": scan["scanned_at"],
                "truncated": scan["truncated"],
            })

    if fresh_only:
        entries = [e for e in entries if e["scanned"] and not e["is_stale"]]

    # Aussi les amis scannés mais plus dans la liste (compte supprimé, etc.)
    scanned_only = set(scans) - set(friends_list)
    for username in sorted(scanned_only, key=str.casefold):
        scan = scans[username]
        entries.append({
            "friend": username,
            "scanned": True,
            "is_stale": True,
            "found_count": scan["found_count"],
            "zone_matches": scan["zone_matches"],
            "scanned_at": scan["scanned_at"],
            "truncated": scan["truncated"],
            "not_in_friends_list": True,
        })

    return jsonify({
        "success": True,
        "zone_id": zone_id,
        "scans": entries,
        "scanned_count": sum(1 for e in entries if e["scanned"] and not e.get("not_in_friends_list")),
        "fresh_count": sum(1 for e in entries if e["scanned"] and not e["is_stale"]),
        "total_friends": len(friends_list),
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


@bp.get("/events")
def friend_events():
    """
    Events (log types 9/10) du flux d'activité des amis.

    Les events sont agrégés par cache, avec la liste des amis qui y participent.
    Triés par date d'event : à venir d'abord (du plus proche au plus lointain),
    puis passés (du plus récent au plus ancien).

    Query params : ``upcoming`` (défaut true), ``past`` (défaut true),
    ``author`` (filtre par ami), ``include_self`` (défaut false),
    ``limit`` (défaut 100, max 200).
    """
    upcoming = request.args.get('upcoming', 'true').lower() not in ('false', '0', 'no')
    past = request.args.get('past', 'true').lower() not in ('false', '0', 'no')
    author = request.args.get('author') or None
    include_self = request.args.get('include_self', 'false').lower() in ('true', '1', 'yes')
    limit = request.args.get('limit', 100, type=int)
    limit = max(1, min(200, limit))

    result = query_events(
        upcoming=upcoming,
        past=past,
        author=author,
        include_self=include_self,
        limit=limit,
    )
    return jsonify({"success": True, **result})




