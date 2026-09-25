"""Blueprint pour la gestion des logs des géocaches.

Ce module fournit les routes API pour :
- Récupérer les logs stockés d'une géocache
- Rafraîchir les logs depuis Geocaching.com
- Filtrer les logs par type
- Conserver l'analyse IA des logs d'une géocache
"""

import json
import logging
import time
from datetime import date as date_type
from datetime import datetime, time as time_type
from pathlib import Path

from flask import Blueprint, Response, jsonify, request, send_file, stream_with_context

from ..database import db
from ..geocaches.models import FIND_LOG_TYPES, Geocache, GeocacheLog, GeocacheLogImage, GeocacheLogsAnalysis
from ..geocaches.archive_service import ArchiveService
from ..geocaches.image_storage import (
    download_image,
    get_log_images_root_dir,
    remove_log_images_dir,
    write_image_file,
)
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
        - own_only: 'true' pour ne garder que mes propres logs

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
        own_only = request.args.get('own_only', 'false').lower() in ('true', '1', 'yes')

        # Construire la requête
        query = GeocacheLog.query.filter_by(geocache_id=geocache_id)

        # Filtrer par type si spécifié
        if log_type_filter:
            query = query.filter(GeocacheLog.log_type == log_type_filter)

        if friends_only:
            query = query.filter(GeocacheLog.is_friend_log.is_(True))

        if own_only:
            query = query.filter(GeocacheLog.is_own_log.is_(True))

        # Compter le total avant pagination
        total_count = query.count()

        # Nombre de logs d'amis, indépendant des filtres courants : c'est ce qui
        # permet à l'UI d'afficher/activer le filtre « Amis » à bon escient.
        friends_count = GeocacheLog.query.filter_by(
            geocache_id=geocache_id, is_friend_log=True
        ).count()

        # Nombre d'amis *distincts*, qui n'est pas le précédent : un ami qui
        # poste un Found puis une note compte deux logs. C'est ce compteur-ci
        # qui est comparable au bandeau « vos amis ont trouvé » de la fiche,
        # lequel parle d'amis et non de logs.
        friends_distinct_count = db.session.query(GeocacheLog.author).filter(
            GeocacheLog.geocache_id == geocache_id,
            GeocacheLog.is_friend_log.is_(True),
            GeocacheLog.author.isnot(None),
        ).distinct().count()

        # Même logique pour « Mes logs » : compteur indépendant des filtres.
        own_count = GeocacheLog.query.filter_by(
            geocache_id=geocache_id, is_own_log=True
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
            # Ce que la cache compte sur Geocaching.com (None si inconnu), à ne
            # pas confondre avec `total_count` qui ne parle que du stock local :
            # c'est l'écart entre les deux qui déclenche la proposition de
            # charger la suite dans le panneau Logs.
            'total_available': geocache.logs_total_available,
            'friends_count': friends_count,
            'friends_distinct_count': friends_distinct_count,
            'own_count': own_count,
            'offset': offset,
            'limit': limit,
            'logs': [log.to_dict() for log in logs]
        })
        
    except Exception as e:
        logger.error(f"Error fetching logs for geocache {geocache_id}: {e}")
        raise


# --- Photos jointes aux logs -------------------------------------------------
#
# Deux états, volontairement séparés : le rafraîchissement n'enregistre que les
# métadonnées (`_sync_log_images`, gratuit), et les octets ne descendent sur
# disque que par un appel explicite à `/images/store`. C'est ce découpage qui
# permet à la préférence `geoApp.logs.downloadImages` de couper réellement le
# trafic vers Geocaching.com, et pas seulement l'écriture disque.


def _safe_resolve_log_image_file(stored_path: str) -> Path:
    """Résout un `stored_path` sous la racine des photos de logs, ou lève.

    Même garde que pour les images de géocache : `stored_path` vient de la base,
    et une valeur corrompue ne doit pas pouvoir servir un fichier pris ailleurs
    sur le disque.
    """
    root = get_log_images_root_dir().resolve()
    full_path = (root / stored_path).resolve()
    if root not in full_path.parents and root != full_path:
        raise ValueError('Invalid stored path')
    return full_path


@bp.post('/api/geocaches/<int:geocache_id>/logs/<int:log_id>/images/store')
def store_geocache_log_images(geocache_id: int, log_id: int):
    """
    Télécharge et range sur disque les photos d'**un** log.

    Volontairement limité à un log : c'est ce qui rend acceptable de le faire
    dans le thread Flask, là où un « toute la cache » sur un logbook de 3000
    logs deviendrait une requête interminable et non annulable. Le panneau
    enchaîne les appels log par log, en les sérialisant de son côté.

    Les photos déjà stockées sont ignorées, ce qui rend l'appel rejouable.

    Returns:
        JSON avec les photos du log à jour, et le compte de celles qui viennent
        d'être téléchargées.
    """
    log = GeocacheLog.query.filter_by(id=log_id, geocache_id=geocache_id).first()
    if not log:
        return jsonify({'error': 'Log not found'}), 404

    stored_count = 0
    failed = []

    for image in log.images:
        if image.stored and image.stored_path:
            continue

        try:
            content, content_type, status_code = download_image(image.source_url)
            if status_code != 200 or not content:
                raise ValueError(f'HTTP {status_code}')

            stored_path, mime_type, byte_size, sha256 = write_image_file(
                geocache_id,
                image.id,
                content,
                content_type,
                image.source_url,
                root=get_log_images_root_dir(),
            )
        except Exception as exc:
            # Une photo retirée de Geocaching.com, ou un format exotique, ne
            # doit pas faire échouer les autres photos du même log.
            logger.warning('Failed to store log image %s (%s): %s', image.id, image.source_url, exc)
            failed.append({'id': image.id, 'error': str(exc)})
            continue

        image.stored = True
        image.stored_path = stored_path
        image.mime_type = mime_type
        image.byte_size = byte_size
        image.sha256 = sha256
        stored_count += 1

    db.session.commit()

    logger.info(
        'Stored %s log image(s) for log %s of geocache %s%s',
        stored_count, log_id, geocache_id,
        f' ({len(failed)} failed)' if failed else '',
    )

    return jsonify({
        'geocache_id': geocache_id,
        'log_id': log_id,
        'stored': stored_count,
        'failed': failed,
        'images': [image.to_dict() for image in log.images],
    })


@bp.get('/api/geocache-log-images/<int:image_id>/content')
def get_geocache_log_image_content(image_id: int):
    """Sert le fichier d'une photo de log stockée localement."""
    image = GeocacheLogImage.query.get(image_id)
    if not image:
        return jsonify({'error': 'Image not found'}), 404

    if not image.stored or not image.stored_path:
        return jsonify({'error': 'Image not stored'}), 404

    try:
        full_path = _safe_resolve_log_image_file(image.stored_path)
    except ValueError:
        return jsonify({'error': 'Invalid stored path'}), 400

    if not full_path.exists():
        return jsonify({'error': 'Stored file missing'}), 404

    return send_file(full_path, mimetype=image.mime_type or None)


@bp.delete('/api/geocaches/<int:geocache_id>/logs/images')
def delete_geocache_log_images(geocache_id: int):
    """
    Efface du disque les photos de logs d'une géocache, sans perdre les logs.

    Les lignes sont conservées et repassent simplement à « connue, non
    stockée » : les photos restent listées dans le panneau, avec le bouton pour
    les récupérer à nouveau. C'est une libération de place, pas un oubli.
    """
    geocache = Geocache.query.get(geocache_id)
    if not geocache:
        return jsonify({'error': 'Geocache not found'}), 404

    remove_log_images_dir(geocache_id)

    cleared = GeocacheLogImage.query.filter_by(geocache_id=geocache_id, stored=True).update(
        {'stored': False, 'stored_path': None, 'mime_type': None, 'byte_size': None, 'sha256': None}
    )
    db.session.commit()

    logger.info('Cleared %s stored log image(s) for geocache %s', cleared, geocache_id)
    return jsonify({'geocache_id': geocache_id, 'cleared': cleared})


# Le logbook de Geocaching.com identifie chaque log par son `LogID` numérique,
# alors que la soumission ne renvoie que le `logReferenceCode` (« GL... »). Le log
# qu'on insère localement juste après l'envoi porte donc un external_id d'une autre
# famille : ce préfixe permet de le reconnaître au rafraîchissement suivant et de
# le remplacer par la ligne officielle au lieu d'afficher deux fois le même log.
_LOCAL_LOG_ID_PREFIX = 'GL'

# Libellés Geocaching.com des types de log qu'on sait soumettre, pour repasser par
# la même normalisation que les logs rafraîchis (`Found`, `Did Not Find`, `Note`).
_LOG_TYPE_LABELS = {2: 'Found it', 3: "Didn't find it", 4: 'Write note', 11: 'Webcam Photo Taken'}

# Types de log qui valent trouvaille. Une Webcam ne se logue pas « Found it »
# (Geocaching.com répond 422 « Cannot log FoundIt on Webcam geocaches ») mais
# « Webcam Photo Taken », comme le fait c:geo (AbstractConnector.getPossibleLogTypes).
_FOUND_LOG_TYPE_ID = 2
_WEBCAM_LOG_TYPE_ID = 11
_FIND_LOG_TYPE_IDS = (_FOUND_LOG_TYPE_ID, _WEBCAM_LOG_TYPE_ID)


def _is_webcam_geocache(geocache) -> bool:
    return 'webcam' in (geocache.type or '').lower()


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


def _sync_log_images(log, geocache_id, images):
    """Aligne les photos connues d'un log sur ce que le logbook vient d'annoncer.

    N'écrit que des **métadonnées** : aucun octet n'est téléchargé ici, pour que
    le rafraîchissement reste aussi rapide qu'avant même sur une cache où un
    quart des logs porte une photo. Le téléchargement est un acte séparé
    (`/logs/<id>/images/store`), piloté par la préférence côté panneau.

    Aucune suppression non plus : une photo retirée de Geocaching.com reste
    consultable en local si on l'avait déjà téléchargée, ce qui est précisément
    l'intérêt d'un stockage hors ligne.

    Returns:
        Nombre de photos nouvellement connues.
    """
    known = {image.external_id: image for image in log.images if image.external_id}
    added = 0

    for image_data in images:
        existing = known.get(image_data.external_id)
        if existing is not None:
            # Le titre et la légende sont éditables par leur auteur sur
            # Geocaching.com ; `source_url` ne bouge pas, mais l'aligner ne
            # coûte rien si le préfixe des images change un jour.
            existing.source_url = image_data.source_url
            existing.title = image_data.title
            existing.description = image_data.description
            existing.taken_at = image_data.taken_at
            continue

        log.images.append(GeocacheLogImage(
            geocache_id=geocache_id,
            external_id=image_data.external_id,
            source_url=image_data.source_url,
            title=image_data.title,
            description=image_data.description,
            taken_at=image_data.taken_at,
            stored=False,
        ))
        added += 1

    return added


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
            # Ce log est le mien par construction : il vient d'être envoyé avec
            # le compte connecté, sans attendre que `sp=true` le confirme.
            is_own_log=True,
        )
        db.session.add(log)
        if isinstance(geocache.logs_count, int):
            geocache.logs_count += 1
        # Le site vient d'enregistrer la même trouvaille (et le même point
        # favori) : on suit ses compteurs plutôt que d'attendre un re-scrape.
        if log.log_type in FIND_LOG_TYPES and isinstance(geocache.finds_count, int):
            geocache.finds_count += 1
        if log.is_favorite and isinstance(geocache.favorites_count, int):
            geocache.favorites_count += 1
        geocache.update_favorites_percent()
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

        if resolved_log_type_id == _FOUND_LOG_TYPE_ID and _is_webcam_geocache(geocache):
            resolved_log_type_id = _WEBCAM_LOG_TYPE_ID
        is_find_log = resolved_log_type_id in _FIND_LOG_TYPE_IDS

        if is_find_log and bool(geocache.found):
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
        if isinstance(favorite, bool) and is_find_log:
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

        if is_find_log:
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
                found=is_find_log,
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
        raise


# Pause entre deux caches dans un rafraîchissement en lot : chaque cache coûte
# déjà plusieurs secondes de réseau à Geocaching.com, la pause ne sert qu'à
# étaler proprement les appels plutôt qu'à les enchaîner au pas de course.
BATCH_LOGS_REFRESH_INTERVAL_SECONDS = 0.5


def _refresh_geocache_logs_core(geocache, count: int, page: int, fetch_all: bool) -> dict:
    """
    Récupère le logbook d'une géocache sur Geocaching.com et l'enregistre.

    Factorise le corps de `POST /logs/refresh` pour le rafraîchissement en lot
    (`POST /logs/refresh-batch`) : les deux appliquent exactement la même
    politique de stockage, de badges amis/propres et de compteurs. Le commit
    est fait ici — dans un lot, chaque cache est donc persistée au fur et à
    mesure, indépendamment du sort des suivantes.

    Returns:
        Le payload résultat (celui que la route unitaire renvoie en JSON).

    Raises:
        LookupError: la cache n'existe pas sur Geocaching.com (404).
        GeocachingLogsError: erreur réseau ou réponse du logbook en échec.
    """
    gc_code = geocache.gc_code
    geocache_id = geocache.id

    logger.info(f"Refreshing logs for {gc_code} (count={count}, page={page}, all={fetch_all})")

    # Récupérer les logs depuis Geocaching.com, en identifiant au passage
    # ceux écrits par mes amis et par mon propre compte (filtrage côté
    # serveur, cf. fetch_logbook).
    client = GeocachingLogsClient()
    friends_check_failed = False
    total_available = None
    truncated = False
    try:
        result = client.fetch_logbook(
            gc_code, count=count, page=page, fetch_all=fetch_all, include_own=True
        )
        fetched_logs = result.logs
        friend_external_ids = result.friend_external_ids
        own_external_ids = result.own_external_ids
        total_available = result.total_available
        truncated = result.truncated
    except FriendLogsCheckFailedError as e:
        # L'appel sf=true a échoué : ce n'est PAS « aucun ami n'a loggué
        # cette cache ». Les logs sont quand même enregistrés (contenu,
        # dates...), mais is_friend_log n'est touché sur aucune ligne —
        # ni existante ni nouvelle — pour ne pas écraser des badges
        # corrects avec un résultat qu'on n'a pas pu vérifier. L'appel
        # sp=true n'a alors pas eu lieu : is_own_log suit la même règle.
        logger.warning(f"Friend check failed for {gc_code}, badges left untouched: {e}")
        fetched_logs = e.logs
        friend_external_ids = None
        own_external_ids = None
        friends_check_failed = True
        total_available = e.total_available

    # Le total annoncé par le logbook prime sur celui lu sur la page de la
    # cache : il vient de la même source que les logs qu'on vient d'écrire.
    if total_available is not None:
        geocache.logs_total_available = total_available

    if not fetched_logs:
        logger.warning(f"No logs found for {gc_code}")
        # Une page vide au-delà de la première n'est pas une anomalie : on a
        # simplement demandé la suite d'un logbook déjà épuisé.
        db.session.commit()
        return {
            'geocache_id': geocache_id,
            'gc_code': gc_code,
            'message': 'No logs found on Geocaching.com',
            'added': 0,
            'updated': 0,
            'friends': 0,
            'total': geocache.logs_count,
            'total_available': geocache.logs_total_available
        }

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
    images_added = 0

    for log_data in fetched_logs:
        # `None` si la vérification amis a échoué : dans ce cas on ne sait
        # pas, et on ne doit surtout pas le traduire en `False`. Même règle
        # pour is_own_log quand l'appel sp=true n'a pas abouti.
        is_friend_log = (
            log_data.external_id in friend_external_ids
            if friend_external_ids is not None else None
        )
        is_own_log = (
            log_data.external_id in own_external_ids
            if own_external_ids is not None else None
        )

        if log_data.external_id in existing_logs:
            # Mettre à jour le log existant
            existing_log = existing_logs[log_data.external_id]
            existing_log.text = log_data.text
            existing_log.log_type = GeocacheLog.normalize_log_type(log_data.log_type)
            existing_log.is_favorite = log_data.is_favorite
            if is_friend_log is not None:
                existing_log.is_friend_log = is_friend_log
            if is_own_log is not None:
                existing_log.is_own_log = is_own_log
            images_added += _sync_log_images(existing_log, geocache_id, log_data.images)
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
                is_own_log=bool(is_own_log),
            )
            images_added += _sync_log_images(new_log, geocache_id, log_data.images)
            db.session.add(new_log)
            added_count += 1

    # Mettre à jour le compteur de logs
    geocache.logs_count = GeocacheLog.query.filter_by(geocache_id=geocache_id).count()

    # Logbook intégralement stocké : les « Found » locaux valent ceux du site, et
    # ce comptage est plus frais que les compteurs lus au dernier scrape de la
    # page. Logbook partiel : on n'y touche pas, ça sous-estimerait le total.
    if (geocache.logs_total_available is not None
            and geocache.logs_count >= geocache.logs_total_available):
        geocache.finds_count = GeocacheLog.query.filter(
            GeocacheLog.geocache_id == geocache_id,
            GeocacheLog.log_type.in_(FIND_LOG_TYPES),
        ).count()
        geocache.update_favorites_percent()

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
        f"{images_added} images, "
        f"{friends_count} from friends" + (" (friend check failed)" if friends_check_failed else "")
    )

    return {
        'geocache_id': geocache_id,
        'gc_code': gc_code,
        'message': 'Logs refreshed successfully',
        'added': added_count,
        'updated': updated_count,
        'replaced_local': replaced_local_count,
        'images_added': images_added,
        'friends': friends_count,
        'friends_check_failed': friends_check_failed,
        'own_check_failed': own_external_ids is None,
        'total': geocache.logs_count,
        'total_available': geocache.logs_total_available,
        'truncated': truncated
    }


@bp.post('/api/geocaches/<int:geocache_id>/logs/refresh')
def refresh_geocache_logs(geocache_id: int):
    """
    Rafraîchit les logs d'une géocache depuis Geocaching.com.

    Query params:
        - count: Nombre de logs à récupérer, càd la taille de page (défaut: 25)
        - page: Numéro de page 1-based du logbook (défaut: 1). `count=100&page=2`
          récupère donc les logs 101 à 200.
        - all: 'true' pour enchaîner les pages jusqu'au bout, dans la limite de
          `MAX_LOGS_FETCH_ALL`. Réservé à une demande explicite de l'utilisateur :
          c'est autant d'allers-retours vers Geocaching.com que de pages.

    Returns:
        JSON avec le nombre de logs ajoutés/mis à jour, et `total_available`,
        le nombre de logs de la cache sur Geocaching.com quand il est connu.
    """
    try:
        geocache = Geocache.query.get(geocache_id)
        if not geocache:
            return jsonify({'error': 'Geocache not found'}), 404

        if not geocache.gc_code:
            return jsonify({'error': 'Geocache has no GC code'}), 400

        # Paramètres
        count = request.args.get('count', 25, type=int)
        page = request.args.get('page', 1, type=int)
        fetch_all = request.args.get('all', 'false').lower() in ('true', '1', 'yes')

        return jsonify(_refresh_geocache_logs_core(geocache, count, page, fetch_all))

    except LookupError as e:
        logger.warning(f"Geocache not found on Geocaching.com: {e}")
        return jsonify({'error': 'Geocache not found on Geocaching.com'}), 404

    except GeocachingLogsError as e:
        logger.error(f"Failed to refresh logs for geocache {geocache_id}: {e}")
        return jsonify({'error': str(e)}), 502

    except Exception as e:
        logger.error(f"Error refreshing logs for geocache {geocache_id}: {e}")
        db.session.rollback()
        raise


@bp.post('/api/geocaches/logs/refresh-batch')
def refresh_geocache_logs_batch():
    """
    Rafraîchit les logs de plusieurs géocaches en une seule réponse NDJSON.

    La boucle vit côté serveur : un seul aller-retour HTTP local au lieu d'un
    par cache, et le serveur peut étaler proprement les appels vers
    Geocaching.com (une pause entre caches) et s'arrêter net si le client se
    déconnecte. Une cache en échec n'interrompt pas le lot.

    Body JSON : `{ "geocache_ids": [1, 2, 3], "count": 25 }`

    Lignes émises (une ligne = un objet JSON) :

    - ``{"phase": "start", "total": N}``
    - ``{"phase": "progress", "done": i, "total": N, ...}`` — le payload est
      celui du rafraîchissement unitaire (`added`, `updated`, `friends`, …)
    - ``{"phase": "error", "done": i, "total": N, "geocache_id": id,
      "gc_code": "…", "message": "…"}``
    - ``{"phase": "rate_limited", "done": i, "total": N, "message": "…"}`` —
      Geocaching.com limite : le lot s'arrête là
    - ``{"phase": "done", "refreshed": K, "failed": M, "failed_ids": […]}``
    """
    data = request.get_json(silent=True) or {}
    ids = data.get('geocache_ids')
    if (not isinstance(ids, list) or not ids
            or any(not isinstance(i, int) or isinstance(i, bool) for i in ids)):
        return jsonify({'error': 'geocache_ids doit être une liste non vide d\'entiers'}), 400

    count = data.get('count', 25)
    if not isinstance(count, int) or isinstance(count, bool) or count < 1:
        count = 25

    if not get_auth_service().is_logged_in():
        return jsonify({'error': 'not_authenticated'}), 401

    def generate():
        total = len(ids)
        yield json.dumps({'phase': 'start', 'total': total}) + '\n'

        refreshed = 0
        failed_ids: list[int] = []

        for index, geocache_id in enumerate(ids):
            # Le client (AbortController) a fermé la connexion : on s'arrête
            # proprement — chaque cache déjà traitée est commitée.
            if request.environ.get('werkzeug.socket.disconnected'):
                logger.info(f"Logs batch refresh aborted by client after {index} geocache(s)")
                break

            geocache = Geocache.query.get(geocache_id)
            if not geocache:
                failed_ids.append(geocache_id)
                yield json.dumps({
                    'phase': 'error', 'done': index + 1, 'total': total,
                    'geocache_id': geocache_id,
                    'message': 'Geocache not found',
                }) + '\n'
            elif not geocache.gc_code:
                failed_ids.append(geocache_id)
                yield json.dumps({
                    'phase': 'error', 'done': index + 1, 'total': total,
                    'geocache_id': geocache_id,
                    'message': 'Geocache has no GC code',
                }) + '\n'
            else:
                try:
                    payload = _refresh_geocache_logs_core(
                        geocache, count=count, page=1, fetch_all=False
                    )
                    refreshed += 1
                    yield json.dumps({
                        'phase': 'progress', 'done': index + 1, 'total': total,
                        **payload,
                    }) + '\n'
                except LookupError:
                    failed_ids.append(geocache_id)
                    yield json.dumps({
                        'phase': 'error', 'done': index + 1, 'total': total,
                        'geocache_id': geocache_id, 'gc_code': geocache.gc_code,
                        'message': 'Geocache not found on Geocaching.com',
                    }) + '\n'
                except GeocachingLogsError as e:
                    failed_ids.append(geocache_id)
                    logger.error(f"Batch logs refresh failed for {geocache.gc_code}: {e}")
                    if '429' in str(e) or 'rate' in str(e).lower():
                        yield json.dumps({
                            'phase': 'rate_limited', 'done': index, 'total': total,
                            'message': (
                                f"Geocaching.com limite les requêtes : lot interrompu "
                                f"après {index} géocache(s). Relancez dans quelques "
                                f"minutes pour continuer."
                            ),
                        }) + '\n'
                        break
                    yield json.dumps({
                        'phase': 'error', 'done': index + 1, 'total': total,
                        'geocache_id': geocache_id, 'gc_code': geocache.gc_code,
                        'message': str(e),
                    }) + '\n'
                except Exception as e:  # pragma: no cover - garde-fou
                    logger.exception(f"Unexpected error refreshing logs for {geocache.gc_code}")
                    db.session.rollback()
                    failed_ids.append(geocache_id)
                    yield json.dumps({
                        'phase': 'error', 'done': index + 1, 'total': total,
                        'geocache_id': geocache_id, 'gc_code': geocache.gc_code,
                        'message': f"Erreur inattendue : {e}",
                    }) + '\n'

            # Étaler les appels vers Geocaching.com : une courte pause entre
            # caches (pas après la dernière).
            if index + 1 < total:
                time.sleep(BATCH_LOGS_REFRESH_INTERVAL_SECONDS)

        yield json.dumps({
            'phase': 'done',
            'refreshed': refreshed,
            'failed': len(failed_ids),
            'failed_ids': failed_ids,
        }) + '\n'

    return Response(
        stream_with_context(generate()),
        content_type='application/json',
    )


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
                'is_own_log': bool(log.is_own_log),
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
        raise


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
        raise


# ------------------------------------------------------- Analyse IA des logs
#
# L'analyse est produite par le frontend (c'est lui qui parle au modèle via
# Theia) ; le backend ne fait que la garder. Une par géocache : la relancer
# remplace la précédente.


@bp.get('/api/geocaches/<int:geocache_id>/logs/analysis')
def get_geocache_logs_analysis(geocache_id: int):
    """
    Renvoie l'analyse IA stockée pour cette géocache.

    `analysis` vaut `null` quand aucune analyse n'a encore été faite : c'est un
    état normal, pas une erreur — le panneau Logs interroge cette route à chaque
    ouverture de géocache.
    """
    geocache = Geocache.query.get(geocache_id)
    if not geocache:
        return jsonify({'error': 'Geocache not found'}), 404

    analysis = GeocacheLogsAnalysis.query.filter_by(geocache_id=geocache_id).first()

    return jsonify({
        'geocache_id': geocache_id,
        'gc_code': geocache.gc_code,
        'analysis': analysis.to_dict() if analysis else None,
    })


@bp.put('/api/geocaches/<int:geocache_id>/logs/analysis')
def save_geocache_logs_analysis(geocache_id: int):
    """
    Enregistre (ou remplace) l'analyse IA des logs d'une géocache.

    Body JSON :
        - content: texte Markdown produit par le modèle (obligatoire)
        - model_id: identifiant du modèle qui a répondu
        - analyzed_count: nombre de logs effectivement soumis au modèle
        - stored_count: nombre de logs en base au moment de l'analyse
        - total_available: nombre de logs sur Geocaching.com (peut être absent)

    Les trois compteurs sont le périmètre de l'analyse : sans eux, impossible de
    dire plus tard « faite sur 50 logs sur 300 » ni de repérer qu'elle a vieilli.
    """
    geocache = Geocache.query.get(geocache_id)
    if not geocache:
        return jsonify({'error': 'Geocache not found'}), 404

    payload = request.get_json(silent=True) or {}
    content = (payload.get('content') or '').strip()
    if not content:
        return jsonify({'error': 'content is required'}), 400

    def _count(key):
        value = payload.get(key)
        return value if isinstance(value, int) and value >= 0 else None

    analysis = GeocacheLogsAnalysis.query.filter_by(geocache_id=geocache_id).first()
    if not analysis:
        analysis = GeocacheLogsAnalysis(geocache_id=geocache_id)
        db.session.add(analysis)

    analysis.content = content
    analysis.model_id = (payload.get('model_id') or None)
    analysis.analyzed_count = _count('analyzed_count')
    analysis.stored_count = _count('stored_count')
    analysis.total_available = _count('total_available')

    db.session.commit()

    logger.info(
        "Stored logs analysis for geocache %s (%s logs analyzed)",
        geocache.gc_code, analysis.analyzed_count
    )

    return jsonify({
        'geocache_id': geocache_id,
        'gc_code': geocache.gc_code,
        'analysis': analysis.to_dict(),
    })


@bp.delete('/api/geocaches/<int:geocache_id>/logs/analysis')
def delete_geocache_logs_analysis(geocache_id: int):
    """Supprime l'analyse IA stockée. Supprimer ce qui n'existe pas n'est pas une erreur."""
    geocache = Geocache.query.get(geocache_id)
    if not geocache:
        return jsonify({'error': 'Geocache not found'}), 404

    deleted = GeocacheLogsAnalysis.query.filter_by(geocache_id=geocache_id).delete()
    db.session.commit()

    return jsonify({'geocache_id': geocache_id, 'deleted': bool(deleted)})


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
        
        # Les photos d'abord : la suppression en masse ci-dessous passe à côté
        # de l'ORM, donc de la cascade `GeocacheLog.images`. Sans ces deux
        # lignes, les lignes de photos survivraient à leurs logs et leurs
        # fichiers resteraient sur le disque indéfiniment.
        remove_log_images_dir(geocache_id)
        GeocacheLogImage.query.filter_by(geocache_id=geocache_id).delete()

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
        raise
