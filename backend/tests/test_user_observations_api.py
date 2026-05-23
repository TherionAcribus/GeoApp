from __future__ import annotations

import json

import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache, GeocacheImage, GeocacheWaypoint, UserObservation
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
def seed_data(app):
    with app.app_context():
        zone = Zone(name='Z1', description='test')
        db.session.add(zone)
        db.session.flush()

        geocache = Geocache(gc_code='GC_EARTH', name='Earth', type='EarthCache', zone_id=zone.id)
        other = Geocache(gc_code='GC_OTHER', name='Other', type='EarthCache', zone_id=zone.id)
        db.session.add_all([geocache, other])
        db.session.flush()

        waypoint = GeocacheWaypoint(
            geocache_id=geocache.id,
            name='Point observation',
            type='Reference Point',
            gc_coords='N 48 00.100 E 002 00.100',
        )
        image = GeocacheImage(
            geocache_id=geocache.id,
            source_url='geoapp-upload://earth/photo.jpg',
            derivation_type='original',
            stored=False,
            title='Photo terrain',
        )
        other_image = GeocacheImage(
            geocache_id=other.id,
            source_url='geoapp-upload://other/photo.jpg',
            derivation_type='original',
            stored=False,
        )
        db.session.add_all([waypoint, image, other_image])
        db.session.commit()

        return {
            'geocache_id': geocache.id,
            'other_geocache_id': other.id,
            'waypoint_id': waypoint.id,
            'image_id': image.id,
            'other_image_id': other_image.id,
        }


def test_create_and_list_structured_observation(client, seed_data):
    response = client.post(
        f"/api/geocaches/{seed_data['geocache_id']}/observations",
        json={
            'content': 'Roche sombre avec cristaux visibles.',
            'observation_type': 'hypothese',
            'observed_at': '2026-05-22T10:15:00Z',
            'waypoint_id': seed_data['waypoint_id'],
            'latitude': 48.001,
            'longitude': 2.001,
            'coordinates_raw': 'N 48 00.060 E 002 00.060',
            'image_ids': [seed_data['image_id']],
        },
    )

    assert response.status_code == 201
    payload = json.loads(response.data)
    observation = payload['observation']
    assert observation['observation_type'] == 'hypothesis'
    assert observation['note'] == 'Roche sombre avec cristaux visibles.'
    assert observation['waypoint_id'] == seed_data['waypoint_id']
    assert observation['latitude'] == 48.001
    assert observation['longitude'] == 2.001
    assert len(observation['images']) == 1

    response = client.get(f"/api/geocaches/{seed_data['geocache_id']}/observations")
    assert response.status_code == 200
    payload = json.loads(response.data)
    assert payload['geocache_id'] == seed_data['geocache_id']
    assert len(payload['observations']) == 1
    assert payload['observations'][0]['observation_type'] == 'hypothesis'


def test_update_and_delete_structured_observation(client, app, seed_data):
    create_response = client.post(
        f"/api/geocaches/{seed_data['geocache_id']}/observations",
        json={
            'content': 'Couche claire au-dessus.',
            'observation_type': 'observation',
            'image_ids': [seed_data['image_id']],
        },
    )
    assert create_response.status_code == 201
    observation_id = json.loads(create_response.data)['observation']['id']

    update_response = client.put(
        f'/api/observations/{observation_id}',
        json={
            'content': 'Cela pourrait etre une strate sedimentaire.',
            'observation_type': 'interpretation',
            'image_ids': [],
        },
    )
    assert update_response.status_code == 200
    updated = json.loads(update_response.data)['observation']
    assert updated['observation_type'] == 'interpretation'
    assert updated['images'] == []

    delete_response = client.delete(f'/api/observations/{observation_id}')
    assert delete_response.status_code == 200

    with app.app_context():
        assert UserObservation.query.get(observation_id) is None


def test_rejects_image_from_another_geocache(client, seed_data):
    response = client.post(
        f"/api/geocaches/{seed_data['geocache_id']}/observations",
        json={
            'content': 'Photo mal associee.',
            'image_ids': [seed_data['other_image_id']],
        },
    )

    assert response.status_code == 400
    assert json.loads(response.data)['error'] == 'image_ids must belong to this geocache'
