"""Analyse IA des logs : elle survit au changement de géocache, avec son périmètre.

Le sujet de ces tests est double : l'analyse est **gardée** (une par géocache,
relancer remplace) et elle est gardée **avec ce sur quoi elle a porté** — sans
les compteurs, une analyse faite sur 50 logs sur 300 se relirait comme
exhaustive.
"""
from __future__ import annotations

import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache, GeocacheLogsAnalysis
from gc_backend.models import Zone


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
        geocache = Geocache(gc_code='GC12345', name='Test', type='Traditional', zone_id=zone.id)
        db.session.add(geocache)
        db.session.flush()
        app.geocache_id = geocache.id
        yield app
        db.session.remove()
        db.drop_all()


def _payload(**overrides) -> dict:
    payload = {
        'content': '## Indices\n\n- Regarder sous la souche',
        'model_id': 'default/universal',
        'analyzed_count': 50,
        'stored_count': 120,
        'total_available': 300,
    }
    payload.update(overrides)
    return payload


def test_absent_analysis_is_a_normal_state(app):
    client = app.test_client()

    response = client.get(f'/api/geocaches/{app.geocache_id}/logs/analysis')

    assert response.status_code == 200
    assert response.get_json()['analysis'] is None


def test_analysis_is_stored_with_its_scope(app):
    client = app.test_client()

    saved = client.put(
        f'/api/geocaches/{app.geocache_id}/logs/analysis', json=_payload()
    ).get_json()['analysis']

    assert saved['content'].startswith('## Indices')
    assert (saved['analyzed_count'], saved['stored_count'], saved['total_available']) == (50, 120, 300)

    # Rouvrir la géocache doit rendre exactement la même analyse.
    reloaded = client.get(f'/api/geocaches/{app.geocache_id}/logs/analysis').get_json()['analysis']
    assert reloaded == saved


def test_running_the_analysis_again_replaces_the_previous_one(app):
    client = app.test_client()

    client.put(f'/api/geocaches/{app.geocache_id}/logs/analysis', json=_payload())
    client.put(
        f'/api/geocaches/{app.geocache_id}/logs/analysis',
        json=_payload(content='## Nouvelle analyse', analyzed_count=100, stored_count=100),
    )

    assert GeocacheLogsAnalysis.query.filter_by(geocache_id=app.geocache_id).count() == 1
    current = client.get(f'/api/geocaches/{app.geocache_id}/logs/analysis').get_json()['analysis']
    assert current['content'] == '## Nouvelle analyse'
    assert current['analyzed_count'] == 100


def test_an_empty_analysis_is_refused(app):
    client = app.test_client()

    response = client.put(
        f'/api/geocaches/{app.geocache_id}/logs/analysis', json=_payload(content='   ')
    )

    assert response.status_code == 400
    assert GeocacheLogsAnalysis.query.count() == 0


def test_deleting_an_analysis_is_idempotent(app):
    client = app.test_client()
    client.put(f'/api/geocaches/{app.geocache_id}/logs/analysis', json=_payload())

    first = client.delete(f'/api/geocaches/{app.geocache_id}/logs/analysis').get_json()
    second = client.delete(f'/api/geocaches/{app.geocache_id}/logs/analysis').get_json()

    assert first['deleted'] is True
    assert second['deleted'] is False
    assert client.get(f'/api/geocaches/{app.geocache_id}/logs/analysis').get_json()['analysis'] is None


def test_deleting_the_geocache_takes_its_analysis_along(app):
    client = app.test_client()
    client.put(f'/api/geocaches/{app.geocache_id}/logs/analysis', json=_payload())

    db.session.delete(Geocache.query.get(app.geocache_id))
    db.session.commit()

    assert GeocacheLogsAnalysis.query.count() == 0


def test_unknown_geocache_is_not_found(app):
    client = app.test_client()

    assert client.get('/api/geocaches/999999/logs/analysis').status_code == 404
    assert client.put('/api/geocaches/999999/logs/analysis', json=_payload()).status_code == 404
