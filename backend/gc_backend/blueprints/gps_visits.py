"""Blueprint des visites GPS Garmin.

Routes :
- ``GET  /api/gps-visits/detect``   GPS branchés (dossier ``Garmin`` : visites, traces, GPX)
- ``POST /api/gps-visits/import``   import du GPS (``{"device": "<racine Garmin>"}``), de
  fichiers déposés (multipart ``files`` : visites XML/TXT, traces et GPX de caches), ou
  d'un chemin renvoyé par ``detect`` (``{"path": "…"}``)
- ``POST /api/gps-visits/position`` positionner des visites sur les traces du GPS
  (``{"days"?: [...]}``) ; ``GET /api/gps-visits/tracks?days=`` tracés des jours
- ``POST /api/gps-visits/cutoff``   point de départ : ``{"since": "AAAA-MM-JJ"}``
- ``GET  /api/gps-visits``          visites réduites et groupées par jour
  (``?state=pending,logged,ignored&from=&to=&max_days=``)
- ``POST /api/gps-visits/state``    ``{"ids": [...], "state": "pending|logged|ignored"}``
- ``POST /api/gps-visits/prepare``  récapitulatif de la sortie : ``{"visit_ids" | "day", "zone_id"?}``
- ``POST /api/gps-visits/zone-operations``  ajout en flux des caches à la zone de la sortie
  (copie si connue ailleurs, jamais de déplacement) ; ``GET …/<id>``, ``POST …/<id>/cancel``

Voir documentation/garmin-visites-technique.md.
"""
from __future__ import annotations

import glob
import json
import logging
import os
import re
import time
from datetime import date, datetime, timezone

from flask import Blueprint, Response, jsonify, request, stream_with_context

from ..database import db
from ..models import AppConfig, GpsTrackDay, Zone
from ..services import gps_device, gps_visit_store
from ..services.garmin_tracks import file_start_date
from ..services.garmin_visits import is_logs_xml, normalize_code, parse_any

bp = Blueprint('gps_visits', __name__, url_prefix='/api/gps-visits')
logger = logging.getLogger(__name__)

# Un fichier de 14 000 visites pèse ~1,4 Mo en UTF-16 : la borne laisse une large marge.
MAX_VISITS_FILE_BYTES = 20 * 1024 * 1024
# GPX déposés (traces, Pocket Queries) : le plus gros fichier du GPS réel fait 8 Mo.
MAX_GPX_FILE_BYTES = 50 * 1024 * 1024

GARMIN_DIR = 'Garmin'
VISITS_FILE_NAMES = ('geocache_logs.xml', 'geocache_visits.txt')
LAST_DEVICE_KEY = 'gps_visits.last_device_root'

# GetDriveTypeW : 2 = amovible, 3 = fixe. Les lecteurs réseau (4) et optiques (5)
# sont ignorés : un lecteur réseau déconnecté peut bloquer plusieurs secondes.
_SCANNED_DRIVE_TYPES = (2, 3)


def _error(code: str, message: str, status: int):
    return jsonify({'error': code, 'error_message': message}), status


def _windows_drives() -> list[str]:
    import ctypes
    import string

    drives = os.listdrives() if hasattr(os, 'listdrives') else [f'{letter}:\\' for letter in string.ascii_uppercase]
    kernel32 = ctypes.windll.kernel32
    return [d for d in drives if kernel32.GetDriveTypeW(d) in _SCANNED_DRIVE_TYPES]


def _mount_points() -> list[str]:
    if os.name == 'nt':
        return _windows_drives()
    mounts: list[str] = []
    for pattern in ('/media/*/*', '/media/*', '/run/media/*/*', '/Volumes/*'):
        mounts.extend(glob.glob(pattern))
    return mounts


def _same_path(a: str, b: str) -> bool:
    return os.path.normcase(os.path.abspath(a)) == os.path.normcase(os.path.abspath(b))


def detect_devices() -> list[dict]:
    """GPS branchés : dossiers ``Garmin`` qui contiennent un fichier de visites."""
    devices: list[dict] = []
    seen: set[str] = set()
    for mount in _mount_points():
        root = os.path.join(mount, GARMIN_DIR)
        key = os.path.normcase(os.path.abspath(root))
        if key in seen:
            continue
        seen.add(key)
        try:
            if not os.path.isdir(root):
                continue
            info = gps_device.layout(root)
            if not info.visits_file:
                continue
            modified = os.path.getmtime(info.visits_file)
        except OSError:
            continue
        devices.append({
            **info.to_dict(),
            'modified': datetime.fromtimestamp(modified, tz=timezone.utc).isoformat(),
        })
    return devices


def detect_visit_files() -> list[dict]:
    """Fichiers de visites (XML, TXT) présents sur les GPS branchés."""
    files: list[dict] = []
    for mount in _mount_points():
        for name in VISITS_FILE_NAMES:
            path = os.path.join(mount, GARMIN_DIR, name)
            try:
                if os.path.isfile(path):
                    stat = os.stat(path)
                    files.append({'path': path, 'size': stat.st_size,
                                  'modified': datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()})
            except OSError:
                continue
    return files


@bp.get('/detect')
def detect():
    return jsonify({'devices': detect_devices(), 'files': detect_visit_files()})


def _read_detected_path(raw_path: str) -> tuple[bytes | None, tuple | None]:
    """Lit un chemin, seulement s'il fait partie de ce que ``detect`` trouve à cet instant."""
    if not any(_same_path(raw_path, f['path']) for f in detect_visit_files()):
        return None, _error('path_not_detected', "Ce fichier n'est pas un fichier de visites détecté sur un GPS branché.", 400)
    try:
        if os.path.getsize(raw_path) > MAX_VISITS_FILE_BYTES:
            return None, _error('file_too_large', 'Fichier de visites trop volumineux.', 413)
        with open(raw_path, 'rb') as handle:
            return handle.read(), None
    except OSError as exc:
        logger.warning('Lecture impossible de %s : %s', raw_path, exc)
        return None, _error('read_failed', "Le fichier n'a pas pu être lu (GPS débranché ?).", 400)


def _uploaded_gpx_dir() -> str:
    """GPX de caches déposés (GPS en MTP) : gardés pour créer les caches sans réseau."""
    from ..config import Config

    path = os.path.join(Config.DATA_DIR, 'gps_device_gpx')
    os.makedirs(path, exist_ok=True)
    return path


_SAFE_NAME_RE = re.compile(r'[^A-Za-z0-9._ -]')


def _collect_uploads() -> tuple[list[tuple[str, bytes]], list[gps_device.TrackSource], list[str], tuple | None]:
    """Fichiers déposés : (visites [nom, contenu]), traces, GPX de caches enregistrés."""
    uploads = request.files.getlist('files') + ([request.files['visitsFile']] if 'visitsFile' in request.files else [])
    visits: list[tuple[str, bytes]] = []
    tracks: list[gps_device.TrackSource] = []
    cache_gpx: list[str] = []
    for upload in uploads:
        name = os.path.basename(upload.filename or 'fichier')
        data = upload.read(MAX_GPX_FILE_BYTES + 1)
        if len(data) > MAX_GPX_FILE_BYTES:
            return [], [], [], _error('file_too_large', f'Fichier trop volumineux : {name}.', 413)
        lowered = name.lower()
        if lowered.endswith('.gpx'):
            if b'<trk' in data:
                tracks.append(gps_device.TrackSource(name, (lambda d=data: d), archive=file_start_date(name) is not None))
            elif b'groundspeak' in data[:5000].lower() or b'<groundspeak:cache' in data:
                path = os.path.join(_uploaded_gpx_dir(), _SAFE_NAME_RE.sub('_', name))
                with open(path, 'wb') as handle:
                    handle.write(data)
                cache_gpx.append(path)
            continue
        if len(data) > MAX_VISITS_FILE_BYTES:
            return [], [], [], _error('file_too_large', 'Fichier de visites trop volumineux.', 413)
        visits.append((name, data))
    # Le XML d'abord : il porte le décalage et les secondes, le TXT complète ensuite.
    visits.sort(key=lambda item: 0 if is_logs_xml(item[1]) else 1)
    return visits, tracks, cache_gpx, None


def _import_visit_sources(visits: list[tuple[str, bytes]], tz) -> tuple[dict | None, tuple | None]:
    report = None
    for name, data in visits:
        parsed = parse_any(data)
        if not parsed.visits and parsed.unreadable:
            if report is None and len(visits) == 1:
                return None, _error('not_a_visits_file', "Ce fichier ne ressemble pas à un fichier de visites Garmin.", 400)
            continue
        current = gps_visit_store.import_visits(parsed, source=name, tz=tz).to_dict()
        if report is None:
            report = current
        else:
            report['new'] += current['new']
            report['enriched'] += current['enriched']
    if report is None:
        return None, _error('missing_file', 'Aucun fichier de visites fourni.', 400)
    return report, None


@bp.post('/import')
def import_visits():
    tz = gps_visit_store.get_local_tz()
    tracks: list[gps_device.TrackSource] = []
    cache_gpx: list[str] = []
    body = request.get_json(silent=True) or {}
    try:
        if request.files:
            visits, tracks, cache_gpx, error = _collect_uploads()
            if error:
                return error
            source = 'fichiers déposés'
        elif isinstance(body.get('device'), str) and body['device'].strip():
            root = body['device'].strip()
            if not any(_same_path(root, d['root']) for d in detect_devices()):
                return _error('device_not_detected', "Ce GPS n'est pas (ou plus) branché.", 400)
            info = gps_device.layout(root)
            visits = []
            for path in (info.logs_xml, info.visits_txt):
                if path and os.path.getsize(path) <= MAX_VISITS_FILE_BYTES:
                    with open(path, 'rb') as handle:
                        visits.append((path, handle.read()))
            tracks = gps_device.device_track_sources(info)
            cache_gpx = info.cache_gpx
            AppConfig.set_value(LAST_DEVICE_KEY, root)
            source = root
        else:
            raw_path = body.get('path')
            if not isinstance(raw_path, str) or not raw_path.strip():
                return _error('missing_file', 'Aucun fichier de visites fourni.', 400)
            data, error = _read_detected_path(raw_path.strip())
            if error:
                return error
            visits = [(raw_path.strip(), data)]
            source = raw_path.strip()

        report, error = _import_visit_sources(visits, tz)
        if error:
            return error
        device_report: dict = {'source': source}
        if cache_gpx:
            device_report['gpx_indexed'] = gps_device.index_cache_gpx(cache_gpx)
        if tracks:
            if report['needs_cutoff']:
                # Avant le point de départ, tout est « à loguer » : on ne lit pas 14 ans de traces.
                device_report['positioning'] = 'after_cutoff'
            else:
                device_report.update(gps_device.position_visits(tracks, tz=tz))
                device_report['positioning'] = 'done'
        report['device'] = device_report
        return jsonify(report)
    except Exception:
        db.session.rollback()
        raise


def _parse_days(raw) -> tuple[list[date] | None, tuple | None]:
    if raw is None:
        return None, None
    if not isinstance(raw, list):
        return None, _error('invalid_days', 'days doit être une liste de dates.', 400)
    days = []
    for value in raw:
        try:
            days.append(date.fromisoformat(str(value)))
        except ValueError:
            return None, _error('invalid_date', f'Date invalide : {value}', 400)
    return days, None


@bp.post('/position')
def position_visits():
    """
    Positionne des visites sur les traces du GPS branché (le dernier importé, ou ``device``).
    Sans ``days`` : les visites à loguer pas encore positionnées ; avec : toutes celles
    de ces jours (pour le rattachement des visites anciennes).
    """
    body = request.get_json(silent=True) or {}
    days, error = _parse_days(body.get('days'))
    if error:
        return error
    root = body.get('device') or AppConfig.get_value(LAST_DEVICE_KEY)
    if not root or not any(_same_path(root, d['root']) for d in detect_devices()):
        return _error('device_not_connected', 'Branche le GPS : ses traces sont nécessaires pour positionner les visites.', 409)
    sources = gps_device.device_track_sources(gps_device.layout(root))
    result = gps_device.position_visits(sources, days=days, tz=gps_visit_store.get_local_tz())
    return jsonify(result)


@bp.get('/tracks')
def day_tracks():
    raw = [d.strip() for d in (request.args.get('days') or '').split(',') if d.strip()]
    rows = GpsTrackDay.query.filter(GpsTrackDay.day.in_(raw)).all() if raw else []
    return jsonify({'tracks': [row.to_dict() for row in rows]})


def _parse_day(raw, field: str) -> tuple[date | None, tuple | None]:
    if raw in (None, ''):
        return None, None
    try:
        return date.fromisoformat(str(raw)), None
    except ValueError:
        return None, _error('invalid_date', f'Date invalide pour {field} (attendu AAAA-MM-JJ).', 400)


@bp.post('/cutoff')
def set_cutoff():
    body = request.get_json(silent=True) or {}
    since, error = _parse_day(body.get('since'), 'since')
    if error:
        return error
    if since is None:
        return _error('missing_since', 'Point de départ manquant.', 400)
    result = gps_visit_store.apply_cutoff(since, tz=gps_visit_store.get_local_tz())
    return jsonify(result)


@bp.get('')
def list_visits():
    states = [s.strip() for s in (request.args.get('state') or 'pending').split(',') if s.strip()]
    invalid = [s for s in states if s not in gps_visit_store.STATES]
    if invalid:
        return _error('invalid_state', f'État inconnu : {", ".join(invalid)}', 400)
    from_day, error = _parse_day(request.args.get('from'), 'from')
    if error:
        return error
    to_day, error = _parse_day(request.args.get('to'), 'to')
    if error:
        return error
    try:
        max_days = max(1, min(int(request.args.get('max_days') or gps_visit_store.DEFAULT_MAX_DAYS), 3650))
    except ValueError:
        return _error('invalid_max_days', 'max_days doit être un entier.', 400)
    return jsonify(gps_visit_store.list_grouped(
        states=states, from_day=from_day, to_day=to_day, max_days=max_days,
        tz=gps_visit_store.get_local_tz(),
    ))


@bp.post('/state')
def set_state():
    body = request.get_json(silent=True) or {}
    ids = body.get('ids')
    state = body.get('state')
    if not isinstance(ids, list) or not all(isinstance(i, int) for i in ids):
        return _error('invalid_ids', 'ids doit être une liste d\'entiers.', 400)
    if state not in gps_visit_store.USER_SETTABLE_STATES:
        return _error('invalid_state', 'État attendu : pending, logged ou ignored.', 400)
    updated = gps_visit_store.set_state(ids, state)
    return jsonify({'updated': updated, 'state': state})


def _parse_visit_ids(body: dict) -> tuple[list[int] | None, tuple | None]:
    """``visit_ids`` (liste d'entiers) ou, à défaut, ``day`` : toutes les visites à loguer du jour."""
    raw_ids = body.get('visit_ids')
    if raw_ids is not None:
        if not isinstance(raw_ids, list) or not all(isinstance(i, int) for i in raw_ids):
            return None, _error('invalid_ids', "visit_ids doit être une liste d'entiers.", 400)
        return raw_ids, None
    day, error = _parse_day(body.get('day'), 'day')
    if error:
        return None, error
    if day is None:
        return None, _error('missing_selection', 'Visites à préparer manquantes (visit_ids ou day).', 400)
    return gps_visit_store.pending_visit_ids_of_day(day, gps_visit_store.get_local_tz()), None


@bp.post('/prepare')
def prepare_selection():
    """Récapitulatif de « Préparer la sortie » : ``{"visit_ids" | "day", "zone_id"?}``."""
    body = request.get_json(silent=True) or {}
    visit_ids, error = _parse_visit_ids(body)
    if error:
        return error
    zone_id = body.get('zone_id')
    if zone_id is not None and not isinstance(zone_id, int):
        return _error('invalid_zone', 'zone_id doit être un entier.', 400)
    return jsonify(gps_visit_store.prepare_selection(visit_ids, zone_id=zone_id, tz=gps_visit_store.get_local_tz()))


# Pause entre deux téléchargements de cache : même rythme que l'import d'une liste.
DOWNLOAD_INTERVAL_SECONDS = 0.2

_IMPORT_ERROR_LABELS = {
    'gc_not_found': 'introuvable sur Geocaching.com (archivée ou code faux ?)',
    'gc_timeout': 'Geocaching.com ne répond pas',
}

_OPERATION_ID_RE = re.compile(r'^[A-Za-z0-9-]{8,64}$')


def _import_error_label(exc: Exception) -> str:
    text = str(exc)
    for key, label in _IMPORT_ERROR_LABELS.items():
        if key in text:
            return label
    return text or exc.__class__.__name__


def _line(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False) + '\n'


@bp.post('/zone-operations')
def start_zone_operation():
    """
    Ajoute à la zone de la sortie les caches des visites sélectionnées, en flux NDJSON.

    Corps : ``{"operation_id", "zone_id" | "new_zone_name", "visit_ids"}``. Une cache
    déjà connue ailleurs est copiée dans la zone (jamais déplacée), une cache absente
    est téléchargée. Chaque cache est notée au journal : ``POST
    /zone-operations/<id>/cancel`` arrête l'ajout entre deux caches et retire ce qui
    a été ajouté.
    """
    from ..geocaches.importer import GeocacheImporter
    from ..services import gps_zone_operations as operations
    from ..services.zone_membership import ACTION_CREATED, add_to_zone

    body = request.get_json(silent=True) or {}
    operation_id = body.get('operation_id')
    if not isinstance(operation_id, str) or not _OPERATION_ID_RE.match(operation_id):
        return _error('invalid_operation', "operation_id manquant ou invalide.", 400)
    if operations.get(operation_id) is not None:
        return _error('operation_exists', 'Cet ajout a déjà été lancé.', 409)
    zone_id = body.get('zone_id')
    new_zone_name = (body.get('new_zone_name') or '').strip() if isinstance(body.get('new_zone_name'), str) else ''
    if zone_id is None and not new_zone_name:
        return _error('missing_zone', 'Zone de la sortie manquante.', 400)
    if zone_id is not None:
        if not isinstance(zone_id, int) or db.session.get(Zone, zone_id) is None:
            return _error('zone_not_found', 'Zone introuvable.', 404)
    elif Zone.query.filter_by(name=new_zone_name).first() is not None:
        return _error('zone_exists', f'Une zone « {new_zone_name} » existe déjà : choisis-la dans la liste.', 409)
    visit_ids, error = _parse_visit_ids(body)
    if error:
        return error
    tz = gps_visit_store.get_local_tz()

    def generate():
        nonlocal zone_id
        zone_created = False
        if zone_id is None:
            zone = Zone(name=new_zone_name, description='Sortie préparée depuis les visites GPS')
            db.session.add(zone)
            db.session.commit()
            zone_id, zone_created = zone.id, True
        prepared = gps_visit_store.prepare_selection(visit_ids, zone_id=zone_id, tz=tz)
        codes = list(dict.fromkeys(entry['gc_code'] for entry in prepared['entries']))
        operation = operations.start(operation_id, zone_id, zone_created=zone_created, days=prepared['days'])
        counts = {'existing': 0, 'copied': 0, 'created': 0, 'from_gps': 0, 'errors': 0}
        importer: GeocacheImporter | None = None
        created_from: dict[str, str] = {}

        def create(code: str, target_zone_id: int):
            nonlocal importer
            importer = importer or GeocacheImporter()
            # Absente de toute zone (vérifié par add_to_zone) : ni import_from_scraped ni
            # import_by_code ne déplacent quoi que ce soit. Le GPX du GPS d'abord : sans réseau.
            scraped = gps_device.scraped_from_device(code)
            if scraped is not None:
                created_from[code] = 'gps'
                return importer.import_from_scraped(target_zone_id, scraped)
            created_from[code] = 'site'
            return importer.import_by_code(target_zone_id, code)

        total = len(codes)
        yield _line({'operation_id': operation_id, 'zone_id': zone_id, 'zone_created': zone_created,
                     'progress': 0, 'message': f'{total} cache(s) à ajouter à la zone…', 'counts': counts})
        try:
            for index, code in enumerate(codes, start=1):
                if operations.cancel_requested(operation_id):
                    break
                error_item = None
                try:
                    geocache, action = add_to_zone(code, zone_id, create=create)
                    operations.record(operation, code, geocache.id, action)
                    counts[action] += 1
                    from_gps = action == ACTION_CREATED and created_from.get(code) == 'gps'
                    if from_gps:
                        counts['from_gps'] += 1
                    label = {'existing': 'Déjà dans la zone', 'copied': 'Ajoutée (copie)',
                             'created': 'Créée depuis le GPS' if from_gps else 'Téléchargée'}[action]
                    message = f'{label} : {code} ({index}/{total})'
                    if action == ACTION_CREATED and not from_gps:
                        time.sleep(DOWNLOAD_INTERVAL_SECONDS)
                except Exception as exc:  # noqa: BLE001 - une cache en échec ne bloque pas les autres
                    db.session.rollback()
                    counts['errors'] += 1
                    message = f'{code} : {_import_error_label(exc)}'
                    error_item = message
                    logger.warning('Ajout de %s à la zone %s impossible : %s', code, zone_id, exc)
                payload = {'progress': int(index / max(total, 1) * 100), 'message': message, 'counts': counts}
                if error_item:
                    payload['error_item'] = error_item
                yield _line(payload)

            if operations.cancel_requested(operation_id):
                result = operations.undo(operation)
                yield _line({'progress': 100, 'final_summary': True, 'cancelled': True,
                             'message': result['message'], 'operation': operation.to_dict()})
                return
            operations.finish(operation, 'done')
            operations.set_day_zones(prepared['days'], zone_id)
            gps_visit_store.set_last_zone_id(zone_id)
            added = counts['copied'] + counts['created']
            message = (f'{added} cache(s) ajoutée(s) à la zone, {counts["existing"]} déjà présente(s)'
                       + (f', {counts["errors"]} erreur(s)' if counts['errors'] else ''))
            yield _line({'progress': 100, 'final_summary': True, 'message': message,
                         'operation': operation.to_dict()})
        finally:
            # Client parti en cours de flux : on garde le journal, l'annulation reste possible.
            if operation.state == 'running':
                operations.finish(operation, 'interrupted')

    return Response(stream_with_context(generate()), content_type='application/json')


@bp.get('/zone-operations/<operation_id>')
def get_zone_operation(operation_id: str):
    from ..services import gps_zone_operations as operations

    operation = operations.get(operation_id)
    if operation is None:
        return _error('operation_not_found', 'Ajout introuvable.', 404)
    return jsonify(operation.to_dict())


@bp.post('/zone-operations/<operation_id>/cancel')
def cancel_zone_operation(operation_id: str):
    """
    Annule un ajout. En cours : arrêt entre deux caches, le flux retire ce qui a été
    ajouté et l'annonce. Terminé ou interrompu : retrait immédiat, sauf si un log est
    déjà parti depuis la zone de la sortie.
    """
    from ..services import gps_zone_operations as operations

    operation = operations.get(operation_id)
    if operation is None:
        return _error('operation_not_found', 'Ajout introuvable.', 404)
    if operation.state == 'running':
        operations.request_cancel(operation_id)
        return jsonify({'state': 'cancelling', 'message': "Arrêt demandé : l'ajout s'arrête après la cache en cours."}), 202
    refusal = operations.undo_refusal(operation)
    if refusal:
        return _error('undo_refused', refusal, 409)
    result = operations.undo(operation)
    return jsonify({**result, 'state': 'cancelled', 'operation': operation.to_dict()})


GEOCACHE_SHEET_URL = 'https://www.geocaching.com/api/proxy/web/v1/geocache/{code}'


def _geocache_sheet_lookup(session):
    """Fiche JSON d'une cache (coordonnées, ma date de trouvaille), ou None."""
    def lookup(code: str):
        try:
            response = session.get(GEOCACHE_SHEET_URL.format(code=code), timeout=20,
                                   headers={'Accept': 'application/json'})
        except Exception as exc:  # noqa: BLE001 - un candidat sans fiche reste proposé
            logger.warning('Fiche de %s illisible : %s', code, exc)
            return None
        if response.status_code in (401, 403):
            from ..services.geocaching_friends import NotAuthenticatedError
            raise NotAuthenticatedError('Session Geocaching.com expirée')
        if not response.ok:
            return None
        try:
            return response.json()
        except ValueError:
            return None
    return lookup


@bp.get('/<int:visit_id>/candidates')
def resolution_candidates(visit_id: int):
    """
    Caches candidates pour une visite sans code (voir services/gps_visit_resolution.py).
    ``?deep=1`` ajoute la recherche dans l'ordre de mes trouvailles (~1 min).
    """
    from ..models import GpsVisit
    from ..services import gps_visit_resolution
    from ..services.geocaching_auth import get_auth_service
    from ..services.geocaching_friend_finds import FriendFindsError, RateLimitedError, get_friend_finds_client
    from ..services.geocaching_friends import NotAuthenticatedError

    visit = db.session.get(GpsVisit, visit_id)
    if visit is None:
        return _error('visit_not_found', 'Visite introuvable.', 404)
    if visit.gc_code:
        return _error('visit_has_code', 'Cette visite a déjà un code lu sur le GPS.', 400)
    _position_if_possible([visit])

    state = get_auth_service().get_auth_state()
    username = state.user_info.username if state and state.user_info else None
    try:
        result = gps_visit_resolution.find_candidates(
            visit,
            request=get_friend_finds_client()._request,
            lookup=_geocache_sheet_lookup(get_auth_service().get_session()),
            username=username,
            deep=request.args.get('deep') in ('1', 'true'),
            tz=gps_visit_store.get_local_tz(),
        )
    except NotAuthenticatedError:
        return _error('not_authenticated', 'Connecte-toi à Geocaching.com pour chercher des candidats.', 401)
    except RateLimitedError:
        return _error('rate_limited', 'Geocaching.com limite les recherches : réessaie dans quelques minutes.', 429)
    except FriendFindsError as exc:
        return _error('search_failed', str(exc), 502)
    result['authenticated'] = bool(username)
    return jsonify(result)


@bp.post('/<int:visit_id>/resolve')
def resolve_visit(visit_id: int):
    """Rattache une visite sans code à une cache (``{"gc_code", "source"}``), ou la détache (``gc_code: null``)."""
    from ..models import GpsVisit

    visit = db.session.get(GpsVisit, visit_id)
    if visit is None:
        return _error('visit_not_found', 'Visite introuvable.', 404)
    if visit.gc_code:
        return _error('visit_has_code', 'Cette visite a déjà un code lu sur le GPS.', 400)
    body = request.get_json(silent=True) or {}
    raw_code = body.get('gc_code')
    if raw_code is None:
        visit.resolved_gc_code = None
        visit.resolution_source = None
    else:
        code = normalize_code(str(raw_code))
        if code is None:
            return _error('invalid_code', 'Code GC invalide (ex. GC1A2B3).', 400)
        source = body.get('source')
        if source not in ('neighbours', 'my_finds', 'track', 'manual'):
            source = 'manual'
        visit.resolved_gc_code = code
        visit.resolution_source = source
    db.session.commit()
    return jsonify(visit.to_dict())


def _position_if_possible(visits) -> None:
    """
    Une visite pas encore cherchée sur les traces l'est maintenant si le GPS est branché
    (0,2 s pour un jour) : la recherche se fera autour de sa position réelle.
    """
    pending = [v for v in visits if v.latitude is None and v.position_source is None]
    root = AppConfig.get_value(LAST_DEVICE_KEY)
    if not pending or not root:
        return
    try:
        if not any(_same_path(root, d['root']) for d in detect_devices()):
            return
        tz = gps_visit_store.get_local_tz()
        days = {gps_visit_store.row_local_day(v.visited_at, v.utc_offset_minutes, tz) for v in pending}
        gps_device.position_visits(gps_device.device_track_sources(gps_device.layout(root)), days=days, tz=tz)
    except Exception as exc:  # noqa: BLE001 - sans position, la recherche passe par les voisines
        logger.warning('Positionnement à la volée impossible : %s', exc)
        db.session.rollback()


@bp.post('/day-resolution')
def day_resolution():
    """
    Propose une cache pour chaque visite sans code d'un jour (``{"day"}``), d'après sa
    position sur la trace. Rien n'est rattaché : ``POST /resolve-batch`` valide.
    """
    from ..models import GpsVisit
    from ..services import gps_visit_resolution
    from ..services.geocaching_auth import get_auth_service
    from ..services.geocaching_friend_finds import FriendFindsError, RateLimitedError, get_friend_finds_client
    from ..services.geocaching_friends import NotAuthenticatedError

    body = request.get_json(silent=True) or {}
    day, error = _parse_day(body.get('day'), 'day')
    if error:
        return error
    if day is None:
        return _error('missing_day', 'Jour manquant.', 400)
    tz = gps_visit_store.get_local_tz()
    lo, hi = gps_visit_store._utc_window(day, day, tz)
    visits = [v for v in GpsVisit.query.filter(
        GpsVisit.gc_code.is_(None), GpsVisit.resolved_gc_code.is_(None), GpsVisit.state == 'pending',
        GpsVisit.visited_at >= lo, GpsVisit.visited_at < hi,
    ).all() if gps_visit_store.row_local_day(v.visited_at, v.utc_offset_minutes, tz) == day]
    if not visits:
        return jsonify({'day': day.isoformat(), 'visits': [], 'boxes': 0, 'candidates': 0})
    _position_if_possible(visits)
    try:
        result = gps_visit_resolution.resolve_day(
            visits,
            request=get_friend_finds_client()._request,
            lookup=_geocache_sheet_lookup(get_auth_service().get_session()),
            tz=tz,
        )
    except NotAuthenticatedError:
        return _error('not_authenticated', 'Connecte-toi à Geocaching.com pour chercher des candidats.', 401)
    except RateLimitedError:
        return _error('rate_limited', 'Geocaching.com limite les recherches : réessaie dans quelques minutes.', 429)
    except FriendFindsError as exc:
        return _error('search_failed', str(exc), 502)
    result['unpositioned'] = sum(1 for v in visits if v.latitude is None)
    return jsonify(result)


@bp.post('/resolve-batch')
def resolve_batch():
    """Rattache plusieurs visites sans code d'un coup : ``{"items": [{"visit_id", "gc_code", "source"}]}``."""
    from ..models import GpsVisit

    body = request.get_json(silent=True) or {}
    items = body.get('items')
    if not isinstance(items, list) or not items:
        return _error('invalid_items', 'items doit être une liste non vide.', 400)
    resolved = []
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get('visit_id'), int):
            return _error('invalid_items', 'Chaque élément doit porter visit_id et gc_code.', 400)
        code = normalize_code(str(item.get('gc_code') or ''))
        if code is None:
            return _error('invalid_code', f"Code GC invalide : {item.get('gc_code')}", 400)
        visit = db.session.get(GpsVisit, item['visit_id'])
        if visit is None or visit.gc_code:
            return _error('visit_not_resolvable', f"Visite {item['visit_id']} introuvable ou déjà codée.", 400)
        source = item.get('source') if item.get('source') in ('neighbours', 'my_finds', 'track', 'manual') else 'manual'
        visit.resolved_gc_code, visit.resolution_source = code, source
        resolved.append(visit.id)
    db.session.commit()
    return jsonify({'resolved': len(resolved)})
