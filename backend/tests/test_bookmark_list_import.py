"""Tests pour l'import de listes de favoris (Bookmark Lists).

Couvre la nouvelle stratégie : téléchargement GPX complet (Premium) en 1 requête
avec repli propre sur le scraping page par page quand le GPX n'est pas disponible.
"""
import pytest

from gc_backend.geocaches.bookmark_list_importer import BookmarkListImporter


# GPX minimal contenant une cache Groundspeak complète + un code nu.
GPX_LIST = b"""<?xml version="1.0" encoding="utf-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/0" xmlns:groundspeak="http://www.groundspeak.com/cache/1/0/1">
 <wpt lat="48.0" lon="2.0">
  <name>GC1LIST</name>
  <groundspeak:cache id="1" available="True" archived="False">
   <groundspeak:name>Cache Liste</groundspeak:name>
   <groundspeak:type>Traditional Cache</groundspeak:type>
   <groundspeak:container>Regular</groundspeak:container>
   <groundspeak:difficulty>1</groundspeak:difficulty>
   <groundspeak:terrain>1</groundspeak:terrain>
  </groundspeak:cache>
 </wpt>
</gpx>"""


class _FakeResponse:
    def __init__(self, status_code=200, content=b'', text=''):
        self.status_code = status_code
        self.content = content
        self.text = text


class _FakeSession:
    """Session HTTP factice : mappe URL -> réponse, journalise les GET."""

    def __init__(self, responses):
        self.responses = responses
        self.headers = {}
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append(url)
        for pattern, resp in self.responses.items():
            if pattern in url:
                return resp
        return _FakeResponse(status_code=404, content=b'not found')


def test_download_list_gpx_from_direct_endpoint():
    session = _FakeSession({
        '/geocaches/gpx': _FakeResponse(200, GPX_LIST),
    })
    importer = BookmarkListImporter(session=session)

    data = importer.download_list_gpx('BM1234')
    assert data == GPX_LIST
    # Le premier endpoint candidat suffit : pas de scan de page nécessaire
    assert session.calls[0].endswith('/lists/BM1234/geocaches/gpx')


def test_download_list_gpx_returns_none_when_unavailable():
    # Toutes les réponses sont du HTML (page de login), aucun magic byte GPX/ZIP
    session = _FakeSession({
        '': _FakeResponse(200, b'<html>Please sign in</html>', '<html>Please sign in</html>'),
    })
    importer = BookmarkListImporter(session=session)

    assert importer.download_list_gpx('BM1234') is None


def test_download_list_gpx_via_page_link():
    page_html = (
        '<html><body>'
        '<a href="/plan/lists/BM1234/download.gpx">Télécharger GPX</a>'
        '</body></html>'
    )
    session = _FakeSession({
        '/download.gpx': _FakeResponse(200, GPX_LIST),  # lien trouvé dans la page
        '/geocaches/gpx': _FakeResponse(404),
        '/plan/lists/BM1234/download': _FakeResponse(404),  # candidat direct échoue
        '/plan/lists/BM1234': _FakeResponse(200, page_html.encode(), page_html),
    })
    importer = BookmarkListImporter(session=session)

    data = importer.download_list_gpx('BM1234')
    assert data == GPX_LIST


def test_download_list_gpx_invalid_code_raises():
    importer = BookmarkListImporter(session=_FakeSession({}))
    with pytest.raises(ValueError):
        importer.download_list_gpx('NOT_BM')


@pytest.fixture
def app():
    import requests
    from gc_backend import create_app
    from gc_backend.database import db

    app = create_app()
    app.config['TESTING'] = True
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()


def test_endpoint_uses_gpx_first_without_per_cache_scraping(app, monkeypatch):
    """L'endpoint importe via le GPX complet sans scraper chaque cache."""
    import requests
    from gc_backend.database import db
    from gc_backend.models import Zone
    from gc_backend.geocaches.models import Geocache
    from gc_backend.geocaches.scraper import GeocachingScraper

    # Scraper neutralisé : session factice, aucun accès réseau/auth à l'init.
    def _fake_init(self, session=None):
        self.session = session if session is not None else requests.Session()
    monkeypatch.setattr(GeocachingScraper, '__init__', _fake_init)

    # Le téléchargement GPX complet renvoie notre GPX de test ; scrape interdit.
    monkeypatch.setattr(BookmarkListImporter, 'get_list_info', lambda self, code: {'name': 'Ma Liste'})
    monkeypatch.setattr(BookmarkListImporter, 'download_list_gpx', lambda self, code: GPX_LIST)

    def _boom(self, *a, **k):
        raise AssertionError('get_geocaches_from_list ne doit pas être appelé sur le chemin GPX')
    monkeypatch.setattr(BookmarkListImporter, 'get_geocaches_from_list', _boom)

    with app.app_context():
        zone = Zone(name='Zone liste')
        db.session.add(zone)
        db.session.commit()
        zone_id = zone.id

        client = app.test_client()
        resp = client.post('/api/geocaches/import-bookmark-list',
                            json={'bookmark_code': 'BM1234', 'zone_id': zone_id})
        assert resp.status_code == 200
        body = resp.get_data(as_text=True)

        # La cache du GPX est bien persistée
        stored = Geocache.query.filter_by(gc_code='GC1LIST').first()
        assert stored is not None
        assert stored.name == 'Cache Liste'
        assert stored.zone_id == zone_id
        # Le flux mentionne l'import GPX sans téléchargement page par page
        assert 'GPX' in body
        # Le flux transporte les compteurs cumulés (compteur live du dialogue)
        assert '"counts"' in body


def test_endpoint_update_existing_flag_refreshes_caches(app, monkeypatch):
    """update_existing=True rafraîchit une cache déjà importée via la liste."""
    import requests
    from gc_backend.database import db
    from gc_backend.models import Zone
    from gc_backend.geocaches.models import Geocache
    from gc_backend.geocaches.scraper import GeocachingScraper

    def _fake_init(self, session=None):
        self.session = session if session is not None else requests.Session()
    monkeypatch.setattr(GeocachingScraper, '__init__', _fake_init)
    monkeypatch.setattr(BookmarkListImporter, 'get_list_info', lambda self, code: {'name': 'L'})

    gpx_modified = GPX_LIST.replace(b'Cache Liste', b'Cache Modifiee')

    with app.app_context():
        zone = Zone(name='Zone maj')
        db.session.add(zone)
        db.session.commit()
        zone_id = zone.id

        client = app.test_client()

        # 1) Import initial (lire le body force l'exécution du flux streamé)
        monkeypatch.setattr(BookmarkListImporter, 'download_list_gpx', lambda self, code: GPX_LIST)
        client.post('/api/geocaches/import-bookmark-list',
                    json={'bookmark_code': 'BM1234', 'zone_id': zone_id}).get_data()
        assert Geocache.query.filter_by(gc_code='GC1LIST').first().name == 'Cache Liste'

        # 2) Ré-import SANS update_existing -> inchangée
        monkeypatch.setattr(BookmarkListImporter, 'download_list_gpx', lambda self, code: gpx_modified)
        client.post('/api/geocaches/import-bookmark-list',
                    json={'bookmark_code': 'BM1234', 'zone_id': zone_id}).get_data()
        assert Geocache.query.filter_by(gc_code='GC1LIST').first().name == 'Cache Liste'

        # 3) Ré-import AVEC update_existing -> mise à jour
        client.post('/api/geocaches/import-bookmark-list',
                    json={'bookmark_code': 'BM1234', 'zone_id': zone_id, 'update_existing': True}).get_data()
        assert Geocache.query.filter_by(gc_code='GC1LIST').first().name == 'Cache Modifiee'
