"""
Lecture complète du GPS : geocache_logs.xml, traces (position des visites, tracé du
jour), GPX des caches (index, création sans réseau), détection et import du dossier.
"""
from __future__ import annotations

import io
import json
import os
from datetime import date, datetime, timedelta, timezone

import pytest

from gc_backend import create_app
from gc_backend.blueprints import gps_visits as gps_visits_bp
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache
from gc_backend.models import GpsDeviceCache, GpsTrackDay, GpsVisit, Zone
from gc_backend.services import gps_device, gps_visit_store
from gc_backend.services.garmin_tracks import (
    TrackPoint,
    files_for_days,
    parse_track_points,
    position_at,
    simplify,
    track_distance_m,
)
from gc_backend.services.garmin_visits import parse_any, parse_logs_xml, reduce_by_cache_day, VisitRecord

CEST = timezone(timedelta(hours=2))

LOGS_XML = (
    b'<?xml version="1.0" encoding="utf-8"?>\n'
    b'<logs xmlns="http://www.garmin.com/xmlschemas/geocache_visits/v1">\n'
    b'<log><code>GC4NKAY</code><time>2026-09-27T11:45:30+02:00</time><result>found it</result><comment>Horse</comment></log>'
    b'<log><code>GC2BBBB</code><time>2026-09-27T12:00:10+02:00</time><result>did not find</result><comment></comment></log>'
    b'<log><code>\x03</code><time>2026-09-27T12:10:00+02:00</time><result>found it</result><comment></comment></log>'
    b'<log><code>GC5EEEE</code><time>2026-09-27T12:20:00+02:00</time><result>needs repair</result><comment></comment></log>'
    # Voyage : UTC+4, 01:30 local le 28 = 21:30Z le 27.
    b'<log><code>GC6FFFF</code><time>2026-09-28T01:30:00+04:00</time><result>found it</result><comment></comment></log>'
    b'</logs>'
)

VISITS_TXT = (
    'GC4NKAY,2026-09-27T09:45Z,Found it,"Horse"\r\n'
    'GC2BBBB,2026-09-27T10:00Z,Didn\'t find it,""\r\n'
    '\x03,2026-09-27T10:10Z,Found it,""\r\n'
    'GC5EEEE,2026-09-27T10:20Z,Needs Maintenance,""\r\n'
    'GC6FFFF,2026-09-27T21:30Z,Found it,""\r\n'
    'GC7GGGG,2026-09-27T13:00Z,Found it,""\r\n'
).encode('utf-16-le')


def _track_gpx(points: list[tuple[str, float, float]]) -> bytes:
    body = ''.join(f'<trkpt lat="{lat}" lon="{lon}"><ele>100</ele><time>{at}</time></trkpt>' for at, lat, lon in points)
    return f'<?xml version="1.0"?><gpx><trk><trkseg>{body}</trkseg></trk></gpx>'.encode()


TRACK = _track_gpx([
    ('2026-09-27T09:40:00Z', 49.0, 5.0),
    ('2026-09-27T09:50:00Z', 49.002, 5.002),  # 10 min : trop d'écart pour interpoler
    ('2026-09-27T09:59:00Z', 49.005, 5.005),
    ('2026-09-27T10:01:00Z', 49.007, 5.007),
    ('2026-09-27T10:09:00Z', 49.01, 5.01),
    ('2026-09-27T10:11:00Z', 49.012, 5.012),
    ('2026-09-27T10:19:00Z', 49.02, 5.02),
    ('2026-09-27T10:21:00Z', 49.022, 5.022),
])

CACHES_GPX = b"""<?xml version="1.0" encoding="utf-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/0" xmlns:groundspeak="http://www.groundspeak.com/cache/1/0/1">
 <wpt lat="49.1" lon="5.1">
  <name>GC2BBBB</name>
  <type>Geocache|Traditional Cache</type>
  <groundspeak:cache id="1" available="True" archived="False">
   <groundspeak:name>La cache du &amp; GPS</groundspeak:name>
   <groundspeak:owner id="9">Owner</groundspeak:owner>
   <groundspeak:type>Traditional Cache</groundspeak:type>
   <groundspeak:container>Small</groundspeak:container>
   <groundspeak:difficulty>1.5</groundspeak:difficulty>
   <groundspeak:terrain>2</groundspeak:terrain>
  </groundspeak:cache>
 </wpt>
</gpx>"""


# ------------------------------------------------------------------- lecteurs

def test_parse_logs_xml_keeps_offset_and_maps_labels():
    result = parse_logs_xml(LOGS_XML)
    assert result.unreadable == []
    first = result.visits[0]
    assert (first.gc_code, first.status, first.status_raw) == ('GC4NKAY', 'found', 'Found it')
    assert first.visited_at == datetime(2026, 9, 27, 9, 45, tzinfo=timezone.utc)
    assert (first.utc_offset_minutes, first.seconds) == (120, 30)
    statuses = {v.raw_code: (v.status, v.status_raw) for v in result.visits}
    assert statuses['GC2BBBB'] == ('dnf', "Didn't find it")
    assert statuses['GC5EEEE'] == ('needs_maintenance', 'Needs Maintenance')
    # L'octet de contrôle, interdit en XML, est retiré : visite sans code.
    assert statuses[''] == ('found', 'Found it')
    assert parse_any(LOGS_XML).visits[0].utc_offset_minutes == 120
    assert parse_any(VISITS_TXT).visits[0].utc_offset_minutes is None


def test_visit_day_follows_its_own_offset():
    # 21:30Z le 27 : le 27 à Paris, mais le 28 à UTC+4 où la visite a eu lieu.
    at = datetime(2026, 9, 27, 21, 30, tzinfo=timezone.utc)
    [abroad] = reduce_by_cache_day([VisitRecord(1, 'GC6FFFF', at, 'found', 'Found it', utc_offset_minutes=240)], CEST)
    [home] = reduce_by_cache_day([VisitRecord(1, 'GC6FFFF', at, 'found', 'Found it')], CEST)
    assert (abroad.day, abroad.local_time) == (date(2026, 9, 28), '01:30')
    assert home.day == date(2026, 9, 27)


def test_track_positions():
    points = parse_track_points(TRACK)
    assert len(points) == 8
    at = datetime(2026, 9, 27, 10, 10, tzinfo=timezone.utc)
    lat, lon = position_at(points, at)
    assert lat == pytest.approx(49.011) and lon == pytest.approx(5.011)
    # 09:45 : encadrée par deux points à 10 min d'écart, rien d'assez proche.
    assert position_at(points, datetime(2026, 9, 27, 9, 45, tzinfo=timezone.utc)) is None
    # 09:41 : le point de 09:40 est à moins de 2 min.
    assert position_at(points, datetime(2026, 9, 27, 9, 41, tzinfo=timezone.utc)) == (49.0, 5.0)


def test_simplify_and_distance():
    start = datetime(2026, 9, 27, tzinfo=timezone.utc)
    line = [TrackPoint(start + timedelta(seconds=i), 49.0, 5.0 + i * 0.0001) for i in range(50)]
    simplified = simplify(line)
    assert len(simplified) == 2
    assert track_distance_m(simplified) == pytest.approx(track_distance_m(line), rel=1e-3)


def test_track_files_for_days():
    names = ['2026-09-26 18.00.00 Auto.gpx', '2026-09-27 09.00.00 Auto.gpx', '2026-09-28 09.00.00 Auto.gpx', 'x.gpx']
    assert files_for_days(names, [date(2026, 9, 27)]) == names[:2]


def test_light_index_reads_name_type_and_position():
    [cache] = gps_device.light_index(CACHES_GPX)
    assert cache == {'gc_code': 'GC2BBBB', 'name': 'La cache du & GPS', 'cache_type': 'Traditional Cache',
                     'latitude': 49.1, 'longitude': 5.1}


# ---------------------------------------------------------------- base et API

@pytest.fixture
def app(monkeypatch):
    monkeypatch.setattr(gps_visit_store, 'get_local_tz', lambda: CEST)
    monkeypatch.setattr(gps_visits_bp, 'DOWNLOAD_INTERVAL_SECONDS', 0)
    app = create_app()
    app.config['TESTING'] = True
    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()


@pytest.fixture
def garmin(tmp_path, monkeypatch):
    """Un faux GPS : dossier Garmin avec visites, traces et GPX de caches."""
    root = tmp_path / 'Garmin'
    (root / 'GPX' / 'Archive').mkdir(parents=True)
    (root / 'GPX' / 'Current').mkdir()
    (root / 'geocache_logs.xml').write_bytes(LOGS_XML)
    (root / 'geocache_visits.txt').write_bytes(VISITS_TXT)
    (root / 'GPX' / 'Archive' / '2026-09-27 09.39.00 Auto.gpx').write_bytes(TRACK)
    (root / 'GPX' / 'Current' / 'Current.gpx').write_bytes(_track_gpx([]))
    (root / 'GPX' / '26057817.gpx').write_bytes(CACHES_GPX)
    (root / 'GPX' / 'Waypoints_27-SEPT-26.gpx').write_bytes(b'<gpx/>')
    monkeypatch.setattr(gps_visits_bp, '_mount_points', lambda: [str(tmp_path)])
    return root


def test_detect_reports_the_device(app, garmin):
    devices = app.test_client().get('/api/gps-visits/detect').get_json()['devices']
    assert devices[0]['root'] == str(garmin)
    assert devices[0]['has_logs_xml'] and devices[0]['has_visits_txt']
    assert (devices[0]['tracks_count'], devices[0]['gpx_count']) == (2, 1)


def test_import_device_reads_everything_without_duplicates(app, garmin):
    client = app.test_client()
    first = client.post('/api/gps-visits/import', json={'device': str(garmin)}).get_json()
    # XML (5 visites) puis TXT : 1 seule visite en plus (GC7GGGG), les autres complétées/reconnues.
    assert first['new'] == 6
    assert first['device']['gpx_indexed'] == 1
    assert first['device']['positioning'] == 'after_cutoff'
    with app.app_context():
        assert GpsVisit.query.count() == 6
        assert GpsVisit.query.filter_by(gc_code='GC4NKAY').one().utc_offset_minutes == 120
        assert db.session.get(GpsDeviceCache, 'GC2BBBB').name == 'La cache du & GPS'

    client.post('/api/gps-visits/cutoff', json={'since': '2026-09-01'})
    positioned = client.post('/api/gps-visits/position', json={}).get_json()
    assert positioned['positioned'] == 3  # 10:00Z, 10:10Z, 10:20Z encadrées par la trace
    again = client.post('/api/gps-visits/import', json={'device': str(garmin)}).get_json()
    assert again['new'] == 0 and again['device']['gpx_indexed'] == 0

    listing = client.get('/api/gps-visits').get_json()
    entries = {e['gc_code']: e for d in listing['days'] for e in d['entries']}
    # 10:00:10 entre 09:59 et 10:01 : interpolée à 70 s sur 120.
    assert entries['GC2BBBB']['position'] == {'latitude': pytest.approx(49.0061667), 'longitude': pytest.approx(5.0061667)}
    assert entries['GC2BBBB']['name'] == 'La cache du & GPS'
    assert entries['GC2BBBB']['device']['gpx_date'] is not None
    assert entries['GC4NKAY']['position_source'] == 'no_track'
    # La visite en UTC+4 tombe le 28.
    assert entries['GC6FFFF']['day'] == '2026-09-28'
    tracks = client.get('/api/gps-visits/tracks?days=2026-09-27').get_json()['tracks']
    assert tracks[0]['distance_m'] > 0


def test_txt_then_xml_completes_instead_of_duplicating(app):
    client = app.test_client()
    client.post('/api/gps-visits/import', data={'files': (io.BytesIO(VISITS_TXT), 'geocache_visits.txt')},
                content_type='multipart/form-data')
    report = client.post('/api/gps-visits/import', data={'files': (io.BytesIO(LOGS_XML), 'geocache_logs.xml')},
                         content_type='multipart/form-data').get_json()
    assert report['new'] == 0
    assert report['enriched'] == 5
    with app.app_context():
        assert GpsVisit.query.count() == 6


def test_dropped_files_feed_tracks_and_caches(app, monkeypatch, tmp_path):
    from gc_backend.config import Config

    monkeypatch.setattr(Config, 'DATA_DIR', str(tmp_path))
    client = app.test_client()
    client.post('/api/gps-visits/import', data={'files': (io.BytesIO(LOGS_XML), 'geocache_logs.xml')},
                content_type='multipart/form-data')
    client.post('/api/gps-visits/cutoff', json={'since': '2026-09-01'})
    report = client.post('/api/gps-visits/import', data={'files': [
        (io.BytesIO(LOGS_XML), 'geocache_logs.xml'),
        (io.BytesIO(TRACK), '2026-09-27 09.39.00 Auto.gpx'),
        (io.BytesIO(CACHES_GPX), '26057817.gpx'),
    ]}, content_type='multipart/form-data').get_json()
    assert report['device']['positioned'] == 3
    assert report['device']['gpx_indexed'] == 1
    assert os.path.isfile(os.path.join(str(tmp_path), 'gps_device_gpx', '26057817.gpx'))


def test_position_requires_the_gps(app, monkeypatch):
    monkeypatch.setattr(gps_visits_bp, '_mount_points', lambda: [])
    response = app.test_client().post('/api/gps-visits/position', json={})
    assert response.status_code == 409


def test_adding_to_a_zone_creates_from_the_gps_gpx(app, garmin, monkeypatch):
    from gc_backend.geocaches import importer as importer_module

    created = []

    class _Importer:
        def import_from_scraped(self, zone_id, scraped, return_outcome=False, update_existing=False):
            created.append(('gps', scraped.gc_code, scraped.name))
            geocache = Geocache(gc_code=scraped.gc_code, name=scraped.name, type='Traditional', zone_id=zone_id)
            db.session.add(geocache)
            db.session.commit()
            return geocache

        def import_by_code(self, zone_id, code, return_outcome=False, update_existing=False):
            created.append(('site', code, None))
            geocache = Geocache(gc_code=code, name=code, type='Traditional', zone_id=zone_id)
            db.session.add(geocache)
            db.session.commit()
            return geocache

    monkeypatch.setattr(importer_module, 'GeocacheImporter', _Importer)
    client = app.test_client()
    client.post('/api/gps-visits/import', json={'device': str(garmin)})
    client.post('/api/gps-visits/cutoff', json={'since': '2026-09-01'})
    preparation = client.post('/api/gps-visits/prepare', json={'day': '2026-09-27'}).get_json()
    plans = {e['gc_code']: e['plan'] for e in preparation['entries']}
    assert plans['GC2BBBB'] == 'gps' and plans['GC4NKAY'] == 'download'
    response = client.post('/api/gps-visits/zone-operations', json={
        'operation_id': 'op-gps-0001', 'day': '2026-09-27', 'new_zone_name': 'Sortie'})
    lines = [json.loads(line) for line in response.get_data(as_text=True).splitlines() if line.strip()]
    assert ('gps', 'GC2BBBB', 'La cache du & GPS') in created
    assert any('Créée depuis le GPS : GC2BBBB' in line.get('message', '') for line in lines)
    assert lines[-1]['progress'] == 100
    with app.app_context():
        assert Zone.query.filter_by(name='Sortie').one() is not None
        assert GpsTrackDay.query.count() == 0  # pas de positionnement sans demande
