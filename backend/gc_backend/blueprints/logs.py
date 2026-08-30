"""Blueprint pour la gestion des logs des géocaches.

Ce module fournit les routes API pour :
- Récupérer les logs stockés d'une géocache
- Rafraîchir les logs depuis Geocaching.com
- Filtrer les logs par type
"""

import json
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

        def _looks_like_already_logged(payload) -> bool:
            try:
                if isinstance(payload, (dict, list)):
                    text_payload = json.dumps(payload, ensure_ascii=False)
                else:
                    text_payload = str(payload)
                lowered = (text_payload or '').lower()
                if 'already logged' in lowered:
                    return True
                if 'already' in lowered and 'log' in lowered and 'cache' in lowered:
                    return True
                if 'duplicate' in lowered and 'log' in lowered:
                    return True
                return False
            except Exception:
                return False

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
            'log_reference_code': result.get('logReferenceCode') if isinstance(result, dict) else None,
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
            f"{friends_count} from friends" + (" (friend check failed)" if friends_check_failed else "")
        )

        return jsonify({
            'geocache_id': geocache_id,
            'gc_code': gc_code,
            'message': 'Logs refreshed successfully',
            'added': added_count,
            'updated': updated_count,
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
