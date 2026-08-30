import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache, Note, GeocacheNote
from gc_backend.geocaches import archive_service
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
def seeded_geocache(app):
    with app.app_context():
        zone = Zone(name='Notes test zone')
        db.session.add(zone)
        db.session.flush()

        gc = Geocache(
            gc_code='GCNOTES1',
            name='Cache notes',
            type='Traditional Cache',
            difficulty=2.0,
            terrain=2.0,
            zone_id=zone.id,
        )
        db.session.add(gc)
        db.session.commit()
        return gc.id


@pytest.fixture
def archive_calls(app, monkeypatch):
    """Mock ArchiveService.sync_from_geocache pour suivre les appels sans toucher la BDD."""
    calls = []

    def _fake_sync(geocache, force=False):
        calls.append(geocache.id)
        return True

    monkeypatch.setattr(archive_service.ArchiveService, 'sync_from_geocache', staticmethod(_fake_sync))
    return calls


def test_create_note_syncs_archive(client, seeded_geocache, archive_calls):
    resp = client.post(
        f'/api/geocaches/{seeded_geocache}/notes',
        json={'content': 'Une note', 'note_type': 'user', 'source': 'user'},
    )
    assert resp.status_code == 201
    assert archive_calls == [seeded_geocache]


def test_update_note_syncs_archive(client, seeded_geocache, archive_calls):
    create = client.post(
        f'/api/geocaches/{seeded_geocache}/notes',
        json={'content': 'Init', 'note_type': 'user', 'source': 'user'},
    )
    note_id = create.get_json()['note']['id']

    archive_calls.clear()
    resp = client.put(f'/api/notes/{note_id}', json={'content': 'Modifiee'})
    assert resp.status_code == 200
    assert archive_calls == [seeded_geocache]


def test_delete_note_syncs_archive(client, seeded_geocache, archive_calls):
    create = client.post(
        f'/api/geocaches/{seeded_geocache}/notes',
        json={'content': 'A supprimer', 'note_type': 'user', 'source': 'user'},
    )
    note_id = create.get_json()['note']['id']

    archive_calls.clear()
    resp = client.delete(f'/api/notes/{note_id}')
    assert resp.status_code == 200
    assert resp.get_json() == {'deleted': True}
    # Bug #5 : la suppression doit aussi resync l'archive, comme create/update.
    assert archive_calls == [seeded_geocache]


def test_delete_note_removes_note_and_link(client, app, seeded_geocache):
    create = client.post(
        f'/api/geocaches/{seeded_geocache}/notes',
        json={'content': 'A supprimer', 'note_type': 'user', 'source': 'user'},
    )
    note_id = create.get_json()['note']['id']

    resp = client.delete(f'/api/notes/{note_id}')
    assert resp.status_code == 200

    with app.app_context():
        assert Note.query.get(note_id) is None
        assert GeocacheNote.query.filter_by(note_id=note_id).count() == 0


def test_delete_unknown_note_returns_404(client):
    resp = client.delete('/api/notes/999999')
    assert resp.status_code == 404


def test_update_note_only_user_notes_editable(client, seeded_geocache, archive_calls):
    create = client.post(
        f'/api/geocaches/{seeded_geocache}/notes',
        json={'content': 'Source externe', 'note_type': 'system', 'source': 'earthcoach'},
    )
    note_id = create.get_json()['note']['id']

    resp = client.put(f'/api/notes/{note_id}', json={'content': 'Tentative'})
    assert resp.status_code == 400


def test_create_note_rejects_invalid_source(client, seeded_geocache):
    resp = client.post(
        f'/api/geocaches/{seeded_geocache}/notes',
        json={'content': 'Note', 'note_type': 'user', 'source': 'malicious'},
    )
    assert resp.status_code == 400
    assert 'source' in resp.get_json()['error']


def test_create_note_rejects_invalid_note_type(client, seeded_geocache):
    resp = client.post(
        f'/api/geocaches/{seeded_geocache}/notes',
        json={'content': 'Note', 'note_type': 'admin', 'source': 'user'},
    )
    assert resp.status_code == 400
    assert 'note_type' in resp.get_json()['error']


def test_create_note_accepts_earthcoach_source(client, seeded_geocache, archive_calls):
    resp = client.post(
        f'/api/geocaches/{seeded_geocache}/notes',
        json={'content': 'Synthese EC', 'note_type': 'system', 'source': 'earthcoach', 'source_plugin': 'earthcoach'},
    )
    assert resp.status_code == 201
    assert resp.get_json()['note']['source'] == 'earthcoach'


def test_update_note_rejects_invalid_note_type(client, seeded_geocache, archive_calls):
    create = client.post(
        f'/api/geocaches/{seeded_geocache}/notes',
        json={'content': 'Note', 'note_type': 'user', 'source': 'user'},
    )
    note_id = create.get_json()['note']['id']

    resp = client.put(f'/api/notes/{note_id}', json={'note_type': 'admin'})
    assert resp.status_code == 400
    assert 'note_type' in resp.get_json()['error']


def test_sync_personal_note_to_geocaching_pushes_content(client, seeded_geocache, monkeypatch):
    """L'endpoint direct /api/geocaches/<id>/notes/sync-to-geocaching pousse un contenu
    arbitraire vers GC.com sans dependre d'une note applicative."""
    pushed = {}

    class _FakeClient:
        def update_personal_note(self, gc_code, note):
            pushed['gc_code'] = gc_code
            pushed['note'] = note
            return True

    monkeypatch.setattr('gc_backend.blueprints.notes.GeocachingPersonalNotesClient', lambda: _FakeClient())

    resp = client.post(
        f'/api/geocaches/{seeded_geocache}/notes/sync-to-geocaching',
        json={'content': 'Nouvelle note GC'},
    )
    assert resp.status_code == 200
    assert pushed == {'gc_code': 'GCNOTES1', 'note': 'Nouvelle note GC'}
    assert resp.get_json()['gc_personal_note'] == 'Nouvelle note GC'


def test_sync_personal_note_to_geocaching_allows_empty_content(client, seeded_geocache, monkeypatch):
    """On peut vider la note GC.com en envoyant un contenu vide."""
    pushed = {}

    class _FakeClient:
        def update_personal_note(self, gc_code, note):
            pushed['note'] = note
            return True

    monkeypatch.setattr('gc_backend.blueprints.notes.GeocachingPersonalNotesClient', lambda: _FakeClient())

    resp = client.post(
        f'/api/geocaches/{seeded_geocache}/notes/sync-to-geocaching',
        json={'content': ''},
    )
    assert resp.status_code == 200
    assert pushed['note'] == ''
    assert resp.get_json()['gc_personal_note'] == ''
