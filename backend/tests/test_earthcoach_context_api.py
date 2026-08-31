"""Tests de l'endpoint agrege GET /api/geocaches/<id>/earthcoach-context.

L'endpoint remplace quatre appels unitaires: on verifie qu'il renvoie les
memes donnees que ceux-ci (memes serialisations, meme tri, meme isolation par
geocache), sans quoi le frontend afficherait autre chose selon qu'il utilise la
route agregee ou son repli.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.geocaches.models import (
    Geocache,
    GeocacheImage,
    GeocacheLoggingTask,
    GeocacheNote,
    Note,
    UserObservation,
)
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
        geocache.gc_personal_note = 'Prevoir un marteau.'
        other = Geocache(gc_code='GC_OTHER', name='Other', type='EarthCache', zone_id=zone.id)
        empty = Geocache(gc_code='GC_EMPTY', name='Empty', type='EarthCache', zone_id=zone.id)
        db.session.add_all([geocache, other, empty])
        db.session.flush()

        db.session.add_all([
            GeocacheImage(geocache_id=geocache.id, source_url='https://img.example/1.jpg', title='Affleurement'),
            GeocacheImage(geocache_id=other.id, source_url='https://img.example/other.jpg'),
        ])

        db.session.add_all([
            UserObservation(
                geocache_id=geocache.id,
                observation_type='observation',
                content='Roche claire, grain fin.',
                observed_at=datetime(2026, 5, 1, tzinfo=timezone.utc),
            ),
            UserObservation(
                geocache_id=geocache.id,
                observation_type='hypothesis',
                content='Calcaire recifal.',
                observed_at=datetime(2026, 5, 3, tzinfo=timezone.utc),
            ),
            UserObservation(geocache_id=other.id, observation_type='observation', content='Autre cache.'),
        ])

        db.session.add_all([
            GeocacheLoggingTask(geocache_id=geocache.id, position=2, question='Quelle est la taille des grains ?'),
            GeocacheLoggingTask(geocache_id=geocache.id, position=1, question='Quelle est la couleur ?'),
            GeocacheLoggingTask(geocache_id=other.id, position=1, question='Question voisine.'),
        ])

        note = Note(content='Note de terrain.', note_type='user', source='user')
        other_note = Note(content='Note voisine.', note_type='user', source='user')
        db.session.add_all([note, other_note])
        db.session.flush()
        db.session.add_all([
            GeocacheNote(geocache_id=geocache.id, note_id=note.id),
            GeocacheNote(geocache_id=other.id, note_id=other_note.id),
        ])
        db.session.commit()

        return {
            'geocache_id': geocache.id,
            'other_geocache_id': other.id,
            'empty_geocache_id': empty.id,
        }


def _get_context(client, geocache_id: int) -> dict:
    response = client.get(f'/api/geocaches/{geocache_id}/earthcoach-context')
    assert response.status_code == 200
    return json.loads(response.data)


def test_context_returns_the_four_sections_for_the_right_geocache(client, seed_data):
    payload = _get_context(client, seed_data['geocache_id'])

    assert payload['geocache_id'] == seed_data['geocache_id']
    assert payload['gc_code'] == 'GC_EARTH'
    assert payload['gc_personal_note'] == 'Prevoir un marteau.'
    assert [image['title'] for image in payload['images']] == ['Affleurement']
    assert {observation['content'] for observation in payload['observations']} == {
        'Roche claire, grain fin.',
        'Calcaire recifal.',
    }
    assert [task['question'] for task in payload['logging_tasks']] == [
        'Quelle est la couleur ?',
        'Quelle est la taille des grains ?',
    ]
    assert [note['content'] for note in payload['notes']] == ['Note de terrain.']


def test_context_orders_observations_from_the_most_recent(client, seed_data):
    payload = _get_context(client, seed_data['geocache_id'])

    assert [observation['content'] for observation in payload['observations']] == [
        'Calcaire recifal.',
        'Roche claire, grain fin.',
    ]


def test_context_matches_the_unitary_endpoints(client, seed_data):
    geocache_id = seed_data['geocache_id']
    payload = _get_context(client, geocache_id)

    images = json.loads(client.get(f'/api/geocaches/{geocache_id}/images').data)
    observations = json.loads(client.get(f'/api/geocaches/{geocache_id}/observations').data)
    tasks = json.loads(client.get(f'/api/geocaches/{geocache_id}/logging-tasks').data)
    notes = json.loads(client.get(f'/api/geocaches/{geocache_id}/notes').data)

    assert payload['images'] == images
    assert payload['observations'] == observations['observations']
    assert payload['logging_tasks'] == tasks['logging_tasks']
    assert payload['notes'] == notes['notes']
    assert payload['gc_personal_note'] == notes['gc_personal_note']


def test_context_is_empty_but_successful_without_data(client, seed_data):
    payload = _get_context(client, seed_data['empty_geocache_id'])

    assert payload['gc_personal_note'] is None
    assert payload['images'] == []
    assert payload['observations'] == []
    assert payload['logging_tasks'] == []
    assert payload['notes'] == []


def test_context_returns_404_for_unknown_geocache(client, seed_data):
    response = client.get('/api/geocaches/999999/earthcoach-context')

    assert response.status_code == 404
    assert json.loads(response.data)['error'] == 'Geocache not found'
