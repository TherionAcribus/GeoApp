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
