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
import math
import re
import threading
from dataclasses import dataclass
from datetime import date as date_type
from datetime import datetime, timezone
from time import monotonic
from typing import Callable, Optional

from flask import Blueprint, jsonify, request

from ..database import db
from ..models import GeocacheTrackable, Trackable
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
    TrackablePartialResultError,
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
        except TrackablePartialResultError as exc:
            logger.warning('Trackables: %s', exc)
            return _error('partial_result', str(exc), 502)
        except TrackableError as exc:
            logger.warning('Trackables: %s', exc)
            return _error('fetch_failed', str(exc), 502)
    return wrapper


def _wants_refresh() -> bool:
    return str(request.args.get('refresh', '')).strip().lower() in ('1', 'true', 'yes')


# ---------------------------------------------------------------- Fraîcheur
#
# Politique commune des copies locales (P2-03) — inventaire personnel,
# inventaire d'une cache, et réutilisable par la fiche/log-info (P2-04) :
#
# - `max_age` borné : un flottant fini >= 0 ; négatif, infini ou illisible est
#   ignoré (copie jamais périmée) — il ne doit pas forcer un rafraîchissement à
#   chaque appel ;
# - single-flight : un verrou par ressource ; un appel concurrent attend le
#   premier puis relit la date de relevé — si celui-ci vient de synchroniser,
#   aucun second appel distant ne part ;
# - garde-fou « relevé vide » : un relevé *automatique* qui revient vide alors
#   que la copie locale ne l'est pas est écarté (réponse tronquée ou plafond
#   serveur probable) ; seul un `refresh=1` explicite confirme un vrai vide.

def _parse_max_age(arg) -> Optional[float]:
    """``max_age`` exploitable en secondes, ou ``None`` = copie jamais périmée."""
    if arg is None:
        return None
    try:
        value = float(arg)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(value) or value < 0:
        return None
    return value


def _is_stale(last_sync_at, max_age: Optional[float]) -> bool:
    """Vrai si le relevé date de plus de ``max_age`` secondes (déjà validé)."""
    if max_age is None or last_sync_at is None:
        return False
    try:
        synced = datetime.fromisoformat(last_sync_at)
    except (TypeError, ValueError):
        return False
    if synced.tzinfo is None:
        synced = synced.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - synced).total_seconds() > max_age


@dataclass
class _SyncOutcome:
    """Bilan d'une tentative de rafraîchissement d'une copie locale."""
    attempted: bool = False       # un appel distant a été fait
    applied: bool = False         # le relevé a été enregistré
    report: object = None         # rapport renvoyé par `apply` (inventaire : sync report)
    sync_error: Optional[str] = None
    # Relevé distant vide écarté : la copie locale non vide a été conservée.
    empty_remote_guarded: bool = False


# Un verrou par ressource synchronisée ('inventory', 'cache:<GC>', …).
_sync_locks: dict[str, threading.Lock] = {}
_sync_locks_guard = threading.Lock()


def _sync_lock(resource: str) -> threading.Lock:
    with _sync_locks_guard:
        return _sync_locks.setdefault(resource, threading.Lock())


def _sync_resource(
    resource: str,
    *,
    force_refresh: bool,
    max_age: Optional[float],
    synced_at: Callable[[], Optional[str]],
    local_count: Callable[[], int],
    fetch: Callable[[], object],
    apply: Callable[[object], object],
) -> _SyncOutcome:
    """
    Synchronise une copie locale selon la politique commune, sous verrou.

    - ``synced_at``/``local_count`` sont relus *dans* le verrou : un appel
      coalescé voit la date que le premier vient d'écrire et ne re-fetch pas ;
    - un relevé part si ``force_refresh``, si la ressource n'a jamais été relevée,
      ou si le relevé est périmé (``max_age``) ;
    - erreurs distantes : remontées quand il n'y a rien de local à servir
      (premier relevé ou refresh explicite), sinon la copie est servie avec
      ``sync_error`` ;
    - relevé automatique vide alors que la copie locale ne l'est pas : écarté
      (`empty_remote_guarded`), la copie est conservée.
    """
    outcome = _SyncOutcome()
    with _sync_lock(resource):
        last_sync = synced_at()
        # Rien à servir localement si le site échoue : l'erreur remonte.
        must_raise = force_refresh or last_sync is None
        if not (must_raise or _is_stale(last_sync, max_age)):
            return outcome
        outcome.attempted = True
        try:
            items = list(fetch())
        except (NotAuthenticatedError, TrackableError) as exc:
            if must_raise:
                raise
            logger.warning('Trackables: relevé automatique de %s impossible : %s', resource, exc)
            outcome.sync_error = str(exc)
            return outcome
        if not must_raise and not items and local_count() > 0:
            outcome.empty_remote_guarded = True
            outcome.sync_error = 'le site renvoie une liste vide'
            logger.warning(
                'Trackables: relevé de %s vide alors que la copie locale est non vide — conservée '
                '(rafraîchissement explicite requis pour confirmer).', resource)
            return outcome
        outcome.report = apply(items)
        outcome.applied = True
    return outcome


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
    est servie avec ``sync_error`` et ``stale``. Un ``refresh`` explicite, lui, remonte
    l'erreur. Politique commune : voir ``_sync_resource``.
    """
    max_age = _parse_max_age(request.args.get('max_age'))
    outcome = _sync_resource(
        'inventory',
        force_refresh=_wants_refresh(),
        max_age=max_age,
        synced_at=trackable_store.inventory_last_sync_at,
        local_count=lambda: Trackable.query.filter_by(in_my_inventory=True).count(),
        fetch=lambda: GeocachingTrackablesClient().fetch_my_inventory(),
        apply=lambda items: trackable_store.save_my_inventory(items).to_dict(),
    )

    synced_at = trackable_store.inventory_last_sync_at()
    rows = trackable_store.list_my_inventory()
    return jsonify({
        'success': True,
        # DTO allégé : la section liste n'a besoin ni de l'objectif HTML ni de la
        # localisation ; la fiche (GET /<TB>) garde le DTO complet.
        'trackables': [row.to_list_dict() for row in rows],
        'total': len(rows),
        'last_sync_at': synced_at,
        'stale': outcome.empty_remote_guarded or _is_stale(synced_at, max_age),
        'sync': outcome.report,
        'sync_error': outcome.sync_error,
        'empty_remote_guarded': outcome.empty_remote_guarded,
    })


@bp.get('/geocache/<gc_code>')
@_network_errors
def get_geocache_inventory(gc_code: str):
    """
    TBs déclarés dans une cache. Même politique que ``/inventory`` : ``refresh``,
    ``max_age``, repli local avec ``sync_error``/``stale`` et garde-fou sur un
    relevé automatique vide.
    """
    gc_code = normalize_code(gc_code)
    if not gc_code.startswith('GC'):
        return _error('invalid_code', f'Code de géocache invalide : {gc_code}', 400)

    max_age = _parse_max_age(request.args.get('max_age'))
    outcome = _sync_resource(
        f'cache:{gc_code}',
        force_refresh=_wants_refresh(),
        max_age=max_age,
        synced_at=lambda: trackable_store.cache_inventory_synced_at(gc_code),
        local_count=lambda: GeocacheTrackable.query.filter_by(gc_code=gc_code).count(),
        fetch=lambda: GeocachingTrackablesClient().fetch_cache_inventory(gc_code),
        apply=lambda items: trackable_store.save_cache_inventory(gc_code, items),
    )

    synced_at = trackable_store.cache_inventory_synced_at(gc_code)
    rows = trackable_store.list_cache_inventory(gc_code)
    return jsonify({
        'success': True,
        'gc_code': gc_code,
        # La cache courante est implicite (= gc_code) : DTO liste, pas de champ
        # riche (cf. /inventory).
        'trackables': [row.to_list_dict() for row in rows],
        'total': len(rows),
        'synced_at': synced_at,
        'stale': outcome.empty_remote_guarded or _is_stale(synced_at, max_age),
        'refreshed': outcome.applied,
        'sync_error': outcome.sync_error,
        'empty_remote_guarded': outcome.empty_remote_guarded,
    })


# ------------------------------------------------------- Cache court (fiche)
#
# `GET /<TB>` coûte deux appels distants séquentiels (JSON + page HTML) et
# `GET /<TB>/log-info` un : ils sont rejoués identiques pendant
# _DETAIL_CACHE_TTL_SECONDS. La session `requests` n'est pas garantie sûre en
# concurrence — on garde le séquentiel et on coalesce par `_sync_lock` ; un
# `?refresh=1` explicite force la relecture.
_DETAIL_CACHE_TTL_SECONDS = 300
_DETAIL_CACHE_MAX_ENTRIES = 2000
_detail_cache: dict[str, tuple[float, dict]] = {}


def _detail_cache_get(key: str):
    entry = _detail_cache.get(key)
    if entry is None:
        return None
    expires_at, payload = entry
    if monotonic() > expires_at:
        _detail_cache.pop(key, None)
        return None
    return payload


def _detail_cache_put(key: str, payload: dict) -> None:
    if len(_detail_cache) >= _DETAIL_CACHE_MAX_ENTRIES:
        # Nettoyage opportuniste des entrées expirées avant de grossir encore.
        now = monotonic()
        for k in [k for k, (exp, _) in _detail_cache.items() if exp < now]:
            _detail_cache.pop(k, None)
    _detail_cache[key] = (monotonic() + _DETAIL_CACHE_TTL_SECONDS, payload)


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

    key = f'trackable:{code}'
    with _sync_lock(key):
        payload = None if _wants_refresh() else _detail_cache_get(key)
        if payload is None:
            client = GeocachingTrackablesClient()
            # `requests.Session` n'est pas garanti sûr en concurrence : les deux
            # lectures restent séquentielles — le cache court absorbe les appels.
            summary = client.fetch_trackable(code)
            details = client.fetch_details(code)
            row, _ = trackable_store.upsert_trackable(summary)
            db.session.commit()
            payload = {
                'success': True,
                'trackable': row.to_dict(),
                'details': details.to_dict(),
            }
            _detail_cache_put(key, payload)
    return jsonify(payload)


@bp.get('/<tb_code>/log-info')
@_network_errors
def get_trackable_log_info(tb_code: str):
    code = _valid_tb_code(tb_code)
    if not code:
        return _error('invalid_code', f'Code de trackable invalide : {normalize_code(tb_code)}', 400)

    key = f'loginfo:{code}'
    with _sync_lock(key):
        info_data = None if _wants_refresh() else _detail_cache_get(key)
        if info_data is None:
            info_data = GeocachingTrackablesClient().fetch_log_page_info(code).to_dict()
            _detail_cache_put(key, info_data)
    # `has_tracking_code` dépend de la base locale (lookup, inventaire) : il est
    # toujours relu, jamais mis en cache.
    row = Trackable.query.filter_by(reference_code=code).one_or_none()
    return jsonify({
        'success': True,
        **info_data,
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
