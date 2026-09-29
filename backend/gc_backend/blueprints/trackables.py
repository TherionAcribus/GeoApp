"""Blueprint des trackables (Travel Bugs, geocoins…).

Routes :
- ``GET  /api/trackables/inventory``        mon inventaire (base locale, ``?refresh=1`` pour relire le site)
- ``GET  /api/trackables/geocache/<gc>``    TBs déclarés dans une cache (idem)
- ``GET  /api/trackables/lookup?code=``     retrouver un TB par code public ou code de suivi
- ``GET  /api/trackables/<tb>``             fiche détaillée (JSON + page HTML du site)
- ``GET  /api/trackables/<tb>/log-info``    types de log autorisés et cache courante
- ``POST /api/trackables/<tb>/logs``        loguer un TB seul (découvert, retiré, note…)

Le code de suivi ne sort jamais d'ici : les réponses disent seulement s'il est connu
(``has_tracking_code``). Voir documentation/trackables-technique.md.
"""
from __future__ import annotations

import logging
from datetime import date as date_type
from datetime import datetime

from flask import Blueprint, jsonify, request

from ..database import db
from ..models import Trackable
from ..services import trackable_store
from ..services.geocaching_friends import NotAuthenticatedError
from ..services.geocaching_submit_logs import (
    TRACKABLE_LOG_TYPES_NEEDING_GEOCACHE,
    GeocachingSubmitLogsClient,
)
from ..services.geocaching_trackables import (
    TRACKABLE_LOG_TYPE_LABELS,
    GeocachingTrackablesClient,
    TrackableError,
    TrackableNotFoundError,
    is_public_code,
    normalize_code,
)

bp = Blueprint('trackables', __name__, url_prefix='/api/trackables')
logger = logging.getLogger(__name__)


def _error(code: str, message: str, status: int):
    return jsonify({'success': False, 'error': code, 'error_message': message}), status


def _network_errors(func):
    """Traduit les erreurs du client en réponses HTTP homogènes (même format que /api/friends)."""
    from functools import wraps

    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except NotAuthenticatedError as exc:
            return _error('not_authenticated', str(exc), 401)
        except TrackableNotFoundError as exc:
            return _error('not_found', str(exc), 404)
        except TrackableError as exc:
            logger.warning('Trackables: %s', exc)
            return _error('fetch_failed', str(exc), 502)
    return wrapper


def _wants_refresh() -> bool:
    return str(request.args.get('refresh', '')).strip().lower() in ('1', 'true', 'yes')


def _valid_tb_code(tb_code: str):
    code = normalize_code(tb_code)
    return code if is_public_code(code) else None


# ---------------------------------------------------------------- Inventaires

@bp.get('/inventory')
@_network_errors
def get_inventory():
    """
    Mon inventaire. Sans ``refresh``, la base locale ; au premier appel (jamais relevé),
    le site est interrogé d'office.
    """
    report = None
    if _wants_refresh() or trackable_store.inventory_last_sync_at() is None:
        items = GeocachingTrackablesClient().fetch_my_inventory()
        report = trackable_store.save_my_inventory(items).to_dict()

    rows = trackable_store.list_my_inventory()
    return jsonify({
        'success': True,
        'trackables': [row.to_dict() for row in rows],
        'total': len(rows),
        'last_sync_at': trackable_store.inventory_last_sync_at(),
        'sync': report,
    })


@bp.get('/geocache/<gc_code>')
@_network_errors
def get_geocache_inventory(gc_code: str):
    gc_code = normalize_code(gc_code)
    if not gc_code.startswith('GC'):
        return _error('invalid_code', f'Code de géocache invalide : {gc_code}', 400)

    refreshed = False
    if _wants_refresh() or trackable_store.cache_inventory_synced_at(gc_code) is None:
        items = GeocachingTrackablesClient().fetch_cache_inventory(gc_code)
        trackable_store.save_cache_inventory(gc_code, items)
        refreshed = True

    rows = trackable_store.list_cache_inventory(gc_code)
    return jsonify({
        'success': True,
        'gc_code': gc_code,
        'trackables': [row.to_dict() for row in rows],
        'total': len(rows),
        'synced_at': trackable_store.cache_inventory_synced_at(gc_code),
        'refreshed': refreshed,
    })


# ------------------------------------------------------------------- Un TB

@bp.get('/lookup')
@_network_errors
def lookup_trackable():
    """
    Retrouve un TB. Si le code saisi était son code de suivi, il est gardé en base pour
    le loguer ensuite ; la réponse dit seulement ``tracking_code_matched``.
    """
    code = normalize_code(request.args.get('code'))
    if not code:
        return _error('invalid_code', 'Paramètre « code » requis.', 400)

    summary = GeocachingTrackablesClient().lookup(code)
    row, _ = trackable_store.upsert_trackable(summary)
    db.session.commit()
    return jsonify({
        'success': True,
        'trackable': row.to_dict(),
        'tracking_code_matched': bool(summary.tracking_code),
    })


@bp.get('/<tb_code>')
@_network_errors
def get_trackable(tb_code: str):
    code = _valid_tb_code(tb_code)
    if not code:
        return _error('invalid_code', f'Code de trackable invalide : {normalize_code(tb_code)}', 400)

    client = GeocachingTrackablesClient()
    summary = client.fetch_trackable(code)
    details = client.fetch_details(code)
    row, _ = trackable_store.upsert_trackable(summary)
    db.session.commit()
    return jsonify({
        'success': True,
        'trackable': row.to_dict(),
        'details': details.to_dict(),
    })


@bp.get('/<tb_code>/log-info')
@_network_errors
def get_trackable_log_info(tb_code: str):
    code = _valid_tb_code(tb_code)
    if not code:
        return _error('invalid_code', f'Code de trackable invalide : {normalize_code(tb_code)}', 400)

    info = GeocachingTrackablesClient().fetch_log_page_info(code)
    row = Trackable.query.filter_by(reference_code=code).one_or_none()
    return jsonify({
        'success': True,
        **info.to_dict(),
        'has_tracking_code': bool(row and row.tracking_code),
    })


@bp.post('/<tb_code>/logs')
@_network_errors
def post_trackable_log(tb_code: str):
    """
    Logue un TB seul. Corps : ``{logType: int, text, date: "YYYY-MM-DD",
    trackingCode?, geocacheCode?}``.

    - ``trackingCode`` : à défaut, celui connu en base (TB de mon inventaire, ou déjà
      retrouvé par son code de suivi). Obligatoire pour découvrir, retirer ou prendre.
    - ``geocacheCode`` : pour « Retiré de la cache » ; à défaut, la cache courante lue
      sur la page de log du TB, comme c:geo.
    """
    code = _valid_tb_code(tb_code)
    if not code:
        return _error('invalid_code', f'Code de trackable invalide : {normalize_code(tb_code)}', 400)

    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return _error('invalid_payload', 'Corps JSON invalide.', 400)

    log_type_id = data.get('logType')
    if isinstance(log_type_id, bool) or not isinstance(log_type_id, int) or log_type_id not in TRACKABLE_LOG_TYPE_LABELS:
        return _error('invalid_log_type', 'logType doit être un type de log trackable (4, 13, 19, 48…).', 400)

    text = data.get('text')
    if not isinstance(text, str) or not text.strip():
        return _error('missing_text', 'Le texte du log est requis.', 400)

    raw_date = data.get('date')
    try:
        visited_date: date_type = datetime.strptime(str(raw_date or '').strip(), '%Y-%m-%d').date()
    except ValueError:
        return _error('invalid_date', 'date attendue au format YYYY-MM-DD.', 400)

    tracking_code = normalize_code(data.get('trackingCode')) or trackable_store.get_tracking_code(code)
    if not tracking_code and log_type_id != 4:
        return _error(
            'missing_tracking_code',
            'Le code de suivi du trackable est requis pour ce type de log.',
            400,
        )

    geocache_code = normalize_code(data.get('geocacheCode')) or None
    if log_type_id in TRACKABLE_LOG_TYPES_NEEDING_GEOCACHE and not geocache_code:
        geocache_code = GeocachingTrackablesClient().fetch_log_page_info(code).current_geocache_code
        if not geocache_code:
            return _error(
                'missing_geocache',
                "Impossible de savoir dans quelle cache se trouve ce trackable : précisez geocacheCode.",
                400,
            )

    result = GeocachingSubmitLogsClient().submit_trackable_log(
        code,
        tracking_code=tracking_code,
        log_type_id=log_type_id,
        log_text=text,
        visited_date=visited_date,
        geocache_code=geocache_code,
    )
    if not result:
        return _error('submit_failed', "Échec de l'envoi du log vers Geocaching.com.", 502)
    if not result.get('logReferenceCode'):
        return jsonify({
            'success': False,
            'error': 'submit_rejected',
            'error_message': result.get('error_message') or "Geocaching.com n'a pas accepté le log.",
            'gc_response': result,
        }), 502

    try:
        row = trackable_store.apply_trackable_log(code, log_type_id, tracking_code=tracking_code)
        trackable = row.to_dict()
    except Exception as exc:  # pragma: no cover - le log est parti, la base locale est secondaire
        logger.warning('Could not record trackable log for %s locally: %s', code, exc)
        db.session.rollback()
        trackable = None

    return jsonify({
        'success': True,
        'log_reference_code': result.get('logReferenceCode'),
        'log_type': {'id': log_type_id, 'label': TRACKABLE_LOG_TYPE_LABELS.get(log_type_id)},
        'geocache_code': geocache_code if log_type_id in TRACKABLE_LOG_TYPES_NEEDING_GEOCACHE else None,
        'trackable': trackable,
    })
