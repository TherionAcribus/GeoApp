from __future__ import annotations

import logging
from typing import Optional

from ..database import db
from ..models import Zone
from .models import Geocache, GeocacheWaypoint, GeocacheChecker
from .scraper import GeocachingScraper, ScrapedGeocache
from .image_sync import ensure_images_v2_for_geocache
from .archive_service import ArchiveService


logger = logging.getLogger(__name__)


class GeocacheImporter:
    def __init__(self, scraper: Optional[GeocachingScraper] = None) -> None:
        self.scraper = scraper or GeocachingScraper()

    def import_by_code(self, zone_id: int, gc_code: str, return_outcome: bool = False,
                       update_existing: bool = False):
        """Importe une géocache en la téléchargeant depuis Geocaching.com.

        Si ``return_outcome`` est vrai, retourne ``(geocache, outcome)`` où
        ``outcome`` vaut ``'created'``, ``'existing'``, ``'moved'`` ou ``'updated'``.
        Si ``update_existing`` est vrai, les géocaches déjà présentes sont mises à
        jour depuis les nouvelles données (au lieu d'être ignorées).
        """
        logger.info(f"Importing geocache {gc_code} into zone {zone_id}")

        code = self._validate_zone_and_code(zone_id, gc_code)

        existing, outcome = self._resolve_existing(zone_id, code)
        if existing is not None and not update_existing:
            return (existing, outcome) if return_outcome else existing

        logger.info(f"Geocache {code} not found locally, scraping...")
        try:
            scraped = self.scraper.scrape(code)
        except Exception as e:
            logger.error(f"Failed to scrape geocache {code}: {e}")
            raise

        if existing is not None:
            self._update_existing_geocache(existing, scraped)
            return (existing, 'updated') if return_outcome else existing

        g = self._persist_new_geocache(zone_id, code, scraped)
        return (g, 'created') if return_outcome else g

    def import_from_scraped(self, zone_id: int, scraped: ScrapedGeocache, return_outcome: bool = False,
                           update_existing: bool = False):
        """Importe une géocache depuis des données déjà parsées (ex: GPX/Pocket Query).

        Évite tout appel réseau : même logique de déduplication et de persistance
        que ``import_by_code`` mais sans scraping. Utilisé pour l'import de masse
        depuis les fichiers GPX Groundspeak qui contiennent déjà toutes les données.
        """
        code = self._validate_zone_and_code(zone_id, scraped.gc_code)

        existing, outcome = self._resolve_existing(zone_id, code)
        if existing is not None and not update_existing:
            return (existing, outcome) if return_outcome else existing

        if existing is not None:
            self._update_existing_geocache(existing, scraped)
            return (existing, 'updated') if return_outcome else existing

        logger.info(f"Geocache {code} not found locally, importing from parsed data...")
        g = self._persist_new_geocache(zone_id, code, scraped)
        return (g, 'created') if return_outcome else g

    # ------------------------------------------------------------------
    # Helpers internes partagés
    # ------------------------------------------------------------------

    def _validate_zone(self, zone_id: int) -> Zone:
        if not isinstance(zone_id, int):
            logger.error(f"Invalid zone_id type: {type(zone_id)}")
            raise ValueError('invalid_zone_id')

        zone = Zone.query.get(zone_id)
        if zone is None:
            logger.warning(f"Zone {zone_id} not found")
            raise LookupError('zone_not_found')

        logger.debug(f"Zone {zone_id} exists: {zone.name}")
        return zone

    def _validate_zone_and_code(self, zone_id: int, gc_code: str) -> str:
        self._validate_zone(zone_id)
        code = self.scraper.validate_gc_code(gc_code)
        logger.debug(f"Validated GC code: {code}")
        return code

    def _preload_existing(self, codes: list[str]) -> dict[str, Geocache]:
        """Charge en quelques requêtes ``IN`` les géocaches déjà présentes.

        Évite un ``filter_by(gc_code)`` par cache lors d'un import de masse.
        """
        existing_map: dict[str, Geocache] = {}
        unique = list({c for c in codes if c})
        CHUNK = 500
        for i in range(0, len(unique), CHUNK):
            chunk = unique[i:i + CHUNK]
            for g in Geocache.query.filter(Geocache.gc_code.in_(chunk)).all():
                existing_map[g.gc_code] = g
        return existing_map

    def _resolve_existing(self, zone_id: int, code: str) -> tuple[Optional[Geocache], Optional[str]]:
        """Gère la déduplication.

        Retourne ``(geocache, outcome)`` :
        - ``(None, None)`` si la géocache n'existe pas encore (à créer) ;
        - ``(geocache, 'existing')`` si déjà présente dans la zone cible ;
        - ``(geocache, 'moved')`` si elle a été déplacée d'une autre zone.
        """
        existing = Geocache.query.filter_by(gc_code=code).first()
        if not existing:
            return None, None

        logger.info(f"Geocache {code} already exists (id={existing.id})")
        if existing.zone_id == zone_id:
            logger.info(f"Geocache {code} already in zone {zone_id}")
            return existing, 'existing'

        # Sinon, pour ce MVP: réassocier à la nouvelle zone (simple)
        logger.info(f"Moving geocache {code} from zone {existing.zone_id} to {zone_id}")
        existing.zone_id = zone_id
        db.session.commit()
        logger.info(f"Geocache {code} moved successfully")
        return existing, 'moved'

    def _update_existing_geocache(self, g: Geocache, s: ScrapedGeocache) -> Geocache:
        """Met à jour une géocache existante puis committe la transaction."""
        try:
            self._apply_update_geocache(g, s)
            db.session.commit()
            logger.info(f"Geocache {g.gc_code} updated successfully")
            return g
        except Exception as e:
            db.session.rollback()
            logger.error(f"Failed to update geocache {g.gc_code}: {e}")
            raise

    def _apply_update_geocache(self, g: Geocache, s: ScrapedGeocache) -> Geocache:
        """Applique les nouvelles données à une géocache existante SANS committer.

        Préserve les données utilisateur : statut de résolution, note perso, et
        coordonnées résolues localement non poussées sur GC. Les waypoints/checkers
        ne sont remplacés que si le nouveau jeu n'est pas vide (un GPX standard ne
        contient pas les waypoints additionnels — on ne veut pas les effacer).

        L'appelant est responsable du ``commit`` / ``rollback`` (permet de
        regrouper les écritures en lots lors des imports de masse).
        """
        logger.info(f"Updating existing geocache {g.gc_code} (id={g.id})")

        g.name = s.name
        g.url = s.url
        g.type = s.type
        g.size = s.size
        g.owner = s.owner
        g.difficulty = s.difficulty
        g.terrain = s.terrain
        g.placed_at = s.placed_at
        g.status = s.status or 'active'

        # Coordonnées : ne pas écraser une solution locale non poussée sur GC.
        scrape_has_corrected = bool(getattr(s, 'is_corrected', False))
        preserve_local_coords = bool(g.is_corrected) and not scrape_has_corrected
        if not preserve_local_coords:
            g.latitude = s.latitude
            g.longitude = s.longitude
            g.coordinates_raw = getattr(s, 'coordinates_raw', None)
            g.is_corrected = getattr(s, 'is_corrected', None)
        else:
            logger.info(f"Preserving locally-solved coordinates for {g.gc_code}")

        g.original_latitude = getattr(s, 'original_latitude', None)
        g.original_longitude = getattr(s, 'original_longitude', None)
        g.original_coordinates_raw = getattr(s, 'original_coordinates_raw', None)

        g.description_html = getattr(s, 'description_html', None)
        g.description_raw = getattr(s, 'description_raw', None)
        g.hints = getattr(s, 'hints', None)
        g.hints_decoded = Geocache.decode_hint_rot13(g.hints) if g.hints else None
        g.attributes = getattr(s, 'attributes', None)
        g.favorites_count = getattr(s, 'favorites_count', None)
        if getattr(s, 'logs_count', None) is not None:
            g.logs_count = s.logs_count
        if getattr(s, 'images', None):
            g.images = s.images

        ensure_images_v2_for_geocache(g)

        new_waypoints = getattr(s, 'waypoints', []) or []
        if new_waypoints:
            GeocacheWaypoint.query.filter_by(geocache_id=g.id).delete()
            for w in new_waypoints:
                db.session.add(GeocacheWaypoint(
                    geocache_id=g.id,
                    prefix=w.get('prefix'),
                    lookup=w.get('lookup'),
                    name=w.get('name'),
                    type=w.get('type'),
                    latitude=w.get('latitude'),
                    longitude=w.get('longitude'),
                    gc_coords=w.get('gc_coords'),
                    note=w.get('note'),
                ))

        new_checkers = getattr(s, 'checkers', []) or []
        if new_checkers:
            GeocacheChecker.query.filter_by(geocache_id=g.id).delete()
            for c in new_checkers:
                db.session.add(GeocacheChecker(
                    geocache_id=g.id,
                    name=c.get('name'),
                    url=c.get('url'),
                ))

        return g

    def _persist_new_geocache(self, zone_id: int, code: str, s: ScrapedGeocache) -> Geocache:
        """Crée une nouvelle géocache puis committe la transaction."""
        archive = ArchiveService.get_by_gc_code(code)
        try:
            g = self._apply_new_geocache(zone_id, code, s, archive)
            db.session.commit()
            logger.info(f"Geocache {code} imported successfully (id={g.id})")
            return g
        except Exception as e:
            db.session.rollback()
            logger.error(f"Failed to save geocache {code}: {e}")
            raise

    def _apply_new_geocache(self, zone_id: int, code: str, s: ScrapedGeocache,
                            archive: Optional[dict]) -> Geocache:
        """Crée une nouvelle géocache et ses relations SANS committer.

        ``archive`` est le dict d'archive éventuel (préchargé lors d'un import de
        masse pour éviter une requête par cache). L'appelant gère le
        ``commit`` / ``rollback``.
        """
        logger.info(f"Creating geocache {code} in database")

        g = Geocache(
            gc_code=s.gc_code,
            name=s.name,
            url=s.url,
            type=s.type,
            size=s.size,
            owner=s.owner,
            difficulty=s.difficulty,
            terrain=s.terrain,
            latitude=s.latitude,
            longitude=s.longitude,
            placed_at=s.placed_at,
            status=s.status or 'active',
            zone_id=zone_id,
        )
        # Données enrichies
        g.coordinates_raw = getattr(s, 'coordinates_raw', None)
        g.is_corrected = getattr(s, 'is_corrected', None)
        g.original_latitude = getattr(s, 'original_latitude', None)
        g.original_longitude = getattr(s, 'original_longitude', None)
        g.original_coordinates_raw = getattr(s, 'original_coordinates_raw', None)
        g.description_html = getattr(s, 'description_html', None)
        g.description_raw = getattr(s, 'description_raw', None)
        g.hints = getattr(s, 'hints', None)
        g.hints_decoded = Geocache.decode_hint_rot13(g.hints) if g.hints else None
        g.attributes = getattr(s, 'attributes', None)
        g.favorites_count = getattr(s, 'favorites_count', None)
        g.logs_count = getattr(s, 'logs_count', None)
        g.images = getattr(s, 'images', None)
        g.found = getattr(s, 'found', None)
        g.found_date = getattr(s, 'found_date', None)

        db.session.add(g)
        db.session.flush()

        ensure_images_v2_for_geocache(g)

        # Restaurer les données depuis l'archive si elle existe
        if archive:
            logger.info(f"Archive found for {code}, restoring resolution data")
            if archive.get('solved_status') and archive['solved_status'] != 'not_solved':
                g.solved = archive['solved_status']
            if archive.get('solved_coordinates_raw'):
                g.coordinates_raw = archive['solved_coordinates_raw']
                g.latitude = archive.get('solved_latitude')
                g.longitude = archive.get('solved_longitude')
                g.is_corrected = True
            if archive.get('personal_note') and not g.gc_personal_note:
                g.gc_personal_note = archive['personal_note']
            if archive.get('found') and not g.found:
                g.found = archive['found']
                g.found_date = None  # found_date will be set from archive JSON if needed

        # Persistance des relations si disponibles
        for w in getattr(s, 'waypoints', []) or []:
            db.session.add(GeocacheWaypoint(
                geocache_id=g.id,
                prefix=w.get('prefix'),
                lookup=w.get('lookup'),
                name=w.get('name'),
                type=w.get('type'),
                latitude=w.get('latitude'),
                longitude=w.get('longitude'),
                gc_coords=w.get('gc_coords'),
                note=w.get('note'),
            ))
        for c in getattr(s, 'checkers', []) or []:
            db.session.add(GeocacheChecker(
                geocache_id=g.id,
                name=c.get('name'),
                url=c.get('url'),
            ))

        return g

    def import_scraped_bulk(self, zone_id: int, scraped_list: list[ScrapedGeocache],
                            update_existing: bool = False, batch_size: int = 100):
        """Importe en masse des géocaches déjà parsées (GPX / Pocket Query).

        Générateur produisant un dict ``{'gc_code', 'outcome', 'error'}`` par
        géocache traitée, ce qui permet à l'appelant d'émettre une progression
        par cache tout en profitant d'optimisations de masse :

        - la zone n'est validée qu'une seule fois ;
        - les géocaches existantes et les archives sont préchargées en quelques
          requêtes ``IN`` au lieu d'une par cache ;
        - les écritures sont regroupées en transactions de ``batch_size`` caches
          (un seul ``fsync`` SQLite par lot au lieu d'un par cache), chaque cache
          restant isolé par un ``SAVEPOINT`` pour qu'une erreur unitaire n'annule
          jamais le lot entier.

        ``outcome`` vaut ``'created'``, ``'existing'``, ``'moved'`` ou
        ``'updated'`` ; en cas d'échec, ``outcome`` est ``None`` et ``error``
        contient le message.
        """
        self._validate_zone(zone_id)

        valid_items: list[tuple[str, ScrapedGeocache]] = []
        for s in scraped_list:
            try:
                code = self.scraper.validate_gc_code(s.gc_code)
            except Exception as e:
                yield {'gc_code': getattr(s, 'gc_code', None), 'outcome': None, 'error': str(e)}
                continue
            valid_items.append((code, s))

        codes = [c for c, _ in valid_items]
        existing_map = self._preload_existing(codes)
        archive_map = ArchiveService.get_many_by_gc_code(codes)

        pending = 0

        def _flush_batch() -> None:
            try:
                db.session.commit()
            except Exception as e:  # pragma: no cover - défense sur commit de lot
                db.session.rollback()
                logger.error(f"Batch commit failed during bulk import: {e}")

        for code, s in valid_items:
            outcome: Optional[str] = None
            error: Optional[str] = None
            try:
                with db.session.begin_nested():
                    existing = existing_map.get(code)
                    if existing is None:
                        self._apply_new_geocache(zone_id, code, s, archive_map.get(code))
                        outcome = 'created'
                    else:
                        moved = existing.zone_id != zone_id
                        if moved:
                            existing.zone_id = zone_id
                        if update_existing:
                            self._apply_update_geocache(existing, s)
                            outcome = 'updated'
                        else:
                            outcome = 'moved' if moved else 'existing'
                pending += 1
            except Exception as e:
                error = str(e)
                logger.warning(f"Bulk import failed for {code}: {e}")

            if pending >= batch_size:
                _flush_batch()
                pending = 0

            yield {'gc_code': code, 'outcome': outcome, 'error': error}

        if pending:
            _flush_batch()
