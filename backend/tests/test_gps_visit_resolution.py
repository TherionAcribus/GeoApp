"""Rattachement des visites GPS sans code : voisines, recherche de proximité, dates de trouvaille."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from gc_backend import create_app
from gc_backend.blueprints import gps_visits as gps_visits_bp
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache
from gc_backend.models import GpsVisit, Zone
from gc_backend.services import gps_visit_resolution as resolution
from gc_backend.services import gps_visit_store

CEST = timezone(timedelta(hours=2))


@pytest.fixture(autouse=True)
def _fresh_caches():
    resolution.clear_finds_cache()
    yield
    resolution.clear_finds_cache()


@pytest.fixture
def app(monkeypatch):
    monkeypatch.setattr(gps_visit_store, 'get_local_tz', lambda: CEST)
    app = create_app()
    app.config['TESTING'] = True
    with app.app_context():
        db.create_all()
        zone = Zone(name='Z1')
        db.session.add(zone)
        db.session.flush()
        # Voisine connue de GeoApp : située sans réseau.
        db.session.add(Geocache(gc_code='GCBEFORE', name='Avant', type='Traditional', zone_id=zone.id,
                                latitude=48.0, longitude=7.0))
        db.session.add_all([
            GpsVisit(raw_code='GCBEFORE', gc_code='GCBEFORE', visited_at=datetime(2021, 6, 13, 8, 30),
                     status_raw='Found it', status='found'),
            GpsVisit(raw_code='', gc_code=None, visited_at=datetime(2021, 6, 13, 8, 45),
                     status_raw='Found it', status='found'),
            GpsVisit(raw_code='GCAFTER', gc_code='GCAFTER', visited_at=datetime(2021, 6, 13, 9, 0),
                     status_raw='Found it', status='found'),
            # Hors de la fenêtre de 90 min : pas une voisine.
            GpsVisit(raw_code='GCFAR', gc_code='GCFAR', visited_at=datetime(2021, 6, 13, 14, 0),
                     status_raw='Found it', status='found'),
        ])
        db.session.commit()
        app.visit_id = GpsVisit.query.filter(GpsVisit.gc_code.is_(None)).one().id
        yield app
        db.session.remove()
        db.drop_all()


def _record(code, lat, lon, found=None, name=None):
    record = {'code': code, 'name': name or code, 'postedCoordinates': {'latitude': lat, 'longitude': lon},
              'geocacheType': 2}
    if found is not None:
        record['userFound'] = found
    return record


def _sheet(lat, lon, found_on=None):
    return {'name': 'X', 'postedCoordinates': {'latitude': lat, 'longitude': lon},
            'callerSpecific': {'found': f'{found_on}T12:00:00' if found_on else None}}


class _Fakes:
    def __init__(self, boxes, sheets):
        self.boxes = list(boxes)
        self.sheets = sheets
        self.box_calls = []
        self.lookups = []

    def request(self, params):
        assert 'box' in params, 'la recherche rapide ne lit pas mes trouvailles'
        self.box_calls.append(params['box'])
        return {'results': self.boxes.pop(0) if self.boxes else []}

    def lookup(self, code):
        self.lookups.append(code)
        return self.sheets.get(code)


def _find(app, fakes, **kwargs):
    with app.app_context():
        visit = db.session.get(GpsVisit, app.visit_id)
        return resolution.find_candidates(visit, request=fakes.request, lookup=fakes.lookup, username='moi',
                                          tz=CEST, sleep=lambda s: None, **kwargs)


def test_confirms_the_cache_found_that_day(app):
    fakes = _Fakes(
        boxes=[[
            _record('GCBEFORE', 48.0, 7.0, found=True),       # connue du GPS : exclue
            _record('GCNEAR', 48.001, 7.004, found=True),      # trouvée ce jour-là
            _record('GCOLD', 48.0005, 7.0005, found=True),     # trouvée une autre année
            _record('GCNOTFOUND', 48.0002, 7.0002),            # jamais trouvée
        ]],
        sheets={'GCAFTER': _sheet(48.002, 7.008), 'GCNEAR': _sheet(48.001, 7.004, '2021-06-13'),
                'GCOLD': _sheet(48.0005, 7.0005, '2019-01-01')},
    )
    result = _find(app, fakes)
    assert [n['gc_code'] for n in result['neighbours']] == ['GCBEFORE', 'GCAFTER']
    assert result['located'] is True
    codes = [c['gc_code'] for c in result['candidates']]
    assert codes[0] == 'GCNEAR'
    assert result['candidates'][0]['day_confidence'] == 'confirmed'
    assert 'GCBEFORE' not in codes
    # Jamais trouvée avant « trouvée une autre année » : un DNF sans code reste possible.
    assert codes.index('GCNOTFOUND') < codes.index('GCOLD')
    # Un candidat confirmé dès la première boîte : pas d'élargissement.
    assert len(fakes.box_calls) == 1
    # La voisine en base n'a pas demandé de fiche ; la date n'est lue que pour mes trouvailles.
    assert 'GCBEFORE' not in fakes.lookups and 'GCNOTFOUND' not in fakes.lookups


def test_widens_the_search_when_nothing_is_confirmed(app):
    fakes = _Fakes(
        boxes=[[_record('GCNEAR', 48.001, 7.004)], [_record('GCWIDE', 48.02, 7.02, found=True)]],
        sheets={'GCAFTER': _sheet(48.002, 7.008), 'GCWIDE': _sheet(48.02, 7.02, '2021-06-14')},
    )
    result = _find(app, fakes)
    assert len(fakes.box_calls) == 2
    assert result['search_radius_m'] == 3330
    wide = next(c for c in result['candidates'] if c['gc_code'] == 'GCWIDE')
    # Log saisi le lendemain : « jour proche », devant une cache jamais trouvée.
    assert wide['day_confidence'] == 'close_day'
    assert result['candidates'][0]['gc_code'] == 'GCWIDE'


def test_sheets_are_cached_between_visits(app):
    sheets = {'GCAFTER': _sheet(48.002, 7.008), 'GCNEAR': _sheet(48.001, 7.004, '2021-06-13')}
    first = _Fakes(boxes=[[_record('GCNEAR', 48.001, 7.004, found=True)]], sheets=sheets)
    _find(app, first)
    second = _Fakes(boxes=[[_record('GCNEAR', 48.001, 7.004, found=True)]], sheets=sheets)
    _find(app, second)
    assert second.lookups == []


class _FakePager:
    """Mes trouvailles en pages de 2, plus récentes d'abord."""

    def __init__(self, codes):
        self.codes = codes
        self.reads = []

    @property
    def total(self):
        return len(self.codes)

    @property
    def reachable_pages(self):
        return (len(self.codes) + 1) // 2

    def page(self, index):
        self.reads.append(index)
        return [resolution.Candidate(gc_code=c, found_by_me=True) for c in self.codes[index * 2:index * 2 + 2]]


def test_finds_order_places_an_unknown_find_on_the_visit_day():
    known = {
        'GCN1': date(2021, 7, 1), 'GCN2': date(2021, 6, 20),
        'GCD1': date(2021, 6, 13), 'GCD2': date(2021, 6, 13),
        'GCO1': date(2021, 6, 1), 'GCO2': date(2021, 5, 1),
    }
    pager = _FakePager(['GCN1', 'GCN2', 'GCD1', 'GCX', 'GCD2', 'GCO1', 'GCO2', 'GCY'])
    candidates, state = resolution.finds_around_day(pager, date(2021, 6, 13), known, set(known))
    assert state == 'ok'
    assert [(c.gc_code, c.day_confidence) for c in candidates] == [('GCX', 'same_day')]
    assert candidates[0].sources == {'my_finds'}


def test_finds_order_out_of_reach():
    known = {'GCN1': date(2021, 7, 1), 'GCN2': date(2021, 6, 20)}
    pager = _FakePager(['GCN1', 'GCN2'])
    assert resolution.finds_around_day(pager, date(2020, 1, 1), known, set(known)) == ([], 'out_of_reach')


def test_first_page_not_newer_matches_a_linear_scan():
    # 50 pages de 2, deux trouvailles par jour en remontant le temps.
    start = date(2021, 12, 31)
    codes = [f'GC{i:04d}' for i in range(100)]
    known = {code: start - timedelta(days=i // 2) for i, code in enumerate(codes)}
    pager = _FakePager(codes)
    for offset in (0, 7, 23, 49):
        target = start - timedelta(days=offset)
        expected = next(i for i in range(50) if min(known[c] for c in codes[i * 2:i * 2 + 2]) <= target)
        assert resolution.first_page_not_newer(pager, target, known, 50) == expected


def test_resolve_endpoint(app):
    client = app.test_client()
    assert client.post(f'/api/gps-visits/{app.visit_id}/resolve', json={'gc_code': 'pas un code'}).status_code == 400
    body = client.post(f'/api/gps-visits/{app.visit_id}/resolve',
                       json={'gc_code': 'gcnear', 'source': 'neighbours'}).get_json()
    assert body['resolved_gc_code'] == 'GCNEAR'
    assert body['resolution_source'] == 'neighbours'
    # Une visite rattachée se comporte comme une visite codée dans la liste.
    client.post('/api/gps-visits/cutoff', json={'since': '2021-01-01'})
    entries = client.get('/api/gps-visits').get_json()['days'][0]['entries']
    assert any(e['gc_code'] == 'GCNEAR' and e['resolved'] for e in entries)
    # Détacher.
    assert client.post(f'/api/gps-visits/{app.visit_id}/resolve', json={'gc_code': None}).get_json()['resolved_gc_code'] is None


def test_a_visit_with_a_code_cannot_be_resolved(app):
    with app.app_context():
        coded = GpsVisit.query.filter_by(gc_code='GCAFTER').one().id
    client = app.test_client()
    assert client.post(f'/api/gps-visits/{coded}/resolve', json={'gc_code': 'GC1'}).status_code == 400
    assert client.get(f'/api/gps-visits/{coded}/candidates').status_code == 400


def test_candidates_endpoint_uses_the_search_and_sheets(app, monkeypatch):
    fakes = _Fakes(boxes=[[_record('GCNEAR', 48.001, 7.004, found=True)]],
                   sheets={'GCAFTER': _sheet(48.002, 7.008), 'GCNEAR': _sheet(48.001, 7.004, '2021-06-13')})
    monkeypatch.setattr(gps_visits_bp, '_geocache_sheet_lookup', lambda session: fakes.lookup)
    from gc_backend.services import geocaching_friend_finds
    monkeypatch.setattr(geocaching_friend_finds, 'get_friend_finds_client',
                        lambda: type('C', (), {'_request': staticmethod(fakes.request)})())
    from gc_backend.services import geocaching_auth
    user = type('U', (), {'username': 'moi'})()
    monkeypatch.setattr(geocaching_auth, 'get_auth_service', lambda: type('S', (), {
        'get_auth_state': lambda self: type('St', (), {'user_info': user})(),
        'get_session': lambda self: None,
    })())
    monkeypatch.setattr(resolution.time_module, 'sleep', lambda s: None)
    body = app.test_client().get(f'/api/gps-visits/{app.visit_id}/candidates').get_json()
    assert body['candidates'][0]['gc_code'] == 'GCNEAR'
    assert body['candidates'][0]['found_on'] == '2021-06-13'
    assert body['authenticated'] is True


# ------------------------------------------------- lot 4 : par la trace

def test_a_positioned_visit_is_searched_around_its_real_position(app):
    with app.app_context():
        visit = db.session.get(GpsVisit, app.visit_id)
        visit.latitude, visit.longitude, visit.position_source = 48.5, 7.5, 'track'
        db.session.commit()
    fakes = _Fakes(boxes=[[_record('GCHERE', 48.5001, 7.5001, found=True)]],
                   sheets={'GCHERE': _sheet(48.5001, 7.5001, '2021-06-13')})
    result = _find(app, fakes)
    assert result['position_source'] == 'track'
    assert result['position'] == {'latitude': 48.5, 'longitude': 7.5}
    # Boîte de ~300 m autour de la position, pas autour des voisines.
    assert fakes.box_calls == ['48.503,7.497,48.497,7.503']
    assert result['candidates'][0]['gc_code'] == 'GCHERE'
    assert result['candidates'][0]['distance_m'] < 20
    # Rattachée avec la source « trace », pas « voisines ».
    assert result['candidates'][0]['sources'] == ['track']
    # Les voisines ne sont pas situées : inutile.
    assert 'GCAFTER' not in fakes.lookups


def _day_visits(app, positions):
    with app.app_context():
        GpsVisit.query.delete()
        rows = []
        for minute, (lat, lon) in positions:
            rows.append(GpsVisit(raw_code='', gc_code=None, visited_at=datetime(2021, 10, 23, 8, minute),
                                 status_raw='Found it', status='found', latitude=lat, longitude=lon,
                                 position_source='track'))
        db.session.add_all(rows)
        db.session.commit()
        return [row.id for row in rows]


def test_resolve_day_assigns_each_visit_once(app):
    ids = _day_visits(app, [(0, (48.0, 7.0)), (10, (48.0005, 7.0)), (20, (48.01, 7.01))])
    fakes = _Fakes(
        boxes=[[
            _record('GCA', 48.0, 7.0001, found=True),       # au plus près des deux premières visites
            _record('GCB', 48.0006, 7.0, found=True),
            _record('GCOLD', 48.01, 7.0101, found=True),     # trouvée une autre année, tout près de la 3e
        ]],
        sheets={'GCA': _sheet(48.0, 7.0001, '2021-10-23'), 'GCB': _sheet(48.0006, 7.0, '2021-10-23'),
                'GCOLD': _sheet(48.01, 7.0101, '2015-01-01')},
    )
    with app.app_context():
        visits = GpsVisit.query.order_by(GpsVisit.visited_at).all()
        result = resolution.resolve_day(visits, request=fakes.request, lookup=fakes.lookup, tz=CEST, sleep=lambda s: None)
    by_visit = {v['visit_id']: v for v in result['visits']}
    assert by_visit[ids[0]]['proposal']['gc_code'] == 'GCA'
    # GCA est déjà prise : la 2e visite reçoit GCB, jamais deux fois la même cache.
    assert by_visit[ids[1]]['proposal']['gc_code'] == 'GCB'
    # Trouvée par moi à 8 m mais un autre jour : proposée faute de mieux, marquée comme telle.
    assert by_visit[ids[2]]['proposal']['gc_code'] == 'GCOLD'
    assert by_visit[ids[2]]['proposal']['day_confidence'] == 'other_day'
    # Une recherche par groupe de positions (la 3e visite est à 1,3 km) : pas une par visite.
    assert len(fakes.box_calls) == 2


def test_day_resolution_and_batch_endpoints(app, monkeypatch):
    ids = _day_visits(app, [(0, (48.0, 7.0))])
    fakes = _Fakes(boxes=[[_record('GCA', 48.0, 7.0001, found=True)]], sheets={'GCA': _sheet(48.0, 7.0001, '2021-10-23')})
    monkeypatch.setattr(gps_visits_bp, '_geocache_sheet_lookup', lambda session: fakes.lookup)
    from gc_backend.services import geocaching_friend_finds, geocaching_auth
    monkeypatch.setattr(geocaching_friend_finds, 'get_friend_finds_client',
                        lambda: type('C', (), {'_request': staticmethod(fakes.request)})())
    monkeypatch.setattr(geocaching_auth, 'get_auth_service', lambda: type('S', (), {'get_session': lambda self: None})())
    monkeypatch.setattr(resolution.time_module, 'sleep', lambda s: None)
    client = app.test_client()
    body = client.post('/api/gps-visits/day-resolution', json={'day': '2021-10-23'}).get_json()
    assert body['visits'][0]['proposal']['gc_code'] == 'GCA'
    assert body['unpositioned'] == 0
    assert client.post('/api/gps-visits/resolve-batch', json={'items': [
        {'visit_id': ids[0], 'gc_code': 'gca', 'source': 'track'}]}).get_json()['resolved'] == 1
    with app.app_context():
        visit = db.session.get(GpsVisit, ids[0])
        assert (visit.resolved_gc_code, visit.resolution_source) == ('GCA', 'track')
    assert client.post('/api/gps-visits/resolve-batch', json={'items': [{'visit_id': ids[0], 'gc_code': 'x'}]}).status_code == 400
