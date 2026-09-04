"""Clustering géographique et analyse multi-boîtes des zones dispersées."""
from __future__ import annotations

import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache
from gc_backend.models import Zone
from gc_backend.services.geocaching_friend_finds import (
    GeocachingFriendFindsClient,
    ZoneBox,
    cluster_coordinates,
    zone_boxes_from_coordinates,
    _haversine_km,
)


# ----------------------------------------------------------- Fakes (réutilisés)

class _FakeResponse:
    def __init__(self, payload=None, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code
        self.text = str(payload)

    def json(self):
        if self._payload is None:
            raise ValueError('no json')
        return self._payload


class _FakeSearchSession:
    """Renvoie un catalogue filtré par box, nfb et fb."""

    def __init__(self, catalogue: dict[str, list[str]], box_codes: dict[str, list[str]] | None = None):
        """
        catalogue : {pseudo: codes trouvés} + clé '*' = toutes les caches.
        box_codes : {box_param: [codes dans cette boîte]} — simule le fait
                    que chaque boîte ne contient qu'un sous-ensemble des caches.
        """
        self.catalogue = catalogue
        self.box_codes = box_codes or {}
        self.calls: list[dict] = []

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append(dict(params or {}))
        codes = list(self.catalogue['*'])
        # Filtrer par boîte si la session simule des boîtes distinctes.
        box = (params or {}).get('box')
        if box and box in self.box_codes:
            codes = [c for c in codes if c in self.box_codes[box]]
        nfb = (params or {}).get('nfb')
        if nfb:
            codes = [c for c in codes if c not in self.catalogue.get(nfb, [])]
        fb = (params or {}).get('fb')
        if fb:
            codes = [c for c in codes if c in self.catalogue.get(fb, [])]
        skip = int((params or {}).get('skip', 0))
        take = int((params or {}).get('take', 100))
        page = codes[skip:skip + take]
        return _FakeResponse({'total': len(codes), 'results': [{'code': c} for c in page]})


def _client(session):
    return GeocachingFriendFindsClient(
        session=session, min_interval=0, retry_delays=(), sleep=lambda _s: None
    )


# ------------------------------------------------------- Tests _haversine_km

def test_haversine_same_point_is_zero():
    assert _haversine_km(49.2, 6.1, 49.2, 6.1) == pytest.approx(0, abs=0.01)


def test_haversine_known_distance():
    # Paris → Lyon ~390 km
    d = _haversine_km(48.8566, 2.3522, 45.7640, 4.8357)
    assert 380 < d < 410


# ------------------------------------------------------- Tests cluster_coordinates

def test_cluster_single_group():
    """Des caches proches forment un seul cluster."""
    coords = [
        (49.20, 6.10),
        (49.21, 6.11),
        (49.22, 6.12),
    ]
    clusters = cluster_coordinates(coords, radius_km=5.0)
    assert len(clusters) == 1
    assert len(clusters[0]) == 3


def test_cluster_two_distant_groups():
    """Des caches éloignées forment deux clusters."""
    coords = [
        (49.20, 6.10),  # groupe 1
        (49.21, 6.11),
        (50.50, 7.50),  # groupe 2 (~150 km du groupe 1)
        (50.51, 7.51),
    ]
    clusters = cluster_coordinates(coords, radius_km=5.0)
    assert len(clusters) == 2
    assert len(clusters[0]) == 2
    assert len(clusters[1]) == 2


def test_cluster_chain_merges_close_points():
    """Des points en chaîne (chacun à < radius du suivant) forment un cluster."""
    coords = [
        (49.20, 6.10),
        (49.22, 6.12),  # ~3 km du précédent
        (49.24, 6.14),  # ~3 km du précédent
    ]
    clusters = cluster_coordinates(coords, radius_km=5.0)
    assert len(clusters) == 1
    assert len(clusters[0]) == 3


def test_cluster_empty():
    assert cluster_coordinates([]) == []


def test_cluster_single_point():
    clusters = cluster_coordinates([(49.2, 6.1)])
    assert len(clusters) == 1
    assert len(clusters[0]) == 1


# --------------------------------------------------- Tests zone_boxes_from_coordinates

def test_zone_boxes_compact_returns_one_box():
    coords = [(49.20, 6.10), (49.21, 6.11), (49.22, 6.12)]
    boxes = zone_boxes_from_coordinates(coords, radius_km=5.0)
    assert len(boxes) == 1


def test_zone_boxes_dispersed_returns_multiple():
    coords = [
        (49.20, 6.10),
        (49.21, 6.11),
        (50.50, 7.50),  # ~150 km
        (50.51, 7.51),
    ]
    boxes = zone_boxes_from_coordinates(coords, radius_km=5.0)
    assert len(boxes) == 2
    # Chaque boîte est plus petite que la boîte globale.
    global_box = ZoneBox.from_coordinates(coords)
    for box in boxes:
        assert (box.lat_max - box.lat_min) < (global_box.lat_max - global_box.lat_min)


def test_zone_boxes_empty():
    assert zone_boxes_from_coordinates([]) == []


# ------------------------------------------------------- Tests find_codes_found_by_multi

BOX1 = ZoneBox(lat_max=49.3, lon_min=6.0, lat_min=49.2, lon_max=6.2)
BOX2 = ZoneBox(lat_max=50.6, lon_min=7.4, lat_min=50.5, lon_max=7.6)


def test_multi_box_merges_finds_from_all_clusters():
    """Un ami avec des trouvailles dans deux clusters : l'union est retournée."""
    session = _FakeSearchSession(
        catalogue={
            '*': ['GC1', 'GC2', 'GC3', 'GC4'],
            'ami': ['GC1', 'GC3'],
        },
        box_codes={
            BOX1.box_param: ['GC1', 'GC2'],
            BOX2.box_param: ['GC3', 'GC4'],
        },
    )
    result = _client(session).find_codes_found_by_multi('ami', [BOX1, BOX2])

    assert result.found_codes == {'GC1', 'GC3'}
    assert result.truncated is False


def test_multi_box_zero_finds_across_clusters():
    """Un ami avec 0 trouvaille dans tous les clusters."""
    session = _FakeSearchSession(
        catalogue={
            '*': ['GC1', 'GC2', 'GC3', 'GC4'],
            'ami': [],
        },
        box_codes={
            BOX1.box_param: ['GC1', 'GC2'],
            BOX2.box_param: ['GC3', 'GC4'],
        },
    )
    result = _client(session).find_codes_found_by_multi('ami', [BOX1, BOX2])

    assert result.found_codes == set()


def test_multi_box_empty_boxes_list():
    """Une liste vide de boîtes retourne un résultat vide."""
    session = _FakeSearchSession({'*': ['GC1'], 'ami': ['GC1']})
    result = _client(session).find_codes_found_by_multi('ami', [])

    assert result.found_codes == set()
    assert result.zone_codes_count == 0


def test_multi_box_single_box_equivalent_to_single():
    """Une seule boîte : le résultat est équivalent à find_codes_found_by."""
    session = _FakeSearchSession({
        '*': ['GC1', 'GC2', 'GC3'],
        'ami': ['GC2'],
    })
    client = _client(session)

    single = client.find_codes_found_by('ami', BOX1)
    session.calls.clear()
    multi = client.find_codes_found_by_multi('ami', [BOX1])

    assert multi.found_codes == single.found_codes


# ------------------------------------------------------- Tests _zone_boxes (blueprint)

@pytest.fixture
def app():
    app = create_app()
    app.config['TESTING'] = True
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
    with app.app_context():
        db.create_all()
        zone = Zone(name='Z1')
        db.session.add(zone)
        db.session.flush()
        # Deux groupes distants : Nancy et Strasbourg (~120 km)
        db.session.add_all([
            Geocache(gc_code='GC1', name='Nancy1', type='Traditional',
                     zone_id=zone.id, latitude=48.69, longitude=6.18),
            Geocache(gc_code='GC2', name='Nancy2', type='Traditional',
                     zone_id=zone.id, latitude=48.70, longitude=6.19),
            Geocache(gc_code='GC3', name='Strasbourg1', type='Traditional',
                     zone_id=zone.id, latitude=48.58, longitude=7.75),
            Geocache(gc_code='GC4', name='Strasbourg2', type='Traditional',
                     zone_id=zone.id, latitude=48.59, longitude=7.76),
        ])
        db.session.commit()
        app.zone_id = zone.id
        yield app
        db.session.remove()
        db.drop_all()


def test_zone_boxes_returns_two_clusters_for_dispersed_zone(app):
    import gc_backend.blueprints.friends as blueprint

    boxes = blueprint._zone_boxes(app.zone_id)
    assert len(boxes) == 2


def test_zone_boxes_returns_one_cluster_for_compact_zone(app):
    import gc_backend.blueprints.friends as blueprint

    # Supprimer les caches de Strasbourg.
    Geocache.query.filter_by(gc_code='GC3').delete()
    Geocache.query.filter_by(gc_code='GC4').delete()
    db.session.commit()

    boxes = blueprint._zone_boxes(app.zone_id)
    assert len(boxes) == 1


def test_zone_boxes_empty_for_zone_without_coordinates(app):
    import gc_backend.blueprints.friends as blueprint

    # Zone sans coordonnées.
    zone2 = Zone(name='Z2')
    db.session.add(zone2)
    db.session.commit()

    assert blueprint._zone_boxes(zone2.id) == []
