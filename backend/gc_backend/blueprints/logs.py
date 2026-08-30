"""Blueprint pour la gestion des logs des géocaches.

Ce module fournit les routes API pour :
- Récupérer les logs stockés d'une géocache
- Rafraîchir les logs depuis Geocaching.com
- Filtrer les logs par type
"""

import logging
from datetime import date as date_type
from datetime import datetime, time as time_type

from flask import Blueprint, jsonify, request

from ..database import db
from ..geocaches.models import Geocache, GeocacheLog
from ..geocaches.archive_service import ArchiveService
from ..services.geocaching_auth import get_auth_service
from ..services.geocaching_friend_finds import store_finds
from ..services.geocaching_logs import (
    FriendLogsCheckFailedError,
    GeocachingLogsClient,
    GeocachingLogsError,
)
from ..services.geocaching_submit_logs import GeocachingSubmitLogsClient

bp = Blueprint('logs', __name__)
logger = logging.getLogger(__name__)

_MAX_LOG_IMAGE_BYTES = 10 * 1024 * 1024
_ALLOWED_LOG_IMAGE_MIME_TYPES = {
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
}


def _get_uploaded_log_image_file():
    uploaded = request.files.get('image_file')
    if not uploaded:
        uploaded = request.files.get('file')
    if not uploaded:
        return None, jsonify({'error': 'image_file is required'}), 400

    content = uploaded.read(_MAX_LOG_IMAGE_BYTES + 1)
    if not content:
        return None, jsonify({'error': 'image_file is empty'}), 400
    if len(content) > _MAX_LOG_IMAGE_BYTES:
        return None, jsonify({'error': 'image_file is too large'}), 413

    content_type = (uploaded.mimetype or request.form.get('mime_type') or '').split(';')[0].strip().lower()
    if content_type not in _ALLOWED_LOG_IMAGE_MIME_TYPES:
        return None, jsonify({'error': 'Unsupported mime type'}), 400

    is_png = content.startswith(b'\x89PNG\r\n\x1a\n')
    is_jpeg = content.startswith(b'\xff\xd8')
    is_webp = content.startswith(b'RIFF') and len(content) > 12 and content[8:12] == b'WEBP'
    if content_type == 'image/png' and not is_png:
        return None, jsonify({'error': 'Invalid PNG file'}), 400
    if content_type in {'image/jpeg', 'image/jpg'} and not is_jpeg:
        return None, jsonify({'error': 'Invalid JPEG file'}), 400
    if content_type == 'image/webp' and not is_webp:
        return None, jsonify({'error': 'Invalid WEBP file'}), 400

    filename = (uploaded.filename or '').strip() or 'upload.jpg'
    return (content, content_type, filename), None, None


@bp.post('/api/geocaches/<int:geocache_id>/logs/images/upload')
def upload_geocache_log_image(geocache_id: int):
    geocache = Geocache.query.get(geocache_id)
    if not geocache:
        return jsonify({'error': 'Geocache not found'}), 404

    upload, error_response, status_code = _get_uploaded_log_image_file()
    if error_response is not None:
        return error_response, status_code

    content, content_type, filename = upload

    client = GeocachingSubmitLogsClient()
    result = client.upload_log_draft_image(filename=filename, content=content, content_type=content_type)
    if not result:
        return jsonify({'error': 'Failed to upload image to Geocaching.com'}), 502

    image_guid = GeocachingSubmitLogsClient.extract_image_guid(result)
    if not image_guid:
        return jsonify({'error': 'Geocaching.com did not return an image GUID', 'gc_response': result}), 502

    return jsonify({'ok': True, 'image_guid': image_guid, 'gc_response': result})


@bp.get('/api/geocaches/<int:geocache_id>/logs')
def get_geocache_logs(geocache_id: int):
    """
    Récupère les logs stockés d'une géocache.
    
    Query params:
        - limit: Nombre maximum de logs à retourner (défaut: 50)
        - offset: Offset pour la pagination (défaut: 0)
        - type: Filtrer par type de log (ex: Found, Note, Did Not Find)
        - friends_only: 'true' pour ne garder que les logs de mes amis

    Returns:
        JSON avec la liste des logs et métadonnées de pagination
    """
    try:
        geocache = Geocache.query.get(geocache_id)
        if not geocache:
            return jsonify({'error': 'Geocache not found'}), 404
        
        # Paramètres de pagination
        limit = request.args.get('limit', 50, type=int)
        offset = request.args.get('offset', 0, type=int)
        log_type_filter = request.args.get('type', None)
        
        friends_only = request.args.get('friends_only', 'false').lower() in ('true', '1', 'yes')

        # Construire la requête
        query = GeocacheLog.query.filter_by(geocache_id=geocache_id)

        # Filtrer par type si spécifié
        if log_type_filter:
            query = query.filter(GeocacheLog.log_type == log_type_filter)

        if friends_only:
            query = query.filter(GeocacheLog.is_friend_log.is_(True))

        # Compter le total avant pagination
        total_count = query.count()

        # Nombre de logs d'amis, indépendant des filtres courants : c'est ce qui
        # permet à l'UI d'afficher/activer le filtre « Amis » à bon escient.
        friends_count = GeocacheLog.query.filter_by(
            geocache_id=geocache_id, is_friend_log=True
        ).count()
        
        # Appliquer tri et pagination
        logs = query.order_by(GeocacheLog.date.desc()) \
                    .offset(offset) \
                    .limit(limit) \
                    .all()
        
        logger.info(f"Returning {len(logs)} logs for geocache {geocache.gc_code} (total: {total_count})")
        
        return jsonify({
            'geocache_id': geocache_id,
            'gc_code': geocache.gc_code,
            'total_count': total_count,
            'friends_count': friends_count,
            'offset': offset,
            'limit': limit,
            'logs': [log.to_dict() for log in logs]
        })
        
    except Exception as e:
        logger.error(f"Error fetching logs for geocache {geocache_id}: {e}")
        return jsonify({'error': str(e)}), 500


# Le logbook de Geocaching.com identifie chaque log par son `LogID` numérique,
# alors que la soumission ne renvoie que le `logReferenceCode` (« GL... »). Le log
# qu'on insère localement juste après l'envoi porte donc un external_id d'une autre
# famille : ce préfixe permet de le reconnaître au rafraîchissement suivant et de
# le remplacer par la ligne officielle au lieu d'afficher deux fois le même log.
_LOCAL_LOG_ID_PREFIX = 'GL'

# Libellés Geocaching.com des types de log qu'on sait soumettre, pour repasser par
# la même normalisation que les logs rafraîchis (`Found`, `Did Not Find`, `Note`).
_LOG_TYPE_LABELS = {2: 'Found it', 3: "Didn't find it", 4: 'Write note'}


def _log_identity(author, log_date, log_type):
    """Clé de rapprochement entre un log local et le même log vu par le logbook.

    Les deux sources n'ont pas d'identifiant commun : on se rabat sur le triplet
    (auteur, date de visite, type), qui suffit ici puisqu'on ne compare que des
    logs d'une même géocache.
    """
    return (
        (author or '').strip().lower(),
        log_date.date() if log_date else None,
        GeocacheLog.normalize_log_type(log_type),
    )


def _store_submitted_log(geocache, *, log_reference_code, text, visited_date,
                         log_type_id, used_favorite_point):
    """Insère en base le log qui vient d'être envoyé sur Geocaching.com.

    Sans ça, la liste locale des logs reste muette sur sa propre contribution
    jusqu'au prochain `/logs/refresh` : tout ce qu'il faut pour la ligne est
    pourtant déjà connu ici (texte, date, type, code du log).

    Returns:
        Le `GeocacheLog` inséré (ou celui déjà présent), None si l'insertion a
        échoué — l'envoi, lui, a réussi et ne doit pas être remis en cause.
    """
    if not log_reference_code:
        return None

    try:
        existing = GeocacheLog.query.filter_by(
            geocache_id=geocache.id, external_id=log_reference_code
        ).first()
        if existing:
            return existing

        author = None
        author_guid = None
        user_info = get_auth_service().get_auth_state().user_info
        if user_info:
            author = user_info.username
            author_guid = user_info.public_guid

        log = GeocacheLog(
            geocache_id=geocache.id,
            external_id=log_reference_code,
            author=author,
            author_guid=author_guid,
            text=text,
            # Date de visite, comme les logs rafraîchis (champ `Visited`) : c'est
            # elle qui donne sa place au log dans la liste triée par date.
            date=datetime.combine(visited_date, time_type.min),
            log_type=GeocacheLog.normalize_log_type(_LOG_TYPE_LABELS.get(log_type_id)),
            is_favorite=bool(used_favorite_point),
            is_friend_log=False,
        )
        db.session.add(log)
        if isinstance(geocache.logs_count, int):
            geocache.logs_count += 1
        db.session.commit()
        return log
    except Exception as e:  # pragma: no cover - insertion best-effort
        logger.warning('Could not store submitted log %s for %s locally: %s',
                       log_reference_code, geocache.gc_code, e)
        db.session.rollback()
        return None


# Geocaching.com refuse un second « Found it » sur la même cache, mais ne
# documente pas de code d'erreur pour ça : on lit d'abord ce que l'enveloppe tRPC
# expose de structuré (code tRPC, statut HTTP porté par l'erreur), et le texte ne
# sert plus qu'en dernier recours — sur le seul message d'erreur, pas sur la
# réponse sérialisée entière, où n'importe quel champ (le texte du log lui-même,
# qui parle volontiers de « cache » et de « log ») pouvait déclencher un faux positif.
_ALREADY_LOGGED_ERROR_CODES = frozenset({
    'CONFLICT',           # code tRPC standard pour « existe déjà »
    'ALREADY_LOGGED',
    'DUPLICATE',
    'DUPLICATE_LOG',
    'LOG_ALREADY_EXISTS',
})

#: Statut HTTP du refus pour doublon, que l'erreur vienne de tRPC ou de l'ancien REST.
_ALREADY_LOGGED_HTTP_STATUS = 409


def _looks_like_already_logged(result) -> bool:
    """L'envoi a-t-il été refusé parce que la cache est déjà loguée ?"""
    if not isinstance(result, dict):
        return False

    error_code = result.get('error_code')
    if isinstance(error_code, str) and error_code.strip().upper() in _ALREADY_LOGGED_ERROR_CODES:
        return True

    # `status` est le code HTTP de la requête, `error_http_status` celui que porte
    # l'enveloppe tRPC quand le lot répond 200 avec l'erreur dans le corps.
    for key in ('error_http_status', 'status'):
        if result.get(key) == _ALREADY_LOGGED_HTTP_STATUS:
            return True

    # Dernier recours : le message renvoyé par Geocaching.com. Il est en anglais
    # aujourd'hui, mais rien ne le garantit — d'où le fait de ne s'y fier qu'ici,
    # et seulement sur le champ qui contient bien un message d'erreur.
    message = result.get('error_message')
    if isinstance(message, str):
        lowered = message.lower()
        if 'already logged' in lowered:
            return True
        if 'already' in lowered and 'log' in lowered:
            return True
        if 'duplicate' in lowered and 'log' in lowered:
            return True

    return False


@bp.post('/api/geocaches/<int:geocache_id>/logs/submit')
def submit_geocache_log(geocache_id: int):
    try:
        geocache = Geocache.query.get(geocache_id)
        if not geocache:
            return jsonify({'error': 'Geocache not found'}), 404

        gc_code = geocache.gc_code
        if not gc_code:
            return jsonify({'error': 'Geocache has no GC code'}), 400

        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return jsonify({'error': 'Invalid JSON payload'}), 400

        images = data.get('images')
        safe_images = None
        if images is not None:
            if not isinstance(images, list):
                return jsonify({'error': 'Invalid images (expected array of strings)'}), 400
            safe_images = []
            for value in images:
                if isinstance(value, str) and value.strip():
                    safe_images.append(value.strip())

        text = data.get('text')
        if not isinstance(text, str) or not text.strip():
            return jsonify({'error': 'Missing log text'}), 400

        raw_date = data.get('date')
        if not isinstance(raw_date, str) or not raw_date.strip():
            return jsonify({'error': 'Missing log date'}), 400
        try:
            visited_date: date_type = datetime.strptime(raw_date.strip(), '%Y-%m-%d').date()
        except ValueError:
            return jsonify({'error': 'Invalid date format (expected YYYY-MM-DD)'}), 400

        log_type = data.get('logType')
        log_type_id = data.get('logTypeId')

        if isinstance(log_type_id, int):
            resolved_log_type_id = log_type_id
        elif isinstance(log_type, str):
            key = log_type.strip().lower()
            mapping = {
                'found': 2,
                'found_it': 2,
                'found it': 2,
                'dnf': 3,
                "didn't find it": 3,
                "didnt find it": 3,
                'note': 4,
                'write note': 4,
            }
            resolved_log_type_id = mapping.get(key)
        else:
            resolved_log_type_id = None

        if not isinstance(resolved_log_type_id, int):
            return jsonify({'error': 'Missing/invalid log type (use logType or logTypeId)'}), 400

        if resolved_log_type_id == 2 and bool(geocache.found):
            return jsonify({
                'error': 'Geocache already logged',
                'error_code': 'ALREADY_LOGGED',
                'geocache_id': geocache_id,
                'gc_code': gc_code,
                'found': bool(geocache.found),
                'found_date': geocache.found_date.isoformat() if geocache.found_date else None,
            }), 409

        favorite = data.get('favorite')
        used_favorite_point = None
        if isinstance(favorite, bool) and resolved_log_type_id == 2:
            used_favorite_point = favorite

        client = GeocachingSubmitLogsClient()
        result = client.submit_geocache_log(
            gc_code,
            log_type_id=resolved_log_type_id,
            log_text=text,
            visited_date=visited_date,
            images=safe_images,
            used_favorite_point=used_favorite_point,
        )
        if not result:
            return jsonify({'error': 'Failed to submit log to Geocaching.com'}), 502

        if not isinstance(result, dict) or not result.get('logReferenceCode'):
            if _looks_like_already_logged(result):
                return jsonify({
                    'error': 'Geocache already logged',
                    'error_code': 'ALREADY_LOGGED',
                    'gc_response': result,
                }), 409
            return jsonify({
                'error': 'Geocaching.com did not return a logReferenceCode',
                'error_code': 'GC_MISSING_LOG_REFERENCE',
                'gc_response': result,
            }), 502

        if resolved_log_type_id == 2:
            geocache.found = True
            # On stocke la date de visite envoyée avec le log, pas l'instant de
            # soumission : loguer aujourd'hui une sortie de la semaine dernière
            # doit laisser la base locale d'accord avec Geocaching.com.
            # Datetime naïf à minuit, comme le scraper (cf. scraper.py, "Logged on:").
            geocache.found_date = datetime.combine(visited_date, time_type.min)
            db.session.commit()
            ArchiveService.sync_from_geocache(geocache)

        log_reference_code = result.get('logReferenceCode')
        stored_log = _store_submitted_log(
            geocache,
            log_reference_code=log_reference_code,
            text=text,
            visited_date=visited_date,
            log_type_id=resolved_log_type_id,
            used_favorite_point=bool(used_favorite_point),
        )

        # Le log vient de modifier les compteurs côté Geocaching.com : on les
        # répercute sur les stats en cache, sinon le prochain log repartirait du
        # même `finds_count` (numéro de cache figé dans le pattern @cache_count).
        try:
            get_auth_service().apply_submitted_log(
                found=(resolved_log_type_id == 2),
                used_favorite_point=bool(used_favorite_point),
            )
        except Exception as e:  # pragma: no cover - mise à jour best-effort
            logger.warning('Could not update cached profile stats after log for %s: %s', gc_code, e)

        return jsonify({
            'geocache_id': geocache_id,
            'gc_code': gc_code,
            'submitted': True,
            'gc_response': result,
            'log_reference_code': log_reference_code,
            'log': stored_log.to_dict() if stored_log else None,
            'found': bool(geocache.found),
            'found_date': geocache.found_date.isoformat() if geocache.found_date else None,
        })

    except Exception as e:  # pragma: no cover
        logger.error('Error submitting log for geocache %s: %s', geocache_id, e)
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@bp.post('/api/geocaches/<int:geocache_id>/logs/refresh')
def refresh_geocache_logs(geocache_id: int):
    """
    Rafraîchit les logs d'une géocache depuis Geocaching.com.
    
    Query params:
        - count: Nombre de logs à récupérer (défaut: 25)
    
    Returns:
        JSON avec le nombre de logs ajoutés/mis à jour
    """
    try:
        geocache = Geocache.query.get(geocache_id)
        if not geocache:
            return jsonify({'error': 'Geocache not found'}), 404
        
        gc_code = geocache.gc_code
        if not gc_code:
            return jsonify({'error': 'Geocache has no GC code'}), 400
        
        # Paramètres
        count = request.args.get('count', 25, type=int)
        
        logger.info(f"Refreshing logs for {gc_code} (count={count})")

        # Récupérer les logs depuis Geocaching.com, en identifiant au passage
        # ceux écrits par mes amis (filtrage côté serveur, cf. get_logs_with_friends).
        client = GeocachingLogsClient()
        friends_check_failed = False
        try:
            fetched_logs, friend_external_ids = client.get_logs_with_friends(gc_code, count=count)
        except FriendLogsCheckFailedError as e:
            # L'appel sf=true a échoué : ce n'est PAS « aucun ami n'a loggué
            # cette cache ». Les logs sont quand même enregistrés (contenu,
            # dates...), mais is_friend_log n'est touché sur aucune ligne —
            # ni existante ni nouvelle — pour ne pas écraser des badges
            # corrects avec un résultat qu'on n'a pas pu vérifier.
            logger.warning(f"Friend check failed for {gc_code}, badges left untouched: {e}")
            fetched_logs = e.logs
            friend_external_ids = None
            friends_check_failed = True

        if not fetched_logs:
            logger.warning(f"No logs found for {gc_code}")
            return jsonify({
                'geocache_id': geocache_id,
                'gc_code': gc_code,
                'message': 'No logs found on Geocaching.com',
                'added': 0,
                'updated': 0
            })
        
        # Récupérer les logs existants par external_id
        existing_logs = {
            log.external_id: log 
            for log in GeocacheLog.query.filter_by(geocache_id=geocache_id).all()
            if log.external_id
        }
        
        # Le log qu'on a inséré soi-même à la soumission n'a pas le même
        # external_id que celui renvoyé par le logbook : sans ce nettoyage, il
        # resterait à côté de la version officielle, en double.
        fetched_identities = {
            _log_identity(log_data.author, log_data.date, log_data.log_type)
            for log_data in fetched_logs
        }
        replaced_local_count = 0
        for existing_log in list(existing_logs.values()):
            if not (existing_log.external_id or '').startswith(_LOCAL_LOG_ID_PREFIX):
                continue
            identity = _log_identity(existing_log.author, existing_log.date, existing_log.log_type)
            if identity in fetched_identities:
                db.session.delete(existing_log)
                existing_logs.pop(existing_log.external_id, None)
                replaced_local_count += 1

        added_count = 0
        updated_count = 0

        for log_data in fetched_logs:
            # `None` si la vérification amis a échoué : dans ce cas on ne sait
            # pas, et on ne doit surtout pas le traduire en `False`.
            is_friend_log = (
                log_data.external_id in friend_external_ids
                if friend_external_ids is not None else None
            )

            if log_data.external_id in existing_logs:
                # Mettre à jour le log existant
                existing_log = existing_logs[log_data.external_id]
                existing_log.text = log_data.text
                existing_log.log_type = GeocacheLog.normalize_log_type(log_data.log_type)
                existing_log.is_favorite = log_data.is_favorite
                if is_friend_log is not None:
                    existing_log.is_friend_log = is_friend_log
                updated_count += 1
            else:
                # Créer un nouveau log. Sans vérification fiable, on ne peut
                # pas faire mieux que `False` par défaut ; friends_check_failed
                # dans la réponse signale qu'il faudra rafraîchir à nouveau.
                new_log = GeocacheLog(
                    geocache_id=geocache_id,
                    external_id=log_data.external_id,
                    author=log_data.author,
                    author_guid=log_data.author_guid,
                    text=log_data.text,
                    date=log_data.date,
                    log_type=GeocacheLog.normalize_log_type(log_data.log_type),
                    is_favorite=log_data.is_favorite,
                    is_friend_log=bool(is_friend_log),
                )
                db.session.add(new_log)
                added_count += 1

        # Mettre à jour le compteur de logs
        geocache.logs_count = GeocacheLog.query.filter_by(geocache_id=geocache_id).count()

        db.session.commit()

        # Compté depuis la base plutôt que depuis friend_external_ids : ça
        # reste correct même quand la vérification amis a échoué (les badges
        # existants n'ont alors pas été touchés).
        friends_count = GeocacheLog.query.filter_by(
            geocache_id=geocache_id, is_friend_log=True
        ).count()

        # Les « Found » d'amis relevés ici alimentent la même table que la
        # déduction par zone : les deux sources convergent vers FriendFind.
        # Rien à en tirer si la vérification amis a échoué : friend_external_ids
        # est alors inconnu.
        if not friends_check_failed:
            friend_finders = {
                log_data.author
                for log_data in fetched_logs
                if log_data.external_id in friend_external_ids
                and GeocacheLog.normalize_log_type(log_data.log_type) == 'Found'
                and log_data.author
            }
            for author in friend_finders:
                store_finds(author, [gc_code], source='cache_logs')

        logger.info(
            f"Refreshed logs for {gc_code}: {added_count} added, {updated_count} updated, "
            f"{replaced_local_count} local replaced, "
            f"{friends_count} from friends" + (" (friend check failed)" if friends_check_failed else "")
        )

        return jsonify({
            'geocache_id': geocache_id,
            'gc_code': gc_code,
            'message': 'Logs refreshed successfully',
            'added': added_count,
            'updated': updated_count,
            'replaced_local': replaced_local_count,
            'friends': friends_count,
            'friends_check_failed': friends_check_failed,
            'total': geocache.logs_count
        })

    except LookupError as e:
        logger.warning(f"Geocache not found on Geocaching.com: {e}")
        return jsonify({'error': 'Geocache not found on Geocaching.com'}), 404

    except GeocachingLogsError as e:
        logger.error(f"Failed to refresh logs for geocache {geocache_id}: {e}")
        return jsonify({'error': str(e)}), 502

    except Exception as e:
        logger.error(f"Error refreshing logs for geocache {geocache_id}: {e}")
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@bp.get('/api/geocaches/<int:geocache_id>/logs/recent-summary')
def get_recent_logs_summary(geocache_id: int):
    """
    Récupère les N logs les plus récents sous forme de résumé léger (type, date, auteur).
    Utilisé pour afficher une série d'icônes représentant l'état récent de la géocache.

    Query params:
        - count: Nombre de logs à retourner (défaut: 5, max: 20)

    Returns:
        JSON avec la liste des entrées de résumé et le nombre total de logs
    """
    try:
        geocache = Geocache.query.get(geocache_id)
        if not geocache:
            return jsonify({'error': 'Geocache not found'}), 404

        count = min(request.args.get('count', 5, type=int), 20)

        logs = GeocacheLog.query.filter_by(geocache_id=geocache_id) \
                                .order_by(GeocacheLog.date.desc()) \
                                .limit(count) \
                                .all()

        total_count = GeocacheLog.query.filter_by(geocache_id=geocache_id).count()

        entries = [
            {
                'log_type': log.log_type,
                'date': log.date.isoformat() if log.date else None,
                'author': log.author,
                'is_favorite': log.is_favorite,
            }
            for log in logs
        ]

        return jsonify({
            'geocache_id': geocache_id,
            'gc_code': geocache.gc_code,
            'total_count': total_count,
            'entries': entries,
        })

    except Exception as e:
        logger.error(f"Error fetching recent logs summary for geocache {geocache_id}: {e}")
        return jsonify({'error': str(e)}), 500


@bp.get('/api/geocaches/<int:geocache_id>/logs/types')
def get_log_types(geocache_id: int):
    """
    Récupère les types de logs disponibles pour une géocache avec leur compte.
    
    Returns:
        JSON avec la liste des types et leur nombre
    """
    try:
        geocache = Geocache.query.get(geocache_id)
        if not geocache:
            return jsonify({'error': 'Geocache not found'}), 404
        
        # Compter les logs par type
        from sqlalchemy import func
        type_counts = db.session.query(
            GeocacheLog.log_type,
            func.count(GeocacheLog.id)
        ).filter_by(geocache_id=geocache_id) \
         .group_by(GeocacheLog.log_type) \
         .all()
        
        types = [
            {'type': log_type, 'count': count}
            for log_type, count in type_counts
        ]
        
        return jsonify({
            'geocache_id': geocache_id,
            'types': types
        })
        
    except Exception as e:
        logger.error(f"Error fetching log types for geocache {geocache_id}: {e}")
        return jsonify({'error': str(e)}), 500


@bp.delete('/api/geocaches/<int:geocache_id>/logs')
def delete_geocache_logs(geocache_id: int):
    """
    Supprime tous les logs d'une géocache.
    
    Returns:
        JSON avec le nombre de logs supprimés
    """
    try:
        geocache = Geocache.query.get(geocache_id)
        if not geocache:
            return jsonify({'error': 'Geocache not found'}), 404
        
        # Compter et supprimer les logs
        deleted_count = GeocacheLog.query.filter_by(geocache_id=geocache_id).delete()
        
        # Mettre à jour le compteur
        geocache.logs_count = 0
        
        db.session.commit()
        
        logger.info(f"Deleted {deleted_count} logs for geocache {geocache.gc_code}")
        
        return jsonify({
            'geocache_id': geocache_id,
            'deleted': deleted_count
        })
        
    except Exception as e:
        logger.error(f"Error deleting logs for geocache {geocache_id}: {e}")
        db.session.rollback()
        return jsonify({'error': str(e)}), 500
