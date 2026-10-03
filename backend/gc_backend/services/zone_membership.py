"""
Ajouter une géocache à une zone, sans jamais la retirer d'une autre.

Une même cache peut vivre dans plusieurs zones (unicité ``gc_code`` + ``zone_id``).
`GeocacheImporter.import_by_code` et `import_from_scraped` **déplacent** une cache
déjà connue vers la zone cible (`_resolve_existing`) : ce module ne les appelle que
pour une cache absente de la base, et copie la ligne sinon.

Voir documentation/garmin-visites-ameliorations-spec.md (lot 1).
"""
from __future__ import annotations

import logging
from typing import Callable, Optional

from ..database import db

logger = logging.getLogger(__name__)

ACTION_EXISTING = 'existing'
ACTION_COPIED = 'copied'
ACTION_CREATED = 'created'

# Champs recopiés d'une géocache vers sa copie dans une autre zone.
_COPIED_FIELDS = (
    'gc_code', 'name', 'url', 'type', 'size', 'owner', 'owner_guid', 'difficulty', 'terrain',
    'latitude', 'longitude', 'placed_at', 'status', 'coordinates_raw', 'is_corrected',
    'original_latitude', 'original_longitude', 'original_coordinates_raw', 'description_html',
    'hints', 'attributes', 'favorites_count', 'logs_count', 'finds_count', 'favorites_percent',
    'images', 'found', 'found_date',
)


def copy_geocache_to_zone(source, zone_id: int):
    """
    Copie une géocache (et ses waypoints, ses checkers) dans une autre zone.

    Ne vérifie pas l'unicité : l'appelant s'assure que la cache n'est pas déjà dans
    la zone. Ne valide pas la session (``flush`` seulement) : l'appelant décide.
    """
    from ..geocaches.models import Geocache, GeocacheChecker, GeocacheWaypoint

    copy = Geocache(zone_id=zone_id, **{name: getattr(source, name) for name in _COPIED_FIELDS})
    db.session.add(copy)
    db.session.flush()
    for waypoint in source.waypoints:
        db.session.add(GeocacheWaypoint(
            geocache_id=copy.id,
            prefix=waypoint.prefix,
            lookup=waypoint.lookup,
            name=waypoint.name,
            type=waypoint.type,
            latitude=waypoint.latitude,
            longitude=waypoint.longitude,
            gc_coords=waypoint.gc_coords,
            note=waypoint.note,
        ))
    for checker in source.checkers:
        db.session.add(GeocacheChecker(geocache_id=copy.id, name=checker.name, url=checker.url))
    return copy


def find_in_zone(gc_code: str, zone_id: int):
    from ..geocaches.models import Geocache

    return Geocache.query.filter_by(gc_code=gc_code, zone_id=zone_id).first()


def best_source(gc_code: str):
    """La ligne à copier : la plus récemment mise à jour (souvent la plus complète)."""
    from ..geocaches.models import Geocache

    return Geocache.query.filter_by(gc_code=gc_code).order_by(Geocache.updated_at.desc()).first()


def add_to_zone(gc_code: str, zone_id: int, *, create: Callable[[str, int], object]):
    """
    La géocache ``gc_code`` dans la zone ``zone_id`` : ``(géocache, action)``.

    - déjà dans la zone → ``existing`` ;
    - dans une autre zone → copiée (``copied``) ;
    - absente de la base → ``create(gc_code, zone_id)`` (``created``).
    """
    existing = find_in_zone(gc_code, zone_id)
    if existing is not None:
        return existing, ACTION_EXISTING
    source = best_source(gc_code)
    if source is not None:
        copy = copy_geocache_to_zone(source, zone_id)
        db.session.commit()
        logger.info('Géocache %s copiée de la zone %s vers la zone %s', gc_code, source.zone_id, zone_id)
        return copy, ACTION_COPIED
    return create(gc_code, zone_id), ACTION_CREATED


def remove_geocache_row(geocache_id: int) -> bool:
    """
    Retire une ligne créée ou copiée par un ajout annulé (avec ses waypoints, checkers,
    logs, images). Pas d'archivage : une ligne ajoutée à l'instant ne porte aucun travail
    que la copie d'origine n'aurait pas.
    """
    from ..geocaches.image_storage import remove_geocache_dir
    from ..geocaches.models import Geocache

    geocache = db.session.get(Geocache, geocache_id)
    if geocache is None:
        return False
    db.session.delete(geocache)
    db.session.commit()
    try:
        remove_geocache_dir(geocache_id)
    except Exception as exc:  # pragma: no cover - nettoyage best-effort
        logger.warning('Images de la géocache %s non nettoyées : %s', geocache_id, exc)
    return True


def mark_found_everywhere(gc_code: str, found_date) -> int:
    """Une trouvaille vaut pour toutes les zones : chaque ligne du code passe trouvée."""
    from ..geocaches.models import Geocache

    rows = Geocache.query.filter_by(gc_code=gc_code).all()
    for row in rows:
        row.found = True
        row.found_date = found_date
    return len(rows)


def found_row(gc_code: str) -> Optional[object]:
    """Une ligne trouvée de ce code, s'il y en a une (toutes zones confondues)."""
    from ..geocaches.models import Geocache

    return Geocache.query.filter_by(gc_code=gc_code, found=True).first()
