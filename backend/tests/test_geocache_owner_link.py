"""
Tests de `/api/geocaches/<id>/owner-link`.

Le pseudo du propriétaire suffit à ouvrir sa fiche publique, mais le centre de
messages n'accepte que son GUID. Les géocaches importées avant la colonne
`owner_guid` n'en ont pas : l'endpoint le rattrape à la demande sur le listing,
puis le mémorise pour ne pas rescraper à chaque ouverture du menu.
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
from gc_backend.blueprints import geocaches as geocaches_bp


OWNER_GUID = 'e4c9aa12-6aa4-48f8-9e2a-8b69040ae285'


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
def geocache_id(app):
    with app.app_context():
        zone = Zone(name='Owner Link Zone')
        db.session.add(zone)
        db.session.flush()

        geocache = Geocache(gc_code='GC890F8', name='Tiniest House', owner='reikja', zone_id=zone.id)
        db.session.add(geocache)
        db.session.commit()
        return geocache.id


class _SpyScraper:
    """Compte les scrapes : le rattrapage ne doit avoir lieu qu'une fois."""

    calls = 0
    result = ('reikja', OWNER_GUID)
    error: Exception | None = None

    def scrape_owner_identity(self, gc_code: str):
        type(self).calls += 1
        if type(self).error:
            raise type(self).error
        return type(self).result


@pytest.fixture
def spy_scraper(monkeypatch):
    _SpyScraper.calls = 0
    _SpyScraper.result = ('reikja', OWNER_GUID)
    _SpyScraper.error = None
    monkeypatch.setattr(geocaches_bp, 'GeocachingScraper', _SpyScraper)
    return _SpyScraper


def test_owner_link_scrapes_the_guid_once_then_serves_it_from_the_database(client, geocache_id, spy_scraper):
    first = client.get(f'/api/geocaches/{geocache_id}/owner-link')

    assert first.status_code == 200
    body = first.get_json()
    assert body['owner'] == 'reikja'
    assert body['owner_guid'] == OWNER_GUID
    assert body['scraped'] is True
    assert spy_scraper.calls == 1

    second = client.get(f'/api/geocaches/{geocache_id}/owner-link')

    assert second.get_json()['owner_guid'] == OWNER_GUID
    assert second.get_json()['scraped'] is False
    assert spy_scraper.calls == 1, 'le GUID mémorisé doit éviter un second scrape'


def test_owner_link_refreshes_on_demand(client, geocache_id, spy_scraper):
    client.get(f'/api/geocaches/{geocache_id}/owner-link')
    spy_scraper.result = ('reikja-renomme', OWNER_GUID)

    response = client.get(f'/api/geocaches/{geocache_id}/owner-link?refresh=1')

    assert response.status_code == 200
    assert spy_scraper.calls == 2
    # Le pseudo affiché suit le renommage du joueur au passage.
    assert response.get_json()['owner'] == 'reikja-renomme'


def test_owner_link_reports_a_listing_without_guid_without_failing(client, geocache_id, spy_scraper):
    spy_scraper.result = ('reikja', None)

    response = client.get(f'/api/geocaches/{geocache_id}/owner-link')

    assert response.status_code == 200
    assert response.get_json()['owner_guid'] is None


def test_owner_link_maps_a_scrape_failure_to_502(client, geocache_id, spy_scraper):
    spy_scraper.error = LookupError('gc_timeout')

    response = client.get(f'/api/geocaches/{geocache_id}/owner-link')

    assert response.status_code == 502
    assert response.get_json()['error'] == 'gc_timeout'


def test_owner_link_404_on_unknown_geocache(client, geocache_id):
    response = client.get(f'/api/geocaches/{geocache_id + 1000}/owner-link')

    assert response.status_code == 404
