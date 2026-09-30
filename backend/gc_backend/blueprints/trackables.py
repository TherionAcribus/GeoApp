"""Blueprint des trackables (Travel Bugs, geocoins…).

Routes :
- ``GET  /api/trackables/inventory``        mon inventaire (base locale, ``?refresh=1`` pour relire le site,
  ``?max_age=<s>`` pour le relire seulement si le dernier relevé est plus vieux)
- ``GET  /api/trackables/geocache/<gc>``    TBs déclarés dans une cache (idem)
- ``POST /api/trackables/lookup``           retrouver un TB par code public ou code de suivi
  (corps ``{"code": "…"}`` ; jamais dans une URL)
- ``GET  /api/trackables/lookup?code=``     idem, déprécié, codes publics ``TB…`` seulement
- ``GET  /api/trackables/<tb>``             fiche détaillée (JSON + page HTML du site)
- ``GET  /api/trackables/<tb>/log-info``    types de log autorisés et cache courante
- ``POST /api/trackables/<tb>/logs``        loguer un TB seul (découvert, retiré, note…)

Le code de suivi ne sort jamais d'ici : les réponses disent seulement s'il est connu
(``has_tracking_code``). Voir documentation/trackables-technique.md.
"""
from __future__ import annotations

import html as html_lib
import logging
import re
import threading
from datetime import date as date_type
from datetime import datetime, timezone
from time import monotonic
from typing import Optional

from flask import Blueprint, jsonify, request

from ..database import db
from ..models import Trackable
from ..services import trackable_store
from ..services.geocaching_auth import get_auth_service
from ..services.geocaching_friends import NotAuthenticatedError
from ..services.geocaching_submit_logs import (
    TRACKABLE_LOG_TYPES_NEEDING_GEOCACHE,
    GeocachingSubmitLogsClient,
    LogSubmitNetworkError,
)
from ..services.geocaching_trackables import (
    TRACKABLE_LOG_TYPE_LABELS,
    WEBSITE_URL,
    GeocachingTrackablesClient,
    TrackableError,
    TrackableNotFoundError,
    is_public_code,
    normalize_code,
)

bp = Blueprint('trackables', __name__, url_prefix='/api/trackables')
logger = logging.getLogger(__name__)

# Bornes de taille des champs d'un log autonome, vérifiées avant tout appel distant.
_MAX_LOG_TEXT_LENGTH = 10_000
_MAX_TRACKING_CODE_LENGTH = 64
_MAX_GEOCACHE_CODE_LENGTH = 16

# Clés d'opération locales : Geocaching.com ne supporte pas l'idempotence, alors un
# `operationId` fourni par le client garantit qu'un même envoi ne part pas deux
# fois — ni en parallèle (409 `operation_in_flight`), ni en re-clic après coup
# (la réponse mémorisée est rejouée telle quelle pendant _LOG_OPERATION_TTL_SECONDS).
_log_operations: dict[str, dict] = {}
_log_operations_lock = threading.Lock()
_LOG_OPERATION_TTL_SECONDS = 10 * 60
_MAX_OPERATION_ID_LENGTH = 100


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


def _is_stale(last_sync_at, max_age_arg) -> bool:
    """
    Vrai si le relevé date de plus de ``max_age`` secondes. Sans ``max_age`` (ou s'il est
    illisible), la copie locale n'est jamais périmée : seul ``refresh`` force la relecture.
    """
    if max_age_arg is None or last_sync_at is None:
        return False
    try:
        max_age = float(max_age_arg)
        synced = datetime.fromisoformat(last_sync_at)
    except (TypeError, ValueError):
        return False
    if synced.tzinfo is None:
        synced = synced.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - synced).total_seconds() > max_age


def _valid_tb_code(tb_code: str):
    code = normalize_code(tb_code)
    return code if is_public_code(code) else None


# ---------------------------------------------------------------- Inventaires

@bp.get('/inventory')
@_network_errors
def get_inventory():
    """
    Mon inventaire. Sans ``refresh``, la base locale ; au premier appel (jamais relevé),
    ou si le relevé a plus de ``max_age`` secondes, le site est interrogé d'office.

    Un relevé automatique (``max_age``) qui échoue ne cache pas la copie locale : elle
    est servie avec ``sync_error``. Un ``refresh`` explicite, lui, remonte l'erreur.
    """
    report = None
    sync_error = None
    last_sync_at = trackable_store.inventory_last_sync_at()
    explicit = _wants_refresh() or last_sync_at is None
    if explicit or _is_stale(last_sync_at, request.args.get('max_age')):
        try:
            items = GeocachingTrackablesClient().fetch_my_inventory()
            report = trackable_store.save_my_inventory(items).to_dict()
        except (NotAuthenticatedError, TrackableError) as exc:
            if explicit:
                raise
            logger.warning("Trackables: relevé automatique de l'inventaire impossible : %s", exc)
            sync_error = str(exc)

    rows = trackable_store.list_my_inventory()
    return jsonify({
        'success': True,
        # DTO allégé : la section liste n'a besoin ni de l'objectif HTML ni de la
        # localisation ; la fiche (GET /<TB>) garde le DTO complet.
        'trackables': [row.to_list_dict() for row in rows],
        'total': len(rows),
        'last_sync_at': trackable_store.inventory_last_sync_at(),
        'sync': report,
        'sync_error': sync_error,
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
        # La cache courante est implicite (= gc_code) : DTO liste, pas de champ
        # riche (cf. /inventory).
        'trackables': [row.to_list_dict() for row in rows],
        'total': len(rows),
        'synced_at': trackable_store.cache_inventory_synced_at(gc_code),
        'refreshed': refreshed,
    })


# ------------------------------------------------------------------- Un TB

def _lookup(code: str):
    """
    Retrouve un TB. Si le code saisi était son code de suivi, il est gardé en base pour
    le loguer ensuite ; la réponse dit seulement ``tracking_code_matched``.
    """
    summary = GeocachingTrackablesClient().lookup(code)
    row, _ = trackable_store.upsert_trackable(summary)
    db.session.commit()
    return jsonify({
        'success': True,
        'trackable': row.to_dict(),
        'tracking_code_matched': bool(summary.tracking_code),
    })


@bp.post('/lookup')
@_network_errors
def lookup_trackable():
    """Recherche par ``{"code": "…"}`` dans le corps. Le corps n'est jamais journalisé."""
    data = request.get_json(silent=True)
    code = normalize_code(data.get('code')) if isinstance(data, dict) else ''
    if not code:
        return _error('invalid_code', 'Champ « code » requis dans le corps JSON.', 400)
    return _lookup(code)


@bp.get('/lookup')
@_network_errors
def lookup_trackable_get():
    """
    .. deprecated:: le code passe dans l'URL. Encore accepté pour les codes publics
    ``TB…`` ; tout autre code (possible code de suivi) est refusé : utiliser le POST.
    """
    code = normalize_code(request.args.get('code'))
    if not code:
        return _error('invalid_code', 'Paramètre « code » requis.', 400)
    if not is_public_code(code):
        # On ne répète pas le code dans le message : ce peut être un code de suivi.
        logger.info('GET /api/trackables/lookup refusé pour un code non public : passer par le POST.')
        return _error(
            'use_post_lookup',
            'Ce code ne peut pas être recherché en GET : envoyez-le dans le corps de '
            'POST /api/trackables/lookup (un code de suivi ne doit pas figurer dans une URL).',
            400,
        )

    response = _lookup(code)
    response.headers['Deprecation'] = 'true'
    return response


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
      sur la page de log du TB, comme c:geo. Une cache différente de la localisation
      déclarée est refusée (``trackable_location_conflict``) sauf confirmation
      explicite par ``locationConflictConfirmed: true``.
    - la page de log du TB est toujours relue avant l'envoi : un ``logType`` absent
      de ``allowed_log_type_ids`` est refusé sans toucher au site.
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
    if len(text) > _MAX_LOG_TEXT_LENGTH:
        return _error('text_too_long', f'Le texte du log dépasse {_MAX_LOG_TEXT_LENGTH} caractères.', 400)

    raw_date = data.get('date')
    try:
        visited_date: date_type = datetime.strptime(str(raw_date or '').strip(), '%Y-%m-%d').date()
    except ValueError:
        return _error('invalid_date', 'date attendue au format YYYY-MM-DD.', 400)

    provided_tracking = normalize_code(data.get('trackingCode'))
    if len(provided_tracking) > _MAX_TRACKING_CODE_LENGTH:
        return _error('invalid_tracking_code', 'Le code de suivi fourni est invalide.', 400)
    tracking_code = provided_tracking or trackable_store.get_tracking_code(code)
    if not tracking_code and log_type_id != 4:
        return _error(
            'missing_tracking_code',
            'Le code de suivi du trackable est requis pour ce type de log.',
            400,
        )

    geocache_code = normalize_code(data.get('geocacheCode')) or None
    if geocache_code and (len(geocache_code) > _MAX_GEOCACHE_CODE_LENGTH or not geocache_code.startswith('GC')):
        return _error('invalid_geocache', 'geocacheCode doit être un code de géocache (GC…).', 400)

    # Préflight métier : la page de log du TB dit ce que le site autorise *à
    # l'instant T* — types de log permis et cache courante. Le frontend ne fait
    # pas foi.
    info = GeocachingTrackablesClient().fetch_log_page_info(code)
    if log_type_id not in info.allowed_log_type_ids:
        return _error(
            'trackable_action_not_allowed',
            f'Le type de log « {TRACKABLE_LOG_TYPE_LABELS.get(log_type_id, log_type_id)} » '
            'n’est pas autorisé pour ce trackable actuellement.',
            400,
        )

    if log_type_id in TRACKABLE_LOG_TYPES_NEEDING_GEOCACHE:
        if (geocache_code and info.current_geocache_code
                and geocache_code != info.current_geocache_code
                and not data.get('locationConflictConfirmed')):
            return jsonify({
                'success': False,
                'error': 'trackable_location_conflict',
                'error_message': (
                    f'Ce trackable est déclaré dans {info.current_geocache_code}, pas dans '
                    f'{geocache_code} : confirmez ou rafraîchissez sa fiche.'
                ),
                'current_geocache_code': info.current_geocache_code,
                'current_geocache_name': info.current_geocache_name,
            }), 409
        if not geocache_code:
            geocache_code = info.current_geocache_code
            if not geocache_code:
                return _error(
                    'missing_geocache',
                    "Impossible de savoir dans quelle cache se trouve ce trackable : précisez geocacheCode.",
                    400,
                )

    # Clé d'opération : empêche un double envoi (double clic, workers parallèles).
    operation_id = str(data.get('operationId') or '').strip()
    if len(operation_id) > _MAX_OPERATION_ID_LENGTH:
        return _error('invalid_operation_id', 'operationId trop long.', 400)
    existing = _claim_log_operation(operation_id) if operation_id else None
    if existing is not None:
        if existing['state'] == 'in_flight':
            return _error('operation_in_flight', 'Ce log est déjà en cours d’envoi.', 409)
        return jsonify(existing['payload']), existing['status']

    try:
        payload, status = _submit_validated_trackable_log(
            code,
            tracking_code=tracking_code,
            log_type_id=log_type_id,
            text=text,
            visited_date=visited_date,
            geocache_code=geocache_code,
        )
    except Exception:
        if operation_id:
            _release_log_operation(operation_id)
        raise
    if operation_id:
        _store_log_operation(operation_id, payload, status)
    return jsonify(payload), status


# ----------------------------------------------------------- Envoi et résultat

def _submit_validated_trackable_log(code: str, *, tracking_code, log_type_id: int,
                                    text: str, visited_date, geocache_code):
    """Envoie le log déjà validé et classe la réponse. Retourne (payload, statut)."""
    try:
        result = GeocachingSubmitLogsClient().submit_trackable_log(
            code,
            tracking_code=tracking_code,
            log_type_id=log_type_id,
            log_text=text,
            visited_date=visited_date,
            geocache_code=geocache_code,
        )
    except LogSubmitNetworkError as exc:
        return _classify_network_outcome(code, exc, log_type_id=log_type_id,
                                         text=text, visited_date=visited_date,
                                         geocache_code=geocache_code,
                                         tracking_code=tracking_code)

    if not result:
        return {'success': False, 'error': 'submit_failed',
                'error_message': "Échec de l'envoi du log vers Geocaching.com."}, 502

    log_reference_code = result.get('logReferenceCode')
    if not log_reference_code:
        return {'success': False, 'error': 'submit_rejected',
                'error_message': result.get('error_message') or "Geocaching.com n'a pas accepté le log.",
                'gc_response': result}, 502

    return _success_payload(code, log_type_id, geocache_code, log_reference_code,
                            tracking_code=tracking_code), 200


def _classify_network_outcome(code: str, exc: LogSubmitNetworkError, *,
                              log_type_id: int, text: str, visited_date,
                              geocache_code, tracking_code) -> tuple[dict, int]:
    """
    Un POST coupé en vol : on réconcilie avec les logs récents du TB plutôt que
    de supposer un échec — le log a pu être enregistré avant la coupure.
    """
    if exc.outcome == 'network_failed_before_response':
        return {
            'success': False,
            'error': 'network_failed_before_response',
            'error_message': (
                'La connexion a été coupée avant la réponse du site : le log '
                'n’a sans doute pas été envoyé, vous pouvez réessayer.'
            ),
        }, 502

    verdict, entry = _reconcile_submitted_log(code, log_type_id, text, visited_date)
    if verdict == 'confirmed':
        return _success_payload(code, log_type_id, geocache_code, entry.log_reference_code,
                                tracking_code=tracking_code, reconciled='confirmed'), 200
    if verdict == 'absent':
        return {
            'success': False,
            'error': 'submit_failed',
            'reconciled': 'absent',
            'error_message': (
                'Pas de réponse du site et le log n’apparaît pas dans les logs '
                'récents du trackable : vous pouvez réessayer.'
            ),
        }, 502
    return {
        'success': False,
        'error': 'unknown_remote_outcome',
        'reconciled': 'ambiguous',
        'trackable_url': f'{WEBSITE_URL}/track/details.aspx?tracker={code}',
        'error_message': (
            'Résultat distant incertain : le log a peut-être été enregistré. '
            'Vérifiez sur Geocaching.com avant de réessayer.'
        ),
    }, 502


def _success_payload(code: str, log_type_id: int, geocache_code, log_reference_code, *,
                     tracking_code=None, reconciled: Optional[str] = None) -> dict:
    try:
        row = trackable_store.apply_trackable_log(code, log_type_id, tracking_code=tracking_code)
        trackable = row.to_dict()
    except Exception as exc:  # pragma: no cover - le log est parti, la base locale est secondaire
        logger.warning('Could not record trackable log for %s locally: %s', code, exc)
        db.session.rollback()
        trackable = None

    payload = {
        'success': True,
        'log_reference_code': log_reference_code,
        'log_type': {'id': log_type_id, 'label': TRACKABLE_LOG_TYPE_LABELS.get(log_type_id)},
        'geocache_code': geocache_code if log_type_id in TRACKABLE_LOG_TYPES_NEEDING_GEOCACHE else None,
        'trackable': trackable,
    }
    if reconciled:
        payload['reconciled'] = reconciled
    return payload


def _reconcile_submitted_log(code: str, log_type_id: int, text: str, visited_date):
    """
    Cherche dans les logs récents du TB le log qu'on vient peut-être de créer :
    empreinte = type + date + auteur courant + texte normalisé.

    Retourne ``('confirmed', entrée)`` / ``('absent', None)`` / ``('ambiguous', None)`` —
    ambigu quand la fiche est illisible ou l'auteur inconnu : impossible de trancher.
    """
    try:
        state = get_auth_service().get_auth_state()
        author = getattr(getattr(state, 'user_info', None), 'username', None)
    except Exception:  # pragma: no cover - état d'auth local indisponible
        author = None
    if not author:
        return 'ambiguous', None

    try:
        details = GeocachingTrackablesClient().fetch_details(code)
    except (TrackableError, NotAuthenticatedError):
        return 'ambiguous', None

    wanted = _log_text_fingerprint(text, is_html=False)
    for entry in details.logs:
        if (entry.log_type_id == log_type_id
                and entry.log_date == visited_date.isoformat()
                and entry.author_username == author
                and _log_text_fingerprint(entry.text_html, is_html=True) == wanted):
            return ('confirmed', entry) if entry.log_reference_code else ('ambiguous', None)
    return 'absent', None


def _log_text_fingerprint(text, *, is_html: bool) -> str:
    """
    Empreinte de texte pour comparer le corps envoyé (markdown brut) au `text_html`
    rendu par le site : les balises sont retirées côté HTML, puis tout caractère
    non alphanumérique est ignoré — « **super** » et « <strong>super</strong> »
    se rejoignent. Le but est de retrouver *le même* log, pas de prouver qu'un
    texte différent n'existe pas : en cas de doute, la réconciliation répond
    « absent » et l'utilisateur décide.
    """
    if is_html:
        text = re.sub(r'<[^>]+>', '', text or '')
    text = html_lib.unescape(text or '')
    return re.sub(r'[^\w]+', '', text.lower())


# ------------------------------------------------------------- Clés d'opération

def _claim_log_operation(operation_id: str) -> Optional[dict]:
    """Réserve `operation_id` ; retourne l'entrée existante ou None (nouvelle)."""
    with _log_operations_lock:
        now = monotonic()
        for key in [k for k, v in _log_operations.items() if v['expires_at'] <= now]:
            _log_operations.pop(key, None)
        entry = _log_operations.get(operation_id)
        if entry is None:
            _log_operations[operation_id] = {
                'state': 'in_flight',
                'expires_at': now + _LOG_OPERATION_TTL_SECONDS,
            }
        return entry


def _store_log_operation(operation_id: str, payload: dict, status: int) -> None:
    """Mémorise la réponse finie pour rejouer un `operationId` sans renvoyer."""
    with _log_operations_lock:
        _log_operations[operation_id] = {
            'state': 'done',
            'payload': payload,
            'status': status,
            'expires_at': monotonic() + _LOG_OPERATION_TTL_SECONDS,
        }


def _release_log_operation(operation_id: str) -> None:
    """En cas de plantage entre envoi et réponse mémorisée : on libère la clé."""
    with _log_operations_lock:
        _log_operations.pop(operation_id, None)
