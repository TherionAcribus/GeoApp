from __future__ import annotations

import json

import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache, GeocachePuzzleState
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

        geocache = Geocache(gc_code='GCGRID', name='Grid cache', zone_id=zone.id)
        db.session.add(geocache)
        db.session.commit()

        return {'geocache_id': geocache.id}


def test_get_missing_puzzle_state_returns_null(client, seed_data):
    response = client.get(f"/api/geocaches/{seed_data['geocache_id']}/puzzle-states/current")

    assert response.status_code == 200
    payload = json.loads(response.data)
    assert payload['puzzle_type'] == 'sudoku_classic'
    assert payload['state_key'] == 'default'
    assert payload['state'] is None


def test_upsert_get_and_list_puzzle_state(client, app, seed_data):
    geocache_id = seed_data['geocache_id']
    state_payload = {
        'grid': [['5', '3', ''], ['', '', '']],
        'watchCells': ['r1c1', 'r1c2'],
        'maxSolutions': 2,
    }

    create_response = client.put(
        f'/api/geocaches/{geocache_id}/puzzle-states/current',
        json={
            'puzzle_type': 'sudoku_classic',
            'state_key': 'default',
            'title': 'Sudoku principal',
            'state': state_payload,
        },
    )
    assert create_response.status_code == 201
    created = json.loads(create_response.data)['state']
    assert created['title'] == 'Sudoku principal'
    assert created['state']['watchCells'] == ['r1c1', 'r1c2']

    update_response = client.put(
        f'/api/geocaches/{geocache_id}/puzzle-states/current',
        json={
            'puzzle_type': 'sudoku_classic',
            'state_key': 'default',
            'state': {**state_payload, 'watchCells': ['r9c9']},
        },
    )
    assert update_response.status_code == 200
    assert json.loads(update_response.data)['created'] is False

    get_response = client.get(
        f'/api/geocaches/{geocache_id}/puzzle-states/current?puzzle_type=sudoku_classic&state_key=default'
    )
    assert get_response.status_code == 200
    payload = json.loads(get_response.data)
    assert payload['state']['state']['watchCells'] == ['r9c9']

    list_response = client.get(f'/api/geocaches/{geocache_id}/puzzle-states')
    assert list_response.status_code == 200
    list_payload = json.loads(list_response.data)
    assert len(list_payload['states']) == 1
    assert list_payload['states'][0]['puzzle_type'] == 'sudoku_classic'

    with app.app_context():
        assert GeocachePuzzleState.query.count() == 1


def test_delete_puzzle_state(client, app, seed_data):
    geocache_id = seed_data['geocache_id']
    response = client.put(
        f'/api/geocaches/{geocache_id}/puzzle-states/current',
        json={'state': {'grid': []}},
    )
    assert response.status_code == 201

    delete_response = client.delete(f'/api/geocaches/{geocache_id}/puzzle-states/current')
    assert delete_response.status_code == 200
    assert json.loads(delete_response.data)['deleted'] is True

    with app.app_context():
        assert GeocachePuzzleState.query.count() == 0


def test_rejects_invalid_puzzle_state(client, seed_data):
    response = client.put(
        f"/api/geocaches/{seed_data['geocache_id']}/puzzle-states/current",
        json={'state': ['not', 'an', 'object']},
    )

    assert response.status_code == 400
    assert json.loads(response.data)['error'] == 'state must be an object'


def test_puzzle_state_requires_existing_geocache(client):
    response = client.get('/api/geocaches/9999/puzzle-states/current')

    assert response.status_code == 404
    assert json.loads(response.data)['error'] == 'Geocache not found'
