"""Tests pour le téléchargement de Pocket Queries.

Couvre le générateur élagué ``iter_download_pocket_query_gpx`` : streaming de
messages de progression, sélection par magic bytes, repli via lien de page, et
mapping des erreurs (premium / introuvable).
"""
import pytest

from gc_backend.geocaches.pocket_query_importer import PocketQueryImporter


GUID = '12345678-1234-1234-1234-123456789ABC'
ZIP_BYTES = b'PK\x03\x04 fake zip payload'
GPX_BYTES = b'<?xml version="1.0"?><gpx></gpx>'


class _FakeResponse:
    def __init__(self, status_code=200, content=b'', text=''):
        self.status_code = status_code
        self.content = content
        self.text = text

    def raise_for_status(self):
        if self.status_code >= 400:
            import requests
            raise requests.HTTPError(f'status {self.status_code}')


class _FakeSession:
    """Session HTTP factice : premier motif d'URL correspondant gagne."""

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


def _importer(responses):
    return PocketQueryImporter(session=_FakeSession(responses))


def test_iter_download_streams_status_then_bytes():
    importer = _importer({'downloadpq.aspx?g=': _FakeResponse(200, ZIP_BYTES)})

    items = list(importer.iter_download_pocket_query_gpx(GUID))
    statuses = [x for x in items if isinstance(x, str)]
    payloads = [x for x in items if isinstance(x, (bytes, bytearray))]

    assert statuses, 'au moins un message de progression doit être émis'
    assert payloads == [ZIP_BYTES]


def test_download_wrapper_returns_bytes():
    importer = _importer({'downloadpq.aspx?g=': _FakeResponse(200, ZIP_BYTES)})
    assert importer.download_pocket_query_gpx(GUID) == ZIP_BYTES


def test_download_falls_back_to_page_link():
    page_html = '<a href="/pocket/downloadpq.aspx?g=' + GUID + '&direct=1">Download</a>'
    importer = _importer({
        # aucun candidat direct ne renvoie de contenu valide...
        'downloadpq.aspx?g=' + GUID + '&': _FakeResponse(200, GPX_BYTES),  # lien de la page
        '/pocket/': _FakeResponse(200, page_html.encode(), page_html),      # page listant les PQ
    })
    # Les candidats directs (sans &direct=1) tombent sur la page -> pas de magic bytes,
    # puis _find_download_link_from_main_page renvoie le lien &direct=1 -> GPX.
    data = importer.download_pocket_query_gpx(GUID)
    assert data == GPX_BYTES


def test_download_premium_required_on_403():
    importer = _importer({'geocaching.com': _FakeResponse(403, b'forbidden')})
    with pytest.raises(LookupError) as exc:
        importer.download_pocket_query_gpx(GUID)
    assert 'premium' in str(exc.value)


def test_download_not_found_when_nothing_works():
    importer = _importer({})  # tout renvoie 404
    with pytest.raises(LookupError) as exc:
        importer.download_pocket_query_gpx(GUID)
    assert 'not_found' in str(exc.value)


def test_download_invalid_code_raises_value_error():
    importer = _importer({})
    with pytest.raises(ValueError):
        list(importer.iter_download_pocket_query_gpx('not-a-guid'))
