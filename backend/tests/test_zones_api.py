import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache, GeocacheChecker, GeocacheWaypoint
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
