"""
Tests de l'export GPX de la note personnelle Geocaching.com.

La note perso GC (`gc_personal_note`) n'est pas une Note GeoApp : elle a sa
propre préférence de position (`geoApp.gpxExport.personalNoteMode`), qui permet
de la placer en premier `<groundspeak:log>` ou à la fin du listing.
"""

import sys
import types
import xml.etree.ElementTree as ET

import pytest

try:
    import pyproj  # type: ignore
except ModuleNotFoundError:  # pragma: no cover - dépendance optionnelle en test
    class _FakeGeod:
        def __init__(self, **_kwargs):
            pass

        def inv(self, *_args, **_kwargs):
            return 0.0, 0.0, 0.0

    sys.modules['pyproj'] = types.SimpleNamespace(Geod=_FakeGeod)

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.models import Zone
from gc_backend.geocaches.models import Geocache
from gc_backend.utils.preferences import set_preference_value

GS_NS = {'groundspeak': 'http://www.groundspeak.com/cache/1/0/1'}

PERSONAL_NOTE = "Parking <ici>\nIndice: 3 & 4"


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


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def geocache_id(app):
    with app.app_context():
        zone = Zone(name='GPX Export Test Zone')
        db.session.add(zone)
        db.session.flush()

        geocache = Geocache(
            gc_code='GCNOTE1',
            name='Cache avec note perso',
            owner='TherionAcribus',
            type='Mystery Cache',
            latitude=47.5,
            longitude=2.5,
            description_html='<p>Listing</p>',
            gc_personal_note=PERSONAL_NOTE,
            zone_id=zone.id,
        )
        db.session.add(geocache)
        db.session.commit()
        return geocache.id


def _export(client, geocache_id):
    response = client.post('/api/geocaches/export-gpx', json={'geocache_ids': [geocache_id]})
    assert response.status_code == 200
    return ET.fromstring(response.data)


def _long_description(root):
    return root.find('.//groundspeak:long_description', GS_NS).text or ''


def _log_texts(root):
    return [el.text or '' for el in root.findall('.//groundspeak:log/groundspeak:text', GS_NS)]


def test_personal_note_exported_as_first_log_by_default(client, geocache_id):
    root = _export(client, geocache_id)

    texts = _log_texts(root)
    assert texts and texts[0] == f'[Note perso GC] {PERSONAL_NOTE}'
    assert 'Note perso GC' not in _long_description(root)


def test_personal_note_appended_to_listing(app, client, geocache_id):
    with app.app_context():
        set_preference_value('geoApp.gpxExport.personalNoteMode', 'listing')

    root = _export(client, geocache_id)

    listing = _long_description(root)
    assert listing.startswith('<p>Listing</p>')
    assert '<b>[Note perso GC]</b>' in listing
    # Texte brut GC.com : échappé, et retours à la ligne convertis en <br/>.
    assert 'Parking &lt;ici&gt;<br/>Indice: 3 &amp; 4' in listing
    assert _log_texts(root) == []


def test_personal_note_not_exported_when_disabled(app, client, geocache_id):
    with app.app_context():
        set_preference_value('geoApp.gpxExport.personalNoteMode', 'none')

    root = _export(client, geocache_id)

    assert _log_texts(root) == []
    assert 'Note perso GC' not in _long_description(root)


def test_empty_personal_note_adds_no_log(app, client, geocache_id):
    with app.app_context():
        geocache = db.session.get(Geocache, geocache_id)
        geocache.gc_personal_note = '   '
        db.session.commit()

    root = _export(client, geocache_id)

    assert _log_texts(root) == []
