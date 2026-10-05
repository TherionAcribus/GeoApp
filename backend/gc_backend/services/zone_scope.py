"""
Périmètre d'une zone : elle-même, ou ses zones membres si c'est un dossier.

Un dossier (`Zone.is_folder`) est une « superzone » : il ne porte aucune géocache
en propre et montre celles des zones qu'il range. Comme il partage l'espace
d'identifiants des zones, toute lecture « les caches de la zone N » passe par
`in_scope(N)` et vaut pour les deux. Les écritures, elles, visent toujours une
vraie zone (`GeocacheImporter._validate_zone`, `is_folder`).

Voir documentation/zones-technique.md (« Dossiers »).
"""
from __future__ import annotations

from ..database import db
from ..models import Zone, ZoneFolderMember


def is_folder(zone_id) -> bool:
    if not isinstance(zone_id, int):
        return False
    zone = db.session.get(Zone, zone_id)
    return bool(zone is not None and zone.is_folder)


def member_zone_ids(folder_id: int) -> list[int]:
    return [
        zone_id for (zone_id,) in db.session.query(ZoneFolderMember.zone_id)
        .filter(ZoneFolderMember.folder_id == folder_id)
        .order_by(ZoneFolderMember.zone_id)
        .all()
    ]


def scope_zone_ids(zone_id: int) -> list[int]:
    """Les zones dont les géocaches forment la zone ou le dossier `zone_id`."""
    return member_zone_ids(zone_id) if is_folder(zone_id) else [zone_id]


def in_scope(zone_id: int):
    """Critère SQL « la géocache appartient à la zone ou au dossier `zone_id` »."""
    from ..geocaches.models import Geocache

    return Geocache.zone_id.in_(scope_zone_ids(zone_id))


def zone_names(zone_ids) -> dict[int, str]:
    ids = [zone_id for zone_id in zone_ids if zone_id is not None]
    if not ids:
        return {}
    return dict(db.session.query(Zone.id, Zone.name).filter(Zone.id.in_(ids)).all())


def count_geocaches(zone_id: int) -> int:
    """Nombre de caches distinctes (une cache rangée dans deux zones d'un dossier compte une fois)."""
    from ..geocaches.models import Geocache

    return (
        db.session.query(Geocache.gc_code)
        .filter(in_scope(zone_id))
        .distinct()
        .count()
    )


def dedupe_by_code(rows: list) -> list:
    """
    Une ligne par code GC, pour l'affichage d'un dossier : la plus récemment
    modifiée (à défaut le plus grand id), dans l'ordre d'origine.
    """
    best: dict[str, object] = {}
    for row in rows:
        current = best.get(row.gc_code)
        if current is None or _freshness(row) > _freshness(current):
            best[row.gc_code] = row
    kept = {id(row) for row in best.values()}
    return [row for row in rows if id(row) in kept]


def _freshness(row) -> tuple:
    updated_at = getattr(row, 'updated_at', None)
    return (updated_at.timestamp() if updated_at else 0, row.id)
