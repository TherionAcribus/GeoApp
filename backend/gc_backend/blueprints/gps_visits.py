"""Blueprint des visites GPS Garmin (`geocache_visits.txt`).

Routes :
- ``GET  /api/gps-visits/detect``   fichiers de visites trouvés sur les lecteurs branchés
- ``POST /api/gps-visits/import``   import d'un fichier (multipart ``visitsFile``) ou d'un
  chemin renvoyé par ``detect`` (``{"path": "…"}``)
- ``POST /api/gps-visits/cutoff``   point de départ : ``{"since": "AAAA-MM-JJ"}``
- ``GET  /api/gps-visits``          visites réduites et groupées par jour
  (``?state=pending,logged,ignored&from=&to=&max_days=``)
- ``POST /api/gps-visits/state``    ``{"ids": [...], "state": "pending|logged|ignored"}``

Voir documentation/garmin-visites-technique.md.
"""
from __future__ import annotations

import glob
import logging
import os
from datetime import date, datetime, timezone

from flask import Blueprint, jsonify, request

from ..database import db
from ..services import gps_visit_store
from ..services.garmin_visits import parse_visits

bp = Blueprint('gps_visits', __name__, url_prefix='/api/gps-visits')
logger = logging.getLogger(__name__)

# Un fichier de 14 000 visites pèse ~1,4 Mo en UTF-16 : la borne laisse une large marge.
MAX_VISITS_FILE_BYTES = 20 * 1024 * 1024

VISITS_RELATIVE_PATH = os.path.join('Garmin', 'geocache_visits.txt')

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


def detect_visit_files() -> list[dict]:
    """Fichiers ``Garmin/geocache_visits.txt`` présents sur les lecteurs branchés."""
    found: list[dict] = []
    seen: set[str] = set()
    for mount in _mount_points():
        path = os.path.join(mount, VISITS_RELATIVE_PATH)
        key = os.path.normcase(os.path.abspath(path))
        if key in seen:
            continue
        seen.add(key)
        try:
            if not os.path.isfile(path):
                continue
            stat = os.stat(path)
        except OSError:
            continue
        found.append({
            'path': path,
            'size': stat.st_size,
            'modified': datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        })
    return found


@bp.get('/detect')
def detect():
    return jsonify({'files': detect_visit_files()})


def _read_detected_path(raw_path: str) -> tuple[bytes | None, tuple | None]:
    """Lit un chemin, seulement s'il fait partie de ce que ``detect`` trouve à cet instant."""
    wanted = os.path.normcase(os.path.abspath(raw_path))
    allowed = {os.path.normcase(os.path.abspath(f['path'])) for f in detect_visit_files()}
    if wanted not in allowed:
        return None, _error('path_not_detected', "Ce fichier n'est pas un fichier de visites détecté sur un GPS branché.", 400)
    try:
        if os.path.getsize(raw_path) > MAX_VISITS_FILE_BYTES:
            return None, _error('file_too_large', 'Fichier de visites trop volumineux.', 413)
        with open(raw_path, 'rb') as handle:
            return handle.read(), None
    except OSError as exc:
        logger.warning('Lecture impossible de %s : %s', raw_path, exc)
        return None, _error('read_failed', "Le fichier n'a pas pu être lu (GPS débranché ?).", 400)


@bp.post('/import')
def import_visits():
    upload = request.files.get('visitsFile')
    if upload is not None:
        data = upload.read(MAX_VISITS_FILE_BYTES + 1)
        if len(data) > MAX_VISITS_FILE_BYTES:
            return _error('file_too_large', 'Fichier de visites trop volumineux.', 413)
        source = upload.filename or 'fichier déposé'
    else:
        body = request.get_json(silent=True) or {}
        raw_path = body.get('path')
        if not isinstance(raw_path, str) or not raw_path.strip():
            return _error('missing_file', 'Aucun fichier de visites fourni.', 400)
        data, error = _read_detected_path(raw_path.strip())
        if error:
            return error
        source = raw_path.strip()

    parsed = parse_visits(data)
    if not parsed.visits and parsed.unreadable:
        return _error('not_a_visits_file', "Ce fichier ne ressemble pas à un fichier de visites Garmin.", 400)

    try:
        report = gps_visit_store.import_visits(parsed, source=source, tz=gps_visit_store.get_local_tz())
    except Exception:
        db.session.rollback()
        raise
    return jsonify(report.to_dict())


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
