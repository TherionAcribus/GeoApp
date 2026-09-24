"""Extras opt-in de `GET /api/geocaches/<id>?details_extras=1`.

La fiche détail frontend consomme `notes_count` et `recent_logs_summary`
dans la même requête que le listing, au lieu de requêtes dédiées.
"""
from datetime import datetime, timezone

import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache, GeocacheLog, Note
from gc_backend.models import Zone


@pytest.fixture()
def app():
    app = create_app()
    app.config['TESTING'] = True
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'

    with app.app_context():
        db.create_all()
        zone = Zone(name='Z1')
        db.session.add(zone)
        db.session.flush()
        geocache = Geocache(gc_code='GC1', name='Un', type='Mystery', zone_id=zone.id,
                            latitude=49.21, longitude=6.11)
        db.session.add(geocache)
        db.session.commit()
        app.geocache_id = geocache.id
        yield app
        db.session.remove()
        db.drop_all()


def test_details_extras_are_absent_without_flag(app):
    payload = app.test_client().get(f'/api/geocaches/{app.geocache_id}').get_json()

    assert 'notes_count' not in payload
    assert 'recent_logs_summary' not in payload


def test_details_extras_return_notes_count_and_logs_summary(app):
    geocache = Geocache.query.get(app.geocache_id)
    geocache.notes.append(Note(content='indice', note_type='user'))
    geocache.notes.append(Note(content='autre', note_type='user'))
    db.session.add_all([
        GeocacheLog(geocache_id=geocache.id, log_type='Found it', author='a',
                    date=datetime(2026, 9, 1, tzinfo=timezone.utc)),
        GeocacheLog(geocache_id=geocache.id, log_type='Didn\'t find it', author='b',
                    date=datetime(2026, 9, 10, tzinfo=timezone.utc)),
        GeocacheLog(geocache_id=geocache.id, log_type='Write note', author='c',
                    date=datetime(2026, 9, 5, tzinfo=timezone.utc)),
    ])
    db.session.commit()

    payload = app.test_client().get(
        f'/api/geocaches/{app.geocache_id}?details_extras=1&recent_logs_count=2'
    ).get_json()

    assert payload['notes_count'] == 2
    summary = payload['recent_logs_summary']
    assert summary['total_count'] == 3
    # Tri décroissant par date, limité à `recent_logs_count`.
    assert [e['log_type'] for e in summary['entries']] == ['Didn\'t find it', 'Write note']
