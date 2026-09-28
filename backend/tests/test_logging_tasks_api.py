from __future__ import annotations

import json

import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache, GeocacheLoggingTask, UserObservation
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

        observation = UserObservation(
            geocache_id=geocache.id,
            observation_type='observation',
            content='Roche claire, grain fin.',
        )
        other_observation = UserObservation(
            geocache_id=other.id,
            observation_type='observation',
            content='Autre cache.',
        )
        db.session.add_all([observation, other_observation])
        db.session.commit()

        return {
            'geocache_id': geocache.id,
            'other_geocache_id': other.id,
            'observation_id': observation.id,
            'other_observation_id': other_observation.id,
        }


def test_create_and_list_logging_task(client, seed_data):
    response = client.post(
        f"/api/geocaches/{seed_data['geocache_id']}/logging-tasks",
        json={
            'question': 'Quelle est la couleur dominante de la roche ?',
            'guidance': 'Observer la roche en place, hors zones alterees.',
            'status': 'a faire',
            'requires_photo': 'oui',
            'source': 'extracted',
        },
    )

    assert response.status_code == 201
    task = json.loads(response.data)['logging_task']
    assert task['question'] == 'Quelle est la couleur dominante de la roche ?'
    assert task['status'] == 'todo'
    assert task['requires_photo'] is True
    assert task['source'] == 'extracted'
    assert task['position'] == 1

    second = client.post(
        f"/api/geocaches/{seed_data['geocache_id']}/logging-tasks",
        json={'question': 'Estimer la hauteur de l affleurement.'},
    )
    assert second.status_code == 201
    assert json.loads(second.data)['logging_task']['position'] == 2

    listing = client.get(f"/api/geocaches/{seed_data['geocache_id']}/logging-tasks")
    assert listing.status_code == 200
    payload = json.loads(listing.data)
    assert payload['geocache_id'] == seed_data['geocache_id']
    assert [t['position'] for t in payload['logging_tasks']] == [1, 2]


def test_create_requires_question(client, seed_data):
    response = client.post(
        f"/api/geocaches/{seed_data['geocache_id']}/logging-tasks",
        json={'question': '   '},
    )
    assert response.status_code == 400
    assert json.loads(response.data)['error'] == 'question is required'


def test_update_links_observation_and_answer(client, seed_data):
    create_response = client.post(
        f"/api/geocaches/{seed_data['geocache_id']}/logging-tasks",
        json={'question': 'Nature de la roche ?'},
    )
    task_id = json.loads(create_response.data)['logging_task']['id']

    update_response = client.put(
        f'/api/logging-tasks/{task_id}',
        json={
            'answer': 'Calcaire clair a grain fin.',
            'status': 'answered',
            'observation_id': seed_data['observation_id'],
        },
    )
    assert update_response.status_code == 200
    updated = json.loads(update_response.data)['logging_task']
    assert updated['answer'] == 'Calcaire clair a grain fin.'
    assert updated['status'] == 'answered'
    assert updated['observation_id'] == seed_data['observation_id']


def test_update_rejects_observation_from_another_geocache(client, seed_data):
    create_response = client.post(
        f"/api/geocaches/{seed_data['geocache_id']}/logging-tasks",
        json={'question': 'Nature de la roche ?'},
    )
    task_id = json.loads(create_response.data)['logging_task']['id']

    response = client.put(
        f'/api/logging-tasks/{task_id}',
        json={'observation_id': seed_data['other_observation_id']},
    )
    assert response.status_code == 400
    assert json.loads(response.data)['error'] == 'observation_id does not belong to this geocache'


def test_replace_logging_tasks_overwrites_set(client, seed_data):
    client.post(
        f"/api/geocaches/{seed_data['geocache_id']}/logging-tasks",
        json={'question': 'Ancienne question.'},
    )

    response = client.put(
        f"/api/geocaches/{seed_data['geocache_id']}/logging-tasks",
        json={
            'tasks': [
                {'question': 'Couleur de la roche ?', 'requires_photo': True},
                {'question': '   '},
                {'question': 'Hauteur de l affleurement ?', 'guidance': 'Mesurer a la base.'},
            ],
        },
    )

    assert response.status_code == 200
    payload = json.loads(response.data)
    tasks = payload['logging_tasks']
    assert [t['question'] for t in tasks] == ['Couleur de la roche ?', 'Hauteur de l affleurement ?']
    assert [t['position'] for t in tasks] == [1, 3]
    assert tasks[0]['requires_photo'] is True
    assert all(t['source'] == 'extracted' for t in tasks)


def test_replace_logging_tasks_preserves_work_on_unchanged_questions(client, seed_data):
    create_response = client.post(
        f"/api/geocaches/{seed_data['geocache_id']}/logging-tasks",
        json={
            'question': 'Couleur de la roche ?',
            'answer': 'Gris clair.',
            'status': 'answered',
            'observation_id': seed_data['observation_id'],
        },
    )
    assert create_response.status_code == 201

    # Re-extraction: la meme question revient sans reponse. Le travail saisi
    # doit survivre au remplacement en masse.
    response = client.put(
        f"/api/geocaches/{seed_data['geocache_id']}/logging-tasks",
        json={'tasks': [
            {'question': '  couleur   de la Roche ? '},
            {'question': 'Nouvelle question ?'},
        ]},
    )
    assert response.status_code == 200
    tasks = json.loads(response.data)['logging_tasks']
    assert len(tasks) == 2
    kept, new = tasks
    assert kept['answer'] == 'Gris clair.'
    assert kept['status'] == 'answered'
    assert kept['observation_id'] == seed_data['observation_id']
    assert new['answer'] is None
    assert new['status'] == 'todo'

    # Mais un remplacement explicite par des valeurs fournies reste honore.
    response = client.put(
        f"/api/geocaches/{seed_data['geocache_id']}/logging-tasks",
        json={'tasks': [{'question': 'Couleur de la roche ?', 'status': 'todo', 'answer': ''}]},
    )
    assert response.status_code == 200
    task = json.loads(response.data)['logging_tasks'][0]
    assert task['status'] == 'todo'
    # '' est normalise en None -> reprise de la valeur precedente conservee;
    # le status explicite, lui, prime.


def test_replace_logging_tasks_returns_previous_set_for_undo(client, seed_data):
    # Le remplacement renvoie la liste precedente complete (reponses,
    # observations liees, statuts): le client peut restaurer a l'identique.
    client.post(
        f"/api/geocaches/{seed_data['geocache_id']}/logging-tasks",
        json={
            'question': 'Couleur de la roche ?',
            'answer': 'Gris clair.',
            'status': 'answered',
            'observation_id': seed_data['observation_id'],
        },
    )

    response = client.put(
        f"/api/geocaches/{seed_data['geocache_id']}/logging-tasks",
        json={'tasks': [{'question': 'Question reformulee par le modele ?'}]},
    )
    assert response.status_code == 200
    payload = json.loads(response.data)
    replaced = payload['replaced_tasks']
    assert len(replaced) == 1
    assert replaced[0]['question'] == 'Couleur de la roche ?'
    assert replaced[0]['answer'] == 'Gris clair.'
    assert replaced[0]['observation_id'] == seed_data['observation_id']

    # Annulation: rejouer la sauvegarde recree les questions avec leur
    # travail (les ids sont recrees, le contenu est restaure).
    restore = client.put(
        f"/api/geocaches/{seed_data['geocache_id']}/logging-tasks",
        json={'tasks': [
            {
                'question': replaced[0]['question'],
                'answer': replaced[0]['answer'],
                'status': replaced[0]['status'],
                'observation_id': replaced[0]['observation_id'],
                'requires_photo': replaced[0]['requires_photo'],
                'position': replaced[0]['position'],
                'source': replaced[0]['source'],
            },
        ], 'source': 'restored'},
    )
    assert restore.status_code == 200
    restored = json.loads(restore.data)['logging_tasks'][0]
    assert restored['question'] == 'Couleur de la roche ?'
    assert restored['answer'] == 'Gris clair.'
    assert restored['status'] == 'answered'
    assert restored['observation_id'] == seed_data['observation_id']
    assert restored['source'] == 'manual'


def test_replace_logging_tasks_requires_list(client, seed_data):
    response = client.put(
        f"/api/geocaches/{seed_data['geocache_id']}/logging-tasks",
        json={'tasks': 'nope'},
    )
    assert response.status_code == 400
    assert json.loads(response.data)['error'] == 'tasks must be a list'


def test_delete_logging_task(client, app, seed_data):
    create_response = client.post(
        f"/api/geocaches/{seed_data['geocache_id']}/logging-tasks",
        json={'question': 'A supprimer ?'},
    )
    task_id = json.loads(create_response.data)['logging_task']['id']

    delete_response = client.delete(f'/api/logging-tasks/{task_id}')
    assert delete_response.status_code == 200
    assert json.loads(delete_response.data)['deleted'] is True

    with app.app_context():
        assert GeocacheLoggingTask.query.get(task_id) is None
