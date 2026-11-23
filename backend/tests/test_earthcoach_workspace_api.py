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


def test_apply_rejects_result_when_guidance_or_photo_requirement_changed(client, seeded):
    # Meme question qu'a la generation, mais consigne et exigence photo
    # differentes: la proposition est tout aussi perimee.
    create = client.post(
        f"/api/geocaches/{seeded['cache_id']}/earthcoach-results",
        json={
            'request_id': 'request-stale-fields',
            'action': 'resolve',
            'context_snapshot': {
                'loggingTasks': [{
                    'id': f"logging-task-{seeded['task_id']}",
                    'question': 'Que voyez-vous ?',
                    'guidance': 'ancienne consigne',
                    'requiresPhoto': True,
                }],
            },
            'proposals': [{
                'task_id': seeded['task_id'],
                'question': 'Que voyez-vous ?',
                'status': 'ready',
                'answer': 'Réponse au contexte ancien.',
            }],
        },
    )
    assert create.status_code == 201
    result = create.get_json()['result']

    applied = client.post(f"/api/earthcoach-results/{result['id']}/apply", json={'proposal_indexes': [0]})
    assert applied.status_code == 400
    assert 'changed since' in applied.get_json()['error']

    # La tache redevient conforme a l'instantane: le report passe.
    update = client.put(
        f'/api/logging-tasks/{seeded["task_id"]}',
        json={'guidance': 'Ancienne consigne', 'requires_photo': True},
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


def test_result_patch_stores_final_answer_control(client, seeded):
    create = client.post(
        f"/api/geocaches/{seeded['cache_id']}/earthcoach-results",
        json={'request_id': 'request-control', 'action': 'resolve', 'context_snapshot': {}, 'proposals': []},
    )
    result = create.get_json()['result']
    assert result['final_answer_control'] is None
    update = client.patch(
        f"/api/earthcoach-results/{result['id']}",
        json={'final_answer': 'Hello owner.', 'final_answer_control': 'Bonjour proprietaire.'},
    )
    body = update.get_json()['result']
    assert body['final_answer'] == 'Hello owner.'
    assert body['final_answer_control'] == 'Bonjour proprietaire.'
    # Un message regenere sans controle efface l'ancien controle, perime.
    update = client.patch(f"/api/earthcoach-results/{result['id']}", json={'final_answer': 'Bonjour.'})
    body = update.get_json()['result']
    assert body['final_answer'] == 'Bonjour.'
    assert body['final_answer_control'] is None


def test_result_patch_keeps_generated_final_answer_on_manual_edit(client, seeded):
    create = client.post(
        f"/api/geocaches/{seeded['cache_id']}/earthcoach-results",
        json={'request_id': 'request-final-edit', 'action': 'resolve', 'context_snapshot': {}, 'proposals': []},
    )
    result_id = create.get_json()['result']['id']
    generated = client.patch(
        f"/api/earthcoach-results/{result_id}",
        json={'final_answer': 'Hello owner', 'final_answer_control': 'Bonjour'},
    ).get_json()['result']
    assert generated['final_answer_generated'] == 'Hello owner'

    # Retouche : le message change, la reference et la version de controle restent.
    edited = client.patch(
        f"/api/earthcoach-results/{result_id}",
        json={'final_answer': 'Hello dear owner', 'final_answer_edited': True},
    ).get_json()['result']
    assert edited['final_answer'] == 'Hello dear owner'
    assert edited['final_answer_generated'] == 'Hello owner'
    assert edited['final_answer_control'] == 'Bonjour'

    # Message vide : la reference survit, on peut y revenir.
    emptied = client.patch(
        f"/api/earthcoach-results/{result_id}",
        json={'final_answer': '', 'final_answer_edited': True},
    ).get_json()['result']
    assert emptied['final_answer'] is None
    assert emptied['final_answer_generated'] == 'Hello owner'

    # Une nouvelle generation remplace la reference.
    regenerated = client.patch(
        f"/api/earthcoach-results/{result_id}",
        json={'final_answer': 'Hi again'},
    ).get_json()['result']
    assert regenerated['final_answer_generated'] == 'Hi again'
    assert regenerated['final_answer_control'] is None


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
    assert update.get_json()['result']['proposals'] == [
        {'question': 'Q', 'status': 'missing', 'confidence': 'low'},
    ]


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


def test_result_capture_normalizes_status_and_confidence(client, seeded):
    # La capture corrige les valeurs hors contrat du modele plutot que de
    # rejeter la reponse: statut inconnu -> 'missing', confiance -> 'low'.
    create = client.post(
        f"/api/geocaches/{seeded['cache_id']}/earthcoach-results",
        json={
            'request_id': 'request-normalized-status',
            'action': 'resolve',
            'proposals': [{
                'task_id': seeded['task_id'],
                'question': 'Q1',
                'status': 'done',
                'confidence': 'certain',
                'answer': 'Réponse',
                'question_translation': 42,
            }],
        },
    )
    assert create.status_code == 201
    proposal = create.get_json()['result']['proposals'][0]
    assert proposal['status'] == 'missing'
    assert proposal['confidence'] == 'low'
    assert proposal['question'] == 'Q1'
    # Un champ texte non chaine retombe a None plutot que d'etre stocke brut.
    assert proposal['question_translation'] is None


def test_result_capture_downgrades_ready_without_answer(client, seeded):
    # Un statut 'ready' sans reponse est incoherent: il devient 'partial' a la
    # capture pour qu'un apply ne puisse pas reporter une reponse vide.
    create = client.post(
        f"/api/geocaches/{seeded['cache_id']}/earthcoach-results",
        json={
            'request_id': 'request-ready-without-answer',
            'action': 'resolve',
            'proposals': [
                {'task_id': seeded['task_id'], 'question': 'Q1', 'status': 'ready'},
                {'task_id': seeded['task_id'], 'question': 'Q2', 'status': 'ready', 'answer': '   '},
                {'task_id': seeded['task_id'], 'question': 'Q3', 'status': 'ready', 'answer': 'Réponse'},
            ],
        },
    )
    assert create.status_code == 201
    proposals = create.get_json()['result']['proposals']
    assert proposals[0]['status'] == 'partial'
    assert proposals[1]['status'] == 'partial'
    assert proposals[2]['status'] == 'ready'


def test_aggregated_context_contains_workspace(client, seeded):
    response = client.get(f"/api/geocaches/{seeded['cache_id']}/earthcoach-context")

    assert response.status_code == 200
    assert response.get_json()['earthcoach_workspace']['geocache_id'] == seeded['cache_id']


def test_result_list_omits_heavy_snapshot_but_keeps_tasks(client, seeded):
    snapshot = {
        'listing': {'html': '<p>' + 'x' * 5000 + '</p>'},
        'loggingTasks': [
            {'id': f"logging-task-{seeded['task_id']}", 'position': 1, 'question': 'Q1'},
            {'id': 'sans-numero', 'position': 2, 'question': 'ignoree'},
        ],
    }
    create = client.post(
        f"/api/geocaches/{seeded['cache_id']}/earthcoach-results",
        json={'request_id': 'request-light', 'action': 'resolve', 'proposals': [], 'context_snapshot': snapshot},
    )
    assert create.status_code == 201
    # La reponse de capture garde l'instantane complet.
    assert create.get_json()['result']['context_snapshot'] == snapshot

    listed = client.get(f"/api/geocaches/{seeded['cache_id']}/earthcoach-results").get_json()['results']
    result = next(item for item in listed if item['request_id'] == 'request-light')
    assert 'context_snapshot' not in result
    assert result['snapshot_tasks'] == [{'id': seeded['task_id'], 'position': 1, 'question': 'Q1', 'kind': 'question'}]


def test_merge_result_proposal_targets_index_for_duplicate_questions(client, seeded):
    # Deux stations posent la meme question mot pour mot, sans task_id : la
    # reprise doit remplacer la proposition visee, pas la premiere du meme texte.
    question = 'Which type of weathering do you see here?'
    create = client.post(
        f"/api/geocaches/{seeded['cache_id']}/earthcoach-results",
        json={
            'request_id': 'request-duplicate',
            'action': 'resolve',
            'context_snapshot': {},
            'proposals': [
                {'question': question, 'status': 'ready', 'answer': 'Station 1'},
                {'question': question, 'status': 'partial', 'answer': 'Station 2 incomplete'},
            ],
        },
    )
    result = create.get_json()['result']
    merged = client.post(
        f"/api/earthcoach-results/{result['id']}/proposals",
        json={'proposal_index': 1, 'proposal': {'question': question, 'status': 'ready', 'answer': 'Station 2 complete'}},
    )
    assert merged.status_code == 200
    proposals = merged.get_json()['result']['proposals']
    assert [item['answer'] for item in proposals] == ['Station 1', 'Station 2 complete']

    # Un task_id contradictoire ecarte l'index : on retombe sur le task_id.
    create = client.post(
        f"/api/geocaches/{seeded['cache_id']}/earthcoach-results",
        json={
            'request_id': 'request-duplicate-ids',
            'action': 'resolve',
            'context_snapshot': {},
            'proposals': [
                {'task_id': seeded['task_id'], 'question': 'Q1', 'status': 'partial', 'answer': 'A'},
                {'task_id': 999, 'question': 'Q2', 'status': 'partial', 'answer': 'B'},
            ],
        },
    )
    result = create.get_json()['result']
    merged = client.post(
        f"/api/earthcoach-results/{result['id']}/proposals",
        json={'proposal_index': 1, 'proposal': {'task_id': seeded['task_id'], 'question': 'Q1', 'status': 'ready', 'answer': 'A2'}},
    )
    proposals = merged.get_json()['result']['proposals']
    assert [item['answer'] for item in proposals] == ['A2', 'B']

    # Sans task_id dans la reprise, celui de la proposition remplacee est garde.
    merged = client.post(
        f"/api/earthcoach-results/{result['id']}/proposals",
        json={'proposal_index': 1, 'proposal': {'question': 'Q2', 'status': 'ready', 'answer': 'B2'}},
    )
    proposals = merged.get_json()['result']['proposals']
    assert proposals[1]['answer'] == 'B2'
    assert str(proposals[1]['task_id']).endswith('999')

    # Numero et lieu de la question remplacee survivent a une reprise qui les omet.
    create = client.post(
        f"/api/geocaches/{seeded['cache_id']}/earthcoach-results",
        json={
            'request_id': 'request-location',
            'action': 'resolve',
            'context_snapshot': {},
            'proposals': [
                {'question_number': 4, 'location': ' Station 1 ', 'question': question, 'status': 'ready', 'answer': 'S1'},
                {'question_number': '7', 'location': 'Station 2', 'question': question, 'status': 'partial', 'answer': 'S2'},
                {'question_number': 'abc', 'location': 12, 'question': 'Q', 'status': 'partial', 'answer': 'X'},
            ],
        },
    )
    captured = create.get_json()['result']['proposals']
    assert captured[0]['location'] == 'Station 1'
    assert captured[1]['question_number'] == 7
    assert captured[2]['question_number'] is None and captured[2]['location'] is None
    merged = client.post(
        f"/api/earthcoach-results/{create.get_json()['result']['id']}/proposals",
        json={'proposal_index': 1, 'proposal': {'question': question, 'status': 'ready', 'answer': 'S2 ok'}},
    )
    replaced = merged.get_json()['result']['proposals'][1]
    assert replaced['answer'] == 'S2 ok'
    assert replaced['question_number'] == 7 and replaced['location'] == 'Station 2'

    # Reprise ciblee qui ne correspond ni a la cible ni a une autre question :
    # refusee plutot qu'ajoutee en doublon, le resultat reste intact.
    stray = client.post(
        f"/api/earthcoach-results/{result['id']}/proposals",
        json={'proposal_index': 1, 'proposal': {'task_id': 4242, 'question': 'Autre', 'status': 'ready', 'answer': 'Z'}},
    )
    assert stray.status_code == 400
    assert 'targeted question' in stray.get_json()['error']
    after = client.get(f"/api/geocaches/{seeded['cache_id']}/earthcoach-results").get_json()['results']
    assert len(next(item for item in after if item['id'] == result['id'])['proposals']) == 2

    # Index invalide : refuse plutot que deviner.
    bad = client.post(
        f"/api/earthcoach-results/{result['id']}/proposals",
        json={'proposal_index': 'deux', 'proposal': {'question': 'Q2', 'status': 'ready', 'answer': 'B3'}},
    )
    assert bad.status_code == 400


def test_merge_result_proposal_replaces_same_question(client, seeded):
    # Reprise ciblee (approfondir / contester): la proposition recapturee
    # remplace celle de la meme question, version IA et version corrigee.
    create = client.post(
        f"/api/geocaches/{seeded['cache_id']}/earthcoach-results",
        json={
            'request_id': 'request-merge',
            'action': 'resolve',
            'context_snapshot': {},
            'proposals': [
                {'task_id': seeded['task_id'], 'question': 'Q1', 'status': 'partial', 'answer': 'Réponse IA'},
                {'task_id': 999, 'question': 'Q2', 'status': 'ready', 'answer': 'Autre'},
            ],
            'markdown': 'Synthèse initiale',
        },
    )
    assert create.status_code == 201
    result = create.get_json()['result']

    client.patch(
        f"/api/earthcoach-results/{result['id']}",
        json={'proposals': [
            {'task_id': seeded['task_id'], 'question': 'Q1', 'status': 'ready', 'answer': 'Corrigée'},
            {'task_id': 999, 'question': 'Q2', 'status': 'ready', 'answer': 'Autre corrigée'},
        ]},
    )

    merged = client.post(
        f"/api/earthcoach-results/{result['id']}/proposals",
        json={'proposal': {'task_id': seeded['task_id'], 'question': 'Q1', 'status': 'ready', 'answer': 'Reprise approfondie'}},
    )
    assert merged.status_code == 200
    body = merged.get_json()['result']
    assert body['id'] == result['id']
    assert len(body['proposals']) == 2
    assert body['proposals'][0]['answer'] == 'Reprise approfondie'
    assert body['proposals'][1]['answer'] == 'Autre corrigée'
    assert body['ai_proposals'][0]['answer'] == 'Reprise approfondie'

    # Le texte visible de la reponse s'ajoute au Markdown, separe par un trait.
    appended = client.post(
        f"/api/earthcoach-results/{result['id']}/proposals",
        json={'markdown_append': 'Texte visible de la reprise'},
    )
    assert appended.status_code == 200
    markdown = appended.get_json()['result']['markdown']
    assert markdown.startswith('Synthèse initiale')
    assert '---' in markdown
    assert markdown.endswith('Texte visible de la reprise')

    # Question inconnue: la proposition s'ajoute au lieu d'ecraser.
    extra = client.post(
        f"/api/earthcoach-results/{result['id']}/proposals",
        json={'proposal': {'question': 'Q inédite', 'status': 'missing', 'answer': None}},
    )
    assert extra.status_code == 200
    assert len(extra.get_json()['result']['proposals']) == 3

    # Sans contenu, la fusion n'a pas de sens.
    empty = client.post(f"/api/earthcoach-results/{result['id']}/proposals", json={})
    assert empty.status_code == 400


def _capture(client, cache_id, request_id):
    response = client.post(
        f"/api/geocaches/{cache_id}/earthcoach-results",
        json={
            'request_id': request_id,
            'action': 'resolve',
            'context_snapshot': {},
            'proposals': [{'question': 'Que voyez-vous ?', 'status': 'ready', 'answer': 'Des strates.'}],
        },
    )
    assert response.status_code == 201
    return response.get_json()['result']


def test_reference_result_is_unique_and_listed_first(client, seeded):
    first = _capture(client, seeded['cache_id'], 'reference-1')
    second = _capture(client, seeded['cache_id'], 'reference-2')
    assert first['is_reference'] is False

    marked = client.patch(f"/api/earthcoach-results/{first['id']}", json={'is_reference': True})
    assert marked.status_code == 200
    assert marked.get_json()['result']['is_reference'] is True
    listed = client.get(f"/api/geocaches/{seeded['cache_id']}/earthcoach-results").get_json()['results']
    assert [item['id'] for item in listed[:2]] == [first['id'], second['id']]

    client.patch(f"/api/earthcoach-results/{second['id']}", json={'is_reference': True})
    listed = client.get(f"/api/geocaches/{seeded['cache_id']}/earthcoach-results").get_json()['results']
    assert [(item['id'], item['is_reference']) for item in listed[:2]] == [(second['id'], True), (first['id'], False)]

    client.patch(f"/api/earthcoach-results/{second['id']}", json={'is_reference': False})
    listed = client.get(f"/api/geocaches/{seeded['cache_id']}/earthcoach-results").get_json()['results']
    assert not any(item['is_reference'] for item in listed)


def test_delete_result(client, seeded):
    result = _capture(client, seeded['cache_id'], 'delete-1')
    deleted = client.delete(f"/api/earthcoach-results/{result['id']}")
    assert deleted.status_code == 200
    assert deleted.get_json() == {'deleted': result['id']}
    listed = client.get(f"/api/geocaches/{seeded['cache_id']}/earthcoach-results").get_json()['results']
    assert all(item['id'] != result['id'] for item in listed)
    assert client.delete(f"/api/earthcoach-results/{result['id']}").status_code == 404


def test_result_patch_stores_log_draft(client, seeded):
    result = _capture(client, seeded['cache_id'], 'log-1')
    assert result['log_draft'] is None
    saved = client.patch(f"/api/earthcoach-results/{result['id']}", json={'log_draft': '  Très beau site.  '})
    assert saved.status_code == 200
    assert saved.get_json()['result']['log_draft'] == 'Très beau site.'
    # Les autres champs ne bougent pas.
    assert saved.get_json()['result']['final_answer'] is None
    cleared = client.patch(f"/api/earthcoach-results/{result['id']}", json={'log_draft': ''})
    assert cleared.get_json()['result']['log_draft'] is None
