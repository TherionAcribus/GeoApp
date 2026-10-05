import logging

from flask import Blueprint, abort, jsonify, request
from sqlalchemy import func, or_

from ..database import db
from ..models import Zone, ZoneFolderMember, AppConfig
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

    folder_members: dict[int, list[int]] = {}
    zone_folders: dict[int, list[int]] = {}
    for folder_id, member_id in db.session.query(ZoneFolderMember.folder_id, ZoneFolderMember.zone_id).all():
        folder_members.setdefault(folder_id, []).append(member_id)
        zone_folders.setdefault(member_id, []).append(folder_id)

    payload = []
    for zone in zones:
        count, latest_geocache_created_at = cache_stats.get(zone.id, (0, None))
        latest_resolution_at = resolution_stats.get(zone.id)
        entry = {
            'id': zone.id,
            'name': zone.name,
            'description': zone.description,
            'created_at': _isoformat(zone.created_at),
            'is_hidden': bool(zone.is_hidden),
            'is_folder': bool(zone.is_folder),
            # Dossiers où la zone est rangée (vide pour un dossier).
            'folder_ids': sorted(zone_folders.get(zone.id, [])),
        }
        if zone.is_folder:
            # Les compteurs d'un dossier sont ceux de ses zones membres, une cache
            # rangée dans deux d'entre elles ne comptant qu'une fois.
            member_ids = sorted(folder_members.get(zone.id, []))
            count, latest_geocache_created_at, latest_resolution_at = _folder_stats(member_ids)
            entry['zone_ids'] = member_ids
        entry.update({
            'geocaches_count': int(count or 0),
            'latest_geocache_created_at': _isoformat(latest_geocache_created_at),
            'latest_resolution_updated_at': _isoformat(latest_resolution_at),
        })
        payload.append(entry)
    return payload


def _folder_stats(member_ids: list[int]):
    if not member_ids:
        return 0, None, None
    count, latest_created_at = db.session.query(
        func.count(func.distinct(Geocache.gc_code)),
        func.max(Geocache.created_at),
    ).filter(Geocache.zone_id.in_(member_ids)).one()
    latest_resolution_at = (
        db.session.query(func.max(SolvedGeocacheArchive.updated_at))
        .join(Geocache, SolvedGeocacheArchive.gc_code == Geocache.gc_code)
        .filter(Geocache.zone_id.in_(member_ids))
        .filter(or_(
            SolvedGeocacheArchive.solved_status.in_(('in_progress', 'solved')),
            SolvedGeocacheArchive.resolution_method.isnot(None),
            SolvedGeocacheArchive.solved_coordinates_raw.isnot(None),
        ))
        .scalar()
    )
    return count, latest_created_at, latest_resolution_at


def _folder_or_404(folder_id: int) -> Zone:
    folder = Zone.query.get_or_404(folder_id)
    if not folder.is_folder:
        abort(404)
    return folder


def _zone_payload(zone: Zone) -> dict:
    return _build_zone_list_payload([zone])[0]


def _folder_ids_of(zone_id: int) -> list[int]:
    return [
        folder_id for (folder_id,) in db.session.query(ZoneFolderMember.folder_id)
        .filter(ZoneFolderMember.zone_id == zone_id).all()
    ]


def _forget_memberships(zone_id: int) -> None:
    ZoneFolderMember.query.filter(or_(
        ZoneFolderMember.folder_id == zone_id,
        ZoneFolderMember.zone_id == zone_id,
    )).delete(synchronize_session=False)


@bp.get('/api/zones')
def list_zones():
    """
    Zones triées par nom.

    Les zones techniques (`is_hidden`, aujourd'hui la seule zone « Amis ») sont
    **exclues par défaut** : elles encombreraient l'arbre et ne sont pas des
    cibles de déplacement. `?include_hidden=true` les rétablit — c'est ce que
    fait l'arbre des zones quand la préférence `geoApp.friends.zone.visible`
    est activée.

    Les **dossiers** sont exclus eux aussi : la plupart des appelants cherchent
    une zone où écrire (déplacer, importer…), ce qu'un dossier n'est pas.
    `?include_folders=true` les ajoute, avec `zone_ids` (leurs zones membres).
    """
    include_hidden = request.args.get('include_hidden', 'false').lower() in ('true', '1', 'yes')
    include_folders = request.args.get('include_folders', 'false').lower() in ('true', '1', 'yes')

    query = Zone.query
    if not include_hidden:
        query = query.filter(or_(Zone.is_hidden.is_(False), Zone.is_hidden.is_(None)))
    if not include_folders:
        query = query.filter(or_(Zone.is_folder.is_(False), Zone.is_folder.is_(None)))

    zones = query.order_by(func.lower(Zone.name).asc()).all()
    return jsonify(_build_zone_list_payload(zones))


@bp.post('/api/zones')
def create_zone():
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    description = data.get('description') or ''
    if not name:
        return jsonify({'error': 'name requis'}), 400
    if Zone.query.filter_by(name=name).first():
        return jsonify({'error': f'Une zone ou un dossier nommé "{name}" existe déjà'}), 409

    z = Zone(name=name, description=description, is_folder=bool(data.get('is_folder')))
    db.session.add(z)
    db.session.commit()

    return jsonify(z.to_dict()), 201


@bp.get('/api/zones/<int:zone_id>')
def get_zone(zone_id: int):
    """Une zone ou un dossier, avec ses compteurs (et `zone_ids` pour un dossier)."""
    return jsonify(_zone_payload(Zone.query.get_or_404(zone_id)))


@bp.put('/api/zones/<int:folder_id>/members')
def set_folder_members(folder_id: int):
    """Remplace les zones d'un dossier. Body JSON : { "zone_ids": [1, 2] }."""
    folder = _folder_or_404(folder_id)
    zone_ids = (request.get_json(silent=True) or {}).get('zone_ids')
    if not isinstance(zone_ids, list) or not all(isinstance(zone_id, int) for zone_id in zone_ids):
        return jsonify({'error': "zone_ids (liste d'entiers) requis"}), 400

    wanted = set(zone_ids)
    zones = Zone.query.filter(Zone.id.in_(wanted)).all() if wanted else []
    if len(zones) != len(wanted):
        return jsonify({'error': 'Zone introuvable'}), 404
    if any(zone.is_folder for zone in zones):
        return jsonify({'error': 'Un dossier ne peut pas contenir un autre dossier'}), 400

    ZoneFolderMember.query.filter_by(folder_id=folder.id).delete(synchronize_session=False)
    for zone_id in sorted(wanted):
        db.session.add(ZoneFolderMember(folder_id=folder.id, zone_id=zone_id))
    db.session.commit()
    return jsonify(_zone_payload(folder))


@bp.post('/api/zones/<int:folder_id>/members/<int:zone_id>')
def add_folder_member(folder_id: int, zone_id: int):
    folder = _folder_or_404(folder_id)
    zone = Zone.query.get_or_404(zone_id)
    if zone.is_folder:
        return jsonify({'error': 'Un dossier ne peut pas contenir un autre dossier'}), 400
    if db.session.get(ZoneFolderMember, (folder.id, zone.id)) is None:
        db.session.add(ZoneFolderMember(folder_id=folder.id, zone_id=zone.id))
        db.session.commit()
    return jsonify(_zone_payload(folder))


@bp.delete('/api/zones/<int:folder_id>/members/<int:zone_id>')
def remove_folder_member(folder_id: int, zone_id: int):
    folder = _folder_or_404(folder_id)
    ZoneFolderMember.query.filter_by(folder_id=folder.id, zone_id=zone_id).delete(synchronize_session=False)
    db.session.commit()
    return jsonify(_zone_payload(folder))


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
    if source_zone.is_folder:
        return jsonify({'error': 'Un dossier ne se duplique pas'}), 400
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
    if source_zone.is_folder or target_zone.is_folder:
        return jsonify({'error': 'Un dossier ne se fusionne pas'}), 400
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

        # La cible hérite des dossiers de la source.
        target_folder_ids = set(_folder_ids_of(target_zone.id))
        for folder_id in _folder_ids_of(zone_id):
            if folder_id not in target_folder_ids:
                db.session.add(ZoneFolderMember(folder_id=folder_id, zone_id=target_zone.id))
        _forget_memberships(zone_id)

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

    Supprimer un **dossier** ne touche à aucune géocache : il n'en porte pas en
    propre, ses zones restent en place.
    """
    zone = Zone.query.get_or_404(zone_id)
    zone_name = zone.name
    label = 'Dossier' if zone.is_folder else 'Zone'

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

        # SQLite n'applique pas les clés étrangères par défaut : on retire les
        # appartenances à la main (comme dossier et comme zone rangée).
        _forget_memberships(zone.id)
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
        'message': f'{label} "{zone_name}" supprimé' + ('' if label == 'Dossier' else 'e'),
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


