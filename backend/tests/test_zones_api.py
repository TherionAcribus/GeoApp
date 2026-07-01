import pytest
from datetime import datetime, timedelta

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache, GeocacheChecker, GeocacheWaypoint, SolvedGeocacheArchive
from gc_backend.models import Zone


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
def seeded_zone(app):
    with app.app_context():
        zone = Zone(name='Originale', description='Description source')
        db.session.add(zone)
        db.session.flush()

        geocache = Geocache(
            gc_code='GCZONE1',
            name='Cache source',
            type='Traditional Cache',
            difficulty=2.5,
            terrain=3.0,
            description_raw='Texte',
            hints_decoded='Indice',
            solved='in_progress',
            zone_id=zone.id,
        )
        db.session.add(geocache)
        db.session.flush()

        db.session.add(GeocacheWaypoint(
            geocache_id=geocache.id,
            prefix='PK',
            name='Parking',
            type='Parking Area',
            gc_coords='N 48 00.000 E 002 00.000',
            note_override='Note locale',
        ))
        db.session.add(GeocacheChecker(
            geocache_id=geocache.id,
            name='Checker',
            url='https://example.test/checker',
        ))
        db.session.commit()

        return zone.id


def test_update_zone_renames_zone(client, app, seeded_zone):
    response = client.post(f'/api/zones/{seeded_zone}/rename', json={'name': 'Renommee'})

    assert response.status_code == 200
    assert response.get_json()['name'] == 'Renommee'

    with app.app_context():
        assert Zone.query.get(seeded_zone).name == 'Renommee'


def test_list_zones_is_alphabetical_and_includes_sort_metadata(client, app):
    base_time = datetime(2026, 5, 24, 10, 0)

    with app.app_context():
        bravo = Zone(name='Bravo', created_at=base_time)
        alpha = Zone(name='Alpha', created_at=base_time + timedelta(minutes=1))
        db.session.add_all([bravo, alpha])
        db.session.flush()

        db.session.add(Geocache(
            gc_code='GCBRAVO',
            name='Cache Bravo',
            type='Traditional Cache',
            zone_id=bravo.id,
            created_at=base_time + timedelta(minutes=2),
        ))
        db.session.add(Geocache(
            gc_code='GCALPHA',
            name='Cache Alpha',
            type='Unknown Cache',
            zone_id=alpha.id,
            created_at=base_time + timedelta(minutes=3),
        ))
        db.session.add(SolvedGeocacheArchive(
            gc_code='GCALPHA',
            name='Cache Alpha',
            solved_status='solved',
            created_at=base_time + timedelta(minutes=4),
            updated_at=base_time + timedelta(minutes=5),
        ))
        db.session.commit()

    response = client.get('/api/zones')

    assert response.status_code == 200
    payload = response.get_json()
    assert [zone['name'] for zone in payload] == ['Alpha', 'Bravo', 'default']

    alpha_payload = next(zone for zone in payload if zone['name'] == 'Alpha')
    assert alpha_payload['geocaches_count'] == 1
    assert alpha_payload['latest_geocache_created_at'] == (base_time + timedelta(minutes=3)).isoformat()
    assert alpha_payload['latest_resolution_updated_at'] == (base_time + timedelta(minutes=5)).isoformat()

    bravo_payload = next(zone for zone in payload if zone['name'] == 'Bravo')
    assert bravo_payload['latest_resolution_updated_at'] is None


def test_zone_geocaches_tree_returns_lightweight_payload(client, seeded_zone):
    response = client.get(f'/api/zones/{seeded_zone}/geocaches/tree')

    assert response.status_code == 200
    payload = response.get_json()
    assert len(payload) == 1

    item = payload[0]
    assert item['gc_code'] == 'GCZONE1'
    assert item['name'] == 'Cache source'
    assert item['cache_type'] == 'Traditional Cache'
    assert item['difficulty'] == 2.5
    assert item['terrain'] == 3.0
    assert item['found'] is False

    # Aucun champ lourd ne doit être sérialisé par l'endpoint de l'arbre.
    assert set(item.keys()) == {
        'id', 'gc_code', 'name', 'cache_type', 'difficulty', 'terrain', 'found', 'created_at',
    }


def test_duplicate_zone_copies_geocaches_waypoints_and_checkers(client, app, seeded_zone):
    response = client.post(
        f'/api/zones/{seeded_zone}/duplicate',
        json={'name': 'Copie'},
    )

    assert response.status_code == 201
    payload = response.get_json()
    assert payload['name'] == 'Copie'
    assert payload['geocaches_count'] == 1

    with app.app_context():
        copied_zone = Zone.query.filter_by(name='Copie').one()
        copied_cache = Geocache.query.filter_by(zone_id=copied_zone.id, gc_code='GCZONE1').one()
        assert copied_cache.name == 'Cache source'
        assert copied_cache.solved == 'in_progress'
        assert copied_cache.waypoints[0].name == 'Parking'
        assert copied_cache.waypoints[0].note_override == 'Note locale'
        assert copied_cache.checkers[0].url == 'https://example.test/checker'


def test_duplicate_zone_rejects_existing_name(client, seeded_zone):
    response = client.post(
        f'/api/zones/{seeded_zone}/duplicate',
        json={'name': 'Originale'},
    )

    assert response.status_code == 409


def test_merge_zone_moves_unique_geocaches_and_removes_duplicate_source(client, app, seeded_zone):
    with app.app_context():
        source_zone = Zone.query.get(seeded_zone)
        target_zone = Zone(name='Cible', description='Zone cible')
        db.session.add(target_zone)
        db.session.flush()

        db.session.add(Geocache(
            gc_code='GCZONE1',
            name='Cache deja cible',
            type='Traditional Cache',
            zone_id=target_zone.id,
        ))
        db.session.add(Geocache(
            gc_code='GCZONE2',
            name='Cache unique source',
            type='Mystery Cache',
            zone_id=source_zone.id,
        ))
        db.session.commit()
        target_zone_id = target_zone.id

    response = client.post(
        f'/api/zones/{seeded_zone}/merge',
        json={'target_zone_id': target_zone_id},
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['moved_count'] == 1
    assert payload['duplicate_count'] == 1

    with app.app_context():
        assert Zone.query.get(seeded_zone) is None
        target_codes = {
            geocache.gc_code
            for geocache in Geocache.query.filter_by(zone_id=target_zone_id).all()
        }
        assert target_codes == {'GCZONE1', 'GCZONE2'}
        assert Geocache.query.filter_by(zone_id=target_zone_id, gc_code='GCZONE1').one().name == 'Cache deja cible'


def test_delete_empty_zone(client, app):
    with app.app_context():
        zone = Zone(name='Vide')
        db.session.add(zone)
        db.session.commit()
        zone_id = zone.id

    response = client.delete(f'/api/zones/{zone_id}')

    assert response.status_code == 200
    assert response.get_json()['deleted_geocaches_count'] == 0
    with app.app_context():
        assert Zone.query.get(zone_id) is None


def test_delete_zone_cascades_geocaches_and_children(client, app, seeded_zone):
    with app.app_context():
        # La zone seed contient 1 géocache avec 1 waypoint et 1 checker.
        assert Geocache.query.filter_by(zone_id=seeded_zone).count() == 1

    response = client.delete(f'/api/zones/{seeded_zone}')

    assert response.status_code == 200
    assert response.get_json()['deleted_geocaches_count'] == 1

    with app.app_context():
        assert Zone.query.get(seeded_zone) is None
        assert Geocache.query.filter_by(zone_id=seeded_zone).count() == 0
        # Les données liées sont supprimées en cascade.
        assert GeocacheWaypoint.query.count() == 0
        assert GeocacheChecker.query.count() == 0


def test_delete_active_zone_resets_active_zone(client, app, seeded_zone):
    client.post('/api/active-zone', json={'zone_id': seeded_zone})

    response = client.delete(f'/api/zones/{seeded_zone}')
    assert response.status_code == 200

    active = client.get('/api/active-zone')
    assert active.get_json() is None


def test_merge_zone_rejects_same_source_and_target(client, seeded_zone):
    response = client.post(
        f'/api/zones/{seeded_zone}/merge',
        json={'target_zone_id': seeded_zone},
    )

    assert response.status_code == 400
