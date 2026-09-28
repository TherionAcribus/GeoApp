from __future__ import annotations

import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.geocaches.models import (
    EarthCoachImageContext,
    EarthCoachImageGroupMember,
    Geocache,
    GeocacheImage,
    GeocacheLoggingTask,
    GeocacheWaypoint,
    UserObservation,
)
from gc_backend.models import Zone


@pytest.fixture
def app():
    app = create_app()
    app.config['TESTING'] = True
    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def seeded(app):
    with app.app_context():
        zone = Zone(name='EarthCoach', description='tests')
        db.session.add(zone)
        db.session.flush()
        cache = Geocache(gc_code='GCWORK', name='Workspace', type='EarthCache', zone_id=zone.id)
        other = Geocache(gc_code='GCOTHER', name='Other', type='EarthCache', zone_id=zone.id)
        db.session.add_all([cache, other])
        db.session.flush()
        waypoint = GeocacheWaypoint(geocache_id=cache.id, name='WP1')
        other_waypoint = GeocacheWaypoint(geocache_id=other.id, name='WP2')
        listing = GeocacheImage(geocache_id=cache.id, source_url='https://example.test/listing.jpg')
        personal_linked = GeocacheImage(geocache_id=cache.id, source_url='geoapp-upload://linked.jpg', stored=True)
        personal_free = GeocacheImage(geocache_id=cache.id, source_url='geoapp-upload://free.jpg', stored=True)
        other_image = GeocacheImage(geocache_id=other.id, source_url='geoapp-upload://other.jpg', stored=True)
        db.session.add_all([waypoint, other_waypoint, listing, personal_linked, personal_free, other_image])
        db.session.flush()
        observation = UserObservation(geocache_id=cache.id, content='Strates fines', waypoint_id=waypoint.id)
        db.session.add(observation)
        db.session.flush()
        observation.images = [personal_linked]
        task = GeocacheLoggingTask(geocache_id=cache.id, position=1, question='Que voyez-vous ?')
        db.session.add(task)
        db.session.commit()
        return {
            'cache_id': cache.id,
            'other_id': other.id,
            'waypoint_id': waypoint.id,
            'other_waypoint_id': other_waypoint.id,
            'listing_id': listing.id,
            'linked_id': personal_linked.id,
            'free_id': personal_free.id,
            'other_image_id': other_image.id,
            'observation_id': observation.id,
            'task_id': task.id,
        }


def test_first_open_selects_personal_images_by_default(client, seeded):
    response = client.get(f"/api/geocaches/{seeded['cache_id']}/earthcoach-workspace")

    assert response.status_code == 200
    workspace = response.get_json()['workspace']
    assert workspace['version'] == 0
    selected = {item['image_id'] for item in workspace['image_contexts'] if item['included']}
    assert selected == {seeded['linked_id'], seeded['free_id']}
    by_image = {item['image_id']: item for item in workspace['image_contexts']}
    assert by_image[seeded['linked_id']]['observation_id'] == seeded['observation_id']
    assert by_image[seeded['free_id']]['observation_id'] is None


def test_newly_uploaded_personal_image_is_selected_by_default(client, seeded):
    response = client.put(
        f"/api/geocaches/{seeded['cache_id']}/earthcoach-workspace",
        json={
            'version': 0,
            'image_contexts': [
                {'image_id': seeded['linked_id'], 'included': False},
                {'image_id': seeded['listing_id'], 'included': False},
            ],
            'groups': [],
        },
    )
    assert response.status_code == 200

    refreshed = client.get(f"/api/geocaches/{seeded['cache_id']}/earthcoach-workspace")
    assert refreshed.status_code == 200
    contexts = {item['image_id']: item for item in refreshed.get_json()['workspace']['image_contexts']}
    assert contexts[seeded['free_id']]['included'] is True
    assert contexts[seeded['linked_id']]['included'] is False
    assert contexts[seeded['listing_id']]['included'] is False


def test_workspace_round_trip_multiple_groups_and_optimistic_lock(client, seeded):
    payload = {
        'version': 0,
        'general_comment': 'Comparer les deux cadrages.',
        'selected_language': 'fr',
        'description_fingerprint': 'abc123',
        'image_contexts': [
            {
                'image_id': seeded['linked_id'],
                'included': True,
                'comment': 'Vue masquée',
                'waypoint_id': seeded['waypoint_id'],
                'observation_id': seeded['observation_id'],
                'position': 0,
            },
            {'image_id': seeded['listing_id'], 'included': True, 'position': 1},
        ],
        'groups': [
            {
                'title': 'Avant/après',
                'instruction': 'Traiter ensemble',
                'waypoint_id': seeded['waypoint_id'],
                'position': 0,
                'members': [
                    {'image_id': seeded['linked_id'], 'role': 'masked', 'position': 0},
                    {'image_id': seeded['listing_id'], 'role': 'original', 'position': 1},
                ],
            },
            {
                'title': 'Détail',
                'position': 1,
                'members': [{'image_id': seeded['linked_id'], 'role': 'detail', 'position': 0}],
            },
        ],
    }
    response = client.put(f"/api/geocaches/{seeded['cache_id']}/earthcoach-workspace", json=payload)

    assert response.status_code == 200
    workspace = response.get_json()['workspace']
    assert workspace['version'] == 1
    assert workspace['general_comment'] == 'Comparer les deux cadrages.'
    assert len(workspace['groups']) == 2
    assert workspace['groups'][0]['members'][0]['role'] == 'masked'

    stale = client.put(f"/api/geocaches/{seeded['cache_id']}/earthcoach-workspace", json=payload)
    assert stale.status_code == 409
    assert stale.get_json()['workspace']['version'] == 1


@pytest.mark.parametrize('field,value', [
    ('image_id', 'other_image_id'),
    ('waypoint_id', 'other_waypoint_id'),
])
def test_workspace_rejects_resources_from_another_geocache(client, seeded, field, value):
    context = {'image_id': seeded['linked_id'], 'included': True, 'position': 0}
    context[field] = seeded[value]
    response = client.put(
        f"/api/geocaches/{seeded['cache_id']}/earthcoach-workspace",
        json={'version': 0, 'image_contexts': [context], 'groups': []},
    )

    assert response.status_code == 400
    assert 'belong to this geocache' in response.get_json()['error']


def test_deleting_an_image_removes_context_and_group_membership(app, client, seeded):
    response = client.put(
        f"/api/geocaches/{seeded['cache_id']}/earthcoach-workspace",
        json={
            'version': 0,
            'image_contexts': [{'image_id': seeded['linked_id'], 'included': True}],
            'groups': [{
                'title': 'Groupe',
                'members': [{'image_id': seeded['linked_id'], 'role': 'detail'}],
            }],
        },
    )
    assert response.status_code == 200

    with app.app_context():
        image = GeocacheImage.query.get(seeded['linked_id'])
        db.session.delete(image)
        db.session.commit()
        assert EarthCoachImageContext.query.filter_by(image_id=seeded['linked_id']).count() == 0
        assert EarthCoachImageGroupMember.query.filter_by(image_id=seeded['linked_id']).count() == 0


def test_result_capture_edit_and_explicit_apply(client, seeded):
    create = client.post(
        f"/api/geocaches/{seeded['cache_id']}/earthcoach-results",
        json={
            'request_id': 'request-1',
            'action': 'resolve',
            'context_snapshot': {'language': 'fr', 'images': []},
            'proposals': [{
                'task_id': seeded['task_id'],
                'question': 'Que voyez-vous ?',
                'question_translation': 'Was sehen Sie?',
                'status': 'partial',
                'answer': 'Des strates.',
                'missing': 'Mesure',
            }],
            'markdown': 'Brouillon',
        },
    )
    assert create.status_code == 201
    result = create.get_json()['result']

    observer_capture = client.post(
        f"/api/geocaches/{seeded['cache_id']}/earthcoach-results",
        json={
            'request_id': 'request-1',
            'action': 'resolve',
            'context_snapshot': {'language': 'de', 'images': ['must-not-replace']},
            'proposals': [],
            'markdown': 'Réponse complète',
            'session_id': 'session-1',
        },
    )
    assert observer_capture.status_code == 201
    captured = observer_capture.get_json()['result']
    assert captured['context_snapshot'] == {'language': 'fr', 'images': []}
    assert captured['proposals'][0]['status'] == 'partial'
    assert captured['proposals'][0]['question_translation'] == 'Was sehen Sie?'
    assert captured['markdown'] == 'Réponse complète'
    assert captured['session_id'] == 'session-1'

    blocked = client.post(f"/api/earthcoach-results/{result['id']}/apply", json={'proposal_indexes': [0]})
    assert blocked.status_code == 400

    proposal = result['proposals'][0]
    proposal.update({'status': 'ready', 'answer': 'Des strates fines.', 'missing': None})
    edited = client.patch(f"/api/earthcoach-results/{result['id']}", json={'proposals': [proposal]})
    assert edited.status_code == 200

    applied = client.post(f"/api/earthcoach-results/{result['id']}/apply", json={'proposal_indexes': [0]})
    assert applied.status_code == 200
    assert applied.get_json()['applied'][0]['status'] == 'answered'
    assert applied.get_json()['applied'][0]['answer'] == 'Des strates fines.'


def test_result_recapture_preserves_user_edited_proposals(client, seeded):
    create = client.post(
        f"/api/geocaches/{seeded['cache_id']}/earthcoach-results",
        json={
            'request_id': 'request-edit',
            'action': 'resolve',
            'context_snapshot': {},
            'proposals': [{
                'task_id': seeded['task_id'],
                'question': 'Q1',
                'status': 'ready',
                'answer': 'Réponse IA',
            }],
        },
    )
    assert create.status_code == 201
    result = create.get_json()['result']

    edited = client.patch(
        f"/api/earthcoach-results/{result['id']}",
        json={'proposals': [{
            'task_id': seeded['task_id'],
            'question': 'Q1',
            'status': 'ready',
            'answer': 'Réponse corrigée',
        }]},
    )
    assert edited.status_code == 200
    patched = edited.get_json()['result']
    assert patched['proposals'][0]['answer'] == 'Réponse corrigée'
    assert patched['ai_proposals'][0]['answer'] == 'Réponse IA'
    assert patched['proposals_edited'] is True

    recapture = client.post(
        f"/api/geocaches/{seeded['cache_id']}/earthcoach-results",
        json={
            'request_id': 'request-edit',
            'action': 'resolve',
            'context_snapshot': {},
            'proposals': [{
                'task_id': seeded['task_id'],
                'question': 'Q1',
                'status': 'ready',
                'answer': 'Réponse IA v2',
            }],
            'markdown': 'nouveau',
        },
    )
    assert recapture.status_code == 201
    recaptured = recapture.get_json()['result']
    assert recaptured['id'] == result['id']
    assert recaptured['ai_proposals'][0]['answer'] == 'Réponse IA v2'
    assert recaptured['proposals'][0]['answer'] == 'Réponse corrigée'
    assert recaptured['proposals_edited'] is True


def test_apply_uses_edited_proposals(client, seeded):
    create = client.post(
        f"/api/geocaches/{seeded['cache_id']}/earthcoach-results",
        json={
            'request_id': 'request-apply-edited',
            'action': 'resolve',
            'context_snapshot': {},
            'proposals': [{
                'task_id': seeded['task_id'],
                'question': 'Q1',
                'status': 'missing',
                'answer': '',
                'missing': 'À mesurer',
            }],
        },
    )
    assert create.status_code == 201
    result = create.get_json()['result']

    # La version IA est incomplète : le report doit refuser.
    blocked = client.post(f"/api/earthcoach-results/{result['id']}/apply", json={'proposal_indexes': [0]})
    assert blocked.status_code == 400

    client.patch(
        f"/api/earthcoach-results/{result['id']}",
        json={'proposals': [{
            'task_id': seeded['task_id'],
            'question': 'Q1',
            'status': 'ready',
            'answer': 'Réponse corrigée',
        }]},
    )
    applied = client.post(f"/api/earthcoach-results/{result['id']}/apply", json={'proposal_indexes': [0]})
    assert applied.status_code == 200
    assert applied.get_json()['applied'][0]['answer'] == 'Réponse corrigée'


def test_result_rejects_non_object_proposals(client, seeded):
    create = client.post(
        f"/api/geocaches/{seeded['cache_id']}/earthcoach-results",
        json={'request_id': 'request-null', 'action': 'resolve', 'proposals': [None, 'texte']},
    )
    assert create.status_code == 400

    create = client.post(
        f"/api/geocaches/{seeded['cache_id']}/earthcoach-results",
        json={'request_id': 'request-null-2', 'action': 'resolve', 'proposals': [{'question': 'Q1'}]},
    )
    assert create.status_code == 201
    result = create.get_json()['result']
    update = client.patch(f"/api/earthcoach-results/{result['id']}", json={'proposals': [None]})
    assert update.status_code == 400


def test_apply_rejects_non_empty_non_string_missing(client, seeded):
    create = client.post(
        f"/api/geocaches/{seeded['cache_id']}/earthcoach-results",
        json={
            'request_id': 'request-missing-list',
            'action': 'resolve',
            'proposals': [{
                'task_id': seeded['task_id'],
                'question': 'Q1',
                'status': 'ready',
                'answer': 'Réponse',
                'missing': ['à faire'],
            }],
        },
    )
    assert create.status_code == 201
    result = create.get_json()['result']
    applied = client.post(f"/api/earthcoach-results/{result['id']}/apply", json={'proposal_indexes': [0]})
    assert applied.status_code == 400


def test_apply_rejects_result_when_question_changed_since_capture(client, seeded):
    create = client.post(
        f"/api/geocaches/{seeded['cache_id']}/earthcoach-results",
        json={
            'request_id': 'request-stale',
            'action': 'resolve',
            'context_snapshot': {
                'loggingTasks': [{
                    'id': f"logging-task-{seeded['task_id']}",
                    'question': 'Ancienne formulation de la question ?',
                }],
            },
            'proposals': [{
                'task_id': seeded['task_id'],
                'question': 'Ancienne formulation de la question ?',
                'status': 'ready',
                'answer': 'Réponse au texte ancien.',
            }],
        },
    )
    assert create.status_code == 201
    result = create.get_json()['result']

    # Le texte actuel de la question ("Que voyez-vous ?") differe de celui vu
    # par le modele: la proposition est perimee, le report doit etre refuse.
    applied = client.post(f"/api/earthcoach-results/{result['id']}/apply", json={'proposal_indexes': [0]})
    assert applied.status_code == 400
    assert 'changed since' in applied.get_json()['error']

    # Meme question qu'a la generation (aux espaces/casse pres): report ok.
    update = client.put(
        f'/api/logging-tasks/{seeded["task_id"]}',
        json={'question': '  ancienne FORMULATION   de la question ? '},
    )
    assert update.status_code == 200
    applied = client.post(f"/api/earthcoach-results/{result['id']}/apply", json={'proposal_indexes': [0]})
    assert applied.status_code == 200


def test_result_patch_rejects_invalid_status(client, seeded):
    create = client.post(
        f"/api/geocaches/{seeded['cache_id']}/earthcoach-results",
        json={'request_id': 'request-bad-status', 'action': 'resolve', 'proposals': [{'question': 'Q'}]},
    )
    assert create.status_code == 201
    result = create.get_json()['result']
    update = client.patch(
        f"/api/earthcoach-results/{result['id']}",
        json={'proposals': [{'question': 'Q', 'status': 'done'}]},
    )
    assert update.status_code == 400


def test_result_patch_stores_final_answer(client, seeded):
    # La reponse finale generee revient dans le dossier : elle est stockee sur
    # le resultat source et survit a une recapture ulterieure.
    create = client.post(
        f"/api/geocaches/{seeded['cache_id']}/earthcoach-results",
        json={'request_id': 'request-final', 'action': 'resolve', 'proposals': [{'question': 'Q'}]},
    )
    assert create.status_code == 201
    result = create.get_json()['result']
    assert result['final_answer'] is None

    update = client.patch(
        f"/api/earthcoach-results/{result['id']}",
        json={'final_answer': 'Réponse finale relue.'},
    )
    assert update.status_code == 200
    assert update.get_json()['result']['final_answer'] == 'Réponse finale relue.'
    # Le PATCH final_answer ne touche ni les propositions ni le markdown.
    assert update.get_json()['result']['proposals'] == [{'question': 'Q'}]


def test_result_capture_normalizes_missing_list(client, seeded):
    create = client.post(
        f"/api/geocaches/{seeded['cache_id']}/earthcoach-results",
        json={
            'request_id': 'request-missing-normalized',
            'action': 'resolve',
            'proposals': [{
                'task_id': seeded['task_id'],
                'question': 'Q1',
                'status': 'partial',
                'missing': ['mesurer la hauteur', 'prendre une photo'],
            }],
        },
    )
    assert create.status_code == 201
    proposal = create.get_json()['result']['proposals'][0]
    assert proposal['missing'] == 'mesurer la hauteur\nprendre une photo'


def test_aggregated_context_contains_workspace(client, seeded):
    response = client.get(f"/api/geocaches/{seeded['cache_id']}/earthcoach-context")

    assert response.status_code == 200
    assert response.get_json()['earthcoach_workspace']['geocache_id'] == seeded['cache_id']
