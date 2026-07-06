import codecs

import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.geocaches.gpx_parser import parse_gpx_caches
from gc_backend.geocaches.importer import GeocacheImporter
from gc_backend.geocaches.models import Geocache
from gc_backend.models import Zone


GPX_SAMPLE = b"""<?xml version="1.0" encoding="utf-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/0" xmlns:groundspeak="http://www.groundspeak.com/cache/1/0/1">
 <wpt lat="48.856667" lon="2.350833">
  <time>2015-06-01T00:00:00</time>
  <name>GC1TEST</name>
  <url>https://coord.info/GC1TEST</url>
  <type>Geocache|Traditional Cache</type>
  <groundspeak:cache id="123" available="True" archived="False">
   <groundspeak:name>Ma Cache Test</groundspeak:name>
   <groundspeak:owner id="9">OwnerName</groundspeak:owner>
   <groundspeak:type>Traditional Cache</groundspeak:type>
   <groundspeak:container>Small</groundspeak:container>
   <groundspeak:difficulty>1.5</groundspeak:difficulty>
   <groundspeak:terrain>2</groundspeak:terrain>
   <groundspeak:short_description html="False">Courte desc &amp; test</groundspeak:short_description>
   <groundspeak:long_description html="True">&lt;p&gt;Longue&lt;/p&gt;</groundspeak:long_description>
   <groundspeak:encoded_hints>Sous la pierre</groundspeak:encoded_hints>
   <groundspeak:attributes>
     <groundspeak:attribute id="1" inc="1">Dogs allowed</groundspeak:attribute>
     <groundspeak:attribute id="13" inc="0">Available at all times</groundspeak:attribute>
   </groundspeak:attributes>
  </groundspeak:cache>
 </wpt>
 <wpt lat="48.0" lon="2.0"><name>PK1TEST</name></wpt>
 <wpt lat="49.0" lon="3.0"><name>GC9BARE</name></wpt>
</gpx>"""


def test_parse_gpx_extracts_full_cache_and_bare_code():
    caches, codes = parse_gpx_caches(GPX_SAMPLE)

    assert codes == ['GC9BARE']  # pas de bloc groundspeak -> code seul
    assert len(caches) == 1

    c = caches[0]
    assert c.gc_code == 'GC1TEST'
    assert c.name == 'Ma Cache Test'
    assert c.type == 'Traditional'  # vocabulaire court du scraper
    assert c.size == 'small'
    assert c.difficulty == 1.5
    assert c.terrain == 2.0
    assert c.owner == 'OwnerName'
    assert c.latitude == pytest.approx(48.856667)
    assert c.longitude == pytest.approx(2.350833)
    assert c.status == 'active'
    assert c.coordinates_raw.startswith('N 48')
    # inc=0 => attribut négatif
    assert c.attributes[1]['is_negative'] is True
    # indices stockés en ROT13 pour cohérence avec le scraper
    assert codecs.decode(c.hints, 'rot_13') == 'Sous la pierre'


def test_parse_gpx_status_variants():
    archived = GPX_SAMPLE.replace(b'archived="False"', b'archived="True"')
    caches, _ = parse_gpx_caches(archived)
    assert caches[0].status == 'archived'

    disabled = GPX_SAMPLE.replace(b'available="True"', b'available="False"')
    caches, _ = parse_gpx_caches(disabled)
    assert caches[0].status == 'disabled'


@pytest.fixture
def app():
    app = create_app()
    app.config['TESTING'] = True
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()


def test_import_from_scraped_persists_without_network(app):
    """import_from_scraped doit créer la géocache sans appel réseau (pas de scraper)."""
    with app.app_context():
        zone = Zone(name='Zone GPX')
        db.session.add(zone)
        db.session.flush()

        caches, _ = parse_gpx_caches(GPX_SAMPLE)

        # scraper=None interdit tout accès réseau involontaire : on passe un
        # importer dont le scraper ne sera jamais appelé sur ce chemin.
        importer = GeocacheImporter.__new__(GeocacheImporter)
        from gc_backend.geocaches.scraper import GeocachingScraper
        importer.scraper = GeocachingScraper.__new__(GeocachingScraper)  # non utilisé

        g = importer.import_from_scraped(zone.id, caches[0])

        assert g.id is not None
        stored = Geocache.query.filter_by(gc_code='GC1TEST').first()
        assert stored is not None
        assert stored.name == 'Ma Cache Test'
        assert stored.type == 'Traditional'
        assert stored.size == 'small'
        assert stored.hints_decoded == 'Sous la pierre'
        assert stored.zone_id == zone.id


def _bare_importer():
    """Importer dont le scraper ne doit jamais être appelé (chemin sans réseau)."""
    from gc_backend.geocaches.scraper import GeocachingScraper
    importer = GeocacheImporter.__new__(GeocacheImporter)
    importer.scraper = GeocachingScraper.__new__(GeocachingScraper)
    return importer


def test_import_outcomes_created_existing_moved(app):
    with app.app_context():
        zone_a = Zone(name='Zone A')
        zone_b = Zone(name='Zone B')
        db.session.add_all([zone_a, zone_b])
        db.session.flush()

        caches, _ = parse_gpx_caches(GPX_SAMPLE)
        sc = caches[0]
        importer = _bare_importer()

        # 1) Première fois -> created
        _, outcome = importer.import_from_scraped(zone_a.id, sc, return_outcome=True)
        assert outcome == 'created'

        # 2) Ré-import dans la même zone -> existing
        _, outcome = importer.import_from_scraped(zone_a.id, sc, return_outcome=True)
        assert outcome == 'existing'

        # 3) Import dans une autre zone -> moved
        _, outcome = importer.import_from_scraped(zone_b.id, sc, return_outcome=True)
        assert outcome == 'moved'
        moved = Geocache.query.filter_by(gc_code='GC1TEST').first()
        assert moved.zone_id == zone_b.id


def test_import_update_existing_updates_fields_and_keeps_waypoints(app):
    from gc_backend.geocaches.models import GeocacheWaypoint
    from gc_backend.geocaches.scraper import ScrapedGeocache

    with app.app_context():
        zone = Zone(name='Zone update')
        db.session.add(zone)
        db.session.flush()

        caches, _ = parse_gpx_caches(GPX_SAMPLE)
        importer = _bare_importer()

        g = importer.import_from_scraped(zone.id, caches[0])
        # Ajouter un waypoint local (comme s'il venait d'un scrape antérieur)
        db.session.add(GeocacheWaypoint(geocache_id=g.id, prefix='PK', name='Parking'))
        db.session.commit()
        gc_id = g.id

        # Sans update_existing -> ignorée
        _, outcome = importer.import_from_scraped(zone.id, caches[0], return_outcome=True)
        assert outcome == 'existing'

        # Avec update_existing + données modifiées -> mise à jour
        updated_sc = ScrapedGeocache(
            gc_code='GC1TEST', name='Nom modifié', url=None, type='Mystery', size='regular',
            owner='NewOwner', difficulty=4.0, terrain=3.5,
            latitude=1.0, longitude=1.0, placed_at=None, status='active',
            waypoints=[],  # GPX standard: pas de waypoints -> ne doit pas les effacer
        )
        _, outcome = importer.import_from_scraped(
            zone.id, updated_sc, return_outcome=True, update_existing=True
        )
        assert outcome == 'updated'

        refreshed = Geocache.query.get(gc_id)
        assert refreshed.name == 'Nom modifié'
        assert refreshed.difficulty == 4.0
        assert refreshed.size == 'regular'
        # Waypoint existant préservé (nouveau jeu vide)
        assert GeocacheWaypoint.query.filter_by(geocache_id=gc_id).count() == 1


def test_refresh_preserves_local_solved_coordinates(app, monkeypatch):
    from gc_backend.geocaches.scraper import ScrapedGeocache
    import gc_backend.blueprints.geocaches as gc_bp

    with app.app_context():
        zone = Zone(name='Zone refresh')
        db.session.add(zone)
        db.session.flush()

        # Cache résolue localement (coords corrigées non poussées sur GC)
        gc = Geocache(
            gc_code='GCLOCAL1', name='Mystery', zone_id=zone.id,
            latitude=48.5, longitude=2.5, coordinates_raw='N 48 30.000 E 002 30.000',
            is_corrected=True, solved='solved',
        )
        db.session.add(gc)
        db.session.commit()
        gc_id = gc.id

        # Le scrape renvoie les coords du listing (non corrigées sur GC)
        scraped = ScrapedGeocache(
            gc_code='GCLOCAL1', name='Mystery', url=None, type='Mystery', size='small',
            owner='O', difficulty=3.0, terrain=1.5,
            latitude=48.0, longitude=2.0, placed_at=None, status='active',
            coordinates_raw='N 48 00.000 E 002 00.000', is_corrected=False,
            original_latitude=48.0, original_longitude=2.0,
            original_coordinates_raw='N 48 00.000 E 002 00.000',
        )

        class _FakeScraper:
            def __init__(self, *a, **k):
                pass

            def scrape(self, code):
                return scraped

        monkeypatch.setattr(gc_bp, 'GeocachingScraper', _FakeScraper)
        monkeypatch.setattr(gc_bp, 'ensure_images_v2_for_geocache', lambda *a, **k: None)

        client = app.test_client()
        resp = client.post(f'/api/geocaches/{gc_id}/refresh')
        assert resp.status_code == 200

        refreshed = Geocache.query.get(gc_id)
        # Coordonnées locales préservées...
        assert refreshed.latitude == 48.5
        assert refreshed.longitude == 2.5
        assert refreshed.is_corrected is True
        # ...mais les coordonnées d'origine (listing) sont bien mises à jour
        assert refreshed.original_latitude == 48.0
        # ...et les autres champs rafraîchis
        assert refreshed.difficulty == 3.0
