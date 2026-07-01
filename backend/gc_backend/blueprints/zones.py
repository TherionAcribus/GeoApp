import logging

from flask import Blueprint, jsonify, request
from sqlalchemy import func, or_

from ..database import db
from ..models import Zone, AppConfig
from ..geocaches.models import Geocache, GeocacheChecker, GeocacheWaypoint, SolvedGeocacheArchive
from ..geocaches.archive_service import ArchiveService
from ..geocaches.image_storage import remove_geocache_dir


bp = Blueprint('zones', __name__)
logger = logging.getLogger(__name__)


def _copy_model_columns(model, source, **overrides):
    values = {}
    for column in model.__table__.columns:
        if column.primary_key:
            continue
        if column.name in overrides:
            values[column.name] = overrides[column.name]
            continue
        if column.name in ('created_at', 'updated_at') or column.onupdate is not None:
            continue
        values[column.name] = getattr(source, column.name)
    return model(**values)


def _unique_zone_copy_name(source_name: str) -> str:
    base_name = f'{source_name} (copie)'
    if Zone.query.filter_by(name=base_name).first() is None:
        return base_name

    index = 2
    while True:
        candidate = f'{source_name} (copie {index})'
        if Zone.query.filter_by(name=candidate).first() is None:
            return candidate
        index += 1


def _isoformat(value):
    return value.isoformat() if value else None


def _build_zone_list_payload(zones: list[Zone]) -> list[dict]:
    zone_ids = [zone.id for zone in zones]
    if not zone_ids:
        return []

    cache_stats = {
        zone_id: (count, latest_created_at)
        for zone_id, count, latest_created_at in db.session.query(
            Geocache.zone_id,
            func.count(Geocache.id),
            func.max(Geocache.created_at),
        )
        .filter(Geocache.zone_id.in_(zone_ids))
        .group_by(Geocache.zone_id)
        .all()
    }
    resolution_stats = {
        zone_id: latest_resolution_at
        for zone_id, latest_resolution_at in db.session.query(
            Geocache.zone_id,
            func.max(SolvedGeocacheArchive.updated_at),
        )
        .join(SolvedGeocacheArchive, SolvedGeocacheArchive.gc_code == Geocache.gc_code)
        .filter(Geocache.zone_id.in_(zone_ids))
        .filter(or_(
            SolvedGeocacheArchive.solved_status.in_(('in_progress', 'solved')),
            SolvedGeocacheArchive.resolution_method.isnot(None),
            SolvedGeocacheArchive.solved_coordinates_raw.isnot(None),
        ))
        .group_by(Geocache.zone_id)
        .all()
    }

    payload = []
    for zone in zones:
        count, latest_geocache_created_at = cache_stats.get(zone.id, (0, None))
        payload.append({
            'id': zone.id,
            'name': zone.name,
            'description': zone.description,
            'created_at': _isoformat(zone.created_at),
            'geocaches_count': int(count or 0),
            'latest_geocache_created_at': _isoformat(latest_geocache_created_at),
            'latest_resolution_updated_at': _isoformat(resolution_stats.get(zone.id)),
        })
    return payload


@bp.get('/api/zones')
def list_zones():
    zones = Zone.query.order_by(func.lower(Zone.name).asc()).all()
    return jsonify(_build_zone_list_payload(zones))


@bp.post('/api/zones')
def create_zone():
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    description = data.get('description') or ''
    if not name:
        return jsonify({'error': 'name requis'}), 400

    z = Zone(name=name, description=description)
    db.session.add(z)
    db.session.commit()

    return jsonify(z.to_dict()), 201


@bp.patch('/api/zones/<int:zone_id>')
@bp.post('/api/zones/<int:zone_id>/rename')
def update_zone(zone_id: int):
    zone = Zone.query.get_or_404(zone_id)
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    description = data.get('description')
    if not name:
        return jsonify({'error': 'name requis'}), 400

    existing = Zone.query.filter(Zone.id != zone_id, Zone.name == name).first()
    if existing:
        return jsonify({'error': f'Une zone nommée "{name}" existe déjà'}), 409

    zone.name = name
    if description is not None:
        zone.description = description or ''
    db.session.commit()

    return jsonify(zone.to_dict()), 200


@bp.post('/api/zones/<int:zone_id>/duplicate')
def duplicate_zone(zone_id: int):
    source_zone = Zone.query.get_or_404(zone_id)
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip() or _unique_zone_copy_name(source_zone.name)
    description = data.get('description')

    if Zone.query.filter_by(name=name).first():
        return jsonify({'error': f'Une zone nommée "{name}" existe déjà'}), 409

    try:
        new_zone = Zone(
            name=name,
            description=source_zone.description if description is None else description or '',
        )
        db.session.add(new_zone)
        db.session.flush()

        for source_geocache in source_zone.geocaches:
            new_geocache = _copy_model_columns(
                Geocache,
                source_geocache,
                zone_id=new_zone.id,
            )
            db.session.add(new_geocache)
            db.session.flush()

            for waypoint in source_geocache.waypoints:
                db.session.add(_copy_model_columns(
                    GeocacheWaypoint,
                    waypoint,
                    geocache_id=new_geocache.id,
                ))

            for checker in source_geocache.checkers:
                db.session.add(_copy_model_columns(
                    GeocacheChecker,
                    checker,
                    geocache_id=new_geocache.id,
                ))

        db.session.commit()
        return jsonify(new_zone.to_dict()), 201
    except Exception:
        db.session.rollback()
        raise


@bp.post('/api/zones/<int:zone_id>/merge')
def merge_zone(zone_id: int):
    source_zone = Zone.query.get_or_404(zone_id)
    data = request.get_json(silent=True) or {}
    target_zone_id = data.get('target_zone_id')

    if not target_zone_id:
        return jsonify({'error': 'target_zone_id requis'}), 400
    try:
        target_zone_id = int(target_zone_id)
    except (TypeError, ValueError):
        return jsonify({'error': 'target_zone_id invalide'}), 400
    if target_zone_id == zone_id:
        return jsonify({'error': 'La zone cible doit être différente de la zone source'}), 400

    target_zone = Zone.query.get_or_404(target_zone_id)
    source_name = source_zone.name
    moved_count = 0
    duplicate_count = 0

    try:
        for geocache in list(source_zone.geocaches):
            existing = Geocache.query.filter_by(
                zone_id=target_zone.id,
                gc_code=geocache.gc_code,
            ).first()
            if existing:
                duplicate_count += 1
                db.session.delete(geocache)
            else:
                geocache.zone_id = target_zone.id
                moved_count += 1

        active_zone_id = AppConfig.get_value('active_zone_id')
        if active_zone_id == str(source_zone.id):
            AppConfig.set_value('active_zone_id', str(target_zone.id))

        db.session.flush()
        Zone.query.filter_by(id=zone_id).delete(synchronize_session=False)
        db.session.commit()

        return jsonify({
            'message': f'Zone "{source_name}" fusionnée dans "{target_zone.name}"',
            'source_zone_id': zone_id,
            'target_zone': target_zone.to_dict(),
            'moved_count': moved_count,
            'duplicate_count': duplicate_count,
        }), 200
    except Exception:
        db.session.rollback()
        raise


@bp.delete('/api/zones/<int:zone_id>')
def delete_zone(zone_id: int):
    """Supprime une zone et, en cascade, toutes ses géocaches.

    Chaque géocache est supprimée comme via l'endpoint dédié: on archive d'abord
    sa résolution (``snapshot_before_delete``) puis on la supprime pour déclencher
    les cascades de ses données liées (waypoints, checkers, logs, images, ...).
    Le ``zone_id`` étant ``NOT NULL``, une suppression directe de la zone échouait
    en ``IntegrityError`` dès qu'elle contenait au moins une géocache.
    """
    zone = Zone.query.get_or_404(zone_id)
    zone_name = zone.name

    geocaches = list(zone.geocaches)
    geocache_ids = [geocache.id for geocache in geocaches]
    deleted_count = len(geocaches)

    try:
        for geocache in geocaches:
            ArchiveService.snapshot_before_delete(geocache)
            db.session.delete(geocache)

        # Si la zone supprimée était active, réinitialiser la zone active.
        if AppConfig.get_value('active_zone_id') == str(zone.id):
            AppConfig.set_value('active_zone_id', None)

        db.session.delete(zone)
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise

    # Nettoyage best-effort des images stockées sur disque (hors transaction).
    for geocache_id in geocache_ids:
        try:
            remove_geocache_dir(geocache_id)
        except Exception as e:
            logger.warning(f"Failed to cleanup stored images for geocache {geocache_id}: {e}")

    return jsonify({
        'message': f'Zone "{zone_name}" supprimée',
        'id': zone_id,
        'deleted_geocaches_count': deleted_count,
    }), 200


@bp.get('/api/active-zone')
def get_active_zone():
    zone_id_str = AppConfig.get_value('active_zone_id')
    if not zone_id_str:
        return jsonify(None)
    try:
        zone = Zone.query.get(int(zone_id_str))
        return jsonify(zone.to_dict() if zone else None)
    except Exception:
        return jsonify(None)


@bp.post('/api/active-zone')
def set_active_zone():
    data = request.get_json(silent=True) or {}
    zone_id = data.get('zone_id')
    if zone_id is None:
        AppConfig.set_value('active_zone_id', None)
        db.session.commit()
        return jsonify(None)
    zone = Zone.query.get_or_404(zone_id)
    AppConfig.set_value('active_zone_id', str(zone.id))
    db.session.commit()
    return jsonify(zone.to_dict())


# La route /api/zones/<zone_id>/geocaches est fournie par le blueprint geocaches


