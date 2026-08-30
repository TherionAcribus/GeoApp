"""
Tests de l'endpoint batch `/api/geocaches/batch`.

Il remplace N appels unitaires `/api/geocaches/<id>` : on vérifie surtout qu'un
identifiant introuvable est signalé sans faire échouer l'ensemble, et que l'ordre
demandé est préservé (il porte l'ordre d'envoi des logs côté client).
"""

import sys
import types

import pytest

try:
    import pyproj  # type: ignore
except ModuleNotFoundError:  # pragma: no cover - dépendance optionnelle en test
    class _FakeGeod:
        def __init__(self, **_kwargs):
            pass

        def inv(self, *_args, **_kwargs):
            return 0.0, 0.0, 0.0

    sys.modules['pyproj'] = types.SimpleNamespace(Geod=_FakeGeod)

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.models import Zone
from gc_backend.geocaches.models import Geocache


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
def geocache_ids(app):
    """Trois géocaches, renvoyées dans leur ordre de création."""
    with app.app_context():
        zone = Zone(name='Batch Test Zone')
        db.session.add(zone)
        db.session.flush()

        created = []
        for index, code in enumerate(('GCBATCH1', 'GCBATCH2', 'GCBATCH3')):
            geocache = Geocache(
                gc_code=code,
                name=f'Cache {index + 1}',
                owner='TherionAcribus',
                type='Mystery Cache',
                favorites_count=10 + index,
                logs_count=100 + index,
                found=(index == 1),
                zone_id=zone.id,
            )
            db.session.add(geocache)
            created.append(geocache)
        db.session.commit()
        return [gc.id for gc in created]


def test_batch_returns_requested_geocaches(client, geocache_ids):
    response = client.get('/api/geocaches/batch?ids=' + ','.join(str(i) for i in geocache_ids))

    assert response.status_code == 200
    body = response.get_json()
    assert body['missing'] == []
    assert [gc['id'] for gc in body['geocaches']] == geocache_ids

    first = body['geocaches'][0]
    assert first['gc_code'] == 'GCBATCH1'
    assert first['name'] == 'Cache 1'
    assert first['owner'] == 'TherionAcribus'
    assert first['type'] == 'Mystery Cache'
    assert first['favorites_count'] == 10
    assert first['logs_count'] == 100
    assert first['found'] is False
    assert body['geocaches'][1]['found'] is True

    # La vue est volontairement légère : pas de description ni de waypoints.
    assert 'description_html' not in first
    assert 'waypoints' not in first


def test_batch_preserves_requested_order_and_dedupes(client, geocache_ids):
    third, first, second = geocache_ids[2], geocache_ids[0], geocache_ids[1]
    ids = f'{third},{first},{third},{second}'

    response = client.get(f'/api/geocaches/batch?ids={ids}')

    assert response.status_code == 200
    assert [gc['id'] for gc in response.get_json()['geocaches']] == [third, first, second]


def test_batch_reports_missing_ids_without_failing(client, geocache_ids):
    missing_id = max(geocache_ids) + 1000
    ids = f'{geocache_ids[0]},{missing_id},{geocache_ids[1]}'

    response = client.get(f'/api/geocaches/batch?ids={ids}')

    assert response.status_code == 200
    body = response.get_json()
    assert [gc['id'] for gc in body['geocaches']] == [geocache_ids[0], geocache_ids[1]]
    assert body['missing'] == [missing_id]


def test_batch_with_only_unknown_ids_returns_empty_list(client, geocache_ids):
    missing_id = max(geocache_ids) + 1000

    response = client.get(f'/api/geocaches/batch?ids={missing_id}')

    assert response.status_code == 200
    body = response.get_json()
    assert body['geocaches'] == []
    assert body['missing'] == [missing_id]


def test_batch_ignores_empty_tokens(client, geocache_ids):
    response = client.get(f'/api/geocaches/batch?ids=,{geocache_ids[0]},')

    assert response.status_code == 200
    assert [gc['id'] for gc in response.get_json()['geocaches']] == [geocache_ids[0]]


@pytest.mark.parametrize('query', ['', 'ids=', 'ids=,,'])
def test_batch_requires_ids(client, query):
    response = client.get(f'/api/geocaches/batch?{query}')

    assert response.status_code == 400
    assert 'error' in response.get_json()


def test_batch_rejects_non_numeric_id(client):
    response = client.get('/api/geocaches/batch?ids=1,abc')

    assert response.status_code == 400
    assert 'abc' in response.get_json()['error']


def test_batch_rejects_too_many_ids(client):
    from gc_backend.blueprints.geocaches import MAX_BATCH_GEOCACHE_IDS

    ids = ','.join(str(i) for i in range(1, MAX_BATCH_GEOCACHE_IDS + 2))
    response = client.get(f'/api/geocaches/batch?ids={ids}')

    assert response.status_code == 400
    assert 'Too many ids' in response.get_json()['error']
