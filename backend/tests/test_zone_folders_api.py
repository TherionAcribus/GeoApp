import pytest
from datetime import datetime, timedelta

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.geocaches.importer import GeocacheImporter
from gc_backend.geocaches.models import Geocache
from gc_backend.models import Zone, ZoneFolderMember


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


def _zone(name: str, *codes: str, updated_at: datetime | None = None) -> int:
    zone = Zone(name=name)
    db.session.add(zone)
    db.session.flush()
    for code in codes:
        db.session.add(Geocache(
            gc_code=code, name=f'Cache {code} ({name})', type='Traditional Cache',
            latitude=48.0, longitude=2.0, zone_id=zone.id, updated_at=updated_at,
        ))
    db.session.commit()
    return zone.id


@pytest.fixture
def holidays(app, client):
    """Dossier « Vacances » : deux jours, GCB rangée dans les deux."""
    with app.app_context():
        base = datetime(2026, 10, 1)
        day1 = _zone('Jour 1', 'GCA', 'GCB', updated_at=base)
        day2 = _zone('Jour 2', 'GCB', 'GCC', updated_at=base + timedelta(days=1))
        other = _zone('Ailleurs', 'GCD')
    folder = client.post('/api/zones', json={'name': 'Vacances', 'is_folder': True}).get_json()
    assert folder['is_folder'] is True
    response = client.put(f"/api/zones/{folder['id']}/members", json={'zone_ids': [day1, day2]})
    assert response.status_code == 200
    return {'folder': folder['id'], 'day1': day1, 'day2': day2, 'other': other}


def test_zone_list_hides_folders_unless_asked(client, holidays):
    names = [zone['name'] for zone in client.get('/api/zones').get_json()]
    assert 'Vacances' not in names
    assert {'Jour 1', 'Jour 2', 'Ailleurs'} <= set(names)

    zones = {zone['name']: zone for zone in client.get('/api/zones?include_folders=true').get_json()}
    folder = zones['Vacances']
    assert folder['is_folder'] is True
    assert folder['zone_ids'] == [holidays['day1'], holidays['day2']]
    # GCB est dans les deux jours : comptée une fois.
    assert folder['geocaches_count'] == 3
    assert zones['Jour 1']['folder_ids'] == [holidays['folder']]
    assert zones['Ailleurs']['folder_ids'] == []


def test_folder_lists_member_geocaches_once(client, holidays):
    rows = client.get(f"/api/zones/{holidays['folder']}/geocaches").get_json()
    assert sorted(row['gc_code'] for row in rows) == ['GCA', 'GCB', 'GCC']
    by_code = {row['gc_code']: row for row in rows}
    # Doublon : la ligne la plus récemment modifiée l'emporte.
    assert by_code['GCB']['zone_id'] == holidays['day2']
    assert by_code['GCB']['zone_name'] == 'Jour 2'
    assert by_code['GCA']['zone_name'] == 'Jour 1'

    tree = client.get(f"/api/zones/{holidays['folder']}/geocaches/tree").get_json()
    assert [row['gc_code'] for row in tree] == ['GCA', 'GCB', 'GCC']

    # Une zone ordinaire garde son comportement.
    rows = client.get(f"/api/zones/{holidays['day1']}/geocaches").get_json()
    assert sorted(row['gc_code'] for row in rows) == ['GCA', 'GCB']


def test_by_code_resolves_inside_folder(client, holidays):
    response = client.get(f"/api/geocaches/by-code/GCB?zone_id={holidays['folder']}")
    assert response.status_code == 200
    assert response.get_json()['zone_id'] == holidays['day2']
    assert client.get(f"/api/geocaches/by-code/GCD?zone_id={holidays['folder']}").status_code == 404


def test_zone_can_sit_in_several_folders(client, holidays):
    weekend = client.post('/api/zones', json={'name': 'Week-end', 'is_folder': True}).get_json()
    response = client.post(f"/api/zones/{weekend['id']}/members/{holidays['day1']}")
    assert response.get_json()['zone_ids'] == [holidays['day1']]

    zones = {zone['name']: zone for zone in client.get('/api/zones?include_folders=true').get_json()}
    assert zones['Jour 1']['folder_ids'] == sorted([holidays['folder'], weekend['id']])

    response = client.delete(f"/api/zones/{weekend['id']}/members/{holidays['day1']}")
    assert response.get_json()['zone_ids'] == []


def test_folder_cannot_contain_folder_nor_non_folder_have_members(client, holidays):
    other_folder = client.post('/api/zones', json={'name': 'Autre', 'is_folder': True}).get_json()
    assert client.post(f"/api/zones/{holidays['folder']}/members/{other_folder['id']}").status_code == 400
    assert client.put(
        f"/api/zones/{holidays['folder']}/members", json={'zone_ids': [other_folder['id']]}
    ).status_code == 400
    assert client.post(f"/api/zones/{holidays['day1']}/members/{holidays['day2']}").status_code == 404


def test_folder_is_not_a_write_target(app, client, holidays):
    with app.app_context():
        geocache_id = Geocache.query.filter_by(gc_code='GCD').first().id
        with pytest.raises(ValueError, match='zone_is_folder'):
            GeocacheImporter()._validate_zone(holidays['folder'])

    assert client.patch(
        f'/api/geocaches/{geocache_id}/move', json={'target_zone_id': holidays['folder']}
    ).status_code == 400
    assert client.post(
        f'/api/geocaches/{geocache_id}/copy', json={'target_zone_id': holidays['folder']}
    ).status_code == 400
    assert client.post(f"/api/zones/{holidays['folder']}/duplicate", json={}).status_code == 400
    assert client.post(
        f"/api/zones/{holidays['folder']}/merge", json={'target_zone_id': holidays['other']}
    ).status_code == 400
    assert client.post(
        f"/api/zones/{holidays['other']}/merge", json={'target_zone_id': holidays['folder']}
    ).status_code == 400


def test_deleting_folder_keeps_zones_and_geocaches(app, client, holidays):
    response = client.delete(f"/api/zones/{holidays['folder']}")
    assert response.status_code == 200
    assert response.get_json()['deleted_geocaches_count'] == 0

    with app.app_context():
        assert db.session.get(Zone, holidays['day1']) is not None
        assert Geocache.query.count() == 5
        assert ZoneFolderMember.query.count() == 0


def test_deleting_or_merging_zone_updates_folder(app, client, holidays):
    # Fusion : la cible hérite du dossier de la source.
    response = client.post(f"/api/zones/{holidays['day1']}/merge", json={'target_zone_id': holidays['other']})
    assert response.status_code == 200
    folder = client.get(f"/api/zones/{holidays['folder']}").get_json()
    assert folder['zone_ids'] == sorted([holidays['day2'], holidays['other']])

    assert client.delete(f"/api/zones/{holidays['day2']}").status_code == 200
    folder = client.get(f"/api/zones/{holidays['folder']}").get_json()
    assert folder['zone_ids'] == [holidays['other']]


def test_friend_finds_of_folder_cover_member_zones(app, client, holidays):
    from gc_backend.models import FriendFind

    with app.app_context():
        db.session.add(FriendFind(friend_username='Alice', gc_code='GCB'))
        db.session.add(FriendFind(friend_username='Bob', gc_code='GCD'))
        db.session.commit()

    finds = client.get(f"/api/friends/finds/zone/{holidays['folder']}").get_json()['finds']
    assert finds == {'GCB': ['Alice']}


def test_moving_geocache_to_its_own_zone_keeps_it(app, client, holidays):
    """Depuis le tableau d'un dossier, la zone d'une ligne fait partie des cibles proposées."""
    with app.app_context():
        geocache_id = Geocache.query.filter_by(gc_code='GCA').first().id

    response = client.patch(f'/api/geocaches/{geocache_id}/move', json={'target_zone_id': holidays['day1']})
    assert response.status_code == 200
    with app.app_context():
        assert db.session.get(Geocache, geocache_id).zone_id == holidays['day1']
